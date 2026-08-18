import { apiClient } from '@/lib/api';
import type { Document, NormalizedTrial, TrialSearchResponse } from '@/types/api';

export interface TrialSearchParams {
  term?: string;
  cond?: string;
  intr?: string;
  spons?: string;
  status?: string; // comma-separated overallStatus values
  phase?: string; // comma-separated phase values
  pageSize?: number;
  pageToken?: string;
}

export interface ImportTrialResult {
  duplicate?: boolean;
  document: Document;
}

function buildSearchQuery(params: TrialSearchParams): string {
  const q = new URLSearchParams();
  if (params.term) q.set('term', params.term);
  if (params.cond) q.set('cond', params.cond);
  if (params.intr) q.set('intr', params.intr);
  if (params.spons) q.set('spons', params.spons);
  if (params.status) q.set('status', params.status);
  if (params.phase) q.set('phase', params.phase);
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.pageToken) q.set('pageToken', params.pageToken);
  return q.toString();
}

export const clinicalTrialsService = {
  /** Free-text/condition search, or filter by status/phase. */
  async search(params: TrialSearchParams): Promise<TrialSearchResponse> {
    return apiClient.get<TrialSearchResponse>(`/api/v1/trials/search?${buildSearchQuery(params)}`);
  },

  /** Single normalized trial by NCT ID (e.g. "NCT04307940"). */
  async get(nctId: string): Promise<NormalizedTrial> {
    return apiClient.get<NormalizedTrial>(`/api/v1/trials/${encodeURIComponent(nctId)}`);
  },

  /** Import a trial as a document in the given project. Dedups by NCT ID.
   * The backend returns one of two distinct shapes (mirrors
   * documentsService.upload's content_hash dedup response):
   *   - first import (201):   the document row itself, flat
   *   - duplicate NCT ID (200): { duplicate: true, document: <existing row> }
   * so we branch on the `duplicate` flag rather than assuming one shape. */
  async importTrial(nctId: string, projectId: string): Promise<ImportTrialResult> {
    const response = await apiClient.post<any>(
      `/api/v1/trials/${encodeURIComponent(nctId)}/import`,
      { project_id: projectId }
    );
    if (response && response.duplicate) {
      return { duplicate: true, document: response.document as Document };
    }
    return { duplicate: false, document: response as Document };
  },
};

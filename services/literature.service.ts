import { apiClient } from '@/lib/api';
import type { LiteratureSearchResponse } from '@/types/api';

export type LiteratureScope = 'all' | 'ctgov' | 'pubmed';

export interface LiteratureSearchParams {
  term: string;
  scope?: LiteratureScope;
  status?: string; // comma-separated overallStatus values — ctgov only
  phase?: string; // comma-separated phase values — ctgov only
  pageSize?: number;
  /** Pass the previous response's nextCtgovPageToken/nextPubmedOffset to
   * fetch the NEXT page — omit both for a fresh (page-1) search. */
  ctgovPageToken?: string;
  pubmedOffset?: number;
}

export const literatureService = {
  /** Unified search — fans out to ClinicalTrials.gov and/or PubMed
   * server-side based on `scope`, merges results round-robin, degrades
   * gracefully (never throws) if one source is down. One call = one page
   * per source; see nextCtgovPageToken/nextPubmedOffset on the response for
   * "load more" support. */
  async search(params: LiteratureSearchParams): Promise<LiteratureSearchResponse> {
    const q = new URLSearchParams();
    q.set('term', params.term);
    q.set('scope', params.scope || 'all');
    if (params.status) q.set('status', params.status);
    if (params.phase) q.set('phase', params.phase);
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    if (params.ctgovPageToken) q.set('ctgovPageToken', params.ctgovPageToken);
    if (params.pubmedOffset) q.set('pubmedOffset', String(params.pubmedOffset));
    return apiClient.get<LiteratureSearchResponse>(`/api/v1/literature/search?${q.toString()}`);
  },
};

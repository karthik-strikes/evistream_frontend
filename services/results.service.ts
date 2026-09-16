import { apiClient } from '@/lib/api';
import type {
  ExtractionResult, ConsensusSummary, ConsensusResult, SourceIndexResponse, PageMapResponse,
  FormActivityResponse,
} from '@/types/api';

export interface GetResultsOptions {
  projectId?: string;
  formId?: string;
  documentId?: string;
  extractionId?: string;
  limit?: number;
  offset?: number;
}

/** One (document, form, role) slot that already holds a manual row. */
export interface ManualStatusRow {
  document_id: string;
  form_id: string;
  reviewer_role: string | null;
  is_partial: boolean;
  is_mine: boolean;
  /** Who and when. Still no extracted values — enough to draw a contributor
   *  stack and a "last activity" line for a whole project in one request. */
  extracted_by: string | null;
  reviewer_name: string | null;
  updated_at: string | null;
}

export interface ResultsStatus {
  manual: ManualStatusRow[];
  /** Documents with an AI row — populated only when a formId was given. */
  ai_document_ids: string[];
}

export const resultsService = {
  async getAll(options: GetResultsOptions = {}): Promise<ExtractionResult[]> {
    const params = new URLSearchParams();
    if (options.projectId) params.append('project_id', options.projectId);
    if (options.formId) params.append('form_id', options.formId);
    if (options.documentId) params.append('document_id', options.documentId);
    if (options.extractionId) params.append('extraction_id', options.extractionId);
    if (options.limit != null) params.append('limit', String(options.limit));
    if (options.offset != null) params.append('offset', String(options.offset));

    const queryString = params.toString();
    const url = queryString ? `/api/v1/results?${queryString}` : '/api/v1/results';

    return apiClient.get<ExtractionResult[]>(url);
  },

  // Fetch ALL results for a form across every run/model, paginating past the
  // backend's per-request cap (le=500). The "all runs" Results view needs the
  // full set so per-model toggles and latest-per-paper dedup are correct.
  async getAllForForm(projectId: string, formId: string): Promise<ExtractionResult[]> {
    const pageSize = 500; // backend hard cap (le=500)
    const all: ExtractionResult[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.getAll({ projectId, formId, limit: pageSize, offset });
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all;
  },

  /**
   * Completion status for a whole project (or one form), with no values.
   *
   * `getAll` cannot answer this: the backend caps it at 50 rows per request by
   * default, newest first, so in a project holding a few thousand AI results
   * every manual row falls off the page and saved work reads as un-started.
   * Paginating `getAll` instead would download megabytes of `extracted_data`
   * to draw a checkmark.
   */
  async getStatus(options: { projectId: string; formId?: string }): Promise<ResultsStatus> {
    const params = new URLSearchParams({ project_id: options.projectId });
    if (options.formId) params.append('form_id', options.formId);
    return apiClient.get<ResultsStatus>(`/api/v1/results/status?${params.toString()}`);
  },

  async getById(id: string): Promise<ExtractionResult> {
    return apiClient.get<ExtractionResult>(`/api/v1/results/${id}`);
  },

  /**
   * Who changed what, when, on this project's results.
   *
   * Reads `audit_trail`, which has carried one row per changed field since the
   * provenance work and had never been rendered anywhere. Blinded server-side:
   * `old_value`/`new_value` are the extracted values themselves.
   *
   * Omit `formId` for the whole project — the Results form list needs every
   * form's activity at once to draw its cards.
   */
  async getActivity(options: {
    projectId: string;
    formId?: string;
    documentId?: string;
    limit?: number;
  }): Promise<FormActivityResponse> {
    const params = new URLSearchParams({ project_id: options.projectId });
    if (options.formId) params.append('form_id', options.formId);
    if (options.documentId) params.append('document_id', options.documentId);
    if (options.limit != null) params.append('limit', String(options.limit));
    return apiClient.get<FormActivityResponse>(`/api/v1/results/activity?${params.toString()}`);
  },

  /** `includeSources` adds `<field>_source_page` / `<field>_source_quote`
   *  columns. Off by default so an existing export is unchanged. */
  async exportCSV(options: GetResultsOptions & { includeSources?: boolean } = {}): Promise<Blob> {
    if (!options.extractionId) {
      throw new Error('extractionId is required for export');
    }
    const token = apiClient.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const src = options.includeSources ? '&include_sources=true' : '';
    const response = await fetch(`/api/v1/results/extraction/${encodeURIComponent(options.extractionId)}/export?format=csv${src}`, { headers });
    if (!response.ok) throw new Error(`Export failed with status ${response.status}`);
    return response.blob();
  },

  async exportJSON(options: GetResultsOptions & { includeSources?: boolean } = {}): Promise<Blob> {
    if (!options.extractionId) {
      throw new Error('extractionId is required for export');
    }
    const token = apiClient.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const src = options.includeSources ? '&include_sources=true' : '';
    const response = await fetch(`/api/v1/results/extraction/${encodeURIComponent(options.extractionId)}/export?format=json${src}`, { headers });
    if (!response.ok) throw new Error(`Export failed with status ${response.status}`);
    return response.blob();
  },

  async saveManualExtraction(data: {
    document_id: string;
    form_id: string;
    extracted_data: Record<string, any>;
    extraction_type: 'manual' | 'consensus';
    reviewer_role?: string | null;
    is_partial?: boolean;
  }): Promise<ExtractionResult> {
    return apiClient.post<ExtractionResult>('/api/v1/results/manual', data);
  },

  async compare(options: {
    document_id: string;
    form_id: string;
  }): Promise<unknown> {
    const params = new URLSearchParams();
    params.append('document_id', options.document_id);
    params.append('form_id', options.form_id);
    return apiClient.get<unknown>(`/api/v1/results/compare?${params.toString()}`);
  },

  async getConsensusSummary(projectId: string, formId: string): Promise<ConsensusSummary> {
    return apiClient.get<ConsensusSummary>(
      `/api/v1/results/consensus-summary?project_id=${projectId}&form_id=${formId}`
    );
  },

  async saveConsensus(data: {
    document_id: string;
    form_id: string;
    review_mode: 'ai_only' | 'ai_manual';
    field_decisions: Record<string, any>;
    agreed_count: number;
    disputed_count: number;
    total_fields: number;
    agreement_pct: number | null;
  }): Promise<ConsensusResult> {
    return apiClient.post<ConsensusResult>('/api/v1/results/consensus', data);
  },

  async getConsensus(documentId: string, formId: string): Promise<ConsensusResult | null> {
    try {
      return await apiClient.get<ConsensusResult>(
        `/api/v1/results/consensus/${documentId}?form_id=${formId}`
      );
    } catch {
      return null;
    }
  },

  /** Delete ONE extraction result row. Requires can_manage_assignments.
   *
   *  The only other delete is `DELETE /extractions/{id}`, which removes the
   *  grouping row and with it EVERY manual result for that form, across all
   *  documents and reviewers. This one removes exactly the row you name, and the
   *  server writes the whole row to the audit trail first, so it is recoverable.
   */
  async deleteResult(resultId: string): Promise<{ deleted: number }> {
    return apiClient.delete<{ deleted: number }>(`/api/v1/results/${resultId}`);
  },

  async getSourceIndex(resultId: string): Promise<SourceIndexResponse> {
    return apiClient.get<SourceIndexResponse>(`/api/v1/results/${resultId}/source-index`);
  },

  async getPageMap(resultId: string): Promise<PageMapResponse> {
    return apiClient.get<PageMapResponse>(`/api/v1/results/${resultId}/page-map`);
  },
};

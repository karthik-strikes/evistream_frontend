import { apiClient } from '@/lib/api';
import type { ExtractionResult, ConsensusSummary, ConsensusResult, SourceIndexResponse, PageMapResponse } from '@/types/api';

export interface GetResultsOptions {
  projectId?: string;
  formId?: string;
  documentId?: string;
  extractionId?: string;
}

export const resultsService = {
  async getAll(options: GetResultsOptions = {}): Promise<ExtractionResult[]> {
    const params = new URLSearchParams();
    if (options.projectId) params.append('project_id', options.projectId);
    if (options.formId) params.append('form_id', options.formId);
    if (options.documentId) params.append('document_id', options.documentId);
    if (options.extractionId) params.append('extraction_id', options.extractionId);

    const queryString = params.toString();
    const url = queryString ? `/api/v1/results?${queryString}` : '/api/v1/results';

    return apiClient.get<ExtractionResult[]>(url);
  },

  async getById(id: string): Promise<ExtractionResult> {
    return apiClient.get<ExtractionResult>(`/api/v1/results/${id}`);
  },

  async exportCSV(options: GetResultsOptions = {}): Promise<Blob> {
    if (!options.extractionId) {
      throw new Error('extractionId is required for export');
    }
    const token = apiClient.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`/api/v1/results/extraction/${encodeURIComponent(options.extractionId)}/export?format=csv`, { headers });
    if (!response.ok) throw new Error(`Export failed with status ${response.status}`);
    return response.blob();
  },

  async exportJSON(options: GetResultsOptions = {}): Promise<Blob> {
    if (!options.extractionId) {
      throw new Error('extractionId is required for export');
    }
    const token = apiClient.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`/api/v1/results/extraction/${encodeURIComponent(options.extractionId)}/export?format=json`, { headers });
    if (!response.ok) throw new Error(`Export failed with status ${response.status}`);
    return response.blob();
  },

  async saveManualExtraction(data: {
    document_id: string;
    form_id: string;
    extracted_data: Record<string, any>;
    extraction_type: 'manual' | 'consensus';
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

  async getSourceIndex(resultId: string): Promise<SourceIndexResponse> {
    return apiClient.get<SourceIndexResponse>(`/api/v1/results/${resultId}/source-index`);
  },

  async getPageMap(resultId: string): Promise<PageMapResponse> {
    return apiClient.get<PageMapResponse>(`/api/v1/results/${resultId}/page-map`);
  },
};

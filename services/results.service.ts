import { apiClient } from '@/lib/api';
import type { ExtractionResult } from '@/types/api';

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
    return apiClient.get<Blob>(`/api/v1/results/extraction/${encodeURIComponent(options.extractionId)}/export?format=csv`, {
      responseType: 'blob',
    });
  },

  async exportJSON(options: GetResultsOptions = {}): Promise<Blob> {
    if (!options.extractionId) {
      throw new Error('extractionId is required for export');
    }
    return apiClient.get<Blob>(`/api/v1/results/extraction/${encodeURIComponent(options.extractionId)}/export?format=json`, {
      responseType: 'blob',
    });
  },

  async saveManualExtraction(data: {
    document_id: string;
    form_id: string;
    extracted_data: Record<string, any>;
    extraction_type: 'manual';
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
};

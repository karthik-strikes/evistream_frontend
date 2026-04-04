import { apiClient } from '@/lib/api';
import type { Extraction, CreateExtractionRequest } from '@/types/api';

export interface FormCoverageActiveJob {
  job_id: string;
  extraction_id: string;
  status: 'pending' | 'processing';
  progress: number;
  papers_total: number;
  papers_done: number;
}

export interface FormCoverage {
  form_id: string;
  form_name: string;
  total_project_documents: number;
  extracted_count: number;
  failed_count: number;
  not_run_count: number;
  total_runs: number;
  last_run_at: string;
  latest_extraction_id: string;
  latest_failed_extraction_id: string | null;
  active_jobs: FormCoverageActiveJob[];
  extracted_document_ids: string[];
  failed_document_ids: string[];
}

export const extractionsService = {
  async getAll(projectId: string): Promise<Extraction[]> {
    return apiClient.get<Extraction[]>(`/api/v1/extractions/?project_id=${encodeURIComponent(projectId)}`);
  },

  async getCoverage(projectId: string): Promise<FormCoverage[]> {
    return apiClient.get<FormCoverage[]>(`/api/v1/extractions/coverage?project_id=${encodeURIComponent(projectId)}`);
  },

  async getById(id: string): Promise<Extraction> {
    return apiClient.get<Extraction>(`/api/v1/extractions/${id}`);
  },

  async create(data: CreateExtractionRequest): Promise<Extraction> {
    return apiClient.post<Extraction>('/api/v1/extractions/', data);
  },

  async cancel(id: string): Promise<{ message: string; status: string }> {
    return apiClient.post<{ message: string; status: string }>(`/api/v1/extractions/${id}/cancel`);
  },

  async delete(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/extractions/${id}`);
  },

  async getStatus(id: string): Promise<Extraction> {
    return apiClient.get<Extraction>(`/api/v1/extractions/${id}`);
  },

  async retryFailed(id: string): Promise<{ job_id: string; retrying_count: number }> {
    return apiClient.post<{ job_id: string; retrying_count: number }>(`/api/v1/extractions/${id}/retry-failed`);
  },
};

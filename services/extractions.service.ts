import { apiClient } from '@/lib/api';
import type { Extraction, CreateExtractionRequest } from '@/types/api';

export const extractionsService = {
  async getAll(projectId: string): Promise<Extraction[]> {
    return apiClient.get<Extraction[]>(`/api/v1/extractions/?project_id=${encodeURIComponent(projectId)}`);
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

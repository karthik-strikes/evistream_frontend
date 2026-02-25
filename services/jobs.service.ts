import { apiClient } from '@/lib/api';
import type { Job } from '@/types/api';

export const jobsService = {
  async getAll(projectId?: string): Promise<Job[]> {
    const url = projectId
      ? `/api/v1/jobs/?project_id=${encodeURIComponent(projectId)}`
      : '/api/v1/jobs/';
    return apiClient.get<Job[]>(url);
  },

  async getById(id: string): Promise<Job> {
    return apiClient.get<Job>(`/api/v1/jobs/${id}`);
  },

  async getStatus(id: string): Promise<Job> {
    return apiClient.get<Job>(`/api/v1/jobs/${id}/status`);
  },

  async cancel(id: string): Promise<{ message: string; status: string }> {
    return apiClient.post<{ message: string; status: string }>(`/api/v1/jobs/${id}/cancel`);
  },
};

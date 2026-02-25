import { apiClient } from '@/lib/api';
import type { Project, CreateProjectRequest } from '@/types/api';

export const projectsService = {
  async getAll(): Promise<Project[]> {
    return apiClient.get<Project[]>('/api/v1/projects/');
  },

  async getById(id: string): Promise<Project> {
    return apiClient.get<Project>(`/api/v1/projects/${id}`);
  },

  async create(data: CreateProjectRequest): Promise<Project> {
    return apiClient.post<Project>('/api/v1/projects/', data);
  },

  async update(id: string, data: Partial<CreateProjectRequest>): Promise<Project> {
    return apiClient.put<Project>(`/api/v1/projects/${id}`, data);
  },

  async delete(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/projects/${id}`);
  },
};

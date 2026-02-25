import { apiClient } from '@/lib/api';
import type { Form, CreateFormRequest } from '@/types/api';

export const formsService = {
  async getAll(projectId: string): Promise<Form[]> {
    return apiClient.get<Form[]>(`/api/v1/forms/?project_id=${encodeURIComponent(projectId)}`);
  },

  async getById(id: string): Promise<Form> {
    return apiClient.get<Form>(`/api/v1/forms/${id}`);
  },

  async create(data: CreateFormRequest): Promise<Form> {
    return apiClient.post<Form>('/api/v1/forms/', data);
  },

  async update(id: string, data: Partial<CreateFormRequest>): Promise<Form> {
    return apiClient.put<Form>(`/api/v1/forms/${id}`, data);
  },

  async delete(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/forms/${id}`);
  },

  async generateCode(id: string): Promise<Form> {
    return apiClient.post<Form>(`/api/v1/forms/${id}/regenerate`);
  },

  async getGenerationStatus(id: string): Promise<Form> {
    return apiClient.get<Form>(`/api/v1/forms/${id}`);
  },

  async approveDecomposition(id: string): Promise<{ message: string; form_id: string; status: string }> {
    return apiClient.post<{ message: string; form_id: string; status: string }>(`/api/v1/forms/${id}/approve-decomposition`, {});
  },

  async rejectDecomposition(id: string, feedback: string): Promise<{ message: string; form_id: string; feedback: string; status: string }> {
    return apiClient.post<{ message: string; form_id: string; feedback: string; status: string }>(`/api/v1/forms/${id}/reject-decomposition`, { feedback });
  },
};

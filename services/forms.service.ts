import { apiClient } from '@/lib/api';
import type {
  Form, CreateFormRequest,
  PilotState, PilotStartResponse, PilotFeedbackResponse, PilotCompleteResponse,
  PilotFieldFeedback,
} from '@/types/api';

export const formsService = {
  async getAll(projectId: string, search?: string): Promise<Form[]> {
    const params = new URLSearchParams({ project_id: projectId });
    if (search?.trim()) {
      params.set('search', search.trim());
    }
    return apiClient.get<Form[]>(`/api/v1/forms/?${params.toString()}`);
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

  async generateCode(id: string, enableReview?: boolean): Promise<Form> {
    const params = enableReview ? '?enable_review=true' : '';
    return apiClient.post<Form>(`/api/v1/forms/${id}/regenerate${params}`);
  },

  async approveDecomposition(id: string): Promise<{ message: string; form_id: string; job_id: string; status: string }> {
    return apiClient.post<{ message: string; form_id: string; job_id: string; status: string }>(`/api/v1/forms/${id}/approve-decomposition`, {});
  },

  async rejectDecomposition(id: string, feedback: string): Promise<{ message: string; form_id: string; job_id: string; feedback: string; status: string }> {
    return apiClient.post<{ message: string; form_id: string; job_id: string; feedback: string; status: string }>(`/api/v1/forms/${id}/reject-decomposition`, { feedback });
  },

  // ── Pilot Study ─────────────────────────────────────────────────────────

  async startPilot(formId: string, documentIds?: string[], count?: number): Promise<PilotStartResponse> {
    return apiClient.post<PilotStartResponse>(`/api/v1/forms/${formId}/pilot/start`, {
      document_ids: documentIds || null,
      count: count || 3,
    });
  },

  async getPilot(formId: string): Promise<PilotState> {
    return apiClient.get<PilotState>(`/api/v1/forms/${formId}/pilot`);
  },

  async submitPilotFeedback(
    formId: string,
    iteration: number,
    feedback: Record<string, PilotFieldFeedback>,
  ): Promise<PilotFeedbackResponse> {
    return apiClient.post<PilotFeedbackResponse>(`/api/v1/forms/${formId}/pilot/feedback`, {
      iteration,
      feedback,
    });
  },

  async completePilot(formId: string): Promise<PilotCompleteResponse> {
    return apiClient.post<PilotCompleteResponse>(`/api/v1/forms/${formId}/pilot/complete`, {});
  },

  async resetPilot(formId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/forms/${formId}/pilot`);
  },
};

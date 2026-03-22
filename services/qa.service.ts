import { apiClient } from '@/lib/api';
import type { QAReview, QADashboard } from '@/types/api';

export const qaService = {
  async generateSample(data: {
    project_id: string;
    form_id: string;
    sample_percentage?: number;
  }): Promise<{ sampled: number; reviews: QAReview[] }> {
    return apiClient.post('/api/v1/qa/sample', data);
  },

  async getQueue(projectId: string, formId: string): Promise<QAReview[]> {
    return apiClient.get<QAReview[]>(
      `/api/v1/qa/queue?project_id=${projectId}&form_id=${formId}`
    );
  },

  async save(data: {
    project_id: string;
    form_id: string;
    document_id: string;
    source_result_id?: string;
    source_adjudication_id?: string;
    status: string;
    field_comments: Record<string, any>;
    overall_comment?: string;
  }): Promise<QAReview> {
    return apiClient.post<QAReview>('/api/v1/qa/save', data);
  },

  async get(documentId: string, projectId: string, formId: string): Promise<QAReview | null> {
    try {
      return await apiClient.get<QAReview>(
        `/api/v1/qa/${documentId}?project_id=${projectId}&form_id=${formId}`
      );
    } catch {
      return null;
    }
  },

  async getDashboard(projectId: string, formId: string): Promise<QADashboard> {
    return apiClient.get<QADashboard>(
      `/api/v1/qa/dashboard?project_id=${projectId}&form_id=${formId}`
    );
  },

  async resolveFlag(qaId: string, fieldName: string, resolvedBy: string): Promise<QAReview> {
    return apiClient.patch<QAReview>(
      `/api/v1/qa/${qaId}/resolve-flag`,
      { field_name: fieldName, resolved_by: resolvedBy }
    );
  },
};

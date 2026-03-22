import { apiClient } from '@/lib/api';
import type { AdjudicationComparison, AdjudicationResult, AdjudicationSummary } from '@/types/api';

export const adjudicationService = {
  async compare(projectId: string, formId: string, documentId: string): Promise<AdjudicationComparison> {
    return apiClient.get<AdjudicationComparison>(
      `/api/v1/adjudication/compare?project_id=${projectId}&form_id=${formId}&document_id=${documentId}`
    );
  },

  async resolve(data: {
    project_id: string;
    form_id: string;
    document_id: string;
    reviewer_1_result_id?: string;
    reviewer_2_result_id?: string;
    field_resolutions: Record<string, any>;
    status?: string;
  }): Promise<AdjudicationResult> {
    return apiClient.post<AdjudicationResult>('/api/v1/adjudication/resolve', data);
  },

  async get(documentId: string, projectId: string, formId: string): Promise<AdjudicationResult | null> {
    try {
      return await apiClient.get<AdjudicationResult>(
        `/api/v1/adjudication/${documentId}?project_id=${projectId}&form_id=${formId}`
      );
    } catch {
      return null;
    }
  },

  async getSummary(projectId: string, formId: string): Promise<AdjudicationSummary> {
    return apiClient.get<AdjudicationSummary>(
      `/api/v1/adjudication/summary?project_id=${projectId}&form_id=${formId}`
    );
  },
};

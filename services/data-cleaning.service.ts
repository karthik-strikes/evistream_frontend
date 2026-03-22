import { apiClient } from '@/lib/api';
import type { DataCleaningRow, ValidationRule, DataViolation, BulkEditRequest } from '@/types/api';

export const dataCleaningService = {
  async getGrid(projectId: string, formId: string): Promise<DataCleaningRow[]> {
    return apiClient.get<DataCleaningRow[]>(
      `/api/v1/data-cleaning/grid?project_id=${projectId}&form_id=${formId}`
    );
  },

  async validate(projectId: string, formId: string): Promise<DataViolation[]> {
    return apiClient.post<DataViolation[]>(
      `/api/v1/data-cleaning/validate?project_id=${projectId}&form_id=${formId}`,
      {}
    );
  },

  async bulkEdit(data: BulkEditRequest): Promise<{ updated: number; errors: any[] }> {
    return apiClient.post('/api/v1/data-cleaning/bulk-edit', data);
  },

  async listRules(formId: string): Promise<ValidationRule[]> {
    return apiClient.get<ValidationRule[]>(`/api/v1/data-cleaning/rules?form_id=${formId}`);
  },

  async createRule(data: {
    form_id: string;
    field_name: string;
    rule_type: string;
    rule_config: Record<string, any>;
    severity: string;
    message: string;
  }): Promise<ValidationRule> {
    return apiClient.post<ValidationRule>('/api/v1/data-cleaning/rules', data);
  },

  async updateRule(ruleId: string, data: {
    rule_config?: Record<string, any>;
    severity?: string;
    message?: string;
    is_active?: boolean;
  }): Promise<ValidationRule> {
    return apiClient.put<ValidationRule>(`/api/v1/data-cleaning/rules/${ruleId}`, data);
  },

  async deleteRule(ruleId: string): Promise<void> {
    await apiClient.delete(`/api/v1/data-cleaning/rules/${ruleId}`);
  },

  async exportData(projectId: string, formId: string, format: 'csv' | 'json' = 'csv'): Promise<Blob> {
    const token = apiClient.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(
      `/api/v1/data-cleaning/export?project_id=${projectId}&form_id=${formId}&format=${format}`,
      { headers }
    );
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);
    return response.blob();
  },
};

import { apiClient } from '@/lib/api';

export interface DashboardStats {
  stats: { documents: number; forms: number; extractions: number; results: number };
  form_counts: Record<string, number>;
  extraction_status_counts: Record<string, number>;
  recent_extractions: Array<{
    id: string; status: string; form_id: string; form_name: string;
    created_at: string; result_count: number; doc_name: string; fields_filled: number; total_fields: number;
  }>;
  projects_overview: Array<{
    id: string; name: string; description: string;
    created_at: string; document_count: number; form_count: number;
  }>;
}

export const dashboardService = {
  async getStats(projectId: string): Promise<DashboardStats> {
    return apiClient.get<DashboardStats>(
      `/api/v1/dashboard/stats?project_id=${encodeURIComponent(projectId)}`
    );
  },
};

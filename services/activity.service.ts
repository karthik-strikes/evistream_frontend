import { apiClient } from '@/lib/api';
import type { Activity } from '@/types/api';

interface GetActivitiesParams {
  project_id?: string;
  action_type?: string;
  date_range?: 'today' | 'week' | 'month' | 'all';
  limit?: number;
  offset?: number;
}

export const activityService = {
  async getAll(params?: GetActivitiesParams): Promise<Activity[]> {
    const queryParams = new URLSearchParams();

    if (params?.project_id) queryParams.append('project_id', params.project_id);
    if (params?.action_type) queryParams.append('action_type', params.action_type);
    if (params?.date_range) queryParams.append('date_range', params.date_range);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const url = `/api/v1/activities/${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    return apiClient.get<Activity[]>(url);
  },

  async getById(id: string): Promise<Activity> {
    return apiClient.get<Activity>(`/api/v1/activities/${id}`);
  },
};

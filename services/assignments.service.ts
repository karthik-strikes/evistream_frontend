import { apiClient } from '@/lib/api';
import type {
  ReviewAssignment, BulkAssignmentCreate, AutoAssignRequest, AssignmentProgress,
} from '@/types/api';

export const assignmentsService = {
  async bulkCreate(data: BulkAssignmentCreate): Promise<ReviewAssignment[]> {
    return apiClient.post<ReviewAssignment[]>('/api/v1/assignments/bulk', data);
  },

  async autoAssign(data: AutoAssignRequest): Promise<ReviewAssignment[]> {
    return apiClient.post<ReviewAssignment[]>('/api/v1/assignments/auto-assign', data);
  },

  async getMyAssignments(options: {
    projectId?: string;
    status?: string;
  } = {}): Promise<ReviewAssignment[]> {
    const params = new URLSearchParams();
    if (options.projectId) params.append('project_id', options.projectId);
    if (options.status) params.append('status', options.status);
    const qs = params.toString();
    return apiClient.get<ReviewAssignment[]>(`/api/v1/assignments/my${qs ? `?${qs}` : ''}`);
  },

  async getProjectAssignments(projectId: string, options: {
    status?: string;
  } = {}): Promise<ReviewAssignment[]> {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    const qs = params.toString();
    return apiClient.get<ReviewAssignment[]>(
      `/api/v1/assignments/project/${projectId}${qs ? `?${qs}` : ''}`
    );
  },

  async updateStatus(assignmentId: string, status: string): Promise<ReviewAssignment> {
    return apiClient.patch<ReviewAssignment>(`/api/v1/assignments/${assignmentId}/status`, { status });
  },

  async getProgress(projectId: string): Promise<AssignmentProgress> {
    return apiClient.get<AssignmentProgress>(
      `/api/v1/assignments/progress?project_id=${projectId}`
    );
  },
};

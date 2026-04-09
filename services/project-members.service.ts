import { apiClient } from '@/lib/api';
import type { ProjectMember, ProjectMemberInvite, ProjectMemberUpdate, MyPermissionsResponse } from '@/types/api';

export const projectMembersService = {
  async listMembers(projectId: string): Promise<ProjectMember[]> {
    return apiClient.get<ProjectMember[]>(`/api/v1/projects/${projectId}/members`);
  },

  async inviteMember(projectId: string, data: ProjectMemberInvite): Promise<ProjectMember> {
    return apiClient.post<ProjectMember>(`/api/v1/projects/${projectId}/members`, data);
  },

  async updateMember(projectId: string, userId: string, data: ProjectMemberUpdate): Promise<ProjectMember> {
    return apiClient.patch<ProjectMember>(`/api/v1/projects/${projectId}/members/${userId}`, data);
  },

  async removeMember(projectId: string, userId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/projects/${projectId}/members/${userId}`);
  },

  async getMyPermissions(projectId: string): Promise<MyPermissionsResponse> {
    return apiClient.get<MyPermissionsResponse>(`/api/v1/projects/${projectId}/my-permissions`);
  },

  async transferOwnership(projectId: string, newOwnerId: string): Promise<{ message: string }> {
    return apiClient.post<{ message: string }>(`/api/v1/projects/${projectId}/transfer-ownership`, { new_owner_id: newOwnerId });
  },
};

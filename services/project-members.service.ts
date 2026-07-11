import { apiClient } from '@/lib/api';
import type {
  ProjectMember, ProjectMemberInvite, ProjectMemberUpdate, MyPermissionsResponse,
  ProjectInvitation, ProjectInvitationCreate, InvitationPreview,
} from '@/types/api';

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

  async transferOwnership(projectId: string, newOwnerId: string, previousOwnerRole: 'manager' | 'member' | 'viewer' | 'none' = 'manager'): Promise<{ message: string }> {
    return apiClient.post<{ message: string }>(`/api/v1/projects/${projectId}/transfer-ownership`, { new_owner_id: newOwnerId, previous_owner_role: previousOwnerRole });
  },

  // Invitation endpoints
  async listInvitations(projectId: string): Promise<ProjectInvitation[]> {
    return apiClient.get<ProjectInvitation[]>(`/api/v1/projects/${projectId}/invitations`);
  },

  async createInvitation(projectId: string, data: ProjectInvitationCreate): Promise<ProjectInvitation> {
    return apiClient.post<ProjectInvitation>(`/api/v1/projects/${projectId}/invitations`, data);
  },

  async resendInvitation(projectId: string, invitationId: string): Promise<ProjectInvitation> {
    return apiClient.post<ProjectInvitation>(`/api/v1/projects/${projectId}/invitations/${invitationId}/resend`, {});
  },

  async revokeInvitation(projectId: string, invitationId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/projects/${projectId}/invitations/${invitationId}`);
  },

  async getInvitationPreview(token: string): Promise<InvitationPreview> {
    return apiClient.get<InvitationPreview>(`/api/v1/invitations/${token}`);
  },

  async acceptInvitation(token: string): Promise<{ project_id: string; role: string }> {
    return apiClient.post<{ project_id: string; role: string }>(`/api/v1/invitations/accept`, { token });
  },

  async searchUsers(q: string): Promise<{ id: string; email: string; full_name: string | null }[]> {
    if (q.trim().length < 2) return [];
    return apiClient.get(`/api/v1/auth/users/search?q=${encodeURIComponent(q.trim())}`);
  },
};

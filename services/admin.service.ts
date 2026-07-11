import { apiClient } from '@/lib/api';
import type { User, AdminUserUpdate, AdminStats, AdminUsersResponse, PermissionAuditLog, AdminAuditLogResponse } from '@/types/api';

export const adminService = {
  async listUsers(page = 1, pageSize = 20): Promise<AdminUsersResponse> {
    return apiClient.get<AdminUsersResponse>(
      `/api/v1/admin/users?page=${page}&page_size=${pageSize}`
    );
  },

  async getUser(userId: string): Promise<User> {
    return apiClient.get<User>(`/api/v1/admin/users/${userId}`);
  },

  async updateUser(userId: string, updates: AdminUserUpdate): Promise<User> {
    return apiClient.patch<User>(`/api/v1/admin/users/${userId}`, updates);
  },

  async deleteUser(userId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/admin/users/${userId}`);
  },

  async getStats(): Promise<AdminStats> {
    return apiClient.get<AdminStats>('/api/v1/admin/stats');
  },

  async listProjects(page = 1, pageSize = 20): Promise<{ projects: any[]; total: number; page: number; page_size: number }> {
    return apiClient.get(`/api/v1/admin/projects?page=${page}&page_size=${pageSize}`);
  },

  async getPermissionAuditLog(projectId: string, limit = 50): Promise<PermissionAuditLog[]> {
    return apiClient.get<PermissionAuditLog[]>(`/api/v1/admin/projects/${projectId}/audit-log?limit=${limit}`);
  },

  async listAuditLog(page = 1, pageSize = 20): Promise<AdminAuditLogResponse> {
    return apiClient.get<AdminAuditLogResponse>(
      `/api/v1/admin/audit-log?page=${page}&page_size=${pageSize}`
    );
  },

  async createUser(email: string, fullName: string, role: 'admin' | 'user', password: string): Promise<User> {
    return apiClient.post<User>('/api/v1/admin/users', { email, full_name: fullName || undefined, role, password });
  },
};

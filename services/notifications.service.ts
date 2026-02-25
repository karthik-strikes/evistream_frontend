import { apiClient } from '@/lib/api';
import type { Notification } from '@/types/api';

export const notificationsService = {
  async getAll(unreadOnly: boolean = false): Promise<Notification[]> {
    const url = `/api/v1/notifications/${unreadOnly ? '?unread_only=true' : ''}`;
    return apiClient.get<Notification[]>(url);
  },

  async getById(id: string): Promise<Notification> {
    return apiClient.get<Notification>(`/api/v1/notifications/${id}`);
  },

  async markAsRead(id: string): Promise<Notification> {
    return apiClient.patch<Notification>(`/api/v1/notifications/${id}/read`);
  },

  async markAllAsRead(): Promise<{ message: string; count: number }> {
    return apiClient.post<{ message: string; count: number }>('/api/v1/notifications/mark-all-read');
  },

  async deleteNotification(id: string): Promise<{ message: string }> {
    return apiClient.delete<{ message: string }>(`/api/v1/notifications/${id}`);
  },

  async deleteAll(): Promise<{ message: string; count: number }> {
    return apiClient.delete<{ message: string; count: number }>('/api/v1/notifications');
  },

  async getUnreadCount(): Promise<{ count: number }> {
    return apiClient.get<{ count: number }>('/api/v1/notifications/unread-count');
  },
};

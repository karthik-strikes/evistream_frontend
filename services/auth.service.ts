import { apiClient } from '@/lib/api';
import type { LoginRequest, RegisterRequest, AuthResponse, User } from '@/types/api';

export const authService = {
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>('/api/v1/auth/login', credentials);
    if (response.access_token) {
      apiClient.setToken(response.access_token, response.refresh_token);
    }
    return response;
  },

  async register(data: RegisterRequest): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>('/api/v1/auth/register', data);
    if (response.access_token) {
      apiClient.setToken(response.access_token, response.refresh_token);
    }
    return response;
  },

  async getCurrentUser(): Promise<User> {
    return apiClient.get<User>('/api/v1/auth/me');
  },

  async updateProfile(data: { full_name?: string; email?: string }): Promise<User> {
    return apiClient.patch<User>('/api/v1/auth/me', data);
  },

  async changePassword(data: { current_password: string; new_password: string }): Promise<void> {
    await apiClient.post('/api/v1/auth/change-password', data);
  },

  async forgotPassword(email: string): Promise<void> {
    await apiClient.post('/api/v1/auth/forgot-password', { email });
  },

  async resetPassword(token: string, new_password: string): Promise<void> {
    await apiClient.post('/api/v1/auth/reset-password', { token, new_password });
  },

  logout(): void {
    apiClient.clearToken();
    if (typeof window !== 'undefined') {
      document.cookie = 'user_role=; path=/; max-age=0; SameSite=Strict';
      window.location.href = '/login';
    }
  },
};

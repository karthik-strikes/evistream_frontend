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

  logout(): void {
    apiClient.clearToken();
    if (typeof window !== 'undefined') {
      document.cookie = 'user_role=; path=/; max-age=0; SameSite=Strict';
      window.location.href = '/login';
    }
  },
};

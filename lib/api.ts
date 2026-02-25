import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

// Use relative URL so requests go through Next.js rewrite proxy (next.config.js)
// This avoids CORS and port-forwarding issues
const API_BASE_URL = '';

/**
 * API Client with authentication
 */
class APIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use((config) => {
      const token = this.getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          const requestUrl = error.config?.url || '';
          const isAuthRequest = requestUrl.includes('/auth/');
          if (typeof window !== 'undefined' && window.location.pathname !== '/login' && !isAuthRequest) {
            this.clearToken();
            window.location.href = '/login';
            return new Promise(() => {}); // Prevent downstream error handlers during redirect
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem('auth_token');
  }

  private clearToken(): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem('auth_token');
    document.cookie = 'is_logged_in=; path=/; max-age=0; SameSite=Strict';
  }

  public setToken(token: string): void {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem('auth_token', token);
    document.cookie = 'is_logged_in=1; path=/; SameSite=Strict';
  }

  // HTTP Methods
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  async patch<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.patch<T>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }
}

export const apiClient = new APIClient();

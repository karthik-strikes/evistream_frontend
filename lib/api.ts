import axios, { AxiosInstance, AxiosRequestConfig, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { toast } from '@/hooks/use-toast';
import { clientLogger } from '@/lib/client-logger';

// Use relative URL so requests go through Next.js rewrite proxy (next.config.js)
const API_BASE_URL = '';

// In-memory token storage — primary store; localStorage is the persistence layer
let _accessToken: string | null = null;
let _refreshToken: string | null = null;

// Prevent multiple concurrent 401 responses from triggering duplicate redirects
let isRedirecting = false;

// Prevent multiple concurrent refresh attempts — shared promise deduplication
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

// Proactive refresh timer — fires 60 s before access token expiry
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Decode JWT expiry (exp claim) in ms — no verification needed here */
function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Returns true if the access token expires within `thresholdMs` milliseconds */
function isTokenExpiringSoon(token: string, thresholdMs = 60_000): boolean {
  const exp = getTokenExpiry(token);
  return exp === null || exp - Date.now() < thresholdMs;
}

/** Persistent cookie helpers — max-age matches 7-day refresh token */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

function setLoginCookie() {
  if (typeof window === 'undefined') return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `is_logged_in=1; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Strict${secure}`;
}

function clearLoginCookie() {
  if (typeof window === 'undefined') return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `is_logged_in=; path=/; max-age=0; SameSite=Strict${secure}`;
  document.cookie = `user_role=; path=/; max-age=0; SameSite=Strict`;
}

/**
 * API Client with authentication, proactive token refresh, and error toasts
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

    // Hydrate in-memory tokens from localStorage on init (survives browser restarts)
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem('auth_token')
        ?? sessionStorage.getItem('auth_token'); // migrate legacy sessionStorage entries
      if (storedToken) {
        _accessToken = storedToken;
        // Migrate to localStorage if it was only in sessionStorage
        localStorage.setItem('auth_token', storedToken);
        sessionStorage.removeItem('auth_token');
      }

      const storedRefresh = localStorage.getItem('refresh_token')
        ?? sessionStorage.getItem('refresh_token');
      if (storedRefresh) {
        _refreshToken = storedRefresh;
        localStorage.setItem('refresh_token', storedRefresh);
        sessionStorage.removeItem('refresh_token');
      }

      // Schedule proactive refresh if we already have a valid token
      if (_accessToken) {
        this._scheduleProactiveRefresh(_accessToken);
      }
    }

    // Request interceptor — add auth header + proactive refresh
    this.client.interceptors.request.use(async (config) => {
      // If the access token is about to expire and we have a refresh token, refresh now
      // before the request goes out (avoids a visible 401 on the next call)
      if (
        _accessToken &&
        _refreshToken &&
        isTokenExpiringSoon(_accessToken) &&
        !config.url?.includes('/auth/refresh')
      ) {
        // _doRefresh deduplicates internally — safe to call from multiple requests
        await this._doRefresh();
      }

      const token = this.getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      config.headers['X-Request-Id'] = crypto.randomUUID();
      return config;
    });

    // Response interceptor — reactive refresh on 401
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        if (error.response?.status === 401 && originalRequest) {
          const requestUrl = originalRequest.url || '';

          // Only skip refresh for the actual login / register / refresh endpoints
          const isHardAuthEndpoint =
            requestUrl.includes('/auth/login') ||
            requestUrl.includes('/auth/register') ||
            requestUrl.includes('/auth/refresh');

          if (isHardAuthEndpoint) {
            return Promise.reject(error);
          }

          // Try token refresh (deduplicates via _doRefresh shared promise)
          if (!originalRequest._retry && _refreshToken) {
            originalRequest._retry = true;

            const newToken = await this._doRefresh();
            if (newToken) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              return this.client(originalRequest);
            }
            // _doRefresh failed — fall through to redirect below
          }

          // No refresh token or refresh failed — redirect to login
          const publicPaths = ['/', '/login', '/register'];
          if (typeof window !== 'undefined' && !publicPaths.includes(window.location.pathname) && !isRedirecting) {
            isRedirecting = true;
            this.clearToken();
            window.location.href = '/login';
            setTimeout(() => { isRedirecting = false; }, 2000);
            return Promise.reject(new Error('session_expired'));
          }
        }

        // Global error toast for non-401 errors
        if (typeof window !== 'undefined' && error.response?.status !== 401) {
          const httpStatus = error.response?.status;
          const data = error.response?.data as Record<string, any> | undefined;
          const message = data?.detail || error.message || 'An error occurred';

          if (httpStatus && httpStatus >= 500) {
            clientLogger.error(`API ${httpStatus}: ${error.config?.method?.toUpperCase()} ${error.config?.url}`, {
              status: httpStatus,
              message: typeof message === 'string' ? message : 'server error',
            });
          }

          if (httpStatus && httpStatus >= 400) {
            toast({
              variant: 'error',
              title: `Error${httpStatus ? ` (${httpStatus})` : ''}`,
              description: typeof message === 'string' ? message : 'An error occurred',
            });
          }
        }

        return Promise.reject(error);
      }
    );
  }

  /** Perform the actual refresh call. Returns new access token or null on failure.
   *  Deduplicates concurrent callers — all await the same in-flight promise.
   *  Retries up to 3 times with exponential backoff; skips retries on 401 (bad token). */
  private _doRefresh(): Promise<string | null> {
    // Deduplicate: if a refresh is already in-flight, piggyback on it
    if (isRefreshing && refreshPromise) {
      return refreshPromise;
    }

    isRefreshing = true;
    refreshPromise = this._executeRefresh();
    return refreshPromise;
  }

  private async _executeRefresh(): Promise<string | null> {
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/api/v1/auth/refresh`,
            {},
            { headers: { Authorization: `Bearer ${_refreshToken}` } }
          );

          const newAccessToken = response.data.access_token;
          const newRefreshToken = response.data.refresh_token;

          this.setToken(newAccessToken, newRefreshToken ?? undefined);
          return newAccessToken;
        } catch (err) {
          lastErr = err;
          // 401 means the refresh token itself is invalid — no point retrying
          const isAuthError = axios.isAxiosError(err) && err.response?.status === 401;
          if (isAuthError || attempt === MAX_ATTEMPTS) break;
          // Exponential backoff: 500 ms, 1000 ms (covers transient network blips)
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }

      console.warn('[auth] Token refresh failed:', axios.isAxiosError(lastErr) && !lastErr.response ? 'backend unreachable' : lastErr);
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  }

  /** Schedule a proactive silent refresh 60 s before the access token expires.
   *  Does NOT reschedule on failure — the next user-initiated request will retry. */
  private _scheduleProactiveRefresh(token: string) {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    if (!_refreshToken) return;

    const exp = getTokenExpiry(token);
    if (!exp) return;

    const refreshIn = exp - Date.now() - 60_000; // 60 s before expiry
    if (refreshIn <= 0) {
      // Already expired or about to — refresh immediately (once)
      this._doRefresh();
      return;
    }

    _refreshTimer = setTimeout(async () => {
      if (_refreshToken) {
        const newToken = await this._doRefresh();
        // Only reschedule if refresh succeeded — avoids retry loop when backend is down
        if (newToken) this._scheduleProactiveRefresh(newToken);
      }
    }, refreshIn);
  }

  getToken(): string | null {
    return _accessToken;
  }

  getRefreshToken(): string | null {
    return _refreshToken;
  }

  clearToken(): void {
    _accessToken = null;
    _refreshToken = null;
    if (_refreshTimer) {
      clearTimeout(_refreshTimer);
      _refreshTimer = null;
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      // Clean up legacy sessionStorage entries
      sessionStorage.removeItem('auth_token');
      sessionStorage.removeItem('refresh_token');
      clearLoginCookie();
    }
  }

  setToken(token: string, refreshToken?: string): void {
    _accessToken = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
      setLoginCookie();
    }
    if (refreshToken) {
      _refreshToken = refreshToken;
      if (typeof window !== 'undefined') {
        localStorage.setItem('refresh_token', refreshToken);
      }
    }
    // Always reschedule proactive refresh after a new token is set
    this._scheduleProactiveRefresh(token);
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

import { apiClient } from '@/lib/api';

export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  environment: string;
}

export const healthService = {
  async check(): Promise<HealthResponse> {
    return apiClient.get<HealthResponse>('/api/v1/health');
  },

  async isBackendConnected(): Promise<boolean> {
    try {
      await healthService.check();
      return true;
    } catch {
      return false;
    }
  },
};

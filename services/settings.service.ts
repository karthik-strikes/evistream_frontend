import { apiClient } from '@/lib/api';

export interface UserSettings {
  id: string;
  user_id: string;
  export_format: string;
  export_date_format: string;
  export_include_metadata: boolean;
  export_include_confidence: boolean;
  notify_email: boolean;
  notify_browser: boolean;
  notify_extraction_completed: boolean;
  notify_extraction_failed: boolean;
  notify_code_generation: boolean;
  created_at: string;
  updated_at: string;
}

export type UserSettingsUpdate = Partial<Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

class SettingsService {
  async getSettings(): Promise<UserSettings> {
    return apiClient.get<UserSettings>('/api/v1/settings');
  }

  async updateSettings(data: UserSettingsUpdate): Promise<UserSettings> {
    return apiClient.patch<UserSettings>('/api/v1/settings', data);
  }
}

export const settingsService = new SettingsService();

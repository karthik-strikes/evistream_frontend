import { apiClient } from '@/lib/api';
import type { Project, CreateProjectRequest } from '@/types/api';

export const projectsService = {
  /**
   * List projects. Archived projects are excluded server-side by default —
   * pass includeArchived to get them (ProjectContext does, then filters
   * locally so every consumer of `projects` stays archive-free).
   */
  async getAll(includeArchived = false): Promise<Project[]> {
    const qs = includeArchived ? '?include_archived=true' : '';
    return apiClient.get<Project[]>(`/api/v1/projects/${qs}`);
  },

  async getById(id: string): Promise<Project> {
    return apiClient.get<Project>(`/api/v1/projects/${id}`);
  },

  async create(data: CreateProjectRequest): Promise<Project> {
    return apiClient.post<Project>('/api/v1/projects/', data);
  },

  async update(id: string, data: Partial<CreateProjectRequest>): Promise<Project> {
    return apiClient.put<Project>(`/api/v1/projects/${id}`, data);
  },

  async updateReviewSettings(id: string, data: { blinding: 'none' | 'partial' | 'full'; hide_ai_results: boolean }): Promise<{ review_settings: { blinding: string; hide_ai_results: boolean } }> {
    return apiClient.patch(`/api/v1/projects/${id}/review-settings`, data);
  },

  /**
   * Set the project's review scope — context injected into every extraction
   * prompt. Pass null to clear. Requires can_create_forms server-side.
   */
  async updateReviewScope(id: string, review_scope: string | null): Promise<{ review_scope: string | null }> {
    return apiClient.patch(`/api/v1/projects/${id}/review-scope`, { review_scope });
  },

  /** Hide the project and make it read-only. Owner/admin/manager only. */
  async archive(id: string): Promise<Project> {
    return apiClient.post<Project>(`/api/v1/projects/${id}/archive`, {});
  },

  /** Restore an archived project, making it writable again. */
  async unarchive(id: string): Promise<Project> {
    return apiClient.post<Project>(`/api/v1/projects/${id}/unarchive`, {});
  },

  async delete(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/projects/${id}`);
  },
};

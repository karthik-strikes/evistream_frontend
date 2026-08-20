import { apiClient } from '@/lib/api';
import type { Project, CreateProjectRequest } from '@/types/api';
import type { ReviewScopeStructured } from '@/lib/reviewScope';

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
  /**
   * Writes both scope columns at once. `review_scope` is the prose extraction
   * reads; `review_scope_structured` is the guided builder's chips. Passing
   * null for the chips (what a free-text save does) clears them server-side,
   * so the two can never describe different scopes.
   */
  async updateReviewScope(
    id: string,
    review_scope: string | null,
    review_scope_structured: ReviewScopeStructured | null = null,
  ): Promise<{ review_scope: string | null; review_scope_structured: ReviewScopeStructured | null }> {
    return apiClient.patch(`/api/v1/projects/${id}/review-scope`, {
      review_scope,
      review_scope_structured,
    });
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

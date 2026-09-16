import { apiClient } from '@/lib/api';
import type { AuditEntry } from '@/types/api';

export const auditService = {
  async getTrail(options: {
    projectId?: string;
    entityType?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<AuditEntry[]> {
    const params = new URLSearchParams();
    if (options.projectId) params.append('project_id', options.projectId);
    if (options.entityType) params.append('entity_type', options.entityType);
    if (options.userId) params.append('user_id', options.userId);
    if (options.limit) params.append('limit', String(options.limit));
    if (options.offset) params.append('offset', String(options.offset));
    const qs = params.toString();
    return apiClient.get<AuditEntry[]>(`/api/v1/audit${qs ? `?${qs}` : ''}`);
  },

  /** Full audit history for one entity.
   *
   *  `projectId` is required: the endpoint checks access against it AND now
   *  filters on it. Before that, an entity id from another project returned
   *  that project's history to anyone who could name it. */
  async getEntityHistory(
    entityType: string,
    entityId: string,
    projectId: string,
  ): Promise<AuditEntry[]> {
    const qs = new URLSearchParams({ project_id: projectId }).toString();
    return apiClient.get<AuditEntry[]>(
      `/api/v1/audit/entity/${entityType}/${entityId}?${qs}`,
    );
  },
};

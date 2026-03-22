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

  async getEntityHistory(entityType: string, entityId: string): Promise<AuditEntry[]> {
    return apiClient.get<AuditEntry[]>(`/api/v1/audit/entity/${entityType}/${entityId}`);
  },
};

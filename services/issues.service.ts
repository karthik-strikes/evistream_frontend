import { apiClient } from '@/lib/api';
import type { CreateIssueRequest, IssueReport } from '@/types/api';

export const issuesService = {
  async create(data: CreateIssueRequest): Promise<IssueReport> {
    return apiClient.post<IssueReport>('/api/v1/issues', data);
  },
};

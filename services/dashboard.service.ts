import { apiClient } from '@/lib/api';

export interface DashboardStats {
  stats: { documents: number; forms: number; extractions: number; results: number };
  form_counts: Record<string, number>;
  extraction_status_counts: Record<string, number>;
  recent_extractions: Array<{
    id: string; status: string; form_id: string; form_name: string;
    created_at: string; result_count: number; doc_name: string; fields_filled: number; total_fields: number;
  }>;
  projects_overview: Array<{
    id: string; name: string; description: string;
    created_at: string; document_count: number; form_count: number;
  }>;
}

export const dashboardService = {
  async getStats(projectId: string): Promise<DashboardStats> {
    return apiClient.get<DashboardStats>(
      `/api/v1/dashboard/stats?project_id=${encodeURIComponent(projectId)}`
    );
  },
};

import type { HomeEnvelope } from '@/types/home';

export type HomeSection = 'context' | 'forms' | 'work' | 'rob' | 'synthesis' | 'nav';

export const homeService = {
  /** One Project Home section. A server failure is a thrown error, never a
   *  200 with zeros — the section renders Retry, not "0". */
  async getSection<T>(projectId: string, section: HomeSection): Promise<HomeEnvelope<T>> {
    return apiClient.get<HomeEnvelope<T>>(
      `/api/v1/dashboard/home/${section}?project_id=${encodeURIComponent(projectId)}`
    );
  },
};

export type ProjectWorkKind = 'personal' | 'attention' | 'none' | 'viewonly' | 'archived';

export interface ProjectCardSummary {
  project_id: string;
  documents: { total: number; ready: number; need_source: number };
  forms: { active: number; in_setup: number; awaiting_review: number; failed: number };
  my_open: number;
  last_activity_at: string | null;
  activity_at: string | null;
  // Work model — one definition for the card work line, header counts and sort
  // (backend `summarize_work`, the same payload Home's My work renders).
  extraction_count: number;
  consensus_count: number;
  rob_count: number;
  synthesis_approval_count: number;
  attention_count: number;
  attention_labels: string[];
  work_kind: ProjectWorkKind | null;
  work_status: 'ready' | 'error';
}

export const projectsSummaryService = {
  /** Card counts for every project the caller can open (archived included). */
  async getAll(): Promise<{ generated_at: string; projects: ProjectCardSummary[] }> {
    return apiClient.get('/api/v1/dashboard/projects-summary');
  },
};

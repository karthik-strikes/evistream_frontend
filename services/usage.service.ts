import { apiClient } from '@/lib/api';

export interface UsageSummary {
  window_days: number;
  total_calls: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_cache_creation_input_tokens?: number;
  total_cache_read_input_tokens?: number;
  total_cost_usd: number;
  cache_savings_usd?: number;
  cache_hit_rate_pct: number;
  unpriced_calls: number;
}

export interface UsageBreakdownRow {
  key: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cache_hits: number;
  cache_hit_rate_pct: number;
}

export interface UsageBreakdown {
  group_by: 'model' | 'source' | 'day' | 'schema';
  window_days: number;
  rows: UsageBreakdownRow[];
}

export interface UsageByRunRow {
  extraction_id: string;
  started_at: string | null;
  /** Wall clock: run start → last recorded call. */
  elapsed_seconds?: number | null;
  /** Sum of individual call durations — larger than elapsed, since papers run in parallel. */
  model_time_seconds?: number | null;
  /** Calls whose answer was discarded and re-asked (0 for runs predating labels). */
  wasted_calls?: number;
  wasted_cost_usd?: number;
  project_id: string | null;
  project_name: string;
  form_id: string | null;
  form_name: string;
  schema_name: string | null;
  has_table_field: boolean;
  pdf_count: number;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  avg_tokens_per_pdf: number | null;
  models: string[];
}

export interface UsageByRun {
  window_days: number;
  rows: UsageByRunRow[];
}

/** One LLM call. The label fields (step … duration_ms) are written at flush time
 *  by backend/utils/llm_call_labels.py and are absent on rows recorded before
 *  that shipped — the UI falls back to a flat list when `step` is missing. */
export interface UsageCallRow {
  id: string;
  timestamp: string | null;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cost_usd: number;
  cache_savings_usd?: number;
  cache_hit: boolean;
  source_file: string | null;
  schema_name: string | null;
  signature: string | null;
  /** record_discovery | recall_audit | slot_fill | slot_fill_row | refill | extract */
  step?: string | null;
  /** Record discovery found nothing for this paper, so the pipeline stopped here. */
  stopped?: boolean;
  document_id?: string | null;
  filename?: string | null;
  field_name?: string | null;
  /** Records carried by this call (rows sent to fill / audited). */
  n_records?: number | null;
  attempt?: number | null;
  attempts_total?: number | null;
  /** True when a later attempt replaced this one — its cost bought nothing. */
  superseded?: boolean;
  superseded_reason?: string | null;
  response_shape?: string | null;
  duration_ms?: number | null;
  transport?: string | null;
  num_turns?: number | null;
}

export interface UsageCalls {
  window_days: number;
  schema_name: string | null;
  extraction_id?: string | null;
  /** False when the rows were matched by time window rather than by run id. */
  exact?: boolean;
  rows: UsageCallRow[];
}

export interface UsageByProjectModel {
  model: string;
  cost_usd: number;
  tokens: number;
  calls: number;
}

export interface UsageByProjectForm {
  form_id: string | null;
  form_name: string;
  cost_usd: number;
  codegen_cost_usd: number;
  total_tokens: number;
  unique_pdfs: number;
}

export interface UsageByProjectRun {
  job_id: string;
  form_id: string | null;
  form_name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  pdf_count: number;
  cost_usd: number;
  total_tokens: number;
  models: string[];
  cost_exact: boolean;
}

export interface UsageByProjectRow {
  project_id: string;
  project_name: string;
  extraction_cost_usd: number;
  codegen_cost_usd: number;
  total_cost_usd: number;
  total_tokens: number;
  total_duration_seconds: number;
  runs: number;
  successful_runs: number;
  failed_runs: number;
  cancelled_runs: number;
  running_runs: number;
  unique_pdfs: number;
  pdf_runs: number;
  models: UsageByProjectModel[];
  forms: UsageByProjectForm[];
  run_list: UsageByProjectRun[];
}

export interface UsageByProject {
  window_days: number;
  rows: UsageByProjectRow[];
}

export const usageService = {
  async getSummary(days = 30): Promise<UsageSummary> {
    return apiClient.get<UsageSummary>(`/api/v1/usage/summary?days=${days}`);
  },
  async getBreakdown(
    groupBy: 'model' | 'source' | 'day' | 'schema' = 'model',
    days = 30
  ): Promise<UsageBreakdown> {
    return apiClient.get<UsageBreakdown>(
      `/api/v1/usage/breakdown?group_by=${groupBy}&days=${days}`
    );
  },
  async getByRuns(days = 30): Promise<UsageByRun> {
    return apiClient.get<UsageByRun>(`/api/v1/usage/by-run?days=${days}`);
  },
  async getCalls(opts: { schemaName?: string; extractionId?: string; jobId?: string; since?: string; until?: string; days?: number; limit?: number } = {}): Promise<UsageCalls> {
    const params = new URLSearchParams();
    if (opts.schemaName) params.set('schema_name', opts.schemaName);
    // Exact run filters. since/until are still sent so the backend can fall back
    // to the time window for runs recorded before extraction_id was stamped.
    if (opts.extractionId) params.set('extraction_id', opts.extractionId);
    if (opts.jobId) params.set('job_id', opts.jobId);
    if (opts.since) params.set('since', opts.since);
    if (opts.until) params.set('until', opts.until);
    params.set('days', String(opts.days ?? 30));
    params.set('limit', String(opts.limit ?? 500));
    return apiClient.get<UsageCalls>(`/api/v1/usage/calls?${params.toString()}`);
  },
  async getByProject(opts: { projectId?: string; days?: number } = {}): Promise<UsageByProject> {
    const params = new URLSearchParams();
    if (opts.projectId) params.set('project_id', opts.projectId);
    params.set('days', String(opts.days ?? 365));
    return apiClient.get<UsageByProject>(`/api/v1/usage/by-project?${params.toString()}`);
  },
};

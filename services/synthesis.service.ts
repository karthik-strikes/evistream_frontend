import { apiClient } from '@/lib/api';

export interface MappingColumn {
  name: string;
  type: string;
  description?: string;
  options?: string[];
}

/**
 * The backend's proposal for how a form's table maps onto analysis roles.
 *
 * `slots` has already been validated server-side: every column named here exists
 * in the form, no column is mapped twice, and label columns have been refused
 * for measurement roles. `dropped` says what was thrown away, `warnings` what was
 * kept but is worth a second look. Nothing is applied until the reviewer confirms.
 */
export interface MappingSuggestion {
  form_id: string;
  form_name: string;
  field_name: string | null;
  columns: MappingColumn[];
  verdict:
    | 'dichotomous' | 'continuous' | 'effect' | 'proportion' | 'correlation'
    | 'diagnostic_accuracy' | 'not_poolable';
  layout: 'wide' | 'long' | null;
  slots: Record<string, string>;
  variability_measure_column: string | null;
  comparator_value: string | null;
  reasoning: string;
  per_slot_reasoning: Record<string, string>;
  missing_slots: string[];
  partial: boolean;
  dropped: string[];
  warnings: string[];
  source: 'llm' | 'heuristic' | 'deterministic';
  cached: boolean;
}

export const synthesisService = {
  async suggestMapping(
    formId: string,
    options: { fieldName?: string; force?: boolean } = {},
  ): Promise<MappingSuggestion> {
    return apiClient.post<MappingSuggestion>('/api/v1/synthesis/suggest-mapping', {
      form_id: formId,
      field_name: options.fieldName ?? null,
      force: options.force ?? false,
    });
  },
};

// ── Synthesis workspace (server objects) ────────────────────────────────────
//
// Contract (SPEC.md §4 of design_handoff_synthesis): human decisions create
// state, the engine creates numbers. The client engine (lib/metaAnalysis.ts)
// computes a run and posts it; the server recomputes `dataset_hash` from the
// posted dataset (canonical JSON, sha256 — mirrored in
// app/(dashboard)/synthesis/_lib/datasetHash.ts) and refuses a mismatch.
// Every write appends a SynthesisHistoryEntry server-side.

export type SynthesisBranch = 'ma' | 'swim';
export type SynthesisKind = 'dichotomous' | 'continuous' | 'effect' | 'proportion' | 'correlation';

export interface SynthesisSourceForm {
  form_id: string;
  field_name: string | null;
  kind: SynthesisKind;
  layout: 'wide' | 'long';
  effect_scale?: 'natural' | 'log';
  mapping: Record<string, string>;
  comparator_value: string | null;
  /** Per-spread handling chosen on the mapping screen (was UnitsCard state in localStorage). */
  units: Record<string, unknown>;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export interface SynthesisPreset {
  model: 'random' | 'fixed' | 'mh' | 'peto';
  tau2: 'reml' | 'dl' | 'pm';
  ci: 'hk' | 'z';
}

export interface SynthesisDefault {
  kind: SynthesisKind;
  measure: string;
  preset: SynthesisPreset;
}

export interface PlannedAnalysis {
  id: string;
  analysis_type: 'Primary' | 'Subgroup' | 'Sensitivity' | 'MetaRegression';
  description: string;
  /** Column (subgroup) or rule key (sensitivity e.g. 'exclude_derived_sd', 'exclude_high_rob'). */
  field: string | null;
}

export interface SynthesisRoles {
  finalizer: string | null;
  approver: string | null;
  second_approval: 'optional' | 'required';
}

export interface SynthesisAmendment {
  at: string;
  by: string;
  by_name?: string | null;
  what: string;
  why: string | null;
}

export interface SynthesisProtocol {
  project_id: string;
  source_forms: SynthesisSourceForm[];
  defaults: SynthesisDefault[];
  planned_analyses: PlannedAnalysis[];
  roles: SynthesisRoles;
  confirmed_at: string | null;
  confirmed_by: string | null;
  version: number;
  history: SynthesisAmendment[];
  /** Server-computed: can the caller edit protocol / roles. */
  can_manage: boolean;
}

export type ProtocolPatch = Partial<Pick<SynthesisProtocol,
  'source_forms' | 'defaults' | 'planned_analyses' | 'roles'>> & {
  confirm?: boolean;
  /** Required once the protocol is confirmed (becomes an amendment). */
  reason?: string | null;
};

export interface SelectionRule {
  prefer_instrument: string[];
  timepoint_rule: 'closest_to' | 'latest' | 'earliest';
  timepoint_target_weeks: number | null;
  population_rule: string | null;
  tie_break: 'needs_decision';
}

export interface SynthesisTarget {
  outcome: string;
  /** Outcome labels (as extracted) that count as this outcome without a decision. */
  outcome_labels: string[];
  definition: string;
  comparison: {
    intervention: string;
    comparator: string;
    orientation: 'intervention_minus_comparator';
    sign_convention: 'negative_favours_intervention' | 'positive_favours_intervention';
  };
  population: string;
  window: { lo: number | null; hi: number | null; unit: 'weeks'; rule: string };
  selection_rule: SelectionRule;
  mid: { value: number | null; scale: string | null; source: string | null };
  measure_preference: string | null;
  source_form_id: string | null;
}

export interface SynthesisGroup {
  id: string;
  project_id: string;
  title: string;
  branch: SynthesisBranch;
  target: SynthesisTarget;
  target_confirmed_by: string | null;
  target_confirmed_at: string | null;
  protocol_version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Summary for the dashboard (server-joined, no dataset computation). */
  latest_run?: { n: number; dataset_hash: string; partial: boolean; at: string } | null;
  latest_version?: { n: number; status: 'awaiting' | 'finalized'; dataset_hash: string; at: string } | null;
}

export type DecisionKind =
  | 'eligibility' | 'instrument_match' | 'source_review' | 'transformation'
  | 'deviation' | 'pooling' | 'analysis_not_run' | 'post_hoc_add';

/** Kinds for which the server refuses an empty reason (422). */
export const REASON_REQUIRED: DecisionKind[] = ['eligibility', 'deviation', 'pooling', 'analysis_not_run'];

export interface SynthesisDecision {
  id: string;
  group_id: string;
  kind: DecisionKind;
  /** e.g. `study:<document_id>`, `study:<document_id>:transform:se_to_sd`, `analysis:<planned id>`, `group` */
  target_ref: string;
  value: Record<string, unknown>;
  reason: string | null;
  by: string;
  by_name?: string | null;
  at: string;
  revoked_at: string | null;
  provenance: Record<string, unknown> | null;
}

export interface DecisionIn {
  kind: DecisionKind;
  target_ref: string;
  value: Record<string, unknown>;
  reason?: string | null;
  provenance?: Record<string, unknown> | null;
}

export interface SynthesisRun {
  id: string;
  group_id: string;
  n: number;
  dataset_hash: string;
  dataset: unknown[];
  config: Record<string, unknown>;
  outputs: Record<string, unknown>;
  partial: boolean;
  omitted: Array<{ ref: string; label: string; why: string }>;
  engine_version: string;
  by: string;
  by_name?: string | null;
  at: string;
}

export interface RunIn {
  dataset: unknown[];
  dataset_hash: string;
  config: Record<string, unknown>;
  outputs: Record<string, unknown>;
  partial: boolean;
  omitted: Array<{ ref: string; label: string; why: string }>;
  engine_version: string;
}

export interface AuditRow {
  id: string;
  ok: boolean;
  blocking: boolean;
  warn?: boolean;
  text: string;
}

export interface SynthesisVersion {
  id: string;
  group_id: string;
  n: number;
  run_id: string;
  dataset_hash: string;
  bundle: Record<string, unknown>;
  audit: AuditRow[];
  status: 'awaiting' | 'finalized';
  finalized_by: string;
  finalized_by_name?: string | null;
  approved_by: string | null;
  approved_by_name?: string | null;
  at: string;
  superseded_by: string | null;
}

export type HistoryKind = 'human_decision' | 'deviation' | 'run' | 'finalization' | 'amendment';

export interface SynthesisHistoryEntry {
  id: string;
  group_id: string | null;
  kind: HistoryKind;
  what: string;
  reason: string | null;
  by: string;
  by_name?: string | null;
  at: string;
  provenance: Record<string, unknown> | null;
  ref_id: string | null;
}

export interface GroupBundle {
  group: SynthesisGroup;
  decisions: SynthesisDecision[];
  runs: SynthesisRun[];
  versions: SynthesisVersion[];
}

const WS = '/api/v1/synthesis';

export const synthesisWorkspaceService = {
  getProtocol: (projectId: string) =>
    apiClient.get<SynthesisProtocol>(`${WS}/protocol?project_id=${projectId}`),
  updateProtocol: (projectId: string, patch: ProtocolPatch) =>
    apiClient.put<SynthesisProtocol>(`${WS}/protocol`, { project_id: projectId, ...patch }),

  listGroups: (projectId: string) =>
    apiClient.get<SynthesisGroup[]>(`${WS}/groups?project_id=${projectId}`),
  createGroup: (projectId: string, body: { title: string; branch: SynthesisBranch; target: SynthesisTarget }) =>
    apiClient.post<SynthesisGroup>(`${WS}/groups`, { project_id: projectId, ...body }),
  getGroup: (groupId: string) =>
    apiClient.get<GroupBundle>(`${WS}/groups/${groupId}`),
  /** `confirm_target: true` stamps target_confirmed_* and logs it; editing a confirmed target needs `reason`. */
  patchGroup: (groupId: string, patch: {
    title?: string; branch?: SynthesisBranch; target?: SynthesisTarget;
    confirm_target?: boolean; reason?: string | null;
  }) => apiClient.patch<SynthesisGroup>(`${WS}/groups/${groupId}`, patch),

  addDecision: (groupId: string, d: DecisionIn) =>
    apiClient.post<SynthesisDecision>(`${WS}/groups/${groupId}/decisions`, d),
  revokeDecision: (groupId: string, decisionId: string, reason?: string | null) =>
    apiClient.post<SynthesisDecision>(`${WS}/groups/${groupId}/decisions/${decisionId}/revoke`, { reason: reason ?? null }),

  createRun: (groupId: string, run: RunIn) =>
    apiClient.post<SynthesisRun>(`${WS}/groups/${groupId}/runs`, run),

  finalize: (groupId: string, body: { run_id: string; current_hash: string; audit: AuditRow[]; bundle: Record<string, unknown> }) =>
    apiClient.post<SynthesisVersion>(`${WS}/groups/${groupId}/finalize`, body),
  approve: (groupId: string, versionId: string) =>
    apiClient.post<SynthesisVersion>(`${WS}/groups/${groupId}/versions/${versionId}/approve`, {}),

  history: (groupId: string) =>
    apiClient.get<SynthesisHistoryEntry[]>(`${WS}/groups/${groupId}/history`),
};

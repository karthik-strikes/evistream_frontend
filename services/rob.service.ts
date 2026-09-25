import { apiClient } from '@/lib/api';

// ── AI suggestions (RoB 2 signalling questions) ─────────────────────────────
//
// Contract: the AI answers signalling QUESTIONS with verified quotes; it never
// returns a judgement. Visibility is enforced server-side by
// `GET /rob/ai/drafts` — a question in `hidden` is simply not in `answers`.

export type RobAiVisibility = 'off' | 'cr_only' | 'readers_and_cr';
export type RobAiTrigger = 'opened' | 'consensus_ready' | 'manual';
export type RobAiDomainStatus = 'missing' | 'queued' | 'running' | 'done' | 'failed';
export type RobAiAnswerText = 'Yes' | 'Probably yes' | 'Probably no' | 'No' | 'No information';
export type RobAiStrength = 'Strong' | 'Partial' | 'Insufficient';

/** The extraction-cell shape, so `boxesFromLocation` and the evidence drawer read it unchanged. */
export interface RobAiSourceLocation {
  page?: number | null;
  start_char?: number | null;
  end_char?: number | null;
  matched_text?: string | null;
  confidence?: number | null;
  section?: string | null;
  grounding_method?: string | null;
  bboxes?: Array<{ page: number; bbox: [number, number, number, number] }>;
  page_width?: number;
  page_height?: number;
  [key: string]: unknown;
}

export interface RobAiQuote {
  text: string;
  page: number | null;
  source_location: RobAiSourceLocation | null;
}

export interface RobAiAnswer {
  question_id: string;
  domain: number;
  answer: RobAiAnswerText;
  quotes: RobAiQuote[];
  evidence_type: 'explicit' | 'inferred' | 'absent';
  /** Derived server-side from the verified quotes — never model-reported. */
  strength: RobAiStrength;
  rationale: string;
  /** Filled for No information: what the model looked for. */
  looked_for: string;
  conflicting: boolean;
  /** Outcome scope only: measurements / timepoints whose answer differs. */
  varies_across: Array<{ label: string; answer: string }>;
  needs_human_review: boolean;
  stripped_quotes: number;
  draft_id: string;
}

export interface RobAiDomainState {
  domain: number;
  status: RobAiDomainStatus;
  draft_id: string | null;
  model: string | null;
  created_at: string | null;
  error: string | null;
}

export interface RobAiEstimate {
  calls: number;
  paper_tokens: number;
}

export interface RobAiRunRequest {
  project_id: string;
  document_id: string;
  target_id: string;
  /** 0-based; defaults to all five. */
  domains?: number[];
  trigger: RobAiTrigger;
  force?: boolean;
}

export interface RobAiRunResponse {
  skipped?: string;
  job_id?: string;
  domains: Array<{ domain: number; scope_key: string; status: 'queued' | 'running' | 'done' | 'failed' }>;
  estimate: RobAiEstimate;
}

export interface RobAiDraftsResponse {
  visibility: RobAiVisibility;
  seat: RobSeat | 'manager' | null;
  context_mode: 'full' | 'retrieved' | null;
  domains: RobAiDomainState[];
  answers: RobAiAnswer[];
  /**
   * Retrieved mode only: questions the model could not answer from the
   * passages it was given. **Not "No information"** — that is a claim about
   * the paper; this is a fact about retrieval, and the screen says so.
   */
  not_found: string[];
  /** Question ids withheld from this caller. */
  hidden: string[];
  hidden_reason: 'cr_only' | 'answer_first' | null;
  estimate: RobAiEstimate;
}

export interface RobAiExportRow {
  study_label: string;
  document_id: string;
  target_id: string;
  scope: string;
  seat: string | null;
  person: string | null;
  domain: number;
  question_id: string;
  ai_answer: string | null;
  strength: string | null;
  human_answer: string | null;
  final_answer: string | null;
  action: string | null;
  reason: string | null;
  judgement_ai: string | null;
  judgement_final: string | null;
  model: string | null;
  prompt_version: string | null;
  draft_id: string | null;
  at: string | null;
}

// ── The result registry ──────────────────────────────────────────────────────

/** A study-specific, directed comparison. Two fields, never one "X vs Y" string. */
export interface RobContrast {
  id: string;
  project_id: string;
  document_id: string;
  /** The study's arm names, on an unresolved contrast — what a person picks from. */
  arms?: string[];
  /** The one arm that reads as a control, pre-filling the comparator. */
  suggested_comparator?: string;
  intervention: string;
  comparator: string;
  /** Groups equivalents for synthesis only. No result points at it. */
  canonical_key: string | null;
  state: 'auto' | 'proposed' | 'confirmed' | 'unresolved';
  source: string;
}

/**
 * One numerical result — what a RoB 2 assessment is actually about.
 *
 * Eight slots, because eight things can differ while the other seven match.
 * Two results of one trial can share study, contrast, outcome and timepoint and
 * still be different results: a responder proportion and a mean, or an
 * intention-to-treat estimate and a per-protocol one.
 */
export interface RobResult {
  id: string;
  project_id: string;
  document_id: string;
  contrast_id: string | null;
  contrast?: RobContrast | null;
  population: string;
  outcome_domain: string;
  measurement: string;
  timepoint: string;
  analysis_population: string;
  analysis: string;
  estimate: string;
  source_form_id: string | null;
  source_ref: Record<string, unknown>;
  /** `held` = an unresolved duplicate, deliberately kept out of the queue. */
  state: 'active' | 'held' | 'merged';
  merged_into: string | null;
  /** Bumped when an identity slot changes; an assessment records what it saw. */
  version: number;
}

/** A proposal from `build`, before anything is written. */
export interface RobResultCandidate extends Omit<RobResult,
  'id' | 'contrast_id' | 'version' | 'merged_into'> {
  contrast: RobContrast | null;
  source_form_name?: string;
  hold_reason?: string | null;
}

export interface RobMappingWarning {
  role: string;
  severity: 'blocking' | 'needs_review' | 'note';
  message: string;
}

export interface RobFormMapping {
  form_id: string;
  form_name: string;
  table: string;
  columns: string[];
  /** Real values per column — the mapping is confirmed against these, not names. */
  samples: Record<string, string[]>;
  /**
   * One whole extracted row, so the identity preview is a real example.
   *
   * Values per column cannot answer "what identity would this produce": the
   * first value of two columns need not come from the same extraction.
   */
  sample_row?: Record<string, string>;
  /**
   * Counts over EVERY row, unlike `samples`, which stops at 12 values from the
   * first 200. Only these can answer "is this column constant?" — judging that
   * from the sample is how a dead-looking `outcome_other` on a 28-row
   * calibration project turned out to carry 17 real outcome names on the
   * 618-row one.
   */
  column_stats?: Record<string, {
    rows: number; filled: number; usable: number; placeholder: number; distinct: number;
  }>;
  /** Whether each mapped fallback actually covers the rows whose primary is a placeholder. */
  fallbacks?: Array<{
    primary: string; fallback: string; affected: number; covered: number;
    examples: string[]; uncovered_examples: string[];
  }>;
  /** The measurement this form will fall back to, decided by `rob_mapping`. */
  measurement_standin?: string;
  mapping: Record<string, string>;
  /**
   * The name of the registered table shape this mapping came from, or "" when
   * the table is one nobody has mapped. Empty is not an error: it means the
   * screen must ask rather than propose.
   */
  known_shape?: string;
  /** Mapped columns the form no longer has. Reported, never substituted. */
  missing_columns?: Array<{ role: string; column: string }>;
  /** False while the proposal has never been confirmed by a person. */
  stored: boolean;
  /** Confirmed for THIS form. Editing one form never vouches for another. */
  confirmed: boolean;
  warnings: RobMappingWarning[];
  needs_review: boolean;
  extractions: number;
  /** Always true here — this list holds only the forms that were used. */
  used: boolean;
}

/** A form that could have named results but was left out, and why. */
export interface RobExcludedForm {
  form_id: string;
  form_name: string;
  reason: string;
  /** True when a person chose it; false when the reason is the system's reading. */
  explicit: boolean;
}

export interface RobSourceDecision {
  used: boolean;
  reason: string;
  explicit: boolean;
}

export interface RobBuildResponse {
  results: RobResultCandidate[];
  contrasts: RobContrast[];
  forms: RobFormMapping[];
  duplicates: Array<{
    document_id: string;
    identity: Record<string, string>;
    from: string[];
    /** The same two forms by id — resolving a duplicate acts on one of them. */
    from_ids: Array<string | null>;
  }>;
  /** Forms deliberately not used as sources — shown so the omission is visible. */
  excluded: RobExcludedForm[];
  note?: string;
}


// ── Review protocol (rob_protocols) ─────────────────────────────────────────
//
// Decisions made once for the whole review: scope, effect of interest, the
// reviewers, each study's design. Every assessment is judged against them and
// changes after the first assessment are logged as protocol deviations.

export type RobScope = 'result' | 'outcome';
export type RobProtocolEffect = 'assignment' | 'adherence' | 'both';
export type RobDeviationType = 'nonprotocol' | 'implementation' | 'nonadherence';
export type RobStudyDesign = 'parallel' | 'cluster' | 'crossover' | 'nrsi';
export type RobSeat = 'reviewer_1' | 'reviewer_2' | 'adjudicator';

export interface RobStudyDesignEntry {
  design: RobStudyDesign;
  confirmed: boolean;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
}

export interface RobProtocolHistoryEntry {
  at: string;
  by?: string | null;
  by_name?: string | null;
  what: string;
  why: string;
}

export interface RobProtocol {
  project_id: string;
  /** The RoB 2 storage form. Null until the first save creates it. */
  form_id: string | null;
  scope: RobScope | null;
  effect: RobProtocolEffect | null;
  deviation_types: RobDeviationType[];
  reviewers: Record<RobSeat, string | null>;
  study_designs: Record<string, RobStudyDesignEntry>;
  tool_version: string;
  /**
   * Free text: deviations from the intended interventions the review team
   * expects in these trials. Shown to reviewers in the Domain 2 framing box.
   */
  anticipated_deviations: string;
  /** {document_id: {form_id: source}} — absent means "auto" (consensus → R1 → R2 → AI). */
  row_sources?: Record<string, Record<string, string>>;
  /** Who may see AI suggestions (default `cr_only`). Absent on servers without the feature. */
  ai_visibility?: RobAiVisibility;
  /** When "Set up review protocol" was first completed. */
  confirmed_at: string | null;
  history: RobProtocolHistoryEntry[];
  updated_at?: string | null;
  /** Server-computed: assessments stored against this protocol (all people). */
  assessment_count: number;
}

export interface RobProtocolPatch {
  form_id?: string | null;
  scope?: RobScope;
  effect?: RobProtocolEffect;
  deviation_types?: RobDeviationType[];
  reviewers?: Partial<Record<RobSeat, string | null>>;
  study_designs?: Record<string, RobStudyDesign>;
  anticipated_deviations?: string;
  /** Where one study's RoB rows come from (Comparisons page "Use:"). Managers only. */
  row_source?: { document_id: string; form_id: string; source: string };
  /** Managers only. */
  ai_visibility?: RobAiVisibility;
  confirm?: boolean;
  /** Required when assessments exist and scope / effect / deviation types change. */
  reason?: string;
}

export interface RobProtocolImpact {
  /** Entries whose Domain 2 and Overall would be reset. */
  assessments: number;
  studies: number;
}

/** One person's progress on one target — no answers, safe under blinding. */
export interface RobAssessmentStatus {
  document_id: string;
  extracted_by: string;
  extraction_type: 'manual' | 'consensus';
  seat: RobSeat | null;
  target_id: string;
  status: 'progress' | 'complete';
  domains_judged: number;
  updated_at: string | null;
}

export interface RobAssessmentRecord {
  id: string;
  document_id: string;
  form_id: string;
  extracted_by: string | null;
  extracted_by_name?: string | null;
  extraction_type: 'manual' | 'consensus';
  seat: RobSeat | null;
  extracted_data: Record<string, any>;
  created_at: string;
  updated_at: string | null;
}

export interface RobAssessmentsResponse {
  form_id: string | null;
  /**
   * Records the caller may read. A counterpart reader's record arrives with
   * only the entries BOTH readers have completed; the rest are stripped.
   */
  records: RobAssessmentRecord[];
  /** Everyone's per-target status, values never included. */
  statuses: RobAssessmentStatus[];
  /** The caller's seat under the protocol, if any. */
  my_seat: RobSeat | null;
}

/** One extraction a study's rows can come from (backend utils/rob_row_source). */
export interface RobRowSourceOption {
  key: string;            // consensus | reviewer_1 | reviewer_2 | ai | person:<id>
  label: string;          // "Consensus", "R1 · Reham Elkayal", "AI extraction · not reviewed"
  author: string | null;
  author_name: string;
  at: string;
  row_count: number;
}

export interface RobStudyRowsForm {
  form_id: string;
  form_name: string;
  table: string;
  columns: string[];
  mapping: Record<string, string>;
  choice: string;         // "auto" or a saved source key
  chosen: string | null;  // the source actually used
  fell_back: boolean;     // the saved choice is gone; Auto is used instead
  available: RobRowSourceOption[];
  rows: Record<string, any>[];
}

export const robService = {

  /** The project's review protocol, with defaults when none is stored yet. */
  async getProtocol(projectId: string): Promise<RobProtocol> {
    return apiClient.get<RobProtocol>(`/api/v1/rob/protocol?project_id=${encodeURIComponent(projectId)}`);
  },

  /**
   * Change the protocol. Project admins only, except `study_designs` for a study
   * whose design is not yet confirmed, which any reviewer may set at its first
   * assessment. Changing scope, effect or deviation types once assessments
   * exist needs `reason`; an effect change resets the affected Domain 2 and
   * Overall judgements server-side and appends to `history`.
   */
  async updateProtocol(projectId: string, patch: RobProtocolPatch): Promise<RobProtocol> {
    return apiClient.put<RobProtocol>('/api/v1/rob/protocol', { project_id: projectId, ...patch });
  },

  /** What an effect / deviation-type change would reset, before committing to it. */
  async protocolImpact(projectId: string, patch: Pick<RobProtocolPatch, 'effect' | 'deviation_types'>): Promise<RobProtocolImpact> {
    return apiClient.post<RobProtocolImpact>('/api/v1/rob/protocol/impact', { project_id: projectId, ...patch });
  },

  /**
   * Turn a study's defined comparisons into results: every row held for want
   * of a comparison becomes one result per comparison (Comparisons screen).
   */
  async resultsFromComparisons(documentId: string): Promise<{ created: number; retired: number }> {
    return apiClient.post(`/api/v1/rob/studies/${documentId}/results-from-comparisons`, {});
  },

  /**
   * A study's extracted rows per mapped source form, from the same source the
   * results are built from. Managers only.
   */
  async studyRows(documentId: string): Promise<{ document_id: string; forms: RobStudyRowsForm[] }> {
    return apiClient.get(`/api/v1/rob/studies/${documentId}/rows`);
  },

  /** Every RoB 2 assessment record in the project, blinded per assessment. */
  async listAssessments(projectId: string): Promise<RobAssessmentsResponse> {
    return apiClient.get<RobAssessmentsResponse>(`/api/v1/rob/assessments?project_id=${encodeURIComponent(projectId)}`);
  },
  /**
   * Start (or join) an AI run for one assessment target. Idempotent server-side:
   * an existing draft is reused unless `force`. `opened` / `consensus_ready`
   * may come back `{skipped}` — that is a normal answer, not an error.
   */
  async aiRun(request: RobAiRunRequest): Promise<RobAiRunResponse> {
    return apiClient.post<RobAiRunResponse>('/api/v1/rob/ai/run', request);
  },

  /** The validated drafts for one target, filtered by the visibility rule server-side. */
  async aiDrafts(projectId: string, documentId: string, targetId: string): Promise<RobAiDraftsResponse> {
    const params = new URLSearchParams({ project_id: projectId, document_id: documentId, target_id: targetId });
    return apiClient.get<RobAiDraftsResponse>(`/api/v1/rob/ai/drafts?${params.toString()}`);
  },

  /** Research export: one row per assessment entry × question (managers). */
  async aiExport(projectId: string): Promise<{ rows: RobAiExportRow[] }> {
    return apiClient.get(`/api/v1/rob/ai/export?project_id=${encodeURIComponent(projectId)}`);
  },

  /**
   * The results this project's outcome forms could support.
   *
   * A proposal, not a commit — nothing is written until `commitResults`. The
   * page this replaces derived the same thing invisibly on every render, from
   * one outcome form picked by regex, and was wrong on every project in the
   * corpus. Seeing it first is the whole point.
   */
  async buildResults(projectId: string): Promise<RobBuildResponse> {
    return apiClient.post<RobBuildResponse>('/api/v1/rob/results/build', {
      project_id: projectId,
    });
  },

  /**
   * Create the proposed results, and **every** proposed comparison with them.
   *
   * Sending only the comparisons already attached to a result dropped exactly
   * the ones needing a decision — a multi-arm trial where no arm reads as the
   * control — so the results held on them had nothing to point at and could
   * never be released.
   */
  async commitResults(
    projectId: string, results: RobResultCandidate[], contrasts: RobContrast[] = [],
  ): Promise<{ contrasts: number; results: RobResult[] }> {
    return apiClient.post('/api/v1/rob/results/commit', {
      project_id: projectId, results, contrasts,
    });
  },

  /**
   * Say which arms a comparison is between, or swap its direction.
   *
   * If the study already records these two arms, the existing comparison is
   * returned with `already_existed` — the same comparison, not a failure — so
   * the caller attaches that one instead of creating a second copy of it.
   */
  async patchContrast(contrastId: string, patch: {
    intervention?: string; comparator?: string; state?: string;
  }): Promise<{ contrast: RobContrast | null; already_existed?: boolean }> {
    return apiClient.patch(`/api/v1/rob/contrasts/${contrastId}`, patch);
  },

  /**
   * Remove a comparison nobody's results point at.
   *
   * The server attempts the delete and lets the foreign key answer, so a
   * comparison that gained a result a moment ago is refused with **409**
   * rather than removed on the strength of a count taken beforehand.
   */
  /**
   * Remove a comparison. With `releaseResults`, its results first go back to
   * waiting for a comparison (refused if any of them is already assessed).
   */
  async deleteContrast(contrastId: string, opts?: { releaseResults?: boolean }): Promise<void> {
    const qs = opts?.releaseResults ? '?release_results=true' : '';
    await apiClient.delete(`/api/v1/rob/contrasts/${contrastId}${qs}`);
  },

  /** Every assessable result, with its contrast resolved. */
  async listResults(projectId: string, includeHeld = true): Promise<{
    results: RobResult[]; contrasts: RobContrast[];
  }> {
    const params = new URLSearchParams({ project_id: projectId });
    if (!includeHeld) params.set('include_held', 'false');
    return apiClient.get(`/api/v1/rob/results?${params.toString()}`);
  },

  /**
   * Correct one result's identity.
   *
   * The server bumps `version` when an identity slot changes, which marks
   * assessments made against the old identity stale rather than silently
   * re-pointing them at something else.
   */
  async patchResult(resultId: string, patch: Partial<RobResult>): Promise<{
    result: RobResult | null;
  }> {
    return apiClient.patch(`/api/v1/rob/results/${resultId}`, patch);
  },

  /** Declare that two results are one. Nothing is deleted; the loser keeps a pointer. */
  async mergeResults(resultId: string, into: string): Promise<{ merged: string; into: string }> {
    return apiClient.post(`/api/v1/rob/results/${resultId}/merge`, { into });
  },

  /** Store a confirmed column mapping on the form it describes. */
  async saveMapping(formId: string, mapping: Record<string, string>): Promise<{
    form_id: string; mapping: Record<string, string>;
  }> {
    return apiClient.put(`/api/v1/rob/forms/${formId}/mapping`, { mapping });
  },

  /**
   * Every assessment in a project as a CSV, one row per result.
   *
   * A dedicated export because the generic one writes a row per stored record
   * and folds the repeating table into a single cell — so four assessments of
   * one trial arrive as four judgements crammed together with nothing saying
   * which estimate each belongs to. Judgements come out recomputed from the
   * exported answers, with a column saying whether a reviewer overrode them.
   */
  async exportCsv(projectId: string, format: 'csv' | 'json' = 'csv'): Promise<Blob> {
    const token = apiClient.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(
      `/api/v1/rob/export?project_id=${encodeURIComponent(projectId)}&format=${format}`,
      { headers },
    );
    if (!response.ok) throw new Error(`Export failed with status ${response.status}`);
    return response.blob();
  },

  /**
   * Say whether a form's rows are results to assess.
   *
   * Projects carry second copies of an outcome form — an ablation run, a
   * description-only variant — holding the same extractions. Used as a source,
   * every row of the copy becomes a duplicate of a real result, and somebody
   * resolves the same decision once per row. Taking it here costs one click.
   *
   * Pass `null` to clear the choice and return the form to the automatic
   * reading, which `buildResults` reports under `excluded`.
   */
  async setFormAsSource(formId: string, useAsSource: boolean | null): Promise<{
    form_id: string; decision: RobSourceDecision;
  }> {
    return apiClient.put(`/api/v1/rob/forms/${formId}/source`, {
      use_as_source: useAsSource,
    });
  },
};

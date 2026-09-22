import { apiClient } from '@/lib/api';

/**
 * What the extraction already knows about the result being assessed.
 *
 * Sent with the draft request so the model is answering about *this* result:
 * "were data available for nearly all participants" has a different answer for
 * pain at 6 hours than at 48 hours, and the numbers that settle it are already
 * in the outcome tables.
 */
export interface RobResultContext {
  outcome?: string;
  timepoint?: string;
  comparison?: string;
  measurement?: string;
  n_randomized?: string;
  n_analyzed?: string;
  effect?: string;
  design?: string;
  notes?: Record<string, string>;
}

export interface RobDraftRequest {
  document_id: string;
  form_id: string;
  target_key?: string;
  /**
   * The result this draft is about.
   *
   * Its version is part of the server's cache key, so correcting a result's
   * identity retires the drafts made against the old one instead of leaving
   * them in place under a key that still looks right.
   */
  result_id?: string;
  result_version?: number;
  context?: RobResultContext;
  /** 0-based domain indices. Defaults to all five. */
  domains?: number[];
  /** Re-run rather than serving the cached draft. */
  force?: boolean;
}

export interface RobDraftedAnswer {
  question_id: string;
  answer: string;
  quote: string;
  locator: string;
  rationale: string;
  domain: number;
}

export interface RobDraftResponse {
  answers: RobDraftedAnswer[];
  /**
   * Questions the model was asked but could not answer from the retrieved text.
   *
   * **Not "No information".** That is a claim about the paper — that the trial
   * report is silent — and only a reviewer who can see which sources were
   * searched is in a position to make it. This is a fact about the retrieval,
   * and the screen says so.
   */
  not_found: string[];
  drafted: number[];
  cached: number[];
  failed: number[];
  note: string;
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

export const robService = {
  /**
   * Ask the model to answer RoB 2's signalling questions for one result.
   *
   * Returns answers with evidence, never a risk-of-bias judgement — the label
   * is derived in the browser by `rob2.ts:judgeDomain` from the answers the
   * reviewer confirms.
   */
  async draft(request: RobDraftRequest): Promise<RobDraftResponse> {
    return apiClient.post<RobDraftResponse>('/api/v1/rob/draft', request);
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
  async deleteContrast(contrastId: string): Promise<void> {
    await apiClient.delete(`/api/v1/rob/contrasts/${contrastId}`);
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

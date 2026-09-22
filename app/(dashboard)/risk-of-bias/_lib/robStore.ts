/**
 * Where a risk-of-bias assessment is stored, and why it is stored twice over.
 *
 * Answers live in `extraction_results.extracted_data`, the same place every
 * other extraction lives. That is not inertia: blinding, consensus, the audit
 * trail, exports, inter-rater agreement and the provenance merge are all built
 * on that table, and a dedicated `rob_assessments` table would fork every one
 * of them. What changes here is the *shape* of the record, not its home.
 *
 * **One database row per person per document.** `idx_extraction_results_manual_person`
 * is `UNIQUE (document_id, form_id, extracted_by) WHERE extraction_type='manual'`,
 * so four results of one trial cannot be four rows. They are four entries in one
 * record, and a save rewrites the whole record — which is why every write here
 * preserves what it was not asked to change.
 *
 * **Two zones, because the questions are about two different things.**
 *
 *   root of the record   → the six trial-level answers (1.1–1.3, 2.1–2.3),
 *                          the instrument, and whether the six are declared done
 *   `risk_of_bias_assessments[]` → one entry per result, holding that result's
 *                          own sixteen answers and its five domain judgements
 *
 * The six are stored once and read by every result of the trial. The obvious
 * alternative — copy them into each result's entry — was the earlier design, and
 * it meant provenance to chase, several records to keep in step, and a reviewer
 * wondering why an answer they never gave was already filled in. One stored
 * answer has none of those problems, and correcting it corrects every result.
 *
 * **Entries are keyed on `result_id`, not on an outcome name.** The page this
 * replaces keyed on the outcome string, so renaming an outcome orphaned its
 * assessment and two results that shared a name shared an assessment. A result
 * id is stable across both. `result_version` travels with it so an assessment
 * made against an identity that has since changed can be shown as stale rather
 * than silently re-pointed at something else.
 *
 * Pure — no React, no services — so the check scripts can import it under bare
 * Node.
 */

import {
  ROB2_QUESTIONS, ROB2_SIGNALLING, isAsked, parseAnswer,
  type Answers, type Severity,
} from './rob2';
import { cellValue, rowsOf, type Row } from './robForm';
import { TRIAL_QUESTIONS, isTrialQuestion } from './robIdentity';
import {
  clearRoutedOut, locatorText, readAnswers, readEvidence, writeAnswers,
  type QuestionEvidence, type SignallingBinding,
} from './robSignalling';
import { cellEnvelope } from './robForm';
import type { BoundDomain } from './robAdapter';
import { toFormOption, type RobTool } from './robTools';

/**
 * The repeating field holding one entry per assessed result, in forms built from
 * the preset. A form built by hand may call it something else, so every function
 * here takes the name from the bound form and falls back to this only when the
 * form does not say.
 */
export const ASSESSMENT_TABLE = 'risk_of_bias_assessments';

/** Which result an entry is about. Stable; the outcome name is not. */
export const RESULT_ID_COLUMN = 'result_id';

/** The identity version this assessment was made against. */
export const RESULT_VERSION_COLUMN = 'result_version';

/** Human-readable name of the result, kept so an export reads as prose. */
export const RESULT_LABEL_COLUMN = 'outcome_assessed';

/**
 * Bookkeeping that is not an answer: which domains the reviewer confirmed,
 * whether they declared the assessment complete, any overrides and why.
 *
 * One named key rather than a dozen loose ones, so a reader of the raw JSON can
 * see at a glance which fields are the instrument's and which are ours.
 */
export const META_COLUMN = 'rob_workflow';

/**
 * A source reference and supporting passage per answer, as JSON.
 *
 * The rationale column already holds prose. This holds the two things prose
 * cannot be searched or checked for: WHERE the reviewer looked, and WHAT it
 * said. An assessment whose evidence is only a paragraph of reasoning cannot be
 * audited without re-reading the paper.
 */
export const EVIDENCE_COLUMN = 'rob_evidence';

/**
 * Where an answer came from, when it was not typed here.
 *
 * Copying answers between results of one trial is legitimate and common — D1
 * rarely differs — but an answer that arrived by copy is a weaker claim than
 * one somebody made looking at this result, and consensus needs to know which
 * it is reading. The record survives later edits: it says the answer was copied
 * AND that it has since been changed, because "edited after copying" is a
 * different thing again from either.
 */
export const PROVENANCE_COLUMN = 'rob_provenance';

export interface AnswerEvidence {
  /** Where the reviewer looked — "p.6 · Table 2", a registry id, a protocol. */
  reference: string;
  /** What it said, in the source's own words. */
  passage: string;
}

export interface AnswerOrigin {
  /** The result this answer was copied from, if it was. */
  copiedFrom?: string;
  copiedAt?: string;
  /** True once somebody changed it after the copy. */
  editedSince?: boolean;
}

/** Root keys. The instrument is recorded on every record it produced. */
export const ROOT_INSTRUMENT = 'rob_instrument';
export const ROOT_INSTRUMENT_VERSION = 'rob_instrument_version';
export const ROOT_TRIAL_DESIGN = 'rob_trial_design';
export const ROOT_EFFECT = 'rob_effect_of_interest';
export const ROOT_TRIAL_DONE = 'rob_trial_questions_complete';

/**
 * Trial answers, keyed by the comparison they are about.
 *
 * **Scoped to study AND comparison, not to the study alone.** 2.1-2.3 ask who
 * knew the assigned intervention; in a trial running three drugs against
 * placebo, one arm can be double-blind and another open-label, so one set of
 * answers per trial would force a reviewer to give one answer for two different
 * truths. Every result of the SAME comparison still shares one set — which is
 * the whole point — but a different comparison of the same trial gets its own.
 *
 * Records written before this existed keep their answers in the root columns,
 * and `readTrial` still reads them when the map has no entry. Nothing is
 * migrated in place: an old record is read where it lies and rewritten into the
 * map the first time somebody saves.
 */
export const ROOT_TRIAL_BY_COMPARISON = 'rob_trial';

export const INSTRUMENT_VERSION = '2019-08-22';

// ── The two zones ────────────────────────────────────────────────────────────

export interface TrialRecord {
  /** Answers to 1.1–1.3 and 2.1–2.3 — the whole trial's, not one result's. */
  answers: Answers;
  rationale: Record<string, string>;
  evidence: Record<string, QuestionEvidence>;
  /** The reviewer said the six are done. Declared, never inferred. */
  complete: boolean;
}

export const EMPTY_TRIAL: TrialRecord = {
  answers: {}, rationale: {}, evidence: {}, complete: false,
};

/**
 * The trial's six answers, read from the root of the record.
 *
 * They use the same column names the per-result entries use for their own
 * questions. That is deliberate: the binding already knows what `1.1` is called,
 * and a second naming scheme for the same question would be one more thing to
 * keep in step for no gain.
 */
export function readTrial(
  data: Record<string, any> | undefined, binding: SignallingBinding,
  contrastId = '',
): TrialRecord {
  if (!data) return EMPTY_TRIAL;
  const scoped = (data as Row)[ROOT_TRIAL_BY_COMPARISON];
  const forComparison = contrastId && scoped && typeof scoped === 'object'
    ? (scoped as Row)[contrastId] : null;
  // The root columns are where this lived before answers were scoped to a
  // comparison. A record that predates the map is read where it lies.
  const root = (forComparison && typeof forComparison === 'object'
    ? forComparison : data) as Row;
  const all = readAnswers(root, binding);
  const evidence = readEvidence(root, binding);
  const answers: Answers = {};
  const rationale: Record<string, string> = {};
  const trialEvidence: Record<string, QuestionEvidence> = {};

  for (const id of TRIAL_QUESTIONS) {
    if (all[id]) answers[id] = all[id];
    const bound = binding.questions.find(b => b.question.id === id);
    if (bound?.rationaleColumn) {
      const text = cellValue(root, bound.rationaleColumn);
      if (text) rationale[id] = text;
    }
    if (evidence[id]) trialEvidence[id] = evidence[id];
  }

  return {
    answers,
    rationale,
    evidence: trialEvidence,
    complete: truthy(root[ROOT_TRIAL_DONE]),
  };
}

export function writeTrial(
  existing: Record<string, any> | undefined,
  binding: SignallingBinding,
  trial: TrialRecord,
  contrastId = '',
  design = 'parallel',
): Record<string, any> {
  const trialBinding = restrictTo(binding, TRIAL_QUESTIONS);
  const record: Row = { ...(existing ?? {}) };

  let zone: Row = {};
  const scoped = record[ROOT_TRIAL_BY_COMPARISON];
  const previous = contrastId && scoped && typeof scoped === 'object'
    ? (scoped as Row)[contrastId] : null;
  if (previous && typeof previous === 'object') zone = { ...(previous as Row) };

  zone = writeAnswers(zone, trialBinding, trial.answers, trial.rationale, trial.evidence);
  zone = clearRoutedOut(zone, trialBinding, askedSet(trial.answers, TRIAL_QUESTIONS));
  zone[ROOT_TRIAL_DONE] = trial.complete;

  if (contrastId) {
    record[ROOT_TRIAL_BY_COMPARISON] = {
      ...(scoped && typeof scoped === 'object' ? scoped as Row : {}),
      [contrastId]: zone,
    };
  } else {
    // A result whose comparison is not settled yet has nowhere scoped to put
    // these. The root is that place, and it is what the old records use.
    Object.assign(record, zone);
  }

  record[ROOT_INSTRUMENT] = 'rob2';
  record[ROOT_INSTRUMENT_VERSION] = INSTRUMENT_VERSION;
  record[ROOT_TRIAL_DESIGN] = design;
  record[ROOT_EFFECT] = 'assignment';
  return record;
}

// ── One result's assessment ──────────────────────────────────────────────────

export interface ResultAssessment {
  /** This result's own answers — 2.4 onward. Never the trial's six. */
  answers: Answers;
  rationale: Record<string, string>;
  evidence: Record<string, QuestionEvidence>;
  /** Domain index → the reviewer's label, when they overrode the derived one. */
  overrides: Record<number, Severity>;
  overrideWhy: Record<number, string>;
  overallOverride: Severity | null;
  overallOverrideWhy: string;
  /** Domain index → the reviewer confirmed it. Five entries. */
  confirmed: boolean[];
  /** Predicted direction of bias, per domain and overall. Optional throughout. */
  direction: Record<number, string>;
  overallDirection: string;
  /** The reviewer declared this assessment finished. */
  complete: boolean;
  /** The identity version it was made against, for staleness. */
  resultVersion: number | null;
  /** Per question: where the reviewer looked and what it said. */
  sources: Record<string, AnswerEvidence>;
  /** Per question: whether the answer was copied, and whether it has moved since. */
  origins: Record<string, AnswerOrigin>;
  /**
   * Why this review reopened without its reviewer doing anything.
   *
   * `reopenForChangedTrial` has always written this into the record and
   * nothing ever read it, so a reviewer whose completed review reopened saw
   * only that it was no longer complete — not why, and not which domains to
   * look at. Cleared when they acknowledge it.
   */
  reopenedBecause: string;
}

export function emptyAssessment(): ResultAssessment {
  return {
    answers: {}, rationale: {}, evidence: {},
    overrides: {}, overrideWhy: {},
    overallOverride: null, overallOverrideWhy: '',
    confirmed: [false, false, false, false, false],
    direction: {}, overallDirection: '',
    complete: false, resultVersion: null,
    sources: {}, origins: {}, reopenedBecause: '',
  };
}

/** Every entry in the record's assessment table. */
export function assessmentRows(
  data: Record<string, any> | undefined, tableField = ASSESSMENT_TABLE,
): Row[] {
  return rowsOf(data, tableField || ASSESSMENT_TABLE);
}

/**
 * The entry for one result.
 *
 * Falls back to matching on the outcome name so assessments written before
 * results had ids are still found — once. As soon as such an entry is saved it
 * gains its `result_id` and stops depending on the name.
 */
export function rowForResult(
  data: Record<string, any> | undefined, resultId: string, label = '',
  tableField = ASSESSMENT_TABLE,
): Row | null {
  const rows = assessmentRows(data, tableField);
  const byId = rows.find(r => cellValue(r, RESULT_ID_COLUMN) === resultId);
  if (byId) return byId;
  if (!label) return null;
  return rows.find(r => !cellValue(r, RESULT_ID_COLUMN)
    && cellValue(r, RESULT_LABEL_COLUMN) === label) ?? null;
}

export function readResult(
  row: Row | null, binding: SignallingBinding,
  domains: BoundDomain[], tool: RobTool,
): ResultAssessment {
  const out = emptyAssessment();
  if (!row) return out;

  const all = readAnswers(row, binding);
  const evidence = readEvidence(row, binding);
  for (const question of ROB2_QUESTIONS) {
    // A trial-level answer found in a result entry is a leftover from the old
    // copy-into-every-result design. It is ignored rather than migrated: the
    // root is the one place that answer lives now, and reading both would let a
    // stale copy win over the answer somebody actually gave.
    if (isTrialQuestion(question.id)) continue;
    if (all[question.id]) out.answers[question.id] = all[question.id];
    if (evidence[question.id]) out.evidence[question.id] = evidence[question.id];
    const bound = binding.questions.find(b => b.question.id === question.id);
    if (bound?.rationaleColumn) {
      const text = cellValue(row, bound.rationaleColumn);
      if (text) out.rationale[question.id] = text;
    }
  }

  out.resultVersion = numberOrNull(cellValue(row, RESULT_VERSION_COLUMN));
  out.reopenedBecause = String(readMeta(row).reopened_because ?? '');
  out.sources = readJson(row, EVIDENCE_COLUMN) as Record<string, AnswerEvidence>;
  out.origins = readJson(row, PROVENANCE_COLUMN) as Record<string, AnswerOrigin>;

  const meta = readMeta(row);
  out.confirmed = Array.isArray(meta.confirmed) && meta.confirmed.length === 5
    ? meta.confirmed.map(Boolean) : out.confirmed;
  out.complete = truthy(meta.complete);
  out.overallOverride = severityOrNull(meta.overall_override);
  out.overallOverrideWhy = String(meta.overall_override_why ?? '');
  out.overallDirection = String(meta.overall_direction ?? '');
  for (const [key, value] of Object.entries(meta.direction ?? {})) {
    out.direction[Number(key)] = String(value);
  }

  // An override is a recorded decision, so it is read from the record rather
  // than inferred by comparing the stored label with what the answers derive.
  // Inferring it is how a finished AI assessment came up as "your override" and
  // blocked saving behind a justification nobody owed: a domain the answers
  // cannot yet judge disagrees with every stored label, and disagrees for a
  // reason that has nothing to do with anyone overriding anything.
  ROB2_SIGNALLING.forEach((_, i) => {
    const domain = domains[i];
    if (!domain?.column) return;
    const flagged = severityOrNull((meta.overrides ?? {})[String(i)]);
    if (!flagged) return;
    out.overrides[i] = flagged;
    out.overrideWhy[i] = String((meta.override_why ?? {})[String(i)] ?? '')
      || (domain.rationaleColumn ? cellValue(row, domain.rationaleColumn) : '');
  });

  return out;
}

export interface WriteResultInput {
  resultId: string;
  /** Written alongside the id so an export reads as prose, not as a uuid. */
  label: string;
  resultVersion: number | null;
  assessment: ResultAssessment;
  /** The answers the algorithm saw — trial's six merged with this result's. */
  merged: Answers;
  /** Severity per domain, already accounting for overrides. */
  severities: Severity[];
  /** The form's repeating field. Defaults to the preset's name. */
  tableField?: string;
}

/**
 * Fold one result's assessment into the record.
 *
 * Preserves every other entry, the trial zone, and columns this page has never
 * heard of. A save rewrites the whole record, so a careless merge here destroys
 * a colleague's other assessments — or the reviewer's own, on the trial's other
 * three results.
 */
export function writeResult(
  existing: Record<string, any> | undefined,
  binding: SignallingBinding,
  domains: BoundDomain[],
  tool: RobTool,
  input: WriteResultInput,
): Record<string, any> {
  const resultBinding = restrictTo(
    binding, ROB2_QUESTIONS.map(q => q.id).filter(id => !isTrialQuestion(id)),
  );

  const applyTo = (row: Row): Row => {
    let next: Row = writeAnswers(row, resultBinding, input.assessment.answers,
      input.assessment.rationale, input.assessment.evidence);
    next = clearRoutedOut(next, resultBinding, askedSet(input.merged));
    next[RESULT_ID_COLUMN] = input.resultId;
    next[RESULT_LABEL_COLUMN] = input.label;
    if (input.resultVersion !== null) next[RESULT_VERSION_COLUMN] = input.resultVersion;

    // The judgement columns stay populated so the grid, exports, consensus and
    // Synthesis keep reading what they always read. The answers are the source
    // of truth; these are its cache.
    ROB2_SIGNALLING.forEach((_, i) => {
      const domain = domains[i];
      if (!domain?.column) return;
      const severity = input.severities[i];
      if (!severity || severity === 'none') return;
      const label = tool.judgments.find(j => tool.severity[j] === severity);
      if (!label) return;
      const option = toFormOption(label, domain.formOptions, tool);
      // A refusal is deliberate — the form cannot express this judgement, and
      // writing an approximation of it would be worse than leaving it alone.
      if (!option || 'ambiguous' in option) return;
      next[domain.column] = option.option;
      if (domain.rationaleColumn) {
        const why = input.assessment.overrideWhy[i];
        if (why) next[domain.rationaleColumn] = why;
      }
    });

    next[EVIDENCE_COLUMN] = JSON.stringify(input.assessment.sources ?? {});
    next[PROVENANCE_COLUMN] = JSON.stringify(input.assessment.origins ?? {});
    next[META_COLUMN] = JSON.stringify({
      confirmed: input.assessment.confirmed,
      complete: input.assessment.complete,
      overrides: mapKeys(input.assessment.overrides),
      override_why: mapKeys(input.assessment.overrideWhy),
      overall_override: input.assessment.overallOverride,
      overall_override_why: input.assessment.overallOverrideWhy,
      direction: mapKeys(input.assessment.direction),
      overall_direction: input.assessment.overallDirection,
      instrument: 'rob2',
      instrument_version: INSTRUMENT_VERSION,
      // Survives a save, so the notice does not vanish the moment the reviewer
      // touches an answer — before they have read it. Cleared only by
      // acknowledging, which writes an empty string and drops the key.
      reopened_because: input.assessment.reopenedBecause || undefined,
    });
    return next;
  };

  const table = input.tableField || ASSESSMENT_TABLE;
  const record = { ...(existing ?? {}) };
  const rows = assessmentRows(existing, table);
  const index = rows.findIndex(r => cellValue(r, RESULT_ID_COLUMN) === input.resultId
    || (!cellValue(r, RESULT_ID_COLUMN)
        && !!input.label && cellValue(r, RESULT_LABEL_COLUMN) === input.label));

  const nextRows = index >= 0
    ? rows.map((r, i) => (i === index ? applyTo(r) : r))
    : [...rows, applyTo({})];

  const original = existing?.[table];
  record[table] =
    original && typeof original === 'object' && !Array.isArray(original) && 'value' in original
      ? { ...original, value: nextRows }
      : nextRows;
  return record;
}

/**
 * Reopen the completed reviews that stood on trial answers which have changed.
 *
 * The six are shared by every result of a comparison. Change one after somebody
 * declared a review complete and that review now rests on an answer nobody gave
 * — its D1 and D2 judgements were derived from the old set. Leaving it marked
 * complete is the quiet version of losing the reviewer's work: the label stays,
 * the reasoning underneath it has moved.
 *
 * So the reviews reopen, and any override on D1 or D2 is dropped with them —
 * an override is a reasoned disagreement with a *specific* derivation, and that
 * derivation no longer exists. Overrides on D3-D5 are untouched: those domains
 * do not read the shared answers.
 *
 * Returns which results were reopened so the screen can say so. Nothing is
 * deleted; the answers stay exactly as the reviewer left them.
 */
export function reopenForChangedTrial(
  existing: Record<string, any> | undefined,
  resultIds: Set<string>,
  tableField = ASSESSMENT_TABLE,
): { data: Record<string, any>; reopened: string[] } {
  const table = tableField || ASSESSMENT_TABLE;
  const rows = assessmentRows(existing, table);
  const reopened: string[] = [];

  const next = rows.map(row => {
    const id = cellValue(row, RESULT_ID_COLUMN);
    if (!resultIds.has(id)) return row;
    const meta = readMeta(row);
    if (!truthy(meta.complete)) return row;

    const overrides = { ...(meta.overrides ?? {}) };
    const overrideWhy = { ...(meta.override_why ?? {}) };
    delete overrides['0']; delete overrides['1'];
    delete overrideWhy['0']; delete overrideWhy['1'];

    reopened.push(id);
    return {
      ...row,
      [META_COLUMN]: JSON.stringify({
        ...meta, complete: false, overrides, override_why: overrideWhy,
        reopened_because: 'the shared trial answers for this comparison changed',
      }),
    };
  });

  if (reopened.length === 0) return { data: { ...(existing ?? {}) }, reopened };

  const record = { ...(existing ?? {}) };
  const original = existing?.[table];
  record[table] =
    original && typeof original === 'object' && !Array.isArray(original) && 'value' in original
      ? { ...original, value: next }
      : next;
  return { data: record, reopened };
}

// ── Small helpers ────────────────────────────────────────────────────────────

/** A binding narrowed to some questions, so a write cannot touch the others. */
function restrictTo(binding: SignallingBinding, ids: readonly string[]): SignallingBinding {
  const keep = new Set(ids);
  const questions = binding.questions.filter(b => keep.has(b.question.id));
  return {
    questions,
    coverage: questions.filter(b => b.column).length,
    usable: binding.usable,
    missing: binding.missing.filter(id => keep.has(id)),
  };
}

/** Which of `ids` the current answers actually route in. */
function askedSet(answers: Answers, ids?: readonly string[]): Set<string> {
  const limit = ids ? new Set(ids) : null;
  const out = new Set<string>();
  for (const question of ROB2_QUESTIONS) {
    if (limit && !limit.has(question.id)) continue;
    if (isAsked(question, answers)) out.add(question.id);
  }
  return out;
}

/** A JSON column, read defensively: unreadable bookkeeping is not a reason to refuse. */
function readJson(row: Row, column: string): Record<string, any> {
  const raw = cellValue(row, column);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readMeta(row: Row): Record<string, any> {
  const raw = cellValue(row, META_COLUMN);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Unreadable bookkeeping is not a reason to refuse to open an assessment —
    // the answers are what matter, and they are stored in their own columns.
    return {};
  }
}

function mapKeys(source: Record<number, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = String(
    value && typeof value === 'object' && 'value' in (value as object)
      ? (value as any).value : value ?? '',
  ).trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === '1';
}

function numberOrNull(raw: string): number | null {
  const n = Number(raw);
  return raw && Number.isFinite(n) ? n : null;
}

function severityOrNull(raw: unknown): Severity | null {
  return raw === 'low' || raw === 'some' || raw === 'high' ? raw : null;
}

export { locatorText, cellEnvelope, parseAnswer };

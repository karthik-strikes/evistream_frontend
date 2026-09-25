/**
 * The assessment model behind the rebuilt Risk of Bias page.
 *
 * Storage is unchanged in kind: one `extraction_results` record per person per
 * document on the RoB 2 form, with one entry per assessment in
 * `risk_of_bias_assessments[]` (see `robStore.ts` for why). What changes is the
 * split between the two zones, to match the review-protocol workflow:
 *
 *   record root   → Domain 1 (1.1–1.3), once per STUDY. Randomization is a fact
 *                   about the trial, and every assessment of it reads the same
 *                   stored answers unless an assessment overrides them.
 *   entry         → everything else, per ASSESSMENT: Domains 2–5, the reviewer's
 *                   five judgements, overall, directions, the preliminary
 *                   considerations, and the effect of interest it was made under.
 *
 * An entry is about one TARGET, which is either one result (`result_id` = the
 * rob_results id) or one outcome (`result_id` = `outcome:<key>`). An outcome
 * assessment is its own thing: it is never copied into, or inferred for, the
 * results under that outcome.
 *
 * **Schema 3.** Entries this module writes carry `rob_workflow.schema = 3`.
 * Older entries (the Sep 15 result-registry page) kept 2.1–2.3 in a trial zone
 * keyed by comparison and recorded only overrides, not chosen judgements; they
 * are read through `legacy*` below and rewritten as schema 3 on their next save.
 * Nothing is migrated in place.
 *
 * Pure — no React, no services — so check scripts can import it under Node.
 */

import {
  ROB2_QUESTIONS, parseAnswer, questionsFor, routeAllFor, suggestDomain,
  suggestOverall, type Answers, type DeviationType, type EffectOfInterest,
  type PathwayOptions, type Severity,
} from './rob2';
import { cellEnvelope, cellValue, rowsOf, type Row } from './robForm';
import type { BoundDomain } from './robAdapter';
import {
  clearRoutedOut, readAnswers, writeAnswers, type SignallingBinding,
} from './robSignalling';
import {
  ASSESSMENT_TABLE, INSTRUMENT_VERSION, META_COLUMN, RESULT_ID_COLUMN,
  RESULT_LABEL_COLUMN, RESULT_VERSION_COLUMN, ROOT_TRIAL_BY_COMPARISON,
} from './robStore';
import { toFormOption, type RobTool } from './robTools';
import type { ResultIdentity } from './robIdentity';

export type { Severity, EffectOfInterest, DeviationType };

// ── Vocabulary ───────────────────────────────────────────────────────────────

export type Scope = 'result' | 'outcome';
export type ProtocolEffect = 'assignment' | 'adherence' | 'both';
export type StudyDesign = 'parallel' | 'cluster' | 'crossover' | 'nrsi';
export type Seat = 'reviewer_1' | 'reviewer_2' | 'adjudicator';
export type Judgement = 'low' | 'some' | 'high';
export type Direction = 'exp' | 'comp' | 'null' | 'away' | 'unpred';
export type AssessmentStatus = 'none' | 'progress' | 'complete';

export const DESIGN_LABEL: Record<StudyDesign, string> = {
  parallel: 'Individually-randomized parallel-group trial',
  cluster: 'Cluster-randomized parallel-group trial',
  crossover: 'Individually-randomized cross-over (or other matched) trial',
  nrsi: 'Non-randomised study of interventions (NRSI)',
};

export const DESIGN_SHORT: Record<StudyDesign, string> = {
  parallel: 'Parallel RCT',
  cluster: 'Cluster RCT',
  crossover: 'Crossover RCT',
  nrsi: 'Non-randomised',
};

export const TOOL_FOR_DESIGN: Record<StudyDesign, string> = {
  parallel: 'RoB 2',
  cluster: 'RoB 2 · cluster',
  crossover: 'RoB 2 · crossover',
  nrsi: 'ROBINS-I',
};

export const DESIGN_ORDER: StudyDesign[] = ['parallel', 'cluster', 'crossover', 'nrsi'];

/**
 * Only the parallel-group RoB 2 instrument is transcribed. A study of any other
 * design shows its tool but cannot be assessed: judging a cluster trial with the
 * parallel-group questions would miss domain 1b entirely, and a label produced
 * by the wrong instrument is worse than none.
 */
export function designAssessable(design: StudyDesign | null | undefined): boolean {
  return design === 'parallel';
}

export const SEAT_SHORT: Record<Seat, string> = {
  reviewer_1: 'R1', reviewer_2: 'R2', adjudicator: 'CR',
};

export const SEAT_LABEL: Record<Seat, string> = {
  reviewer_1: 'Reviewer 1', reviewer_2: 'Reviewer 2', adjudicator: 'Consensus reviewer',
};

export const JUDGEMENT_LABEL: Record<Judgement, string> = {
  low: 'Low risk of bias', some: 'Some concerns', high: 'High risk of bias',
};

export const DIRECTION_OPTIONS: Array<[Direction, string]> = [
  ['exp', 'Favours experimental'],
  ['comp', 'Favours comparator'],
  ['null', 'Towards null'],
  ['away', 'Away from null'],
  ['unpred', 'Unpredictable'],
];

export const EFFECT_LABEL: Record<EffectOfInterest, string> = {
  assignment: 'Effect of assignment to intervention (ITT)',
  adherence: 'Effect of adhering to intervention (per-protocol)',
};

export const EFFECT_SHORT: Record<EffectOfInterest, string> = {
  assignment: 'assignment (ITT)',
  adherence: 'adhering',
};

export const SOURCE_OPTIONS: Array<[string, string]> = [
  ['article', 'Journal article(s)'],
  ['protocol', 'Trial protocol'],
  ['sap', 'Statistical analysis plan'],
  ['registry', 'Trial registry record'],
  ['company', 'Company registry record'],
  ['grey', 'Grey literature'],
  ['abstract', 'Conference abstract(s)'],
  ['csr', 'Regulatory document (CSR)'],
  ['ethics', 'Research ethics application'],
  ['grant', 'Grant database summary'],
  ['pc_trialist', 'Personal communication · trialist'],
  ['pc_sponsor', 'Personal communication · sponsor'],
];

/** Domain labels as the rail and the summary table print them. */
export const DOMAIN_SHORT = [
  'Randomization',
  'Deviations from intervention',
  'Missing outcome data',
  'Outcome measurement',
  'Selection of reported result',
];

export const DOMAIN_TITLE = [
  'Bias arising from the randomization process',
  'Bias due to deviations from intended interventions',
  'Bias due to missing outcome data',
  'Bias in measurement of the outcome',
  'Bias in selection of the reported result',
];

/**
 * The guidance's own routing condition, printed before a conditional question
 * ("If Y/PY/NI to 2.1 or 2.2:"). Keyed by effect because D2 differs.
 */
export function conditionPrefix(id: string, effect: EffectOfInterest): string {
  if (effect === 'adherence') {
    return ({
      '2.3': 'If Y/PY/NI to 2.1 or 2.2',
      '2.6': 'If N/PN/NI to 2.3, or Y/PY/NI to 2.4 or 2.5',
    } as Record<string, string>)[id] ?? '';
  }
  return ({
    '2.3': 'If Y/PY/NI to 2.1 or 2.2',
    '2.4': 'If Y/PY to 2.3',
    '2.5': 'If Y/PY/NI to 2.4',
    '2.7': 'If N/PN/NI to 2.6',
    '3.2': 'If N/PN/NI to 3.1',
    '3.3': 'If N/PN to 3.2',
    '3.4': 'If Y/PY/NI to 3.3',
    '4.3': 'If N/PN/NI to 4.1 and 4.2',
    '4.4': 'If Y/PY/NI to 4.3',
    '4.5': 'If Y/PY/NI to 4.4',
  } as Record<string, string>)[id] ?? '';
}

export const D1_QUESTIONS = ['1.1', '1.2', '1.3'];
const isD1 = (id: string) => id.startsWith('1.');

// ── Targets ──────────────────────────────────────────────────────────────────

/** `Pain`, ` pain `, `PAIN` are one outcome. */
export function normaliseOutcome(name: string): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function outcomeKeyOf(name: string): string {
  return `outcome:${normaliseOutcome(name)}`;
}

export function isOutcomeKey(targetId: string): boolean {
  return targetId.startsWith('outcome:');
}

export interface OutcomeTarget {
  /** `outcome:<normalised name>` — what the entry's `result_id` holds. */
  key: string;
  documentId: string;
  /** Display name, as first written. */
  outcome: string;
  measurements: string[];
  results: ResultIdentity[];
}

/** One document's results grouped into outcomes, in first-seen order. */
export function outcomesOf(results: ResultIdentity[]): OutcomeTarget[] {
  const map = new Map<string, OutcomeTarget>();
  for (const r of results) {
    const key = outcomeKeyOf(r.outcome_domain);
    let target = map.get(key);
    if (!target) {
      target = { key, documentId: r.document_id, outcome: r.outcome_domain, measurements: [], results: [] };
      map.set(key, target);
    }
    target.results.push(r);
    if (r.measurement && !target.measurements.includes(r.measurement)) target.measurements.push(r.measurement);
  }
  return [...map.values()];
}

export interface Target {
  kind: Scope;
  /** Stored in `result_id`. */
  id: string;
  documentId: string;
  outcome: string;
  /** Result scope only. */
  result: ResultIdentity | null;
  /** Outcome scope only. */
  outcomeTarget: OutcomeTarget | null;
}

export function resultTarget(r: ResultIdentity): Target {
  return { kind: 'result', id: r.id, documentId: r.document_id, outcome: r.outcome_domain, result: r, outcomeTarget: null };
}

export function outcomeTarget(o: OutcomeTarget): Target {
  return { kind: 'outcome', id: o.key, documentId: o.documentId, outcome: o.outcome, result: null, outcomeTarget: o };
}

export function comparisonText(r: ResultIdentity | null | undefined): string {
  const c = r?.contrast;
  if (!c || !c.intervention) return 'Comparison not set';
  return `${c.intervention} vs ${c.comparator}`;
}

/** "Pain · 24 weeks · Drug A vs Placebo" / "Pain" for an outcome target. */
export function targetTitle(t: Target): string {
  if (t.kind === 'outcome') return t.outcome;
  const r = t.result!;
  return [r.outcome_domain, r.timepoint, comparisonText(r)].filter(Boolean).join(' · ');
}

// ── The two zones ────────────────────────────────────────────────────────────

/** Marks a record whose root D1 columns are authoritative (study-level). */
export const ROOT_SCHEMA = 'rob_schema';
export const SCHEMA = 3;

export interface StudyD1 {
  answers: Answers;
  support: Record<string, string>;
  /** A linked quote per question. */
  quotes: Record<string, QuoteRef>;
}

export const EMPTY_D1: StudyD1 = { answers: {}, support: {}, quotes: {} };

export interface Assessment {
  targetId: string;
  kind: Scope;
  label: string;
  resultVersion: number | null;
  effect: EffectOfInterest;
  deviations: DeviationType[];
  /** True when this assessment answers D1 itself instead of reading the study's. */
  d1Override: boolean;
  /** This entry's own answers. D1 only when `d1Override`. */
  answers: Answers;
  support: Record<string, string>;
  quotes: Record<string, QuoteRef>;
  /** The reviewer's chosen judgement per domain — a decision, never inferred. */
  judgement: (Judgement | null)[];
  rationale: string[];
  direction: (Direction | '')[];
  overall: Judgement | null;
  overallRationale: string;
  overallDirection: Direction | '';
  complete: boolean;
  // Preliminary considerations
  prelimConfirmed: boolean;
  experimental: string;
  comparator: string;
  resultLocation: string;
  sourcesObtained: string[];
  /** Why this reopened without its reviewer doing anything (protocol deviation). */
  reopenedBecause: string;
  /** Answers superseded by a protocol deviation, kept for the record. */
  revisions: Array<Record<string, unknown>>;
  /** Written with schema < 3; values were carried from the old layout. */
  legacy: boolean;
  /**
   * AI suggestion audit trail (optional; only present when AI suggestions were
   * used). One entry per reveal / use / keep: what the AI said, what the
   * reviewer had, what was kept, the evidence, when, and which model.
   */
  aiLog?: AiLogItem[];
}

/**
 * A quote linked to a question. `location` is the stored `source_location`
 * object (page, bboxes, page size — the extraction-cell shape) when there is
 * one; it is round-tripped so a re-save never flattens the highlight to a
 * label. `{quote, locator}` alone is still a complete link.
 */
export interface QuoteRef {
  quote: string;
  locator: string;
  location?: Record<string, unknown> | null;
}

/**
 * One AI interaction on one question (`rob_workflow.ai_log`).
 *
 * `human_answer_before` is the reviewer's answer when they decided; entries
 * written before Sep 25 2026 call it `human_answer` and carry no `draft_id`,
 * `reason` or `seat` — `readAiLog` fills `human_answer_before` from it.
 */
export interface AiLogEntry {
  kind?: 'question';
  question: string;
  action: 'revealed' | 'accepted' | 'modified' | 'rejected' | 'kept';
  ai_answer: string;
  human_answer_before: string | null;
  /** Legacy spelling of `human_answer_before`. */
  human_answer?: string | null;
  final_answer: string | null;
  evidence: {
    quotes?: Array<{ text: string; page: number | null }>;
    strength: string;
    /** Legacy (single-quote) shape. */
    quote?: string;
    locator?: string;
  };
  /** Why the final answer differs from the AI's (asked on Modify). */
  reason?: string;
  draft_id?: string | null;
  seat?: string | null;
  at: string;
  model: string;
}

/** The AI's engine-derived judgement next to the one the reviewer chose, per domain. */
export interface AiDomainLogEntry {
  kind: 'domain';
  domain: number;
  judgement_ai: Judgement | null;
  judgement_final: Judgement | null;
  at: string;
}

export type AiLogItem = AiLogEntry | AiDomainLogEntry;

export function isQuestionLog(e: AiLogItem): e is AiLogEntry {
  return e.kind !== 'domain';
}

/** Old and new entries alike, with `human_answer_before` always present. */
export function readAiLog(raw: unknown): AiLogItem[] {
  if (!Array.isArray(raw)) return [];
  const out: AiLogItem[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, any>;
    if (x.kind === 'domain') { out.push(x as AiDomainLogEntry); continue; }
    if (typeof x.question !== 'string') continue;
    out.push({
      ...(x as AiLogEntry),
      human_answer_before: x.human_answer_before ?? x.human_answer ?? null,
      evidence: x.evidence && typeof x.evidence === 'object' ? x.evidence : { strength: '' },
    });
  }
  return out;
}

export function emptyAssessment(
  target: Pick<Target, 'id' | 'kind'> & { label?: string; resultVersion?: number | null },
  effect: EffectOfInterest, deviations: DeviationType[],
): Assessment {
  return {
    targetId: target.id, kind: target.kind, label: target.label ?? '',
    resultVersion: target.resultVersion ?? null,
    effect, deviations: [...deviations], d1Override: false,
    answers: {}, support: {}, quotes: {},
    judgement: [null, null, null, null, null],
    rationale: ['', '', '', '', ''],
    direction: ['', '', '', '', ''],
    overall: null, overallRationale: '', overallDirection: '',
    complete: false,
    prelimConfirmed: false, experimental: '', comparator: '', resultLocation: '',
    sourcesObtained: [],
    reopenedBecause: '', revisions: [], legacy: false,
  };
}

/** The answers the engine sees: the study's D1 (unless overridden) + this entry. */
export function mergedAnswers(study: StudyD1, a: Assessment): Answers {
  const out: Answers = {};
  if (!a.d1Override) for (const id of D1_QUESTIONS) if (study.answers[id]) out[id] = study.answers[id];
  for (const [id, code] of Object.entries(a.answers)) {
    if (!a.d1Override && isD1(id)) continue;
    if (code) out[id] = code;
  }
  return out;
}

export function pathwayOf(a: Pick<Assessment, 'effect' | 'deviations'>): PathwayOptions {
  return { effect: a.effect, deviations: a.deviations };
}

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * A root key's plain value. The server's provenance merge stores EVERY root key
 * as an envelope (`{value, status, provenance}`), so `rob_schema` comes back as
 * `{value: 3, ...}` and the `rob_trial` map as `{value: {...}}`. Reading them
 * raw made every saved record look pre-schema-3 and hid the old trial answers.
 */
function rootValue(data: Record<string, any> | undefined, key: string): any {
  const raw = data?.[key];
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
    return raw.value;
  }
  return raw;
}

function readJsonCell(row: Row | undefined, column: string): Record<string, any> {
  if (!row) return {};
  const raw = row[column];
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('value' in raw)) return raw;
  const text = cellValue(row, column);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function sev(raw: unknown): Judgement | null {
  return raw === 'low' || raw === 'some' || raw === 'high' ? raw : null;
}

function dir(raw: unknown): Direction | '' {
  return raw === 'exp' || raw === 'comp' || raw === 'null' || raw === 'away' || raw === 'unpred' ? raw : '';
}

/** Direction strings written by the Sep 15 page were full labels. */
function legacyDirection(raw: unknown): Direction | '' {
  const d = dir(raw);
  if (d) return d;
  const text = String(raw ?? '').toLowerCase();
  if (text.includes('experimental')) return 'exp';
  if (text.includes('comparator')) return 'comp';
  if (text.includes('towards')) return 'null';
  if (text.includes('away')) return 'away';
  if (text.includes('unpredictable')) return 'unpred';
  return '';
}

function readSupportAndQuotes(
  row: Row | undefined, binding: SignallingBinding, ids: Iterable<string>,
): Pick<StudyD1, 'support' | 'quotes'> {
  const keep = new Set(ids);
  const support: Record<string, string> = {};
  const quotes: Record<string, QuoteRef> = {};
  for (const bound of binding.questions) {
    const id = bound.question.id;
    if (!keep.has(id) || !bound.column) continue;
    if (bound.rationaleColumn) {
      const text = cellValue(row, bound.rationaleColumn);
      if (text) support[id] = text;
    }
    const env = cellEnvelope(row, bound.column);
    if (env.source_text) {
      const loc = env.source_location;
      quotes[id] = {
        quote: String(env.source_text),
        locator: typeof loc === 'string' ? loc : loc && typeof loc === 'object'
          ? String((loc as any).label ?? (loc as any).section ?? (loc as any).page ?? '') : '',
        // Keep the geometry so the next save writes it back instead of a bare label.
        location: loc && typeof loc === 'object' && !Array.isArray(loc) ? loc as Record<string, unknown> : null,
      };
    }
  }
  return { support, quotes };
}

function pick(answers: Answers, ids: Iterable<string>): Answers {
  const keep = new Set(ids);
  const out: Answers = {};
  for (const [id, code] of Object.entries(answers)) if (keep.has(id) && code) out[id] = code;
  return out;
}

/**
 * Legacy trial zone for one comparison (2.1–2.3 lived there, and D1 too).
 * Falls back to the root, which is where records before the map kept them.
 */
function legacyTrialZone(data: Record<string, any>, contrastId: string): Row {
  const scoped = rootValue(data, ROOT_TRIAL_BY_COMPARISON);
  if (contrastId && scoped && typeof scoped === 'object' && scoped[contrastId] && typeof scoped[contrastId] === 'object') {
    return scoped[contrastId] as Row;
  }
  return data as Row;
}

/** The study's D1, from the root (schema 3) or the first legacy zone that has any. */
export function readStudyD1(
  data: Record<string, any> | undefined, binding: SignallingBinding,
): StudyD1 {
  if (!data) return EMPTY_D1;
  const zones: Row[] = [];
  if (Number(rootValue(data, ROOT_SCHEMA)) >= SCHEMA) zones.push(data);
  else {
    const scoped = rootValue(data, ROOT_TRIAL_BY_COMPARISON);
    if (scoped && typeof scoped === 'object') {
      for (const zone of Object.values(scoped)) if (zone && typeof zone === 'object') zones.push(zone as Row);
    }
    zones.push(data);
  }
  for (const zone of zones) {
    const answers = pick(readAnswers(zone, binding), D1_QUESTIONS);
    if (Object.keys(answers).length) return { answers, ...readSupportAndQuotes(zone, binding, D1_QUESTIONS) };
  }
  return EMPTY_D1;
}

export function assessmentEntries(data: Record<string, any> | undefined, tableField = ASSESSMENT_TABLE): Row[] {
  return rowsOf(data, tableField || ASSESSMENT_TABLE);
}

export function entryFor(
  data: Record<string, any> | undefined, targetId: string, tableField = ASSESSMENT_TABLE,
): Row | null {
  return assessmentEntries(data, tableField).find(r => cellValue(r, RESULT_ID_COLUMN) === targetId) ?? null;
}

export interface ReadContext {
  binding: SignallingBinding;
  /** The protocol's defaults, used when an entry predates the effect stamp. */
  effect: EffectOfInterest;
  deviations: DeviationType[];
  /** Legacy entries stored 2.1–2.3 per comparison; needed to read them back. */
  contrastIdOf?: (targetId: string) => string;
}

/** One entry, read into the model. Schema 3 as written; older entries carried. */
export function readAssessment(
  row: Row, data: Record<string, any>, ctx: ReadContext,
): Assessment {
  const targetId = cellValue(row, RESULT_ID_COLUMN);
  const meta = readJsonCell(row, META_COLUMN);
  const schema = Number(meta.schema ?? 0);
  const kind: Scope = meta.target === 'outcome' || isOutcomeKey(targetId) ? 'outcome' : 'result';
  const effect: EffectOfInterest = meta.effect === 'adherence' ? 'adherence'
    : meta.effect === 'assignment' ? 'assignment' : ctx.effect;
  const deviations = Array.isArray(meta.deviation_types) && meta.deviation_types.length
    ? meta.deviation_types as DeviationType[] : ctx.deviations;

  const out = emptyAssessment({ id: targetId, kind, label: cellValue(row, RESULT_LABEL_COLUMN) },
    effect, deviations);
  const version = Number(cellValue(row, RESULT_VERSION_COLUMN));
  out.resultVersion = Number.isFinite(version) && cellValue(row, RESULT_VERSION_COLUMN) ? version : null;

  const all = readAnswers(row, ctx.binding);
  out.d1Override = schema >= SCHEMA && !!meta.d1_override;
  const own = ROB2_QUESTIONS.map(q => q.id).filter(id => (out.d1Override ? true : !isD1(id)));
  const ownIds = new Set(own);

  if (schema >= SCHEMA) {
    out.answers = pick(all, ownIds);
    Object.assign(out, readSupportAndQuotes(row, ctx.binding, ownIds));
  } else {
    // Legacy: 2.1–2.3 were trial-level; anything in the entry for them is a
    // stale copy from an even older design, so the trial zone wins.
    out.legacy = true;
    const zone = legacyTrialZone(data, ctx.contrastIdOf?.(targetId) ?? '');
    const trialD2 = pick(readAnswers(zone, ctx.binding), ['2.1', '2.2', '2.3']);
    out.answers = { ...pick(all, [...ownIds].filter(id => !['2.1', '2.2', '2.3'].includes(id))), ...trialD2 };
    const entryBits = readSupportAndQuotes(row, ctx.binding, [...ownIds].filter(id => !['2.1', '2.2', '2.3'].includes(id)));
    const zoneBits = readSupportAndQuotes(zone, ctx.binding, ['2.1', '2.2', '2.3']);
    out.support = { ...entryBits.support, ...zoneBits.support };
    out.quotes = { ...entryBits.quotes, ...zoneBits.quotes };
  }

  out.complete = meta.complete === true || meta.complete === 'true';
  out.reopenedBecause = String(meta.reopened_because ?? '');
  out.revisions = Array.isArray(meta.revisions) ? meta.revisions : [];
  const aiLog = readAiLog(meta.ai_log);
  if (aiLog.length) out.aiLog = aiLog;

  if (schema >= SCHEMA) {
    for (let i = 0; i < 5; i++) {
      out.judgement[i] = sev(meta.judgement?.[i] ?? meta.judgement?.[String(i)]);
      out.rationale[i] = String(meta.rationale?.[i] ?? meta.rationale?.[String(i)] ?? '');
      out.direction[i] = dir(meta.direction?.[i] ?? meta.direction?.[String(i)]);
    }
    out.overall = sev(meta.overall);
    out.overallRationale = String(meta.overall_rationale ?? '');
    out.overallDirection = dir(meta.overall_direction);
    out.prelimConfirmed = !!meta.prelim_confirmed;
    out.experimental = String(meta.experimental ?? '');
    out.comparator = String(meta.comparator ?? '');
    out.resultLocation = String(meta.result_location ?? '');
    out.sourcesObtained = Array.isArray(meta.sources_obtained) ? meta.sources_obtained.map(String) : [];
  } else {
    // Legacy recorded confirmation + overrides; a confirmed domain's judgement
    // was the derived one unless overridden.
    const study = readStudyD1(data, ctx.binding);
    const merged = mergedAnswers(study, out);
    const confirmed: boolean[] = Array.isArray(meta.confirmed) ? meta.confirmed.map(Boolean) : [];
    for (let i = 0; i < 5; i++) {
      const override = sev(meta.overrides?.[String(i)]);
      const derived = suggestDomain(i, merged, pathwayOf(out)).severity;
      out.judgement[i] = override ?? (confirmed[i] && derived && derived !== 'none' ? derived as Judgement : null);
      out.rationale[i] = String(meta.override_why?.[String(i)] ?? '');
      out.direction[i] = legacyDirection(meta.direction?.[String(i)]);
    }
    const overallDerived = suggestOverall(out.judgement).severity;
    out.overall = sev(meta.overall_override)
      ?? (out.complete && overallDerived && overallDerived !== 'none' ? overallDerived as Judgement : null);
    out.overallRationale = String(meta.overall_override_why ?? '');
    out.overallDirection = legacyDirection(meta.overall_direction);
    out.prelimConfirmed = out.judgement.some(Boolean);
  }
  return out;
}

export interface RecordView {
  d1: StudyD1;
  assessments: Map<string, Assessment>;
}

export function readRecord(
  data: Record<string, any> | undefined, ctx: ReadContext, tableField = ASSESSMENT_TABLE,
): RecordView {
  const view: RecordView = { d1: readStudyD1(data, ctx.binding), assessments: new Map() };
  if (!data) return view;
  for (const row of assessmentEntries(data, tableField)) {
    const id = cellValue(row, RESULT_ID_COLUMN);
    if (!id) continue;
    view.assessments.set(id, readAssessment(row, data, ctx));
  }
  return view;
}

// ── Derived state ────────────────────────────────────────────────────────────

export interface Derived {
  merged: Answers;
  /** Algorithm suggestion per domain. */
  suggestions: ReturnType<typeof suggestDomain>[];
  overallSuggestion: ReturnType<typeof suggestOverall>;
  /** Asked / answered / not-applicable counts per domain. */
  counts: Array<{ answered: number; applicable: number; notApplicable: number; waiting: number }>;
  /** A judgement differing from the suggestion needs a rationale. */
  needsRationale: boolean[];
  overallNeedsRationale: boolean;
  /** The domain's answers support a judgement (the algorithm can suggest one). */
  judgeable: boolean[];
  /** Domain can be confirmed: judgeable, judged, and rationale present where required. */
  domainReady: boolean[];
  /** The most severe domain judgement so far — the floor for the overall. */
  worstDomain: Judgement | null;
  /** The overall is milder than a domain judgement, which RoB 2 does not allow. */
  overallTooLow: boolean;
  canComplete: boolean;
  status: AssessmentStatus;
}

export function derive(study: StudyD1, a: Assessment): Derived {
  const merged = mergedAnswers(study, a);
  const opts = pathwayOf(a);
  const route = routeAllFor(merged, opts);
  const questions = questionsFor(a.effect);
  const suggestions = [0, 1, 2, 3, 4].map(i => suggestDomain(i, merged, opts));
  const counts = [0, 1, 2, 3, 4].map(i => {
    const qs = questions.filter(q => q.domain === i);
    const asked = qs.filter(q => route[q.id] === 'asked');
    return {
      answered: asked.filter(q => merged[q.id]).length,
      applicable: asked.length,
      notApplicable: qs.filter(q => route[q.id] === 'skipped').length,
      waiting: qs.filter(q => route[q.id] === 'waiting').length,
    };
  });
  const needsRationale = a.judgement.map((j, i) =>
    !!j && !!suggestions[i].severity && j !== suggestions[i].severity);
  // A domain is ready only when its signalling questions support a judgement
  // (the algorithm can suggest one): a pick with no answers behind it is a
  // label nobody reasoned, and it used to be enough to complete the assessment.
  const judgeable = suggestions.map(s => s.severity !== null);
  const domainReady = a.judgement.map((j, i) =>
    !!j && judgeable[i] && (!needsRationale[i] || !!a.rationale[i].trim()));
  const overallSuggestion = suggestOverall(a.judgement);
  const overallNeedsRationale = !!a.overall && !!overallSuggestion.severity
    && a.overall !== overallSuggestion.severity;
  // RoB 2: the overall is at least as severe as the worst domain. Escalating
  // (e.g. several Some concerns → High) is allowed with a rationale; judging
  // the overall milder than a domain is not.
  const worstDomain = a.judgement.reduce<Judgement | null>(
    (w, j) => (j && (!w || RANK[j] > RANK[w]) ? j : w), null);
  const overallTooLow = !!a.overall && !!worstDomain && RANK[a.overall] < RANK[worstDomain];
  const canComplete = a.prelimConfirmed && domainReady.every(Boolean) && !!a.overall && !overallTooLow
    && (!overallNeedsRationale || !!a.overallRationale.trim());
  const touched = a.prelimConfirmed || Object.keys(a.answers).length > 0 || a.judgement.some(Boolean);
  const status: AssessmentStatus = a.complete ? 'complete' : touched ? 'progress' : 'none';
  return {
    merged, suggestions, overallSuggestion, counts, needsRationale, overallNeedsRationale,
    judgeable, domainReady, worstDomain, overallTooLow, canComplete, status,
  };
}

/** Severity order, for "at least as severe as". */
export const RANK: Record<Judgement, number> = { low: 0, some: 1, high: 2 };

/** The judgement a summary shows for an assessment: the overall once complete. */
export function finalJudgements(a: Assessment | null | undefined): { domains: (Judgement | null)[]; overall: Judgement | null } {
  if (!a) return { domains: [null, null, null, null, null], overall: null };
  return { domains: [...a.judgement], overall: a.overall };
}

/**
 * Do two completed assessments agree? On the five domain judgements and the
 * overall — the things a review reports. Signalling answers may differ without
 * a disagreement; the adjudicator still sees them side by side.
 */
export function compareAssessments(a: Assessment, b: Assessment): { agree: boolean; differs: number[]; overallDiffers: boolean } {
  const differs = [0, 1, 2, 3, 4].filter(i => a.judgement[i] !== b.judgement[i]);
  const overallDiffers = a.overall !== b.overall;
  return { agree: differs.length === 0 && !overallDiffers, differs, overallDiffers };
}

// ── Writing ──────────────────────────────────────────────────────────────────

function restrictTo(binding: SignallingBinding, ids: Iterable<string>): SignallingBinding {
  const keep = new Set(ids);
  const questions = binding.questions.filter(b => keep.has(b.question.id));
  return { questions, coverage: questions.filter(b => b.column).length, usable: binding.usable, missing: [] };
}

function evidenceFrom(quotes: Record<string, QuoteRef>, ids: Iterable<string>) {
  // `writeAnswers` keeps an existing quote only while the answer is unchanged
  // when no evidence is passed; passing an entry — even empty — is how an
  // unlinked quote is actually removed.
  const out: Record<string, QuoteRef> = {};
  for (const id of ids) out[id] = quotes[id] ?? { quote: '', locator: '' };
  return out;
}

/** Write the study's D1 at the record root and mark the record schema 3. */
export function writeStudyD1(
  existing: Record<string, any> | undefined, binding: SignallingBinding, d1: StudyD1,
): Record<string, any> {
  const b = restrictTo(binding, D1_QUESTIONS);
  let record: Row = { ...(existing ?? {}) };
  record = writeAnswers(record, b, pick(d1.answers, D1_QUESTIONS), d1.support,
    evidenceFrom(d1.quotes, Object.keys(pick(d1.answers, D1_QUESTIONS))));
  record = clearRoutedOut(record, b, new Set(Object.keys(pick(d1.answers, D1_QUESTIONS))));
  record[ROOT_SCHEMA] = SCHEMA;
  record.rob_instrument = 'rob2';
  record.rob_instrument_version = INSTRUMENT_VERSION;
  return record;
}

export interface WriteAssessmentInput {
  assessment: Assessment;
  study: StudyD1;
  /** The RoB form's domain judgement columns, so the grid and exports keep reading them. */
  domains: BoundDomain[];
  tool: RobTool;
  tableField?: string;
}

/**
 * Fold one assessment into the record. Preserves every other entry and every
 * column this page does not know about — a save rewrites the whole record.
 */
export function writeAssessment(
  existing: Record<string, any> | undefined, binding: SignallingBinding, input: WriteAssessmentInput,
): Record<string, any> {
  const a = input.assessment;
  const d = derive(input.study, a);
  const ownIds = ROB2_QUESTIONS.map(q => q.id).filter(id => (a.d1Override ? true : !isD1(id)));
  const b = restrictTo(binding, ownIds);
  const route = routeAllFor(d.merged, pathwayOf(a));
  const asked = new Set(ownIds.filter(id => route[id] === 'asked'));
  const answers = pick(a.answers, asked);

  const apply = (row: Row): Row => {
    let next = writeAnswers(row, b, answers, a.support, evidenceFrom(a.quotes, Object.keys(answers)));
    next = clearRoutedOut(next, b, new Set(Object.keys(answers)));
    next[RESULT_ID_COLUMN] = a.targetId;
    next[RESULT_LABEL_COLUMN] = a.label;
    if (a.resultVersion !== null) next[RESULT_VERSION_COLUMN] = a.resultVersion;

    // Judgement columns are a cache for the grid, exports and synthesis.
    input.domains.forEach((domain, i) => {
      if (i > 4 || !domain.column) return;
      const j = a.judgement[i];
      if (!j) { next[domain.column] = ''; return; }
      const label = input.tool.judgments.find(x => input.tool.severity[x] === j);
      const option = label ? toFormOption(label, domain.formOptions, input.tool) : null;
      if (option && !('ambiguous' in option)) next[domain.column] = option.option;
      if (domain.rationaleColumn) next[domain.rationaleColumn] = a.rationale[i] ?? '';
    });

    const overrides: Record<string, string> = {};
    const overrideWhy: Record<string, string> = {};
    a.judgement.forEach((j, i) => {
      if (j && d.needsRationale[i]) { overrides[String(i)] = j; overrideWhy[String(i)] = a.rationale[i]; }
    });

    next[META_COLUMN] = JSON.stringify({
      schema: SCHEMA,
      target: a.kind,
      effect: a.effect,
      deviation_types: a.effect === 'adherence' ? a.deviations : undefined,
      d1_override: a.d1Override || undefined,
      judgement: Object.fromEntries(a.judgement.map((j, i) => [String(i), j])),
      suggested: Object.fromEntries(d.suggestions.map((s, i) => [String(i), s.severity])),
      rationale: Object.fromEntries(a.rationale.map((t, i) => [String(i), t])),
      direction: Object.fromEntries(a.direction.map((t, i) => [String(i), t])),
      overall: a.overall,
      overall_suggested: d.overallSuggestion.severity,
      overall_rationale: a.overallRationale,
      overall_direction: a.overallDirection,
      complete: a.complete,
      prelim_confirmed: a.prelimConfirmed,
      experimental: a.experimental,
      comparator: a.comparator,
      result_location: a.resultLocation,
      sources_obtained: a.sourcesObtained,
      reopened_because: a.reopenedBecause || undefined,
      revisions: a.revisions.length ? a.revisions : undefined,
      ai_log: a.aiLog && a.aiLog.length ? a.aiLog : undefined,
      // Read by the Sep 15 backend readers (export, consensus) until they move.
      confirmed: a.judgement.map(Boolean),
      overrides,
      override_why: overrideWhy,
      overall_override: d.overallNeedsRationale ? a.overall : null,
      overall_override_why: d.overallNeedsRationale ? a.overallRationale : '',
      overall_direction_label: a.overallDirection,
      instrument: 'rob2',
      instrument_version: INSTRUMENT_VERSION,
    });
    return next;
  };

  const table = input.tableField || ASSESSMENT_TABLE;
  const record: Row = { ...(existing ?? {}) };
  const rows = assessmentEntries(existing, table);
  const index = rows.findIndex(r => cellValue(r, RESULT_ID_COLUMN) === a.targetId);
  const nextRows = index >= 0 ? rows.map((r, i) => (i === index ? apply(r) : r)) : [...rows, apply({})];
  // Always a BARE row list. Round-tripping the stored `{value: [...]}`
  // envelope is what the server's table merge used to read as zero rows,
  // wiping every assessment after a record's first save.
  record[table] = nextRows;
  return record;
}

/**
 * The record without one assessment entry (Delete assessment). Everything
 * else — other entries, the study's D1, unknown columns — is kept, and the
 * table is posted as a bare list (see writeAssessment).
 */
export function removeAssessment(
  existing: Record<string, any> | undefined, targetId: string, tableField = ASSESSMENT_TABLE,
): Record<string, any> {
  const table = tableField || ASSESSMENT_TABLE;
  const record: Row = { ...(existing ?? {}) };
  record[table] = assessmentEntries(existing, table)
    .filter(r => cellValue(r, RESULT_ID_COLUMN) !== targetId);
  return record;
}

/** Save a whole view: D1 at the root, then one assessment. */
export function writeRecord(
  existing: Record<string, any> | undefined, binding: SignallingBinding,
  input: WriteAssessmentInput,
): Record<string, any> {
  return writeAssessment(writeStudyD1(existing, binding, input.study), binding, input);
}

export { parseAnswer };

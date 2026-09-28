/**
 * The synthesis workspace, as a pure function of stored decisions and data.
 *
 * SPEC.md §1: human decisions create state, the engine creates numbers. So
 * nothing in here is remembered between calls — every status the UI shows
 * (eligible, needs decision, ready, stale, finalized, needs review) is derived
 * from three inputs:
 *
 *   1. the extracted rows of the target's source form (one per document,
 *      highest trust first),
 *   2. the form-level mapping on the protocol (`source_forms`), and
 *   3. the group's append-only decision ledger — the latest un-revoked row per
 *      (kind, target_ref) is in force.
 *
 * No React, no services: `lib/__checks__/synthesisModel.check.mts` runs this
 * under plain Node.
 *
 * Deadlocks in the design mock that this file deliberately does NOT copy:
 *  - a rejected source row is RESOLVED (reviewed and excluded), not a row that
 *    blocks finalization forever;
 *  - the prespecified "exclude derived SDs" sensitivity is computed by the
 *    engine on every run when it is planned, so it can never be "triggered but
 *    not run";
 *  - Run is never gated: with blocking items open it becomes an explicit
 *    partial draft over the ready studies;
 *  - every reason is typed by the reviewer — nothing here writes one.
 */

import {
  isRatioMeasure, poolingMethodsFor, runMetaAnalysis,
  type Arm, type EffectMeasure, type MetaOptions, type MetaResult, type MetaStudy,
  type PoolingModel, type PrecomputedEffect,
} from '@/lib/metaAnalysis';
import type { LongFormatRow } from '@/lib/longFormatTransform';
import type {
  AuditRow, DecisionKind, PlannedAnalysis, SynthesisDecision, SynthesisDefault,
  SynthesisGroup, SynthesisKind, SynthesisPreset, SynthesisRun, SynthesisSourceForm,
  SynthesisTarget, SynthesisVersion,
} from '@/services/synthesis.service';
import {
  ALL_COMPARISONS, EXCLUSION_TEXT, buildPairings, buildStudies, classifyVariability,
  detectArmLabelColumns, detectCentralTendencyMeasureColumn, detectComparisonColumn,
  detectVariabilityMeasureColumn, facetsOf, isMedian, reasonFromNotEstimable,
  type CentralTendencyAction, type ExcludedStudy, type Facets, type Pairing, type VariabilityAction,
} from './buildStudies';
import { allConfirmed, effectOptions, type Mapping, type SlotKey } from './mapping';
import {
  normalizeDuration, suggestDirections, tallyScales, tallyValues,
  type Confirmations, type Directions, type Harmonization,
} from './reconcile';
import { leaveOneOut, subgroupAnalysis } from './diagnostics';
import { canonicalJson, sha256Hex } from './datasetHash';

export const ENGINE_VERSION = 'evistream-meta 2026.09 (lib/metaAnalysis.ts)';

// ── Small helpers ────────────────────────────────────────────────────────────

export function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The decision in force for (kind, ref): the latest un-revoked one. */
export function inForce(
  decisions: SynthesisDecision[], kind: DecisionKind, ref: string,
): SynthesisDecision | null {
  let best: SynthesisDecision | null = null;
  for (const d of decisions) {
    if (d.kind !== kind || d.target_ref !== ref || d.revoked_at) continue;
    if (!best || d.at >= best.at) best = d;
  }
  return best;
}

export function decisionsOfKind(decisions: SynthesisDecision[], kind: DecisionKind): SynthesisDecision[] {
  const latest = new Map<string, SynthesisDecision>();
  for (const d of decisions) {
    if (d.kind !== kind || d.revoked_at) continue;
    const cur = latest.get(d.target_ref);
    if (!cur || d.at >= cur.at) latest.set(d.target_ref, d);
  }
  return [...latest.values()];
}

export const studyRef = (documentId: string) => `study:${documentId}`;
export const transformRef = (documentId: string, kind: string) => `study:${documentId}:transform:${kind}`;
export const labelRef = (label: string) => `label:${norm(label)}`;
export const analysisRef = (id: string) => `analysis:${id}`;
export const PRESET_REF = 'analysis:preset';
export const POOLING_REF = 'group';
export const SWIM_GROUPING_REF = 'swim:grouping';

/**
 * The LABEL identity of a candidate result: study + outcome + timepoint +
 * comparison. Two distinct rows can share it (two rows both labelled "Pain
 * VAS · 12 weeks · Drug A vs placebo"), so it is NOT the candidate's id when
 * that happens — see `resultRefsOf`. Kept as the legacy id: decisions saved
 * before row-level ids existed hold this string.
 */
export function resultRef(p: Pick<Pairing, 'documentId' | 'outcome' | 'timepoint' | 'comparison'>): string {
  return `result:${p.documentId}|${norm(p.outcome)}|${norm(p.timepoint)}|${norm(p.comparison)}`;
}

/**
 * Fingerprint of what extracted rows SAY: every non-underscore cell, key-order
 * independent (canonical JSON), so a reload of the same data gives the same
 * string and any edited cell gives a different one. Underscore fields
 * (`_resultId`, `_rawCells`, …) are bookkeeping, not content.
 */
export function rowContentFingerprint(rows: Array<LongFormatRow | null | undefined>): string {
  const seen = new Set<LongFormatRow>();
  const content: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    if (!r || seen.has(r)) continue;
    seen.add(r);
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (!k.startsWith('_')) o[k] = v === undefined || v === null ? '' : String(v);
    content.push(o);
  }
  return sha256Hex(canonicalJson(content)).slice(0, 16);
}

/** The rows a pairing reads (treatment, and the comparator when it is a separate row). */
export function pairingFingerprint(p: Pick<Pairing, 'treatmentRow' | 'comparatorRow'>): string {
  return rowContentFingerprint([p.treatmentRow, p.comparatorRow]);
}

/**
 * Unique, reload-stable ids for a set of pairings. A pairing whose label
 * identity (`resultRef`) is unique keeps it unchanged, so every existing
 * decision still resolves. Pairings that share one get
 * `<label id>#<row fingerprint>` — and, only for byte-identical rows,
 * `~<ordinal>` in input order — so selecting the second of two tied rows can
 * never silently resolve to the first.
 */
export function resultRefsOf(pairings: Pairing[]): Map<Pairing, string> {
  const byBase = new Map<string, Pairing[]>();
  for (const p of pairings) {
    const b = resultRef(p);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b)!.push(p);
  }
  const out = new Map<Pairing, string>();
  for (const [base, list] of byBase) {
    if (list.length === 1) { out.set(list[0], base); continue; }
    const fpCount = new Map<string, number>();
    const fps = list.map(p => pairingFingerprint(p));
    for (const f of fps) fpCount.set(f, (fpCount.get(f) ?? 0) + 1);
    const ordinal = new Map<string, number>();
    list.forEach((p, i) => {
      const f = fps[i];
      if ((fpCount.get(f) ?? 0) === 1) { out.set(p, `${base}#${f}`); return; }
      const n = (ordinal.get(f) ?? 0) + 1;
      ordinal.set(f, n);
      out.set(p, `${base}#${f}~${n}`);
    });
  }
  return out;
}

// ── Timepoints ───────────────────────────────────────────────────────────────

const WEEKS_PER: Array<[RegExp, number]> = [
  [/^(minutes?|mins?|m)$/, 1 / 10080],
  [/^(hours?|hrs?|h)$/, 1 / 168],
  [/^(days?|d)$/, 1 / 7],
  [/^(weeks?|wks?|wk|w)$/, 1],
  [/^(months?|mos?|mo)$/, 4.345],
  [/^(years?|yrs?|y)$/, 52.18],
];

function unitWeeks(unit: string): number | null {
  for (const [re, f] of WEEKS_PER) if (re.test(unit)) return f;
  return null;
}

/**
 * A timepoint in weeks, when the text names exactly one duration.
 *
 * "12 weeks", "84 days", "3 months", "week 12", "12-week follow-up" resolve;
 * "NR", "end of treatment", "6–8 weeks" and a bare "12" return null — an
 * unknown timepoint is a question for the reviewer (SPEC §4: NR → unknown,
 * never auto-matched), not something to guess.
 */
export function weeksOf(text: unknown): number | null {
  const t = norm(text);
  if (!t) return null;
  const minutes = normalizeDuration(t);
  if (minutes !== null) return minutes / 10080;
  if (/\d\s*(?:-|–|to)\s*\d/.test(t)) return null;
  const hits = new Set<number>();
  const re1 = /(\d+(?:[.,]\d+)?)\s*-?\s*([a-z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(t))) {
    const f = unitWeeks(m[2]);
    if (f !== null) hits.add(Math.round(Number(m[1].replace(',', '.')) * f * 1000) / 1000);
  }
  const re2 = /\b(week|wk|day|month|year)s?\s*(\d+(?:[.,]\d+)?)\b/g;
  while ((m = re2.exec(t))) {
    const f = unitWeeks(m[1]);
    if (f !== null) hits.add(Math.round(Number(m[2].replace(',', '.')) * f * 1000) / 1000);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

export function formatWeeks(w: number | null): string {
  if (w === null) return 'unknown';
  if (w < 1 / 7 * 0.99) return `${+(w * 168).toFixed(1)} h`;
  if (w < 1) return `${+(w * 7).toFixed(1)} d`;
  return `${+w.toFixed(1)} wk`;
}

// ── Outcome labels ───────────────────────────────────────────────────────────

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'score', 'scores', 'scale', 'total', 'mean', 'change',
  'at', 'of', 'in', 'on', 'to', 'by', 'or', 'vs', 'versus', 'level', 'outcome', 'measure',
  'week', 'weeks', 'day', 'days', 'hour', 'hours', 'month', 'months', 'baseline', 'follow',
]);

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)));
}

/** Whether a free-text label plausibly names the target outcome (a shared content word). */
export function labelRelated(label: string, target: SynthesisTarget): boolean {
  const lt = tokens(label);
  const ref = tokens([target.outcome, ...(target.outcome_labels ?? [])].join(' '));
  for (const w of lt) if (ref.has(w)) return true;
  return false;
}

export function labelDirect(label: string, target: SynthesisTarget): boolean {
  const l = norm(label);
  if (!l) return false;
  if (l === norm(target.outcome)) return true;
  return (target.outcome_labels ?? []).some(x => norm(x) === l);
}

// ── Mapping ──────────────────────────────────────────────────────────────────

/** A stored form-level mapping as the slot map buildStudies reads. Stored = confirmed. */
export function mappingOf(sf: SynthesisSourceForm | null | undefined): Mapping {
  const out: Mapping = {};
  if (!sf) return out;
  for (const [slot, col] of Object.entries(sf.mapping ?? {})) {
    if (col) out[slot as SlotKey] = { col, status: 'confirmed' };
  }
  return out;
}

export interface SourceUnits {
  variabilityActions: Record<string, VariabilityAction>;
  centralActions: Record<string, CentralTendencyAction>;
  harmonizeChoices: Harmonization;
  harmonizeConfirmed: Confirmations;
  directionChoices: Directions;
  proportionMethod: 'glmm' | 'arcsine' | 'logit' | 'raw';
  /** The spread-type column chosen on the mapping screen; null when none was saved. */
  variabilityMeasureColumn: string | null;
  /** The central-tendency-type column chosen on the mapping screen; null when none was saved. */
  centralMeasureColumn: string | null;
}

export function unitsOf(sf: SynthesisSourceForm | null | undefined): SourceUnits {
  const u = (sf?.units ?? {}) as Record<string, any>;
  return {
    variabilityActions: (u.variabilityActions ?? {}) as Record<string, VariabilityAction>,
    centralActions: (u.centralActions ?? {}) as Record<string, CentralTendencyAction>,
    harmonizeChoices: (u.harmonizeChoices ?? {}) as Harmonization,
    harmonizeConfirmed: (u.harmonizeConfirmed ?? {}) as Confirmations,
    directionChoices: (u.directionChoices ?? {}) as Directions,
    proportionMethod: (u.proportionMethod ?? 'glmm') as SourceUnits['proportionMethod'],
    variabilityMeasureColumn: typeof u.variabilityMeasureColumn === 'string' && u.variabilityMeasureColumn ? u.variabilityMeasureColumn : null,
    centralMeasureColumn: typeof u.centralMeasureColumn === 'string' && u.centralMeasureColumn ? u.centralMeasureColumn : null,
  };
}

export function sourceFormReady(sf: SynthesisSourceForm | null | undefined): boolean {
  if (!sf || !sf.confirmed_at) return false;
  const m = mappingOf(sf);
  return allConfirmed(m, sf.kind, sf.layout) && (sf.layout === 'wide' || !!sf.comparator_value);
}

export function scaleColumnOf(columns: string[], mapping: Mapping): string | null {
  const named = columns.find(c => /scale.*name|^scale$|instrument/i.test(c));
  return named ?? mapping.outcome?.col ?? null;
}

// ── Presets ──────────────────────────────────────────────────────────────────

export const DEFAULT_PRESET: SynthesisPreset = { model: 'random', tau2: 'reml', ci: 'hk' };

export function presetLabel(p: SynthesisPreset): string {
  if (p.model === 'random') {
    return `RE · ${p.tau2 === 'reml' ? 'REML' : p.tau2 === 'pm' ? 'PM' : 'DL'} τ² · ${p.ci === 'hk' ? 'HK' : 'z'}`;
  }
  return p.model === 'fixed' ? 'Common-effect · IV' : p.model === 'mh' ? 'Common-effect · M–H' : 'Common-effect · Peto';
}

export function presetEquals(a: SynthesisPreset, b: SynthesisPreset): boolean {
  if (a.model !== b.model) return false;
  if (a.model !== 'random') return true;
  return a.tau2 === b.tau2 && a.ci === b.ci;
}

/**
 * Is (kind, measure, preset) a tuple the engine can compute? Returns the
 * reason when not, so the protocol screen can say why instead of refusing.
 */
export function validateDefault(d: SynthesisDefault): { ok: boolean; note: string } {
  const measures = effectOptions(d.kind);
  if (!measures.includes(d.measure as EffectMeasure)) {
    return { ok: false, note: `${d.measure} is not a measure for ${d.kind} data` };
  }
  const models = poolingMethodsFor(d.measure as EffectMeasure, d.kind === 'dichotomous' || d.kind === 'continuous');
  if (!models.includes(d.preset.model)) {
    return { ok: false, note: `${d.preset.model === 'peto' ? 'Peto' : 'Mantel–Haenszel'} is not computable for ${d.measure}` };
  }
  if (d.preset.model !== 'random' && d.preset.ci === 'hk') {
    return { ok: false, note: 'Hartung–Knapp applies to random effects only' };
  }
  return { ok: true, note: d.preset.model === 'random' ? 'Random effects, prediction interval from k ≥ 5' : 'Common-effect — no between-study variance' };
}

export function defaultFor(defaults: SynthesisDefault[], kind: SynthesisKind): SynthesisDefault {
  return defaults.find(d => d.kind === kind)
    ?? { kind, measure: effectOptions(kind)[0], preset: DEFAULT_PRESET };
}

export function metaOptionsFor(preset: SynthesisPreset, extra: MetaOptions = {}): MetaOptions {
  return { ...extra, tau2Method: preset.model === 'random' ? preset.tau2 : 'dl', ciMethod: preset.model === 'random' ? preset.ci : 'z' };
}

/**
 * The result as it should be read: with `ci: 'hk'` the reported interval is
 * the Hartung–Knapp one, so `pooled.lo/hi` are swapped for it (the z interval
 * is kept on `zInterval`). Same point estimate either way.
 */
export function readAs(result: MetaResult): MetaResult & { zInterval: { lo: number; hi: number } | null } {
  const z = result.pooled ? { lo: result.pooled.lo, hi: result.pooled.hi } : null;
  if (result.ciMethod === 'hk' && result.pooled && result.hksj) {
    return { ...result, pooled: { ...result.pooled, lo: result.hksj.lo, hi: result.hksj.hi }, zInterval: z };
  }
  return { ...result, zInterval: z };
}

// ── Candidates and eligibility ───────────────────────────────────────────────

export type Eligibility = 'eligible' | 'needs_decision' | 'not_eligible';
export type NeedKind = 'instrument' | 'eligibility' | 'tie';

export interface CandidateResult {
  /** Unique per row (see `resultRefsOf`); equals `legacyRef` unless labels collide. */
  ref: string;
  /** The label identity (`resultRef`) — what decisions saved before row-level ids hold. */
  legacyRef: string;
  documentId: string;
  label: string;
  pairing: Pairing;
  outcome: string;
  timepoint: string;
  comparison: string;
  weeks: number | null;
  eligibility: Eligibility;
  /** Machine code for the eligibility, for tests and chips. */
  reasonCode: string;
  reason: string;
  need: NeedKind | null;
  decidedBy: string | null;
  /** The outcome was matched by a human instrument decision rather than by label. */
  matchedByDecision: boolean;
  deviation: boolean;
  /**
   * The row runs comparator-first ("placebo vs Drug A"). Once the orientation is
   * accepted its arms are swapped (or its effect reversed) before it enters the
   * dataset, so the number always reads as the target's intervention − comparator.
   */
  reversed: boolean;
}

function comparisonCheck(p: Pairing, target: SynthesisTarget): { ok: boolean; reversed: boolean } {
  const iv = norm(target.comparison?.intervention);
  const cp = norm(target.comparison?.comparator);
  if (!iv && !cp) return { ok: true, reversed: false };
  const c = norm(p.comparison);
  if (!c || c === norm(ALL_COMPARISONS)) return { ok: true, reversed: false };
  const ii = iv ? c.indexOf(iv) : -1;
  const ci = cp ? c.indexOf(cp) : -1;
  if (iv && ii < 0) return { ok: false, reversed: false };
  if (cp && ci < 0) return { ok: false, reversed: false };
  if (iv && cp && ci < ii) return { ok: true, reversed: true };
  return { ok: true, reversed: false };
}

/**
 * One candidate result against the target. Returns null for rows about a
 * different outcome altogether — those are counted, not listed.
 */
export function evaluateCandidate(
  p: Pairing, target: SynthesisTarget, decisions: SynthesisDecision[],
  /** The unique id from `resultRefsOf`; defaults to the label identity. */
  uniqueRef?: string,
): CandidateResult | null {
  const legacyRef = resultRef(p);
  const ref = uniqueRef ?? legacyRef;
  // Include / exclude / deviation decisions are about the labels (timepoint,
  // orientation, window), so one recorded under the label identity still
  // applies to every row that carries those labels.
  const forResult = (kind: DecisionKind) => inForce(decisions, kind, ref)
    ?? (ref !== legacyRef ? inForce(decisions, kind, legacyRef) : null);
  const base = {
    ref, legacyRef, documentId: p.documentId, label: p.label, pairing: p,
    outcome: p.outcome, timepoint: p.timepoint, comparison: p.comparison,
    decidedBy: null as string | null, matchedByDecision: false, deviation: false, reversed: false,
  };
  const weeks = weeksOf(p.timepoint) ?? (p.timepoint ? null : weeksOf(p.outcome));
  const out = (eligibility: Eligibility, reasonCode: string, reason: string, need: NeedKind | null = null): CandidateResult =>
    ({ ...base, weeks, eligibility, reasonCode, reason, need });

  // 1 — outcome
  let instrumentPending = false;
  if (!labelDirect(p.outcome, target)) {
    const d = inForce(decisions, 'instrument_match', labelRef(p.outcome));
    if (d && d.value?.accepted === true) {
      base.matchedByDecision = true;
      base.decidedBy = d.by_name ?? d.by;
    } else if (d && d.value?.accepted === false) {
      return out('not_eligible', 'outcome_rejected', `“${p.outcome}” judged a different construct${d.reason ? ` — ${d.reason}` : ''}`);
    } else if (labelRelated(p.outcome, target)) {
      instrumentPending = true;
    } else {
      return null;
    }
  }

  // 2 — comparison and orientation
  const cmp = comparisonCheck(p, target);
  base.reversed = cmp.ok && cmp.reversed;
  if (!cmp.ok) return out('not_eligible', 'comparison_mismatch', `comparison “${p.comparison}” is not the target comparison`);

  // 3 — time window
  const lo = target.window?.lo ?? null;
  const hi = target.window?.hi ?? null;
  const windowed = lo !== null || hi !== null;
  let timeUnknown = false;
  if (windowed) {
    if (weeks === null) timeUnknown = true;
    else if ((lo !== null && weeks < lo - 1e-9) || (hi !== null && weeks > hi + 1e-9)) {
      const dev = forResult('deviation');
      if (dev && dev.value?.include === true) {
        base.deviation = true;
        base.decidedBy = dev.by_name ?? dev.by;
      } else {
        return out('not_eligible', 'outside_window',
          `${formatWeeks(weeks)} is outside the ${lo ?? '…'}–${hi ?? '…'} week window`);
      }
    }
  }

  if (instrumentPending) {
    return out('needs_decision', 'outcome_unmatched',
      `“${p.outcome}” is not one of the target's outcome labels — does it measure ${target.outcome}?`, 'instrument');
  }

  if (timeUnknown || cmp.reversed) {
    const d = forResult('eligibility');
    if (d && d.value?.include === true) {
      return { ...out('eligible', 'human_include', d.reason ?? 'Included by decision'), decidedBy: d.by_name ?? d.by };
    }
    if (d && d.value?.include === false) {
      return { ...out('not_eligible', 'human_exclude', d.reason ?? 'Excluded by decision'), decidedBy: d.by_name ?? d.by };
    }
    return timeUnknown
      ? out('needs_decision', 'timepoint_unknown',
        `timepoint “${p.timepoint || 'not reported'}” cannot be placed in the window — never matched automatically`, 'eligibility')
      : out('needs_decision', 'orientation', `“${p.comparison}” runs comparator-first — confirm it is the target contrast`, 'eligibility');
  }

  if (base.deviation) return out('eligible', 'deviation', 'Included outside the window by a logged protocol deviation');
  if (base.matchedByDecision) return out('eligible', 'outcome_matched', `“${p.outcome}” accepted as ${target.outcome}`);
  return out('eligible', windowed ? 'in_window' : 'eligible', windowed ? `${formatWeeks(weeks)} · inside the window` : 'Matches the target');
}

/** Rank eligible candidates by the target's structured selection rule. */
export function rankCandidates(cands: CandidateResult[], target: SynthesisTarget): CandidateResult[] {
  const rule = target.selection_rule;
  const prefer = (rule?.prefer_instrument ?? []).map(norm);
  const instrumentRank = (c: CandidateResult) => {
    const o = norm(c.outcome);
    const i = prefer.findIndex(x => x && (o === x || o.includes(x)));
    return i < 0 ? prefer.length : i;
  };
  const timeKey = (c: CandidateResult) => {
    if (c.weeks === null) return Number.POSITIVE_INFINITY;
    if (rule?.timepoint_rule === 'latest') return -c.weeks;
    if (rule?.timepoint_rule === 'earliest') return c.weeks;
    const t = rule?.timepoint_target_weeks;
    if (t === null || t === undefined) return 0;
    return Math.abs(c.weeks - t);
  };
  return [...cands].sort((a, b) => instrumentRank(a) - instrumentRank(b) || timeKey(a) - timeKey(b));
}

function sameRank(a: CandidateResult, b: CandidateResult, target: SynthesisTarget): boolean {
  const r = rankCandidates([a, b], target);
  const r2 = rankCandidates([b, a], target);
  return r[0] !== r2[0];
}

// ── Source review ────────────────────────────────────────────────────────────

export type Trust = 'consensus' | 'manual' | 'ai';
export type SourceReview =
  | 'reviewed' | 'unreviewed' | 'accepted' | 'corrected' | 'rejected' | 'correction_requested';

export function trustOf(row: LongFormatRow | undefined): Trust {
  const t = row?._extractionType;
  return t === 'consensus' ? 'consensus' : t === 'manual' ? 'manual' : 'ai';
}

/**
 * AI-only rows start Unreviewed. Accept binds to the specific result row: to
 * the extraction record (`result_id`) AND to what the selected row says
 * (`row_fingerprint`, from `rowContentFingerprint` / `StudyView.sourceFingerprint`).
 * A fresh AI pass, an edited cell or a different selected row makes the
 * acceptance stale (`stale: true`, state back to unreviewed). When a
 * `fingerprint` is passed, an acceptance recorded without one is treated as
 * needing re-review. A requested correction resolves itself when a human row
 * replaces the AI one.
 */
export function sourceReviewOf(
  documentId: string, row: LongFormatRow | undefined, decisions: SynthesisDecision[],
  fingerprint?: string,
): { state: SourceReview; decision: SynthesisDecision | null; stale: boolean } {
  const d = inForce(decisions, 'source_review', studyRef(documentId));
  const trust = trustOf(row);
  const state = String(d?.value?.state ?? '');
  if (trust !== 'ai') {
    return { state: state === 'correction_requested' || state === 'corrected' ? 'corrected' : 'reviewed', decision: d, stale: false };
  }
  if (!d) return { state: 'unreviewed', decision: null, stale: false };
  const sameRecord = !d.value?.result_id || d.value.result_id === row?._resultId;
  const sameContent = fingerprint === undefined || d.value?.row_fingerprint === fingerprint;
  if (state === 'rejected') return { state: 'rejected', decision: d, stale: false };
  if (state === 'accepted' && sameRecord && sameContent) return { state: 'accepted', decision: d, stale: false };
  if (state === 'correction_requested') return { state: 'correction_requested', decision: d, stale: false };
  return { state: 'unreviewed', decision: d, stale: state === 'accepted' };
}

// ── Transformations ──────────────────────────────────────────────────────────

export type TransformKind =
  | 'se_to_sd' | 'ci_to_sd' | 'median_iqr_wan' | 'median_range_wan' | 'iqr_width' | 'range_width'
  | 'median_as_mean' | 'reverse_direction' | 'rescale' | 'cluster_design_effect' | 'timepoint_normalisation';

export const TRANSFORM_NAME: Record<TransformKind, string> = {
  se_to_sd: 'SE → SD',
  ci_to_sd: 'CI → SD',
  median_iqr_wan: 'Median / IQR → mean / SD (Wan 2014)',
  median_range_wan: 'Median / range → mean / SD (Wan 2014)',
  iqr_width: 'IQR → SD (width ÷ 1.35, fallback)',
  range_width: 'Range → SD (width ÷ 4, fallback)',
  median_as_mean: 'Median used as mean',
  reverse_direction: 'Scale direction reversed',
  rescale: 'Rescaled to the common scale',
  cluster_design_effect: 'Cluster design effect',
  timepoint_normalisation: 'Timepoint normalised to weeks',
};

/** Kinds whose output is a derived (not reported) SD — the prespecified sensitivity excludes these. */
export const DERIVED_SD_KINDS: TransformKind[] = [
  'se_to_sd', 'ci_to_sd', 'median_iqr_wan', 'median_range_wan', 'iqr_width', 'range_width', 'median_as_mean',
];

export type TransformState = 'open' | 'blocked' | 'confirmed' | 'engine';

export interface TransformationView {
  ref: string;
  documentId: string;
  label: string;
  kind: TransformKind;
  name: string;
  formula: string;
  detail: string;
  assumptions: string[];
  methodRef: string;
  inputs: Record<string, number>;
  state: TransformState;
  blockedBy: string | null;
  needsInput: 'icc' | null;
  decision: SynthesisDecision | null;
  derived: boolean;
  /** For rescale: multiply means and SDs by this. */
  factor?: number;
  /**
   * What this transformation acts on (kind, formula, inputs, factor and the
   * source row's contents). A confirmation binds to it: store it as
   * `value.fingerprint` when confirming (see `transformationFingerprint`).
   */
  fingerprint: string;
  /** A confirmation exists but was made against different inputs (or has no fingerprint) — re-confirm. */
  approvalStale: boolean;
}

/**
 * The fingerprint a transformation confirmation binds to. `sourceFingerprint`
 * is the selected row's `pairingFingerprint`; a changed row, a changed factor
 * (e.g. the common scale moved) or changed inputs give a different string, so
 * the old confirmation no longer applies.
 */
export function transformationFingerprint(
  t: Pick<TransformationView, 'kind' | 'formula' | 'inputs'> & { factor?: number | null },
  sourceFingerprint: string,
): string {
  return sha256Hex(canonicalJson({
    kind: t.kind, formula: t.formula ?? '', inputs: t.inputs ?? {}, factor: t.factor ?? null, source: sourceFingerprint,
  })).slice(0, 16);
}

interface ConversionLike {
  kind: string; formula?: string; assumptions?: string[]; method_ref?: string; inputs?: Record<string, number>;
}

/** ConversionRecords attached by buildStudies (study-, arm- or evidence-level). */
export function conversionsOf(s: MetaStudy): ConversionLike[] {
  const out: ConversionLike[] = [];
  const push = (arr: unknown) => {
    if (Array.isArray(arr)) for (const c of arr) if (c && typeof c === 'object' && 'kind' in c) out.push(c as ConversionLike);
  };
  const anyS = s as any;
  push(anyS.conversions);
  push(anyS.treatment?.conversions);
  push(anyS.comparator?.conversions);
  push(anyS.evidence?.conversions);
  return out;
}

const FALLBACK_FORMULA: Partial<Record<TransformKind, string>> = {
  se_to_sd: 'SD = SE × √n',
  ci_to_sd: 'SD = √n × (upper − lower) / (2 × t₀.₉₇₅,ₙ₋₁ or 3.92)',
  iqr_width: 'SD ≈ IQR / 1.35',
  range_width: 'SD ≈ range / 4',
  median_as_mean: 'mean ≈ median',
};

function scaleMax(text: string): number | null {
  const t = norm(text);
  const m = /(?:^|[^0-9.])0\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/.exec(t) ?? /(\d+)\s*mm\b/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function designEffect(m: number, icc: number): number {
  return 1 + (m - 1) * icc;
}

// ── Studies ──────────────────────────────────────────────────────────────────

export type Readiness =
  | 'ready' | 'needs_transformation' | 'missing_data' | 'pending_mapping' | 'source_unreviewed' | 'excluded';

export interface StudyView {
  documentId: string;
  ref: string;
  label: string;
  candidates: CandidateResult[];
  selected: CandidateResult | null;
  selectedBy: 'engine_rule' | 'human_decision' | 'only_candidate' | null;
  eligibility: Eligibility;
  eligibilityReason: string;
  need: NeedKind | null;
  /** The candidate whose decision is asked for (instrument / eligibility). */
  pendingCandidate: CandidateResult | null;
  trust: Trust;
  resultId: string | null;
  sourceReview: SourceReview;
  /**
   * `rowContentFingerprint` of the row the review is about. Store it as
   * `value.row_fingerprint` on a source_review decision — an acceptance without
   * it, or with a different one, counts as unreviewed.
   */
  sourceFingerprint: string | null;
  /** An acceptance exists but the row has changed since (or it predates fingerprints). */
  sourceReviewStale: boolean;
  readiness: Readiness | null;
  readinessReason: string;
  /** Built from the source row, conversions applied per the mapping's units policy. */
  built: MetaStudy | null;
  /** `built` with the confirmed transformations applied — what enters the dataset. */
  analysis: MetaStudy | null;
  transformations: TransformationView[];
  inDataset: boolean;
  derived: boolean;
  deviation: boolean;
  nRandomised: number | null;
  nEffective: number | null;
  attrs: Record<string, string>;
}

export interface DatasetRow {
  ref: string;
  document_id: string;
  label: string;
  kind: SynthesisKind;
  measure: string;
  arms?: {
    treatment?: Arm; comparator?: Arm;
    proportion?: { events: number; total: number };
    correlation?: { r: number; n: number };
  };
  effect?: { est: number; se: number; reported?: PrecomputedEffect['reported'] };
  n_randomised?: number | null;
  n_effective?: number | null;
  flip_sign?: boolean;
  cluster?: { icc: number; m: number };
  /** Arm sizes as randomised when a design effect replaced them in `arms`. */
  n_randomised_arms?: { treatment: number; comparator: number };
  outcome: string;
  timepoint: string;
  comparison: string;
  attrs: Record<string, string>;
  transformations: string[];
  derived: boolean;
}

export interface ModelInput {
  group: SynthesisGroup;
  decisions: SynthesisDecision[];
  sourceForm: SynthesisSourceForm | null;
  /** Long rows of the source form, one extraction per document. */
  rows: LongFormatRow[];
  /** Every selectable column of the source form (table columns + joined flat fields). */
  columns: string[];
  defaults: SynthesisDefault[];
  designByDocument?: Record<string, string>;
  /** Columns that can group a subgroup analysis (select columns not used by the mapping). */
  subgroupColumns?: string[];
}

export interface BlockingItem {
  kind: 'target' | 'mapping' | 'eligibility' | 'instrument' | 'source_review' | 'transformation';
  ref: string;
  label: string;
  text: string;
}

export interface SynthesisModelResult {
  targetConfirmed: boolean;
  mappingReady: boolean;
  kind: SynthesisKind;
  measure: EffectMeasure;
  protocolPreset: SynthesisPreset;
  preset: SynthesisPreset;
  presetDeviation: SynthesisDecision | null;
  proportionMethod: SourceUnits['proportionMethod'];
  candidates: CandidateResult[];
  /** Rows about other outcomes — counted, not listed. */
  unrelatedRows: number;
  /** Rows the pairing step could not turn into a result (no comparator row, …). */
  structuralExclusions: ExcludedStudy[];
  studies: StudyView[];
  transformations: TransformationView[];
  dataset: DatasetRow[];
  datasetStudies: MetaStudy[];
  blocking: BlockingItem[];
  /** Studies that could enter the dataset (eligible, or eligible once decided). */
  potential: number;
  scaleColumn: string | null;
  variabilityMeasureColumn: string | null;
  lowerIsBenefit: boolean;
}

function armN(a: Arm | undefined): number | null {
  if (!a) return null;
  return 'events' in a ? a.total : a.n;
}

function studyN(s: MetaStudy | null): number | null {
  if (!s) return null;
  if (s.treatment && s.comparator) {
    const t = armN(s.treatment); const c = armN(s.comparator);
    return t !== null && c !== null ? t + c : null;
  }
  if (s.proportion) return s.proportion.total;
  if (s.correlation) return s.correlation.n;
  return null;
}

function scaleArm(a: Arm, f: number): Arm {
  return 'events' in a ? a : { ...a, mean: a.mean * f, sd: a.sd * f };
}

function clusterArm(a: Arm, de: number): Arm {
  return 'events' in a ? { events: a.events / de, total: a.total / de } : { ...a, n: a.n / de };
}

/**
 * A comparator-first result, turned to read intervention − comparator: the arms
 * swap (means / SDs / n, or events / totals, with any per-arm conversion
 * records and randomised n), and an effect-only study is reversed — negated on
 * the analysis scale (the log scale for a ratio, i.e. the ratio inverted), with
 * the reported point estimate inverted / negated and its CI bounds swapped.
 * Single-group data (a proportion, a correlation) has no orientation.
 */
export function orientStudy(s: MetaStudy, measure: EffectMeasure): MetaStudy {
  const out: any = { ...s };
  if (s.treatment && s.comparator) {
    out.treatment = s.comparator;
    out.comparator = s.treatment;
    if (s.nRandomised) out.nRandomised = { treatment: s.nRandomised.comparator, comparator: s.nRandomised.treatment };
    const swapArm = (list: unknown) => Array.isArray(list)
      ? list.map((c: any) => c && (c.arm === 'treatment' || c.arm === 'comparator') ? { ...c, arm: c.arm === 'treatment' ? 'comparator' : 'treatment' } : c)
      : list;
    if ((s as any).conversions) out.conversions = swapArm((s as any).conversions);
  } else if (s.precomputed) {
    const p = s.precomputed;
    const r = p.reported;
    const invert = r.scale === 'natural' && isRatioMeasure(measure);
    const f = (x: number | null) => (x === null || !Number.isFinite(x) ? x : invert ? (x === 0 ? x : 1 / x) : -x);
    out.precomputed = {
      ...p, y: -p.y,
      reported: { ...r, est: f(r.est) as number, lo: f(r.hi), hi: f(r.lo) },
    };
  } else {
    return s;
  }
  out.evidence = { ...(s.evidence ?? {}), orientation_reversed: true };
  return out as MetaStudy;
}

export function applyTransformations(s: MetaStudy, list: TransformationView[]): MetaStudy {
  let out: MetaStudy = { ...s } as MetaStudy;
  for (const t of list) {
    if (t.state !== 'confirmed' && t.state !== 'engine') continue;
    if (t.kind === 'reverse_direction') out = { ...out, flipSign: !out.flipSign } as MetaStudy;
    if (t.kind === 'rescale' && t.factor && out.treatment && out.comparator) {
      out = { ...out, treatment: scaleArm(out.treatment, t.factor), comparator: scaleArm(out.comparator, t.factor) } as MetaStudy;
    }
    if (t.kind === 'cluster_design_effect' && out.treatment && out.comparator) {
      const icc = Number(t.decision?.value?.icc);
      const m = Number(t.decision?.value?.m);
      if (Number.isFinite(icc) && Number.isFinite(m) && m >= 1 && icc >= 0) {
        const de = designEffect(m, icc);
        const nr = { treatment: armN(out.treatment) ?? 0, comparator: armN(out.comparator) ?? 0 };
        out = { ...out, treatment: clusterArm(out.treatment, de), comparator: clusterArm(out.comparator, de), nRandomised: nr } as MetaStudy;
      }
    }
  }
  return out;
}

/**
 * Derive everything for one synthesis group.
 */
export function deriveModel(input: ModelInput): SynthesisModelResult {
  const { group, decisions, sourceForm } = input;
  const target = group.target;
  const kind: SynthesisKind = sourceForm?.kind ?? 'continuous';
  const def = defaultFor(input.defaults, kind);
  const measure = (target.measure_preference && effectOptions(kind).includes(target.measure_preference as EffectMeasure)
    ? target.measure_preference : def.measure) as EffectMeasure;
  const presetDeviation = inForce(decisions, 'deviation', PRESET_REF);
  const devPreset = presetDeviation?.value?.preset as SynthesisPreset | undefined;
  const preset: SynthesisPreset = devPreset && devPreset.model ? devPreset : def.preset;
  const units = unitsOf(sourceForm);
  const targetConfirmed = !!group.target_confirmed_at;
  const mappingReady = sourceFormReady(sourceForm);
  const lowerIsBenefit = target.comparison?.sign_convention !== 'positive_favours_intervention';

  const empty: SynthesisModelResult = {
    targetConfirmed, mappingReady, kind, measure, protocolPreset: def.preset, preset, presetDeviation,
    proportionMethod: units.proportionMethod,
    candidates: [], unrelatedRows: 0, structuralExclusions: [], studies: [], transformations: [],
    dataset: [], datasetStudies: [], blocking: [], potential: 0,
    scaleColumn: null, variabilityMeasureColumn: null, lowerIsBenefit,
  };
  const blocking: BlockingItem[] = [];
  if (!targetConfirmed) {
    blocking.push({ kind: 'target', ref: 'target', label: 'Target', text: 'Target not confirmed' });
  }
  if (!mappingReady || !sourceForm) {
    blocking.push({ kind: 'mapping', ref: 'mapping', label: 'Mapping', text: 'Source form mapping not confirmed' });
    return { ...empty, blocking };
  }
  // Derivation runs against the confirmed target only (SPEC §2).
  if (!targetConfirmed) return { ...empty, blocking };

  const mapping = mappingOf(sourceForm);
  const columns = input.columns;
  const comparisonColumn = detectComparisonColumn(columns);
  const armLabelColumns = detectArmLabelColumns(columns);
  // The columns saved on the mapping screen win; the name heuristic is only the
  // fallback for mappings saved before they were stored.
  const savedCol = (c: string | null) => (c && (columns.length === 0 || columns.includes(c)) ? c : null);
  const variabilityMeasureColumn = savedCol(units.variabilityMeasureColumn) ?? detectVariabilityMeasureColumn(columns);
  const centralMeasureColumn = savedCol(units.centralMeasureColumn) ?? detectCentralTendencyMeasureColumn(columns);
  const scaleColumn = scaleColumnOf(columns, mapping);

  const { pairings, excluded: structural } = buildPairings(
    input.rows, mapping, sourceForm.layout, sourceForm.comparator_value ?? '', comparisonColumn, armLabelColumns,
    { choices: units.harmonizeChoices, confirmed: units.harmonizeConfirmed },
  );

  // ── Candidates
  const candidates: CandidateResult[] = [];
  let unrelatedRows = 0;
  const refs = resultRefsOf(pairings);
  for (const p of pairings) {
    const c = evaluateCandidate(p, target, decisions, refs.get(p));
    if (c) candidates.push(c);
    else unrelatedRows++;
  }

  const byDoc = new Map<string, CandidateResult[]>();
  for (const c of candidates) {
    if (!byDoc.has(c.documentId)) byDoc.set(c.documentId, []);
    byDoc.get(c.documentId)!.push(c);
  }

  // ── Study-level selection
  type Draft = Omit<StudyView, 'built' | 'analysis' | 'transformations' | 'inDataset' | 'derived' | 'readiness' | 'readinessReason' | 'nRandomised' | 'nEffective'>;
  const drafts: Draft[] = [];
  for (const [doc, cands] of byDoc) {
    const eligible = cands.filter(c => c.eligibility === 'eligible');
    const pending = cands.filter(c => c.eligibility === 'needs_decision');
    const baseDraft = {
      documentId: doc, ref: studyRef(doc), label: cands[0].label, candidates: cands,
      deviation: false, attrs: {} as Record<string, string>,
    };
    let selected: CandidateResult | null = null;
    let selectedBy: StudyView['selectedBy'] = null;
    let eligibility: Eligibility;
    let reason = '';
    let need: NeedKind | null = null;
    let pendingCandidate: CandidateResult | null = null;

    if (pending.length > 0) {
      // Strict: an undecided sibling could outrank the eligible ones, so the
      // study waits for the decision rather than letting the rule pick around it.
      const first = pending.find(c => c.need === 'instrument') ?? pending[0];
      eligibility = 'needs_decision';
      need = first.need;
      reason = first.reason;
      pendingCandidate = first;
    } else if (eligible.length === 0) {
      eligibility = 'not_eligible';
      reason = cands[0].reason;
    } else {
      const human = inForce(decisions, 'eligibility', studyRef(doc));
      const wanted = human?.value?.selected ? String(human.value.selected) : null;
      let humanPick = wanted ? eligible.find(c => c.ref === wanted) : undefined;
      // A selection saved before row-level ids holds the label identity. It
      // still resolves when exactly one eligible row carries it; when several
      // do, it is ambiguous and asked again — never resolved to the first.
      const legacyMatches = wanted && !humanPick ? eligible.filter(c => c.legacyRef === wanted) : [];
      if (!humanPick && legacyMatches.length === 1) humanPick = legacyMatches[0];
      const unresolved = !!wanted && !humanPick;
      if (humanPick) {
        selected = humanPick; selectedBy = 'human_decision'; eligibility = 'eligible';
        reason = `Selected by ${human!.by_name ?? 'decision'}${human!.reason ? ` — ${human!.reason}` : ''}`;
      } else if (unresolved && eligible.length > 1) {
        eligibility = 'needs_decision'; need = 'tie';
        reason = legacyMatches.length > 1
          ? `The recorded selection matches ${legacyMatches.length} results with the same labels — choose one again`
          : 'The recorded selection no longer matches an eligible result (its row changed or was removed) — choose again';
      } else if (eligible.length === 1) {
        selected = eligible[0]; selectedBy = 'only_candidate'; eligibility = 'eligible'; reason = eligible[0].reason;
      } else {
        const ranked = rankCandidates(eligible, target);
        if (sameRank(ranked[0], ranked[1], target)) {
          eligibility = 'needs_decision'; need = 'tie';
          reason = `${eligible.length} eligible results tie under the selection rule — choose one`;
        } else {
          selected = ranked[0]; selectedBy = 'engine_rule'; eligibility = 'eligible';
          reason = `Engine selected from ${eligible.length} results by the protocol rule`;
        }
      }
    }
    // Source review binds to the row the study would use.
    const reviewed = selected ?? pendingCandidate ?? eligible[0] ?? pending[0] ?? cands[0];
    const row = reviewed.pairing.treatmentRow;
    const sourceFingerprint = pairingFingerprint(reviewed.pairing);
    const review = sourceReviewOf(doc, row, decisions, sourceFingerprint);
    drafts.push({
      ...baseDraft, selected, selectedBy, eligibility, eligibilityReason: reason, need, pendingCandidate,
      trust: trustOf(row), resultId: row?._resultId ?? null, sourceReview: review.state,
      sourceFingerprint, sourceReviewStale: review.stale,
      deviation: !!selected?.deviation,
    });
  }

  // ── Build the numbers for every study we can preview
  const preview = (d: Draft): CandidateResult | null =>
    d.selected ?? (d.need === 'instrument' && d.pendingCandidate ? d.pendingCandidate : null);
  const toBuild = drafts.map(preview).filter((c): c is CandidateResult => !!c);
  const built = buildStudies(toBuild.map(c => c.pairing), {
    kind, layout: sourceForm.layout, mapping, measure,
    effectScale: sourceForm.effect_scale ?? 'natural',
    variabilityMeasureColumn, centralTendencyMeasureColumn: centralMeasureColumn,
    variabilityActions: units.variabilityActions, centralTendencyActions: units.centralActions,
    // Direction is a per-study transformation decision now, never a form-level flip.
    scaleColumn, directions: {}, directionsConfirmed: {},
  });
  const builtByKey = new Map(built.studies.map(s => [s.key, s]));
  const excludedByKey = new Map(built.excluded.map(e => [e.key, e]));

  // Direction and scale reference, computed over the previewable studies.
  const scaleText = (c: CandidateResult) => (scaleColumn ? String(c.pairing.treatmentRow[scaleColumn] ?? '').trim() : '');
  const dirSuggestion = kind === 'continuous' || kind === 'effect' || kind === 'correlation'
    ? suggestDirections(tallyScales(tallyValues(toBuild.map(c => c.pairing.treatmentRow), scaleColumn)))
    : { choices: {} as Directions, reasons: {} as Record<string, string> };
  const maxCounts = new Map<number, number>();
  for (const c of toBuild) {
    const mx = scaleMax(scaleText(c));
    if (mx !== null) maxCounts.set(mx, (maxCounts.get(mx) ?? 0) + 1);
  }
  const modalMax = [...maxCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;

  const subgroupCols = input.subgroupColumns ?? [];

  const studies: StudyView[] = drafts.map(d => {
    const c = preview(d);
    const raw = c ? builtByKey.get(c.pairing.key) ?? null : null;
    // A comparator-first row whose orientation was accepted reads as the target contrast.
    const s = raw && c?.reversed ? orientStudy(raw, measure) : raw;
    const sourceFp = c ? pairingFingerprint(c.pairing) : '';
    const ex = c ? excludedByKey.get(c.pairing.key) ?? null : null;
    const attrs: Record<string, string> = {};
    if (c) {
      for (const col of subgroupCols) {
        const v = String(c.pairing.treatmentRow[col] ?? '').trim();
        if (v) attrs[col] = v;
      }
      const design = input.designByDocument?.[d.documentId];
      if (design) attrs.__design = design;
    }
    const transformations: TransformationView[] = [];
    const reviewedOk = d.sourceReview !== 'unreviewed' && d.sourceReview !== 'correction_requested' && d.sourceReview !== 'rejected';
    if (s && c && reviewedOk) {
      const add = (kind: TransformKind, t: Partial<TransformationView>) => {
        const ref = transformRef(d.documentId, kind);
        const dec = inForce(decisions, 'transformation', ref);
        const fingerprint = transformationFingerprint({
          kind, formula: t.formula ?? '', inputs: t.inputs ?? {}, factor: t.factor ?? null,
        }, sourceFp);
        // A confirmation binds to the inputs it approved; one made against other
        // inputs, or recorded before fingerprints existed, needs re-confirming.
        const approved = !!dec && dec.value?.confirmed !== false;
        const confirmed = approved && dec!.value?.fingerprint === fingerprint;
        const blocked = t.state === 'blocked';
        transformations.push({
          ref, documentId: d.documentId, label: d.label, kind, name: TRANSFORM_NAME[kind],
          formula: t.formula ?? '', detail: t.detail ?? '', assumptions: t.assumptions ?? [],
          methodRef: t.methodRef ?? '', inputs: t.inputs ?? {},
          state: t.state === 'engine' ? 'engine' : blocked ? 'blocked' : confirmed ? 'confirmed' : 'open',
          blockedBy: t.blockedBy ?? null, needsInput: t.needsInput ?? null, decision: dec,
          derived: DERIVED_SD_KINDS.includes(kind), factor: t.factor,
          fingerprint, approvalStale: approved && !confirmed && t.state !== 'engine',
        });
      };
      // 1 — conversions from the source's reported spread
      const recs = conversionsOf(s);
      const seen = new Set<string>();
      for (const r of recs) {
        const k = r.kind as TransformKind;
        if (seen.has(k) || !(k in TRANSFORM_NAME)) continue;
        seen.add(k);
        add(k, {
          formula: r.formula ?? FALLBACK_FORMULA[k] ?? '', assumptions: r.assumptions ?? [],
          methodRef: r.method_ref ?? '', inputs: r.inputs ?? {},
          detail: (r.assumptions ?? []).join('; '),
        });
      }
      if (recs.length === 0 && kind === 'continuous' && sourceForm.layout === 'long') {
        for (const row of [c.pairing.treatmentRow, c.pairing.comparatorRow]) {
          const mText = variabilityMeasureColumn ? String(row[variabilityMeasureColumn] ?? '') : '';
          const vk = variabilityMeasureColumn ? classifyVariability(mText) : 'SD';
          const action = units.variabilityActions[mText];
          const k: TransformKind | null = vk === 'SE' ? 'se_to_sd' : vk === 'CI' ? 'ci_to_sd'
            : vk === 'IQR' ? 'iqr_width' : vk === 'RANGE' ? 'range_width' : null;
          if (k && action !== 'use' && !seen.has(k)) {
            seen.add(k);
            add(k, { formula: FALLBACK_FORMULA[k], detail: `reported as “${mText}”`, assumptions: ['approximately normal outcome'] });
          }
          const ct = centralMeasureColumn ? String(row[centralMeasureColumn] ?? '') : '';
          if (isMedian(ct) && !seen.has('median_as_mean')) {
            seen.add('median_as_mean');
            add('median_as_mean', { formula: FALLBACK_FORMULA.median_as_mean, detail: `reported as “${ct}”`, assumptions: ['symmetric distribution'] });
          }
        }
      }
      // 2 — scale direction (blocked until the construct is accepted)
      const st = scaleText(c);
      // A construct decision may say the accepted label runs the other way
      // (pain relief vs pain intensity) — the one case a name alone cannot settle.
      const constructReversed = c.matchedByDecision
        && inForce(decisions, 'instrument_match', labelRef(c.outcome))?.value?.reversed === true;
      if ((st && dirSuggestion.choices[st] === 'reverse') || constructReversed) {
        add('reverse_direction', {
          formula: 'effect × −1',
          detail: constructReversed ? 'the construct decision records that this scale runs the opposite way'
            : dirSuggestion.reasons[st] ?? `“${st}” runs the other way`,
          state: d.eligibility === 'needs_decision' ? 'blocked' : undefined,
          blockedBy: d.eligibility === 'needs_decision' ? 'Construct decision pending on Evidence' : null,
          assumptions: ['the two scales measure one construct in opposite directions'],
        });
      }
      // 3 — rescale to the common scale (MD only; SMD is scale-free)
      const mx = scaleMax(st);
      if (measure === 'MD' && modalMax !== null && mx !== null && mx !== modalMax && s.treatment && s.comparator) {
        add('rescale', {
          formula: `x × ${modalMax}/${mx}`, factor: modalMax / mx,
          detail: `0–${mx} → 0–${modalMax}, the scale most studies use`,
          inputs: { from: mx, to: modalMax }, assumptions: ['linear relationship between the two scale ranges'],
        });
      }
      // 4 — cluster design effect
      const design = input.designByDocument?.[d.documentId] ?? '';
      if (/cluster/i.test(design) && s.treatment && s.comparator) {
        add('cluster_design_effect', {
          formula: 'n_eff = n / (1 + (m − 1) × ICC)', needsInput: 'icc',
          detail: `design recorded as “${design}”`, methodRef: 'Cochrane Handbook §23.1',
          assumptions: ['ICC and mean cluster size as entered'],
        });
      }
      // 5 — timepoint normalisation (engine, no confirmation)
      if (c.weeks !== null && c.timepoint && !/week|wk/i.test(c.timepoint)) {
        add('timepoint_normalisation', {
          formula: `“${c.timepoint}” = ${formatWeeks(c.weeks)}`, detail: 'duration read by the engine',
          state: 'engine',
        });
      }
    }

    // Readiness
    let readiness: Readiness | null = null;
    let readinessReason = '';
    if (d.eligibility === 'eligible') {
      if (d.sourceReview === 'rejected') { readiness = 'excluded'; readinessReason = 'Source row rejected on review'; }
      else if (d.sourceReview === 'unreviewed' || d.sourceReview === 'correction_requested') {
        readiness = 'source_unreviewed';
        readinessReason = d.sourceReview === 'correction_requested'
          ? 'Correction requested — waiting for the corrected extraction'
          : 'AI-extracted and unreviewed — review the source row';
      } else if (!s) {
        readiness = 'missing_data';
        readinessReason = ex ? EXCLUSION_TEXT[ex.reason] : 'no usable values';
      } else if (transformations.some(t => t.state === 'open' || t.state === 'blocked')) {
        readiness = 'needs_transformation';
        readinessReason = transformations.filter(t => t.state === 'open' || t.state === 'blocked')
          .map(t => (t.approvalStale ? `${t.name} (inputs changed — confirm again)` : t.name)).join(' · ');
      } else {
        readiness = 'ready';
        readinessReason = transformations.some(t => t.state === 'confirmed') ? 'Transformations confirmed' : 'Ready';
      }
    }

    const analysis = s && readiness === 'ready' ? applyTransformations(s, transformations) : null;
    const derived = transformations.some(t => t.derived && t.state === 'confirmed');
    const nRandomised = studyN(s);
    const nEffective = analysis ? studyN(analysis) : null;
    return {
      ...d, attrs, built: s, analysis, transformations, inDataset: readiness === 'ready',
      derived, readiness, readinessReason, nRandomised, nEffective,
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  // ── Dataset
  const dataset: DatasetRow[] = [];
  const datasetStudies: MetaStudy[] = [];
  for (const s of studies) {
    if (!s.inDataset || !s.analysis || !s.selected) continue;
    const a = s.analysis;
    const row: DatasetRow = {
      ref: s.ref, document_id: s.documentId, label: s.label, kind, measure,
      outcome: s.selected.outcome, timepoint: s.selected.timepoint, comparison: s.selected.comparison,
      attrs: s.attrs,
      transformations: s.transformations.filter(t => t.state === 'confirmed' && t.decision).map(t => t.decision!.id),
      derived: s.derived,
      n_randomised: s.nRandomised, n_effective: s.nEffective,
      flip_sign: !!a.flipSign,
    };
    const cl = s.transformations.find(t => t.kind === 'cluster_design_effect' && t.state === 'confirmed');
    if (cl) row.cluster = { icc: Number(cl.decision?.value?.icc), m: Number(cl.decision?.value?.m) };
    if (a.nRandomised) row.n_randomised_arms = a.nRandomised;
    if (a.treatment && a.comparator) row.arms = { treatment: a.treatment, comparator: a.comparator };
    else if (a.proportion) row.arms = { proportion: a.proportion };
    else if (a.correlation) row.arms = { correlation: a.correlation };
    if (a.precomputed) row.effect = { est: a.precomputed.y, se: a.precomputed.se, reported: a.precomputed.reported };
    dataset.push(row);
    datasetStudies.push(...studiesFromDataset([row]).map(st => ({ ...st, evidence: { ...(a.evidence ?? {}), ...(st.evidence ?? {}) } }) as MetaStudy));
  }

  // ── Blocking
  for (const s of studies) {
    if (s.eligibility === 'needs_decision') {
      blocking.push({
        kind: s.need === 'instrument' ? 'instrument' : 'eligibility', ref: s.ref, label: s.label,
        text: `${s.label}: ${s.need === 'instrument' ? 'outcome match' : s.need === 'tie' ? 'result selection' : 'eligibility'} decision pending`,
      });
    }
    if (s.eligibility === 'eligible' && (s.readiness === 'source_unreviewed')) {
      blocking.push({ kind: 'source_review', ref: s.ref, label: s.label, text: `${s.label}: AI-only source unreviewed` });
    }
    if (s.eligibility === 'eligible' && s.readiness === 'needs_transformation') {
      blocking.push({ kind: 'transformation', ref: s.ref, label: s.label, text: `${s.label}: transformation unconfirmed` });
    }
  }

  const potential = studies.filter(s => s.eligibility === 'needs_decision'
    || (s.eligibility === 'eligible' && s.readiness !== 'excluded' && s.readiness !== 'missing_data')).length;

  return {
    targetConfirmed, mappingReady, kind, measure, protocolPreset: def.preset, preset, presetDeviation,
    proportionMethod: units.proportionMethod,
    candidates, unrelatedRows, structuralExclusions: structural, studies,
    transformations: studies.flatMap(s => s.transformations),
    dataset, datasetStudies, blocking, potential,
    scaleColumn, variabilityMeasureColumn, lowerIsBenefit,
  };
}

// ── Snapshot → studies ───────────────────────────────────────────────────────

/** Rebuild the engine's input from a run's stored dataset — every displayed number comes from here. */
export function studiesFromDataset(rows: unknown[]): MetaStudy[] {
  const out: MetaStudy[] = [];
  for (const raw of rows as DatasetRow[]) {
    if (!raw || typeof raw !== 'object') continue;
    const common = {
      key: raw.ref, label: raw.label, documentId: raw.document_id, flipSign: !!raw.flip_sign,
      ...(raw.n_randomised_arms ? { nRandomised: raw.n_randomised_arms } : {}),
      evidence: {
        outcome: raw.outcome, timepoint: raw.timepoint, comparison: raw.comparison,
        row: raw.attrs ?? {}, derived: raw.derived, cluster: raw.cluster, snapshot: true,
      },
    };
    if (raw.effect) {
      out.push({
        ...common,
        precomputed: {
          y: raw.effect.est, se: raw.effect.se,
          reported: raw.effect.reported ?? { est: raw.effect.est, lo: null, hi: null, se: raw.effect.se, scale: 'log', derivedFrom: 'se' },
        },
      } as MetaStudy);
    } else if (raw.arms?.treatment && raw.arms?.comparator) {
      out.push({ ...common, treatment: raw.arms.treatment, comparator: raw.arms.comparator } as MetaStudy);
    } else if (raw.arms?.proportion) {
      out.push({ ...common, proportion: raw.arms.proportion } as MetaStudy);
    } else if (raw.arms?.correlation) {
      out.push({ ...common, correlation: raw.arms.correlation } as MetaStudy);
    }
  }
  return out;
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export interface RunConfig {
  measure: EffectMeasure;
  model: PoolingModel;
  tau2: SynthesisPreset['tau2'];
  ci: SynthesisPreset['ci'];
  preset_source: 'protocol' | 'deviation';
  mid: number | null;
  proportion_method: SourceUnits['proportionMethod'];
  lower_is_benefit: boolean;
  /**
   * The planned / post-hoc analyses the run computes, as sorted
   * `"<type>:<field>"` (Primary left out). Absent on runs recorded before
   * this was stored — then it is not compared.
   */
  analyses?: string[];
  /** Dataset studies judged high risk of bias (sorted document ids) — feeds `exclude_high_rob`. */
  rob_high?: string[];
  /** Whether risk of bias was assessed at all (the `exclude_high_rob` rule is not computable otherwise). */
  rob_assessed?: boolean;
  /** The recorded SWiM grouping (`swim:grouping` decision); SwimTab's default is `'__outcome'`. */
  swim_grouping?: string;
  /** The recorded SWiM success direction. */
  swim_success?: 'benefit' | 'harm';
}

/** What else a run's identity depends on, beyond the model. Each is optional; an omitted one is not recorded. */
export interface RunConfigExtras {
  /** The group's decisions — for the recorded SWiM grouping. */
  decisions?: SynthesisDecision[];
  /** `analysesOf(...)` — which sensitivity / subgroup analyses the run computes. */
  analyses?: AnalysisSpec[];
  /** Documents judged high risk of bias (`syn.rob.high`). */
  robHigh?: Set<string>;
  /** `syn.rob.assessed`. */
  robAssessed?: boolean;
}

const SWIM_DEFAULT_GROUPING = '__outcome';

export function runConfigOf(m: SynthesisModelResult, target: SynthesisTarget, extra: RunConfigExtras = {}): RunConfig {
  const out: RunConfig = {
    measure: m.measure, model: m.preset.model, tau2: m.preset.tau2,
    ci: m.preset.model === 'random' ? m.preset.ci : 'z',
    preset_source: m.presetDeviation ? 'deviation' : 'protocol',
    mid: target.mid?.value ?? null, proportion_method: m.proportionMethod,
    lower_is_benefit: m.lowerIsBenefit,
  };
  if (extra.analyses) out.analyses = analysesKey(extra.analyses);
  if (extra.robHigh) {
    const inData = new Set(m.dataset.map(r => r.document_id));
    out.rob_high = [...extra.robHigh].filter(d => inData.has(d)).sort();
  }
  if (extra.robAssessed !== undefined) out.rob_assessed = !!extra.robAssessed;
  if (extra.decisions) {
    const g = (inForce(extra.decisions, 'pooling', SWIM_GROUPING_REF)?.value ?? {}) as { grouping?: string; success?: string };
    out.swim_grouping = g.grouping || SWIM_DEFAULT_GROUPING;
    out.swim_success = g.success === 'harm' ? 'harm' : 'benefit';
  }
  return out;
}

function analysesKey(analyses: Array<Pick<AnalysisSpec, 'analysis_type' | 'field'>>): string[] {
  return [...new Set(analyses.filter(a => a.analysis_type !== 'Primary').map(a => `${a.analysis_type}:${a.field ?? ''}`))].sort();
}

/**
 * The output-affecting configuration of a run, normalized, per branch. A value
 * a config does not carry is `undefined` here (not compared by `staleDiff`,
 * `null` in `analysisConfigKey`).
 *  - both branches: measure, proportion method, direction convention, MID;
 *  - meta-analysis: model, τ² method and CI method (only under random effects —
 *    a common-effect model has neither), the analyses computed, and the
 *    risk-of-bias inputs when an `exclude_high_rob` sensitivity is among them
 *    (or the analyses are unknown);
 *  - SWiM: grouping and success direction (the run's own `grouping` / `success`
 *    as SwimTab records them, else `swim_grouping` / `swim_success`).
 */
function configFields(c: Record<string, unknown>, branch: 'ma' | 'swim'): Record<string, unknown> {
  const out: Record<string, unknown> = {
    measure: c.measure, proportion_method: c.proportion_method,
    lower_is_benefit: c.lower_is_benefit, mid: c.mid,
  };
  if (branch === 'swim') {
    out.swim_grouping = c.grouping ?? c.swim_grouping;
    out.swim_success = c.success ?? c.swim_success;
    return out;
  }
  const random = c.model === 'random';
  out.model = c.model;
  out.tau2 = c.model === undefined ? undefined : random ? c.tau2 : null;
  out.ci = c.model === undefined ? undefined : random ? c.ci : null;
  const analyses = Array.isArray(c.analyses) ? [...(c.analyses as string[])].sort() : undefined;
  out.analyses = analyses;
  const robMatters = !analyses || analyses.includes('Sensitivity:exclude_high_rob');
  out.rob_assessed = robMatters ? c.rob_assessed : undefined;
  out.rob_high = robMatters && Array.isArray(c.rob_high) ? [...(c.rob_high as string[])].sort() : undefined;
  return out;
}

/**
 * A fingerprint of everything in a run configuration that changes the run's
 * outputs (see `configFields`): two configs with equal keys produce the same
 * numbers from the same dataset. `branch` defaults to the config's own
 * (`config.branch === 'swim'` → SWiM, else meta-analysis); pass it to compare
 * the live `ws.config` (which has no branch) against a SWiM run.
 */
export function analysisConfigKey(
  config: RunConfig | Record<string, unknown> | null | undefined,
  opts: { branch?: 'ma' | 'swim' } = {},
): string {
  const c = (config ?? {}) as Record<string, unknown>;
  const branch = opts.branch ?? (c.branch === 'swim' ? 'swim' : 'ma');
  const f = configFields(c, branch);
  return canonicalJson({ branch, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === undefined ? null : v])) });
}

export function runMeta(studies: MetaStudy[], config: RunConfig, extra: MetaOptions = {}): MetaResult {
  return runMetaAnalysis(studies, config.measure, config.model, metaOptionsFor(
    { model: config.model, tau2: config.tau2, ci: config.ci },
    { proportionMethod: config.proportion_method, ...extra },
  ));
}

export interface AnalysisSpec {
  id: string;
  analysis_type: PlannedAnalysis['analysis_type'];
  description: string;
  field: string | null;
  planning: 'Prespecified' | 'PostHoc';
}

export function analysesOf(planned: PlannedAnalysis[], decisions: SynthesisDecision[]): AnalysisSpec[] {
  const out: AnalysisSpec[] = planned.map(p => ({ ...p, planning: 'Prespecified' as const }));
  for (const d of decisionsOfKind(decisions, 'post_hoc_add')) {
    const v = d.value ?? {};
    out.push({
      id: String(v.id ?? d.target_ref.replace(/^analysis:/, '')),
      analysis_type: (v.analysis_type ?? 'Sensitivity') as AnalysisSpec['analysis_type'],
      description: String(v.description ?? ''), field: (v.field ?? null) as string | null, planning: 'PostHoc',
    });
  }
  return out;
}

/** Sensitivity rules the engine knows how to apply to a dataset. */
export interface SensitivityContext { robHigh: Set<string>; robAssessed: boolean; influential: string | null }

export const SENSITIVITY_RULES: Record<string, {
  label: string;
  /** Null when the rule cannot be computed from this dataset (the audit then asks for a reason). */
  apply: (studies: MetaStudy[], ctx: SensitivityContext) => { kept: MetaStudy[]; excluded: string[] } | null;
}> = {
  exclude_derived_sd: {
    label: 'Exclude derived / imputed SDs',
    apply: st => ({ kept: st.filter(s => !(s.evidence as any)?.derived), excluded: st.filter(s => (s.evidence as any)?.derived).map(s => s.label) }),
  },
  exclude_high_rob: {
    label: 'Exclude high risk of bias (study-level)',
    apply: (st, ctx) => ctx.robAssessed
      ? { kept: st.filter(s => !ctx.robHigh.has(s.documentId)), excluded: st.filter(s => ctx.robHigh.has(s.documentId)).map(s => s.label) }
      : null,
  },
  influence: {
    label: 'Without the most influential study',
    apply: (st, ctx) => ctx.influential
      ? { kept: st.filter(s => s.label !== ctx.influential), excluded: [ctx.influential] }
      : null,
  },
  icc_check: {
    label: 'Cluster ICC doubled',
    apply: st => {
      let any = false;
      const kept = st.map(s => {
        const cl = (s.evidence as any)?.cluster as { icc: number; m: number } | undefined;
        if (!cl || !s.treatment || !s.comparator) return s;
        any = true;
        const ratio = designEffect(cl.m, cl.icc) / designEffect(cl.m, Math.min(1, cl.icc * 2));
        return { ...s, treatment: clusterArm(s.treatment, 1 / ratio), comparator: clusterArm(s.comparator, 1 / ratio) } as MetaStudy;
      });
      return any ? { kept, excluded: [] } : null;
    },
  },
};

export interface SensitivityOutput { key: string; label: string; k: number; est: number | null; lo: number | null; hi: number | null; excluded: string[] }

export interface RunOutputs {
  k: number;
  pooled: { est: number; lo: number; hi: number; mu: number; se: number } | null;
  z_interval: { lo: number; hi: number } | null;
  hksj: MetaResult['hksj'];
  heterogeneity: MetaResult['heterogeneity'];
  prediction: MetaResult['prediction'];
  prediction_suppressed: string | null;
  tau2_method: string;
  ci_method: string;
  model: PoolingModel;
  measure: EffectMeasure;
  totals: MetaResult['totals'];
  overall: MetaResult['overallEffect'];
  not_estimable: Array<{ ref: string; label: string; reason: string }>;
  studies: Array<{ ref: string; label: string; est: number; lo: number; hi: number; weight: number }>;
  influence: { label: string; est: number; lo: number; hi: number } | null;
  sensitivities: Record<string, SensitivityOutput>;
  subgroups: Record<string, { rows: Array<{ name: string; k: number; est: number | null; lo: number | null; hi: number | null }>; test: { q: number; df: number; p: number } | null }>;
}

/**
 * Everything a run records. Pure: the same dataset + config always gives the
 * same outputs, so a stored run can be re-derived and checked.
 */
export function computeRunOutputs(
  studies: MetaStudy[], config: RunConfig, analyses: AnalysisSpec[],
  robHigh: Set<string> = new Set(), robAssessed = false, comparatorRisk: number | null = null,
): RunOutputs {
  const result = readAs(runMeta(studies, config, { comparatorRisk }));
  const opts = metaOptionsFor({ model: config.model, tau2: config.tau2, ci: config.ci }, { proportionMethod: config.proportion_method });
  const loo = leaveOneOut(studies, config.measure, config.model, opts);
  const most = loo?.rows.find(r => r.mostInfluential) ?? null;
  const sensitivities: Record<string, SensitivityOutput> = {};
  const ctx: SensitivityContext = { robHigh, robAssessed, influential: most?.label ?? null };
  for (const a of analyses) {
    if (a.analysis_type !== 'Sensitivity' || !a.field) continue;
    const rule = SENSITIVITY_RULES[a.field];
    const applied = rule?.apply(studies, ctx);
    if (!rule || !applied) continue;
    const r = readAs(runMeta(applied.kept, config));
    sensitivities[a.field] = {
      key: a.field, label: rule.label, k: r.studies.length,
      est: r.pooled?.est ?? null, lo: r.pooled?.lo ?? null, hi: r.pooled?.hi ?? null,
      excluded: applied.excluded,
    };
  }
  const subgroups: RunOutputs['subgroups'] = {};
  for (const a of analyses) {
    if (a.analysis_type !== 'Subgroup' || !a.field) continue;
    const has = studies.some(s => ((s.evidence as any)?.row ?? {})[a.field!]);
    if (!has) continue;
    const sg = subgroupAnalysis(studies, config.measure, config.model,
      s => String(((s.evidence as any)?.row ?? {})[a.field!] ?? ''), opts);
    subgroups[a.field] = { rows: sg.rows.map(r => ({ name: r.name, k: r.k, est: r.est, lo: r.lo, hi: r.hi })), test: sg.test };
  }
  return {
    k: result.studies.length,
    pooled: result.pooled, z_interval: result.zInterval, hksj: result.hksj,
    heterogeneity: result.heterogeneity, prediction: result.prediction,
    prediction_suppressed: result.predictionSuppressed ?? null,
    tau2_method: result.tau2Method, ci_method: result.ciMethod, model: result.model, measure: result.measure,
    totals: result.totals, overall: result.overallEffect,
    not_estimable: result.notEstimable.map(n => ({ ref: n.study.key, label: n.study.label, reason: EXCLUSION_TEXT[reasonFromNotEstimable(n.reason)] })),
    studies: result.studies.map(s => ({ ref: s.key, label: s.label, est: s.est, lo: s.lo, hi: s.hi, weight: s.weightPct })),
    influence: most && most.est !== null ? { label: most.label, est: most.est, lo: most.lo!, hi: most.hi! } : null,
    sensitivities, subgroups,
  };
}

// ── Staleness ────────────────────────────────────────────────────────────────

export interface StaleDiff {
  stale: boolean;
  added: string[];
  removed: string[];
  changed: string[];
  configChanged: string[];
  text: string;
}

export function staleDiff(
  run: Pick<SynthesisRun, 'dataset' | 'dataset_hash' | 'config'> | null,
  dataset: DatasetRow[], currentHash: string, config: RunConfig,
): StaleDiff {
  if (!run) return { stale: false, added: [], removed: [], changed: [], configChanged: [], text: '' };
  const before = new Map((run.dataset as DatasetRow[]).map(r => [r.ref, r]));
  const now = new Map(dataset.map(r => [r.ref, r]));
  const added = dataset.filter(r => !before.has(r.ref)).map(r => r.label);
  const removed = [...before.values()].filter(r => !now.has(r.ref)).map(r => r.label);
  const changed: string[] = [];
  for (const [ref, r] of now) {
    const b = before.get(ref);
    // Canonical, key-order-independent: the stored dataset comes back from a
    // JSONB column, which reorders object keys, so a plain JSON.stringify would
    // report every row as changed.
    if (b && canonicalJson({ ...b, label: '' }) !== canonicalJson({ ...r, label: '' })) changed.push(r.label);
  }
  const rc = (run.config ?? {}) as Record<string, unknown>;
  const branch = runBranchOf(run);
  const before_ = configFields(rc, branch);
  const now_ = configFields(config as unknown as Record<string, unknown>, branch);
  const show = (v: unknown) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v));
  const configChanged = Object.keys(before_)
    // A key either side does not carry (a run recorded before it was stored,
    // or a caller that did not pass it) cannot be compared.
    .filter(k => before_[k] !== undefined && now_[k] !== undefined)
    // τ² / CI are only meaningful when both runs are random effects; a model
    // change is reported once, as the model.
    .filter(k => !((k === 'tau2' || k === 'ci') && before_.model !== now_.model))
    .filter(k => canonicalJson(before_[k]) !== canonicalJson(now_[k]))
    .map(k => `${k} ${show(before_[k])} → ${show(now_[k])}`);
  const hashChanged = run.dataset_hash !== currentHash;
  const stale = hashChanged || configChanged.length > 0;
  const parts = [
    added.length ? `${added.join(', ')} added` : '',
    removed.length ? `${removed.join(', ')} removed` : '',
    changed.length ? `values or transformations changed for ${changed.join(', ')}` : '',
    configChanged.length ? `configuration changed (${configChanged.join('; ')})` : '',
  ].filter(Boolean);
  if (stale && parts.length === 0) parts.push('dataset changed');
  return { stale, added, removed, changed, configChanged, text: parts.join('; ') };
}

// ── Pooling decision ─────────────────────────────────────────────────────────

export interface Dimension { key: string; finding: string; ok: boolean }

export function poolingDimensions(m: SynthesisModelResult, target: SynthesisTarget, designByDocument: Record<string, string> = {}): Dimension[] {
  const inc = m.studies.filter(s => s.eligibility === 'eligible' && s.readiness !== 'excluded' && s.readiness !== 'missing_data');
  const pendingInstrument = m.studies.filter(s => s.need === 'instrument');
  const comparisons = [...new Set(inc.map(s => s.selected?.comparison).filter(Boolean))];
  const labels = [...new Set(inc.map(s => s.selected?.outcome).filter(Boolean))];
  const matched = inc.filter(s => s.selected?.matchedByDecision).length;
  const weeks = inc.map(s => s.selected?.weeks).filter((w): w is number => w !== null && w !== undefined);
  const designs = [...new Set(inc.map(s => designByDocument[s.documentId]).filter(Boolean))];
  const rescales = m.transformations.filter(t => t.kind === 'rescale').length;
  const reversals = m.transformations.filter(t => t.kind === 'reverse_direction');
  return [
    { key: 'Population', ok: true, finding: target.population ? `Target: ${target.population} — not checked per study by the engine` : 'No population restriction on the target' },
    { key: 'Intervention and comparator', ok: comparisons.length <= 1, finding: comparisons.length <= 1 ? (comparisons[0] ?? 'One comparison') : `${comparisons.length} comparison labels: ${comparisons.slice(0, 3).join(' · ')}${comparisons.length > 3 ? ' …' : ''}` },
    { key: 'Outcome construct', ok: pendingInstrument.length === 0, finding: pendingInstrument.length ? `${pendingInstrument.map(s => s.label).join(', ')}: construct decision pending` : `${labels.length} outcome label${labels.length === 1 ? '' : 's'}${matched ? ` · ${matched} accepted by decision` : ''}` },
    { key: 'Instrument and scale', ok: reversals.every(t => t.state === 'confirmed'), finding: `${rescales ? `${rescales} rescaled to the common scale` : 'No rescaling proposed'}${reversals.length ? ` · ${reversals.length} direction reversal${reversals.length === 1 ? '' : 's'}` : ''}` },
    { key: 'Time window', ok: true, finding: weeks.length ? `Included results ${formatWeeks(Math.min(...weeks))}–${formatWeeks(Math.max(...weeks))}` : 'No timepoints read' },
    { key: 'Design', ok: designs.every(d => !/cross.?over|split|cluster/i.test(d)) || m.transformations.some(t => t.kind === 'cluster_design_effect' && t.state === 'confirmed'), finding: designs.length ? designs.slice(0, 3).join(' · ') : 'No design recorded for these studies' },
  ];
}

export type PoolingChoice = 'pool' | 'do_not_pool';

export function poolingOf(decisions: SynthesisDecision[]): { decision: SynthesisDecision | null; choice: PoolingChoice | null } {
  const d = inForce(decisions, 'pooling', POOLING_REF);
  // Two writers: an explicit decision ({decision}) and the server's record of a
  // branch change ({branch, previous}) — both mean the same thing.
  const v = d?.value?.decision ?? (d?.value?.branch === 'ma' ? 'pool' : d?.value?.branch === 'swim' ? 'do_not_pool' : null);
  return { decision: d, choice: v === 'pool' || v === 'do_not_pool' ? v : null };
}

// ── Planned analyses status ──────────────────────────────────────────────────

export interface AnalysisStatus extends AnalysisSpec {
  status: 'run' | 'not_run' | 'pending';
  text: string;
  decision: SynthesisDecision | null;
}

export function analysisStatuses(
  analyses: AnalysisSpec[], run: SynthesisRun | null, decisions: SynthesisDecision[],
): AnalysisStatus[] {
  const outs = (run?.outputs ?? {}) as Partial<RunOutputs>;
  return analyses.map(a => {
    const nr = inForce(decisions, 'analysis_not_run', analysisRef(a.id));
    const base = { ...a, decision: nr };
    if (a.analysis_type === 'Primary') {
      return run ? { ...base, status: 'run' as const, text: `Run ${run.n}` } : { ...base, status: 'pending' as const, text: 'No run yet' };
    }
    if (nr) return { ...base, status: 'not_run' as const, text: `Not run — ${nr.reason ?? ''}` };
    if (!run) return { ...base, status: 'pending' as const, text: 'No run yet' };
    if (a.analysis_type === 'Sensitivity' && a.field && outs.sensitivities?.[a.field]) {
      const s = outs.sensitivities[a.field];
      return { ...base, status: 'run' as const, text: `Run ${run.n} · k = ${s.k}` };
    }
    if (a.analysis_type === 'Subgroup' && a.field && outs.subgroups?.[a.field]) {
      return { ...base, status: 'run' as const, text: `Run ${run.n}` };
    }
    const why = a.analysis_type === 'MetaRegression'
      ? 'the engine does not compute meta-regression — record it as not run with a reason'
      : a.analysis_type === 'Subgroup'
        ? `no ${a.field ?? 'grouping'} values in this dataset — record not run with a reason`
        : 'not computable from this dataset — record not run with a reason';
    return { ...base, status: 'pending' as const, text: why };
  });
}

// ── Audit ────────────────────────────────────────────────────────────────────

export interface AuditContext {
  model: SynthesisModelResult;
  currentHash: string;
  latestRun: SynthesisRun | null;
  diff: StaleDiff;
  branch: 'ma' | 'swim';
  decisions: SynthesisDecision[];
  analyses: AnalysisStatus[];
  /** Studies in the latest run without any completed RoB assessment. */
  robMissing: string[];
}

/**
 * The live pre-finalization audit — the mock's twelve rows, deadlocks fixed.
 * `blocking` rows must pass before Finalize is enabled; the rest advise.
 */
export function auditRows(ctx: AuditContext): AuditRow[] {
  const m = ctx.model;
  const rows: AuditRow[] = [];
  const names = (list: string[]) => (list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3}` : list.join(', '));
  const elig = m.blocking.filter(b => b.kind === 'eligibility' || b.kind === 'instrument');
  rows.push({ id: 'target', blocking: true, ok: m.targetConfirmed, text: m.targetConfirmed ? 'Target confirmed' : 'Target not confirmed' });
  rows.push({ id: 'eligibility', blocking: true, ok: elig.length === 0,
    text: elig.length ? `${elig.length} eligibility decision${elig.length === 1 ? '' : 's'} pending (${names(elig.map(b => b.label))})` : 'All eligibility decisions recorded' });
  const byRule = m.studies.filter(s => s.selectedBy === 'engine_rule').length;
  const byHuman = m.studies.filter(s => s.selectedBy === 'human_decision').length;
  rows.push({ id: 'one_effect', blocking: true, ok: true,
    text: `One effect per study · ${byRule} selected by the protocol rule${byHuman ? ` · ${byHuman} by decision` : ''}` });
  const devs = m.studies.filter(s => s.deviation).length;
  rows.push({ id: 'window', blocking: true, ok: true, text: `Window rule applied by the engine · ${devs} window deviation${devs === 1 ? '' : 's'} logged` });
  const tr = m.blocking.filter(b => b.kind === 'transformation');
  rows.push({ id: 'transformations', blocking: true, ok: tr.length === 0,
    text: tr.length ? `${tr.length} transformation${tr.length === 1 ? '' : 's'} unconfirmed (${names(tr.map(b => b.label))})` : 'All transformations confirmed, provenance stored' });
  const src = m.blocking.filter(b => b.kind === 'source_review');
  rows.push({ id: 'source_review', blocking: true, ok: src.length === 0,
    text: src.length ? `AI-only source unreviewed: ${names(src.map(b => b.label))}` : 'No unreviewed AI-only rows in the dataset' });
  {
    const run = ctx.latestRun;
    // A run is a meta-analysis or a structured synthesis; after a branch change
    // the latest run may be the other kind, and finalizing it would freeze the
    // wrong analysis under this branch.
    const wrongBranch = !!run && runBranchOf(run) !== ctx.branch;
    rows.push({ id: 'run', blocking: true, ok: !!run && !ctx.diff.stale && !run.partial && !wrongBranch,
      text: !run ? 'No run yet' : ctx.diff.stale ? `Latest run is stale (${ctx.diff.text})` : run.partial ? `Run ${run.n} is a partial draft`
        : wrongBranch ? `Run ${run.n} is a ${runBranchOf(run) === 'swim' ? 'structured synthesis' : 'meta-analysis'} — this synthesis is now ${ctx.branch === 'swim' ? 'a structured synthesis' : 'a meta-analysis'}; record a new run`
          : `Run ${run.n} matches dataset` });
  }
  if (ctx.branch === 'ma') {
    rows.push({ id: 'preset', blocking: true, ok: true, warn: !!m.presetDeviation,
      text: m.presetDeviation ? `Method deviates from protocol (${presetLabel(m.preset)}) — reason logged` : 'Measure and method match the protocol' });
  }
  const pooling = poolingOf(ctx.decisions);
  const wanted: PoolingChoice = ctx.branch === 'ma' ? 'pool' : 'do_not_pool';
  rows.push({ id: 'pooling', blocking: true, ok: pooling.choice === wanted,
    text: pooling.choice === wanted ? `Pooling decision recorded: ${wanted === 'pool' ? 'pool' : 'do not pool'}` : 'Pooling decision not recorded for this branch' });
  if (ctx.branch === 'ma') {
    for (const a of ctx.analyses.filter(x => x.analysis_type !== 'Primary')) {
      rows.push({ id: `analysis:${a.id}`, blocking: true, ok: a.status !== 'pending',
        text: `${a.planning === 'PostHoc' ? 'Post-hoc' : 'Prespecified'} ${a.analysis_type} · ${a.description || a.field || ''}: ${a.status === 'run' ? 'run' : a.status === 'not_run' ? 'not run — reason recorded' : a.text}` });
    }
    const outs = (ctx.latestRun?.outputs ?? {}) as Partial<RunOutputs>;
    const small = Object.entries(outs.subgroups ?? {}).flatMap(([f, g]) => g.rows.filter(r => r.k < 3).map(r => `${f} = ${r.name} (k = ${r.k})`));
    rows.push({ id: 'subgroup_k', blocking: false, ok: small.length === 0,
      text: small.length ? `Subgroup with k < 3 — descriptive only: ${names(small)}` : 'Subgroup estimates meet minimum k = 3' });
  }
  rows.push({ id: 'rob', blocking: false, ok: ctx.robMissing.length === 0,
    text: ctx.robMissing.length ? `Risk of bias not assessed (study-level): ${names(ctx.robMissing)}` : 'Study-level risk of bias present for every included study' });
  return rows;
}

/** Which branch a stored run belongs to: SWiM runs carry `config.branch = 'swim'`. */
export function runBranchOf(run: Pick<SynthesisRun, 'config'> | null | undefined): 'ma' | 'swim' {
  return (run?.config as Record<string, unknown> | undefined)?.branch === 'swim' ? 'swim' : 'ma';
}

export function auditPasses(rows: AuditRow[]): boolean {
  return rows.every(r => r.ok || !r.blocking);
}

// ── Status ───────────────────────────────────────────────────────────────────

export type DerivedStatus =
  | { key: 'draft'; label: 'Draft' }
  | { key: 'ready'; label: 'Ready' }
  | { key: 'in_progress'; label: 'In progress' }
  | { key: 'awaiting'; label: 'Awaiting approval' }
  | { key: 'finalized'; label: string }
  | { key: 'needs_review'; label: 'Needs review' };

/** SPEC §6. Derived, never set by hand. */
export function deriveStatus(input: {
  targetConfirmed: boolean;
  blockingCount: number;
  runs: number;
  versions: Array<Pick<SynthesisVersion, 'n' | 'status' | 'dataset_hash' | 'superseded_by'> & { bundle?: Record<string, unknown> | null }>;
  currentHash: string | null;
  /** The group's current branch; a live version frozen under the other branch needs review. */
  branch?: 'ma' | 'swim';
}): DerivedStatus {
  const live = input.versions.filter(v => !v.superseded_by).sort((a, b) => b.n - a.n)[0];
  if (live) {
    if (input.currentHash && live.dataset_hash !== input.currentHash) return { key: 'needs_review', label: 'Needs review' };
    const frozenBranch = live.bundle?.branch;
    if (input.branch && (frozenBranch === 'ma' || frozenBranch === 'swim') && frozenBranch !== input.branch) {
      return { key: 'needs_review', label: 'Needs review' };
    }
    if (live.status === 'awaiting') return { key: 'awaiting', label: 'Awaiting approval' };
    return { key: 'finalized', label: `Finalized v${live.n}` };
  }
  if (input.runs > 0) return { key: 'in_progress', label: 'In progress' };
  if (input.targetConfirmed && input.blockingCount === 0) return { key: 'ready', label: 'Ready' };
  return { key: 'draft', label: 'Draft' };
}

// ── Post-hoc catalogue ───────────────────────────────────────────────────────

export interface PostHocProposal {
  id: string;
  trigger: string;
  analysis_type: AnalysisSpec['analysis_type'];
  description: string;
  field: string;
  alreadyPlanned: boolean;
}

/**
 * Proposals from a fixed catalogue, each with the trigger that surfaced it.
 * Triggers are properties of the dataset (derived SDs, a cluster ICC, high
 * RoB, an influential study) — never the direction or significance of a result.
 */
export function postHocProposals(
  m: SynthesisModelResult, analyses: AnalysisSpec[], robHigh: Set<string>,
  influential: string | null,
): PostHocProposal[] {
  const has = (field: string) => analyses.some(a => a.field === field);
  const out: PostHocProposal[] = [];
  const derived = m.studies.filter(s => s.inDataset && s.derived).map(s => s.label);
  if (derived.length) {
    out.push({ id: 'exclude_derived_sd', trigger: `Derived SD in dataset (${derived.join(', ')})`, analysis_type: 'Sensitivity', description: 'Sensitivity · exclude imputed or derived SDs', field: 'exclude_derived_sd', alreadyPlanned: has('exclude_derived_sd') });
  }
  const high = m.studies.filter(s => s.inDataset && robHigh.has(s.documentId)).map(s => s.label);
  if (high.length) {
    out.push({ id: 'exclude_high_rob', trigger: `High risk of bias (study-level) for ${high.join(', ')}`, analysis_type: 'Sensitivity', description: 'Sensitivity · exclude high risk of bias', field: 'exclude_high_rob', alreadyPlanned: has('exclude_high_rob') });
  }
  const icc = m.transformations.filter(t => t.kind === 'cluster_design_effect' && t.state === 'confirmed');
  if (icc.length) {
    out.push({ id: 'icc_check', trigger: `Cluster ICC assumed for ${icc.map(t => t.label).join(', ')}`, analysis_type: 'Sensitivity', description: 'Sensitivity · ICC assumption check', field: 'icc_check', alreadyPlanned: has('icc_check') });
  }
  if (influential) {
    out.push({ id: 'influence', trigger: `${influential} moves the estimate most in leave-one-out`, analysis_type: 'Sensitivity', description: `Sensitivity · without ${influential}`, field: 'influence', alreadyPlanned: has('influence') });
  }
  return out;
}

// ── Narrative ────────────────────────────────────────────────────────────────

export interface NarrativeSentence { text: string; ref: string }

function f2(x: number): string { return (x < 0 ? '−' : '') + Math.abs(x).toFixed(2); }

/** Deterministic results narrative, every sentence bound to a stored reference. */
export function resultsNarrative(
  run: SynthesisRun, target: SynthesisTarget, shortHash: (h: string) => string,
): NarrativeSentence[] {
  const o = run.outputs as unknown as RunOutputs;
  const out: NarrativeSentence[] = [];
  if (!o || typeof o.k !== 'number') return out;
  const tag = `run ${run.n}`;
  const window = target.window?.lo !== null || target.window?.hi !== null
    ? ` at ${target.window.lo ?? '…'}–${target.window.hi ?? '…'} weeks` : '';
  out.push({ text: `${o.k} ${o.k === 1 ? 'study' : 'studies'} contributed to run ${run.n} of the ${target.outcome} synthesis${window}${run.partial ? ' (partial draft)' : ''}.`, ref: `dataset ${shortHash(run.dataset_hash)}` });
  if (o.pooled) {
    out.push({ text: `The pooled ${o.measure} was ${f2(o.pooled.est)} (95% CI ${f2(o.pooled.lo)} to ${f2(o.pooled.hi)}; ${o.model === 'random' ? `random effects, ${String(o.tau2_method).toUpperCase()} τ², ${o.ci_method === 'hk' ? 'Hartung–Knapp' : 'z'} interval` : 'common-effect'}).`, ref: tag });
  } else {
    out.push({ text: `No pooled estimate was produced (fewer than three estimable studies or a refused method).`, ref: tag });
  }
  if (o.heterogeneity) {
    const h = o.heterogeneity;
    const ci = h.i2Lo !== null && h.i2Hi !== null ? ` (95% CI ${h.i2Lo.toFixed(0)}–${h.i2Hi.toFixed(0)}%)` : '';
    out.push({ text: `Between-study variance τ² = ${h.tau2.toFixed(3)}; I² = ${h.i2.toFixed(0)}%${ci} (Q = ${h.q.toFixed(1)}, df = ${h.df}).${o.prediction ? ` The 95% prediction interval was ${f2(o.prediction.lo)} to ${f2(o.prediction.hi)}.` : o.prediction_suppressed ? ` No prediction interval is reported (${o.prediction_suppressed}).` : ''}`, ref: tag });
  }
  if (target.mid?.value && o.pooled) {
    out.push({ text: `The prespecified MID for this target is ${target.mid.value}${target.mid.scale ? ` (${target.mid.scale})` : ''}.`, ref: 'target MID' });
  }
  if (o.influence) {
    out.push({ text: `Omitting ${o.influence.label} moved the pooled estimate most (${f2(o.influence.est)}, ${f2(o.influence.lo)} to ${f2(o.influence.hi)}).`, ref: 'leave-one-out' });
  }
  for (const s of Object.values(o.sensitivities ?? {})) {
    out.push({ text: s.est !== null
      ? `${s.label}: ${s.k} studies, ${f2(s.est)} (${f2(s.lo!)} to ${f2(s.hi!)})${s.excluded.length ? `, excluding ${s.excluded.join(', ')}` : ', no study excluded'}.`
      : `${s.label}: too few studies remain to pool (k = ${s.k}).`, ref: `sensitivity · ${s.key}` });
  }
  for (const [field, g] of Object.entries(o.subgroups ?? {})) {
    const parts = g.rows.map(r => r.est !== null ? `${r.name} ${f2(r.est)} (${f2(r.lo!)} to ${f2(r.hi!)}, k = ${r.k})` : `${r.name} k = ${r.k}, not pooled`);
    out.push({ text: `By ${field}: ${parts.join('; ')}${g.test ? `; test for subgroup differences Q = ${g.test.q.toFixed(2)}, df = ${g.test.df}, p = ${g.test.p < 0.001 ? '< 0.001' : g.test.p.toFixed(3)}` : ''}.`, ref: `subgroup · ${field}` });
  }
  return out;
}

export const REFRESHABLE_KINDS: DecisionKind[] = ['eligibility', 'instrument_match', 'source_review', 'transformation', 'deviation'];
export { isRatioMeasure };

// ── Facets for the target form ───────────────────────────────────────────────

/** Outcome / comparison / timepoint values the source form actually holds. */
export function sourceFacets(sf: SynthesisSourceForm | null, rows: LongFormatRow[], columns: string[]): Facets | null {
  if (!sf || !sourceFormReady(sf)) return null;
  const mapping = mappingOf(sf);
  const units = unitsOf(sf);
  const { pairings } = buildPairings(
    rows, mapping, sf.layout, sf.comparator_value ?? '', detectComparisonColumn(columns), detectArmLabelColumns(columns),
    { choices: units.harmonizeChoices, confirmed: units.harmonizeConfirmed },
  );
  return facetsOf(pairings);
}

/**
 * The three-step consensus model for one table field: Align → Resolve → Final.
 *
 * `alignRows.ts` answers "which rows are safely the same record" by exact
 * composite-key join, and still does. This module sits on top of it and adds
 * what the three-step workspace needs:
 *
 *   - **Match proposals.** Rows the key join could not settle ("Naproxen" vs
 *     "Naproxen sodium", "6 h" vs "6 hours", SPID vs its spelled-out name) are
 *     offered to the adjudicator as a proposed match with a similarity score.
 *     A proposal is NEVER applied without a click: rows are still never merged
 *     for looking similar (see the header of alignRows.ts for why). The scorer
 *     only decides what to ASK, and it is deliberately conservative — any key
 *     column that clearly differs (disjoint numbers such as 220 mg vs 440 mg or
 *     2 h vs 6 h, or no shared words) removes the proposal entirely.
 *   - **Issues.** One per differing column of a matched result, plus one per
 *     result only some sources reported (include it or not). Columns that agree
 *     generate nothing.
 *   - **The final rows and their provenance.** Built from the sources' own cell
 *     envelopes, so a picked cell keeps its quote and page.
 *
 * Vocabulary shown to reviewers: "result" (a real-world record), "source row",
 * "issue". The matcher's words (key, bucket, proposal) stay in code.
 *
 * Pure functions, no React: checked by lib/__checks__/entities.check.mts.
 */

import { classify, compareKey } from '@/lib/absence';
import {
  alignTableRows,
  applyManualPairs,
  canPair,
  differingColumns,
  isBlankKeyCell,
  refKey,
  SOURCE_ORDER,
  type AlignedRecord,
  type ColumnSpec,
  type RowRef,
  type SourceKey,
} from './alignRows';

// ─── Persisted state ──────────────────────────────────────────────────────────

/** A picked cell value. `custom` carries the typed value. */
export interface CellPick {
  from: SourceKey | 'custom';
  value?: any;
  note?: string;
}

/**
 * Everything the adjudicator decided for one table, keyed by record ids that
 * are stable for a given snapshot of the sources (they are built from
 * `source:rowIndex`). Serialisable: stored in the localStorage draft and in
 * `consensus_results.field_decisions[field].consensus_state`, so a reopened
 * review restores every decision.
 */
export interface TableConsensusState {
  /** Rows the adjudicator said are the same result (lists of refKeys). */
  groups: string[][];
  /** Proposal ids answered "keep separate". */
  rejected: string[];
  /** Positional (no key configured) records confirmed as one result. */
  confirmed: string[];
  /** Positional records split into their source rows. */
  split: string[];
  /** Include / exclude, for results only some sources reported. */
  include: Record<string, boolean>;
  /** Per record, per column: which value becomes final. */
  cells: Record<string, Record<string, CellPick>>;
  /**
   * Record id → a source row (refKey) of the result it duplicates. A row,
   * not a record id, because matching the representative later changes its
   * record id and must not silently drop the mark. Only for two rows from the SAME
   * source describing one result (R1 typed it twice). Nothing is merged or
   * deleted: the duplicate stays in provenance as excluded, reason
   * "duplicate", pointing at the representative. A mark whose representative
   * no longer exists (it was re-paired) is ignored, so the row reappears as
   * undecided instead of vanishing.
   */
  duplicates: Record<string, string>;
  /** Why an excluded result was left out, when the adjudicator said. */
  excludeReasons: Record<string, ExcludeReason>;
  /**
   * Same-source pairs the adjudicator said are NOT duplicates, keyed by
   * `duplicatePairId` (the two source rows), so the question is not asked again.
   */
  notDuplicates: string[];
  /** A free-text note per result, from the Resolve card. */
  resultNotes: Record<string, string>;
  /**
   * A table decided before this workspace existed, as one whole-table pick.
   * Treated as the default for every record the new state has not decided, so
   * reopening an old consensus reproduces what was saved.
   */
  legacyPick?: SourceKey | null;
}

export type ExcludeReason = 'incorrect_extraction' | 'not_relevant' | 'other';
export const EXCLUDE_REASONS: ExcludeReason[] = ['incorrect_extraction', 'not_relevant', 'other'];
export const EXCLUDE_REASON_LABEL: Record<ExcludeReason, string> = {
  incorrect_extraction: 'Incorrect extraction',
  not_relevant: 'Not relevant',
  other: 'Other',
};

export function emptyTableState(): TableConsensusState {
  return {
    groups: [], rejected: [], confirmed: [], split: [], include: {}, cells: {}, duplicates: {},
    excludeReasons: {}, notDuplicates: [], resultNotes: {},
  };
}

/** Accept a stored state defensively — it came from JSONB or localStorage. */
export function coerceTableState(raw: any): TableConsensusState {
  const s = emptyTableState();
  if (!raw || typeof raw !== 'object') return s;
  const strList = (v: any) => (Array.isArray(v) ? v.filter((x: any) => typeof x === 'string') : []);
  if (Array.isArray(raw.groups)) s.groups = raw.groups.map(strList).filter((g: string[]) => g.length >= 2);
  s.rejected = strList(raw.rejected);
  s.confirmed = strList(raw.confirmed);
  s.split = strList(raw.split);
  if (raw.include && typeof raw.include === 'object') {
    for (const [k, v] of Object.entries(raw.include)) if (typeof v === 'boolean') s.include[k] = v;
  }
  if (raw.cells && typeof raw.cells === 'object') {
    for (const [rid, cols] of Object.entries(raw.cells)) {
      if (!cols || typeof cols !== 'object') continue;
      const out: Record<string, CellPick> = {};
      for (const [col, p] of Object.entries(cols as any)) {
        const pick = p as any;
        if (pick && (pick.from === 'custom' || SOURCE_ORDER.includes(pick.from))) out[col] = { ...pick };
      }
      s.cells[rid] = out;
    }
  }
  if (raw.duplicates && typeof raw.duplicates === 'object') {
    for (const [k, v] of Object.entries(raw.duplicates)) if (typeof v === 'string') s.duplicates[k] = v;
  }
  if (raw.excludeReasons && typeof raw.excludeReasons === 'object') {
    for (const [k, v] of Object.entries(raw.excludeReasons)) if (EXCLUDE_REASONS.includes(v as ExcludeReason)) s.excludeReasons[k] = v as ExcludeReason;
  }
  s.notDuplicates = strList(raw.notDuplicates);
  if (raw.resultNotes && typeof raw.resultNotes === 'object') {
    for (const [k, v] of Object.entries(raw.resultNotes)) if (typeof v === 'string') s.resultNotes[k] = v;
  }
  if (raw.legacyPick && SOURCE_ORDER.includes(raw.legacyPick)) s.legacyPick = raw.legacyPick;
  return s;
}

// ─── Similarity (proposals only) ──────────────────────────────────────────────

const UNIT_SYNONYMS: Record<string, string> = {
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h', hourly: 'h',
  min: 'min', mins: 'min', minute: 'min', minutes: 'min',
  d: 'd', day: 'd', days: 'd',
  wk: 'wk', wks: 'wk', week: 'wk', weeks: 'wk',
  mo: 'mo', month: 'mo', months: 'mo',
  y: 'y', yr: 'y', yrs: 'y', year: 'y', years: 'y',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  g: 'g', gram: 'g', grams: 'g',
  mcg: 'mcg', µg: 'mcg', microgram: 'mcg', micrograms: 'mcg',
  ml: 'ml', millilitre: 'ml', milliliter: 'ml', millilitres: 'ml', milliliters: 'ml',
  kg: 'kg',
};
const UNIT_WORDS = new Set(Object.values(UNIT_SYNONYMS));
const STOPWORDS = new Set(['of', 'the', 'and', 'at', 'in', 'a', 'an', 'for', 'with', 'to', 'on', 'by', 'vs', 'versus', 'group', 'arm']);

function rawText(cell: any): string {
  if (cell == null) return '';
  if (typeof cell === 'object' && !Array.isArray(cell)) {
    if ('value' in cell) return cell.value == null ? '' : String(cell.value);
    return '';
  }
  if (Array.isArray(cell)) return cell.map(rawText).join(' ');
  return String(cell);
}

/** Lowercased word + number tokens, unit spellings folded ("6-hour" → 6, h). */
export function tokens(text: string): { words: string[]; numbers: string[] } {
  const spaced = text
    .toLowerCase()
    .replace(/(\d),(\d{3})\b/g, '$1$2') // 1,000 is one number, not 1 and 000
    .replace(/(\d)([a-zµ])/g, '$1 $2')
    .replace(/([a-zµ])(\d)/g, '$1 $2');
  const parts = spaced.split(/[^a-z0-9µ.]+/).map(p => p.replace(/^\.+|\.+$/g, '')).filter(Boolean);
  const words: string[] = [];
  const numbers: string[] = [];
  for (const p of parts) {
    if (/^\d+(\.\d+)?$/.test(p)) numbers.push(String(Number(p)));
    else if (!STOPWORDS.has(p)) words.push(UNIT_SYNONYMS[p] ?? p);
  }
  return { words, numbers };
}

function isAcronymOf(short: string[], long: string[]): boolean {
  if (short.length !== 1 || long.length < 2) return false;
  const acr = short[0];
  const initials = long.map(w => w[0]).join('');
  return acr.length >= 2 && acr === initials;
}

/**
 * How alike two key cells are, 0..1. 1 = same canonical value. Blank on one
 * side is neutral (0.5) — a gap is not evidence either way. 0 = clearly a
 * different value: disjoint numbers, or no shared words.
 */
export function cellSimilarity(a: any, b: any, spec: ColumnSpec): number {
  const blankA = isBlankKeyCell(a, spec.options);
  const blankB = isBlankKeyCell(b, spec.options);
  if (blankA && blankB) return 1;
  if (blankA || blankB) return 0.5;
  const ka = compareKey(a, spec.options);
  const kb = compareKey(b, spec.options);
  if (ka !== null && ka === kb) return 1;
  const ta = tokens(rawText(a));
  const tb = tokens(rawText(b));
  if (ta.numbers.length && tb.numbers.length && !ta.numbers.some(n => tb.numbers.includes(n))) return 0;
  // One side names a dose / time and the other does not ("Acetaminophen" vs
  // "Acetaminophen 1000 mg"): that is less detail, not a different result. The
  // units would otherwise dilute the overlap below the veto, which is exactly
  // what the live Kiersch 1994 rows did to every acetaminophen row.
  const oneSidedNumbers = (ta.numbers.length > 0) !== (tb.numbers.length > 0);
  const strip = (ws: string[]) => (oneSidedNumbers ? ws.filter(w => !UNIT_WORDS.has(w)) : ws);
  const wa = new Set(strip(ta.words));
  const wb = new Set(strip(tb.words));
  if (isAcronymOf([...wa], [...wb]) || isAcronymOf([...wb], [...wa])) return 0.9;
  const na = oneSidedNumbers ? [] : ta.numbers;
  const nb = oneSidedNumbers ? [] : tb.numbers;
  const A = new Set([...wa, ...na.map(x => `#${x}`)]);
  const B = new Set([...wb, ...nb.map(x => `#${x}`)]);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const union = A.size + B.size - shared;
  // Same words, reordered or with a folded unit spelling: "6 h" vs "6 hours".
  if (shared === union) return oneSidedNumbers ? 0.85 : 0.95;
  // Overlap blended with containment: "Placebo" inside "Placebo / no
  // treatment" is closer than plain overlap says, but not the same value.
  // Only between values of comparable length — a one-word "Headache" is
  // "contained" in a paragraph that mentions headache, and R1's summary
  // sentence on the live Kiersch paper would then be proposed against it.
  const small = Math.min(A.size, B.size);
  const comparable = Math.max(A.size, B.size) <= small * 3;
  const score = comparable ? (shared / union + shared / small) / 2 : shared / union;
  return oneSidedNumbers ? score * 0.9 : score;
}

/** A key column below this, with both sides filled, means "not the same result". */
export const BLOCKING_SIMILARITY = 0.34;
/** Proposals below this are not shown. */
export const PROPOSAL_THRESHOLD = 0.5;

/**
 * Identity similarity of two rows over the identity columns, or 0 when any
 * one column clearly differs. The mean alone would rate "Naproxen · SPID · 6 h"
 * vs "Placebo · SPID · 6 h" at 0.67 on a three-column key — a confident
 * proposal to merge two arms — so a single clear difference vetoes.
 */
export function rowSimilarity(a: any, b: any, idCols: ColumnSpec[]): number {
  if (!idCols.length) return 0;
  let sum = 0;
  for (const col of idCols) {
    const s = cellSimilarity(a?.[col.field_name], b?.[col.field_name], col);
    const bothFilled = !isBlankKeyCell(a?.[col.field_name], col.options) && !isBlankKeyCell(b?.[col.field_name], col.options);
    if (bothFilled && s < BLOCKING_SIMILARITY) return 0;
    sum += s;
  }
  return sum / idCols.length;
}

function recordSimilarity(a: AlignedRecord, b: AlignedRecord, idCols: ColumnSpec[]): number {
  const ra = refsOf(a);
  const rb = refsOf(b);
  let min = 1;
  let sum = 0;
  let n = 0;
  for (const x of ra) for (const y of rb) {
    const s = rowSimilarity(x.row, y.row, idCols);
    min = Math.min(min, s);
    sum += s;
    n++;
  }
  if (!n || min === 0) return 0;
  return sum / n;
}

export function refsOf(rec: AlignedRecord): RowRef[] {
  return SOURCE_ORDER.map(s => rec.members[s]).filter((r): r is RowRef => !!r);
}

// ─── The model ────────────────────────────────────────────────────────────────

export type MatchStatus =
  | 'auto_aligned'   // joined on an exact, unique composite key
  | 'confirmed'      // the adjudicator matched these rows
  | 'needs_review'   // a proposal or a positional line-up waits for a decision
  | 'unmatched'      // only some sources have it, nothing proposed
  | 'kept_separate'  // the adjudicator said a proposal was not the same result
  | 'duplicate';     // a second row, from the same source, for a result already present

export interface MatchProposal {
  /** Stable: sorted refKeys of both sides. */
  id: string;
  kind: 'similar' | 'positional';
  /** The rows the proposal would put together. */
  a: AlignedRecord;
  b?: AlignedRecord;
  /** 0..1, for similar proposals. */
  confidence?: number;
}

export interface Entity {
  rec: AlignedRecord;
  status: MatchStatus;
  /** Sources that gave this table but have no row for this result. */
  missing: SourceKey[];
  /** Whether keeping this result is a decision: some source lacks it, or only
   *  one source gave the table at all (nothing corroborates it). */
  askInclude: boolean;
  /** Set when the adjudicator marked this record a duplicate of another. */
  duplicateOf?: string;
}

export type Issue =
  | {
      kind: 'cell';
      id: string;
      fieldName: string;
      recordId: string;
      column: string;
      resolved: boolean;
    }
  | {
      kind: 'record';
      id: string;
      fieldName: string;
      recordId: string;
      resolved: boolean;
    };

export interface ProvenanceEntry {
  record_id: string;
  match: MatchStatus;
  /** Source row numbers, 1-based, as a reviewer reads them. */
  rows: Partial<Record<SourceKey, number>>;
  included: boolean;
  /** Why an excluded result is out. `adjudicator` = left out with no reason given. */
  excluded_reason?: 'adjudicator' | 'duplicate' | ExcludeReason;
  /** For a duplicate: the record that represents it. */
  duplicate_of?: string;
  /** Column → where the final value came from ("agreed" when all members matched). */
  cells: Record<string, SourceKey | 'custom' | 'agreed'>;
  notes?: Record<string, string>;
  /** The adjudicator's note on the whole result. */
  note?: string;
}

export interface TableModel {
  fieldName: string;
  cols: ColumnSpec[];
  keyCols: ColumnSpec[];
  /** Identity columns shown on the match card: the key, or the first five columns. */
  idCols: ColumnSpec[];
  rowCounts: Partial<Record<SourceKey, number>>;
  /** Sources that reported the whole table absent (NR/NA) instead of rows. */
  absentSources: Partial<Record<SourceKey, string>>;
  present: SourceKey[];
  entities: Entity[];
  proposals: MatchProposal[];
  issues: Issue[];
  counts: { aligned: number; needsReview: number; unmatched: number; duplicates: number; openIssues: number };
  /** Same-source pairs that look like one result entered twice, not yet answered. */
  duplicateSuggestions: DuplicateSuggestion[];
  /** Null while any match or issue is open. */
  finalRows: any[] | null;
  provenance: ProvenanceEntry[] | null;
}

export interface DuplicateSuggestion {
  /** `duplicatePairId` of the two rows. */
  id: string;
  source: SourceKey;
  /** The result that stays. */
  keep: AlignedRecord;
  /** The result proposed as the repeat. */
  repeat: AlignedRecord;
  confidence: number;
}

/** Same-source rows this alike are asked about as possible duplicates. */
export const DUPLICATE_THRESHOLD = 0.9;

export function duplicatePairId(a: RowRef, b: RowRef): string {
  return [refKey(a), refKey(b)].sort().join('~');
}

export function proposalId(recs: AlignedRecord[]): string {
  return recs.flatMap(r => refsOf(r).map(refKey)).sort().join('|');
}

function explodePositional(records: AlignedRecord[], split: Set<string>): AlignedRecord[] {
  const out: AlignedRecord[] = [];
  for (const r of records) {
    if (r.alignment === 'positional-unverified' && split.has(r.id) && refsOf(r).length > 1) {
      for (const ref of refsOf(r)) {
        out.push({ id: `s:${refKey(ref)}`, alignment: 'incomplete-key', identity: null, members: { [ref.source]: ref } });
      }
    } else out.push(r);
  }
  return out;
}

/**
 * Greedy one-to-one proposals: the best-scoring pair first, each record in at
 * most one proposal. Records already complete (every present source has a row)
 * are not candidates.
 */
function buildProposals(
  records: AlignedRecord[],
  present: SourceKey[],
  idCols: ColumnSpec[],
  rejected: Set<string>,
): MatchProposal[] {
  const open = records.filter(
    r => r.alignment !== 'positional-unverified' && present.some(s => !r.members[s]),
  );
  const pairs: Array<{ a: AlignedRecord; b: AlignedRecord; score: number; id: string }> = [];
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i];
      const b = open[j];
      if (!canPair(a, b)) continue;
      const id = proposalId([a, b]);
      if (rejected.has(id)) continue;
      const score = recordSimilarity(a, b, idCols);
      if (score >= PROPOSAL_THRESHOLD) pairs.push({ a, b, score, id });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const used = new Set<string>();
  const out: MatchProposal[] = [];
  for (const p of pairs) {
    if (used.has(p.a.id) || used.has(p.b.id)) continue;
    used.add(p.a.id);
    used.add(p.b.id);
    out.push({ id: p.id, kind: 'similar', a: p.a, b: p.b, confidence: p.score });
  }
  return out;
}

/** The source a record's non-conflicting cells are read from. */
function baseSource(rec: AlignedRecord, legacy?: SourceKey | null): SourceKey | null {
  if (legacy && rec.members[legacy]) return legacy;
  return SOURCE_ORDER.find(s => rec.members[s]) ?? null;
}

/** A typed value as a cell envelope, status derived from what was typed. */
export function customCell(value: any, options?: string[] | null): any {
  return { value, source_text: '', status: classify(value, options) };
}

export function buildTableModel(
  fieldName: string,
  cols: ColumnSpec[],
  keyNames: string[],
  sources: Partial<Record<SourceKey, any>>,
  state: TableConsensusState,
  absenceOf: (v: any) => string | null,
): TableModel {
  const keyCols = keyNames.map(k => cols.find(c => c.field_name === k)).filter((c): c is ColumnSpec => !!c);
  const idCols = keyCols.length ? keyCols : cols.slice(0, 5);

  const rowsBySource: Partial<Record<SourceKey, any[]>> = {};
  const absentSources: Partial<Record<SourceKey, string>> = {};
  const rowCounts: Partial<Record<SourceKey, number>> = {};
  for (const s of SOURCE_ORDER) {
    const v = sources[s];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      rowsBySource[s] = v;
      rowCounts[s] = v.length;
    } else {
      const a = absenceOf(v);
      if (a) absentSources[s] = a;
    }
  }
  const present = SOURCE_ORDER.filter(s => rowsBySource[s]);
  // A source that said "this table is not reported" is a claim about every row,
  // so its absence counts toward "which sources lack this result".
  const claimants = SOURCE_ORDER.filter(s => rowsBySource[s] || absentSources[s]);

  const split = new Set(state.split);
  const confirmed = new Set(state.confirmed);
  const rejected = new Set(state.rejected);

  const base = alignTableRows(rowsBySource, keyCols);
  const records = applyManualPairs(explodePositional(base, split), state.groups);
  const dupOf = validDuplicates(records, state.duplicates);

  const positionalOpen = records.filter(
    r => r.alignment === 'positional-unverified' && refsOf(r).length > 1 && !confirmed.has(r.id),
  );
  const proposals: MatchProposal[] = [
    ...positionalOpen.map(r => ({ id: `pos:${r.id}`, kind: 'positional' as const, a: r })),
    ...buildProposals(records.filter(r => !dupOf.has(r.id)), present, idCols, rejected),
  ];
  const inProposal = new Set<string>();
  for (const p of proposals) {
    inProposal.add(p.a.id);
    if (p.b) inProposal.add(p.b.id);
  }
  const rejectedMembers = new Set(state.rejected.flatMap(id => id.split('|')));

  const entities: Entity[] = records.map(rec => {
    const missing = claimants.filter(s => !rec.members[s]);
    const n = refsOf(rec).length;
    let status: MatchStatus;
    if (dupOf.has(rec.id)) status = 'duplicate';
    else if (inProposal.has(rec.id)) status = 'needs_review';
    else if (rec.alignment === 'manual' || (rec.alignment === 'positional-unverified' && confirmed.has(rec.id))) status = 'confirmed';
    else if (n > 1 && rec.alignment === 'key') status = 'auto_aligned';
    else if (n > 1 && rec.alignment === 'positional-unverified') status = 'needs_review';
    else if (refsOf(rec).some(r => rejectedMembers.has(refKey(r)))) status = 'kept_separate';
    else if (missing.length === 0) status = 'auto_aligned';
    else status = 'unmatched';
    return {
      rec, status, missing,
      askInclude: status !== 'duplicate' && (missing.length > 0 || claimants.length === 1),
      ...(dupOf.has(rec.id) ? { duplicateOf: dupOf.get(rec.id) } : {}),
    };
  });

  // ── Issues ──
  const issues: Issue[] = [];
  for (const e of entities) {
    if (e.status === 'needs_review' || e.status === 'duplicate') continue; // matching comes first
    const rid = e.rec.id;
    const members = refsOf(e.rec);
    if (e.askInclude) {
      const decided = rid in state.include || !!state.legacyPick;
      issues.push({ kind: 'record', id: `rec:${fieldName}:${rid}`, fieldName, recordId: rid, resolved: decided });
      if (state.include[rid] === false) continue;
      if (state.legacyPick && !(rid in state.include) && !e.rec.members[state.legacyPick]) continue;
    }
    if (members.length < 2) continue;
    for (const col of differingColumns(e.rec, cols)) {
      const pick = state.cells[rid]?.[col];
      const resolved = pick
        ? pick.from === 'custom' ? !isBlankCustom(pick.value) : !!e.rec.members[pick.from]
        : !!(state.legacyPick && e.rec.members[state.legacyPick]);
      issues.push({ kind: 'cell', id: `cell:${fieldName}:${rid}:${col}`, fieldName, recordId: rid, column: col, resolved });
    }
  }

  const needsReview = entities.filter(e => e.status === 'needs_review').length;
  const counts = {
    aligned: entities.filter(e => e.status === 'auto_aligned' || e.status === 'confirmed').length,
    needsReview,
    unmatched: entities.filter(e => e.status === 'unmatched' || e.status === 'kept_separate').length,
    duplicates: entities.filter(e => e.status === 'duplicate').length,
    openIssues: issues.filter(i => !i.resolved).length,
  };

  let finalRows: any[] | null = null;
  let provenance: ProvenanceEntry[] | null = null;
  if (needsReview === 0 && counts.openIssues === 0) {
    finalRows = [];
    provenance = [];
    for (const e of entities) {
      const rid = e.rec.id;
      const rows: ProvenanceEntry['rows'] = {};
      for (const r of refsOf(e.rec)) rows[r.source] = r.rowIndex + 1;
      const included = isIncluded(e, state);
      const entry: ProvenanceEntry = { record_id: rid, match: e.status, rows, included, cells: {} };
      if (e.duplicateOf) { entry.excluded_reason = 'duplicate'; entry.duplicate_of = e.duplicateOf; }
      else if (!included) entry.excluded_reason = state.excludeReasons[rid] ?? 'adjudicator';
      if (state.resultNotes[rid]?.trim()) entry.note = state.resultNotes[rid].trim();
      if (!included) { provenance.push(entry); continue; }
      const bs = baseSource(e.rec, state.legacyPick)!;
      const baseRow = e.rec.members[bs]!.row ?? {};
      const out: Record<string, any> = { ...baseRow };
      const diff = refsOf(e.rec).length > 1 ? differingColumns(e.rec, cols) : new Set<string>();
      const notes: Record<string, string> = {};
      for (const col of cols) {
        const name = col.field_name;
        if (!diff.has(name)) {
          entry.cells[name] = refsOf(e.rec).length > 1 ? 'agreed' : bs;
          continue;
        }
        const pick = state.cells[rid]?.[name]
          ?? (state.legacyPick && e.rec.members[state.legacyPick] ? { from: state.legacyPick } as CellPick : undefined);
        if (!pick) continue;
        if (pick.from === 'custom') out[name] = customCell(pick.value, col.options);
        else out[name] = e.rec.members[pick.from]!.row?.[name];
        entry.cells[name] = pick.from;
        if (pick.note?.trim()) notes[name] = pick.note.trim();
      }
      if (Object.keys(notes).length) entry.notes = notes;
      finalRows.push(out);
      provenance.push(entry);
    }
  }

  // ── Possible duplicates: two live results holding near-identical rows from
  // one source. Only asked, never applied; "they are different" is remembered.
  const notDup = new Set(state.notDuplicates);
  const live = entities.filter(e => e.status !== 'duplicate');
  const duplicateSuggestions: DuplicateSuggestion[] = [];
  const claimed = new Set<string>();
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i].rec;
      const b = live[j].rec;
      for (const src of SOURCE_ORDER) {
        const ra = a.members[src];
        const rb = b.members[src];
        if (!ra || !rb) continue;
        const id = duplicatePairId(ra, rb);
        if (notDup.has(id)) continue;
        const score = rowSimilarity(ra.row, rb.row, idCols);
        if (score < DUPLICATE_THRESHOLD) continue;
        // The fuller result stays; on a tie the earlier row does.
        const aFirst = refsOf(a).length > refsOf(b).length || (refsOf(a).length === refsOf(b).length && ra.rowIndex < rb.rowIndex);
        const keep = aFirst ? a : b;
        const repeat = aFirst ? b : a;
        if (claimed.has(repeat.id)) continue;
        claimed.add(repeat.id);
        duplicateSuggestions.push({ id, source: src, keep, repeat, confidence: score });
      }
    }
  }

  return {
    fieldName, cols, keyCols, idCols, rowCounts, absentSources, present,
    entities, proposals, issues, counts, finalRows, provenance, duplicateSuggestions,
  };
}

function isBlankCustom(v: any): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

export function isIncluded(e: Entity, state: TableConsensusState): boolean {
  if (e.duplicateOf) return false;
  if (!e.askInclude) return true;
  const rid = e.rec.id;
  if (rid in state.include) return state.include[rid];
  if (state.legacyPick) return !!e.rec.members[state.legacyPick];
  return false;
}

/** Duplicate marks that still point at a live, non-duplicate record sharing a source. */
function validDuplicates(records: AlignedRecord[], marks: Record<string, string>): Map<string, string> {
  const byId = new Map(records.map(r => [r.id, r]));
  const byRef = new Map<string, AlignedRecord>();
  for (const r of records) for (const ref of refsOf(r)) byRef.set(refKey(ref), r);
  const out = new Map<string, string>();
  for (const [id, repRef] of Object.entries(marks ?? {})) {
    const a = byId.get(id);
    const b = byRef.get(repRef);
    if (!a || !b || a.id === b.id || marks[b.id]) continue;
    if (!sharesSource(a, b)) continue;
    out.set(id, b.id);
  }
  return out;
}

function sharesSource(a: AlignedRecord, b: AlignedRecord): boolean {
  return SOURCE_ORDER.some(s => a.members[s] && b.members[s]);
}

/** Results this one could be a duplicate of: another live result with a row from the same source. */
export function duplicateCandidates(model: TableModel, rec: AlignedRecord): AlignedRecord[] {
  return model.entities
    .filter(e => e.rec.id !== rec.id && e.status !== 'duplicate' && sharesSource(e.rec, rec))
    .map(e => e.rec);
}

// ─── State transitions (pure; the page stores the result) ─────────────────────

export function acceptProposal(state: TableConsensusState, p: MatchProposal): TableConsensusState {
  if (p.kind === 'positional') return { ...state, confirmed: [...new Set([...state.confirmed, p.a.id])] };
  const merged = new Set([...refsOf(p.a), ...refsOf(p.b!)].map(refKey));
  return {
    ...state,
    groups: [...state.groups.filter(g => !g.some(k => merged.has(k))), [...merged]],
  };
}

export function rejectProposal(state: TableConsensusState, p: MatchProposal): TableConsensusState {
  if (p.kind === 'positional') return { ...state, split: [...new Set([...state.split, p.a.id])] };
  return { ...state, rejected: [...new Set([...state.rejected, p.id])] };
}

/** Match two records by hand (the "Match manually" action). */
export function pairRecords(state: TableConsensusState, a: AlignedRecord, b: AlignedRecord): TableConsensusState {
  const merged = new Set([...refsOf(a), ...refsOf(b)].map(refKey));
  return {
    ...state,
    groups: [...state.groups.filter(g => !g.some(k => merged.has(k))), [...merged]],
    rejected: state.rejected.filter(id => id !== proposalId([a, b])),
  };
}

/** Undo a manual match, and forget any cell picks made on it. */
export function unpairRecord(state: TableConsensusState, rec: AlignedRecord): TableConsensusState {
  const mine = new Set(refsOf(rec).map(refKey));
  const cells = { ...state.cells };
  delete cells[rec.id];
  return {
    ...state,
    groups: state.groups.filter(g => !g.some(k => mine.has(k))),
    confirmed: state.confirmed.filter(id => id !== rec.id),
    cells,
  };
}

export function setInclude(state: TableConsensusState, recordId: string, include: boolean): TableConsensusState {
  const next = { ...state, include: { ...state.include, [recordId]: include } };
  if (include && recordId in state.excludeReasons) {
    const excludeReasons = { ...state.excludeReasons };
    delete excludeReasons[recordId];
    next.excludeReasons = excludeReasons;
  }
  return next;
}

export function setCellPick(state: TableConsensusState, recordId: string, column: string, pick: CellPick | null): TableConsensusState {
  const cur = { ...(state.cells[recordId] ?? {}) };
  if (pick) cur[column] = pick;
  else delete cur[column];
  return { ...state, cells: { ...state.cells, [recordId]: cur } };
}

/** Distinct values for one column across a record's members, agreeing sources grouped. */
export function valueOptions(rec: AlignedRecord, col: ColumnSpec): Array<{ sources: SourceKey[]; cell: any }> {
  const out: Array<{ key: string | null; sources: SourceKey[]; cell: any }> = [];
  for (const ref of refsOf(rec)) {
    const cell = ref.row?.[col.field_name];
    const k = compareKey(cell, col.options);
    const hit = k !== null ? out.find(o => o.key === k) : undefined;
    if (hit) hit.sources.push(ref.source);
    else out.push({ key: k, sources: [ref.source], cell });
  }
  return out.map(({ sources, cell }) => ({ sources, cell }));
}

/**
 * One result as it currently stands, decided or not — for the final-review
 * table, which shows progress before everything is settled. `open` marks a
 * conflicting cell nobody has picked yet.
 */
export function previewCells(
  e: Entity,
  cols: ColumnSpec[],
  state: TableConsensusState,
): Record<string, { cell: any; from: SourceKey | 'custom' | 'agreed' | null; open: boolean }> {
  const out: Record<string, { cell: any; from: SourceKey | 'custom' | 'agreed' | null; open: boolean }> = {};
  const members = refsOf(e.rec);
  const bs = baseSource(e.rec, state.legacyPick);
  const diff = members.length > 1 ? differingColumns(e.rec, cols) : new Set<string>();
  for (const col of cols) {
    const name = col.field_name;
    const baseCell = bs ? e.rec.members[bs]!.row?.[name] : undefined;
    if (!diff.has(name)) {
      out[name] = { cell: baseCell, from: members.length > 1 ? 'agreed' : bs, open: false };
      continue;
    }
    const pick = state.cells[e.rec.id]?.[name]
      ?? (state.legacyPick && e.rec.members[state.legacyPick] ? ({ from: state.legacyPick } as CellPick) : undefined);
    if (!pick) out[name] = { cell: baseCell, from: null, open: true };
    else if (pick.from === 'custom') out[name] = { cell: customCell(pick.value, col.options), from: 'custom', open: false };
    else out[name] = { cell: e.rec.members[pick.from]?.row?.[name], from: pick.from, open: false };
  }
  return out;
}

export function markDuplicate(state: TableConsensusState, dup: AlignedRecord, representative: AlignedRecord): TableConsensusState {
  const shared = SOURCE_ORDER.find(s => dup.members[s] && representative.members[s]) ?? refsOf(representative)[0]?.source;
  const anchor = shared && representative.members[shared];
  if (!anchor) return state;
  const include = { ...state.include };
  delete include[dup.id];
  return { ...state, include, duplicates: { ...state.duplicates, [dup.id]: refKey(anchor) } };
}

export function clearDuplicate(state: TableConsensusState, recordId: string): TableConsensusState {
  const duplicates = { ...state.duplicates };
  delete duplicates[recordId];
  return { ...state, duplicates };
}

export function setExclude(state: TableConsensusState, recordId: string, reason?: ExcludeReason): TableConsensusState {
  const excludeReasons = { ...state.excludeReasons };
  if (reason) excludeReasons[recordId] = reason;
  else delete excludeReasons[recordId];
  return { ...setInclude(state, recordId, false), excludeReasons };
}

/** Undo a keep / leave-out decision: the result is undecided again. */
export function clearInclude(state: TableConsensusState, recordId: string): TableConsensusState {
  const include = { ...state.include };
  delete include[recordId];
  const excludeReasons = { ...state.excludeReasons };
  delete excludeReasons[recordId];
  return { ...state, include, excludeReasons };
}

export function markNotDuplicate(state: TableConsensusState, pairId: string): TableConsensusState {
  return { ...state, notDuplicates: [...new Set([...state.notDuplicates, pairId])] };
}

/** Reconsider a rejected match: it becomes a live candidate again. */
export function reconsiderMatch(state: TableConsensusState, id: string): TableConsensusState {
  return { ...state, rejected: state.rejected.filter(x => x !== id) };
}

export function rejectMatch(state: TableConsensusState, a: AlignedRecord, b: AlignedRecord): TableConsensusState {
  return { ...state, rejected: [...new Set([...state.rejected, proposalId([a, b])])] };
}

export function setResultNote(state: TableConsensusState, recordId: string, note: string): TableConsensusState {
  const resultNotes = { ...state.resultNotes };
  if (note.trim()) resultNotes[recordId] = note;
  else delete resultNotes[recordId];
  return { ...state, resultNotes };
}

export interface MatchCandidate {
  rec: AlignedRecord;
  /** 0 when a hard veto applies (another dose, timepoint, arm…). */
  score: number;
  /** `proposalId` of this pairing — what a rejection records. */
  pairId: string;
  rejected: boolean;
}

/**
 * Rows or existing results this result could join, best first. Group-aware: a
 * candidate that is already R1 + AI is scored against both members, and one
 * clear difference from either vetoes it. Results holding a row from the same
 * source are never candidates (one row per source) — those go to duplicates.
 */
export function matchCandidates(model: TableModel, rec: AlignedRecord, state: TableConsensusState): MatchCandidate[] {
  const rejected = new Set(state.rejected);
  return model.entities
    .filter(e => e.status !== 'duplicate' && e.rec.id !== rec.id && canPair(rec, e.rec))
    .map(e => {
      const pairId = proposalId([rec, e.rec]);
      return { rec: e.rec, score: recordSimilarity(rec, e.rec, model.idCols), pairId, rejected: rejected.has(pairId) };
    })
    .sort((x, y) => y.score - x.score);
}

/** Rows from the same source as `rec` that were left out of candidates, for the explanation. */
export function sameSourceCount(model: TableModel, rec: AlignedRecord): number {
  return model.entities.filter(e => e.rec.id !== rec.id && !canPair(rec, e.rec)).length;
}

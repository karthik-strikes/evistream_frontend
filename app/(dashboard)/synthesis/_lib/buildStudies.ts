/**
 * Turn long-format extraction rows into meta-analysis inputs.
 *
 * The one rule this file exists to enforce: **every row that matched the chosen
 * comparison is accounted for**. A row either becomes a study or lands in the
 * exclusion ledger with a reason a reviewer can act on. Nothing is dropped for
 * being inconvenient — a silently discarded study is an invisible bias, and it
 * is exactly what a reviewer would be blamed for at peer review.
 *
 * Rows arrive from `lib/longFormatTransform.ts`, which has already unwrapped the
 * `{value, source_text, status}` envelopes, joined parent tables and handled
 * legacy bare-row-list results.
 */

import { canonicalAbsenceLabel, FAILED_LABEL } from '@/lib/absence';
import type { LongFormatRow } from '@/lib/longFormatTransform';
import type { Arm, BinaryArm, ContinuousArm, MetaStudy } from '@/lib/metaAnalysis';
import type { Mapping, OutcomeKind, TableLayout } from './mapping';
import {
  canonicalValue, shouldFlipSign,
  type Confirmations, type Directions, type Harmonization,
} from './reconcile';

// ── Reasons ──────────────────────────────────────────────────────────────────

export type ExclusionReason =
  | 'not_reported'
  | 'not_applicable'
  | 'extraction_failed'
  | 'blank'
  | 'unparseable'
  | 'no_comparator_row'
  | 'ambiguous_grouping'
  | 'harmonization_excluded'
  | 'variability_excluded'
  | 'variability_unusable'
  | 'median_excluded'
  // Reached the statistics but produced no estimate. These come back from
  // runMetaAnalysis rather than from parsing, and are folded into the same
  // ledger so its total always reconciles with the plot.
  | 'zero_events_both_arms'
  | 'no_variance'
  | 'not_estimable';

export const EXCLUSION_TEXT: Record<ExclusionReason, string> = {
  not_reported: 'marked "not reported" — an absence state, never coerced to 0',
  not_applicable: 'marked "not applicable" — the study design excludes this outcome',
  extraction_failed: 'extraction failed for this value — not the same as the paper not reporting it',
  blank: 'no value was extracted for a required column',
  unparseable: 'a required value is text that could not be read as a number',
  no_comparator_row: 'no row in this study matches the comparator arm, so nothing to compare against',
  ambiguous_grouping:
    'more than one comparator row shares these values, so which row pairs with which is undecidable '
    + '— map the timepoint column (or whatever else separates them) and this resolves',
  harmonization_excluded: 'its timepoint value was excluded on the Harmonize values card',
  variability_excluded: 'excluded by your choice for this variability measure',
  variability_unusable: 'the variability value could not be converted to a standard deviation',
  median_excluded: 'reports a median, which you chose to exclude rather than approximate',
  zero_events_both_arms: 'zero events in both arms — no ratio is estimable from it',
  no_variance: 'variance is zero or undefined — no confidence interval is estimable',
  not_estimable: 'the mapped values cannot produce this effect measure',
};

/** Fold a `runMetaAnalysis` refusal into the ledger's vocabulary. */
export function reasonFromNotEstimable(reason: string): ExclusionReason {
  if (reason === 'zero_events_both_arms') return 'zero_events_both_arms';
  if (reason === 'zero_variance') return 'no_variance';
  return 'not_estimable';
}

export interface ExcludedStudy {
  key: string;
  documentId: string;
  label: string;
  reason: ExclusionReason;
  /** Which column caused it, when a single column is to blame. */
  column?: string;
}

// ── Value parsing ────────────────────────────────────────────────────────────

type Parsed =
  | { ok: true; value: number }
  | { ok: false; reason: ExclusionReason };

/**
 * Read a mapped cell as a number, respecting the four-state absence vocabulary.
 *
 * NR and NA are answers, not zeros — collapsing "not reported" to 0 events would
 * invent data — so each becomes its own exclusion reason rather than a value.
 */
export function parseNumber(raw: unknown, display: unknown): Parsed {
  const text = String(display ?? '').trim();
  if (text === '') return { ok: false, reason: 'blank' };
  if (text === FAILED_LABEL) return { ok: false, reason: 'extraction_failed' };

  const absence = canonicalAbsenceLabel(text);
  if (absence === 'NR') return { ok: false, reason: 'not_reported' };
  if (absence === 'NA') return { ok: false, reason: 'not_applicable' };

  const cleaned = text.replace(/[,\s]/g, '').replace(/%$/, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, reason: 'unparseable' };
  return { ok: true, value: n };
}

/** Pull every number out of a free-text bound like "1.2 to 3.4" or "(0.8, 2.1)". */
function numbersIn(text: string): number[] {
  const hits = text.match(/-?\d+(?:\.\d+)?/g);
  return hits ? hits.map(Number).filter(Number.isFinite) : [];
}

// ── Variability ──────────────────────────────────────────────────────────────

export type VariabilityKind = 'SD' | 'SE' | 'CI' | 'IQR' | 'RANGE' | 'NA' | 'UNKNOWN';
export type VariabilityAction = 'use' | 'convert' | 'approximate' | 'exclude';

/** Map a form's declared option text onto a conversion we know how to do. */
export function classifyVariability(measure: string): VariabilityKind {
  const m = (measure || '').trim().toLowerCase();
  if (!m) return 'UNKNOWN';
  if (/^n\.?a\.?$|not applicable/.test(m)) return 'NA';
  if (/standard error|^se$|\bsem\b/.test(m)) return 'SE';
  if (/standard deviation|^sd$/.test(m)) return 'SD';
  if (/confidence interval|\bci\b/.test(m)) return 'CI';
  if (/interquartile|\biqr\b/.test(m)) return 'IQR';
  if (/range|min.*max|minimum/.test(m)) return 'RANGE';
  return 'UNKNOWN';
}

export const DEFAULT_VARIABILITY_ACTION: Record<VariabilityKind, VariabilityAction> = {
  SD: 'use',
  SE: 'convert',
  CI: 'convert',
  IQR: 'approximate',
  RANGE: 'approximate',
  NA: 'exclude',
  UNKNOWN: 'exclude',
};

/** The formula shown beside each measure in the units card. */
export const VARIABILITY_FORMULA: Record<VariabilityKind, string> = {
  SD: '',
  SE: 'SD = SE × √N',
  CI: 'SD = √N × (upper − lower) / 3.92',
  IQR: 'SD ≈ IQR / 1.35',
  RANGE: 'SD ≈ range / 4',
  NA: 'declared option — no variability reported',
  UNKNOWN: 'measure not recognised — cannot convert safely',
};

export const VARIABILITY_LABEL: Record<VariabilityKind, string> = {
  SD: 'Standard deviation',
  SE: 'Standard error',
  CI: '95% confidence interval',
  IQR: 'Interquartile range',
  RANGE: 'Range (min & max)',
  NA: 'NA',
  UNKNOWN: 'Unrecognised measure',
};

/**
 * Convert a reported spread into a standard deviation.
 *
 * `use` takes the number at face value whatever it was declared as, which is the
 * reviewer explicitly overriding the declaration. Everything else follows the
 * standard Cochrane conversions.
 */
export function toStandardDeviation(
  text: string,
  kind: VariabilityKind,
  n: number,
  action: VariabilityAction,
): { ok: true; sd: number } | { ok: false; reason: ExclusionReason } {
  if (action === 'exclude') return { ok: false, reason: 'variability_excluded' };

  const parts = numbersIn(text);
  if (parts.length === 0) return { ok: false, reason: 'variability_unusable' };

  const spread = parts.length >= 2 ? Math.abs(parts[1] - parts[0]) : Math.abs(parts[0]);
  const single = Math.abs(parts[0]);

  let sd: number;
  if (action === 'use') {
    sd = single;
  } else if (kind === 'SE' && action === 'convert') {
    sd = single * Math.sqrt(n);
  } else if (kind === 'CI' && action === 'convert') {
    if (parts.length < 2) return { ok: false, reason: 'variability_unusable' };
    sd = (Math.sqrt(n) * spread) / 3.92;
  } else if (kind === 'IQR' && action === 'approximate') {
    sd = spread / 1.35;
  } else if (kind === 'RANGE' && action === 'approximate') {
    if (parts.length < 2) return { ok: false, reason: 'variability_unusable' };
    sd = spread / 4;
  } else if (kind === 'SD') {
    sd = single;
  } else {
    return { ok: false, reason: 'variability_unusable' };
  }

  if (!Number.isFinite(sd) || sd < 0) return { ok: false, reason: 'variability_unusable' };
  return { ok: true, sd };
}

export type CentralTendencyAction = 'use' | 'approximate' | 'exclude';

export function isMedian(measure: string): boolean {
  return /median/i.test(measure || '');
}

// ── Pairing ──────────────────────────────────────────────────────────────────

/** One comparison, before its numbers have been read. */
export interface Pairing {
  key: string;
  /** Identity of the (document, outcome, timepoint) group this came from. */
  groupKey: string;
  documentId: string;
  label: string;
  outcome: string;
  timepoint: string;
  comparison: string;
  treatmentRow: LongFormatRow;
  comparatorRow: LongFormatRow;
  /** True when this document contributed several treatment arms against one comparator. */
  sharedComparator: boolean;
}

export interface PairingResult {
  pairings: Pairing[];
  excluded: ExcludedStudy[];
  /**
   * Groups whose comparator arm is shared across more than one comparison.
   *
   * Keyed by group, NOT by document: one paper reporting several outcomes has
   * a separate shared-control situation per outcome, and collapsing them to the
   * document made the ledger claim one trial had "49 treatment arms".
   */
  multiArm: Array<{
    groupKey: string;
    documentId: string;
    label: string;
    arms: number;
  }>;
}

const cell = (row: LongFormatRow, col?: string): string =>
  col ? String(row[col] ?? '').trim() : '';

const studyLabel = (row: LongFormatRow): string =>
  String(row.Paper ?? row._paperFilename ?? row._documentId ?? '').replace(/\.pdf$/i, '');

/**
 * Build the comparisons a table describes.
 *
 * `wide` is already one comparison per row. `long` is one arm per row, so rows
 * are grouped by (document, outcome, timepoint) and the row whose arm column
 * equals the declared comparator becomes the control for every other row in the
 * group — which is how a three-arm trial ends up sharing one placebo arm.
 */
export function buildPairings(
  rows: LongFormatRow[],
  mapping: Mapping,
  layout: TableLayout,
  comparatorValue: string,
  comparisonColumn: string | null,
  armLabelColumns: { treatment: string | null; comparator: string | null },
  harmonize?: { choices: Harmonization; confirmed: Confirmations },
): PairingResult {
  const outcomeCol = mapping.outcome?.col;
  const timeCol = mapping.timepoint?.col;
  const armCol = mapping.arm?.col;

  const excluded: ExcludedStudy[] = [];
  const multiArm: PairingResult['multiArm'] = [];

  /**
   * The timepoint as the analysis should see it, with confirmed merges applied.
   *
   * This has to happen BEFORE grouping, not after: harmonization exists so that
   * rows recorded as "6 hrs" and "360 minutes" land in the same group, and a
   * group key built from raw values would have already separated them.
   * Returns null when the reviewer excluded that value outright.
   */
  const timepointOf = (row: LongFormatRow): string | null => {
    const raw = cell(row, timeCol);
    if (!harmonize || !raw) return raw;
    return canonicalValue(raw, harmonize.choices, harmonize.confirmed);
  };

  // Rows whose timepoint was excluded never reach grouping, but they are still
  // named — an excluded row is a decision, not a disappearance.
  const droppedByHarmonization = new Set<LongFormatRow>();
  if (harmonize && timeCol) {
    for (const row of rows) {
      if (timepointOf(row) === null) droppedByHarmonization.add(row);
    }
    for (const row of droppedByHarmonization) {
      excluded.push({
        key: `${row._documentId}:harmonized:${cell(row, timeCol)}`,
        documentId: row._documentId,
        label: studyLabel(row),
        reason: 'harmonization_excluded',
        column: timeCol,
      });
    }
    rows = rows.filter(r => !droppedByHarmonization.has(r));
  }

  if (layout === 'wide') {
    const pairings = rows.map((row, i) => {
      const comparison = comparisonColumn
        ? cell(row, comparisonColumn)
        : armLabelColumns.treatment && armLabelColumns.comparator
          ? `${cell(row, armLabelColumns.treatment)} vs ${cell(row, armLabelColumns.comparator)}`
          : ALL_COMPARISONS;
      return {
        key: `${row._documentId}:${i}`,
        groupKey: `${row._documentId}:${i}`,
        documentId: row._documentId,
        label: studyLabel(row),
        outcome: cell(row, outcomeCol),
        timepoint: timepointOf(row) ?? '',
        comparison: comparison || ALL_COMPARISONS,
        treatmentRow: row,
        comparatorRow: row,
        sharedComparator: false,
      };
    });
    return { pairings, excluded, multiArm };
  }

  // Long: group, then pair each treatment arm against the group's comparator.
  const groups = new Map<string, LongFormatRow[]>();
  for (const row of rows) {
    const gk = [row._documentId, cell(row, outcomeCol), timepointOf(row) ?? ''].join(' ');
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk)!.push(row);
  }

  const pairings: Pairing[] = [];
  for (const [gk, groupRows] of groups) {
    const controls = groupRows.filter(r => cell(r, armCol) === comparatorValue);
    const treatments = groupRows.filter(r => cell(r, armCol) !== comparatorValue);

    if (controls.length === 0 || treatments.length === 0) {
      // Every row in an unpairable group is reported, once per document.
      const first = groupRows[0];
      excluded.push({
        key: gk,
        documentId: first._documentId,
        label: studyLabel(first),
        reason: 'no_comparator_row',
        column: armCol,
      });
      continue;
    }

    // More than one comparator row means this group key does not identify a
    // single comparison — usually the timepoint column is unmapped, so rows
    // from every timepoint have collapsed together. Taking one arbitrarily
    // would pair a 6-hour treatment arm against a 2-hour placebo arm and put a
    // wrong number on the plot, so refuse the group and say why.
    if (controls.length > 1) {
      excluded.push({
        key: gk,
        documentId: controls[0]._documentId,
        label: studyLabel(controls[0]),
        reason: 'ambiguous_grouping',
        column: armCol,
      });
      continue;
    }

    const control = controls[0];
    if (treatments.length > 1) {
      multiArm.push({
        groupKey: gk,
        documentId: control._documentId,
        label: studyLabel(control),
        arms: treatments.length,
      });
    }

    for (const treatment of treatments) {
      pairings.push({
        key: `${gk} ${cell(treatment, armCol)}`,
        groupKey: gk,
        documentId: treatment._documentId,
        label: studyLabel(treatment),
        outcome: cell(treatment, outcomeCol),
        timepoint: timepointOf(treatment) ?? '',
        comparison: `${cell(treatment, armCol)} vs ${comparatorValue}`,
        treatmentRow: treatment,
        comparatorRow: control,
        sharedComparator: treatments.length > 1,
      });
    }
  }

  return { pairings, excluded, multiArm };
}

// ── Facets ───────────────────────────────────────────────────────────────────

export const ALL_COMPARISONS = 'All mapped rows';

export interface Facet {
  value: string;
  /** Documents contributing at least one row with this value. */
  documents: number;
}

function facetOf(pairings: Pairing[], pick: (p: Pairing) => string): Facet[] {
  const map = new Map<string, Set<string>>();
  for (const p of pairings) {
    const v = pick(p);
    if (!v) continue;
    if (!map.has(v)) map.set(v, new Set());
    map.get(v)!.add(p.documentId);
  }
  return [...map.entries()]
    .map(([value, docs]) => ({ value, documents: docs.size }))
    .sort((a, b) => b.documents - a.documents || a.value.localeCompare(b.value));
}

export interface Facets {
  outcomes: Facet[];
  comparisons: Facet[];
  timepoints: Facet[];
  /**
   * True when each outcome value implies exactly one timepoint — several real
   * forms encode "Pain relief at 6 hours" in the outcome column, so the
   * timepoint follows the outcome and must not be independently selectable.
   */
  timepointFollowsOutcome: boolean;
  timepointByOutcome: Record<string, string>;
}

export function facetsOf(pairings: Pairing[]): Facets {
  const byOutcome = new Map<string, Set<string>>();
  for (const p of pairings) {
    if (!p.outcome) continue;
    if (!byOutcome.has(p.outcome)) byOutcome.set(p.outcome, new Set());
    if (p.timepoint) byOutcome.get(p.outcome)!.add(p.timepoint);
  }
  const timepointByOutcome: Record<string, string> = {};
  let follows = byOutcome.size > 0;
  for (const [outcome, times] of byOutcome) {
    if (times.size > 1) follows = false;
    timepointByOutcome[outcome] = [...times][0] ?? '';
  }

  return {
    outcomes: facetOf(pairings, p => p.outcome),
    comparisons: facetOf(pairings, p => p.comparison),
    timepoints: facetOf(pairings, p => p.timepoint),
    timepointFollowsOutcome: follows,
    timepointByOutcome,
  };
}

// ── Column detection ─────────────────────────────────────────────────────────

const ARM1 = /(^|_)(arm)?1(_|$)|treat|interven|experim/i;
const ARM2 = /(^|_)(arm)?2(_|$)|control|compar|placebo|referen/i;
const LABELISH = /label|name/i;

/** A column naming the whole comparison, if the form has one. */
export function detectComparisonColumn(columns: string[]): string | null {
  for (const exact of ['comparison', 'comparison_label', 'comparison_name']) {
    if (columns.includes(exact)) return exact;
  }
  const hits = columns.filter(c => /comparison/i.test(c));
  return hits.length === 1 ? hits[0] : null;
}

/** Arm-label columns sitting alongside the mapped measurement columns. */
export function detectArmLabelColumns(columns: string[]): {
  treatment: string | null;
  comparator: string | null;
} {
  const labels = columns.filter(c => LABELISH.test(c));
  const t = labels.filter(c => ARM1.test(c));
  const c = labels.filter(col => ARM2.test(col));
  return {
    treatment: t.length === 1 ? t[0] : null,
    comparator: c.length === 1 ? c[0] : null,
  };
}

/** The column declaring which spread measure the variability column holds. */
export function detectVariabilityMeasureColumn(columns: string[]): string | null {
  const hits = columns.filter(c => /variab.*measure|measure.*variab|dispersion_measure/i.test(c));
  return hits.length >= 1 ? hits[0] : null;
}

export function detectCentralTendencyMeasureColumn(columns: string[]): string | null {
  const hits = columns.filter(c => /central_tendency_(measure|type)|tendency_measure/i.test(c));
  return hits.length >= 1 ? hits[0] : null;
}

// ── Study construction ───────────────────────────────────────────────────────

export interface BuildOptions {
  kind: OutcomeKind;
  layout: TableLayout;
  mapping: Mapping;
  variabilityMeasureColumn: string | null;
  centralTendencyMeasureColumn: string | null;
  variabilityActions: Record<string, VariabilityAction>;
  centralTendencyActions: Record<string, CentralTendencyAction>;
  /** Column naming the measurement scale, for effect-direction reconciliation. */
  scaleColumn?: string | null;
  directions?: Directions;
  directionsConfirmed?: Confirmations;
}

export interface BuildResult {
  studies: MetaStudy[];
  excluded: ExcludedStudy[];
}

function armFromRow(
  row: LongFormatRow,
  cols: { value?: string; total?: string },
): { ok: true; arm: BinaryArm } | { ok: false; reason: ExclusionReason; column?: string } {
  const events = parseNumber(row._rawCells?.[cols.value ?? ''], row[cols.value ?? '']);
  if (!events.ok) return { ok: false, reason: events.reason, column: cols.value };
  const total = parseNumber(row._rawCells?.[cols.total ?? ''], row[cols.total ?? '']);
  if (!total.ok) return { ok: false, reason: total.reason, column: cols.total };
  return { ok: true, arm: { events: events.value, total: total.value } };
}

/**
 * Read the mapped columns off each pairing and produce study arms.
 *
 * Continuous long-format rows go through the units resolution: the row declares
 * which spread measure it reports, and the reviewer has said what to do with
 * each one. A row whose measure the reviewer excluded, or whose value cannot be
 * converted, is reported rather than quietly skipped.
 */
export function buildStudies(pairings: Pairing[], options: BuildOptions): BuildResult {
  const { kind, layout, mapping } = options;
  const studies: MetaStudy[] = [];
  const excluded: ExcludedStudy[] = [];

  const drop = (p: Pairing, reason: ExclusionReason, column?: string) =>
    excluded.push({ key: p.key, documentId: p.documentId, label: p.label, reason, column });

  for (const p of pairings) {
    let treatment: Arm | null = null;
    let comparator: Arm | null = null;

    if (kind === 'dichotomous') {
      if (layout === 'wide') {
        const t = armFromRow(p.treatmentRow, {
          value: mapping.events_treatment?.col,
          total: mapping.total_treatment?.col,
        });
        if (!t.ok) { drop(p, t.reason, t.column); continue; }
        const c = armFromRow(p.comparatorRow, {
          value: mapping.events_comparator?.col,
          total: mapping.total_comparator?.col,
        });
        if (!c.ok) { drop(p, c.reason, c.column); continue; }
        treatment = t.arm;
        comparator = c.arm;
      } else {
        const cols = { value: mapping.value?.col, total: mapping.denominator?.col };
        const t = armFromRow(p.treatmentRow, cols);
        if (!t.ok) { drop(p, t.reason, t.column); continue; }
        const c = armFromRow(p.comparatorRow, cols);
        if (!c.ok) { drop(p, c.reason, c.column); continue; }
        treatment = t.arm;
        comparator = c.arm;
      }
    } else if (layout === 'wide') {
      const read = (m?: string, s?: string, n?: string, row = p.treatmentRow) => {
        const mean = parseNumber(row._rawCells?.[m ?? ''], row[m ?? '']);
        if (!mean.ok) return { ok: false as const, reason: mean.reason, column: m };
        const sd = parseNumber(row._rawCells?.[s ?? ''], row[s ?? '']);
        if (!sd.ok) return { ok: false as const, reason: sd.reason, column: s };
        const count = parseNumber(row._rawCells?.[n ?? ''], row[n ?? '']);
        if (!count.ok) return { ok: false as const, reason: count.reason, column: n };
        return { ok: true as const, arm: { mean: mean.value, sd: sd.value, n: count.value } };
      };
      const t = read(mapping.mean_treatment?.col, mapping.sd_treatment?.col, mapping.n_treatment?.col);
      if (!t.ok) { drop(p, t.reason, t.column); continue; }
      const c = read(
        mapping.mean_comparator?.col, mapping.sd_comparator?.col, mapping.n_comparator?.col,
        p.comparatorRow,
      );
      if (!c.ok) { drop(p, c.reason, c.column); continue; }
      treatment = t.arm;
      comparator = c.arm;
    } else {
      // Long + continuous — the units resolution lives here.
      const readArm = (
        row: LongFormatRow,
      ): { ok: true; arm: ContinuousArm } | { ok: false; reason: ExclusionReason; column?: string } => {
        const valueCol = mapping.value?.col;
        const varCol = mapping.variability?.col;
        const nCol = mapping.denominator?.col;

        const ct = options.centralTendencyMeasureColumn
          ? String(row[options.centralTendencyMeasureColumn] ?? '')
          : '';
        if (isMedian(ct)) {
          const action = options.centralTendencyActions[ct] ?? 'approximate';
          if (action === 'exclude') return { ok: false, reason: 'median_excluded' };
        }

        const mean = parseNumber(row._rawCells?.[valueCol ?? ''], row[valueCol ?? '']);
        if (!mean.ok) return { ok: false, reason: mean.reason, column: valueCol };
        const n = parseNumber(row._rawCells?.[nCol ?? ''], row[nCol ?? '']);
        if (!n.ok) return { ok: false, reason: n.reason, column: nCol };

        const measureText = options.variabilityMeasureColumn
          ? String(row[options.variabilityMeasureColumn] ?? '')
          : '';
        // With no measure column the form never declares WHAT the spread is, so
        // the column mapped to Variability is taken at face value as a standard
        // deviation. Classifying "undeclared" as UNKNOWN would inherit that
        // kind's `exclude` default and silently empty the entire analysis.
        const kindOfVar = options.variabilityMeasureColumn
          ? classifyVariability(measureText)
          : 'SD';
        const action =
          options.variabilityActions[measureText] ??
          DEFAULT_VARIABILITY_ACTION[kindOfVar];

        const varText = String(row[varCol ?? ''] ?? '').trim();
        if (varText === '') return { ok: false, reason: 'blank', column: varCol };
        const absence = canonicalAbsenceLabel(varText);
        if (absence === 'NR') return { ok: false, reason: 'not_reported', column: varCol };
        if (absence === 'NA') return { ok: false, reason: 'not_applicable', column: varCol };

        const sd = toStandardDeviation(varText, kindOfVar, n.value, action);
        if (!sd.ok) return { ok: false, reason: sd.reason, column: varCol };

        return { ok: true, arm: { mean: mean.value, sd: sd.sd, n: n.value } };
      };

      const t = readArm(p.treatmentRow);
      if (!t.ok) { drop(p, t.reason, t.column); continue; }
      const c = readArm(p.comparatorRow);
      if (!c.ok) { drop(p, c.reason, c.column); continue; }
      treatment = t.arm;
      comparator = c.arm;
    }

    // A reversed scale is negated before pooling — but only once the reviewer has
    // confirmed that reading, since flipping a sign on a guess turns a real
    // effect into its opposite.
    const scale = options.scaleColumn ? cell(p.treatmentRow, options.scaleColumn) : '';
    const flipSign = !!scale && !!options.directions
      && shouldFlipSign(scale, options.directions, options.directionsConfirmed ?? {});

    studies.push({
      key: p.key,
      label: p.label,
      documentId: p.documentId,
      treatment,
      comparator,
      flipSign,
      evidence: {
        outcome: p.outcome,
        timepoint: p.timepoint,
        comparison: p.comparison,
        scale,
        sharedComparator: p.sharedComparator,
        treatmentCells: p.treatmentRow._rawCells,
        comparatorCells: p.comparatorRow._rawCells,
        // The whole treatment row, by reference, so the subgroup panel can group
        // on any column without this file having to know which one in advance.
        row: p.treatmentRow,
      },
    });
  }

  return { studies, excluded };
}

/** Group ledger entries by reason, for the collapsible rows in the ledger. */
export function groupExclusions(
  excluded: ExcludedStudy[],
): Array<{ reason: ExclusionReason; text: string; studies: ExcludedStudy[] }> {
  const map = new Map<ExclusionReason, ExcludedStudy[]>();
  for (const e of excluded) {
    if (!map.has(e.reason)) map.set(e.reason, []);
    map.get(e.reason)!.push(e);
  }
  return [...map.entries()]
    .map(([reason, studies]) => ({ reason, text: EXCLUSION_TEXT[reason], studies }))
    .sort((a, b) => b.studies.length - a.studies.length);
}

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
import { normalQuantile, studentTCritical } from '@/lib/distributions';
import {
  isRatioMeasure, type Arm, type BinaryArm, type ContinuousArm, type ConversionRecord, type EffectMeasure,
  type MetaStudy, type PrecomputedEffect,
} from '@/lib/metaAnalysis';
import type { EffectScale, Mapping, OutcomeKind, TableLayout } from './mapping';
import {
  canonicalValue, shouldFlipSign,
  type Confirmations, type Directions, type Harmonization,
} from './reconcile';

/**
 * Defined beside `MetaStudy` in `lib/metaAnalysis.ts` so a study can carry its
 * records through pooling; re-exported here because this is the file that
 * writes them.
 */
export type { ConversionKind, ConversionRecord } from '@/lib/metaAnalysis';

// ── Reasons ──────────────────────────────────────────────────────────────────

export type ExclusionReason =
  | 'not_reported'
  | 'not_applicable'
  | 'extraction_failed'
  | 'blank'
  | 'unparseable'
  | 'ambiguous_number'
  | 'percent_in_count'
  | 'no_comparator_row'
  | 'ambiguous_grouping'
  | 'harmonization_excluded'
  | 'variability_excluded'
  | 'variability_unusable'
  | 'median_excluded'
  | 'no_precision'
  | 'non_positive_ratio'
  | 'ci_bounds_invalid'
  | 'proportion_impossible'
  | 'correlation_impossible'
  | 'sample_too_small'
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
  ambiguous_number:
    'a required value uses a comma that is not a thousands separator (e.g. "1,5") — it could be a '
    + 'decimal comma or a typo, so it is not guessed at; correct the extraction',
  percent_in_count:
    'a count or sample-size column holds a percentage — a percent is not a number of participants, '
    + 'so it is not coerced; extract the count, or map the column that holds it',
  no_comparator_row: 'no row in this study matches the comparator arm, so nothing to compare against',
  ambiguous_grouping:
    'more than one comparator row shares these values, so which row pairs with which is undecidable '
    + '— map the timepoint column (or whatever else separates them) and this resolves',
  harmonization_excluded: 'its timepoint value was excluded on the Harmonize values card',
  variability_excluded: 'excluded by your choice for this variability measure',
  variability_unusable: 'the variability value could not be converted to a standard deviation',
  median_excluded: 'reports a median, which you chose to exclude rather than approximate',
  no_precision:
    'reports an effect with no usable precision — a standard error, or both confidence-interval '
    + 'bounds, is needed before it can be weighted against the other studies',
  non_positive_ratio:
    'reports a ratio of zero or less, which cannot be put on a log scale — check whether the column '
    + 'actually holds log values, and set the scale accordingly',
  ci_bounds_invalid:
    'its confidence-interval bounds are not a usable interval (equal, reversed, or non-positive on a '
    + 'ratio scale)',
  proportion_impossible:
    'the events and total do not describe a proportion — a count above its denominator, or a negative '
    + 'one, is a data-entry or mapping error rather than an unusual result',
  correlation_impossible:
    'the correlation is not strictly between -1 and 1, so it cannot be transformed for pooling — check '
    + 'whether the column actually holds a correlation',
  sample_too_small:
    'fewer than four observations, which is the minimum a correlation can be pooled from',
  zero_events_both_arms: 'zero events in both arms — no ratio is estimable from it',
  no_variance: 'variance is zero or undefined — no confidence interval is estimable',
  not_estimable: 'the mapped values cannot produce this effect measure',
};

/** Fold a `runMetaAnalysis` refusal into the ledger's vocabulary. */
export function reasonFromNotEstimable(reason: string): ExclusionReason {
  if (reason === 'zero_events_both_arms') return 'zero_events_both_arms';
  if (reason === 'zero_variance') return 'no_variance';
  if (reason === 'proportion_out_of_range') return 'proportion_impossible';
  if (reason === 'correlation_out_of_range') return 'correlation_impossible';
  if (reason === 'sample_too_small') return 'sample_too_small';
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
/**
 * What a mapped slot holds, which decides what a trailing "%" means:
 *  - `count`: a number of events or participants (events, totals, n, denominators).
 *    A percentage there is a different quantity, so it is refused, not coerced —
 *    "25%" in an events column used to become 25 events.
 *  - `value` (default): a measurement or estimate (mean, SD, effect, bound, r),
 *    where a percent sign is a unit and the number is kept as written.
 */
export type NumberSlot = 'count' | 'value';

/** Digits grouped by commas in threes: "1,234", "12,345,678.5" — nothing else. */
const THOUSANDS = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * Read a mapped cell as a number, respecting the four-state absence vocabulary.
 *
 * NR and NA are answers, not zeros — collapsing "not reported" to 0 events would
 * invent data — so each becomes its own exclusion reason rather than a value.
 *
 * A comma is removed only when it is a valid thousands separator. "1,5" could be
 * a decimal comma (1.5) or a dropped digit, and stripping it made 15 — so any
 * other comma is refused as `ambiguous_number` for a reviewer to settle.
 */
export function parseNumber(raw: unknown, display: unknown, slot: NumberSlot = 'value'): Parsed {
  const text = String(display ?? '').trim();
  if (text === '') return { ok: false, reason: 'blank' };
  if (text === FAILED_LABEL) return { ok: false, reason: 'extraction_failed' };

  const absence = canonicalAbsenceLabel(text);
  if (absence === 'NR') return { ok: false, reason: 'not_reported' };
  if (absence === 'NA') return { ok: false, reason: 'not_applicable' };

  let body = text;
  const percent = /\s*%$/.test(body);
  if (percent) {
    if (slot === 'count') return { ok: false, reason: 'percent_in_count' };
    body = body.replace(/\s*%$/, '');
  }
  // Text that is not digits with separators ("see table 3") is simply unreadable.
  if (!/^[+-]?[\d.,\s]*\d[\d.,\s]*(e[+-]?\d+)?$/i.test(body)) return { ok: false, reason: 'unparseable' };
  if (/\s/.test(body)) {
    // "1 234" (space-grouped thousands) is a number; "12 5" is not.
    if (!/^[+-]?\d{1,3}(\s\d{3})+(\.\d+)?$/.test(body)) return { ok: false, reason: 'ambiguous_number' };
    body = body.replace(/\s/g, '');
  }
  if (body.includes(',')) {
    if (!THOUSANDS.test(body)) return { ok: false, reason: 'ambiguous_number' };
    body = body.replace(/,/g, '');
  }
  // Only a plain decimal is a number here: Number() would also accept "0x1A",
  // "1e3", "Infinity" and "" — none of which is how a paper reports a value.
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(body)) return { ok: false, reason: 'unparseable' };
  const n = Number(body);
  if (!Number.isFinite(n)) return { ok: false, reason: 'unparseable' };
  return { ok: true, value: n };
}

/**
 * Pull every number out of a free-text bound like "1.2 to 3.4" or "(0.8, 2.1)".
 *
 * A minus sign counts as a sign only when it does not follow a digit: "12-20" is
 * the range 12 to 20, not 12 and −20 (which made its width 32).
 */
function numbersIn(text: string): number[] {
  const hits = text.match(/(?<![\d.])-?\d+(?:\.\d+)?/g);
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
  CI: 'SD = √N × (upper − lower) / (2 × t₍N−1₎), z = 1.96 when N ≥ 60',
  IQR: 'Wan 2014 with the median: SD ≈ (q3 − q1) / η(N); else SD ≈ IQR / 1.35',
  RANGE: 'Wan 2014 with the median: SD ≈ (max − min) / ξ(N); else SD ≈ range / 4',
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

// ── Conversions (each returns the record that describes it) ─────────────────

export const WAN_2014_REF =
  'Wan X, Wang W, Liu J, Tong T. Estimating the sample mean and standard deviation from the sample '
  + 'size, median, range and/or interquartile range. BMC Med Res Methodol 2014;14:135';
export const HANDBOOK_SD_REF = 'Cochrane Handbook for Systematic Reviews of Interventions v6.5, §6.5.2';
export const DESIGN_EFFECT_REF = 'Cochrane Handbook v6.5, §23.1.4 (design effect 1 + (M − 1)·ICC)';

const NORMALITY =
  'the outcome is approximately normally distributed within the arm — Wan 2014 is exact under '
  + 'normality and biased for skewed data';

/** η(n) = 2·Φ⁻¹((0.75n − 0.125)/(n + 0.25)) — Wan 2014 scenario C3 divisor. → 1.349 as n → ∞. */
export function wanIqrDivisor(n: number): number {
  return 2 * normalQuantile((0.75 * n - 0.125) / (n + 0.25));
}

/** ξ(n) = 2·Φ⁻¹((n − 0.375)/(n + 0.25)) — Wan 2014 scenario C1 divisor. */
export function wanRangeDivisor(n: number): number {
  return 2 * normalQuantile((n - 0.375) / (n + 0.25));
}

type Converted =
  | { ok: true; mean: number; sd: number; record: ConversionRecord }
  | { ok: false; reason: ExclusionReason };

/**
 * Wan 2014 scenario C3: median, quartiles and n → mean and SD.
 * mean ≈ (q1 + m + q3)/3, SD ≈ (q3 − q1)/η(n).
 */
export function wanFromQuartiles(q1: number, median: number, q3: number, n: number): Converted {
  if (![q1, median, q3, n].every(Number.isFinite) || n < 2) return { ok: false, reason: 'variability_unusable' };
  if (!(q3 > q1) || median < q1 || median > q3) return { ok: false, reason: 'variability_unusable' };
  const eta = wanIqrDivisor(n);
  const mean = (q1 + median + q3) / 3;
  const sd = (q3 - q1) / eta;
  return {
    ok: true,
    mean,
    sd,
    record: {
      kind: 'median_iqr_wan',
      formula: `mean ≈ (q1 + median + q3) / 3; SD ≈ (q3 − q1) / η(n), η(${n}) = ${eta.toFixed(4)}`,
      assumptions: [NORMALITY, 'the reported quartiles are the 25th and 75th percentiles of the arm'],
      method_ref: WAN_2014_REF,
      inputs: { q1, median, q3, n },
    },
  };
}

/**
 * Wan 2014 scenario C1: median, minimum, maximum and n → mean and SD.
 * mean ≈ (min + 2m + max)/4 (Hozo 2005, kept by Wan), SD ≈ (max − min)/ξ(n).
 */
export function wanFromRange(min: number, median: number, max: number, n: number): Converted {
  if (![min, median, max, n].every(Number.isFinite) || n < 2) return { ok: false, reason: 'variability_unusable' };
  if (!(max > min) || median < min || median > max) return { ok: false, reason: 'variability_unusable' };
  const xi = wanRangeDivisor(n);
  const mean = (min + 2 * median + max) / 4;
  const sd = (max - min) / xi;
  return {
    ok: true,
    mean,
    sd,
    record: {
      kind: 'median_range_wan',
      formula: `mean ≈ (min + 2·median + max) / 4; SD ≈ (max − min) / ξ(n), ξ(${n}) = ${xi.toFixed(4)}`,
      assumptions: [NORMALITY, 'the extremes are the observed minimum and maximum of the arm'],
      method_ref: WAN_2014_REF,
      inputs: { min, median, max, n },
    },
  };
}

/**
 * SD from a confidence interval for ONE arm's mean (never a contrast's CI).
 *
 * SD = √n · (upper − lower) / (2·c), where c is t on n − 1 df when n < 60 and the
 * normal 1.96 otherwise (Cochrane Handbook §6.5.2.2). Using 1.96 at n = 25 would
 * understate the SD by 5%.
 */
export function ciToSd(
  lo: number,
  hi: number,
  n: number,
  level = 0.95,
): { ok: true; sd: number; record: ConversionRecord } | { ok: false; reason: ExclusionReason } {
  if (![lo, hi, n].every(Number.isFinite) || !(hi > lo) || !(n >= 2)) {
    return { ok: false, reason: 'variability_unusable' };
  }
  const useT = n < 60;
  const c = useT
    ? studentTCritical(n - 1, level)
    : level === 0.95 ? 1.96 : normalQuantile(1 - (1 - level) / 2);
  if (!Number.isFinite(c) || !(c > 0)) return { ok: false, reason: 'variability_unusable' };
  const sd = (Math.sqrt(n) * (hi - lo)) / (2 * c);
  return {
    ok: true,
    sd,
    record: {
      kind: 'ci_to_sd',
      formula: useT
        ? `SD = √n × (upper − lower) / (2 × t(${n - 1})), t = ${c.toFixed(4)}`
        : `SD = √n × (upper − lower) / (2 × ${c === 1.96 ? '1.96' : c.toFixed(4)})`,
      assumptions: [
        `the interval is a ${Math.round(level * 100)}% CI for this arm's own mean, not for a difference or an adjusted estimate`,
        useT ? 'n < 60, so the interval was built on t with n − 1 df' : 'n ≥ 60, so the normal multiplier is used',
      ],
      method_ref: HANDBOOK_SD_REF,
      inputs: { lower: lo, upper: hi, n, level },
    },
  };
}

/**
 * Effective sample size under a cluster design: n / (1 + (m − 1)·ICC), with m the
 * average cluster size. A separate transformation from the multi-arm comparator
 * split, recorded on its own.
 */
export function designEffectN(n: number, m: number, icc: number): number {
  if (![n, m, icc].every(Number.isFinite) || n < 0 || m < 1 || icc < 0 || icc > 1) return NaN;
  return n / (1 + (m - 1) * icc);
}

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
): { ok: true; sd: number; conversion?: ConversionRecord } | { ok: false; reason: ExclusionReason } {
  if (action === 'exclude') return { ok: false, reason: 'variability_excluded' };

  const parts = numbersIn(text);
  if (parts.length === 0) return { ok: false, reason: 'variability_unusable' };

  const spread = parts.length >= 2 ? Math.abs(parts[1] - parts[0]) : Math.abs(parts[0]);
  const single = Math.abs(parts[0]);

  let sd: number;
  let conversion: ConversionRecord | undefined;
  if (action === 'use') {
    sd = single;
  } else if (kind === 'SE' && action === 'convert') {
    sd = single * Math.sqrt(n);
    conversion = {
      kind: 'se_to_sd',
      formula: 'SD = SE × √n',
      assumptions: ["the SE is the standard error of this arm's own mean"],
      method_ref: HANDBOOK_SD_REF,
      inputs: { se: single, n },
    };
  } else if (kind === 'CI' && action === 'convert') {
    if (parts.length < 2) return { ok: false, reason: 'variability_unusable' };
    const c = ciToSd(Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1]), n);
    if (!c.ok) return c;
    sd = c.sd;
    conversion = c.record;
  } else if (kind === 'IQR' && action === 'approximate') {
    sd = spread / 1.35;
    conversion = {
      kind: 'iqr_width',
      formula: 'SD ≈ IQR / 1.35',
      assumptions: [
        NORMALITY,
        'fallback: no median with quartiles was available for Wan 2014, so the large-sample '
          + 'normal ratio IQR ≈ 1.35·SD is used regardless of n',
      ],
      method_ref: HANDBOOK_SD_REF,
      inputs: parts.length >= 2 ? { q1: parts[0], q3: parts[1], iqr: spread } : { iqr: spread },
    };
  } else if (kind === 'RANGE' && action === 'approximate') {
    if (parts.length < 2) return { ok: false, reason: 'variability_unusable' };
    sd = spread / 4;
    conversion = {
      kind: 'range_width',
      formula: 'SD ≈ range / 4',
      assumptions: [
        NORMALITY,
        'fallback: no median was available for Wan 2014; range/4 is a rough rule for moderate n',
      ],
      method_ref: 'Hozo SP, Djulbegovic B, Hozo I. BMC Med Res Methodol 2005;5:13',
      inputs: { min: Math.min(parts[0], parts[1]), max: Math.max(parts[0], parts[1]), range: spread },
    };
  } else if (kind === 'SD') {
    sd = single;
  } else {
    return { ok: false, reason: 'variability_unusable' };
  }

  if (!Number.isFinite(sd) || sd < 0) return { ok: false, reason: 'variability_unusable' };
  return conversion ? { ok: true, sd, conversion } : { ok: true, sd };
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
  /**
   * Only for `kind: 'effect'` — the measure decides whether the reported value
   * has to be logged, so the build step needs it. Arm-based kinds do not: their
   * measure is applied later, by `runMetaAnalysis`.
   */
  measure?: EffectMeasure;
  effectScale?: EffectScale;
  /** Column naming the measurement scale, for effect-direction reconciliation. */
  scaleColumn?: string | null;
  directions?: Directions;
  directionsConfirmed?: Confirmations;
  /**
   * Cluster-randomised studies, by document id: average cluster size `m` and the
   * intra-cluster correlation `icc`. Arm-based studies listed here have their n
   * (and, for binary arms, their events) divided by the design effect
   * 1 + (m − 1)·ICC; the randomised n stays on `nRandomised`.
   */
  designEffects?: Record<string, { m: number; icc: number }>;
}

export interface BuildResult {
  studies: MetaStudy[];
  excluded: ExcludedStudy[];
}

function armFromRow(
  row: LongFormatRow,
  cols: { value?: string; total?: string },
): { ok: true; arm: BinaryArm } | { ok: false; reason: ExclusionReason; column?: string } {
  const events = parseNumber(row._rawCells?.[cols.value ?? ''], row[cols.value ?? ''], 'count');
  if (!events.ok) return { ok: false, reason: events.reason, column: cols.value };
  const total = parseNumber(row._rawCells?.[cols.total ?? ''], row[cols.total ?? ''], 'count');
  if (!total.ok) return { ok: false, reason: total.reason, column: cols.total };
  return { ok: true, arm: { events: events.value, total: total.value } };
}

/** 1.96 each side, i.e. the width of a 95% interval in standard errors. */
const CI_WIDTH_IN_SE = 3.92;

/**
 * Convert one reported effect into (y, se) on the analysis scale.
 *
 * Precedence is CI first, SE second, and that order is deliberate: a published
 * interval needs no assumption about which scale the precision was quoted on,
 * whereas a standard error beside a natural-scale ratio does. When only an SE is
 * available for a ratio measure, it is converted by the delta method
 * (SE_log = SE / estimate) and marked `se-delta` so the plot can say so — an
 * approximation named out loud beats an interval quietly built on the wrong scale.
 */
export function precomputedFromCells(
  est: number,
  ci: { lo: number; hi: number } | null,
  se: number | null,
  isRatio: boolean,
  scale: EffectScale,
): { ok: true; effect: PrecomputedEffect } | { ok: false; reason: ExclusionReason } {
  const logging = isRatio && scale === 'natural';
  if (logging && !(est > 0)) return { ok: false, reason: 'non_positive_ratio' };

  const y = logging ? Math.log(est) : est;
  if (!Number.isFinite(y)) return { ok: false, reason: 'unparseable' };

  const reported = { est, lo: ci?.lo ?? null, hi: ci?.hi ?? null, se, scale };

  if (ci) {
    const { lo, hi } = ci;
    const usable = logging ? lo > 0 && hi > 0 && hi > lo : hi > lo;
    if (usable) {
      const width = logging ? Math.log(hi) - Math.log(lo) : hi - lo;
      const seAnalysis = width / CI_WIDTH_IN_SE;
      if (seAnalysis > 0 && Number.isFinite(seAnalysis)) {
        return { ok: true, effect: { y, se: seAnalysis, reported: { ...reported, derivedFrom: 'ci' } } };
      }
    }
    // A broken CI falls through to the SE when there is one — the row still has
    // a usable weight — and is only refused when there is nothing left to use.
    if (se == null) return { ok: false, reason: 'ci_bounds_invalid' };
  }

  if (se != null) {
    if (!(se > 0)) return { ok: false, reason: 'no_precision' };
    const seAnalysis = logging ? se / est : se;
    if (!(seAnalysis > 0) || !Number.isFinite(seAnalysis)) return { ok: false, reason: 'no_precision' };
    return {
      ok: true,
      effect: {
        y,
        se: seAnalysis,
        reported: { ...reported, derivedFrom: logging ? 'se-delta' : 'se' },
      },
    };
  }

  return { ok: false, reason: 'no_precision' };
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

  const measure = options.measure ?? 'DIFF';
  const effectScale = options.effectScale ?? 'natural';
  const ratioMeasure = isRatioMeasure(measure);

  for (const p of pairings) {
    let treatment: Arm | null = null;
    let comparator: Arm | null = null;
    const conversions: ConversionRecord[] = [];

    if (kind === 'effect') {
      // One row is one whole comparison here, so both "arms" of the pairing are
      // the same row and only the treatment row is read.
      const row = p.treatmentRow;
      const num = (col?: string) =>
        col ? parseNumber(row._rawCells?.[col], row[col]) : ({ ok: false, reason: 'blank' } as const);

      const est = num(mapping.effect_value?.col);
      if (!est.ok) { drop(p, est.reason, mapping.effect_value?.col); continue; }

      const loCol = mapping.effect_ci_lower?.col;
      const hiCol = mapping.effect_ci_upper?.col;
      let ci: { lo: number; hi: number } | null = null;
      if (loCol && hiCol) {
        const lo = num(loCol);
        const hi = num(hiCol);
        if (lo.ok && hi.ok) ci = { lo: lo.value, hi: hi.value };
      }

      const seCol = mapping.effect_se?.col;
      const seRead = seCol ? num(seCol) : null;
      const se = seRead && seRead.ok ? seRead.value : null;

      const built = precomputedFromCells(est.value, ci, se, ratioMeasure, effectScale);
      if (!built.ok) {
        drop(p, built.reason, built.reason === 'no_precision' ? (seCol ?? loCol) : mapping.effect_value?.col);
        continue;
      }

      const scaleCol = options.scaleColumn ? cell(p.treatmentRow, options.scaleColumn) : '';
      const flip = !!scaleCol && !!options.directions
        && shouldFlipSign(scaleCol, options.directions, options.directionsConfirmed ?? {});

      studies.push({
        key: p.key,
        label: p.label,
        documentId: p.documentId,
        precomputed: built.effect,
        flipSign: flip,
        evidence: {
          outcome: p.outcome,
          timepoint: p.timepoint,
          comparison: p.comparison,
          scale: scaleCol,
          sharedComparator: false,
          treatmentCells: row._rawCells,
          comparatorCells: row._rawCells,
          row,
        },
      });
      continue;
    }

    if (kind === 'proportion') {
      // One row is one study's own prevalence: a count and the denominator it
      // came out of, with nothing to compare against.
      const row = p.treatmentRow;
      const eventsCol = mapping.prop_events?.col;
      const totalCol = mapping.prop_total?.col;
      const events = parseNumber(row._rawCells?.[eventsCol ?? ''], row[eventsCol ?? ''], 'count');
      if (!events.ok) { drop(p, events.reason, eventsCol); continue; }
      const total = parseNumber(row._rawCells?.[totalCol ?? ''], row[totalCol ?? ''], 'count');
      if (!total.ok) { drop(p, total.reason, totalCol); continue; }
      if (!(total.value > 0)) { drop(p, 'proportion_impossible', totalCol); continue; }
      if (events.value < 0 || events.value > total.value) {
        drop(p, 'proportion_impossible', eventsCol);
        continue;
      }

      studies.push({
        key: p.key,
        label: p.label,
        documentId: p.documentId,
        proportion: { events: events.value, total: total.value },
        evidence: {
          outcome: p.outcome,
          timepoint: p.timepoint,
          comparison: p.comparison,
          sharedComparator: false,
          treatmentCells: row._rawCells,
          comparatorCells: row._rawCells,
          row,
        },
      });
      continue;
    }

    if (kind === 'correlation') {
      const row = p.treatmentRow;
      const rCol = mapping.corr_r?.col;
      const nCol = mapping.corr_n?.col;
      const r = parseNumber(row._rawCells?.[rCol ?? ''], row[rCol ?? '']);
      if (!r.ok) { drop(p, r.reason, rCol); continue; }
      const n = parseNumber(row._rawCells?.[nCol ?? ''], row[nCol ?? ''], 'count');
      if (!n.ok) { drop(p, n.reason, nCol); continue; }
      if (Math.abs(r.value) >= 1) { drop(p, 'correlation_impossible', rCol); continue; }
      if (n.value < 4) { drop(p, 'sample_too_small', nCol); continue; }

      // A reversed scale flips the sign of a correlation the same way it flips a
      // mean difference, and for the same reason — but only once confirmed.
      const scaleCol = options.scaleColumn ? cell(row, options.scaleColumn) : '';
      const flip = !!scaleCol && !!options.directions
        && shouldFlipSign(scaleCol, options.directions, options.directionsConfirmed ?? {});

      studies.push({
        key: p.key,
        label: p.label,
        documentId: p.documentId,
        correlation: { r: r.value, n: n.value },
        flipSign: flip,
        evidence: {
          outcome: p.outcome,
          timepoint: p.timepoint,
          comparison: p.comparison,
          scale: scaleCol,
          sharedComparator: false,
          treatmentCells: row._rawCells,
          comparatorCells: row._rawCells,
          row,
        },
      });
      continue;
    }

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
        const count = parseNumber(row._rawCells?.[n ?? ''], row[n ?? ''], 'count');
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
      ): { ok: true; arm: ContinuousArm; conversions: ConversionRecord[] }
        | { ok: false; reason: ExclusionReason; column?: string } => {
        const valueCol = mapping.value?.col;
        const varCol = mapping.variability?.col;
        const nCol = mapping.denominator?.col;

        const ct = options.centralTendencyMeasureColumn
          ? String(row[options.centralTendencyMeasureColumn] ?? '')
          : '';
        const median = isMedian(ct);
        if (median) {
          const action = options.centralTendencyActions[ct] ?? 'approximate';
          if (action === 'exclude') return { ok: false, reason: 'median_excluded' };
        }

        const mean = parseNumber(row._rawCells?.[valueCol ?? ''], row[valueCol ?? '']);
        if (!mean.ok) return { ok: false, reason: mean.reason, column: valueCol };
        const n = parseNumber(row._rawCells?.[nCol ?? ''], row[nCol ?? ''], 'count');
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

        /**
         * A median with its quartiles (or its range) goes through Wan 2014, which
         * replaces BOTH the mean and the SD. The quartiles come from the q1/q3
         * slots when mapped, else from a two-number IQR cell ("10 to 19"). A
         * single-number IQR is a width, not quartiles, and falls back below.
         */
        if (median && action !== 'exclude') {
          const optional = (slot?: string): number | null => {
            if (!slot) return null;
            const r = parseNumber(row._rawCells?.[slot], row[slot]);
            return r.ok ? r.value : null;
          };
          const cellPair = numbersIn(varText);
          if (kindOfVar === 'IQR') {
            const q1 = optional(mapping.q1?.col) ?? (cellPair.length >= 2 ? Math.min(cellPair[0], cellPair[1]) : null);
            const q3 = optional(mapping.q3?.col) ?? (cellPair.length >= 2 ? Math.max(cellPair[0], cellPair[1]) : null);
            if (q1 != null && q3 != null) {
              const w = wanFromQuartiles(q1, mean.value, q3, n.value);
              if (w.ok) return { ok: true, arm: { mean: w.mean, sd: w.sd, n: n.value }, conversions: [w.record] };
            }
          } else if (kindOfVar === 'RANGE') {
            const lo = optional(mapping.min?.col) ?? (cellPair.length >= 2 ? Math.min(cellPair[0], cellPair[1]) : null);
            const hi = optional(mapping.max?.col) ?? (cellPair.length >= 2 ? Math.max(cellPair[0], cellPair[1]) : null);
            if (lo != null && hi != null) {
              const w = wanFromRange(lo, mean.value, hi, n.value);
              if (w.ok) return { ok: true, arm: { mean: w.mean, sd: w.sd, n: n.value }, conversions: [w.record] };
            }
          }
        }

        const sd = toStandardDeviation(varText, kindOfVar, n.value, action);
        if (!sd.ok) return { ok: false, reason: sd.reason, column: varCol };

        const conversions: ConversionRecord[] = sd.conversion ? [sd.conversion] : [];
        if (median) {
          conversions.push({
            kind: 'median_as_mean',
            formula: 'mean ≈ median',
            assumptions: [
              'the distribution is symmetric, so the median estimates the mean — no quartiles or '
                + 'range were available to apply Wan 2014',
            ],
            method_ref: HANDBOOK_SD_REF,
            inputs: { median: mean.value, n: n.value },
          });
        }
        return { ok: true, arm: { mean: mean.value, sd: sd.sd, n: n.value }, conversions };
      };

      const t = readArm(p.treatmentRow);
      if (!t.ok) { drop(p, t.reason, t.column); continue; }
      const c = readArm(p.comparatorRow);
      if (!c.ok) { drop(p, c.reason, c.column); continue; }
      treatment = t.arm;
      comparator = c.arm;
      conversions.push(
        ...t.conversions.map(r => ({ ...r, arm: 'treatment' as const })),
        ...c.conversions.map(r => ({ ...r, arm: 'comparator' as const })),
      );
    }

    // Cluster design effect — its own transformation, after every other one.
    let nRandomised: { treatment: number; comparator: number } | undefined;
    const cluster = options.designEffects?.[p.documentId];
    if (cluster && treatment && comparator) {
      const de = 1 + (cluster.m - 1) * cluster.icc;
      if (Number.isFinite(de) && de > 1 && cluster.m >= 1 && cluster.icc >= 0 && cluster.icc <= 1) {
        const nOf = (a: Arm) => ('events' in a ? a.total : a.n);
        nRandomised = { treatment: nOf(treatment), comparator: nOf(comparator) };
        const shrink = (a: Arm): Arm =>
          'events' in a
            ? { events: a.events / de, total: designEffectN(a.total, cluster.m, cluster.icc) }
            : { ...a, n: designEffectN(a.n, cluster.m, cluster.icc) };
        treatment = shrink(treatment);
        comparator = shrink(comparator);
        conversions.push({
          kind: 'design_effect',
          formula: `n_eff = n / (1 + (m − 1)·ICC) = n / ${de.toFixed(4)}`
            + ('events' in treatment ? '; events divided by the same factor' : ''),
          assumptions: [
            'the reported analysis did not already account for clustering',
            'the average cluster size and ICC apply to both arms',
          ],
          method_ref: DESIGN_EFFECT_REF,
          inputs: {
            m: cluster.m, icc: cluster.icc, design_effect: de,
            n_treatment: nRandomised.treatment, n_comparator: nRandomised.comparator,
          },
        });
      }
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
      ...(conversions.length ? { conversions } : {}),
      ...(nRandomised ? { nRandomised } : {}),
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

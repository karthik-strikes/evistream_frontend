/**
 * Analysis-role mapping for the Synthesis screen.
 *
 * The vocabulary here mirrors `backend/app/api/v1/synthesis.py` exactly — same
 * slot names, same required-slot sets. If the two drift, the model's suggestion
 * arrives with roles the UI cannot render, which fails silently rather than
 * loudly, so keep them in step.
 */

import { fieldIsEmpty } from '@/lib/absence';
import { PRECOMPUTED_MEASURES, type EffectMeasure } from '@/lib/metaAnalysis';
import type { ProportionMethod } from '@/lib/singleGroupMeta';
import type { LongFormatRow } from '@/lib/longFormatTransform';

/**
 * `effect` is the third entry path: the table holds an already-computed effect
 * (an adjusted odds ratio, a hazard ratio) with its own CI or standard error,
 * and no arm data at all. It is always `wide` — an effect is already a contrast,
 * so there is no second row to pair it with.
 */
/**
 * `proportion` and `correlation` are the single-group shapes: one row is one
 * study's own prevalence, or its own correlation, with nothing to compare against.
 * Both are always `wide` — there is no second row to pair with.
 */
export type OutcomeKind = 'dichotomous' | 'continuous' | 'effect' | 'proportion' | 'correlation';
export type TableLayout = 'wide' | 'long';

/** What the backend can say about a form. */
export type Verdict = OutcomeKind | 'diagnostic_accuracy' | 'not_poolable';

export type SlotKey =
  // wide + dichotomous
  | 'events_treatment' | 'total_treatment' | 'events_comparator' | 'total_comparator'
  // wide + continuous
  | 'mean_treatment' | 'sd_treatment' | 'n_treatment'
  | 'mean_comparator' | 'sd_comparator' | 'n_comparator'
  // long
  | 'value' | 'variability' | 'denominator'
  // pre-computed effect
  | 'effect_value' | 'effect_se' | 'effect_ci_lower' | 'effect_ci_upper'
  // single group
  | 'prop_events' | 'prop_total'
  | 'corr_r' | 'corr_n'
  // identity
  | 'arm' | 'outcome' | 'timepoint';

/** A slot is `suggested` until the reviewer confirms it. Nothing runs on a suggestion. */
export type SlotStatus = 'suggested' | 'confirmed';

export interface SlotState {
  col: string;
  status: SlotStatus;
  /** Why the model chose this column — shown on hover next to the Suggested pill. */
  why?: string;
}

export type Mapping = Partial<Record<SlotKey, SlotState>>;

export interface ColumnInfo {
  name: string;
  type: string;
  description?: string;
  options?: string[];
}

// ── Required slots ───────────────────────────────────────────────────────────

/**
 * `timepoint` is deliberately never required. Several real forms encode the
 * timepoint inside the outcome option text ("Pain relief at 6 hours") rather
 * than in a column of its own, and requiring one would block those forms.
 */
const REQUIRED: Record<string, SlotKey[]> = {
  'dichotomous|wide': [
    'events_treatment', 'total_treatment', 'events_comparator', 'total_comparator', 'outcome',
  ],
  'continuous|wide': [
    'mean_treatment', 'sd_treatment', 'n_treatment',
    'mean_comparator', 'sd_comparator', 'n_comparator', 'outcome',
  ],
  'dichotomous|long': ['value', 'denominator', 'arm', 'outcome'],
  'continuous|long': ['value', 'variability', 'denominator', 'arm', 'outcome'],
  // Precision is required too, but it can come from either the SE column or
  // both CI bounds — `missingSlots` handles that choice rather than this table.
  'effect|wide': ['effect_value', 'outcome'],
  'proportion|wide': ['prop_events', 'prop_total', 'outcome'],
  'correlation|wide': ['corr_r', 'corr_n', 'outcome'],
};

export function requiredSlots(kind: OutcomeKind, layout: TableLayout): SlotKey[] {
  return REQUIRED[`${kind}|${layout}`] ?? [];
}

/**
 * Which precision columns are mapped for a pre-computed effect.
 *
 * A CI is preferred over an SE because it needs no assumption about the scale
 * the SE was reported on, but either is enough to pool. Both mapped is fine —
 * `buildStudies` uses the CI and keeps the SE as a fallback per row.
 */
export function precisionSources(mapping: Mapping): { se: boolean; ci: boolean } {
  return {
    se: !!mapping.effect_se,
    ci: !!mapping.effect_ci_lower && !!mapping.effect_ci_upper,
  };
}

export function precisionConfirmed(mapping: Mapping): boolean {
  const seOk = mapping.effect_se?.status === 'confirmed';
  const ciOk =
    mapping.effect_ci_lower?.status === 'confirmed' &&
    mapping.effect_ci_upper?.status === 'confirmed';
  return !!seOk || !!ciOk;
}

export function allConfirmed(mapping: Mapping, kind: OutcomeKind, layout: TableLayout): boolean {
  const required = requiredSlots(kind, layout).every(k => mapping[k]?.status === 'confirmed');
  if (kind !== 'effect') return required;
  return required && precisionConfirmed(mapping);
}

export function missingSlots(mapping: Mapping, kind: OutcomeKind, layout: TableLayout): SlotKey[] {
  const missing = requiredSlots(kind, layout).filter(k => !mapping[k]);
  if (kind !== 'effect') return missing;
  const { se, ci } = precisionSources(mapping);
  // Neither precision route is mapped, so name the simpler of the two.
  return se || ci ? missing : [...missing, 'effect_se'];
}

export function suggestedCount(mapping: Mapping): number {
  return Object.values(mapping).filter(s => s?.status === 'suggested').length;
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const SLOT_LABEL: Record<SlotKey, string> = {
  events_treatment: 'Events',
  total_treatment: 'Total (N)',
  events_comparator: 'Events',
  total_comparator: 'Total (N)',
  mean_treatment: 'Mean',
  sd_treatment: 'SD',
  n_treatment: 'N',
  mean_comparator: 'Mean',
  sd_comparator: 'SD',
  n_comparator: 'N',
  value: 'Value',
  variability: 'Variability',
  denominator: 'Denominator (N)',
  arm: 'Arm column',
  outcome: 'Outcome column',
  timepoint: 'Timepoint column',
  effect_value: 'Effect estimate',
  effect_se: 'Standard error',
  effect_ci_lower: 'CI lower bound',
  effect_ci_upper: 'CI upper bound',
  prop_events: 'Events',
  prop_total: 'Total assessed (n)',
  corr_r: 'Correlation (r)',
  corr_n: 'Sample size (n)',
};

/** Paired rows for the wide layout: one label, one slot per arm. */
export function pairedRows(kind: OutcomeKind): Array<{
  label: string;
  treatment: SlotKey;
  comparator: SlotKey;
}> {
  return kind === 'dichotomous'
    ? [
        { label: 'Events', treatment: 'events_treatment', comparator: 'events_comparator' },
        { label: 'Total (N)', treatment: 'total_treatment', comparator: 'total_comparator' },
      ]
    : [
        { label: 'Mean', treatment: 'mean_treatment', comparator: 'mean_comparator' },
        { label: 'SD', treatment: 'sd_treatment', comparator: 'sd_comparator' },
        { label: 'N', treatment: 'n_treatment', comparator: 'n_comparator' },
      ];
}

/** Outcome-value slots for the long layout, where one row is one arm. */
export function longSlots(kind: OutcomeKind): Array<{ key: SlotKey; label: string }> {
  return kind === 'dichotomous'
    ? [
        { key: 'value', label: 'Value — events per row' },
        { key: 'denominator', label: 'Denominator (N)' },
      ]
    : [
        { key: 'value', label: 'Value — central tendency' },
        { key: 'variability', label: 'Variability' },
        { key: 'denominator', label: 'Denominator (N)' },
      ];
}

/**
 * The columns of a pre-computed effect. The estimate is required; precision can
 * arrive as an SE or as both CI bounds, which is why all three are offered
 * rather than one shape being forced.
 */
export function effectSlots(): Array<{ key: SlotKey; label: string; hint: string }> {
  return [
    { key: 'effect_value', label: 'Effect estimate', hint: 'As the paper reports it — e.g. an adjusted OR of 1.42' },
    { key: 'effect_se', label: 'Standard error', hint: 'Optional if both CI bounds are mapped' },
    { key: 'effect_ci_lower', label: 'CI lower bound', hint: 'Preferred over an SE — no scale assumption needed' },
    { key: 'effect_ci_upper', label: 'CI upper bound', hint: 'Preferred over an SE — no scale assumption needed' },
  ];
}

/** The two columns a single-group proportion needs. */
export function proportionSlots(): Array<{ key: SlotKey; label: string; hint: string }> {
  return [
    { key: 'prop_events', label: 'Events', hint: 'How many had the outcome — a count, not a percentage' },
    { key: 'prop_total', label: 'Total assessed (n)', hint: 'How many were assessed for it' },
  ];
}

/** The two columns a correlation needs. */
export function correlationSlots(): Array<{ key: SlotKey; label: string; hint: string }> {
  return [
    { key: 'corr_r', label: 'Correlation (r)', hint: 'Strictly between -1 and 1, as reported' },
    { key: 'corr_n', label: 'Sample size (n)', hint: 'At least 4 - the variance of Fisher z is 1/(n-3)' },
  ];
}

/** Which columns name the outcome and, in a long table, which arm a row is. */
export function identitySlots(layout: TableLayout): Array<{ key: SlotKey; label: string }> {
  const shared: Array<{ key: SlotKey; label: string }> = [
    { key: 'outcome', label: 'Outcome column' },
    { key: 'timepoint', label: 'Timepoint column' },
  ];
  return layout === 'long' ? [{ key: 'arm', label: 'Arm column' }, ...shared] : shared;
}

export function identityHeader(layout: TableLayout): string {
  return layout === 'wide'
    ? 'Analysis identity — which columns name the outcome and timepoint'
    : 'Row identity — how rows pair up';
}

export function effectOptions(kind: OutcomeKind): EffectMeasure[] {
  if (kind === 'dichotomous') return ['RR', 'OR', 'RD'];
  if (kind === 'continuous') return ['MD', 'SMD'];
  // A single group has exactly one thing it can be pooled as. The choice that
  // matters for a proportion is the transform, not the measure.
  if (kind === 'proportion') return ['PROP'];
  if (kind === 'correlation') return ['R'];
  // A pre-computed effect is whatever the paper computed — including measures
  // (HR, a rate ratio) that no arm-based path on this screen can produce.
  return PRECOMPUTED_MEASURES;
}

/**
 * Which scale the reported effect column is printed on.
 *
 * Papers print ratios on the natural scale (OR 1.42), so that is the default and
 * `buildStudies` logs them. A form that stores log values already — some do, for
 * exactly this reason — needs the other setting, and getting it wrong is
 * catastrophic rather than subtle: ln(1.42) = 0.35 pooled as if it were a ratio
 * of 1.42 is a different conclusion.
 */
export type EffectScale = 'natural' | 'log';

// ── Coverage ─────────────────────────────────────────────────────────────────

export interface ColumnCoverage {
  name: string;
  type: string;
  /** Documents with at least one non-empty value in this column. */
  documents: number;
  totalDocuments: number;
  /** Below this the column can't reliably anchor an analysis. */
  low: boolean;
}

const LOW_COVERAGE_BELOW = 0.5;

/**
 * Count documents — not rows — that report a value in each column. A form with
 * forty papers and one paper contributing ten rows should not look like it has
 * ten times the coverage it does.
 *
 * Uses `fieldIsEmpty` from lib/absence so this agrees with the coverage counts
 * elsewhere in the app: NR and a failed extraction both count as absent, NA does
 * not (the study design excluded it, which is an answer).
 */
export function columnCoverage(
  rows: LongFormatRow[],
  columns: string[],
  totalDocuments: number,
): ColumnCoverage[] {
  const seen = new Map<string, Set<string>>();
  for (const col of columns) seen.set(col, new Set());

  for (const row of rows) {
    const docId = row._documentId;
    for (const col of columns) {
      const raw = row._rawCells?.[col];
      const display = row[col];
      const empty = raw !== undefined ? fieldIsEmpty(raw) : fieldIsEmpty(display);
      if (!empty) seen.get(col)!.add(docId);
    }
  }

  return columns.map(name => {
    const documents = seen.get(name)?.size ?? 0;
    return {
      name,
      type: '',
      documents,
      totalDocuments,
      low: totalDocuments > 0 && documents / totalDocuments < LOW_COVERAGE_BELOW,
    };
  });
}

// ── Persistence ──────────────────────────────────────────────────────────────

export interface StoredMapping {
  kind: OutcomeKind;
  layout: TableLayout;
  mapping: Mapping;
  comparatorValue?: string;
  /** Only meaningful when kind is 'effect'. */
  effectScale?: EffectScale;
  /** Minimal important difference as typed, on the natural scale. */
  mid?: string;
  /** Only meaningful when kind is 'proportion'. */
  proportionMethod?: ProportionMethod;
  unitActions?: Record<string, string>;
  centralTendencyActions?: Record<string, string>;
  /** Timepoint synonym merges, and which of them the reviewer has confirmed. */
  harmonizeChoices?: Record<string, string>;
  harmonizeConfirmed?: Record<string, boolean>;
  /** Per-scale effect direction, and its confirmations. */
  directionChoices?: Record<string, any>;
  directionConfirmed?: Record<string, boolean>;
}

const storageKey = (formId: string) => `evistream:synthesis-mapping:${formId}`;

export function loadMapping(formId: string): StoredMapping | null {
  if (typeof window === 'undefined' || !formId) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(formId));
    return raw ? (JSON.parse(raw) as StoredMapping) : null;
  } catch {
    return null;
  }
}

export function saveMapping(formId: string, value: StoredMapping): void {
  if (typeof window === 'undefined' || !formId) return;
  try {
    window.localStorage.setItem(storageKey(formId), JSON.stringify(value));
  } catch {
    /* quota or private mode — the mapping just won't persist */
  }
}

export function clearMapping(formId: string): void {
  if (typeof window === 'undefined' || !formId) return;
  try {
    window.localStorage.removeItem(storageKey(formId));
  } catch {
    /* nothing to do */
  }
}

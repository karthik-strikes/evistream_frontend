/**
 * Analysis-role mapping for the Synthesis screen.
 *
 * The vocabulary here mirrors `backend/app/api/v1/synthesis.py` exactly — same
 * slot names, same required-slot sets. If the two drift, the model's suggestion
 * arrives with roles the UI cannot render, which fails silently rather than
 * loudly, so keep them in step.
 */

import { fieldIsEmpty } from '@/lib/absence';
import type { EffectMeasure } from '@/lib/metaAnalysis';
import type { LongFormatRow } from '@/lib/longFormatTransform';

export type OutcomeKind = 'dichotomous' | 'continuous';
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
};

export function requiredSlots(kind: OutcomeKind, layout: TableLayout): SlotKey[] {
  return REQUIRED[`${kind}|${layout}`] ?? [];
}

export function allConfirmed(mapping: Mapping, kind: OutcomeKind, layout: TableLayout): boolean {
  return requiredSlots(kind, layout).every(k => mapping[k]?.status === 'confirmed');
}

export function missingSlots(mapping: Mapping, kind: OutcomeKind, layout: TableLayout): SlotKey[] {
  return requiredSlots(kind, layout).filter(k => !mapping[k]);
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
  return kind === 'dichotomous' ? ['RR', 'OR', 'RD'] : ['MD', 'SMD'];
}

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

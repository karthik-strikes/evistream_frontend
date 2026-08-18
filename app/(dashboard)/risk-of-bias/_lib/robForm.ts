/**
 * Primitives shared by the risk-of-bias screen.
 *
 * Deliberately small. This file used to contain a form *reader* — it derived
 * domains and their allowed judgments from whatever a project happened to build,
 * which meant the app had no opinion and could never tell you a form was wrong.
 * That reader is gone. `robTools.ts` now holds the published instruments and
 * `robAdapter.ts` binds one onto a form, so what is left here is only the
 * vocabulary-independent parts: the traffic-light scale, the overall rule, and
 * reading cells out of an extraction record.
 */

// ── Severity ─────────────────────────────────────────────────────────────────

export type Severity = 'low' | 'some' | 'high' | 'none';

export const SEVERITY_COLOR: Record<Severity, string> = {
  low: '#16a34a',
  some: '#f59e0b',
  high: '#dc2626',
  none: '#e4e4e7',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  low: 'Low',
  some: 'Some concerns',
  high: 'High',
  none: 'Not assessed',
};

const RANK: Record<Severity, number> = { none: -1, low: 0, some: 1, high: 2 };

/**
 * The study's overall judgment: the worst domain wins.
 *
 * An unassessed domain makes the overall unassessed too. A half-finished
 * assessment must never be able to display as "Low" — that is the reading a
 * reviewer would act on, and it would be a claim nobody made.
 */
export function overallSeverity(severities: Severity[]): Severity {
  if (severities.length === 0) return 'none';
  if (severities.some(s => s === 'none')) return 'none';
  return severities.reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'low' as Severity);
}

// ── Reading extraction records ───────────────────────────────────────────────

export type Row = Record<string, any>;

/** Unwrap the `{value: [...]}` envelope; legacy results store a bare array. */
export function rowsOf(data: Record<string, any> | undefined, tableField: string): Row[] {
  const raw = data?.[tableField];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.value)) return raw.value;
  return [];
}

/**
 * The `{value, source_text, source_location, status}` envelope, however it is
 * stored.
 *
 * Two shapes are in the corpus: nested, where the cell itself is the envelope,
 * and flat, where the source metadata sits in sibling keys named
 * `field.source_text` / `field.source_location`. Callers that want the AI's
 * evidence — not just its answer — must handle both, so this does it once.
 */
export function cellEnvelope(row: Row | undefined, column: string | null): {
  value: any; source_text: string; source_location: any; status: string | null;
} {
  const empty = { value: null, source_text: '', source_location: null, status: null };
  if (!row || !column) return empty;
  const cell = row[column];
  const flatText = row[`${column}.source_text`];
  const flatLoc = row[`${column}.source_location`];

  if (cell && typeof cell === 'object' && !Array.isArray(cell) && 'value' in cell) {
    return {
      value: cell.value,
      source_text: String(cell.source_text ?? flatText ?? '').trim(),
      source_location: cell.source_location ?? flatLoc ?? null,
      status: typeof cell.status === 'string' ? cell.status : null,
    };
  }
  if (cell === null || cell === undefined) return empty;
  return {
    value: cell,
    source_text: String(flatText ?? '').trim(),
    source_location: flatLoc ?? null,
    status: null,
  };
}

/** Read one cell, unwrapping the `{value, source_text, status}` envelope. */
export function cellValue(row: Row | undefined, column: string | null): string {
  if (!row || !column) return '';
  const cell = row[column];
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'object' && !Array.isArray(cell) && 'value' in cell) {
    return cell.value === null || cell.value === undefined ? '' : String(cell.value).trim();
  }
  return String(cell).trim();
}

// ── Status ───────────────────────────────────────────────────────────────────

export type AssessmentStatus = 'none' | 'draft' | 'awaiting' | 'conflict' | 'agreed';

export const STATUS_LABEL: Record<AssessmentStatus, string> = {
  none: 'Not assessed',
  draft: 'AI draft',
  awaiting: 'Awaiting R2',
  conflict: 'Conflict → Consensus',
  agreed: 'Agreed',
};

export const STATUS_COLOR: Record<AssessmentStatus, string> = {
  none: 'text-gray-400 dark:text-zinc-600',
  draft: 'text-amber-700 dark:text-amber-400',
  awaiting: 'text-gray-500 dark:text-zinc-500',
  conflict: 'text-amber-700 dark:text-amber-400',
  agreed: 'text-green-700 dark:text-green-500',
};

export interface StatusInput {
  hasAi: boolean;
  hasR1: boolean;
  hasR2: boolean;
  hasAdjudication: boolean;
  agreementPct: number | null;
}

/**
 * Where a study sits in the dual-review pipeline.
 *
 * Ordered by finality: an adjudicated assessment is agreed whatever came before
 * it, and a disagreement outranks "both reviewers are done" because it still
 * needs a person.
 */
export function assessmentStatus(input: StatusInput): AssessmentStatus {
  if (input.hasAdjudication) return 'agreed';
  if (input.hasR1 && input.hasR2) {
    return input.agreementPct !== null && input.agreementPct < 100 ? 'conflict' : 'agreed';
  }
  if (input.hasR1 || input.hasR2) return 'awaiting';
  if (input.hasAi) return 'draft';
  return 'none';
}

/**
 * Plain-English wording for one activity entry.
 *
 * Lives beside the screen that renders it, the way `lib/activity-helpers.ts`
 * owns the wording for the existing /activity feed. The endpoint deliberately
 * returns structured entries rather than sentences so this vocabulary exists
 * once, and so the field label a reviewer reads comes from the same
 * `formatFieldName` the table headers use.
 */

import type { FormActivityEntry } from '@/types/api';

/**
 * `n_analyzed` → "N Analyzed", for prose.
 *
 * Matches `LongFormatTable`'s own `formatColumnName` on every real column name
 * (table columns are plain field names). The two diverge only on a key with a
 * dot or a literal `value` segment, which this one strips and that one keeps —
 * kept separate rather than shared because changing the header transform would
 * change the column headings and the CSV they feed.
 */
export function formatFieldName(f: string): string {
  return f
    .replace(/_/g, ' ')
    .replace(/\./g, ' ')
    .split(' ')
    .filter(w => w.toLowerCase() !== 'value')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const MAX_VALUE_CHARS = 40;

/**
 * One stored value as a short quoted string, or null when there is nothing a
 * person would want to read.
 *
 * A table field's `old_value`/`new_value` is a SHAPE SUMMARY
 * (`{row_count, changed_columns}`), not a value — the backend stores it that
 * way because a full row list runs to tens of KB. Returning null for those is
 * what makes `describeActivity` fall through to the row/column wording instead
 * of printing `[object Object]`.
 */
export function shortValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS)}…` : s;
}

export interface ActivityCopy {
  /** "changed Dose (mg) from 600 to 400" — the sentence after the person's name. */
  summary: string;
  /** Old → new, when both are short scalars worth showing as a diff. */
  diff: { from: string; to: string } | null;
  /** A draft autosave rather than a submitted answer. */
  isDraft: boolean;
}

export function describeActivity(e: FormActivityEntry): ActivityCopy {
  const isDraft = e.entity_type === 'extraction_result' && e.is_partial;
  const field = e.field_name ? formatFieldName(e.field_name) : null;

  if (e.entity_type === 'consensus_result') {
    return {
      summary: e.action === 'create' ? 'submitted the consensus' : 'updated the consensus',
      diff: null,
      isDraft: false,
    };
  }

  if (e.entity_type === 'extraction_result' && e.action === 'deleted') {
    return { summary: 'removed an extraction', diff: null, isDraft: false };
  }

  // A table field. The audit row records the shape, not the rows, so say what
  // it actually knows: how many columns moved, and whether rows came or went.
  const cols = e.changed_columns ?? [];
  if (cols.length > 0) {
    const rowsBefore = numberAt(e.old_value, 'row_count');
    const rowsAfter = numberAt(e.new_value, 'row_count');
    const rowNote =
      rowsBefore != null && rowsAfter != null && rowsBefore !== rowsAfter
        ? ` and went from ${rowsBefore} to ${rowsAfter} ${rowsAfter === 1 ? 'row' : 'rows'}`
        : rowsAfter != null
          ? ` across ${rowsAfter} ${rowsAfter === 1 ? 'row' : 'rows'}`
          : '';
    const label = field ? ` in ${field}` : '';
    return {
      summary: `filled ${cols.length} ${cols.length === 1 ? 'column' : 'columns'}${label}${rowNote}`,
      diff: null,
      isDraft,
    };
  }

  const from = shortValue(e.old_value);
  const to = shortValue(e.new_value);

  if (from && to) {
    // The stored "from" is the FROZEN ORIGINAL reading, not the value before
    // this particular save (see the note on `cellHistory`). So a reviewer who
    // edits a value and later puts it back produces a row whose from and to are
    // identical — three of the demo project's four live edits look like this.
    // Rendering "Brazil → Brazil" as a change is simply wrong.
    if (from === to) {
      return { summary: `re-saved ${field ?? 'a field'}`, diff: null, isDraft };
    }
    return { summary: `changed ${field ?? 'a field'}`, diff: { from, to }, isDraft };
  }
  if (to) {
    return { summary: `entered ${field ?? 'a value'}`, diff: { from: '', to }, isDraft };
  }
  if (from) {
    return { summary: `cleared ${field ?? 'a field'}`, diff: { from, to: '' }, isDraft };
  }
  return { summary: `saved ${field ?? 'a field'}`, diff: null, isDraft };
}

function numberAt(v: unknown, key: string): number | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const n = (v as Record<string, unknown>)[key];
  return typeof n === 'number' ? n : null;
}

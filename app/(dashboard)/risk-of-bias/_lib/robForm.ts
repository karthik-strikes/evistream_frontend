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

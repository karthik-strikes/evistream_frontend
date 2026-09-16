/**
 * Row indices move, and four side tables are keyed by them.
 *
 * `sources`, `savedEvidence`, the AI-prefill marks and the AI baseline that
 * `needsSource` compares against are all keyed by a row's *position*, because
 * storage is a flat array and a cell is addressed as `field[3].column`. Delete
 * row 1 of 3 and every row below it moves up, so all four maps then describe
 * the wrong row. `pruneSources` only dropped keys past the new end, which is
 * why a reviewer who deleted a row shipped one row's quote as the evidence for
 * another row's data — the one failure this module exists to prevent.
 *
 * So an edit that moves rows says so: the editor knows exactly what it did, and
 * nothing downstream can infer it from the new array alone. An append or an
 * in-place cell edit moves nothing and passes no remap.
 */

import { parseKey, tableCellKey, type SourceMap } from './sourcing';
import type { AiTablePrefill } from './fieldKinds';

/** Where a row went: its new index, or null if it is gone. */
export type RowRemap = (oldIndex: number) => number | null;

/** The rows at these indices were removed; everything after each shifts up. */
export function rowsRemoved(removed: Iterable<number>): RowRemap {
  const gone = new Set(removed);
  return (oldIndex) => {
    if (gone.has(oldIndex)) return null;
    let shift = 0;
    for (const g of gone) if (g < oldIndex) shift += 1;
    return oldIndex - shift;
  };
}

/** Re-key one table field's attached quotes. Other fields pass through. */
export function remapSources(field: string, sources: SourceMap, remap: RowRemap): SourceMap {
  const out: SourceMap = {};
  for (const [key, src] of Object.entries(sources)) {
    const p = parseKey(key);
    if (!('row' in p) || p.field !== field) { out[key] = src; continue; }
    const row = remap(p.row);
    if (row == null) continue;
    out[tableCellKey(field, row, p.column)] = src;
  }
  return out;
}

/** Same, for a set of cell keys (`savedEvidence`). */
export function remapKeySet(field: string, keys: Set<string>, remap: RowRemap): Set<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const p = parseKey(key);
    if (!('row' in p) || p.field !== field) { out.add(key); continue; }
    const row = remap(p.row);
    if (row == null) continue;
    out.add(tableCellKey(field, row, p.column));
  }
  return out;
}

/** Same, for the per-row / per-cell "the AI filled this in" marks. */
export function remapAiPrefill(prefill: AiTablePrefill, remap: RowRemap): AiTablePrefill {
  const rowIndices = new Set<number>();
  const cells: Record<number, Set<string>> = {};
  for (const old of prefill.rowIndices) {
    const row = remap(old);
    if (row == null) continue;
    rowIndices.add(row);
  }
  for (const [old, cols] of Object.entries(prefill.cells)) {
    const row = remap(Number(old));
    if (row == null) continue;
    cells[row] = cols;
  }
  return { rowIndices, cells };
}

/**
 * Same, for the AI's rows kept as the "did the reviewer change this?" baseline.
 *
 * Aligning the baseline to the screen is the point: after a delete, the row that
 * was at index 2 is at index 1 and is still the same data, so its baseline has
 * to move with it. Left unshifted, `needsSource` compared each cell against a
 * different AI row and asked for quotes on values nobody had touched.
 */
export function remapRows<T>(rows: T[], remap: RowRemap): T[] {
  const out: T[] = [];
  rows.forEach((row, old) => {
    const next = remap(old);
    if (next == null) return;
    out[next] = row;
  });
  return out;
}

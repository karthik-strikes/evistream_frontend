/**
 * Which AI / R1 / R2 table rows describe the same study record.
 *
 * The consensus screen used to pair rows by array index, so a reviewer who
 * entered Placebo first had "Placebo" compared against the AI's "Naproxen" and
 * every cell lit up as a disagreement. Correspondence is settled here, before
 * any cell is compared:
 *
 *   - Rows are joined automatically on their composite key when that key
 *     occurs AT MOST ONCE in each source. It does not have to occur in all
 *     three — AI + R1 with R2 silent is one record with R2 "not found".
 *   - A key that occurs twice in any one source makes the whole bucket
 *     ambiguous: every row in it stands alone until the reviewer pairs it. We
 *     do not know which of the AI's two "Ibuprofen 400 mg" rows R1 meant, so
 *     we do not guess — not even for the sources that are unique.
 *   - An empty / NR / NA key cell is ONE token, "blank", and still keys. This
 *     reverses a first version that voided any key with a gap, and live data
 *     is why: on a 7-column outcomes key, a rescue-analgesia row has no adverse
 *     effect and an adverse-event row has no timepoint, reviewers write NR and
 *     NA interchangeably for "does not apply" (one Kiersch 1994 table uses both
 *     in the same column), and the manual form stores a typed NA with status
 *     `not_reported` (`absence.stamp`'s NA backstop). The strict rule matched
 *     nothing at all. Safety comes from uniqueness instead — two rows collide on
 *     a blank only if each source has exactly one row with the rest of that key
 *     — and the joined versions are shown side by side before anyone picks.
 *   - A FAILED key cell (missing/error) is not a claim, and a row whose key is
 *     entirely blank has nothing to match on; both stand alone.
 *   - Rows are never merged for looking similar. "Naproxen" and "Naproxen
 *     sodium" are two records until a reviewer pairs them.
 *   - A table with no key falls back to position, and says so:
 *     `positional-unverified` is its own alignment, never `key`.
 *
 * Deliberately NOT `rowIdentity` from manual-extraction/_lib/sourcing.ts,
 * which is for *locating* a row and reads status-less text. Key parts here are
 * `compareKey` — the canonical token the agree/conflict counter uses — so
 * "rows were matched" and "cells agree" cannot contradict each other.
 *
 * Internal vocabulary only. The screen never says "key": see ALIGNMENT_CHIP in
 * UnifiedFieldCard.tsx for what a reviewer reads.
 *
 * Pure functions, no React: checked by lib/__checks__/alignRows.check.mts.
 */

import { canonicalAbsenceLabel, cellStatus, compareKey, isFailure, NOT_APPLICABLE, NOT_REPORTED } from '@/lib/absence';

export type SourceKey = 'ai' | 'r1' | 'r2';
export const SOURCE_ORDER: SourceKey[] = ['ai', 'r1', 'r2'];

export interface RowRef {
  source: SourceKey;
  /** Index in that source's table as loaded. Shown to the reviewer as metadata
   *  ("R2 row #2"), and a pointer into this snapshot only — never identity. */
  rowIndex: number;
  row: any;
}

export type Alignment =
  | 'key'                     // complete, unique composite key in every source that has it
  | 'manual'                  // the reviewer paired these rows
  | 'positional-unverified'   // no key configured; same index, correspondence NOT checked
  | 'ambiguous'               // this key occurs more than once in some source
  | 'incomplete-key';         // a key cell failed, or every key cell is blank

export interface AlignedRecord {
  /** Stable within one snapshot and across manual pairing. */
  id: string;
  alignment: Alignment;
  /** Canonical key, when the rows had one. */
  identity: string | null;
  /** The key had blank (empty / NR / NA) cells. Shown in a tooltip only. */
  blankKeyCells?: string[];
  members: Partial<Record<SourceKey, RowRef>>;
}

export interface ColumnSpec {
  field_name: string;
  options?: string[] | null;
}

const SEP = '␟';

export const refKey = (r: Pick<RowRef, 'source' | 'rowIndex'>) => `${r.source}:${r.rowIndex}`;

const BLANK = '\u2205';

/** A key cell that carries no identity: empty, NR or NA — one token for all. */
export function isBlankKeyCell(cell: any, options?: string[] | null): boolean {
  const st = cellStatus(cell, options);
  if (st === NOT_REPORTED || st === NOT_APPLICABLE) return true;
  const raw = cell && typeof cell === 'object' && !Array.isArray(cell) && 'value' in cell ? cell.value : cell;
  if (canonicalAbsenceLabel(raw) !== null) return true;
  return compareKey(cell, options) === '';
}

function isFailedKeyCell(cell: any): boolean {
  return !!cell && typeof cell === 'object' && !Array.isArray(cell) && isFailure((cell as any).status);
}

/**
 * Canonical composite key, or null when the row cannot be keyed: a key cell
 * failed, or every key cell is blank.
 */
export function consensusRowKey(row: any, keyCols: ColumnSpec[]): { identity: string; blanks: string[] } | null {
  if (!keyCols.length || !row || typeof row !== 'object') return null;
  const parts: string[] = [];
  const blanks: string[] = [];
  for (const col of keyCols) {
    const cell = row[col.field_name];
    if (isFailedKeyCell(cell)) return null;
    if (isBlankKeyCell(cell, col.options)) {
      parts.push(BLANK);
      blanks.push(col.field_name);
    } else {
      parts.push(compareKey(cell, col.options) as string);
    }
  }
  if (blanks.length === keyCols.length) return null;
  return { identity: parts.join(SEP), blanks };
}

/**
 * Group the sources' rows into records. `rowsBySource` holds only sources that
 * gave rows — a source that reported the whole table absent is left out by the
 * caller and shown as such, so it never reads as "missed every row".
 *
 * Order: by first appearance, AI's order first, then rows only R1 has, then R2.
 */
export function alignTableRows(
  rowsBySource: Partial<Record<SourceKey, any[]>>,
  keyCols: ColumnSpec[],
): AlignedRecord[] {
  const present = SOURCE_ORDER.filter(s => Array.isArray(rowsBySource[s]));

  if (!keyCols.length) {
    const n = Math.max(0, ...present.map(s => rowsBySource[s]!.length));
    const out: AlignedRecord[] = [];
    for (let i = 0; i < n; i++) {
      const members: AlignedRecord['members'] = {};
      for (const s of present) {
        const rows = rowsBySource[s]!;
        if (i < rows.length) members[s] = { source: s, rowIndex: i, row: rows[i] };
      }
      out.push({ id: `p:${i}`, alignment: 'positional-unverified', identity: null, members });
    }
    return out;
  }

  // Identity buckets, not a greedy walk: whether a key is safe to join depends
  // on every row carrying it, which is only known once all rows are bucketed.
  type Slot = { kind: 'bucket'; identity: string } | { kind: 'alone'; ref: RowRef };
  const order: Slot[] = [];
  const buckets = new Map<string, Record<SourceKey, RowRef[]>>();
  const blanksOf = new Map<string, string[]>();

  for (const s of present) {
    rowsBySource[s]!.forEach((row, rowIndex) => {
      const ref: RowRef = { source: s, rowIndex, row };
      const keyed = consensusRowKey(row, keyCols);
      if (keyed === null) {
        order.push({ kind: 'alone', ref });
        return;
      }
      const identity = keyed.identity;
      if (keyed.blanks.length) blanksOf.set(identity, keyed.blanks);
      let b = buckets.get(identity);
      if (!b) {
        b = { ai: [], r1: [], r2: [] };
        buckets.set(identity, b);
        order.push({ kind: 'bucket', identity });
      }
      b[s].push(ref);
    });
  }

  const out: AlignedRecord[] = [];
  for (const slot of order) {
    if (slot.kind === 'alone') {
      out.push({
        id: `u:${refKey(slot.ref)}`,
        alignment: 'incomplete-key',
        identity: null,
        members: { [slot.ref.source]: slot.ref },
      });
      continue;
    }
    const b = buckets.get(slot.identity)!;
    if (SOURCE_ORDER.some(s => b[s].length > 1)) {
      for (const s of SOURCE_ORDER) {
        for (const ref of b[s]) {
          out.push({ id: `a:${refKey(ref)}`, alignment: 'ambiguous', identity: slot.identity, members: { [s]: ref } });
        }
      }
      continue;
    }
    const members: AlignedRecord['members'] = {};
    for (const s of SOURCE_ORDER) if (b[s].length === 1) members[s] = b[s][0];
    out.push({
      id: `k:${slot.identity}`, alignment: 'key', identity: slot.identity, members,
      ...(blanksOf.has(slot.identity) ? { blankKeyCells: blanksOf.get(slot.identity) } : {}),
    });
  }
  return out;
}

/**
 * Apply the reviewer's pairings. Each group is a list of `refKey`s. A row
 * belongs to at most one record: grouped rows are MOVED out of the record they
 * were in (which keeps its id and its remaining members, and disappears when it
 * has none). Invalid groups — two rows from one source, a row already claimed
 * by an earlier group, or a ref not in this snapshot — are dropped whole.
 */
export function applyManualPairs(records: AlignedRecord[], groups: string[][]): AlignedRecord[] {
  const where = new Map<string, RowRef>();
  for (const r of records) for (const ref of Object.values(r.members)) if (ref) where.set(refKey(ref), ref);

  const claimed = new Set<string>();
  const valid: RowRef[][] = [];
  for (const g of groups) {
    const refs = g.map(k => where.get(k));
    if (refs.length < 2 || refs.some(r => !r)) continue;
    const srcs = new Set(refs.map(r => r!.source));
    if (srcs.size !== refs.length) continue;
    if (g.some(k => claimed.has(k))) continue;
    g.forEach(k => claimed.add(k));
    valid.push(refs as RowRef[]);
  }
  if (!valid.length) return records;

  const out: AlignedRecord[] = [];
  const placed = new Set<number>();
  for (const r of records) {
    const kept: AlignedRecord['members'] = {};
    for (const s of SOURCE_ORDER) {
      const ref = r.members[s];
      if (ref && !claimed.has(refKey(ref))) kept[s] = ref;
    }
    // A manual record takes the position of the earliest record it drew from.
    valid.forEach((refs, gi) => {
      if (placed.has(gi)) return;
      if (refs.some(ref => r.members[ref.source] && refKey(r.members[ref.source]!) === refKey(ref))) {
        placed.add(gi);
        const members: AlignedRecord['members'] = {};
        for (const ref of refs) members[ref.source] = ref;
        out.push({ id: manualId(refs), alignment: 'manual', identity: null, members });
      }
    });
    if (Object.keys(kept).length) out.push({ ...r, members: kept });
  }
  return out;
}

export function manualId(refs: Array<Pick<RowRef, 'source' | 'rowIndex'>>): string {
  return `m:${refs.map(refKey).sort().join(',')}`;
}

/** Record ids a record may be paired with: no source in common. */
export function canPair(a: AlignedRecord, b: AlignedRecord): boolean {
  if (a.id === b.id) return false;
  return SOURCE_ORDER.every(s => !(a.members[s] && b.members[s]));
}

/**
 * Columns whose values differ between the record's members, by the same
 * `compareKey` the conflict counter uses. A failed cell (null key) differs
 * from everything, including another failed cell — a failure is not agreement.
 */
export function differingColumns(rec: AlignedRecord, cols: ColumnSpec[]): Set<string> {
  const refs = SOURCE_ORDER.map(s => rec.members[s]).filter((r): r is RowRef => !!r);
  const out = new Set<string>();
  if (refs.length < 2) return out;
  for (const col of cols) {
    const keys = refs.map(r => compareKey(r.row?.[col.field_name], col.options));
    if (keys.some(k => k === null) || new Set(keys).size > 1) out.add(col.field_name);
  }
  return out;
}

/** What the reviewer decided for one record. */
export type RecordChoice = SourceKey | 'exclude';

/**
 * The choice that needs no reviewer: every source that gave rows found this
 * record, and they agree on every column. Anything else must be decided.
 *
 * This holds for a positional record too: position proves nothing about
 * sameness, but rows equal in every column are the same content either way.
 */
export function automaticChoice(
  rec: AlignedRecord,
  cols: ColumnSpec[],
  presentSources: SourceKey[],
): RecordChoice | null {
  if (!presentSources.every(s => rec.members[s])) return null;
  if (presentSources.length < 2) return null;
  if (differingColumns(rec, cols).size > 0) return null;
  return presentSources[0];
}

/** Rebuild the table from per-record choices. Rows are the sources' own row
 *  objects, envelopes and evidence included — nothing is re-synthesised. */
export function buildConsensusRows(
  records: AlignedRecord[],
  choice: (rec: AlignedRecord) => RecordChoice | null,
): any[] | null {
  const rows: any[] = [];
  for (const rec of records) {
    const c = choice(rec);
    if (c === null) return null;
    if (c === 'exclude') continue;
    const ref = rec.members[c];
    if (!ref) return null;
    rows.push(ref.row);
  }
  return rows;
}

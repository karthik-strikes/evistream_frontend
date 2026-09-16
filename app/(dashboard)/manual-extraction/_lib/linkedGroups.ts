/**
 * Linked groups — one table field's flat rows, read as what actually repeats.
 *
 * The problem this solves is retyping. A "Continuous Outcomes" table stores one
 * row per arm × scale × timepoint, so a reviewer entering four arms, two scales
 * and three timepoints fills 24 rows — and 16 of each row's 20 columns are the
 * same words they already typed on the row above. Population type is a property
 * of the *study*. Scale range is a property of the *scale*. Only N, central
 * tendency and variability actually vary per row.
 *
 * So each column declares what it is a property of:
 *
 *     scope = 'study' | 'group:<any name>' | 'row'          (default: 'row')
 *
 * The group names are the form's own: an outcomes form declares `arm` and
 * `scale`, a harms form declares `arm` and `adverse effect`, a form with
 * nothing repeating declares none. `field.groups` is that list.
 *
 * **Storage does not change.** Everything here is a projection over the same
 * `Array<Record<string, string>>` the flat editor has always written, and every
 * write returns a new flat array with the shared value stamped onto each row it
 * describes. That is deliberate and load-bearing:
 *
 *   - an untagged field is a table with zero study/group columns, which reads
 *     back as exactly today's behaviour rather than as a special case;
 *   - `extraction_results`, the exporter, `compare_reviewers` and the AI
 *     prefill all keep seeing the rows they already understand, so none of them
 *     needs to learn about groups;
 *   - a form can be tagged and untagged with no migration of saved work.
 *
 * The cost is that a shared value is physically repeated on every row it
 * belongs to. That is the right trade: a denormalised export is what the rest
 * of the system already reads, and repeating a string is cheaper than teaching
 * six consumers to do a join.
 */

import type { FormField } from '@/types/api';
import { SCOPE_ROW, SCOPE_STUDY, groupScope, groupsOf, isLinkedTable, scopeOf } from '@/lib/fieldScopes';
import { keyColumnsOfField, tableCellKey, type SourceMap } from './sourcing';

// The vocabulary itself is shared with the form builder, which writes these
// tags — see lib/fieldScopes. Re-exported here so a reader of the projection
// has the whole model in one import.
export {
  GROUP_PREFIX, SCOPE_ROW, SCOPE_STUDY, GROUP_PALETTE, STUDY_COLOR, ROW_COLOR,
  groupScope, groupsOf, scopeOf, isLinkedTable,
} from '@/lib/fieldScopes';

export type TableRow = Record<string, string>;

const norm = (v: any): string => (v == null ? '' : String(v)).trim();

export interface GroupPlan {
  name: string;
  /** Every column scoped to this group, in the form's own column order. */
  cols: FormField[];
  /** The subset that tells one instance of this group from another. */
  keyCols: string[];
}

export interface TablePlan {
  study: FormField[];
  groups: GroupPlan[];
  row: FormField[];
  keyColumns: string[];
}

/** Split a table field's columns by what they are a property of. */
export function planTable(field: FormField): TablePlan {
  const cols = field.subform_fields ?? [];
  const keyColumns = keyColumnsOfField(field);
  const study = cols.filter(c => scopeOf(c) === SCOPE_STUDY);
  const row = cols.filter(c => scopeOf(c) === SCOPE_ROW);
  const groups = groupsOf(field)
    .map(name => {
      const mine = cols.filter(c => scopeOf(c) === groupScope(name));
      // An instance is identified by this group's columns that are also in the
      // field's composite key. The fallback to the leading column is not a
      // guess for its own sake — a group still has to be told apart somehow,
      // and the column the author put first is the one that names it.
      const keyed = mine.filter(c => keyColumns.includes(c.field_name)).map(c => c.field_name);
      return { name, cols: mine, keyCols: keyed.length ? keyed : mine.slice(0, 1).map(c => c.field_name) };
    })
    .filter(g => g.cols.length > 0);
  return { study, groups, row, keyColumns };
}

export interface GroupInstance {
  /** Identity under the group's key columns. `''` when every key cell is blank
   *  — a half-typed instance, which still has to render. */
  id: string;
  keyValues: Record<string, string>;
  /** Flat-row indices belonging to this instance, in stored order. */
  rowIndices: number[];
}

const instanceId = (row: TableRow, keyCols: string[]): string =>
  keyCols.map(c => norm(row?.[c]).toLowerCase()).join('§');

/** The distinct instances of one group, in the order the rows first mention
 *  them. Ordering by first appearance rather than alphabetically keeps a card
 *  from jumping while someone is typing its name. */
export function deriveInstances(rows: TableRow[], keyCols: string[]): GroupInstance[] {
  const out: GroupInstance[] = [];
  const byId = new Map<string, GroupInstance>();
  rows.forEach((row, i) => {
    const id = instanceId(row, keyCols);
    let inst = byId.get(id);
    if (!inst) {
      inst = {
        id,
        keyValues: Object.fromEntries(keyCols.map(c => [c, norm(row?.[c])])),
        rowIndices: [],
      };
      byId.set(id, inst);
      out.push(inst);
    }
    inst.rowIndices.push(i);
  });
  return out;
}

export function instanceLabel(inst: GroupInstance, keyCols: string[]): string {
  return keyCols.map(c => inst.keyValues[c]).filter(Boolean).join(' · ');
}

/** A shared column's value: the first non-empty one across the rows it spans.
 *  Non-empty rather than first, because a row added and not yet filled would
 *  otherwise blank a value the reviewer already entered. */
export function sharedValue(rows: TableRow[], rowIndices: number[], col: string): string {
  for (const i of rowIndices) {
    const v = norm(rows[i]?.[col]);
    if (v) return v;
  }
  return '';
}

/**
 * The distinct non-empty values a shared column actually holds across the rows
 * it spans.
 *
 * `sharedValue` shows the first one and every edit stamps over the rest, so a
 * column tagged shared *after* rows already existed — or prefilled by an AI run
 * that genuinely reported two different values — silently hid the
 * disagreement and then destroyed it on the next keystroke. More than one entry
 * here is what the editor warns about.
 */
export function sharedValues(rows: TableRow[], rowIndices: number[], col: string): string[] {
  const seen = new Set<string>();
  for (const i of rowIndices) {
    const v = norm(rows[i]?.[col]);
    if (v) seen.add(v);
  }
  return [...seen];
}

/**
 * The row a shared column's single input speaks for: the first one in its span
 * that actually holds a value, else the first of the span.
 *
 * The editor and the "needs a source" count have to agree on this, and they did
 * not. The editor rendered a study cell at row 0 unconditionally while
 * `sharedValue` reads the first NON-EMPTY row, so a value living only on row 3
 * appeared in an input keyed to row 0 — where the source count looked at row
 * 0's empty cell and never asked for a citation, and the jump built the DOM id
 * of a row the grouped view never renders.
 */
export function sharedAnchor(rows: TableRow[], rowIndices: number[], col: string): number {
  for (const i of rowIndices) if (norm(rows[i]?.[col])) return i;
  return rowIndices[0] ?? 0;
}

const allIndices = (rows: TableRow[]): number[] => rows.map((_, i) => i);

/** Write one column to one value across the given rows. */
export function stamp(rows: TableRow[], rowIndices: number[], col: string, value: string): TableRow[] {
  const touch = new Set(rowIndices);
  return rows.map((r, i) => (touch.has(i) ? { ...r, [col]: value } : r));
}

/** Write a study-scoped column, which by definition spans every row. */
export function stampStudy(rows: TableRow[], col: string, value: string): TableRow[] {
  return stamp(rows, allIndices(rows), col, value);
}

/**
 * A new flat row carrying everything the reviewer would otherwise retype: every
 * study value, and — when seeded from an existing row — that row's group
 * values. Only the per-row columns come up blank.
 */
export function blankRow(field: FormField, rows: TableRow[], seedFrom: number | null): TableRow {
  const plan = planTable(field);
  const out: TableRow = {};
  for (const c of field.subform_fields ?? []) out[c.field_name] = '';
  for (const c of plan.study) {
    out[c.field_name] = sharedValue(rows, allIndices(rows), c.field_name);
  }
  const seed = seedFrom != null ? rows[seedFrom] : null;
  if (seed) {
    for (const g of plan.groups) {
      for (const c of g.cols) out[c.field_name] = norm(seed[c.field_name]);
    }
  }
  return out;
}

/** Start a new instance of one group: a row that keeps every other group's
 *  values from the last row, and blanks only this group's columns. */
export function addInstance(field: FormField, rows: TableRow[], group: GroupPlan): TableRow[] {
  const row = blankRow(field, rows, rows.length ? rows.length - 1 : null);
  for (const c of group.cols) row[c.field_name] = '';
  return [...rows, row];
}

/** Copy one instance's group columns onto a row — what picking an instance from
 *  a row's selector means. */
export function assignInstance(
  rows: TableRow[], rowIdx: number, group: GroupPlan, inst: GroupInstance,
): TableRow[] {
  const src = rows[inst.rowIndices[0]];
  if (!src) return rows;
  return rows.map((r, i) => {
    if (i !== rowIdx) return r;
    const next = { ...r };
    for (const c of group.cols) next[c.field_name] = norm(src[c.field_name]);
    return next;
  });
}

export function removeRows(rows: TableRow[], rowIndices: number[]): TableRow[] {
  const drop = new Set(rowIndices);
  return rows.filter((_, i) => !drop.has(i));
}

/** How many of a set of columns are answered across the rows they span. */
export function filledCount(rows: TableRow[], rowIndices: number[], cols: FormField[]): number {
  return cols.filter(c => sharedValue(rows, rowIndices, c.field_name) !== '').length;
}

// ── what the reviewer can reach, and what a citation covers ─────────────────

/**
 * Which cells of a table the reviewer can actually reach.
 *
 * On a grouped table a study or group value is entered once and stamped onto
 * every row it describes, so the editor renders exactly one input for it — the
 * study section's, or the group card's. Counting it once per row asked for the
 * same quote twenty times, so the "N need a source" counter could never reach
 * zero, and its jump built a DOM id (`field-<col>-r7`) that the grouped view
 * never renders, leaving the button dead. An untagged table reaches everything,
 * which is exactly today's behaviour.
 */
export function reachableCellFilter(
  fields: FormField[],
  data: Record<string, any>,
): (field: string, rowIdx: number, column: string) => boolean {
  const byField = new Map<string, Map<string, Set<number>>>();
  for (const f of fields) {
    if (!isLinkedTable(f)) continue;
    const rows: TableRow[] = Array.isArray(data?.[f.field_name]) ? data[f.field_name] : [];
    const plan = planTable(f);
    const anchors = new Map<string, Set<number>>();
    const every = rows.map((_, i) => i);
    for (const c of plan.study) {
      anchors.set(c.field_name, new Set([sharedAnchor(rows, every, c.field_name)]));
    }
    for (const g of plan.groups) {
      const instances = deriveInstances(rows, g.keyCols);
      for (const c of g.cols) {
        anchors.set(
          c.field_name,
          new Set(instances.map(i => sharedAnchor(rows, i.rowIndices, c.field_name))),
        );
      }
    }
    if (anchors.size) byField.set(f.field_name, anchors);
  }
  return (field, rowIdx, column) => {
    const allowed = byField.get(field)?.get(column);
    return allowed ? allowed.has(rowIdx) : true;
  };
}

/**
 * Copy a shared column's citation onto every row that carries that value.
 *
 * A grouped table stores the shared value on all the rows it describes, but the
 * reviewer cites it once, at the anchor cell — so the saved row carried the
 * evidence on row 1 and a bare string on rows 2..n, and /consensus and the
 * export then showed a citation for one row of a group and none for the rest of
 * an identical value. The passage is equally true of each row, so it is spread
 * at save time rather than asked for n times. An existing citation is never
 * overwritten.
 */
export function spreadSharedSources(
  fields: FormField[],
  data: Record<string, any>,
  sources: SourceMap,
): SourceMap {
  const out: SourceMap = { ...sources };
  for (const f of fields) {
    if (!isLinkedTable(f)) continue;
    const rows: TableRow[] = Array.isArray(data?.[f.field_name]) ? data[f.field_name] : [];
    if (!rows.length) continue;
    const plan = planTable(f);

    const spread = (col: string, indices: number[]) => {
      const from = indices.find(i => out[tableCellKey(f.field_name, i, col)]);
      if (from === undefined) return;
      const src = out[tableCellKey(f.field_name, from, col)];
      // Only onto rows holding the *same* value. The editor shows one input for
      // a shared column, but the rows underneath can genuinely disagree — a
      // column tagged shared after rows existed, or an AI run that reported two
      // different values — and the reviewer's passage supports the value they
      // were looking at, not the other one. Those rows are flagged in the
      // editor instead (see `sharedValues`).
      const anchor = norm(rows[from]?.[col]);
      for (const i of indices) {
        if (norm(rows[i]?.[col]) !== anchor) continue;
        const key = tableCellKey(f.field_name, i, col);
        if (!out[key]) out[key] = src;
      }
    };

    const everyRow = rows.map((_, i) => i);
    for (const c of plan.study) spread(c.field_name, everyRow);
    for (const g of plan.groups) {
      for (const inst of deriveInstances(rows, g.keyCols)) {
        for (const c of g.cols) spread(c.field_name, inst.rowIndices);
      }
    }
  }
  return out;
}

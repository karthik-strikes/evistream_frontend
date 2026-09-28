/**
 * Conditional questions — "ask this only if <parent> is <value(s)>".
 *
 * MIRROR of backend/utils/field_conditions.py. Change one, change the other in
 * the same commit: both suites run backend/tests/fixtures/field_conditions_cases.json
 * (here via lib/__checks__/fieldConditions.check.mts), messages included.
 *
 * The browser evaluates for responsiveness only; the server re-evaluates on
 * every save and is the authority. Rule ids / revisions are server-managed and
 * deliberately not computed here.
 */

import type { FieldCondition, FormField } from '@/types/api';
import {
  classify, isFailure, normalizeStatus, NOT_APPLICABLE, NOT_REPORTED, valueKey,
} from './absence';

export const OPS = ['equals', 'in'] as const;

export const APPLIES = 'applies';
export const SKIPPED_CONDITION_FALSE = 'skipped_condition_false';
export const SKIPPED_PARENT_SKIPPED = 'skipped_parent_skipped';
export const PARENT_NR = 'parent_nr';
export const WAITING = 'waiting';

export type ConditionState =
  | typeof APPLIES | typeof SKIPPED_CONDITION_FALSE | typeof SKIPPED_PARENT_SKIPPED
  | typeof PARENT_NR | typeof WAITING;

export const SKIPPED_STATES = new Set<ConditionState>([SKIPPED_CONDITION_FALSE, SKIPPED_PARENT_SKIPPED, PARENT_NR]);

const ELIGIBLE_PARENT_TYPES = ['select', 'boolean'];
const BOOLEAN_VALUES = ['Yes', 'No'];
const FAR = 1e9;

type F = FormField & { condition?: FieldCondition | null; key_columns?: string[]; anchor_columns?: string[] };

// ── reading ──────────────────────────────────────────────────────────────────

export function conditionOf(f: any): FieldCondition | null {
  const c = f && typeof f === 'object' ? f.condition : null;
  return c && typeof c === 'object' && typeof c.field === 'string' && c.field.trim() ? c : null;
}

const fromOf = (c: FieldCondition): 'form' | 'row' => (c.from === 'row' ? 'row' : 'form');

function optionsOf(f: F): string[] {
  if ((f.field_type || '') === 'boolean') return [...BOOLEAN_VALUES];
  return (f.options || []).filter(o => typeof o === 'string' && o.trim());
}

function keyColumnsOf(f: F): string[] {
  for (const k of ['key_columns', 'anchor_columns'] as const) {
    const raw = (f as any)[k];
    if (Array.isArray(raw)) return raw.map(c => String(c ?? '').trim()).filter(Boolean);
  }
  return [];
}

// ── matching ─────────────────────────────────────────────────────────────────

function parts(value: any, multiple: boolean): any[] {
  if (Array.isArray(value)) return value;
  if (multiple && typeof value === 'string' && value.includes(',')) {
    return value.split(',').map(p => p.trim()).filter(Boolean);
  }
  return [value];
}

export function answerState(answer: any, parent: F, cond: FieldCondition): ConditionState {
  let status: string | null = null;
  let value = answer;
  if (answer && typeof answer === 'object' && !Array.isArray(answer) && !Array.isArray(answer.value)) {
    status = normalizeStatus(answer.status);
    value = answer.value;
  }
  if (status && isFailure(status)) return WAITING;
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return WAITING;
  const wanted = new Set((cond.values || []).map(valueKey));
  if (parts(value, !!parent.multiple).some(p => wanted.has(valueKey(p)))) return APPLIES;
  const st = status || classify(value, optionsOf(parent));
  if (st === NOT_APPLICABLE) return SKIPPED_PARENT_SKIPPED;
  if (st === NOT_REPORTED) return PARENT_NR;
  return SKIPPED_CONDITION_FALSE;
}

function combine(parentState: ConditionState, own: ConditionState): ConditionState {
  if (parentState === SKIPPED_CONDITION_FALSE || parentState === SKIPPED_PARENT_SKIPPED) return SKIPPED_PARENT_SKIPPED;
  if (parentState === PARENT_NR) return PARENT_NR;
  if (parentState === WAITING) return WAITING;
  return own;
}

// ── evaluation ───────────────────────────────────────────────────────────────

export function evaluate(fields: F[], answers: Record<string, any>): Record<string, ConditionState> {
  const byName = new Map(fields.map(f => [f.field_name, f]));
  const states: Record<string, ConditionState> = {};
  for (const f of fields) {
    const c = conditionOf(f);
    if (!c) { states[f.field_name] = APPLIES; continue; }
    const parent = byName.get(c.field);
    if (!parent || !(c.field in states) || parent.field_type === 'array') { states[f.field_name] = WAITING; continue; }
    states[f.field_name] = combine(states[c.field], answerState(answers[c.field], parent, c));
  }
  return states;
}

export function evaluateRow(
  table: F,
  row: Record<string, any>,
  answers: Record<string, any>,
  formStates: Record<string, ConditionState>,
  fields: F[] = [],
): Record<string, ConditionState> {
  const tableState = formStates[table.field_name] ?? APPLIES;
  const cols = (table.subform_fields || []) as F[];
  const byName = new Map(cols.map(c => [c.field_name, c]));
  const top = new Map(fields.map(f => [f.field_name, f]));
  const states: Record<string, ConditionState> = {};
  for (const col of cols) {
    const c = conditionOf(col);
    let own: ConditionState;
    if (!c) {
      own = APPLIES;
    } else if (fromOf(c) === 'row') {
      const parent = byName.get(c.field);
      own = !parent || !(c.field in states)
        ? WAITING
        : combine(states[c.field], answerState((row || {})[c.field], parent, c));
    } else {
      const parent = top.get(c.field);
      own = !parent || !(c.field in formStates)
        ? WAITING
        : combine(formStates[c.field], answerState(answers[c.field], parent, c));
    }
    states[col.field_name] = tableState !== APPLIES ? combine(tableState, own) : own;
  }
  return states;
}

// ── validation (messages identical to the Python mirror) ─────────────────────

function checkOne(cond: FieldCondition, child: string, parent: F | undefined, parentLabel: string, parentAbove: boolean): string[] {
  const errs: string[] = [];
  if (!(OPS as readonly string[]).includes(cond.op as string)) errs.push(`"${child}": the condition must use "equals" or "in".`);
  let values: any[] = Array.isArray(cond.values) ? cond.values : [];
  if (!Array.isArray(cond.values) || !values.some(v => typeof v === 'string' && v.trim())) {
    errs.push(`"${child}": pick at least one answer of "${parentLabel}".`);
    values = [];
  } else if (cond.op === 'equals' && values.length !== 1) {
    errs.push(`"${child}": "equals" takes exactly one answer; use "in" for several.`);
  }
  if (!parent) { errs.push(`"${child}" depends on "${parentLabel}", which does not exist.`); return errs; }
  const ptype = parent.field_type || '';
  if (ptype === 'array') { errs.push(`"${child}" cannot depend on the table "${parentLabel}".`); return errs; }
  if (!ELIGIBLE_PARENT_TYPES.includes(ptype)) {
    errs.push(`"${child}" can only depend on a choice or yes/no question; "${parentLabel}" is ${ptype || 'text'}.`);
    return errs;
  }
  if (!parentAbove) errs.push(`"${parentLabel}" must come before "${child}", which depends on it.`);
  const allowed = new Set(optionsOf(parent).map(valueKey));
  for (const v of values) {
    if (typeof v === 'string' && v.trim() && !allowed.has(valueKey(v))) errs.push(`"${child}": "${v}" is not an answer of "${parentLabel}".`);
  }
  return errs;
}

export function validateConditions(fields: F[]): string[] {
  const errs: string[] = [];
  const order = new Map(fields.map((f, i) => [f.field_name, i]));
  const byName = new Map(fields.map(f => [f.field_name, f]));
  fields.forEach((f, i) => {
    const name = f.field_name || '(unnamed)';
    const c = conditionOf(f);
    if (c) {
      if (fromOf(c) === 'row') errs.push(`"${name}" is not a table column, so its condition cannot be "same row".`);
      else if (c.field === name) errs.push(`"${name}" cannot depend on itself.`);
      else errs.push(...checkOne(c, name, byName.get(c.field), c.field, (order.get(c.field) ?? FAR) < i));
    }
    if ((f.field_type || '') !== 'array') return;
    const cols = (f.subform_fields || []) as F[];
    const colOrder = new Map(cols.map((col, j) => [col.field_name, j]));
    const colByName = new Map(cols.map(col => [col.field_name, col]));
    const keys = new Set(keyColumnsOf(f));
    cols.forEach((col, j) => {
      const cc = conditionOf(col);
      if (!cc) return;
      const label = `${name} → ${col.field_name || '(unnamed)'}`;
      if (keys.has(col.field_name)) { errs.push(`"${label}" identifies a row, so it cannot be conditional.`); return; }
      if (fromOf(cc) === 'row') {
        if (cc.field === col.field_name) { errs.push(`"${label}" cannot depend on itself.`); return; }
        errs.push(...checkOne(cc, label, colByName.get(cc.field), `${name} → ${cc.field}`, (colOrder.get(cc.field) ?? FAR) < j));
      } else {
        errs.push(...checkOne(cc, label, byName.get(cc.field), cc.field, (order.get(cc.field) ?? FAR) < i));
      }
    });
  });
  return errs;
}

// ── references ───────────────────────────────────────────────────────────────

/** Labels of every field/column whose condition reads the top-level `fieldName`. */
export function dependentsOf(fields: F[], fieldName: string): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const c = conditionOf(f);
    if (c && fromOf(c) === 'form' && c.field === fieldName) out.push(f.field_name);
    for (const col of (f.subform_fields || []) as F[]) {
      const cc = conditionOf(col);
      if (cc && fromOf(cc) === 'form' && cc.field === fieldName) out.push(`${f.field_name} → ${col.field_name}`);
    }
  }
  return out;
}

/** Rewrite conditions pointing at a renamed field (drafts only). `table` set =
 *  a column of that table was renamed. Returns a new array. */
export function renameReferences(fields: F[], oldName: string, newName: string, table?: string): F[] {
  const fix = (c: FieldCondition | null, isRowScope: boolean, owner: string): FieldCondition | null => {
    if (!c) return c;
    if (!table && fromOf(c) === 'form' && c.field === oldName) return { ...c, field: newName };
    if (table && isRowScope && fromOf(c) === 'row' && owner === table && c.field === oldName) return { ...c, field: newName };
    return c;
  };
  return fields.map(f => {
    const next: F = { ...f };
    const c = conditionOf(f);
    if (c) next.condition = fix(c, false, f.field_name);
    if (Array.isArray(f.subform_fields)) {
      next.subform_fields = (f.subform_fields as F[]).map(col => {
        const cc = conditionOf(col);
        return cc ? { ...col, condition: fix(cc, true, f.field_name) } : col;
      });
    }
    return next;
  });
}

// ── builder helpers (UI only; no server mirror needed) ───────────────────────

/** "Adverse effects reported" — a field's human label. */
export function labelOf(f: { field_name: string; display_name?: string } | undefined, fallback = ''): string {
  if (!f) return fallback;
  return f.display_name || f.field_name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Answers a condition can pick from: the parent's options, or Yes / No. */
export function answerChoices(parent: F | undefined): string[] {
  return parent ? optionsOf(parent) : [];
}

/** Short tag for rails: "↳ if Yes", "↳ if Crossover / Cluster". */
export function conditionTag(c: FieldCondition | null | undefined): string {
  if (!c) return '';
  const vals = (c.values || []).filter(Boolean);
  return vals.length ? `↳ if ${vals.join(' / ')}` : '↳ if …';
}

/** Conditions that name `name` as their parent — top-level (table undefined)
 *  or a column of `table` (row-scoped) — with the answers each one uses. */
export function conditionsUsing(fields: F[], name: string, table?: string): Array<{ label: string; target: string; values: string[] }> {
  const out: Array<{ label: string; target: string; values: string[] }> = [];
  for (const f of fields) {
    const c = conditionOf(f);
    if (!table && c && fromOf(c) === 'form' && c.field === name) out.push({ label: labelOf(f), target: f.field_name, values: c.values || [] });
    for (const col of (f.subform_fields || []) as F[]) {
      const cc = conditionOf(col);
      if (!cc) continue;
      const hit = table
        ? fromOf(cc) === 'row' && f.field_name === table && cc.field === name
        : fromOf(cc) === 'form' && cc.field === name;
      if (hit) out.push({ label: `${labelOf(f)} → ${labelOf(col)}`, target: f.field_name, values: cc.values || [] });
    }
  }
  return out;
}

/** How deep a field sits in its chain (0 = asked unconditionally). */
export function conditionDepth(fields: F[], name: string): number {
  const byName = new Map(fields.map(f => [f.field_name, f]));
  let depth = 0;
  let cur = byName.get(name);
  const seen = new Set<string>();
  while (cur) {
    const c = conditionOf(cur);
    if (!c || fromOf(c) !== 'form' || seen.has(cur.field_name)) break;
    seen.add(cur.field_name);
    depth += 1;
    cur = byName.get(c.field);
  }
  return depth;
}

/** Same, inside one table's columns (row-scoped chains only). */
export function columnDepth(cols: F[], name: string): number {
  return conditionDepth(cols.map(c => {
    const cc = conditionOf(c);
    return cc && fromOf(cc) === 'row' ? { ...c, condition: { ...cc, from: 'form' as const } } : { ...c, condition: null };
  }), name);
}

/** Ordering errors a reorder would introduce ("must come before"). */
export function orderViolations(fields: F[]): string[] {
  return validateConditions(fields).filter(e => e.includes('must come before'));
}

// ── Phase 3: saved records (mirror of fields_at_revision / is_skipped_cell) ──

export function currentFormRev(metadata: any): number {
  return Number(metadata?.condition_rules?.form_rev || 0);
}

/** The form's fields carrying the rules of revision `rev` — a saved record is
 *  judged by the revision it is pinned to. 0 = no rules. Mirror of the Python. */
export function fieldsAtRevision(fields: F[], metadata: any, rev: number | null | undefined): F[] {
  const r = Number(rev || 0);
  if (r === currentFormRev(metadata)) return fields;
  const out: F[] = fields.map(f => ({
    ...f,
    condition: undefined,
    ...(Array.isArray(f.subform_fields)
      ? { subform_fields: (f.subform_fields as F[]).map(c => ({ ...c, condition: undefined })) }
      : {}),
  }));
  if (r <= 0) return out;
  const entry = (metadata?.condition_rules?.history || []).find((h: any) => Number(h?.form_rev) === r);
  if (!entry) return out;
  const byName = new Map(out.map(f => [f.field_name, f]));
  for (const [ruleId, rule] of Object.entries<any>(entry.rules || {})) {
    const [fname, col] = String(rule?.path || '').split('.');
    let holder: F | undefined = byName.get(fname);
    if (holder && col) holder = (holder.subform_fields as F[] | undefined)?.find(c => c.field_name === col);
    if (!holder) continue;
    holder.condition = {
      field: rule.field, op: rule.op, values: [...(rule.values || [])], rule_id: ruleId, rev: rule.rev,
      ...(col ? { from: rule.from || 'form' } : {}),
    };
  }
  return out;
}

export function isSkippedCell(cell: any): boolean {
  return !!cell && typeof cell === 'object' && !Array.isArray(cell)
    && SKIPPED_STATES.has(cell.applicability as ConditionState);
}

/** A stored skipped cell, turned back into the reviewer's own answer for the
 *  form (the follow-up stays hidden; the answer returns if it applies again).
 *  Anything else is returned untouched. */
export function unhideCell(cell: any): any {
  if (!isSkippedCell(cell)) return cell;
  return cell.hidden_answer ?? { value: '' };
}

/** One place to ask "is this shown?" while the reviewer types. */
export function visibilityOf(fields: F[], data: Record<string, any>) {
  const states = evaluate(fields, data);
  const byName = new Map(fields.map(f => [f.field_name, f]));
  return {
    states,
    shown: (name: string) => (states[name] ?? APPLIES) === APPLIES,
    /** Column names of `table` NOT shown in `row`. */
    hiddenInRow: (table: string, row: Record<string, any>): Set<string> => {
      const t = byName.get(table);
      if (!t) return new Set();
      const rs = evaluateRow(t, row || {}, data, states, fields);
      return new Set(Object.keys(rs).filter(k => rs[k] !== APPLIES));
    },
  };
}

// ── Logic map: connect / disconnect (pure; the map only draws) ───────────────

export interface LogicEnd { field: string; column?: string }

const keyOf = (f: F) => new Set(keyColumnsOf(f));

/** Stable "parents first": keeps the author's order except where a follow-up
 *  sits above the question it depends on, which the evaluator cannot resolve.
 *  Top-level fields by form-scoped rules (including a column's outside parent,
 *  which must sit above that column's table); each table's columns by row rules. */
export function reorderForConditions(fields: F[]): F[] {
  const stable = <T,>(items: T[], name: (t: T) => string, deps: (t: T) => string[]): T[] => {
    const names = new Set(items.map(name));
    const out: T[] = []; const placed = new Set<string>();
    const rest = [...items];
    while (rest.length) {
      const i = rest.findIndex(t => deps(t).every(d => !names.has(d) || placed.has(d) || d === name(t)));
      const pick = i < 0 ? 0 : i;                 // a cycle: give up on it, keep order
      const [t] = rest.splice(pick, 1);
      out.push(t); placed.add(name(t));
    }
    return out;
  };
  const top = stable(fields, f => f.field_name, f => {
    const d: string[] = [];
    const c = conditionOf(f);
    if (c && fromOf(c) === 'form') d.push(c.field);
    for (const col of (f.subform_fields || []) as F[]) {
      const cc = conditionOf(col);
      if (cc && fromOf(cc) === 'form') d.push(cc.field);
    }
    return d;
  });
  return top.map(f => {
    if (!Array.isArray(f.subform_fields) || !f.subform_fields.length) return f;
    const cols = stable(f.subform_fields as F[], c => c.field_name, c => {
      const cc = conditionOf(c);
      return cc && fromOf(cc) === 'row' ? [cc.field] : [];
    });
    return cols.every((c, i) => c === (f.subform_fields as F[])[i]) ? f : { ...f, subform_fields: cols };
  });
}

function ancestorsOf(fields: F[], end: LogicEnd): Set<string> {
  // Names (top-level) or column names (same table) this end already depends on.
  const out = new Set<string>();
  if (end.column) {
    const t = fields.find(f => f.field_name === end.field);
    const cols = new Map(((t?.subform_fields || []) as F[]).map(c => [c.field_name, c]));
    let cur = cols.get(end.column);
    while (cur) {
      const c = conditionOf(cur);
      if (!c || fromOf(c) !== 'row' || out.has(c.field)) break;
      out.add(c.field); cur = cols.get(c.field);
    }
    return out;
  }
  const by = new Map(fields.map(f => [f.field_name, f]));
  let cur = by.get(end.field);
  while (cur) {
    const c = conditionOf(cur);
    if (!c || fromOf(c) !== 'form' || out.has(c.field)) break;
    out.add(c.field); cur = by.get(c.field);
  }
  return out;
}

/** Make `dst` a follow-up asked when `src` has answer `value`. Dragging a second
 *  answer of the same parent onto the same follow-up widens it to "is one of";
 *  a different parent replaces the old rule (said in `note`). Returns the new
 *  field list, or an `error` in plain words. */
export function connectCondition(fields: F[], src: LogicEnd & { value: string }, dst: LogicEnd): { fields?: F[]; error?: string; note?: string } {
  const by = new Map(fields.map(f => [f.field_name, f]));
  const srcField = by.get(src.field);
  const dstField = by.get(dst.field);
  if (!srcField || !dstField) return { error: 'That question no longer exists.' };
  const srcHolder = src.column ? ((srcField.subform_fields || []) as F[]).find(c => c.field_name === src.column) : srcField;
  const dstHolder = dst.column ? ((dstField.subform_fields || []) as F[]).find(c => c.field_name === dst.column) : dstField;
  if (!srcHolder || !dstHolder) return { error: 'That column no longer exists.' };
  if (src.column && (dst.field !== src.field || !dst.column)) {
    return { error: `A column can only unlock columns in its own table (${labelOf(srcField)}).` };
  }
  if (src.field === dst.field && (src.column ?? null) === (dst.column ?? null)) return { error: 'A question cannot depend on itself.' };
  if (!src.column && !dst.column && src.field === dst.field) return { error: 'A question cannot depend on itself.' };
  if (dst.column && keyOf(dstField).has(dst.column)) {
    return { error: `${labelOf(dstHolder)} identifies a row, so it is always asked.` };
  }
  const srcName = src.column ?? src.field;
  const dstName = dst.column ?? dst.field;
  if ((src.column ? src.field === dst.field : true) && ancestorsOf(fields, src).has(dstName)) {
    return { error: `${labelOf(srcHolder)} already depends on ${labelOf(dstHolder)} — that would make a loop.` };
  }
  const from: 'form' | 'row' | undefined = dst.column ? (src.column ? 'row' : 'form') : undefined;
  const prev = conditionOf(dstHolder);
  let note: string | undefined;
  let next: FieldCondition;
  if (prev && prev.field === srcName && fromOf(prev) === (from ?? 'form')) {
    const values = prev.values.some(v => valueKey(v) === valueKey(src.value)) ? prev.values : [...prev.values, src.value];
    next = { ...prev, values, op: values.length > 1 ? 'in' : 'equals' };
  } else {
    if (prev) note = `Replaced the earlier rule on ${labelOf(dstHolder)} (it depended on ${prev.field}).`;
    next = { field: srcName, op: 'equals', values: [src.value], ...(from ? { from } : {}) };
  }
  const updated = fields.map(f => {
    if (f.field_name !== dst.field) return f;
    if (!dst.column) return { ...f, condition: next };
    return { ...f, subform_fields: ((f.subform_fields || []) as F[]).map(c => c.field_name === dst.column ? { ...c, condition: next } : c) };
  });
  const reordered = reorderForConditions(updated);
  const moved = reordered.some((f, i) => f.field_name !== updated[i].field_name)
    || reordered.some((f, i) => (f.subform_fields || []).some((c: any, j: number) => c.field_name !== (updated[i].subform_fields || [])[j]?.field_name));
  if (moved) note = [note, `Moved ${labelOf(dstHolder)} below ${labelOf(srcHolder)} so it is asked after it.`].filter(Boolean).join(' ');
  return { fields: reordered, note };
}

/** Remove one answer from `dst`'s rule; the rule goes (as null, so a save
 *  clears it) when no answer is left. `value` omitted = remove the whole rule. */
export function disconnectCondition(fields: F[], dst: LogicEnd, value?: string): F[] {
  const drop = (c: FieldCondition | null): FieldCondition | null => {
    if (!c) return c;
    if (value === undefined) return null;
    const values = c.values.filter(v => valueKey(v) !== valueKey(value));
    return values.length ? { ...c, values, op: values.length > 1 ? 'in' : 'equals' } : null;
  };
  return fields.map(f => {
    if (f.field_name !== dst.field) return f;
    if (!dst.column) return { ...f, condition: drop(conditionOf(f)) };
    return { ...f, subform_fields: ((f.subform_fields || []) as F[]).map(c => c.field_name === dst.column ? { ...c, condition: drop(conditionOf(c)) } : c) };
  });
}

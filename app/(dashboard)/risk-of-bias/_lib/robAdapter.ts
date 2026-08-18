/**
 * Bind a published instrument onto whatever shape a form actually has.
 *
 * The six risk-of-bias forms in this corpus disagree about almost everything: a
 * repeating table vs flat top-level fields; `_justification` vs `_reason` vs
 * `_support`; five RoB 2 domains vs seven RoB 1 items vs a custom eighth; and a
 * `Low / Probably Low / Probably High / High` scale that RoB 2 does not define.
 *
 * The screen must not inherit any of that. It renders the instrument — always
 * the same domains in the same order with the same judgments — and this file
 * does the translating. Two consequences worth stating:
 *
 *  - **Reading is lossy in one safe direction.** `Probably Low` reads as "Some
 *    concerns" rather than "Low", because over-stating quality is the error that
 *    changes a conclusion.
 *  - **Writing refuses rather than guesses.** If a form offers two options that
 *    both mean "Some concerns", the adapter will not pick one; that domain
 *    becomes read-only with the reason shown. The preset exists so conforming
 *    forms never hit this.
 */

import type { Form, FormField } from '@/types/api';
import { cellValue, rowsOf, type Row, type Severity } from './robForm';
import {
  toCanonicalJudgment, toFormOption, TOOLS,
  type RobTool, type ToolDomain,
} from './robTools';

const JUDGMENT = /judgment|judgement/i;
/** The three spellings the corpus actually uses for the free-text companion. */
const RATIONALE = /justification|reason|support|rationale/i;
/** RoB 2's signalling questions — `d1_1_...`. Not judgments; must not be bound. */
const SIGNALLING = /^(d|domain)[_\s]?\d+[_\s]?\d+/i;

export interface BoundDomain {
  /** Canonical code and name — from the instrument, never from the form. */
  code: string;
  name: string;
  /** Column holding the judgment, or null when this form omits the domain. */
  column: string | null;
  rationaleColumn: string | null;
  /** The options this form declares, which may not be the tool's. */
  formOptions: string[];
  /** True when the form is not one this tool's own vocabulary. */
  needsTranslation: boolean;
  /** Canonical judgments this form cannot unambiguously store. */
  unwritable: string[];
  /** Present on a domain the form declares but the instrument does not define. */
  extra?: boolean;
}

export interface BoundForm {
  form: Form;
  tool: RobTool;
  /** How many of the tool's domains this form actually provides. */
  coverage: number;
  domains: BoundDomain[];
  /** Repeating table holding assessments, or null when the form is flat. */
  tableField: string | null;
  /** Columns naming which outcome a row assesses. Empty on a flat form. */
  outcomeColumns: string[];
  /** True when every domain stores the tool's own judgments verbatim. */
  conforming: boolean;
}

// ── Locating the judgment columns ────────────────────────────────────────────

interface Candidate {
  name: string;
  options: string[];
  description?: string;
}

function judgmentCandidates(fields: FormField[]): Candidate[] {
  return (fields ?? [])
    .filter((f): f is FormField => !!f && !!f.field_name)
    .filter(f => JUDGMENT.test(f.field_name) && !SIGNALLING.test(f.field_name))
    .map(f => ({ name: f.field_name, options: [...(f.options ?? [])], description: f.field_description }));
}

function rationaleFor(name: string, fields: FormField[]): string | null {
  const stem = name.replace(/[_\s]*(judgment|judgement)$/i, '');
  const hit = (fields ?? []).find(
    f => f?.field_name && f.field_name !== name
      && f.field_name.startsWith(stem) && RATIONALE.test(f.field_name),
  );
  return hit?.field_name ?? null;
}

/**
 * Bind one tool onto a set of fields.
 *
 * Each canonical domain claims the first unclaimed column its pattern matches,
 * in the tool's own order, so an earlier domain never steals a later one's
 * column. Judgment columns left over are surfaced as `extra` rather than
 * dropped — standardizing must not lose a domain someone deliberately added.
 */
function bindTool(fields: FormField[], tool: RobTool): { domains: BoundDomain[]; coverage: number } {
  const candidates = judgmentCandidates(fields);
  const claimed = new Set<string>();
  const domains: BoundDomain[] = [];

  const describe = (column: string | null, options: string[]): Pick<BoundDomain,
    'needsTranslation' | 'unwritable'> => {
    if (!column) return { needsTranslation: false, unwritable: [] };
    const speaksTool = tool.judgments.every(j =>
      options.some(o => o.toLowerCase() === j.toLowerCase()));
    const unwritable = tool.judgments.filter(j => {
      const target = toFormOption(j, options, tool);
      return !target || 'ambiguous' in target;
    });
    return { needsTranslation: !speaksTool, unwritable };
  };

  for (const domain of tool.domains) {
    const hit = candidates.find(c => !claimed.has(c.name) && domain.match.test(c.name));
    if (hit) claimed.add(hit.name);
    domains.push({
      code: domain.code,
      name: domain.name,
      column: hit?.name ?? null,
      rationaleColumn: hit ? rationaleFor(hit.name, fields) : null,
      formOptions: hit?.options ?? [],
      ...describe(hit?.name ?? null, hit?.options ?? []),
    });
  }

  for (const leftover of candidates.filter(c => !claimed.has(c.name))) {
    const stem = leftover.name.replace(/[_\s]*(judgment|judgement)$/i, '').replace(/_/g, ' ');
    domains.push({
      code: '+',
      name: (leftover.description?.split(/(?<=\.)\s/)[0] ?? stem).replace(/\.$/, ''),
      column: leftover.name,
      rationaleColumn: rationaleFor(leftover.name, fields),
      formOptions: leftover.options,
      extra: true,
      ...describe(leftover.name, leftover.options),
    });
  }

  return { domains, coverage: domains.filter(d => !d.extra && d.column).length };
}

/**
 * Work out which instrument a form is trying to be, and bind it.
 *
 * Whichever tool covers the most of its own domains wins; ties go to the earlier
 * tool, which puts RoB 2 first. That is what separates `cd010266` (seven RoB 1
 * items, all matched) from the acute-dental-pain forms (five RoB 2 domains).
 */
export function bindForm(form: Form): BoundForm | null {
  const table = (form.fields ?? []).find(
    f => f?.field_type === 'array' && (f.subform_fields?.length ?? 0) > 0
      && judgmentCandidates(f.subform_fields ?? []).length >= 2,
  );
  const fields = table ? (table.subform_fields ?? []) : (form.fields ?? []);
  if (judgmentCandidates(fields).length < 2) return null;

  let best: { tool: RobTool; domains: BoundDomain[]; coverage: number } | null = null;
  for (const tool of TOOLS) {
    const bound = bindTool(fields, tool);
    if (!best || bound.coverage > best.coverage) best = { tool, ...bound };
  }
  if (!best || best.coverage === 0) return null;

  // `outcome_other_specify` mentions "outcome" but is a free-text escape hatch,
  // not a column that identifies which outcome a row assesses.
  const outcomeColumns = table
    ? (fields as FormField[])
        .filter(f => f?.field_name && /outcome/i.test(f.field_name)
          && !JUDGMENT.test(f.field_name) && !RATIONALE.test(f.field_name)
          && !/other|specify|comment|note/i.test(f.field_name))
        .map(f => f.field_name)
    : [];

  return {
    form,
    tool: best.tool,
    coverage: best.coverage,
    domains: best.domains,
    tableField: table?.field_name ?? null,
    outcomeColumns,
    conforming: best.domains.every(d => !d.column || (!d.needsTranslation && d.unwritable.length === 0)),
  };
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface DomainReading {
  /** The tool's judgment, translated from whatever the form stored. */
  canonical: string | null;
  /** Exactly what is stored, so a translation is always inspectable. */
  raw: string;
  rationale: string;
}

/** The record holding one assessment — a table row, or the record itself. */
export function assessmentRecord(
  data: Record<string, any> | undefined,
  bound: BoundForm,
  outcome: string,
): Row | null {
  if (!bound.tableField) return (data as Row) ?? null;
  const rows = rowsOf(data, bound.tableField);
  if (bound.outcomeColumns.length === 0) return rows[0] ?? null;
  return rows.find(r => outcomeValueOf(r, bound.outcomeColumns) === outcome) ?? null;
}

export function outcomeValueOf(row: Row, outcomeColumns: string[]): string {
  for (const col of outcomeColumns) {
    const v = cellValue(row, col);
    if (v && v.toUpperCase() !== 'NA') return v;
  }
  return '';
}

export function readDomain(record: Row | null, domain: BoundDomain, tool: RobTool): DomainReading {
  const raw = domain.column ? cellValue(record ?? undefined, domain.column) : '';
  return {
    raw,
    canonical: raw ? toCanonicalJudgment(raw, tool) : null,
    rationale: domain.rationaleColumn ? cellValue(record ?? undefined, domain.rationaleColumn) : '',
  };
}

export function severityOfCanonical(canonical: string | null, tool: RobTool): Severity {
  if (!canonical) return 'none';
  return tool.severity[canonical] ?? 'none';
}

// ── Writing ──────────────────────────────────────────────────────────────────

export interface DomainWrite {
  canonical: string;
  rationale: string;
}

/**
 * Fold one outcome's judgments into an existing record.
 *
 * Preserves everything it is not asked to change: sibling outcome rows, flat
 * fields, and columns this page has never heard of. A study carries one row per
 * outcome and saving writes the whole record, so a careless merge here silently
 * destroys a colleague's other assessments.
 */
export function writeAssessment(
  existing: Record<string, any> | undefined,
  bound: BoundForm,
  outcome: string,
  outcomeColumn: string,
  writes: Record<string, DomainWrite>,
): Record<string, any> {
  const applyTo = (row: Row): Row => {
    const next: Row = { ...row };
    for (const domain of bound.domains) {
      if (!domain.column) continue;
      const write = writes[domain.column];
      if (!write) continue;
      const target = toFormOption(write.canonical, domain.formOptions, bound.tool);
      // A refusal here is deliberate; the UI has already disabled the control.
      if (!target || 'ambiguous' in target) continue;
      next[domain.column] = target.option;
      if (domain.rationaleColumn) next[domain.rationaleColumn] = write.rationale;
    }
    return next;
  };

  // Flat form: the record itself is the assessment, with no outcome dimension.
  if (!bound.tableField) return applyTo({ ...(existing ?? {}) });

  const record = { ...(existing ?? {}) };
  const rows = rowsOf(existing, bound.tableField);
  const index = bound.outcomeColumns.length === 0
    ? (rows.length > 0 ? 0 : -1)
    : rows.findIndex(r => outcomeValueOf(r, bound.outcomeColumns) === outcome);

  const nextRows = index >= 0
    ? rows.map((r, i) => (i === index ? applyTo(r) : r))
    : [...rows, applyTo(outcomeColumn ? { [outcomeColumn]: outcome } : {})];

  const original = existing?.[bound.tableField];
  record[bound.tableField] =
    original && typeof original === 'object' && !Array.isArray(original) && 'value' in original
      ? { ...original, value: nextRows }
      : nextRows;
  return record;
}

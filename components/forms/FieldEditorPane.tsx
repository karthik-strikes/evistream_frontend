'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Bot, ShieldCheck, X, Zap } from 'lucide-react';
import { Textarea, TooltipSimple } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { FormField, TableFieldExtractionStrategy } from '@/types/api';

// ── Types ──────────────────────────────────────────────────────────────────

export type UEFCalField = {
  description: string;
  hints: string[];
  rules: string[];
  examples: Array<{ value: string; source_text?: string }>;
};

export type UEFEditableField = FormField & { _isNew?: boolean; _isDeleted?: boolean };

export interface FieldEditorPaneProps {
  field: UEFEditableField;
  cal: UEFCalField;
  editable: boolean;
  structuralEditable?: boolean;
  simple?: boolean;
  /**
   * Scroll to + briefly highlight one subfield (table column) card. Set by the
   * caller when a column is clicked in a left-rail tree. Bump `nonce` to
   * re-trigger for the same name.
   */
  focusSubfield?: { name: string; nonce: number } | null;
  /**
   * Per-field table extraction mode selector. Omit to hide it entirely — e.g.
   * in CreateFormDialog, where no schema_def exists yet to patch against.
   */
  tableModeProps?: {
    mode: TableFieldExtractionStrategy;
    onChange: (mode: TableFieldExtractionStrategy) => void;
    disabled?: boolean;
    saving?: boolean;
    modelIsClaude: boolean;
    preferredModel: string;
  };
  /**
   * Per-field row definition (which columns start a new row). Omit to hide —
   * e.g. in CreateFormDialog, where there is no schema_def to patch yet.
   * `keyColumns: null` means the form has no stored definition to show.
   */
  rowDefProps?: {
    keyColumns: string[] | null;
    onSave: (next: string[]) => void;
    disabled?: boolean;
    saving?: boolean;
  };
  onFieldPatch: (patch: Partial<FormField>) => void;
  onCalPatch: (patch: Partial<UEFCalField>) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function humanizeFieldName(s: string): string {
  return s.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const ANCHOR_KEYWORDS = ['name','label','type','subtype','point','timepoint','period','arm','group','unit','category','intervention','outcome','visit','event','treatment','identifier','measure',
  // Identity words the keyword-only rule missed on real forms.
  'comparison','comparator','reporter','population','subgroup','cohort','condition','instrument','scale','drug','regimen'];

// Per-arm/per-group numeric measurements (mean_arm1, sd_arm2, n_arm1, change_group2) are
// always attributes, never key columns. Without this guard the 'arm' keyword matched the
// *_arm<N> suffix on every numeric column, putting them all in the key and leaving slot filling empty.
const PER_ARM_VALUE = /_(arm|group|grp|g)\s*\d+$/;
const MEASURE_TOKENS = new Set(['mean','median','sd','std','stdev','se','sem','iqr','range','ci','n','num','count','pct','percent','proportion','rate','value','score','change','delta','diff','pvalue','pval','p','min','max','sum','total','avg','baseline']);

export function isValueColumn(name: string, fieldType?: string): boolean {
  const f = (name || '').toLowerCase();
  if (PER_ARM_VALUE.test(f)) return true;
  if (MEASURE_TOKENS.has(f.split(/[_\s]+/)[0])) return true;
  // A numeric column is a measured quantity, not a row identity.
  return (fieldType || '').toLowerCase() === 'number';
}

// No longer a routing decision — extraction mode is a per-field user choice
// (see tableModeProps below); single_call is the default at every width.
// Kept only to size the illustrative "N focused calls" preview shown for a
// row_then_columns field. Mirrors backend/core/generators/signature_gen.py's
// >5-column threshold for running the LLM key-column classifier.
export const TABLE_STRATEGY_COLUMN_THRESHOLD = 5;

// A column is a key column UNLESS it looks like a measurement — deliberately the
// inverse of the old keyword-match rule, which under-detected (it missed
// `comparison` and `reporter` on real forms, and dropping a key column merges rows
// that should stay distinct). Mirrors _auto_detect_key_columns in
// backend/core/generators/signature_gen.py — keep the two in sync.
export function autoDetectKeyColumns(sfs: any[]): string[] {
  const names: string[] = (sfs || []).map((sf: any) => sf?.field_name).filter(Boolean);
  if (names.length === 0) return [];

  const valueNames = new Set(
    (sfs || [])
      .filter((sf: any) => sf?.field_name && isValueColumn(sf.field_name, sf.field_type))
      .map((sf: any) => sf.field_name),
  );
  let keyColumns = names.filter(n => !valueNames.has(n));

  // Two-stage needs at least one value column left over; if every column read as
  // a key column, fall back to the narrower keyword rule.
  if (keyColumns.length === names.length) {
    const kw = names.filter(n => ANCHOR_KEYWORDS.some(k => n.toLowerCase().includes(k)));
    keyColumns = kw.length > 0 && kw.length < names.length ? kw : [names[0]];
  }
  return keyColumns.length > 0 ? keyColumns : [names[0]];
}

// ── AutoTextarea (auto-growing textarea used inside FieldEditorPane) ──────

export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 28)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={1}
      className={className}
    />
  );
}

// A measured RESULT can never be part of row identity: in the row key, a value
// disagreement becomes an identity disagreement — 25 and 26 are two DIFFERENT
// rows, so row coverage reports a phantom missing row and R1-vs-R2 comparison
// reports a phantom conflict on a one-digit read difference.
//
// Deliberately a CONJUNCTION (numeric AND result-named), unlike isValueColumn
// above: REMOVING a column from the row key MERGES rows, the direction that
// silently destroys data, and a legitimate identity can be numeric
// (intervention_code, visit_number, dose_mg). A numeric column with no
// statistical token in its name is therefore left alone, not flagged.
//
// Mirrors is_measured_result_column in backend/core/generators/signature_gen.py
// — keep the two in sync.
const RESULT_TOKENS = new Set(['mean','median','sd','std','stdev','se','sem','iqr','ci','n','num','count',
  'events','event','pct','percent','proportion','rate','effect','estimate','pvalue','pval','p','change',
  'delta','diff','var','variance','ratio','rr','hr','md','smd','nnt']);

export function isMeasuredResultColumn(name: string, fieldType?: string): boolean {
  if ((fieldType || '').toLowerCase() !== 'number') return false;
  return (name || '').toLowerCase().split(/[_\s]+/).some(t => t && RESULT_TOKENS.has(t));
}

// ── Extraction modes ───────────────────────────────────────────────────────
// User-facing names for the three table extraction paths. The stored
// `extraction_strategy` values are unchanged — renaming them would mean a
// migration across schema_def, the fields JSONB, the splicer, the eval harness
// and the API validator, and `build_schema_classes` selects two-stage by an
// exact string match that falls through to single-call SILENTLY on a miss. So
// these are labels over the existing values, and the single source of truth for
// how the modes are described anywhere in the UI.
export const TABLE_MODE_META: Record<
  TableFieldExtractionStrategy,
  { label: string; tagline: string; blurb: string; calls: string; recommended?: boolean; beta?: boolean }
> = {
  single_call: {
    label: 'Fast',
    tagline: 'Fewest calls',
    blurb: 'Reads the whole table in a single prompt. Best for short tables with few columns.',
    calls: '1 model call',
  },
  row_then_columns: {
    label: 'Rigorous',
    tagline: 'Most thorough and reliable',
    blurb: 'Finds the rows first, audits them for anything missed, locks that row plan, then extracts values against it and refills any row that comes back empty.',
    calls: 'Typically 3–5 model calls',
    recommended: true,
  },
  agentic: {
    label: 'Agentic',
    tagline: 'Highest assurance, highest cost',
    blurb: 'An agent plans the rows, checks every quote against the paper, and repairs what it missed. Runs on Claude.',
    calls: 'Typically 8–25 model turns',
    beta: true,
  },
};

export const TABLE_MODE_ORDER: TableFieldExtractionStrategy[] = [
  'single_call', 'row_then_columns', 'agentic',
];

// ── Row definition — which columns make a new row ──────────────────────────
// The row key is the backbone of table extraction: rows are discovered by these
// columns, per-row extraction is keyed on them, and reviewer comparison matches
// rows on them. Flagging is advisory only (see isMeasuredResultColumn).
export function RowDefinitionSection({
  subformFields,
  keyColumns,
  onSave,
  disabled = false,
  saving = false,
}: {
  subformFields: any[];
  /** null = this form has no stored row definition to show (pre-dates the editor). */
  keyColumns: string[] | null;
  onSave: (next: string[]) => void;
  disabled?: boolean;
  saving?: boolean;
}) {
  const names: string[] = (subformFields || []).map((sf: any) => sf?.field_name).filter(Boolean);
  const unset = keyColumns === null;
  const [draft, setDraft] = useState<string[]>(
    () => (keyColumns && keyColumns.length ? keyColumns : autoDetectKeyColumns(subformFields)),
  );

  const ml = "text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider";

  if (names.length === 0) return null;

  // Columns can be renamed or removed while this pane is open.
  const picked = draft.filter(n => names.includes(n));
  const selected = new Set(picked);
  const rest = names.filter(n => !selected.has(n));
  const flagged = (subformFields || []).filter(
    (sf: any) => selected.has(sf.field_name) && isMeasuredResultColumn(sf.field_name, sf.field_type),
  );
  const dirty = unset || picked.slice().sort().join('|') !== (keyColumns || []).slice().sort().join('|');
  const canSave = !saving && !disabled && picked.length > 0 && rest.length > 0;

  const toggle = (name: string) =>
    setDraft(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));

  return (
    <div className="mb-5 rounded-xl border border-gray-200 dark:border-[#2a2a2a] bg-gray-50/60 dark:bg-[#141414] overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <p className="text-sm font-semibold text-gray-800 dark:text-zinc-200">When should a new row be created?</p>
        <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
          Select the columns where a different value should start a new row.
        </p>
      </div>

      {unset && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
            This form has no row definition recorded yet, so the selection below is a suggestion
            rather than the current setting. Saving it sets the definition explicitly.
          </p>
        </div>
      )}

      <div className="border-t border-gray-200 dark:border-[#2a2a2a] flex items-center justify-between gap-3 px-4 py-2">
        <p className={ml}>Columns</p>
        <span className="text-[11px] font-mono text-gray-400 dark:text-zinc-500 shrink-0">
          {picked.length} of {names.length} selected
        </span>
      </div>

      <ul className="border-t border-gray-200 dark:border-[#2a2a2a]">
        {(subformFields || []).map((sf: any, i: number) => {
          if (!sf?.field_name) return null;
          const on = selected.has(sf.field_name);
          const flag = on && isMeasuredResultColumn(sf.field_name, sf.field_type);
          return (
            <li
              key={sf.field_name || i}
              className={cn(
                "border-b border-gray-100 dark:border-[#1f1f1f] last:border-b-0",
                flag
                  ? "bg-amber-50 dark:bg-amber-950/20"
                  : on && "bg-emerald-50/50 dark:bg-emerald-400/[0.04]",
              )}
            >
              <label className={cn("flex items-center gap-2.5 px-4 py-2", disabled || saving ? "cursor-not-allowed" : "cursor-pointer")}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled || saving}
                  onChange={() => toggle(sf.field_name)}
                  className="h-3.5 w-3.5 shrink-0 rounded accent-emerald-600 dark:accent-emerald-500 disabled:cursor-not-allowed"
                />
                <span className="flex-1 font-mono text-xs text-gray-700 dark:text-zinc-300 break-all">{sf.field_name}</span>
                <span className="shrink-0 text-[10px] font-mono text-gray-400 dark:text-zinc-500 border border-gray-200 dark:border-[#2a2a2a] rounded px-1.5 py-0.5">
                  {sf.field_type || 'text'}
                </span>
              </label>
              {flag && (
                <p className="pl-[38px] pr-4 pb-2 text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                  This is a number extracted from the paper, not a label. While it is selected, one
                  reviewer reading 25 and another reading 27 produce two different rows instead of
                  one value to resolve.
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-gray-200 dark:border-[#2a2a2a] px-4 py-3 flex flex-col gap-2">
        <p className={ml}>A new row for each unique combination of</p>
        {picked.length > 0 ? (
          <p className="font-mono text-xs text-emerald-700 dark:text-emerald-300 overflow-x-auto whitespace-nowrap pb-0.5">
            {picked.join('  ×  ')}
          </p>
        ) : (
          <p className="text-xs text-red-600 dark:text-red-400">
            Nothing selected — rows cannot be told apart. Select at least one column.
          </p>
        )}
        {rest.length > 0 ? (
          <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
            <span className="font-semibold text-gray-600 dark:text-zinc-300">All other columns are extracted within each row:</span>{' '}
            <span className="font-mono">{rest.join(', ')}</span>
          </p>
        ) : (
          picked.length > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
              Every column creates a new row, so there is nothing left to extract. Clear at least one.
            </p>
          )
        )}
      </div>

      {dirty && (
        <div className="border-t border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed max-w-[46ch]">
            <span className="font-semibold text-red-600 dark:text-red-400">Changing this changes how rows are defined.</span>{' '}
            Existing extracted data used the previous row definition, so new results may not align
            with older results. This change will be saved as a new version.
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              disabled={saving}
              onClick={() => setDraft(keyColumns && keyColumns.length ? keyColumns : autoDetectKeyColumns(subformFields))}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-50"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => onSave(picked)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save row definition'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── FieldEditorPane (each table field picks its own extraction mode via
//    tableModeProps — Fast is the default at every column count; the modes are
//    named in TABLE_MODE_META above, over unchanged stored values) ──

export function FieldEditorPane({ field, cal, editable, structuralEditable = editable, simple = false, focusSubfield = null, tableModeProps, rowDefProps, onFieldPatch, onCalPatch }: FieldEditorPaneProps) {
  const ml = "text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider";
  const fname = field.field_name;
  const isTableField = field.field_type === 'array';
  const isSelectField = field.field_type === 'select';
  const subformFields: any[] = isTableField && Array.isArray(field.subform_fields) ? field.subform_fields : [];

  const subfieldNameRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const subfieldCardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [pendingFocusIdx, setPendingFocusIdx] = useState<number | null>(null);
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);

  useEffect(() => {
    if (pendingFocusIdx === null) return;
    const el = subfieldNameRefs.current[pendingFocusIdx];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
    setPendingFocusIdx(null);
  }, [pendingFocusIdx, subformFields.length]);

  // Rail click → scroll that column's card into view and flash a ring on it.
  // Keyed on nonce so clicking the same column twice re-scrolls.
  useEffect(() => {
    const name = focusSubfield?.name;
    if (!name) return;
    const i = subformFields.findIndex((sf: any) => sf.field_name === name);
    if (i < 0) return;
    subfieldCardRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightIdx(i);
    const t = setTimeout(() => setHighlightIdx(null), 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSubfield?.nonce, focusSubfield?.name]);

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Field identity */}
      <div className="pb-4 mb-4 border-b border-gray-100 dark:border-[#1f1f1f]">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <p className={cn(ml, "mb-1")}>Field name</p>
            {structuralEditable ? (
              <input
                value={fname}
                onChange={e => onFieldPatch({ field_name: e.target.value })}
                placeholder="field_name"
                className="w-full font-mono text-sm bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2 text-gray-800 dark:text-zinc-200 focus:outline-none focus:border-gray-400 dark:focus:border-zinc-500"
              />
            ) : (
              <>
                <p className="font-mono text-sm text-gray-700 dark:text-zinc-300">{fname}</p>
              </>
            )}
          </div>
          <div className="shrink-0">
            <p className={cn(ml, "mb-1")}>Type</p>
            {structuralEditable ? (
              <select
                value={field.field_type}
                onChange={e => onFieldPatch({ field_type: e.target.value })}
                className="bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 py-2 text-xs text-gray-700 dark:text-zinc-300 focus:outline-none"
              >
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="select">select</option>
                <option value="array">table</option>
              </select>
            ) : (
              <>
                <span className={cn("text-xs px-2 py-1 rounded-md font-medium", isTableField ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40" : "bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-300")}>
                  {isTableField ? '\u25A6 table' : field.field_type}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Table callout */}
      {isTableField && (
        <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-amber-600 dark:text-amber-400">{'\u25A6'}</span>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Table field — extracted as one unit</p>
          </div>
          <p className="text-xs text-amber-700/80 dark:text-amber-300/70 leading-relaxed">Choose how this table is extracted below — Fast is the default at every width. Each column has its own description, hints, rules, and examples.</p>
        </div>
      )}

      {/* Table extraction mode (per field) */}
      {isTableField && tableModeProps && (
        <div className="mb-5">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className={ml}>Extraction mode</p>
            <span className="text-[11px] text-gray-400 dark:text-zinc-500">
              You can switch any time. Existing results are not changed.
            </span>
          </div>
          <TooltipSimple text={tableModeProps.disabled ? 'You need the "Create Forms" permission' : ''}>
            <div className="grid gap-2 sm:grid-cols-3">
              {TABLE_MODE_ORDER.map(m => {
                const meta = TABLE_MODE_META[m];
                const active = tableModeProps.mode === m;
                const disabled = tableModeProps.disabled || tableModeProps.saving;
                const Icon = m === 'single_call' ? Zap : m === 'row_then_columns' ? ShieldCheck : Bot;
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() => { if (m !== tableModeProps.mode) tableModeProps.onChange(m); }}
                    className={cn(
                      "text-left rounded-xl border p-3 transition-colors flex flex-col gap-1.5",
                      active
                        ? "border-emerald-300 dark:border-emerald-700/70 bg-emerald-50/70 dark:bg-emerald-400/[0.06] ring-1 ring-emerald-200/70 dark:ring-emerald-800/40"
                        : "border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#141414] hover:border-gray-300 dark:hover:border-[#3f3f3f]",
                      disabled && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        active ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400 dark:text-zinc-500",
                      )} />
                      <span className={cn(
                        "text-sm font-semibold",
                        active ? "text-emerald-800 dark:text-emerald-200" : "text-gray-700 dark:text-zinc-300",
                      )}>
                        {meta.label}
                      </span>
                      {meta.recommended && (
                        <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                          Recommended
                        </span>
                      )}
                      {meta.beta && (
                        <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#1f1f1f] text-gray-500 dark:text-zinc-400">
                          Beta
                        </span>
                      )}
                      <span className={cn(
                        "ml-auto h-3 w-3 rounded-full border shrink-0",
                        active
                          ? "border-emerald-500 bg-emerald-500 ring-2 ring-inset ring-white dark:ring-[#141414]"
                          : "border-gray-300 dark:border-[#3f3f3f]",
                      )} />
                    </div>
                    <p className={cn(
                      "text-[11px] font-medium",
                      active ? "text-emerald-700 dark:text-emerald-300" : "text-gray-500 dark:text-zinc-400",
                    )}>
                      {meta.tagline}
                    </p>
                    <p className="text-[11px] leading-relaxed text-gray-500 dark:text-zinc-400">
                      {meta.blurb}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-zinc-500 mt-auto pt-0.5">
                      {meta.calls}
                    </p>
                  </button>
                );
              })}
            </div>
          </TooltipSimple>
          {tableModeProps.mode === 'agentic' && !tableModeProps.modelIsClaude && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
              Agentic runs on Claude — it overrides your {tableModeProps.preferredModel} preference for this field.
            </p>
          )}
        </div>
      )}

      {/* Row definition (which columns start a new row) */}
      {isTableField && rowDefProps && (
        <RowDefinitionSection
          key={fname}
          subformFields={subformFields}
          keyColumns={rowDefProps.keyColumns}
          onSave={rowDefProps.onSave}
          disabled={rowDefProps.disabled}
          saving={rowDefProps.saving}
        />
      )}

      {/* Subfields */}
      {isTableField && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className={ml}>Subfields ({subformFields.length})</p>
            {editable && (
              <button type="button"
                onClick={() => {
                  const newIdx = subformFields.length;
                  onFieldPatch({ subform_fields: [...subformFields, { field_name: '', field_type: 'text', field_description: '' }] });
                  setPendingFocusIdx(newIdx);
                }}
                className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors">
                + Add subfield
              </button>
            )}
          </div>
          {subformFields.length === 0 && <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic">No subfields yet.</p>}
          <div className="flex flex-col gap-2">
            {subformFields.map((sf: any, i: number) => {
              const sfHints: string[] = Array.isArray(sf.hints) ? sf.hints : [];
              const sfRules: string[] = Array.isArray(sf.rules) ? sf.rules : [];
              const sfExamples: Array<{ value: string; source_text: string }> = Array.isArray(sf.examples)
                ? sf.examples
                : (sf.example ? [{ value: sf.example, source_text: '' }] : []);
              const patchSf = (patch: any) => { const n = [...subformFields]; n[i] = { ...n[i], ...patch }; onFieldPatch({ subform_fields: n }); };
              return (
                <div
                  key={i}
                  ref={el => { subfieldCardRefs.current[i] = el; }}
                  className={cn(
                    "rounded-lg border bg-white dark:bg-[#0d0d0d] p-3 transition-all duration-300",
                    highlightIdx === i
                      ? "border-sky-300 dark:border-sky-700/70 ring-2 ring-sky-200/70 dark:ring-sky-800/40"
                      : "border-gray-100 dark:border-[#1f1f1f]",
                  )}
                >
                  {editable ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <input ref={el => { subfieldNameRefs.current[i] = el; }} value={sf.field_name} onChange={e => patchSf({ field_name: e.target.value })}
                          onBlur={e => { const trimmed = e.target.value.trim(); if (trimmed !== sf.field_name) patchSf({ field_name: trimmed }); }}
                          placeholder="field_name" className="flex-1 font-mono text-xs bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-md px-2 py-1.5 text-gray-800 dark:text-zinc-200 focus:outline-none" />
                        <select value={sf.field_type || 'text'} onChange={e => patchSf({ field_type: e.target.value })}
                          className="bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-md px-1.5 py-1.5 text-[11px] text-gray-600 dark:text-zinc-400 focus:outline-none">
                          <option value="text">text</option>
                          <option value="number">number</option>
                          <option value="boolean">boolean</option>
                          <option value="select">select</option>
                        </select>
                        <button type="button" onClick={() => onFieldPatch({ subform_fields: subformFields.filter((_, j) => j !== i) })}
                          className="text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors shrink-0"><X className="h-3 w-3" /></button>
                      </div>
                      <input value={sf.field_description || ''} onChange={e => patchSf({ field_description: e.target.value })}
                        placeholder="Description (tells the LLM what this column means)"
                        className="w-full text-xs bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-md px-2 py-1.5 text-gray-800 dark:text-zinc-200 placeholder:text-gray-400 dark:placeholder:text-zinc-600 focus:outline-none" />
                      {sf.field_type === 'select' && (
                        <div className="flex flex-col gap-1 mt-1 pt-1.5 border-t border-gray-100 dark:border-[#1f1f1f]">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Options ({(sf.options || []).length})</p>
                            {(sf.options || []).length > 0 && <button type="button" onClick={() => patchSf({ options: [] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
                          </div>
                          {(sf.options || []).map((opt: string, oi: number) => (
                            <div key={oi} className="flex items-center gap-1.5">
                              <input value={opt} onChange={e => { const no = [...(sf.options || [])]; no[oi] = e.target.value; patchSf({ options: no }); }}
                                placeholder="option value" className="flex-1 text-[11px] bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] rounded-md px-2 py-1.5 text-gray-700 dark:text-zinc-300 focus:outline-none" />
                              <button type="button" onClick={() => patchSf({ options: (sf.options || []).filter((_: string, oj: number) => oj !== oi) })} className="text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>
                            </div>
                          ))}
                          <button type="button" onClick={() => patchSf({ options: [...(sf.options || []), ''] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add option</button>
                        </div>
                      )}
                      <div className="flex flex-col gap-1 mt-1 pt-1.5 border-t border-gray-100 dark:border-[#1f1f1f]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Extraction Hints</p>
                          {sfHints.length > 0 && <button type="button" onClick={() => patchSf({ hints: [] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
                        </div>
                        {sfHints.map((h, hi) => (
                          <div key={hi} className="flex items-start gap-1.5 rounded-md bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-2 py-1.5">
                            <span className="text-gray-400 dark:text-zinc-500 text-[11px] mt-0.5 shrink-0">{'\u2192'}</span>
                            <AutoTextarea value={h} onChange={e => { const nh = [...sfHints]; nh[hi] = e.target.value; patchSf({ hints: nh }); }} placeholder="where or how to find this value..." className="flex-1 text-[11px] bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                            <button type="button" onClick={() => patchSf({ hints: sfHints.filter((_, hj) => hj !== hi) })} className="text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => patchSf({ hints: [...sfHints, ''] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add hint</button>
                      </div>
                      <div className="flex flex-col gap-1 pt-1.5 border-t border-gray-100 dark:border-[#1f1f1f]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Rules</p>
                          {sfRules.length > 0 && <button type="button" onClick={() => patchSf({ rules: [] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
                        </div>
                        {sfRules.map((r, ri) => (
                          <div key={ri} className="flex items-start gap-1.5 rounded-md bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-2 py-1.5">
                            <span className="text-gray-400 dark:text-zinc-500 text-[11px] mt-0.5 shrink-0">{'\u00B7'}</span>
                            <AutoTextarea value={r} onChange={e => { const nr = [...sfRules]; nr[ri] = e.target.value; patchSf({ rules: nr }); }} placeholder="must / must-not constraint..." className="flex-1 text-[11px] bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                            <button type="button" onClick={() => patchSf({ rules: sfRules.filter((_, rj) => rj !== ri) })} className="text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => patchSf({ rules: [...sfRules, ''] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add rule</button>
                      </div>
                      <div className="flex flex-col gap-1 pt-1.5 border-t border-gray-100 dark:border-[#1f1f1f]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Examples</p>
                          {sfExamples.length > 0 && <button type="button" onClick={() => patchSf({ examples: [] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
                        </div>
                        {sfExamples.map((ex, ei) => (
                          <div key={ei} className="rounded-md border border-gray-100 dark:border-[#1f1f1f] overflow-hidden">
                            <div className="flex items-start gap-2 bg-gray-50 dark:bg-[#141414] px-2 py-1.5">
                              <div className="flex-1 flex flex-col gap-0.5">
                                <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">Value</p>
                                <AutoTextarea value={String(ex.value ?? '')} onChange={e => { const ne = [...sfExamples]; ne[ei] = { ...ne[ei], value: e.target.value }; patchSf({ examples: ne }); }} placeholder="extracted value" className="text-[11px] bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                              </div>
                              <button type="button" onClick={() => patchSf({ examples: sfExamples.filter((_, ej) => ej !== ei) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 mt-4 shrink-0"><X className="h-3 w-3" /></button>
                            </div>
                          </div>
                        ))}
                        <button type="button" onClick={() => patchSf({ examples: [...sfExamples, { value: '', source_text: '' }] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add example</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-gray-800 dark:text-zinc-100">{sf.display_name || humanizeFieldName(sf.field_name)}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#1f1f1f] text-gray-500 dark:text-zinc-400">{sf.field_type || 'text'}</span>
                      </div>
                      <p className="font-mono text-[11px] text-gray-400 dark:text-zinc-500">{sf.field_name}</p>
                      {sf.field_description && <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">{sf.field_description}</p>}
                      {Array.isArray(sf.options) && sf.options.length > 0 && <div className="mt-1.5"><p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">Options</p>{sf.options.map((opt: string, oi: number) => <p key={oi} className="text-[11px] text-gray-500 dark:text-zinc-400">{'·'} {opt}</p>)}</div>}
                      {sfHints.length > 0 && <div className="mt-1.5"><p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">Hints</p>{sfHints.map((h, hi) => <p key={hi} className="text-[11px] text-gray-500 dark:text-zinc-400">{'\u2192'} {h}</p>)}</div>}
                      {sfRules.length > 0 && <div className="mt-1"><p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">Rules</p>{sfRules.map((r, ri) => <p key={ri} className="text-[11px] text-gray-500 dark:text-zinc-400">{'\u00B7'} {r}</p>)}</div>}
                      {sfExamples.length > 0 && <div className="mt-1"><p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">Examples</p>{sfExamples.map((ex, ei) => <p key={ei} className="text-[11px] text-gray-500 dark:text-zinc-400">{String(ex.value ?? '')}</p>)}</div>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* Select options */}
      {isSelectField && editable && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className={ml}>Options ({(field.options || []).length})</p>
            <button type="button" onClick={() => onFieldPatch({ options: [...(field.options || []), ''] })}
              className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors">+ Add option</button>
          </div>
          {(field.options || []).length === 0 && <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic">No options yet.</p>}
          <div className="flex flex-col gap-1.5">
            {(field.options || []).map((opt: string, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <input value={opt} onChange={e => { const n = [...(field.options || [])]; n[i] = e.target.value; onFieldPatch({ options: n }); }}
                  placeholder="option value" className="flex-1 text-xs bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-md px-2 py-1.5 text-gray-800 dark:text-zinc-200 focus:outline-none" />
                <button type="button" onClick={() => onFieldPatch({ options: (field.options || []).filter((_, j) => j !== i) })}
                  className="text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors shrink-0"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
          {editable && (
            <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
              <input type="checkbox" checked={field.multiple ?? false}
                onChange={e => onFieldPatch({ multiple: e.target.checked })}
                className="w-3.5 h-3.5 rounded border-gray-300 dark:border-zinc-600 accent-violet-500" />
              <span className="text-[11px] text-gray-500 dark:text-zinc-400">Allow multiple selections</span>
            </label>
          )}
        </div>
      )}

      {/* Calibration */}
      <div className={cn("flex flex-col gap-4", (isTableField || (isSelectField && editable)) && "border-t border-gray-100 dark:border-[#1f1f1f] pt-4")}>
        <div className="flex flex-col gap-1.5">
          <p className={ml}>Description</p>
          <Textarea
            value={cal.description}
            onChange={e => editable && onCalPatch({ description: e.target.value })}
            placeholder="What this field captures..."
            rows={3}
            className="resize-none text-xs leading-relaxed"
            disabled={!editable}
          />
        </div>

        {simple ? (
          <div className="flex flex-col gap-1.5">
            <p className={ml}>Example value <span className="normal-case font-normal text-gray-400 dark:text-zinc-500">(optional)</span></p>
            <input
              value={field.example || ''}
              onChange={e => editable && onFieldPatch({ example: e.target.value })}
              placeholder="e.g. 45.2, 'Placebo', true..."
              disabled={!editable}
              className="w-full text-xs bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2 text-gray-800 dark:text-zinc-200 placeholder:text-gray-400 dark:placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={ml}>Extraction Hints</p>
                  <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">Where or how to find this value &mdash; e.g. &ldquo;look in the Methods section&rdquo;. Soft guidance for the AI.</p>
                </div>
                {editable && cal.hints.length > 0 && <button type="button" onClick={() => onCalPatch({ hints: [] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
              </div>
              {cal.hints.length === 0 && <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic">No hints yet.</p>}
              {cal.hints.map((h, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-3 py-2">
                  <span className="text-gray-500 dark:text-zinc-400 text-xs mt-0.5 shrink-0">{'\u2192'}</span>
                  <AutoTextarea value={h} onChange={e => { const next = [...cal.hints]; next[i] = e.target.value; onCalPatch({ hints: next }); }} placeholder="where or how to find this value..." className="flex-1 text-xs bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                  {editable && <button type="button" onClick={() => onCalPatch({ hints: cal.hints.filter((_, idx) => idx !== i) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>}
                </div>
              ))}
              {editable && <button type="button" onClick={() => onCalPatch({ hints: [...cal.hints, ''] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add hint</button>}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={ml}>Rules</p>
                  <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">Hard constraints the AI must follow &mdash; e.g. &ldquo;return NR if not found&rdquo;, &ldquo;never infer&rdquo;. Rules override hints.</p>
                </div>
                {editable && cal.rules.length > 0 && <button type="button" onClick={() => onCalPatch({ rules: [] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
              </div>
              {cal.rules.length === 0 && <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic">No rules yet.</p>}
              {cal.rules.map((r, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-3 py-2">
                  <span className="text-gray-500 dark:text-zinc-400 text-xs mt-0.5 shrink-0">{'\u00B7'}</span>
                  <AutoTextarea value={r} onChange={e => { const next = [...cal.rules]; next[i] = e.target.value; onCalPatch({ rules: next }); }} placeholder="must / must-not constraint..." className="flex-1 text-xs bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                  {editable && <button type="button" onClick={() => onCalPatch({ rules: cal.rules.filter((_, idx) => idx !== i) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>}
                </div>
              ))}
              {editable && <button type="button" onClick={() => onCalPatch({ rules: [...cal.rules, ''] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add rule</button>}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className={ml}>Examples</p>
                {editable && cal.examples.length > 0 && <button type="button" onClick={() => onCalPatch({ examples: [] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
              </div>
              {cal.examples.length === 0 && <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic">No examples yet.</p>}
              {cal.examples.map((ex, i) => (
                <div key={i} className="rounded-lg border border-gray-100 dark:border-[#1f1f1f] overflow-hidden">
                  <div className="flex items-start gap-2 bg-gray-50 dark:bg-[#141414] px-3 py-2">
                    <div className="flex-1 flex flex-col gap-0.5">
                      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">Value</p>
                      <AutoTextarea value={String(ex.value ?? '')} onChange={e => { const next = [...cal.examples]; next[i] = { ...next[i], value: e.target.value }; onCalPatch({ examples: next }); }} placeholder="extracted value" className="text-xs bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                    </div>
                    {editable && <button type="button" onClick={() => onCalPatch({ examples: cal.examples.filter((_, idx) => idx !== i) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 mt-4 shrink-0"><X className="h-3 w-3" /></button>}
                  </div>
                </div>
              ))}
              {editable && <button type="button" onClick={() => onCalPatch({ examples: [...cal.examples, { value: '', source_text: '' }] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add example</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

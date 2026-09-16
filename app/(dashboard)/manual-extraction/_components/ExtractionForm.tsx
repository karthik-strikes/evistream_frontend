'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Save, RotateCcw, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Form, FormField } from '@/types/api';
import { FieldRenderer } from './FieldRenderer';
import { TableField } from './TableField';
import { LinkedTableField } from './LinkedTableField';
import { AutoGrid, Divider, humanize } from './FormChrome';
import { isLinkedTable } from '../_lib/linkedGroups';
import { modKey } from '../_hooks/useExtractionKeyboard';
import { isTableField, flattenScalarFields, type AiTablePrefill } from '../_lib/fieldKinds';
import type { RowRemap } from '../_lib/rowMoves';
import { useSourcing } from '../_lib/SourcingContext';
import { GroupSetupDialog, type GroupingProps } from './GroupSetupDialog';
import { describeKey, parseKey } from '../_lib/sourcing';

/** State of the background draft save, shown where the "Save partial" button
 *  used to be. `off` means there is nothing to autosave — the stored row is
 *  already complete, and only Save may change it. */
export interface DraftStatus {
  state: 'off' | 'idle' | 'saving' | 'saved' | 'error';
  at: number | null;
  onRetry: () => void;
}

interface ExtractionFormProps {
  form: Form;
  formData: Record<string, any>;
  aiPrefilledKeys: Set<string>;
  aiPrefilledTablePrefill: Record<string, AiTablePrefill>;
  tableErrors: Record<string, Record<number, Set<string>>>;
  onFieldChange: (fieldName: string, value: any) => void;
  onTableChange: (parentName: string, rows: Array<Record<string, string>>, remap?: RowRemap) => void;
  onSave: () => void;
  draft: DraftStatus;
  onSaveAndNext: () => void;
  onReset: () => void;
  saving: boolean;
  hasNextDoc: boolean;
  /** Column-grouping setup, offered on each table's own header. Absent when the
   *  reviewer may not edit forms — the same permission the PATCH enforces.
   *
   *  It belongs here as well as on the form picker: the reviewer finds out that
   *  "scale range" is a property of the scale while being asked for it a fourth
   *  time, and sending them Back to re-pick the form to fix that is the opposite
   *  of the point. */
  grouping?: GroupingProps;
}

/**
 * One stretch of the form that shares a layout.
 *
 * Consecutive plain fields are one block on purpose: they then share a single
 * responsive grid, so two short answers sit side by side instead of each
 * claiming a full-width row. A table or a nested subform is its own block —
 * they bring their own internal layout and can't be interleaved.
 */
type Block =
  | { kind: 'scalars'; key: string; fields: FormField[] }
  | { kind: 'table'; key: string; field: FormField }
  | { kind: 'group'; key: string; field: FormField };

export function ExtractionForm({
  form,
  formData,
  aiPrefilledKeys,
  aiPrefilledTablePrefill,
  tableErrors,
  onFieldChange,
  onTableChange,
  onSave,
  draft,
  onSaveAndNext,
  onReset,
  saving,
  hasNextDoc,
  grouping,
}: ExtractionFormProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [groupingField, setGroupingField] = useState<FormField | null>(null);
  const sourcing = useSourcing();

  const scalarFields = useMemo(() => flattenScalarFields(form.fields), [form.fields]);
  const tableFieldsList = useMemo(() => form.fields.filter(isTableField), [form.fields]);

  const blocks = useMemo(() => {
    const out: Block[] = [];
    for (const field of form.fields) {
      if (isTableField(field)) {
        out.push({ kind: 'table', key: field.field_name, field });
        continue;
      }
      if (field.subform_fields && field.subform_fields.length > 0) {
        out.push({ kind: 'group', key: field.field_name, field });
        continue;
      }
      const last = out[out.length - 1];
      if (last && last.kind === 'scalars') last.fields.push(field);
      else out.push({ kind: 'scalars', key: `scalars:${field.field_name}`, fields: [field] });
    }
    return out;
  }, [form.fields]);

  const filledScalars = scalarFields.filter(f => formData[f.field_name]?.toString().trim()).length;
  // A table contributes the fraction of its cells that are answered, not a
  // whole point the moment it has one row — a 25-row table with a single filled
  // cell used to read exactly like a finished one.
  const tableProgress = tableFieldsList.reduce((sum, f) => {
    const rows: Array<Record<string, string>> = Array.isArray(formData[f.field_name])
      ? formData[f.field_name] : [];
    const cols = f.subform_fields ?? [];
    if (rows.length === 0 || cols.length === 0) return sum;
    const answered = rows.reduce(
      (n, row) => n + cols.filter(c => row?.[c.field_name]?.toString().trim()).length,
      0,
    );
    return sum + answered / (rows.length * cols.length);
  }, 0);
  const filled = filledScalars + tableProgress;
  const total = scalarFields.length + tableFieldsList.length;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  const emptyFields = scalarFields.filter(f => !formData[f.field_name]?.toString().trim());

  const toggleSection = (name: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const scrollToField = (fieldName: string) => {
    document.getElementById(`field-${fieldName}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /** Focus the next cell still owing a source, and scroll it into view. A table
   *  cell's DOM id is per-column-per-row, which is why this can't reuse
   *  scrollToField directly. */
  const goToUnsourced = (key: string) => {
    sourcing?.setActiveKey(key);
    const p = parseKey(key);
    const id = 'row' in p ? `field-${p.column}-r${p.row}` : `field-${p.field}`;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const barColor = pct >= 100 ? 'bg-green-500 dark:bg-green-400' : pct >= 50 ? 'bg-amber-500 dark:bg-amber-400' : 'bg-gray-400 dark:bg-zinc-500';
  const mk = modKey();

  const renderScalar = (field: FormField) => (
    <FieldRenderer
      key={field.field_name}
      field={field}
      value={formData[field.field_name]}
      onChange={(v) => onFieldChange(field.field_name, v)}
      isAiPrefilled={aiPrefilledKeys.has(field.field_name)}
      id={`field-${field.field_name}`}
      sourceKey={field.field_name}
    />
  );

  const renderTable = (field: FormField) => {
    const rows = Array.isArray(formData[field.field_name]) ? formData[field.field_name] : [];
    const tableProps = {
      field,
      rows,
      onChange: (next: Array<Record<string, string>>, remap?: RowRemap) =>
        onTableChange(field.field_name, next, remap),
      aiPrefill: aiPrefilledTablePrefill[field.field_name],
      errors: tableErrors[field.field_name],
      saving,
      onEditGrouping: grouping ? () => setGroupingField(field) : undefined,
    };
    // A field whose columns are all per-row is today's flat table and renders as
    // one. The grouped view appears only where the form says something is
    // shared — and both write the same flat rows.
    return isLinkedTable(field) ? <LinkedTableField {...tableProps} /> : <TableField {...tableProps} />;
  };

  const renderGroup = (field: FormField) => {
    const collapsed = collapsedSections.has(field.field_name);
    return (
      <div>
        <button
          onClick={() => toggleSection(field.field_name)}
          className="mb-3 flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left"
        >
          {collapsed
            ? <ChevronRight className="h-3.5 w-3.5 flex-none text-gray-400" />
            : <ChevronDown className="h-3.5 w-3.5 flex-none text-gray-400" />}
          <span className="flex-none text-[13px] font-bold capitalize text-gray-900 dark:text-zinc-100">
            {humanize(field.field_name)}
          </span>
          {field.field_description && (
            <span className="min-w-0 truncate text-[11px] text-gray-400 dark:text-zinc-500">
              {field.field_description}
            </span>
          )}
        </button>
        {!collapsed && (
          <AutoGrid min={250} className="pl-5">
            {(field.subform_fields ?? []).map(sub =>
              renderScalar({ ...sub, field_name: `${field.field_name}_${sub.field_name}` }))}
          </AutoGrid>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {grouping && (
        <GroupSetupDialog
          field={groupingField}
          onClose={() => setGroupingField(null)}
          saving={!!groupingField && grouping.savingField === `${form.id}:${groupingField.field_name}`}
          onSave={async (name, next) => {
            if (await grouping.onSave(form.id, name, next)) setGroupingField(null);
          }}
          onSuggest={name => grouping.onSuggest(form.id, name)}
        />
      )}
      {/* Progress — one line. It used to stack a label row, a bar, the empty
          fields and the unsourced values into four, which cost 70px of a pane
          whose whole problem is vertical room. */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 px-6 py-2.5 dark:border-[#1f1f1f]">
        <span className="flex-none text-[11px] font-semibold text-gray-500 dark:text-zinc-400">Progress</span>
        <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-[#1a1a1a]">
          <div className={cn('h-full rounded-full transition-all duration-300', barColor)} style={{ width: `${pct}%` }} />
        </div>
        <span className="flex-none text-xs font-semibold tabular-nums text-gray-800 dark:text-white">
          {Number.isInteger(filled) ? filled : filled.toFixed(1)} / {total}
        </span>

        {emptyFields.length > 0 && (
          <button
            onClick={() => scrollToField(emptyFields[0].field_name)}
            title={emptyFields.map(f => humanize(f.field_name)).join(', ')}
            className="max-w-[260px] flex-none cursor-pointer truncate border-none bg-transparent p-0 text-[11px] text-amber-600 hover:underline dark:text-amber-400"
          >
            {emptyFields.length} empty: {humanize(emptyFields[0].field_name)}
            {emptyFields.length > 1 && ` +${emptyFields.length - 1}`}
          </button>
        )}

        {/* Values the reviewer entered or changed that have no source yet. Only
            those — anything left as the AI extracted it keeps the AI's quote, so
            counting those would report work that does not exist. */}
        {sourcing && sourcing.enabled && sourcing.unsourced.length > 0 && (
          <button
            onClick={() => goToUnsourced(sourcing.unsourced[0])}
            title={sourcing.unsourced.map(describeKey).join(', ')}
            className="max-w-[260px] flex-none cursor-pointer truncate border-none bg-transparent p-0 text-[11px] text-teal-600 hover:underline dark:text-teal-400"
          >
            {sourcing.unsourced.length} need{sourcing.unsourced.length === 1 ? 's' : ''} a source:{' '}
            {describeKey(sourcing.unsourced[0])}
          </button>
        )}
      </div>

      {/* Fields */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {blocks.map((block, i) => (
          <div key={block.key}>
            {i > 0 && <Divider className="my-6" />}
            {block.kind === 'scalars' && <AutoGrid min={250}>{block.fields.map(renderScalar)}</AutoGrid>}
            {block.kind === 'table' && renderTable(block.field)}
            {block.kind === 'group' && renderGroup(block.field)}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex flex-shrink-0 gap-2 border-t border-gray-100 bg-gray-50/60 px-5 py-3 dark:border-[#1f1f1f] dark:bg-[#0a0a0a]">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border-none bg-gray-900 py-2.5 text-sm font-semibold text-white transition-all hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving…' : 'Save'}
          <span className="ml-1 text-[10px] opacity-50">{mk}+S</span>
        </button>
        {hasNextDoc && (
          <button
            onClick={onSaveAndNext}
            disabled={saving}
            className="flex-1 inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-100 py-2.5 text-sm font-semibold text-gray-900 transition-all hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white dark:hover:bg-[#222]"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save & Next'}
            <span className="ml-1 text-[10px] opacity-50">{mk}+↵</span>
          </button>
        )}
        {/* There is no "Save partial" button any more: in-progress work saves
            itself (see saveServerDraft in page.tsx). This is the receipt for
            that — a reviewer needs to know their work is somewhere, and the one
            state worth interrupting them for is the failure. */}
        {draft.state !== 'off' && (
          <div className="flex items-center px-1 text-[11px] leading-tight">
            {draft.state === 'error' ? (
              <button
                onClick={draft.onRetry}
                className="font-medium text-amber-700 underline decoration-dotted underline-offset-2 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
                title="The draft could not be saved to the server. Your local copy is intact."
              >
                Draft not saved — retry
              </button>
            ) : (
              <span className="text-gray-400 dark:text-zinc-500">
                {draft.state === 'saving'
                  ? 'Saving draft…'
                  : draft.state === 'saved' && draft.at
                    ? `Draft saved ${new Date(draft.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Saves as you type'}
              </span>
            )}
          </div>
        )}
        <button
          onClick={() => { if (window.confirm('Clear all fields? This cannot be undone.')) onReset(); }}
          title="Reset fields"
          className="cursor-pointer rounded-lg border border-gray-200 bg-gray-100 px-3 py-2.5 text-gray-500 transition-colors hover:bg-gray-200 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-400 dark:hover:bg-[#222]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

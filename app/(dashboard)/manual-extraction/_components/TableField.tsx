'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';
import { FieldRenderer } from './FieldRenderer';
import {
  AutoGrid, CountChip, FieldLabel, GhostButton, NumBadge, SectionHead, humanize,
} from './FormChrome';
import { isRequiredField, type AiTablePrefill } from '../_lib/fieldKinds';
import { tableCellKey } from '../_lib/sourcing';
import { rowsRemoved, type RowRemap } from '../_lib/rowMoves';

interface TableFieldProps {
  field: FormField;
  rows: Array<Record<string, string>>;
  onChange: (rows: Array<Record<string, string>>, remap?: RowRemap) => void;
  aiPrefill?: AiTablePrefill;
  errors?: Record<number, Set<string>>;
  saving?: boolean;
  /** Open the column-grouping setup for this field. Absent when the reviewer
   *  may not edit forms. */
  onEditGrouping?: () => void;
}

interface RowCardProps {
  /** Table field name, needed to build each cell's source key. */
  parentName: string;
  cols: FormField[];
  row: Record<string, string>;
  rowIdx: number;
  onChange: (row: Record<string, string>) => void;
  onRemove: () => void;
  initialExpanded: boolean;
  aiRowPrefilled: boolean;
  aiCells: Set<string>;
  errors?: Set<string>;
  saving?: boolean;
}

function RowCard({
  parentName, cols, row, rowIdx, onChange, onRemove,
  initialExpanded, aiRowPrefilled, aiCells, errors, saving,
}: RowCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);

  useEffect(() => {
    if (errors && errors.size > 0) setExpanded(true);
  }, [errors]);

  const filled = cols.filter(c => row[c.field_name]?.toString().trim()).length;

  const summaryParts = cols
    .map(c => row[c.field_name]?.toString().trim())
    .filter(Boolean)
    .slice(0, 2);
  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : 'New row — click to fill';

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(p => !p)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(p => !p); } }}
        className="flex cursor-pointer select-none items-center gap-2 py-1.5"
      >
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 flex-none text-gray-400" />
          : <ChevronRight className="h-3.5 w-3.5 flex-none text-gray-400" />}

        <NumBadge n={rowIdx + 1} color={aiRowPrefilled ? '#6366f1' : '#6b7280'} />

        <span className="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-zinc-400">
          {summary}
        </span>

        <CountChip filled={filled} total={cols.length} error={!!errors?.size} />

        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          disabled={saving}
          title="Remove row"
          className="flex-none rounded p-1 text-gray-300 transition-colors hover:text-red-400 disabled:opacity-40 dark:text-zinc-700 dark:hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {expanded && (
        <AutoGrid min={200} gap="gap-x-4 gap-y-3" className="pb-2 pl-7 pt-1">
          {cols.map(col => {
            const hasError = errors?.has(col.field_name);
            return (
              <div key={col.field_name} className="min-w-0">
                <FieldLabel
                  name={col.field_name}
                  tone="cell"
                  required={isRequiredField(col)}
                  field={col}
                />
                <div className={cn(hasError && 'rounded-lg ring-1 ring-red-400')}>
                  <FieldRenderer
                    field={col}
                    value={row[col.field_name] ?? ''}
                    onChange={v => onChange({ ...row, [col.field_name]: String(v ?? '') })}
                    isAiPrefilled={aiCells.has(col.field_name)}
                    id={`field-${col.field_name}-r${rowIdx}`}
                    sourceKey={tableCellKey(parentName, rowIdx, col.field_name)}
                    compact
                  />
                </div>
              </div>
            );
          })}
        </AutoGrid>
      )}
    </div>
  );
}

export function TableField({ field, rows, onChange, aiPrefill, errors, saving, onEditGrouping }: TableFieldProps) {
  const cols = field.subform_fields ?? [];
  const isAiTable = !!aiPrefill && aiPrefill.rowIndices.size > 0;

  // Stable per-row IDs so RowCard instances follow their data through add/remove.
  //
  // Grown during render on purpose: `key` is needed while rendering, and doing
  // it in an effect would paint the new row with a throwaway key first and then
  // remount it. It is idempotent — the length drives it, so a double render
  // (StrictMode) reaches the same array.
  const idsRef = useRef<string[]>([]);
  while (idsRef.current.length < rows.length) {
    idsRef.current.push(Math.random().toString(36).slice(2));
  }
  if (idsRef.current.length > rows.length) {
    idsRef.current.length = rows.length;
  }

  const [newRowIndices, setNewRowIndices] = useState<Set<number>>(new Set());

  const addRow = () => {
    const newIdx = rows.length;
    idsRef.current = [...idsRef.current, Math.random().toString(36).slice(2)];
    setNewRowIndices(prev => new Set([...prev, newIdx]));
    const emptyRow: Record<string, string> = {};
    cols.forEach(col => { emptyRow[col.field_name] = ''; });
    onChange([...rows, emptyRow]);
  };

  const removeRow = (idx: number) => {
    if (!window.confirm('Remove this row?')) return;
    idsRef.current = idsRef.current.filter((_, i) => i !== idx);
    setNewRowIndices(prev => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      }
      return next;
    });
    // Every row below this one moves up, and four row-keyed maps have to move
    // with it — see _lib/rowMoves.
    onChange(rows.filter((_, i) => i !== idx), rowsRemoved([idx]));
  };

  const updateRow = (idx: number, updated: Record<string, string>) => {
    onChange(rows.map((r, i) => i === idx ? updated : r));
  };

  return (
    <div>
      <SectionHead
        title={humanize(field.field_name)}
        note={[
          `${rows.length} row${rows.length === 1 ? '' : 's'}`,
          isAiTable ? 'AI-prefilled' : '',
          field.field_description ?? '',
        ].filter(Boolean).join(' · ')}
        action={
          <span className="inline-flex items-center gap-1.5">
            {onEditGrouping && (
              <GhostButton
                onClick={onEditGrouping}
                title="Say which of these columns repeat, so a shared value is entered once"
              >
                Grouping
              </GhostButton>
            )}
            <GhostButton onClick={addRow} disabled={saving}>
              <Plus className="h-3 w-3" /> Add row
            </GhostButton>
          </span>
        }
      />

      {rows.length === 0 ? (
        <p className="py-2 text-[12px] text-gray-400 dark:text-zinc-600">
          No rows yet — <span className="font-semibold">Add row</span> to begin.
        </p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-[#1a1a1a]">
          {rows.map((row, rowIdx) => (
            <RowCard
              key={idsRef.current[rowIdx]}
              parentName={field.field_name}
              cols={cols}
              row={row}
              rowIdx={rowIdx}
              onChange={updated => updateRow(rowIdx, updated)}
              onRemove={() => removeRow(rowIdx)}
              initialExpanded={newRowIndices.has(rowIdx)}
              aiRowPrefilled={!!aiPrefill?.rowIndices.has(rowIdx)}
              aiCells={aiPrefill?.cells[rowIdx] ?? new Set()}
              errors={errors?.[rowIdx]}
              saving={saving}
            />
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <button
          onClick={addRow}
          disabled={saving}
          className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 py-2 text-[11px] text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-500 disabled:opacity-40 dark:border-[#2a2a2a] dark:text-zinc-600 dark:hover:border-[#3a3a3a] dark:hover:text-zinc-500"
        >
          <Plus className="h-3 w-3" /> Add another row
        </button>
      )}
    </div>
  );
}

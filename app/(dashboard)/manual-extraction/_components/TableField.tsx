'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';
import { FieldRenderer } from './FieldRenderer';
import type { AiTablePrefill } from '../_lib/fieldKinds';

interface TableFieldProps {
  field: FormField;
  rows: Array<Record<string, string>>;
  onChange: (rows: Array<Record<string, string>>) => void;
  aiPrefill?: AiTablePrefill;
  errors?: Record<number, Set<string>>;
  saving?: boolean;
}

interface RowCardProps {
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
  cols, row, rowIdx, onChange, onRemove,
  initialExpanded, aiRowPrefilled, aiCells, errors, saving,
}: RowCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);

  useEffect(() => {
    if (errors && errors.size > 0) setExpanded(true);
  }, [errors]);

  const filled = cols.filter(c => row[c.field_name]?.toString().trim()).length;
  const total = cols.length;
  const pct = total > 0 ? filled / total : 0;

  const chipColor = pct >= 1
    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
    : pct >= 0.5
    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
    : 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-500 dark:text-zinc-500';

  const summaryParts = cols
    .map(c => row[c.field_name]?.toString().trim())
    .filter(Boolean)
    .slice(0, 2);
  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : 'New row — click to fill';
  const hasAnyFill = filled > 0;

  return (
    <div className={cn(
      'rounded-lg border overflow-hidden bg-white dark:bg-[#111111]',
      aiRowPrefilled
        ? 'border-l-[3px] border-l-indigo-400 dark:border-l-indigo-500 border-t border-r border-b border-gray-100 dark:border-[#1f1f1f]'
        : 'border-gray-100 dark:border-[#1f1f1f]',
    )}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(p => !p)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(p => !p); } }}
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#0d0d0d] transition-colors select-none"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}

        <span className={cn(
          'text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 tabular-nums',
          hasAnyFill
            ? 'bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-zinc-200'
            : 'text-gray-300 dark:text-zinc-700',
        )}>
          {rowIdx + 1}
        </span>

        <span className="flex-1 text-xs text-gray-600 dark:text-zinc-400 truncate min-w-0">
          {summary}
        </span>

        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums flex-shrink-0', chipColor)}>
          {filled}/{total}
        </span>

        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          disabled={saving}
          title="Remove row"
          className="p-1 text-gray-300 dark:text-zinc-700 hover:text-red-400 dark:hover:text-red-400 transition-colors rounded disabled:opacity-40 flex-shrink-0"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-[#1f1f1f] px-3 pt-3 pb-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            {cols.map((col, colIdx) => {
              const fullWidth = colIdx === cols.length - 1 && cols.length % 2 !== 0;
              const hasError = errors?.has(col.field_name);
              const aiCell = aiCells.has(col.field_name);
              return (
                <div key={col.field_name} className={cn(fullWidth && 'col-span-2')}>
                  <p className="text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-1 leading-none">
                    {col.field_name.replace(/_/g, ' ')}
                    {col.required !== false && <span className="text-red-400 ml-0.5">*</span>}
                  </p>
                  <div className={cn(hasError && 'ring-1 ring-red-400 rounded-lg')}>
                    <FieldRenderer
                      field={col}
                      value={row[col.field_name] ?? ''}
                      onChange={v => onChange({ ...row, [col.field_name]: String(v ?? '') })}
                      index={colIdx + 1}
                      isAiPrefilled={aiCell}
                      id={`field-${col.field_name}-r${rowIdx}`}
                      compact
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function TableField({ field, rows, onChange, aiPrefill, errors, saving }: TableFieldProps) {
  const cols = field.subform_fields ?? [];
  const isAiTable = !!aiPrefill && aiPrefill.rowIndices.size > 0;

  // Stable per-row IDs so RowCard instances follow their data through add/remove
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
    onChange(rows.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, updated: Record<string, string>) => {
    onChange(rows.map((r, i) => i === idx ? updated : r));
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50/60 dark:bg-[#0a0a0a] border-b border-gray-100 dark:border-[#1f1f1f]">
        <div>
          <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300 capitalize">
            {field.field_name.replace(/_/g, ' ')}
            {isAiTable && (
              <span className="ml-1.5 text-[10px] font-medium text-blue-500 dark:text-blue-400">(AI)</span>
            )}
            <span className="ml-2 text-[10px] font-normal text-gray-400 dark:text-zinc-600">
              {rows.length} row{rows.length !== 1 ? 's' : ''}
            </span>
          </p>
          {field.field_description && (
            <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">{field.field_description}</p>
          )}
        </div>
        <button
          onClick={addRow}
          disabled={saving}
          className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-1.5 hover:bg-gray-200 dark:hover:bg-[#222] transition-colors cursor-pointer disabled:opacity-40"
        >
          <Plus className="w-3 h-3" /> Add row
        </button>
      </div>

      {/* Row cards */}
      <div className="px-3 py-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-center text-[12px] text-gray-400 dark:text-zinc-600 py-4">
            No rows yet — click <span className="font-semibold">Add row</span> to begin
          </p>
        ) : (
          rows.map((row, rowIdx) => (
            <RowCard
              key={idsRef.current[rowIdx]}
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
          ))
        )}
      </div>

      {rows.length > 0 && (
        <div className="px-3 pb-3">
          <button
            onClick={addRow}
            disabled={saving}
            className="w-full border border-dashed border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2 text-[11px] text-gray-400 dark:text-zinc-600 hover:border-gray-300 dark:hover:border-[#3a3a3a] hover:text-gray-500 dark:hover:text-zinc-500 transition-colors cursor-pointer disabled:opacity-40 flex items-center justify-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add another row
          </button>
        </div>
      )}
    </div>
  );
}

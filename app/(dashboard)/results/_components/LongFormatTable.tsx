'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';
import { transformToLongFormat, type LongFormatRow } from '@/lib/longFormatTransform';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatColumnName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LongFormatTableProps {
  results: Array<{ id: string; document_id: string; extracted_data: Record<string, any>; created_at?: string }>;
  documentsMap: Record<string, { id: string; filename: string }>;
  formFields: FormField[];
}

export default function LongFormatTable({ results, documentsMap, formFields }: LongFormatTableProps) {
  const { columns, rows } = useMemo(
    () => transformToLongFormat(results, formFields, documentsMap),
    [results, formFields, documentsMap]
  );

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400 dark:text-zinc-600 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl">
        No data to display.
      </div>
    );
  }

  // Detect paper boundaries for visual grouping
  const paperBoundaries = new Set<number>();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]._documentId !== rows[i - 1]._documentId) {
      paperBoundaries.add(i);
    }
  }

  const isMissing = (val: string) => !val || val === 'NR' || val === 'N/A' || val === '—' || val === '';

  return (
    <>
      {/* Stats */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-3 text-[10px] font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
          <span>{rows.length} rows</span>
          <span className="text-gray-300 dark:text-zinc-700">|</span>
          <span>{new Set(rows.map(r => r._documentId)).size} papers</span>
          <span className="text-gray-300 dark:text-zinc-700">|</span>
          <span>{columns.length - 1} fields</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider ml-auto">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-200 dark:bg-green-700 inline-block" />Reported</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-200 dark:bg-rose-700 inline-block" />Not reported</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-zinc-800/50">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              {columns.map((col, ci) => (
                <th
                  key={col}
                  className={cn(
                    'sticky top-0 z-20 bg-gray-50 dark:bg-[#0d0d0d] px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 border-b-2 border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 whitespace-nowrap',
                    ci === 0 && 'sticky left-0 z-40 min-w-[180px]',
                    ci > 0 && 'min-w-[120px]'
                  )}
                >
                  {formatColumnName(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isNewPaper = paperBoundaries.has(ri);
              return (
                <tr key={`${row._resultId}-${ri}`}>
                  {columns.map((col, ci) => {
                    const val = row[col] ?? '';
                    const missing = isMissing(val);
                    const isFirstCol = ci === 0;

                    return (
                      <td
                        key={col}
                        className={cn(
                          'px-3 py-2.5 border-b border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 align-top',
                          isFirstCol && 'sticky left-0 z-10 bg-white dark:bg-[#111111] font-semibold text-gray-900 dark:text-white',
                          !isFirstCol && (missing ? 'bg-rose-50 dark:bg-[#1a0d0d]' : 'bg-green-50 dark:bg-[#0d1a10]'),
                          isNewPaper && 'border-t-2 border-t-gray-300 dark:border-t-zinc-600'
                        )}
                      >
                        {missing ? (
                          <span className="font-medium text-gray-400 dark:text-zinc-600">NR</span>
                        ) : (
                          <span className="text-gray-700 dark:text-zinc-300">{val}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

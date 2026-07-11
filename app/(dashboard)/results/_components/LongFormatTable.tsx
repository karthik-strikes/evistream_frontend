'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';
import { transformToLongFormat } from '@/lib/longFormatTransform';
import { Tooltip } from '@/components/ui/tooltip';
import { Quote, ScanText, Info } from 'lucide-react';
import { SourceEvidenceDrawer } from '@/components/source-evidence/SourceEvidenceDrawer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatColumnName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getSourceText(data: any): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (typeof data.source_text === 'string' && data.source_text.trim() && data.source_text !== 'NR') {
    return data.source_text;
  }
  return null;
}

function getPageRef(data: any): number | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (typeof data.page === 'number') return data.page;
  const loc = data.source_location;
  if (loc && typeof loc === 'object' && loc.page) return Number(loc.page);
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LongFormatTableProps {
  results: Array<{ id: string; document_id: string; extracted_data: Record<string, any>; created_at?: string }>;
  documentsMap: Record<string, { id: string; filename: string }>;
  formFields: FormField[];
}

interface ChipRef {
  ri: number;
  col: string;
}

export default function LongFormatTable({ results, documentsMap, formFields }: LongFormatTableProps) {
  const { columns, rows } = useMemo(
    () => transformToLongFormat(results, formFields, documentsMap),
    [results, formFields, documentsMap]
  );

  const [showEvidence, setShowEvidence] = useState(false);
  const [active, setActive] = useState<ChipRef | null>(null);

  // Flat lookup map: field_name → FormField (includes subform fields)
  const fieldMap = useMemo(() => {
    const map: Record<string, FormField> = {};
    for (const f of formFields) {
      map[f.field_name] = f;
      for (const sf of (f.subform_fields ?? [])) {
        map[sf.field_name] = sf;
      }
    }
    return map;
  }, [formFields]);

  // Map resultId → extracted_data for top-level source_text lookup (fallback only).
  const resultDataMap = useMemo(() => {
    const map: Record<string, Record<string, any>> = {};
    for (const r of results) {
      map[r.id] = r.extracted_data ?? {};
    }
    return map;
  }, [results]);

  // Ordered list of every cell carrying a source_text. Reading order: row by
  // row, left to right. Drives prev/next navigation inside the drawer.
  const chipOrder = useMemo<ChipRef[]>(() => {
    const list: ChipRef[] = [];
    rows.forEach((row, ri) => {
      columns.forEach((col, ci) => {
        if (ci === 0) return; // Paper column
        const raw = row._rawCells?.[col] ?? resultDataMap[row._resultId]?.[col];
        if (getSourceText(raw)) list.push({ ri, col });
      });
    });
    return list;
  }, [rows, columns, resultDataMap]);

  // Resolve the currently active chip into drawer-shaped props.
  const activeData = useMemo(() => {
    if (!active) return null;
    const row = rows[active.ri];
    if (!row) return null;
    const raw = row._rawCells?.[active.col] ?? resultDataMap[row._resultId]?.[active.col];
    const sourceText = getSourceText(raw);
    if (!sourceText) return null;
    const doc = documentsMap[row._documentId];
    // Display value the cell shows — used in the "Derived value" callout
    // when the source quote can't be located verbatim in the PDF.
    const displayVal = row[active.col];
    const storedValue =
      displayVal === null || displayVal === undefined ? null : String(displayVal);
    return {
      sourceText,
      storedValue,
      page: getPageRef(raw),
      documentId: row._documentId,
      documentFilename: doc?.filename ?? row._paperFilename,
      fieldLabel: formatColumnName(active.col),
    };
  }, [active, rows, resultDataMap, documentsMap]);

  // Prev/next indices into chipOrder for the active chip.
  const activeIndex = useMemo(() => {
    if (!active) return -1;
    return chipOrder.findIndex(c => c.ri === active.ri && c.col === active.col);
  }, [active, chipOrder]);

  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < chipOrder.length - 1;
  const goPrev = () => hasPrev && setActive(chipOrder[activeIndex - 1]);
  const goNext = () => hasNext && setActive(chipOrder[activeIndex + 1]);

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
      <div className="flex items-center gap-3 mb-2 flex-wrap">
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
          {showEvidence && (
            <span className="flex items-center gap-1.5"><Quote className="w-2.5 h-2.5 text-green-500" />Has source — click to view</span>
          )}
        </div>
        {/* Show Sources toggle */}
        <button
          onClick={() => { setShowEvidence(v => !v); setActive(null); }}
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all',
            showEvidence
              ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400'
              : 'bg-white dark:bg-[#111111] border-gray-200 dark:border-[#1f1f1f] text-gray-500 dark:text-zinc-400 hover:border-gray-300 dark:hover:border-[#2a2a2a]'
          )}
        >
          <ScanText className="w-3.5 h-3.5" />
          {showEvidence ? 'Hide Sources' : 'Show Sources'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-zinc-800/50">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              {columns.map((col, ci) => {
                const field = fieldMap[col];
                const tooltipContent = field ? (
                  <div className="space-y-1.5">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 dark:bg-[#2a2a2a] text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] uppercase tracking-wider">
                      {field.field_type}
                    </span>
                    {field.field_description && (
                      <p className="text-xs leading-snug">{field.field_description}</p>
                    )}
                    {field.options && field.options.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-0.5">Options</p>
                        <ul className="text-xs space-y-0.5">
                          {field.options.slice(0, 6).map(o => (
                            <li key={o} className="text-gray-600 dark:text-zinc-400">• {o}</li>
                          ))}
                          {field.options.length > 6 && (
                            <li className="text-gray-400 dark:text-zinc-600">+{field.options.length - 6} more</li>
                          )}
                        </ul>
                      </div>
                    )}
                    {field.extraction_hints && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-0.5">Hint</p>
                        <p className="text-xs text-gray-600 dark:text-zinc-400 leading-snug">{field.extraction_hints}</p>
                      </div>
                    )}
                  </div>
                ) : null;

                return (
                  <th
                    key={col}
                    className={cn(
                      'sticky top-0 z-20 bg-gray-50 dark:bg-[#0d0d0d] px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 border-b-2 border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 whitespace-nowrap',
                      ci === 0 && 'sticky left-0 z-40 min-w-[180px]',
                      ci > 0 && 'min-w-[120px]'
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {formatColumnName(col)}
                      {tooltipContent && (
                        <Tooltip content={tooltipContent} side="bottom" className="rounded-xl shadow-xl border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a] text-gray-700 dark:text-zinc-300 text-[11px] p-3.5 w-72 whitespace-normal text-left font-normal leading-relaxed">
                          <Info className="w-3 h-3 text-blue-400 dark:text-blue-500 flex-shrink-0 cursor-default" />
                        </Tooltip>
                      )}
                    </span>
                  </th>
                );
              })}
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

                    const rawData = !isFirstCol
                      ? (row._rawCells?.[col] ?? resultDataMap[row._resultId]?.[col])
                      : null;
                    const sourceText = showEvidence ? getSourceText(rawData) : null;
                    const isActive = !!active && active.ri === ri && active.col === col;

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
                        ) : sourceText ? (
                          <div className="flex items-start gap-1.5">
                            <span className="text-gray-700 dark:text-zinc-300">{val}</span>
                            <button
                              type="button"
                              onClick={() => setActive({ ri, col })}
                              title="View source passage"
                              aria-pressed={isActive}
                              className={cn(
                                'flex-none inline-flex items-center justify-center p-0.5 rounded transition-all',
                                isActive
                                  ? 'bg-green-500 text-white shadow-[0_0_0_3px_rgba(16,128,106,0.18)] dark:bg-green-400 dark:text-[#0a0a0a]'
                                  : 'text-green-500 hover:bg-green-50 hover:-translate-y-px dark:text-green-400 dark:hover:bg-green-900/30',
                              )}
                            >
                              <Quote className="w-3 h-3" />
                            </button>
                          </div>
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

      <SourceEvidenceDrawer
        open={!!active && !!activeData}
        onClose={() => setActive(null)}
        documentId={activeData?.documentId ?? null}
        documentFilename={activeData?.documentFilename ?? null}
        sourceText={activeData?.sourceText ?? null}
        storedValue={activeData?.storedValue ?? null}
        fieldLabel={activeData?.fieldLabel}
        page={activeData?.page ?? null}
        onPrev={goPrev}
        onNext={goNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />
    </>
  );
}

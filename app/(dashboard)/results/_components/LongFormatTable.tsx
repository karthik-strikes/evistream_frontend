'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';
import { transformToLongFormat, type LongFormatRow } from '@/lib/longFormatTransform';
import { Tooltip } from '@/components/ui/tooltip';
import { Quote, ScanText } from 'lucide-react';

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
  const loc = data.source_location;
  if (loc && typeof loc === 'object' && loc.page) return Number(loc.page);
  return null;
}

function getSection(data: any): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const loc = data.source_location;
  return (loc && typeof loc === 'object' && typeof loc.section === 'string') ? loc.section : null;
}

function EvidencePopover({ sourceText, pageRef, section, popoverKey, openKey, setOpenKey }: {
  sourceText: string;
  pageRef: number | null;
  section: string | null;
  popoverKey: string;
  openKey: string | null;
  setOpenKey: (k: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isOpen = openKey === popoverKey;

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenKey(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, setOpenKey]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpenKey(isOpen ? null : popoverKey); }}
        className="p-0.5 text-green-500 hover:text-green-700 dark:text-green-400 dark:hover:text-green-200 transition-colors rounded"
        title="View source evidence"
      >
        <Quote className="w-3 h-3" />
      </button>
      {isOpen && (
        <div className="absolute z-50 w-80 p-3 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-xl shadow-xl top-5 left-0">
          <div className="flex items-center justify-between mb-1.5">
            <p className="font-semibold text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">
              Source passage{section ? <span className="normal-case ml-1 text-blue-400 dark:text-blue-500">· {section}</span> : null}
            </p>
            {pageRef && (
              <span className="text-[10px] font-medium text-blue-500 dark:text-blue-400">p.{pageRef}</span>
            )}
          </div>
          <p className="text-xs text-gray-600 dark:text-zinc-300 leading-relaxed italic">&ldquo;{sourceText}&rdquo;</p>
        </div>
      )}
    </div>
  );
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

  const [showEvidence, setShowEvidence] = useState(false);
  const [openPopoverKey, setOpenPopoverKey] = useState<string | null>(null);

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

  // Map resultId → extracted_data for source_text lookup
  const resultDataMap = useMemo(() => {
    const map: Record<string, Record<string, any>> = {};
    for (const r of results) {
      map[r.id] = r.extracted_data ?? {};
    }
    return map;
  }, [results]);

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
            <span className="flex items-center gap-1.5"><Quote className="w-2.5 h-2.5 text-green-500" />Has source</span>
          )}
        </div>
        {/* Show Sources toggle */}
        <button
          onClick={() => { setShowEvidence(v => !v); setOpenPopoverKey(null); }}
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
                  <div className="space-y-1.5 max-w-xs">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white/10 uppercase tracking-wider">
                      {field.field_type}
                    </span>
                    {field.field_description && (
                      <p className="text-xs leading-snug">{field.field_description}</p>
                    )}
                    {field.options && field.options.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-0.5">Options</p>
                        <ul className="text-xs space-y-0.5">
                          {field.options.slice(0, 6).map(o => (
                            <li key={o} className="opacity-80">• {o}</li>
                          ))}
                          {field.options.length > 6 && (
                            <li className="opacity-50">+{field.options.length - 6} more</li>
                          )}
                        </ul>
                      </div>
                    )}
                    {field.extraction_hints && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-0.5">Hint</p>
                        <p className="text-xs opacity-80 leading-snug">{field.extraction_hints}</p>
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
                    {tooltipContent ? (
                      <Tooltip content={tooltipContent} side="bottom" className="whitespace-normal text-left font-normal shadow-xl">
                        <span className="cursor-help underline decoration-dotted decoration-gray-400 dark:decoration-zinc-600 underline-offset-2">
                          {formatColumnName(col)}
                        </span>
                      </Tooltip>
                    ) : (
                      formatColumnName(col)
                    )}
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

                    const rawData = !isFirstCol ? resultDataMap[row._resultId]?.[col] : null;
                    const sourceText = showEvidence ? getSourceText(rawData) : null;
                    const pageRef = showEvidence ? getPageRef(rawData) : null;
                    const section = showEvidence ? getSection(rawData) : null;
                    const cellPopoverKey = `${ri}:${col}`;

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
                          <div className="flex items-start gap-1">
                            <span className="text-gray-700 dark:text-zinc-300">{val}</span>
                            <EvidencePopover
                              sourceText={sourceText}
                              pageRef={pageRef}
                              section={section}
                              popoverKey={cellPopoverKey}
                              openKey={openPopoverKey}
                              setOpenKey={setOpenPopoverKey}
                            />
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
    </>
  );
}

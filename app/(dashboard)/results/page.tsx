'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { resultsService, extractionsService, documentsService, formsService, jobsService } from '@/services';
import { ExtractionResult, Extraction, Document } from '@/types/api';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Spinner, EmptyState, Progress, Tooltip } from '@/components/ui';
import {
  Download, AlertCircle, FileText, Table as TableIcon,
  Search, ChevronDown, ChevronUp, ArrowUpDown, X,
  BarChart2, MapPin, ChevronsUpDown,
} from 'lucide-react';
import { PdfSourceViewer } from '@/components/PdfSourceViewer';
import { useSourceLinking } from '@/hooks/useSourceLinking';
import type { SourceLocation } from '@/types/api';
import { cn, formatDate, getErrorMessage } from '@/lib/utils';
import { DynamicDataRenderer } from '@/components/DynamicDataRenderer';
import { FinalDatasetView } from './_components/FinalDatasetView';
import LongFormatTable from './_components/LongFormatTable';
import { transformToLongFormat, toCSV, toJSON } from '@/lib/longFormatTransform';

type SortKey = 'doc_name_asc' | 'doc_name_desc' | 'date_newest' | 'date_oldest' | 'completeness_high' | 'completeness_low';

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractScalarValue(data: any): string {
  if (data === null || data === undefined) return '—';
  if (typeof data === 'string') return data.trim() || '—';
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (typeof data === 'object' && !Array.isArray(data) && 'value' in data) {
    const v = data.value;
    if (v === null || v === undefined || String(v).trim() === '') return '—';
    const s = String(v);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  }
  if (Array.isArray(data)) return data.length === 0 ? '—' : `[${data.length} items]`;
  const j = JSON.stringify(data);
  return j.length > 120 ? j.slice(0, 120) + '…' : j;
}

function hasSourceText(data: any): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    typeof data.source_text === 'string' &&
    data.source_text.trim() !== '' &&
    data.source_text !== 'NR'
  );
}

const formatFieldName = (f: string) =>
  f.replace(/_/g, ' ').replace(/\./g, ' ')
    .split(' ')
    .filter(w => w.toLowerCase() !== 'value')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

// ── StatPill ──────────────────────────────────────────────────────────────────

function StatPill({
  icon,
  label,
  value,
  valueColor = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  valueColor?: 'default' | 'green' | 'amber' | 'red';
}) {
  return (
    <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5">
      <span className="text-gray-400 dark:text-zinc-600">{icon}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">{label}</span>
      <span className={cn(
        'text-sm font-bold',
        valueColor === 'green' && 'text-green-500 dark:text-green-400',
        valueColor === 'amber' && 'text-amber-500 dark:text-amber-400',
        valueColor === 'red' && 'text-red-500 dark:text-red-400',
        valueColor === 'default' && 'text-gray-900 dark:text-white',
      )}>{value}</span>
    </div>
  );
}

// ── ExtractionStatsBar ────────────────────────────────────────────────────────

function ExtractionStatsBar({
  results,
  allFieldNames,
  getCompleteness,
}: {
  results: ExtractionResult[];
  allFieldNames: string[];
  getCompleteness: (r: ExtractionResult) => { filled: number; total: number; pct: number };
}) {
  const avgCompleteness = results.length
    ? Math.round(results.reduce((s, r) => s + getCompleteness(r).pct, 0) / results.length)
    : 0;
  const fullyCoveredFields = allFieldNames.filter(f =>
    results.every(r => {
      const v = extractScalarValue(r.extracted_data[f]);
      return v && v !== '—' && v !== 'N/A';
    })
  ).length;
  const completenessColor: 'green' | 'amber' | 'red' =
    avgCompleteness >= 80 ? 'green' : avgCompleteness >= 50 ? 'amber' : 'red';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <StatPill
        icon={<FileText className="w-3.5 h-3.5" />}
        label="Documents"
        value={results.length}
      />
      <StatPill
        icon={<BarChart2 className="w-3.5 h-3.5" />}
        label="Avg. Completeness"
        value={`${avgCompleteness}%`}
        valueColor={completenessColor}
      />
      <StatPill
        icon={<BarChart2 className="w-3.5 h-3.5" />}
        label="Fields at 100%"
        value={`${fullyCoveredFields} / ${allFieldNames.length}`}
      />
    </div>
  );
}

// ── ViewControlsBar ───────────────────────────────────────────────────────────

function ViewControlsBar({
  activeView,
  setActiveView,
  searchQuery,
  setSearchQuery,
  sortKey,
  setSortKey,
  results,
  allFieldNames,
  getCompleteness,
}: {
  activeView: 'table' | 'compare';
  setActiveView: (v: 'table' | 'compare') => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  sortKey: SortKey;
  setSortKey: (v: SortKey) => void;
  results: ExtractionResult[];
  allFieldNames: string[];
  getCompleteness: (r: ExtractionResult) => { filled: number; total: number; pct: number };
}) {
  const avgCompleteness = results.length
    ? Math.round(results.reduce((s, r) => s + getCompleteness(r).pct, 0) / results.length)
    : 0;
  const fullyCoveredFields = allFieldNames.filter(f =>
    results.every(r => {
      const v = extractScalarValue(r.extracted_data[f]);
      return v && v !== '—' && v !== 'N/A';
    })
  ).length;

  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] min-w-[180px]">
        <Search className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-600 flex-shrink-0" />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={activeView === 'table' ? 'Search fields…' : 'Search fields…'}
          className="text-sm text-gray-700 dark:text-zinc-300 bg-transparent border-none outline-none w-full placeholder:text-gray-300 dark:placeholder:text-zinc-600"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="flex-shrink-0">
            <X className="w-3 h-3 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300" />
          </button>
        )}
      </div>

      {/* Inline stats */}
      <span className="text-[11px] text-gray-400 dark:text-zinc-500">
        {results.length} docs · {avgCompleteness}% complete · {fullyCoveredFields}/{allFieldNames.length} fields
      </span>

      {/* Sort (only in table view) */}
      {activeView === 'table' && (
        <div className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]">
          <ArrowUpDown className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500 flex-shrink-0" />
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="text-sm text-gray-700 dark:text-zinc-300 bg-transparent border-none outline-none cursor-pointer dark:[color-scheme:dark] appearance-none pr-4"
          >
            <option value="date_newest">Date (newest)</option>
            <option value="date_oldest">Date (oldest)</option>
            <option value="doc_name_asc">Document A → Z</option>
            <option value="doc_name_desc">Document Z → A</option>
            <option value="completeness_high">Completeness (high)</option>
            <option value="completeness_low">Completeness (low)</option>
          </select>
          <ChevronDown className="w-3 h-3 text-gray-400 dark:text-zinc-500 pointer-events-none flex-shrink-0" />
        </div>
      )}

      <div className="flex-1" />

      {/* View toggle */}
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg p-0.5">
        {([
          { key: 'table' as const, icon: <TableIcon className="w-3.5 h-3.5" />, label: 'Evidence' },
          { key: 'compare' as const, icon: <BarChart2 className="w-3.5 h-3.5" />, label: 'Compare' },
        ]).map(v => (
          <button
            key={v.key}
            onClick={() => setActiveView(v.key)}
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-all',
              activeView === v.key
                ? 'bg-white dark:bg-[#111111] text-gray-900 dark:text-white shadow-sm border border-gray-200 dark:border-[#2a2a2a]'
                : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300'
            )}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── EvidenceTableView ─────────────────────────────────────────────────────────

function EvidenceTableView({
  results,
  documentsMap,
  allFieldNames,
  getCompleteness,
  onSourceClick,
}: {
  results: ExtractionResult[];
  documentsMap: Record<string, Document>;
  allFieldNames: string[];
  getCompleteness: (r: ExtractionResult) => { filled: number; total: number; pct: number };
  failedDocIds: string[];
  onSourceClick?: (resultId: string, documentId: string, fieldName: string, location: SourceLocation) => void;
}) {
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());

  const toggleCell = (key: string) => {
    setExpandedCells(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    const keys = new Set<string>();
    results.forEach(r =>
      allFieldNames.forEach(f => {
        const scalar = extractScalarValue(r.extracted_data[f]);
        if (scalar && scalar !== '—' && scalar !== 'N/A') keys.add(`${r.id}:${f}`);
      })
    );
    setExpandedCells(keys);
  };

  const collapseAll = () => setExpandedCells(new Set());

  const cellStatus = (val: any): 'reported' | 'missing' => {
    const scalar = extractScalarValue(val);
    return (!scalar || scalar === '—' || scalar === 'N/A') ? 'missing' : 'reported';
  };

  const cellBg = (status: 'reported' | 'missing') =>
    status === 'reported' ? 'bg-green-50 dark:bg-[#0d1a10]' : 'bg-rose-50 dark:bg-[#1a0d0d]';

  if (results.length === 0 || allFieldNames.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400 dark:text-zinc-600 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl">
        No data to display.
      </div>
    );
  }

  const hasExpanded = expandedCells.size > 0;

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-2">
          <button
            onClick={hasExpanded ? collapseAll : expandAll}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
            {hasExpanded ? 'Collapse All' : 'Expand All'}
          </button>
          {/* Legend */}
          <div className="flex items-center gap-3 text-[10px] font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-200 dark:bg-green-700 inline-block" />Reported</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-200 dark:bg-rose-700 inline-block" />Not reported</span>
          </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-zinc-800/50">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-40 bg-gray-50 dark:bg-[#0d0d0d] px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-zinc-500 border-b-2 border-r border-gray-200 dark:border-zinc-800/60 min-w-[200px]">
                Study
              </th>
              {allFieldNames.map(f => (
                <th key={f} className="sticky top-0 z-20 bg-gray-50 dark:bg-[#0d0d0d] px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 border-b-2 border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 min-w-[160px]">
                  {formatFieldName(f)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const doc = documentsMap[r.document_id];
              const rowHasExpanded = allFieldNames.some(f => expandedCells.has(`${r.id}:${f}`));
              return (
                <tr key={r.id}>
                  <td className={cn(
                    'sticky left-0 z-10 px-4 py-3 border-b border-r border-gray-200 dark:border-zinc-800/60 align-top transition-colors',
                    rowHasExpanded ? 'bg-violet-50 dark:bg-[#110d1a]' : 'bg-white dark:bg-[#111111]'
                  )}>
                    <div className="text-xs font-semibold text-gray-900 dark:text-white leading-snug truncate max-w-[180px]" title={doc?.filename}>
                      {doc?.filename || '—'}
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-zinc-600 mt-0.5">{formatDate(r.created_at)}</div>
                  </td>
                  {allFieldNames.map(f => {
                    const key = `${r.id}:${f}`;
                    const val = r.extracted_data[f];
                    const status = cellStatus(val);
                    const isExpanded = expandedCells.has(key);
                    const canExpand = status !== 'missing';
                    return (
                      <td
                        key={f}
                        onClick={() => canExpand && toggleCell(key)}
                        className={cn(
                          'px-3 py-3 border-b border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 align-top min-w-[160px] transition-colors',
                          cellBg(status),
                          canExpand && 'cursor-pointer'
                        )}
                      >
                        {status === 'missing' ? (
                          <span className="font-medium text-gray-400 dark:text-zinc-600">NR</span>
                        ) : isExpanded ? (
                          <div>
                            <DynamicDataRenderer
                              data={val}
                              fieldName={f}
                              onSourceClick={onSourceClick
                                ? (fieldName, loc) => onSourceClick(r.id, r.document_id, fieldName, loc)
                                : undefined
                              }
                            />
                            {hasSourceText(val) && !val.source_location && (
                              <blockquote className="mt-1.5 pl-2 border-l-2 border-green-300 dark:border-green-700 text-[11px] text-gray-500 dark:text-zinc-400 italic leading-relaxed">
                                {val.source_text}
                              </blockquote>
                            )}
                          </div>
                        ) : (
                          <p className="text-gray-700 dark:text-zinc-300 line-clamp-2">{extractScalarValue(val)}</p>
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

// ── FieldComparisonView ───────────────────────────────────────────────────────

type PageSize = 5 | 10 | 20 | 50 | 'all';

const PAGE_SIZE_OPTIONS: PageSize[] = [5, 10, 20, 50, 'all'];
const DRUM_H = 24; // px per drum item

function PageSizePicker({ value, onChange }: { value: PageSize; onChange: (v: PageSize) => void }) {
  const idx = PAGE_SIZE_OPTIONS.indexOf(value);
  const go = (dir: 1 | -1) => {
    const next = Math.max(0, Math.min(PAGE_SIZE_OPTIONS.length - 1, idx + dir));
    onChange(PAGE_SIZE_OPTIONS[next]);
  };
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    go(e.deltaY > 0 ? 1 : -1);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
        Per page
      </span>
      <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-zinc-800/70 rounded-full px-1 py-[3px]">
        <button
          onClick={() => go(-1)}
          disabled={idx === 0}
          className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 dark:text-zinc-500 disabled:opacity-25 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors"
        >
          <ChevronUp className="w-3 h-3" />
        </button>

        {/* Drum window */}
        <div
          className="relative w-8 overflow-hidden select-none cursor-ns-resize"
          style={{ height: DRUM_H }}
          onWheel={handleWheel}
        >
          {/* Fade masks */}
          <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-gray-100 dark:from-zinc-800 to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-2 bg-gradient-to-t from-gray-100 dark:from-zinc-800 to-transparent z-10 pointer-events-none" />
          {/* Sliding strip */}
          <div
            className="flex flex-col transition-transform duration-200 ease-out"
            style={{ transform: `translateY(-${idx * DRUM_H}px)` }}
          >
            {PAGE_SIZE_OPTIONS.map(n => (
              <div
                key={String(n)}
                className="flex items-center justify-center text-[11px] font-bold text-gray-900 dark:text-white tabular-nums"
                style={{ height: DRUM_H }}
              >
                {n === 'all' ? 'All' : n}
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={() => go(1)}
          disabled={idx === PAGE_SIZE_OPTIONS.length - 1}
          className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 dark:text-zinc-500 disabled:opacity-25 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

const COL_PX = 200;
const ROW_PADDING = 'py-3';
const ROW_CLAMP = 'line-clamp-2';

function FieldComparisonView({
  results,
  visibleFields,
  documentsMap,
  getCompleteness,
}: {
  results: ExtractionResult[];
  visibleFields: string[];
  documentsMap: Record<string, Document>;
  getCompleteness: (r: ExtractionResult) => { filled: number; total: number; pct: number };
}) {
  // Document selector state — all selected by default
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(
    () => new Set(results.map(r => r.id))
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [showDocSelector, setShowDocSelector] = useState(false);
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());

  const toggleCell = (key: string) =>
    setExpandedCells(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const expandAllCells = () => {
    const keys = new Set<string>();
    visibleFields.forEach(f =>
      pageResults.forEach(r => {
        const scalar = extractScalarValue(r.extracted_data[f]);
        if (scalar && scalar !== '—' && scalar !== 'N/A') keys.add(`${f}:${r.id}`);
      })
    );
    setExpandedCells(keys);
  };

  const collapseAllCells = () => setExpandedCells(new Set());
  const selectorRef = React.useRef<HTMLDivElement>(null);
  const headerScrollRef = React.useRef<HTMLDivElement>(null);
  const bodyScrollRef   = React.useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState<PageSize>(10);

  // Sync when results list changes (extraction switch)
  useEffect(() => {
    setSelectedDocIds(new Set(results.map(r => r.id)));
    setPageIndex(0);
  }, [results]);

  // Close selector on outside click
  useEffect(() => {
    if (!showDocSelector) return;
    const handler = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setShowDocSelector(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDocSelector]);

  // Sync header horizontal scroll with body (body is the source of truth)
  useEffect(() => {
    const body   = bodyScrollRef.current;
    const header = headerScrollRef.current;
    if (!body || !header) return;
    const syncToHeader = () => { header.scrollLeft = body.scrollLeft; };
    // Keep header in sync whenever body scrolls
    body.addEventListener('scroll', syncToHeader, { passive: true });
    // Align immediately in case positions differ after re-render
    syncToHeader();
    return () => body.removeEventListener('scroll', syncToHeader);
  });

  const selectedResults = useMemo(
    () => results.filter(r => selectedDocIds.has(r.id)),
    [results, selectedDocIds]
  );
  const effectivePageSize = pageSize === 'all' ? (selectedResults.length || 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(selectedResults.length / effectivePageSize));

  // Clamp page when selection shrinks
  const clampedPage = Math.min(pageIndex, totalPages - 1);
  const pageResults = selectedResults.slice(clampedPage * effectivePageSize, (clampedPage + 1) * effectivePageSize);
  const colCount = pageResults.length;

  const startDoc = clampedPage * effectivePageSize + 1;
  const endDoc = Math.min((clampedPage + 1) * effectivePageSize, selectedResults.length);

  const toggleDoc = (id: string) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
    setPageIndex(0);
  };

  return (
    <div className="flex flex-col gap-3">

      {/* Compare toolbar: doc selector + pagination */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* Document selector */}
        <div className="relative" ref={selectorRef}>
          <button
            onClick={() => setShowDocSelector(v => !v)}
            className={cn(
              'text-xs font-medium border rounded-lg py-1.5 px-3.5 flex items-center gap-1.5 transition-colors',
              showDocSelector
                ? 'text-gray-900 dark:text-white bg-gray-100 dark:bg-[#1f1f1f] border-gray-300 dark:border-[#2a2a2a]'
                : 'text-gray-600 dark:text-zinc-400 bg-white dark:bg-[#111111] border-gray-200 dark:border-[#1f1f1f] hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:border-gray-300 dark:hover:border-[#2a2a2a]'
            )}
          >
            <FileText className="w-3.5 h-3.5" />
            Documents ({selectedDocIds.size}/{results.length})
          </button>

          {showDocSelector && (
            <div className="absolute top-full left-0 mt-2 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl shadow-xl dark:shadow-2xl p-4 w-[320px] z-50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">Show documents</span>
                <div className="flex gap-2.5 text-xs">
                  <button
                    onClick={() => { setSelectedDocIds(new Set(results.map(r => r.id))); setPageIndex(0); }}
                    className="font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
                  >All</button>
                  <span className="text-gray-200 dark:text-zinc-700">·</span>
                  <button
                    onClick={() => { setSelectedDocIds(new Set()); setPageIndex(0); }}
                    className="font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
                  >Clear</button>
                </div>
              </div>
              <div className="flex flex-col gap-px max-h-72 overflow-y-auto bg-gray-50 dark:bg-[#0a0a0a] rounded-lg p-1">
                {results.map(r => {
                  const doc = documentsMap[r.document_id];
                  const checked = selectedDocIds.has(r.id);
                  return (
                    <label
                      key={r.id}
                      className={cn(
                        'flex items-center gap-2.5 py-2 px-2.5 rounded-md cursor-pointer text-xs transition-colors',
                        checked
                          ? 'font-medium text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]'
                          : 'font-normal text-gray-500 dark:text-zinc-500 border border-transparent hover:bg-gray-100 dark:hover:bg-[#1a1a1a]'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDoc(r.id)}
                        className="w-4 h-4 cursor-pointer accent-gray-900 dark:accent-zinc-200 flex-shrink-0"
                      />
                      <span className="flex-1 truncate" title={doc?.filename}>{doc?.filename || r.id}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Expand / Collapse all */}
        <button
          onClick={expandedCells.size > 0 ? collapseAllCells : expandAllCells}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ChevronsUpDown className="w-3.5 h-3.5" />
          {expandedCells.size > 0 ? 'Collapse All' : 'Expand All'}
        </button>

        <div className="flex-1" />

        {/* Page size control */}
        <PageSizePicker value={pageSize} onChange={n => { setPageSize(n); setPageIndex(0); }} />

        {/* Pagination */}
        {selectedResults.length > 0 && pageSize !== 'all' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 dark:text-zinc-600">
              {selectedResults.length > effectivePageSize
                ? `Docs ${startDoc}–${endDoc} of ${selectedResults.length}`
                : `${selectedResults.length} doc${selectedResults.length !== 1 ? 's' : ''}`}
            </span>
            {totalPages > 1 && (
              <>
                <button
                  onClick={() => setPageIndex(p => Math.max(0, p - 1))}
                  disabled={clampedPage === 0}
                  className="px-2.5 py-1 text-xs rounded-md border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-600 dark:text-zinc-400 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                >
                  ← Prev
                </button>
                <span className="text-xs text-gray-500 dark:text-zinc-500 tabular-nums">{clampedPage + 1} / {totalPages}</span>
                <button
                  onClick={() => setPageIndex(p => Math.min(totalPages - 1, p + 1))}
                  disabled={clampedPage === totalPages - 1}
                  className="px-2.5 py-1 text-xs rounded-md border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-600 dark:text-zinc-400 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                >
                  Next →
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Empty state when all docs deselected */}
      {selectedResults.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400 dark:text-zinc-600 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl">
          No documents selected. Use the <span className="font-semibold">Documents</span> button to pick papers.
        </div>
      ) : (
        <>
        {/* ── Sticky header (separate from body so sticky works against page scroll) ── */}
        <div
          ref={headerScrollRef}
          className="overflow-x-scroll sticky top-0 z-30 rounded-t-xl border border-b-0 border-gray-200 dark:border-[#1f1f1f] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            className="grid bg-gray-50 dark:bg-[#0a0a0a] border-b border-gray-200 dark:border-[#1f1f1f]"
            style={{
              minWidth: `${240 + colCount * COL_PX}px`,
              gridTemplateColumns: `240px repeat(${colCount}, minmax(${COL_PX}px, 1fr))`,
            }}
          >
            <div className="sticky left-0 z-10 bg-gray-50 dark:bg-[#0a0a0a] px-4 py-3 text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-widest border-r border-gray-200 dark:border-[#1f1f1f]">
              Field
            </div>
            {pageResults.map(r => {
              const doc = documentsMap[r.document_id];
              const { pct } = getCompleteness(r);
              const barColor =
                pct >= 80 ? 'bg-green-500 dark:bg-green-400' :
                pct >= 50 ? 'bg-amber-500 dark:bg-amber-400' :
                'bg-red-500 dark:bg-red-400';
              return (
                <div key={r.id} className="px-3 py-2 border-r border-gray-200 dark:border-[#1f1f1f] last:border-r-0 bg-gray-50 dark:bg-[#0a0a0a]">
                  <div className="text-[11px] font-medium text-gray-700 dark:text-zinc-300 truncate mb-1.5" title={doc?.filename}>
                    {doc?.filename || '—'}
                  </div>
                  <Progress value={pct} indicatorClassName={barColor} className="h-1" />
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Scrollable body (drives horizontal scroll, synced to header) ── */}
        <div ref={bodyScrollRef} className="overflow-x-auto rounded-b-xl border border-t-0 border-gray-200 dark:border-[#1f1f1f] relative z-0">
          <div style={{ minWidth: `${240 + colCount * COL_PX}px` }}>
            {visibleFields.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-400 dark:text-zinc-600 bg-white dark:bg-[#111111]">
                No fields match your search.
              </div>
            )}
            {visibleFields.map((fieldName, fi) => {
              const filledCount = selectedResults.filter(r => {
                const v = extractScalarValue(r.extracted_data[fieldName]);
                return v && v !== '—' && v !== 'N/A';
              }).length;
              const coveragePct = selectedResults.length > 0 ? Math.round((filledCount / selectedResults.length) * 100) : 0;
              const coverageColor =
                coveragePct >= 80 ? 'text-green-600 dark:text-green-400' :
                coveragePct >= 50 ? 'text-amber-600 dark:text-amber-400' :
                'text-red-600 dark:text-red-400';

              const rowBg = fi % 2 === 0
                ? 'bg-white dark:bg-[#111111]'
                : 'bg-gray-50/50 dark:bg-[#0d0d0d]';
              // Sticky cell must be fully opaque — bg-gray-50/50 is semi-transparent and lets scrolling content bleed through
              const stickyBg = fi % 2 === 0
                ? 'bg-white dark:bg-[#111111]'
                : 'bg-gray-50 dark:bg-[#0d0d0d]';

              return (
                <div
                  key={fieldName}
                  className={cn('grid border-b border-gray-100 dark:border-[#1f1f1f] last:border-b-0', rowBg)}
                  style={{ gridTemplateColumns: `240px repeat(${colCount}, minmax(${COL_PX}px, 1fr))` }}
                >
                  <div className={cn('sticky left-0 z-10 px-4 border-r border-gray-100 dark:border-[#1f1f1f]', stickyBg, ROW_PADDING)}>
                    <div className="text-[11px] font-semibold text-gray-700 dark:text-zinc-300 leading-tight">
                      {formatFieldName(fieldName)}
                    </div>
                    <span className={cn('text-[10px] font-medium mt-0.5 block', coverageColor)}>
                      {filledCount}/{selectedResults.length} docs
                    </span>
                  </div>
                  {pageResults.map(r => {
                    const raw = r.extracted_data[fieldName];
                    const scalar = extractScalarValue(raw);
                    const isEmpty = !scalar || scalar === '—' || scalar === 'N/A';
                    const cellKey = `${fieldName}:${r.id}`;
                    const isExpanded = expandedCells.has(cellKey);
                    return (
                      <div
                        key={r.id}
                        onClick={() => !isEmpty && toggleCell(cellKey)}
                        className={cn(
                          'px-3 text-xs leading-relaxed border-r border-gray-100 dark:border-[#1f1f1f] last:border-r-0 transition-colors',
                          ROW_PADDING,
                          isEmpty
                            ? 'text-gray-300 dark:text-zinc-700 italic'
                            : cn('text-gray-700 dark:text-zinc-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.03]'),
                          isExpanded && 'bg-slate-50 dark:bg-white/[0.04] ring-1 ring-inset ring-slate-300 dark:ring-slate-600'
                        )}
                      >
                        {isEmpty ? '—' : isExpanded ? (
                          <div>
                            <DynamicDataRenderer data={raw} fieldName={fieldName} />
                            {hasSourceText(raw) && (
                              <blockquote className="mt-1.5 pl-2 border-l-2 border-slate-300 dark:border-slate-600 text-[11px] text-gray-500 dark:text-zinc-400 italic leading-relaxed">
                                {raw.source_text}
                              </blockquote>
                            )}
                          </div>
                        ) : (
                          <span className={ROW_CLAMP}>{scalar}</span>
                        )}

                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        </>
      )}
    </div>
  );
}

// ── ResultsContent ────────────────────────────────────────────────────────────

function ResultsContent() {
  const { selectedProject } = useProject();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const extractionIdParam = searchParams.get('extraction_id');
  const sourceTabParam = searchParams.get('tab');

  const [selectedExtractionId, setSelectedExtractionId] = useState<string>(extractionIdParam || '');
  const [activeView, setActiveView] = useState<'table' | 'compare'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date_newest');
  const [sourceTab, setSourceTab] = useState<'ai' | 'manual' | 'final'>((sourceTabParam as any) || 'ai');

  // Update URL when extraction or tab changes (enables browser back/forward)
  const selectExtraction = (id: string) => {
    setSelectedExtractionId(id);
    const params = new URLSearchParams();
    if (id) params.set('extraction_id', id);
    if (sourceTab !== 'ai') params.set('tab', sourceTab);
    router.push(`/results?${params.toString()}`, { scroll: false });
  };

  const selectSourceTab = (tab: 'ai' | 'manual' | 'final') => {
    setSourceTab(tab);
    const params = new URLSearchParams();
    if (tab !== 'ai') params.set('tab', tab);
    router.push(`/results?${params.toString()}`, { scroll: false });
  };

  // PDF Source Viewer state
  const [pdfViewerResultId, setPdfViewerResultId] = useState<string | null>(null);
  const [pdfViewerDocId, setPdfViewerDocId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState<string | undefined>();
  const sourceLink = useSourceLinking(pdfViewerResultId ?? undefined);

  const { data: extractionsData } = useQuery({
    queryKey: ['extractions-with-forms', selectedProject?.id],
    queryFn: async () => {
      const [data, formData] = await Promise.all([
        extractionsService.getAll(selectedProject!.id),
        formsService.getAll(selectedProject!.id).catch(() => []),
      ]);
      const withResults = data.filter((e: Extraction) => e.status === 'completed' || e.status === 'manual' || e.status === 'consensus');
      const formMap: Record<string, any> = {};
      formData.forEach((f: any) => { formMap[f.id] = f; });
      return { extractions: withResults, forms: formMap };
    },
    enabled: !!selectedProject,
  });
  const allExtractions = useMemo(() => extractionsData?.extractions ?? [], [extractionsData]);
  const forms = useMemo(() => extractionsData?.forms ?? {}, [extractionsData]);

  // Filter by source tab
  const extractions = useMemo(() => {
    const statusMap: Record<string, string[]> = {
      ai: ['completed'],
      manual: ['manual'],
      final: [],
    };
    return allExtractions.filter((e: Extraction) => statusMap[sourceTab]?.includes(e.status));
  }, [allExtractions, sourceTab]);

  // Count per tab
  const aiCount = useMemo(() => allExtractions.filter((e: Extraction) => e.status === 'completed').length, [allExtractions]);
  const manualCount = useMemo(() => allExtractions.filter((e: Extraction) => e.status === 'manual').length, [allExtractions]);
  const consensusCount = useMemo(() => allExtractions.filter((e: Extraction) => e.status === 'consensus').length, [allExtractions]);

  const selectedExtraction = extractions.find((e: Extraction) => e.id === selectedExtractionId);
  const currentForm = selectedExtraction ? forms[selectedExtraction.form_id] : null;
  const formFields = currentForm?.fields ?? [];

  const { data: selectedJob } = useQuery({
    queryKey: ['job', selectedExtraction?.job_id],
    queryFn: () => jobsService.getById(selectedExtraction!.job_id!),
    enabled: !!selectedExtraction?.job_id,
  });
  const failedDocIds: string[] = selectedJob?.result_data?.failed_document_ids ?? [];

  const handleRetryFailed = async () => {
    if (!selectedExtractionId) return;
    try {
      await extractionsService.retryFailed(selectedExtractionId);
      toast({ title: 'Retrying', description: 'Retry job started for failed papers', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['job', selectedExtraction?.job_id] });
      queryClient.invalidateQueries({ queryKey: ['extractions-with-forms', selectedProject?.id] });
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to start retry'), variant: 'error' });
    }
  };

  // Sync state from URL on browser back/forward
  useEffect(() => {
    const urlExtId = searchParams.get('extraction_id');
    const urlTab = searchParams.get('tab') as 'ai' | 'manual' | 'final' | null;
    if (urlExtId && urlExtId !== selectedExtractionId) setSelectedExtractionId(urlExtId);
    if (urlTab && urlTab !== sourceTab) setSourceTab(urlTab);
    if (!urlTab && sourceTab !== 'ai') setSourceTab('ai');
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first extraction when tab changes or on load
  useEffect(() => {
    if (extractions.length > 0) {
      const currentStillValid = extractions.some((e: Extraction) => e.id === selectedExtractionId);
      if (!currentStillValid) {
        if (extractionIdParam && extractions.some((e: Extraction) => e.id === extractionIdParam)) {
          setSelectedExtractionId(extractionIdParam);
        } else {
          setSelectedExtractionId(extractions[0].id);
        }
      }
    } else {
      setSelectedExtractionId('');
    }
  }, [extractions, extractionIdParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: results = [], isLoading: resultsLoading, error: resultsError } = useQuery({
    queryKey: ['results', selectedExtractionId],
    queryFn: () => resultsService.getAll({ extractionId: selectedExtractionId }),
    enabled: !!selectedExtractionId,
  });

  const documentIds = useMemo(() => Array.from(new Set(results.map(r => r.document_id))), [results]);
  const { data: documentsList = [] } = useQuery({
    queryKey: ['documents-by-ids', documentIds],
    queryFn: async () => {
      const docs = await Promise.all(documentIds.map(id => documentsService.getById(id).catch(() => null)));
      return docs.filter(Boolean) as Document[];
    },
    enabled: documentIds.length > 0,
  });
  const documentsMap = useMemo(() => {
    const map: Record<string, Document> = {};
    documentsList.forEach((doc) => { if (doc) map[doc.id] = doc; });
    return map;
  }, [documentsList]);

  const handleSourceClick = useCallback(async (resultId: string, documentId: string, fieldName: string, _location: SourceLocation) => {
    if (pdfViewerDocId !== documentId) {
      try {
        const url = await documentsService.getDownloadUrl(documentId);
        setPdfUrl(url);
        setPdfViewerDocId(documentId);
        setPdfViewerResultId(resultId);
        setPdfFilename(documentsMap[documentId]?.filename);
      } catch {
        toast({ title: 'Error', description: 'Failed to load PDF', variant: 'error' });
        return;
      }
    }
    sourceLink.scrollToField(fieldName);
  }, [pdfViewerDocId, documentsMap, sourceLink, toast]);

  const loading = !extractionsData || resultsLoading;
  const error = resultsError ? getErrorMessage(resultsError as any, 'Failed to load results') : null;

  const handleExport = (format: 'json' | 'csv') => {
    if (!selectedExtractionId || filteredResults.length === 0) return;
    try {
      const longFormat = transformToLongFormat(filteredResults, formFields, documentsMap);
      const content = format === 'csv' ? toCSV(longFormat) : toJSON(longFormat);
      const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
      const blob = new Blob([content], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `extraction_${selectedExtractionId}_long.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(url), 100);
      toast({ title: 'Exported', description: `Long-format results exported as ${format.toUpperCase()}`, variant: 'success' });
    } catch {
      toast({ title: 'Error', description: 'Failed to export results', variant: 'error' });
    }
  };

  // Derived field names — filter out metadata keys (source_text, source_location, confidence, reasoning)
  const allFieldNames = useMemo(() =>
    Array.from(new Set(results.flatMap(r => Object.keys(r.extracted_data))))
      .filter(f => {
        const fl = f.toLowerCase();
        return !fl.includes('source_text') && !fl.includes('source text')
          && !fl.includes('source_location') && !fl.endsWith('.confidence')
          && !fl.endsWith('.reasoning');
      })
      .sort(),
    [results]
  );

  const getCompleteness = useCallback((result: ExtractionResult) => {
    const total = allFieldNames.length;
    const filled = allFieldNames.filter(f => {
      const v = extractScalarValue(result.extracted_data[f]);
      return v && v !== '—' && v !== 'N/A';
    }).length;
    return { filled, total, pct: total > 0 ? Math.round((filled / total) * 100) : 0 };
  }, [allFieldNames]);

  // Sort results
  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      const da = documentsMap[a.document_id];
      const db = documentsMap[b.document_id];
      if (sortKey === 'doc_name_asc') return (da?.filename || '').localeCompare(db?.filename || '');
      if (sortKey === 'doc_name_desc') return (db?.filename || '').localeCompare(da?.filename || '');
      if (sortKey === 'date_newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortKey === 'date_oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortKey === 'completeness_high') return getCompleteness(b).filled - getCompleteness(a).filled;
      if (sortKey === 'completeness_low') return getCompleteness(a).filled - getCompleteness(b).filled;
      return 0;
    });
  }, [results, documentsMap, sortKey, getCompleteness]);

  // Filter for cards view
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return sortedResults;
    const q = searchQuery.toLowerCase();
    return sortedResults.filter(r => {
      if (documentsMap[r.document_id]?.filename.toLowerCase().includes(q)) return true;
      return Object.values(r.extracted_data).some(v => extractScalarValue(v).toLowerCase().includes(q));
    });
  }, [sortedResults, searchQuery, documentsMap]);

  // Filter for compare view
  const visibleFields = useMemo(() => {
    // In Evidence table view, searchQuery filters rows (filteredResults) — show all columns.
    // In Compare view, searchQuery filters columns by field name.
    if (activeView === 'table' || !searchQuery.trim()) return allFieldNames;
    return allFieldNames.filter(f => f.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [allFieldNames, searchQuery, activeView]);

  if (!selectedProject) {
    return (
      <DashboardLayout title="Results" description="View and export extraction results">
        <EmptyState icon={AlertCircle} title="No Project Selected" description="Please select a project to view results" />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Results" description="View and export extraction results">
      {/* Source tabs */}
      <div className="flex items-center gap-1 mb-4">
        {([
          { key: 'ai' as const, label: 'AI Extractions', count: aiCount },
          { key: 'manual' as const, label: 'Manual', count: manualCount },
          { key: 'final' as const, label: 'Final Dataset', count: 0 },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => selectSourceTab(tab.key)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              sourceTab === tab.key
                ? 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900'
                : 'bg-transparent text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-[#1a1a1a]'
            )}
          >
            {tab.label}{tab.count > 0 ? ` (${tab.count})` : ''}
          </button>
        ))}
      </div>

      {sourceTab === 'final' ? (
        <FinalDatasetView />
      ) : loading && extractions.length === 0 ? (
        <div className="flex justify-center items-center py-12"><Spinner size="lg" /></div>
      ) : extractions.length === 0 ? (
        <EmptyState
          icon={TableIcon}
          title={sourceTab === 'ai' ? 'No AI extractions' : 'No manual extractions'}
          description={sourceTab === 'ai' ? 'Run an extraction first to see results here' : 'Use Manual Extract to add results'}
        />
      ) : (
        <div className="flex flex-col gap-5">

          {/* Retry banner */}
          {failedDocIds.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40">
              <span className="text-sm text-amber-700 dark:text-amber-400">
                ⚠ {failedDocIds.length} paper{failedDocIds.length !== 1 ? 's' : ''} failed to extract.
              </span>
              <button
                onClick={handleRetryFailed}
                className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-amber-200 dark:hover:bg-amber-900/40"
              >
                Retry Failed Papers
              </button>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Extraction picker */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative">
                <select
                  value={selectedExtractionId}
                  onChange={e => selectExtraction(e.target.value)}
                  className="text-sm font-medium text-gray-900 dark:text-white bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 pl-3 pr-8 outline-none cursor-pointer hover:border-gray-300 dark:hover:border-[#2a2a2a] focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors dark:[color-scheme:dark] appearance-none min-w-[260px]"
                >
                  {extractions.map(ext => (
                    <option key={ext.id} value={ext.id}>
                      {forms[ext.form_id]?.form_name || 'Unknown form'} — {new Date(ext.created_at).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              </div>
            </div>

            <div className="flex-1" />

            {/* Export buttons */}
            {!loading && results.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleExport('json')}
                  className="text-xs font-medium text-gray-600 dark:text-zinc-400 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 px-3.5 flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:border-gray-300 dark:hover:border-[#2a2a2a] transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> JSON
                </button>
                <button
                  onClick={() => handleExport('csv')}
                  className="text-xs font-medium text-gray-600 dark:text-zinc-400 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 px-3.5 flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:border-gray-300 dark:hover:border-[#2a2a2a] transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
              </div>
            )}
          </div>

          {/* Results area */}
          {loading ? (
            <div className="flex justify-center items-center py-12"><Spinner size="lg" /></div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/40 rounded-xl p-12 text-center">
              <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
              <p className="text-sm font-semibold text-red-900 dark:text-red-400 mb-4">{error}</p>
            </div>
          ) : results.length === 0 ? (
            <EmptyState icon={FileText} title="No results found" description="This extraction has no results yet" />
          ) : (
            <>
              {/* View controls + inline stats */}
              <ViewControlsBar
                activeView={activeView}
                setActiveView={setActiveView}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                sortKey={sortKey}
                setSortKey={setSortKey}
                results={results}
                allFieldNames={allFieldNames}
                getCompleteness={getCompleteness}
              />

              {/* Main view — with optional PDF panel */}
              <div className={cn('flex gap-4', pdfViewerDocId ? 'flex-row' : 'flex-col')}>
                <div className={cn(pdfViewerDocId ? 'flex-1 min-w-0' : 'w-full')}>
                  {activeView === 'table' ? (
                    <LongFormatTable
                      results={filteredResults}
                      documentsMap={documentsMap}
                      formFields={formFields}
                    />
                  ) : (
                    <FieldComparisonView
                      results={sortedResults}
                      visibleFields={visibleFields}
                      documentsMap={documentsMap}
                      getCompleteness={getCompleteness}
                    />
                  )}
                </div>

                {/* PDF Source Viewer panel */}
                {pdfViewerDocId && (
                  <div className="w-[420px] flex-shrink-0 h-[calc(100vh-200px)] sticky top-4">
                    <PdfSourceViewer
                      pdfUrl={pdfUrl}
                      filename={pdfFilename}
                      activeHighlight={sourceLink.activeHighlight}
                      highlights={sourceLink.highlights}
                      onClose={() => {
                        setPdfViewerDocId(null);
                        setPdfViewerResultId(null);
                        setPdfUrl(null);
                        sourceLink.clearActive();
                      }}
                      onClearHighlight={() => sourceLink.clearActive()}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}

export default function ResultsPage() {
  return (
    <Suspense>
      <ResultsContent />
    </Suspense>
  );
}

'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { resultsService, extractionsService, documentsService, formsService } from '@/services';
import { ExtractionResult, Extraction, Document } from '@/types/api';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Spinner, EmptyState } from '@/components/ui';
import {
  Download, AlertCircle, FileText, Table as TableIcon,
  Search, ChevronDown, ArrowUpDown, X,
} from 'lucide-react';
import { cn, formatDate, getErrorMessage } from '@/lib/utils';

type SortKey = 'doc_name_asc' | 'doc_name_desc' | 'date_newest' | 'date_oldest' | 'completeness_high' | 'completeness_low';

export default function ResultsPage() {
  const { selectedProject } = useProject();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const extractionIdParam = searchParams.get('extraction_id');

  const [selectedExtractionId, setSelectedExtractionId] = useState<string>(extractionIdParam || '');

  const { data: extractionsData } = useQuery({
    queryKey: ['extractions-with-forms', selectedProject?.id],
    queryFn: async () => {
      const [data, formData] = await Promise.all([
        extractionsService.getAll(selectedProject!.id),
        formsService.getAll(selectedProject!.id).catch(() => []),
      ]);
      const completed = data.filter((e: Extraction) => e.status === 'completed');
      const formMap: Record<string, any> = {};
      formData.forEach((f: any) => { formMap[f.id] = f; });
      return { extractions: completed, forms: formMap };
    },
    enabled: !!selectedProject,
  });
  const extractions = extractionsData?.extractions ?? [];
  const forms = extractionsData?.forms ?? {};

  useEffect(() => {
    if (!selectedExtractionId && extractions.length > 0) {
      if (extractionIdParam && extractions.some((e: Extraction) => e.id === extractionIdParam)) {
        setSelectedExtractionId(extractionIdParam);
      } else {
        setSelectedExtractionId(extractions[0].id);
      }
    }
  }, [extractions, extractionIdParam]);

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
      return docs;
    },
    enabled: documentIds.length > 0,
  });
  const documentsMap = useMemo(() => {
    const map: Record<string, Document> = {};
    documentsList.forEach((doc, i) => { if (doc) map[documentIds[i]] = doc; });
    return map;
  }, [documentsList, documentIds]);

  const loading = !extractionsData || resultsLoading;
  const error = resultsError ? getErrorMessage(resultsError as any, 'Failed to load results') : null;

  const handleExport = async (format: 'json' | 'csv') => {
    if (!selectedExtractionId) return;
    try {
      const blob = format === 'json'
        ? await resultsService.exportJSON({ extractionId: selectedExtractionId })
        : await resultsService.exportCSV({ extractionId: selectedExtractionId });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `extraction_${selectedExtractionId}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: 'Exported', description: `Results exported as ${format.toUpperCase()}`, variant: 'success' });
    } catch {
      toast({ title: 'Error', description: 'Failed to export results', variant: 'error' });
    }
  };

  const selectedExtraction = extractions.find(e => e.id === selectedExtractionId);
  const selectedForm = selectedExtraction ? forms[selectedExtraction.form_id] : null;

  if (!selectedProject) {
    return (
      <DashboardLayout title="Results" description="View and export extraction results">
        <EmptyState icon={AlertCircle} title="No Project Selected" description="Please select a project to view results" />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Results" description="View and export extraction results">
      {loading && extractions.length === 0 ? (
        <div className="flex justify-center items-center py-12"><Spinner size="lg" /></div>
      ) : extractions.length === 0 ? (
        <EmptyState icon={TableIcon} title="No completed extractions" description="Run an extraction first to see results here" />
      ) : (
        <div className="flex flex-col gap-5">

          {/* -- Toolbar -- */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Extraction picker */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative">
                <select
                  value={selectedExtractionId}
                  onChange={e => setSelectedExtractionId(e.target.value)}
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

{!loading && results.length > 0 && (
              <span className="text-[10.5px] font-semibold text-gray-500 dark:text-zinc-500 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] px-2 py-0.5 rounded-[5px]">
                {results.length} {results.length === 1 ? 'result' : 'results'}
              </span>
            )}

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

          {/* -- Results -- */}
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
            <ResultsTableView results={results} handleExport={handleExport} documents={documentsMap} />
          )}
        </div>
      )}
    </DashboardLayout>
  );
}

function ResultsTableView({ results, handleExport, documents }: {
  results: ExtractionResult[];
  handleExport: (f: 'json' | 'csv') => void;
  documents: Record<string, Document>;
}) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [detailSearch, setDetailSearch] = useState('');
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [docSearch, setDocSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date_newest');

  const allFieldNames = useMemo(() =>
    Array.from(new Set(results.flatMap(r => Object.keys(r.extracted_data))))
      .filter(f => !f.toLowerCase().includes('source_text') && !f.toLowerCase().includes('source text'))
      .sort(),
    [results]
  );

  const defaultColumns = useMemo(() => allFieldNames.slice(0, 4), [allFieldNames]);

  const [visibleColumns, setVisibleColumns] = useState<string[]>(defaultColumns);

  const formatFieldName = (f: string) =>
    f.replace(/_/g, ' ').replace(/\./g, ' ').split(' ')
      .filter(w => w.toLowerCase() !== 'value')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const extractValue = (data: any): string => {
    if (data == null) return '—';
    if (typeof data === 'string') return data;
    if (typeof data === 'number' || typeof data === 'boolean') return String(data);
    if (typeof data === 'object' && 'value' in data) {
      const v = String(data.value ?? '—');
      return v.length > 100 ? v.slice(0, 100) + '…' : v;
    }
    if (Array.isArray(data)) return `[${data.length} items]`;
    return JSON.stringify(data).slice(0, 100);
  };

  const getCompleteness = (result: ExtractionResult) => {
    const total = allFieldNames.length;
    const filled = allFieldNames.filter(f => { const v = extractValue(result.extracted_data[f]); return v && v !== '—' && v !== 'N/A'; }).length;
    return { filled, total };
  };

  // Filter + sort
  const filteredResults = useMemo(() => {
    let r = results.filter(res => {
      const doc = documents[res.document_id];
      if (!docSearch.trim()) return true;
      return doc?.filename?.toLowerCase().includes(docSearch.toLowerCase());
    });

    r = [...r].sort((a, b) => {
      const da = documents[a.document_id];
      const db = documents[b.document_id];
      if (sortKey === 'doc_name_asc') return (da?.filename || '').localeCompare(db?.filename || '');
      if (sortKey === 'doc_name_desc') return (db?.filename || '').localeCompare(da?.filename || '');
      if (sortKey === 'date_newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortKey === 'date_oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortKey === 'completeness_high') return getCompleteness(b).filled - getCompleteness(a).filled;
      if (sortKey === 'completeness_low') return getCompleteness(a).filled - getCompleteness(b).filled;
      return 0;
    });

    return r;
  }, [results, documents, docSearch, sortKey]);

  return (
    <div>
      {/* Table toolbar */}
      <div className="flex items-center gap-2.5 mb-3.5 flex-wrap">

        {/* Doc search */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-600 flex-shrink-0" />
          <input
            value={docSearch}
            onChange={e => setDocSearch(e.target.value)}
            placeholder="Search documents…"
            className="text-sm text-gray-700 dark:text-zinc-300 bg-transparent border-none outline-none w-full placeholder:text-gray-300 dark:placeholder:text-zinc-600"
          />
          {docSearch && (
            <button onClick={() => setDocSearch('')} className="flex-shrink-0">
              <X className="w-3 h-3 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300" />
            </button>
          )}
        </div>

        {/* Sort */}
        <div className="relative">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]">
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
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-600">
          <span className="text-gray-700 dark:text-zinc-300 font-semibold">{filteredResults.length}</span>
          {filteredResults.length !== results.length && <span>of {results.length}</span>}
          <span>docs</span>
          <span className="text-gray-200 dark:text-zinc-700">·</span>
          <span className="text-gray-700 dark:text-zinc-300 font-semibold">{visibleColumns.length}</span>
          <span>/ {allFieldNames.length} fields</span>
        </div>

        <div className="flex-1" />

        {/* Column picker */}
        <div className="relative">
          <button
            onClick={() => setShowColumnSelector(v => !v)}
            className={cn(
              "text-xs font-medium border rounded-lg py-1.5 px-3.5 flex items-center gap-1.5 transition-colors",
              showColumnSelector
                ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-[#1f1f1f] border-gray-300 dark:border-[#2a2a2a]"
                : "text-gray-600 dark:text-zinc-400 bg-white dark:bg-[#111111] border-gray-200 dark:border-[#1f1f1f] hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:border-gray-300 dark:hover:border-[#2a2a2a]"
            )}
          >
            <span>⊞</span> Columns ({visibleColumns.length})
          </button>

          {showColumnSelector && (
            <div className="absolute top-full right-0 mt-2 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl shadow-xl dark:shadow-2xl p-4 w-[340px] z-50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">Show columns</span>
                <div className="flex gap-2.5 text-xs">
                  <button onClick={() => setVisibleColumns(allFieldNames)} className="font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200">All</button>
                  <span className="text-gray-200 dark:text-zinc-700">·</span>
                  <button onClick={() => setVisibleColumns(defaultColumns)} className="font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200">Reset</button>
                  <span className="text-gray-200 dark:text-zinc-700">·</span>
                  <button onClick={() => setVisibleColumns([])} className="font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200">Clear</button>
                </div>
              </div>
              <div className="flex flex-col gap-px max-h-72 overflow-y-auto bg-gray-50 dark:bg-[#0a0a0a] rounded-lg p-1">
                {allFieldNames.map(name => {
                  const checked = visibleColumns.includes(name);
                  return (
                    <label
                      key={name}
                      className={cn(
                        "flex items-center gap-2.5 py-2 px-2.5 rounded-md cursor-pointer text-xs transition-colors",
                        checked
                          ? "font-medium text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]"
                          : "font-normal text-gray-500 dark:text-zinc-500 border border-transparent hover:bg-gray-100 dark:hover:bg-[#1a1a1a]"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setVisibleColumns(prev => prev.includes(name) ? prev.filter(f => f !== name) : [...prev, name])}
                        className="w-4 h-4 cursor-pointer accent-gray-900 dark:accent-zinc-200"
                      />
                      <span className="flex-1">{formatFieldName(name)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="border border-gray-200 dark:border-[#1f1f1f] rounded-xl overflow-hidden">
        {/* Header */}
        <div
          className="bg-gray-50 dark:bg-[#0a0a0a] border-b border-gray-200 dark:border-[#1f1f1f] px-4"
          style={{ display: 'grid', gridTemplateColumns: `200px repeat(${visibleColumns.length}, 1fr) 60px` }}
        >
          <div className="py-3 text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-widest">Document</div>
          {visibleColumns.map(col => (
            <div key={col} className="py-3 px-2 text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-widest leading-tight">{formatFieldName(col)}</div>
          ))}
          <div />
        </div>

        {/* Empty search state */}
        {filteredResults.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400 dark:text-zinc-600 bg-white dark:bg-[#111111]">
            No documents matching &ldquo;{docSearch}&rdquo;
          </div>
        )}

        {/* Rows */}
        {filteredResults.map((result, di) => {
          const isExpanded = expandedRow === di;
          const document = documents[result.document_id];
          const completeness = getCompleteness(result);

          return (
            <div key={result.id} className={cn("bg-white dark:bg-[#111111]", di < filteredResults.length - 1 && "border-b border-gray-100 dark:border-[#1f1f1f]")}>
              {/* Row */}
              <div
                className={cn(
                  "cursor-pointer px-4 items-center transition-colors hover:bg-gray-50 dark:hover:bg-[#1a1a1a]",
                  isExpanded && "bg-gray-50 dark:bg-[#1a1a1a]"
                )}
                style={{ display: 'grid', gridTemplateColumns: `200px repeat(${visibleColumns.length}, 1fr) 60px` }}
                onClick={() => { setExpandedRow(isExpanded ? null : di); setDetailSearch(''); }}
              >
                <div className="py-4 flex flex-col justify-center">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white leading-tight truncate max-w-[180px]">
                    {document?.filename || '—'}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-zinc-600 mt-0.5">
                    {formatDate(result.created_at)}
                  </div>
                </div>

                {visibleColumns.map(col => {
                  const val = extractValue(result.extracted_data[col]);
                  return (
                    <div key={col} className={cn("py-4 px-2 text-xs leading-relaxed break-words tracking-tight", val !== '—' ? "text-gray-700 dark:text-zinc-300" : "text-gray-300 dark:text-zinc-700 italic")}>
                      {val}
                    </div>
                  );
                })}

                <div className="flex items-center gap-2 justify-end py-4">
                  <span className={cn("text-[10.5px] font-semibold", completeness.filled === completeness.total ? "text-green-500 dark:text-green-400" : "text-gray-400 dark:text-zinc-600")}>
                    {completeness.filled}/{completeness.total}
                  </span>
                  <ChevronDown className={cn("w-3.5 h-3.5 text-gray-400 dark:text-zinc-600 transition-transform duration-200", isExpanded && "rotate-180")} />
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-4 pb-6 bg-gray-50 dark:bg-[#0a0a0a] border-t border-gray-100 dark:border-[#1f1f1f]">
                  <div className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{document?.filename || 'Document'}</span>
                      <span className="text-[10.5px] font-semibold text-gray-500 dark:text-zinc-500 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] px-2 py-0.5 rounded-[5px]">
                        {completeness.filled}/{completeness.total} fields
                      </span>
                    </div>
                    <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a] min-w-[200px]">
                      <Search className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-600" />
                      <input
                        value={detailSearch}
                        onChange={e => setDetailSearch(e.target.value)}
                        placeholder="Search fields…"
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-gray-700 dark:text-zinc-300 bg-transparent border-none outline-none w-full placeholder:text-gray-300 dark:placeholder:text-zinc-600"
                      />
                    </div>
                  </div>

                  <div className="bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg overflow-hidden">
                    {Object.entries(result.extracted_data)
                      .filter(([f]) => !f.toLowerCase().includes('source_text') && !f.toLowerCase().includes('source text'))
                      .filter(([f, v]) => !detailSearch || f.toLowerCase().includes(detailSearch.toLowerCase()) || extractValue(v).toLowerCase().includes(detailSearch.toLowerCase()))
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([fieldName, value], fi, arr) => (
                        <div
                          key={fieldName}
                          className={cn("flex gap-5 px-4 py-3", fi < arr.length - 1 && "border-b border-gray-100 dark:border-[#1f1f1f]")}
                        >
                          <span className="text-xs font-semibold text-gray-500 dark:text-zinc-500 w-48 flex-shrink-0 pt-0.5">{formatFieldName(fieldName)}</span>
                          <span className={cn("text-sm leading-relaxed break-words flex-1", extractValue(value) !== '—' ? "text-gray-900 dark:text-white" : "text-gray-300 dark:text-zinc-700 italic")}>
                            {extractValue(value) !== '—' ? extractValue(value) : 'Not extracted'}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  Search, ChevronDown, ArrowUpDown, X, MapPin,
} from 'lucide-react';
import { PdfSourceViewer } from '@/components/PdfSourceViewer';
import { useSourceLinking } from '@/hooks/useSourceLinking';
import type { SourceLocation } from '@/types/api';
import { cn, formatDate, getErrorMessage } from '@/lib/utils';
import { PermissionGate } from '@/components/ui/permission-gate';
import { FinalDatasetView } from './_components/FinalDatasetView';
import LongFormatTable from './_components/LongFormatTable';
import { transformToLongFormat, toCSV, toJSON } from '@/lib/longFormatTransform';

type SortKey = 'doc_name_asc' | 'doc_name_desc' | 'date_newest' | 'date_oldest' | 'completeness_high' | 'completeness_low';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Unwrap {value, source_text, source_location} wrappers at any depth
function unwrapValue(v: any): any {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) return v.value;
  return v;
}

function extractScalarValue(data: any): string {
  if (data === null || data === undefined) return '—';
  if (typeof data === 'string') return data.trim() || '—';
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  // Wrapped scalar: {value: "X", source_text: "..."}
  if (typeof data === 'object' && !Array.isArray(data) && 'value' in data) {
    const v = data.value;
    if (v === null || v === undefined || String(v).trim() === '') return '—';
    // If the value itself is an array or object, recurse
    if (Array.isArray(v)) return extractScalarValue(v);
    const s = String(v);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return '—';
    // Array of primitives
    if (data.every((d: any) => typeof d === 'string' || typeof d === 'number')) return data.join(', ');
    // Array of objects — summarize each item
    const items = data.map((item: any) => {
      if (item == null) return '';
      if (typeof item === 'string' || typeof item === 'number') return String(item);
      if (typeof item !== 'object') return String(item);
      // Unwrap all fields in this object
      const flat: Record<string, any> = {};
      for (const [k, v] of Object.entries(item)) {
        const u = unwrapValue(v);
        if (u != null && u !== '' && typeof u !== 'object') flat[k] = u;
      }
      // Try to find a name/label field for a short summary
      const nameKey = Object.keys(flat).find(k => /name|title|label|intervention|drug|treatment/i.test(k));
      if (nameKey) return String(flat[nameKey]);
      // Fallback: join the scalar values
      const vals = Object.values(flat).filter(v => v != null && String(v).trim() !== '');
      return vals.slice(0, 4).join(', ');
    });
    const summary = items.filter((s: string) => s && s.trim()).join(' · ');
    return summary.length > 200 ? summary.slice(0, 200) + '…' : summary || `${data.length} items`;
  }
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

function hasAnyEvidence(data: any): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  return hasSourceText(data) || !!data.source_location;
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

// ── ViewControlsBar ───────────────────────────────────────────────────────────

function ViewControlsBar({
  searchQuery,
  setSearchQuery,
  sortKey,
  setSortKey,
  results,
  allFieldNames,
  getCompleteness,
}: {
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
          placeholder="Search fields…"
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

      {/* Sort */}
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
  const formIdParam = searchParams.get('form_id');
  const sourceTabParam = searchParams.get('tab');

  // Form-level merged view: when form_id is in URL, show all results for that form
  const isFormView = !!formIdParam && !extractionIdParam;

  const [selectedExtractionId, setSelectedExtractionId] = useState<string>(extractionIdParam || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date_newest');
  const [sourceTab, setSourceTab] = useState<'ai' | 'manual' | 'final'>((sourceTabParam as any) || 'ai');
  const [expandedFormId, setExpandedFormId] = useState<string | null>(null);

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
      return { extractions: withResults, allExtractions: data, forms: formMap };
    },
    enabled: !!selectedProject,
    refetchInterval: (query) => {
      const all = query.state.data?.allExtractions ?? [];
      return all.some((e: any) => e.status === 'running' || e.status === 'pending') ? 5000 : false;
    },
  });
  // extractionsData.extractions = only completed/manual/consensus (for picker/tabs)
  // extractionsData.allExtractions = ALL extractions regardless of status (for lookups)
  const extractionsWithResults = useMemo(() => extractionsData?.extractions ?? [], [extractionsData]);
  const allExtractions = useMemo(() => extractionsData?.allExtractions ?? [], [extractionsData]);
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

  // BUG FIX: Look up selectedExtraction from ALL extractions (not tab-filtered)
  // Use effectiveId to handle first render where state hasn't synced from URL yet
  const effectiveSelectedId = selectedExtractionId || extractionIdParam || '';
  const selectedExtraction = allExtractions.find((e: Extraction) => e.id === effectiveSelectedId);
  // In form view, resolve form directly from formIdParam; otherwise from selected extraction
  const currentForm = isFormView
    ? (formIdParam ? forms[formIdParam] : null)
    : (selectedExtraction ? forms[selectedExtraction.form_id] : null);
  const formFields = currentForm?.fields ?? [];

  const { data: selectedJob } = useQuery({
    queryKey: ['job', selectedExtraction?.job_id],
    queryFn: () => jobsService.getById(selectedExtraction!.job_id!),
    enabled: !!selectedExtraction?.job_id,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'processing' || s === 'pending' ? 5000 : false;
    },
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

  // BUG FIX: Single consolidated useEffect for URL sync + auto-select
  // URL param is source of truth when present. Only auto-select when no URL param.
  useEffect(() => {
    if (isFormView) return;

    // Sync tab from URL
    const urlTab = searchParams.get('tab') as 'ai' | 'manual' | 'final' | null;
    if (urlTab && urlTab !== sourceTab) setSourceTab(urlTab);
    if (!urlTab && sourceTab !== 'ai') setSourceTab('ai');

    // Sync extraction_id from URL — URL is source of truth
    const urlExtId = searchParams.get('extraction_id');
    if (urlExtId) {
      // URL has an extraction_id — use it if it exists in allExtractions
      const exists = allExtractions.some((e: Extraction) => e.id === urlExtId);
      if (exists && urlExtId !== selectedExtractionId) {
        setSelectedExtractionId(urlExtId);
      }
      return; // Don't auto-select when URL param is explicitly set
    }

    // No URL extraction_id — auto-select first from tab-filtered list
    if (extractions.length > 0) {
      const currentStillValid = extractions.some((e: Extraction) => e.id === selectedExtractionId);
      if (!currentStillValid) {
        setSelectedExtractionId(extractions[0].id);
      }
    } else {
      setSelectedExtractionId('');
    }
  }, [searchParams, extractions, allExtractions, isFormView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Form-level merged results (when form_id param is set)
  const { data: formResults = [], isLoading: formResultsLoading, error: formResultsError } = useQuery({
    queryKey: ['results-by-form', selectedProject?.id, formIdParam],
    queryFn: () => resultsService.getAll({ projectId: selectedProject!.id, formId: formIdParam! }),
    enabled: isFormView && !!selectedProject && !!formIdParam,
  });

  // Per-extraction results (existing behavior)
  // Use extractionIdParam directly as fallback — selectedExtractionId may lag behind URL on first render
  const effectiveExtractionId = selectedExtractionId || extractionIdParam || '';
  const { data: extractionResults = [], isLoading: extractionResultsLoading, error: extractionResultsError } = useQuery({
    queryKey: ['results', effectiveExtractionId],
    queryFn: () => resultsService.getAll({ extractionId: effectiveExtractionId }),
    enabled: !isFormView && !!effectiveExtractionId,
  });

  // Deduplicate form results: keep newest result per document_id
  const deduplicatedFormResults = useMemo(() => {
    if (!isFormView) return [];
    const byDoc = new Map<string, typeof formResults[0]>();
    for (const r of formResults) {
      const existing = byDoc.get(r.document_id);
      if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
        byDoc.set(r.document_id, r);
      }
    }
    return Array.from(byDoc.values());
  }, [formResults, isFormView]);

  // Unified results: form view uses deduplicated, extraction view uses per-extraction
  const results = isFormView ? deduplicatedFormResults : extractionResults;
  const resultsLoading = isFormView ? formResultsLoading : extractionResultsLoading;
  const resultsError = isFormView ? formResultsError : extractionResultsError;

  // Fetch all project documents in a single call (shared cache key with other pages)
  const { data: documentsList = [] } = useQuery({
    queryKey: ['documents', selectedProject?.id],
    queryFn: () => documentsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
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

  const loading = isFormView ? formResultsLoading : (!extractionsData || resultsLoading);
  const error = resultsError ? getErrorMessage(resultsError as any, 'Failed to load results') : null;

  const handleExport = (format: 'json' | 'csv') => {
    if ((!isFormView && !selectedExtractionId) || filteredResults.length === 0) return;
    try {
      const longFormat = transformToLongFormat(filteredResults, formFields, documentsMap);
      const content = format === 'csv' ? toCSV(longFormat) : toJSON(longFormat);
      const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
      const blob = new Blob([content], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filePrefix = isFormView
        ? `form_${(currentForm?.form_name || formIdParam || 'results').replace(/\s+/g, '_')}`
        : `extraction_${selectedExtractionId}`;
      a.download = `${filePrefix}_long.${format}`;
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

  // Build form picker: group extractions by form_id
  // Form picker shows forms that have results for the active tab
  // But "View by run" dropdown inside results shows ALL runs (including failed)
  const formsWithResults = useMemo(() => {
    const statusMap: Record<string, string[]> = {
      ai: ['completed'],
      manual: ['manual'],
      final: [],
    };
    const pickerStatuses = statusMap[sourceTab] || [];

    // First pass: collect ALL extraction IDs per form (for the run switcher dropdown)
    const allRunsMap = new Map<string, { id: string; date: string; status: string }[]>();
    for (const ext of (extractionsData?.allExtractions ?? [])) {
      const runs = allRunsMap.get(ext.form_id) || [];
      runs.push({ id: ext.id, date: ext.created_at, status: ext.status });
      allRunsMap.set(ext.form_id, runs);
    }

    // Second pass: build form entries for the picker (only forms with results matching tab)
    const formMap = new Map<string, {
      formId: string;
      formName: string;
      extractionCount: number;
      latestDate: string;
      extractionIds: { id: string; date: string }[];
    }>();
    for (const ext of allExtractions) {
      if (!pickerStatuses.includes(ext.status)) continue;
      const existing = formMap.get(ext.form_id);
      const form = forms[ext.form_id];
      // Use ALL runs for this form in the dropdown (not just completed ones)
      const allRuns = (allRunsMap.get(ext.form_id) || [])
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      if (!existing) {
        formMap.set(ext.form_id, {
          formId: ext.form_id,
          formName: form?.form_name || 'Unknown Form',
          extractionCount: allRuns.length,
          latestDate: ext.created_at,
          extractionIds: allRuns.map(r => ({ id: r.id, date: r.date })),
        });
      } else {
        // Already in the map — just update latestDate if newer
        if (new Date(ext.created_at) > new Date(existing.latestDate)) {
          existing.latestDate = ext.created_at;
        }
      }
    }
    return Array.from(formMap.values()).sort((a, b) =>
      new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime()
    );
  }, [allExtractions, extractionsData, forms, sourceTab]);

  // Show form picker when no form_id or extraction_id in URL
  const showFormPicker = !isFormView && !extractionIdParam;

  if (!selectedProject) return null;

  return (
    <DashboardLayout title="Results" description="View and export extraction results">
      <PermissionGate permission="can_view_results">
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
      ) : showFormPicker ? (
        /* Form picker — shown when no form_id or extraction_id in URL */
        !extractionsData ? (
          <div className="flex justify-center items-center py-12"><Spinner size="lg" /></div>
        ) : formsWithResults.length === 0 ? (
          <EmptyState
            icon={TableIcon}
            title="No extraction results"
            description="Run an extraction first to see results here"
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-gray-400 dark:text-zinc-400">Select a form to view its results</p>
            {formsWithResults.map(f => (
              <button
                key={f.formId}
                onClick={() => router.push(`/results?form_id=${f.formId}`)}
                className="w-full text-left px-[22px] py-4 rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] hover:shadow-card-hover hover:-translate-y-px transition-all duration-150 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{f.formName}</span>
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-zinc-400">
                    {f.extractionCount > 1 && (
                      <span>{f.extractionCount} runs</span>
                    )}
                    <span>{new Date(f.latestDate).toLocaleDateString()}</span>
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-gray-300 dark:text-zinc-600" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )
      ) : loading && extractions.length === 0 && !isFormView ? (
        <div className="flex justify-center items-center py-12"><Spinner size="lg" /></div>
      ) : !isFormView && extractions.length === 0 ? (
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
            {/* Extraction picker / Form label */}
            <div className="flex items-center gap-2 min-w-0">
              {isFormView ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {currentForm?.form_name || 'All runs combined'}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-zinc-400">
                    {results.length} {results.length === 1 ? 'document' : 'documents'}
                  </span>
                  {/* View by run — subtle dropdown */}
                  {(() => {
                    const formEntry = formsWithResults.find(f => f.formId === formIdParam);
                    if (!formEntry || formEntry.extractionCount <= 1) return null;
                    return (
                      <div className="relative">
                        <select
                          value=""
                          onChange={e => { if (e.target.value) router.push(`/results?extraction_id=${e.target.value}`); }}
                          className="text-[11px] text-gray-400 dark:text-zinc-500 bg-transparent border border-gray-200 dark:border-[#1f1f1f] rounded-md py-1 pl-2 pr-6 outline-none cursor-pointer hover:border-gray-300 dark:hover:border-[#2a2a2a] transition-colors dark:[color-scheme:dark] appearance-none"
                        >
                          <option value="">View by run</option>
                          {formEntry.extractionIds.map((ext) => (
                            <option key={ext.id} value={ext.id}>
                              {new Date(ext.date).toLocaleDateString()} {new Date(ext.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {currentForm?.form_name || 'Unknown form'}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-zinc-500">
                    {results.length} {results.length === 1 ? 'document' : 'documents'}
                  </span>
                  {/* Run switcher — shows all runs for this form, can switch or go to "All runs" */}
                  {(() => {
                    const formId = selectedExtraction?.form_id;
                    if (!formId) return null;
                    // Build run list from ALL extractions for this form (not just completed)
                    const formRuns = (extractionsData?.allExtractions ?? [])
                      .filter((e: Extraction) => e.form_id === formId)
                      .sort((a: Extraction, b: Extraction) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                    if (formRuns.length <= 1) return null;
                    return (
                      <div className="relative">
                        <select
                          value={selectedExtractionId}
                          onChange={e => {
                            const val = e.target.value;
                            if (val === '__all__') router.push(`/results?form_id=${formId}`);
                            else router.push(`/results?extraction_id=${val}`);
                          }}
                          className="text-[11px] text-gray-500 dark:text-zinc-400 bg-transparent border border-gray-200 dark:border-[#222222] rounded-md py-1 pl-2 pr-6 outline-none cursor-pointer hover:border-gray-300 dark:hover:border-[#2a2a2a] transition-colors dark:[color-scheme:dark] appearance-none"
                        >
                          <option value="__all__">All runs</option>
                          {formRuns.map((ext: Extraction) => (
                            <option key={ext.id} value={ext.id}>
                              {new Date(ext.created_at).toLocaleDateString()} {new Date(ext.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                      </div>
                    );
                  })()}
                  {/* View details — link to debug/detail page for this specific run */}
                  {selectedExtractionId && (
                    <button
                      onClick={() => router.push(`/extractions/${selectedExtractionId}`)}
                      className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                    >
                      View details
                    </button>
                  )}
                </div>
              )}
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
                  <LongFormatTable
                    results={filteredResults}
                    documentsMap={documentsMap}
                    formFields={formFields}
                  />
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
      </PermissionGate>
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

'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef, Suspense } from 'react';
import { fieldIsEmpty, fieldIsNotApplicable } from '@/lib/absence';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { resultsService, extractionsService, documentsService, formsService, jobsService, assignmentsService } from '@/services';
import { ExtractionResult, Extraction, Document } from '@/types/api';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Spinner, EmptyState, Progress, Tooltip, Badge } from '@/components/ui';
import {
  Download, AlertCircle, FileText, FolderOpen, Table as TableIcon,
  Search, ChevronDown, ArrowUpDown, X, MapPin, GitCompare,
} from 'lucide-react';
import { PdfSourceViewer } from '@/components/PdfSourceViewer';
import { useSourceLinking } from '@/hooks/useSourceLinking';
import type { SourceLocation } from '@/types/api';
import { cn, formatDate, getErrorMessage, formatModelName, modelTagTheme, modelFamily, FAMILY_LABEL } from '@/lib/utils';
import type { ModelFamily } from '@/lib/utils';
import type { FormCoverage } from '@/services/extractions.service';
import { TagFilterBar } from '@/components/documents/DocumentTags';
import { useTagFilter } from '@/hooks/useTagFilter';
import { PermissionGate } from '@/components/ui/permission-gate';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { FinalDatasetView } from './_components/FinalDatasetView';
import LongFormatTable from './_components/LongFormatTable';
import { transformToLongFormat, toCSV, toJSON } from '@/lib/longFormatTransform';
import { buildLabelMap, documentLabel } from '@/lib/documentLabel';
import { useProjectPeople, type Person } from '@/hooks/useProjectPeople';
import { Avatar } from '@/components/ui/avatar';
import { FormResultsCard, type FormCardData, type FormContribution } from './_components/FormResultsCard';
import {
  ActivityFilterBar, useActivityFilters, windowStart,
} from './_components/ActivityFilterBar';
import { describeActivity } from './_components/activityCopy';
import { AvatarStack, TimeAgo } from './_components/ResultsPeople';
import { buildSeatResolver } from '@/lib/reviewerSeats';

/** Sentinel for "each paper's own previous run" — see `previousRunRows`. */
const PREV_RUN = 'prev';

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

// "Empty" means a reporting gap. Sourced from lib/absence so it cannot drift
// from the backend's _field_is_empty — several counts on this page are compared
// against backend-computed ones.

/**
 * The empty state the design uses for a tab with nothing in it: a dashed card,
 * not the app-wide icon block. Local because it is this page's shape.
 */
function DashedEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] px-6 py-14 text-center">
      <p className="text-sm font-semibold text-gray-700 dark:text-zinc-300">{title}</p>
      <p className="mt-1.5 text-xs text-gray-400 dark:text-zinc-500">{description}</p>
    </div>
  );
}

/** One filter pill. Themed by provider when it is the active model. */
function ModelChip({
  label, active, theme, onClick, title,
}: {
  label: string;
  active: boolean;
  theme?: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap',
        active
          ? theme
            ? cn('border-transparent', theme)
            : 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 border-gray-900 dark:border-zinc-100'
          : 'bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-[#2a2a2a] hover:border-gray-300 dark:hover:border-[#3f3f3f]',
      )}
    >
      {label}
    </button>
  );
}

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
  rowCount,
  activeTags,
  onToggleTag,
  onClearTags,
}: {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  sortKey: SortKey;
  setSortKey: (v: SortKey) => void;
  results: ExtractionResult[];
  allFieldNames: string[];
  getCompleteness: (r: ExtractionResult) => { filled: number; total: number; pct: number };
  /** Long-format rows the table will render — a paper with a table field explodes
   *  into several, so this is not the document count. */
  rowCount: number;
  activeTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
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

      {/* Inline stats — the ONLY count line on this page. The table used to carry a
          second one in its footer, which meant two places counting one screen. */}
      <span className="text-[11px] text-gray-400 dark:text-zinc-500">
        {results.length} {results.length === 1 ? 'doc' : 'docs'} · {rowCount} {rowCount === 1 ? 'row' : 'rows'} · {avgCompleteness}% complete · {fullyCoveredFields}/{allFieldNames.length} fields
      </span>

      {/* Active tag filter — the only way back once AND-filtering empties the list */}
      <TagFilterBar activeTags={activeTags} onToggleTag={onToggleTag} onClear={onClearTags} />

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
  const { can_run_extractions } = useProjectPermissions();
  const extractionIdParam = searchParams.get('extraction_id');
  const formIdParam = searchParams.get('form_id');
  const sourceTabParam = searchParams.get('tab');
  /**
   * The run to compare the AI values against.
   *
   * The AI analogue of the manual cell history: every past run is already
   * stored as its own row (1,966 of 2,894 live paper+form pairs hold two or
   * more), and nothing compared them — so re-running with a changed prompt gave
   * no way to see which values moved. No new storage, and no new endpoint: the
   * form view already fetches every run.
   */
  const compareRunId = searchParams.get('vs');
  /** Show only one person's answers. Set by clicking a person or an activity
   *  line on the form list — those name somebody, so opening "everyone's rows
   *  for this form" was never what the click meant. */
  const personParam = searchParams.get('person');

  // Form-level merged view: when form_id is in URL, show all results for that form
  const isFormView = !!formIdParam && !extractionIdParam;

  const [selectedExtractionId, setSelectedExtractionId] = useState<string>(extractionIdParam || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date_newest');
  // Document tags as a filter. Owned here, with search/sort/flagged, so the one
  // count line and the table can never disagree about what is on screen.
  const { activeTags, toggleTag, clearTags, matchesTags } = useTagFilter();
  const [sourceTab, setSourceTab] = useState<'ai' | 'manual' | 'final'>((sourceTabParam as any) || 'ai');
  const [selectedModel, setSelectedModel] = useState<ModelFamily | null>(null);
  // Which form cards have their activity open. Absent from the map means
  // "follow the filter" — see `expandedFor` below.
  const [expandedForms, setExpandedForms] = useState<Record<string, boolean>>({});
  // Search / person / time / completion, for the form list.
  const activity = useActivityFilters();
  // Names and stable avatar colours for every actor on this project.
  const { personOf } = useProjectPeople(selectedProject?.id);

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
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'ai') params.delete('tab'); else params.set('tab', tab);
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
      return all.some((e: any) => e.status === 'running' || e.status === 'pending') ? 4000 : false;
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
  // Memoised because `?? []` is a fresh array on every render, and four hooks
  // now depend on it — including the run-comparison index, which runs
  // `transformToLongFormat` over a whole run. Without this they recomputed on
  // every keystroke in the search box.
  const formFields = useMemo(() => currentForm?.fields ?? [], [currentForm]);

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
      // Check allExtractions (not tab-filtered) so a pending/running retry doesn't evict the selection
      const currentStillValid = allExtractions.some((e: Extraction) => e.id === selectedExtractionId);
      if (!currentStillValid) {
        setSelectedExtractionId(extractions[0].id);
      }
    } else {
      setSelectedExtractionId('');
    }
  }, [searchParams, extractions, allExtractions, isFormView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh results while the relevant extraction(s) are still running.
  const selectedInFlight = selectedExtraction?.status === 'running' || selectedExtraction?.status === 'pending'
    || selectedJob?.status === 'processing' || selectedJob?.status === 'pending';
  const formInFlight = !!formIdParam && allExtractions.some((e: Extraction) =>
    e.form_id === formIdParam && (e.status === 'running' || e.status === 'pending'));

  // Form-level merged results (when form_id param is set)
  const { data: formResults = [], isLoading: formResultsLoading, error: formResultsError } = useQuery({
    queryKey: ['results-by-form', selectedProject?.id, formIdParam],
    queryFn: () => resultsService.getAllForForm(selectedProject!.id, formIdParam!),
    enabled: isFormView && !!selectedProject && !!formIdParam,
    staleTime: 0,
    refetchInterval: formInFlight ? 4000 : false,
  });

  // Per-extraction results (existing behavior)
  // Use extractionIdParam directly as fallback — selectedExtractionId may lag behind URL on first render
  const effectiveExtractionId = selectedExtractionId || extractionIdParam || '';
  const { data: extractionResults = [], isLoading: extractionResultsLoading, error: extractionResultsError } = useQuery({
    queryKey: ['results', effectiveExtractionId],
    queryFn: () => resultsService.getAll({ extractionId: effectiveExtractionId }),
    enabled: !isFormView && !!effectiveExtractionId,
    staleTime: 0,
    refetchInterval: selectedInFlight ? 4000 : false,
  });

  // When the viewed extraction's job finishes, refetch its rows immediately
  // (covers the gap between status polls and the results poll switching off).
  useEffect(() => {
    if (isFormView || !effectiveExtractionId) return;
    const s = selectedExtraction?.status;
    if (s === 'completed' || s === 'manual' || s === 'consensus' || selectedJob?.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['results', effectiveExtractionId] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExtraction?.status, selectedJob?.status, effectiveExtractionId, isFormView]);

  // Rows for the currently-selected source tab (ai/manual) — 'final' has its
  // own self-contained data path (FinalDatasetView) and isn't scoped here.
  const formResultsByType = useMemo(() => {
    if (!isFormView || sourceTab === 'final') return [] as typeof formResults;
    return formResults.filter((r) => (r.extraction_type || 'ai') === sourceTab);
  }, [formResults, isFormView, sourceTab]);

  // Distinct model families across this form's AI runs (for the per-model toggle).
  // Manual rows have no model_name, so this only makes sense scoped to the AI tab.
  const modelFamiliesInForm = useMemo(() => {
    if (!isFormView || sourceTab !== 'ai') return [] as ModelFamily[];
    const present = new Set<ModelFamily>();
    for (const r of formResultsByType) present.add(modelFamily(r.model_name));
    return (['gpt', 'claude', 'gemini', 'other'] as const).filter((f) => present.has(f)) as ModelFamily[];
  }, [formResultsByType, isFormView, sourceTab]);

  // Selected model only applies if it actually ran for this form.
  const effectiveModel = selectedModel && modelFamiliesInForm.includes(selectedModel) ? selectedModel : null;

  // Deduplicate form results, scoped to the active source tab. Manual rows are
  // already unique per (document_id, reviewer_role) at the source — the backend
  // upserts R1/R2/Adjudicator in place (results.py) — so they're shown as-is,
  // not merged by document_id. AI rows keep the newest-per-document merge
  // (optionally restricted to one model family first).
  const deduplicatedFormResults = useMemo(() => {
    if (!isFormView || sourceTab === 'final') return [];
    if (sourceTab === 'manual') return formResultsByType;
    const source = effectiveModel
      ? formResultsByType.filter((r) => modelFamily(r.model_name) === effectiveModel)
      : formResultsByType;
    const byDoc = new Map<string, typeof formResults[0]>();
    for (const r of source) {
      const existing = byDoc.get(r.document_id);
      if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
        byDoc.set(r.document_id, r);
      }
    }
    return Array.from(byDoc.values());
  }, [formResultsByType, isFormView, sourceTab, effectiveModel]);

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
  // Suffix-aware: built from the project's full document list, so the label
  // here is character-for-character the one the Documents screen shows.
  // documentLabel() on its own cannot know a second "Mehlisch 2010" exists.
  const docLabels = useMemo(() => buildLabelMap(documentsList), [documentsList]);

  /**
   * Per-form coverage, for the picker's paper counts and completeness bars.
   *
   * Same query key `/extractions` uses, so this is normally a cache hit rather
   * than a second round trip. Completeness here is DOCUMENT coverage
   * (extracted / total), the same definition FormCoverageRow shows on that page —
   * field-level completeness would mean fetching every result for every form
   * just to draw a list.
   */
  const { data: coverageData = [] } = useQuery({
    queryKey: ['extraction-coverage', selectedProject?.id],
    queryFn: () => extractionsService.getCoverage(selectedProject!.id),
    enabled: !!selectedProject,
  });
  const coverageByForm = useMemo(() => {
    const m: Record<string, FormCoverage> = {};
    for (const c of coverageData) m[c.form_id] = c;
    return m;
  }, [coverageData]);

  /**
   * Who holds a manual row on what, with no extracted values.
   *
   * This is how the form list knows its contributors, its "last activity" and
   * whether anything is still a draft, for a whole project in one request.
   * `GET /results` cannot answer it: it is paginated at 50 by default, newest
   * first, so in a project with thousands of AI rows every manual row falls off
   * the page. Same endpoint the manual-extraction queue uses, same query key,
   * so this is normally a cache hit.
   */
  const { data: resultsStatus } = useQuery({
    queryKey: ['results-status', selectedProject?.id],
    queryFn: () => resultsService.getStatus({ projectId: selectedProject!.id }),
    enabled: !!selectedProject,
    staleTime: 30 * 1000,
  });
  const manualStatus = useMemo(() => resultsStatus?.manual ?? [], [resultsStatus]);

  /**
   * The edit log: who changed which field of which paper, when.
   *
   * Project-wide rather than per-form, because the form list draws a card for
   * every form and each one needs its own recent activity. Blinded server-side —
   * `old_value`/`new_value` are the extracted values themselves.
   */
  const { data: activityData } = useQuery({
    queryKey: ['results-activity', selectedProject?.id],
    queryFn: () => resultsService.getActivity({ projectId: selectedProject!.id, limit: 500 }),
    enabled: !!selectedProject,
    staleTime: 30 * 1000,
  });
  const activityEntries = useMemo(() => activityData?.entries ?? [], [activityData]);

  /**
   * The seat each person actually holds, per paper — `review_assignments`.
   *
   * This has to come from the assignment, not from `extraction_results.
   * reviewer_role`, which is documented as "a denormalised label, never a key"
   * and goes stale: on the live Analgesics Calibration project Esther is
   * assigned reviewer_2 on both papers, yet 2 of her 7 saved rows carry NULL.
   * Reading the column made Results label an assigned R2 as "Extra" while
   * Allocations — which reads the assignment — correctly showed R2. Same source
   * now, so the two screens cannot disagree.
   *
   * `reviewer_slots.effective_role()` is the backend's equivalent of this map.
   */
  const { data: assignments = [] } = useQuery({
    queryKey: ['project-assignments', selectedProject?.id],
    queryFn: () => assignmentsService.getProjectAssignments(selectedProject!.id).catch(() => []),
    enabled: !!selectedProject,
    staleTime: 60 * 1000,
  });

  const seatOf = useMemo(() => buildSeatResolver(assignments), [assignments]);

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
        setPdfFilename(docLabels[documentId] ?? documentLabel(documentsMap[documentId]));
      } catch {
        toast({ title: 'Error', description: 'Failed to load PDF', variant: 'error' });
        return;
      }
    }
    sourceLink.scrollToField(fieldName);
  }, [pdfViewerDocId, documentsMap, docLabels, sourceLink, toast]);

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
    // Design-inapplicable fields leave the denominator entirely: they are not
    // gaps in the paper. Everything else counts as filled only when it is not a
    // reporting gap — this screen used to count "NR" as filled here while the
    // flagged-paper logic below counted the same cell as empty.
    const considered = allFieldNames.filter(f => !fieldIsNotApplicable(result.extracted_data[f]));
    const total = considered.length;
    const filled = considered.filter(f => !fieldIsEmpty(result.extracted_data[f])).length;
    return { filled, total, pct: total > 0 ? Math.round((filled / total) * 100) : 0 };
  }, [allFieldNames]);

  // ── Flagged papers (more than half their fields empty) ──────────────────────
  const flaggedOnly = searchParams.get('flagged') === '1';

  const isResultFlagged = useCallback((r: ExtractionResult) => {
    // Mirrors the backend's _flagged_more_than_half_empty, including taking
    // inapplicable fields out of the denominator so a routed form (RoB 2) is
    // not reported as a badly extracted paper.
    const considered = allFieldNames.filter(f => !fieldIsNotApplicable(r.extracted_data[f]));
    if (considered.length === 0) return false;
    const empty = considered.filter(f => fieldIsEmpty(r.extracted_data[f])).length;
    return empty * 2 > considered.length; // strictly more than half empty
  }, [allFieldNames]);

  const flaggedResults = useMemo(() => results.filter(isResultFlagged), [results, isResultFlagged]);
  const flaggedDocIds = useMemo(() => flaggedResults.map(r => r.document_id), [flaggedResults]);
  const flaggedSet = useMemo(() => new Set(flaggedDocIds), [flaggedDocIds]);

  // The extraction to retry against: the selected run, or the form's latest run.
  const retryExtractionId = useMemo(() => {
    if (selectedExtractionId) return selectedExtractionId;
    if (formIdParam) {
      const runs = allExtractions
        .filter((e: Extraction) => e.form_id === formIdParam)
        .sort((a: Extraction, b: Extraction) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return runs[0]?.id || '';
    }
    return '';
  }, [selectedExtractionId, formIdParam, allExtractions]);

  const setFlaggedFilter = (on: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (on) params.set('flagged', '1'); else params.delete('flagged');
    router.push(`/results?${params.toString()}`, { scroll: false });
  };

  const handleRetryFlagged = async () => {
    if (!retryExtractionId || flaggedDocIds.length === 0) return;
    try {
      await extractionsService.retryFailed(retryExtractionId, flaggedDocIds);
      toast({
        title: 'Retrying',
        description: `Re-extracting ${flaggedDocIds.length} flagged ${flaggedDocIds.length === 1 ? 'paper' : 'papers'} as a new run`,
        variant: 'success',
      });
      // Mark the Run Extraction page's coverage stale so it refetches on mount
      // and shows the new run's LIVE card immediately (no 15s poll delay).
      queryClient.invalidateQueries({ queryKey: ['extraction-coverage', selectedProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['extractions-with-forms', selectedProject?.id] });
      router.push('/extractions');
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to start retry'), variant: 'error' });
    }
  };

  // Sort results
  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      const da = documentsMap[a.document_id];
      const db = documentsMap[b.document_id];
      // Sorted by study ID, which is what the cards actually show.
      const la = docLabels[a.document_id] ?? documentLabel(da);
      const lb = docLabels[b.document_id] ?? documentLabel(db);
      if (sortKey === 'doc_name_asc') return la.localeCompare(lb);
      if (sortKey === 'doc_name_desc') return lb.localeCompare(la);
      if (sortKey === 'date_newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortKey === 'date_oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortKey === 'completeness_high') return getCompleteness(b).filled - getCompleteness(a).filled;
      if (sortKey === 'completeness_low') return getCompleteness(a).filled - getCompleteness(b).filled;
      return 0;
    });
  }, [results, documentsMap, docLabels, sortKey, getCompleteness]);

  // Filter for cards view
  /**
   * All filtering happens here, and every filter is DOCUMENT-level.
   *
   * Keep it that way. `LongFormatTable` indexes its source-evidence chips by row
   * position and draws paper boundaries by assuming one paper's rows are
   * contiguous. Both hold only because filters remove whole papers — a row-level
   * predicate would leave rows in the table the user cannot see, and every chip
   * would silently open the wrong cell.
   */
  const filteredResults = useMemo(() => {
    let base = sortedResults;
    // Whole rows, so the contiguity rule above still holds: one result IS one
    // person's answers for one paper, and dropping some leaves every surviving
    // paper's rows together.
    if (personParam) base = base.filter(r => (r as any).extracted_by === personParam);
    if (flaggedOnly) base = base.filter(r => flaggedSet.has(r.document_id));
    if (activeTags.length > 0) base = base.filter(r => matchesTags(documentsMap[r.document_id]?.labels));
    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase();
    return base.filter(r => {
      if ((docLabels[r.document_id] ?? documentLabel(documentsMap[r.document_id])).toLowerCase().includes(q)) return true;
      if ((documentsMap[r.document_id]?.filename || '').toLowerCase().includes(q)) return true;
      if ((documentsMap[r.document_id]?.labels ?? []).some(l => l.toLowerCase().includes(q))) return true;
      return Object.values(r.extracted_data).some(v => extractScalarValue(v).toLowerCase().includes(q));
    });
  }, [sortedResults, searchQuery, documentsMap, docLabels, flaggedOnly, flaggedSet, activeTags, matchesTags, personParam]);

  /**
   * Row count for the stats line. The same pure transform the table runs, on the
   * same inputs — computed twice rather than plumbed through, so the two stay
   * decoupled and cannot disagree. Memoised on both sides, so it only recomputes
   * when the filter or sort changes.
   */
  const longRowCount = useMemo(() => {
    if (filteredResults.length === 0) return 0;
    if (formFields.length === 0) return filteredResults.length;
    return transformToLongFormat(filteredResults, formFields, documentsMap).rows.length;
  }, [filteredResults, formFields, documentsMap]);

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

  /**
   * Picker groups, derived from the form name rather than authored anywhere:
   * "Acute Dental Pain — Continuous Outcomes" groups under "Acute Dental Pain"
   * and shows as "Continuous Outcomes". Names with no dash keep their full name
   * and fall into a trailing group. With only one group the headers are noise,
   * so the render skips them.
   */
  const pickerGroups = useMemo(() => {
    type Entry = (typeof formsWithResults)[number] & { displayName: string };
    const grouped = new Map<string, Entry[]>();
    const loose: Entry[] = [];
    for (const f of formsWithResults) {
      const parts = f.formName.split(/\s+[—–]\s+/);
      if (parts.length > 1) {
        const label = parts[0].trim();
        const arr = grouped.get(label) ?? [];
        arr.push({ ...f, displayName: parts.slice(1).join(' — ').trim() || f.formName });
        grouped.set(label, arr);
      } else {
        loose.push({ ...f, displayName: f.formName });
      }
    }
    const out = Array.from(grouped.entries()).map(([label, forms]) => ({ label, forms }));
    if (loose.length > 0) out.push({ label: 'Other forms', forms: loose });
    return out;
  }, [formsWithResults]);

  // ── Comparing AI runs ───────────────────────────────────────────────────────

  /** This form's AI runs, newest first. `at` is the run's earliest row, which
   *  is now stable: a retry used to reset `created_at` on the row it replaced
   *  (fixed in `migrations/fix_ai_retry_preserves_created_at.sql`). */
  const aiRuns = useMemo(() => {
    if (!isFormView || sourceTab !== 'ai') return [];
    const byRun = new Map<string, { id: string; at: string; model: string | null; docs: number }>();
    for (const r of formResultsByType) {
      const id = r.extraction_id;
      if (!id) continue;
      const seen = byRun.get(id);
      if (!seen) {
        byRun.set(id, { id, at: r.created_at, model: r.model_name ?? null, docs: 1 });
      } else {
        seen.docs += 1;
        if (r.created_at < seen.at) seen.at = r.created_at;
      }
    }
    return Array.from(byRun.values()).sort((a, b) => b.at.localeCompare(a.at));
  }, [formResultsByType, isFormView, sourceTab]);

  /**
   * Each run, plus **how many papers it can actually be compared against**.
   *
   * `docs` (how many papers the run holds) is a fact about the RUN, and it is
   * not what a reader needs — they need to know what the comparison will DO.
   * The two differ most exactly where it matters: on Periodontitis' "Patient
   * Population" the newest run holds 29 papers and can be compared against 0,
   * because "All runs" shows each paper's newest row and that run supplied
   * every one of them. Offering it marked zero cells with nothing to say why.
   *
   *   comparable = papers on screen that this run also has a row for,
   *                MINUS the papers this run is the one supplying
   *
   * One number, and it covers the partial case too: a run that only ever
   * touched 3 of 29 papers reports 3. This also subsumes the old
   * `effectiveExtractionId` filter — a single run's own view scores 0 by
   * construction — so that special case is gone.
   */
  const comparableRuns = useMemo(() => {
    if (!isFormView || sourceTab !== 'ai') return [];
    const shownRunByDoc = new Map<string, string | null>();
    for (const r of results) shownRunByDoc.set(r.document_id, r.extraction_id ?? null);

    const papersByRun = new Map<string, Set<string>>();
    for (const r of formResultsByType) {
      if (!r.extraction_id) continue;
      let set = papersByRun.get(r.extraction_id);
      if (!set) { set = new Set(); papersByRun.set(r.extraction_id, set); }
      set.add(r.document_id);
    }

    return aiRuns.map(run => {
      const papers = papersByRun.get(run.id) ?? new Set<string>();
      let comparable = 0;
      let supplies = 0;
      for (const [doc, shownRun] of shownRunByDoc) {
        if (shownRun === run.id) supplies += 1;
        else if (papers.has(doc)) comparable += 1;
      }
      return { ...run, comparable, supplies };
    });
  }, [aiRuns, results, formResultsByType, isFormView, sourceTab]);

  /** The runs worth offering. */
  const usableRuns = useMemo(
    () => comparableRuns.filter(r => r.comparable > 0),
    [comparableRuns],
  );
  /** Runs left out because every paper they hold is already the shown answer. */
  const alreadyShownRuns = useMemo(
    () => comparableRuns.filter(r => r.comparable === 0 && r.supplies > 0).length,
    [comparableRuns],
  );

  /** Papers currently on screen — the denominator in "covers N of M papers". */
  const papersOnScreen = useMemo(
    () => new Set(results.map(r => r.document_id)).size,
    [results],
  );

  /**
   * Each paper's PREVIOUS row — the baseline that actually answers "did the
   * last run change anything".
   *
   * Naming a single run as the baseline sounds right and mostly is not: the
   * form view shows each paper's latest row, which is a MIXTURE of runs, so
   * comparing it against one run is a no-op for every paper that run produced
   * and undefined for every paper it did not touch. Measured on the live demo
   * form: picking its newest run marked zero cells even though all five shared
   * papers differ, because those five papers were being displayed FROM that
   * run. Per paper, "the row before this one" has no such ambiguity — and it is
   * the AI analogue of `provenance.prior_value` on the manual side.
   */
  const previousRunRows = useMemo(() => {
    const byDoc = new Map<string, typeof formResultsByType>();
    for (const r of formResultsByType) {
      const list = byDoc.get(r.document_id);
      if (list) list.push(r); else byDoc.set(r.document_id, [r]);
    }
    const out: typeof formResultsByType = [];
    for (const list of byDoc.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
      out.push(sorted[1]);
    }
    return out;
  }, [formResultsByType]);

  /**
   * One run's values, keyed `documentId|rowIndexWithinPaper|column`.
   *
   * Rows are paired by POSITION within a paper, which is the same rule
   * `UnifiedFieldCard.computeRowDiff` uses on the consensus screen: "Pairing on
   * the composite key instead would change which cells are flagged, and that is
   * a data-semantics decision needing its own verification." So a run that
   * returned a different number of table rows will pair the tail wrongly — the
   * banner says so rather than pretending otherwise.
   */
  const baselineCells = useMemo(() => {
    if (!compareRunId || !isFormView || sourceTab === 'final') return null;
    const rows = compareRunId === PREV_RUN
      ? previousRunRows
      : formResultsByType.filter(r => r.extraction_id === compareRunId);
    if (rows.length === 0) return null;
    const out: Record<string, string> = {};
    const nth: Record<string, number> = {};
    for (const row of transformToLongFormat(rows, formFields, documentsMap).rows) {
      const doc = row._documentId;
      const i = (nth[doc] = (nth[doc] ?? -1) + 1);
      for (const [col, val] of Object.entries(row)) {
        if (col.startsWith('_')) continue;
        // Only real display values. A `String(object)` here rendered
        // "[object Object]" as a previous value on the live demo form — a few
        // parent-table subfield columns can carry a non-scalar, and a value the
        // transform could not flatten is not one a reader can compare.
        if (typeof val !== 'string' && typeof val !== 'number') continue;
        out[`${doc}|${i}|${col}`] = String(val);
      }
    }
    return out;
  }, [compareRunId, previousRunRows, formResultsByType, formFields, documentsMap, isFormView, sourceTab]);

  /**
   * What one cell has said across every run. Computed on click rather than
   * pre-indexed: a form with 82 fields over 15 runs is tens of thousands of
   * cells, and the panel only ever needs one of them.
   */
  const runHistoryFor = useCallback((documentId: string, rowIndex: number, column: string) => {
    const out: { runId: string; at: string; model: string | null; value: string }[] = [];
    for (const run of aiRuns) {
      const rows = formResultsByType.filter(
        r => r.extraction_id === run.id && r.document_id === documentId,
      );
      if (rows.length === 0) continue;
      const lrows = transformToLongFormat(rows, formFields, documentsMap).rows;
      const row = lrows[rowIndex];
      if (!row) continue;
      out.push({ runId: run.id, at: run.at, model: run.model, value: String(row[column] ?? '') });
    }
    return out;
  }, [aiRuns, formResultsByType, formFields, documentsMap]);

  const setCompareRun = useCallback((runId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (runId) params.set('vs', runId); else params.delete('vs');
    router.push(`/results?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // ── The people layer on the form list ───────────────────────────────────────
  //
  // Three sources, each answering something the others cannot:
  //   · `manualStatus`  — who holds a row, and whether it is still a draft.
  //     Covers rows saved before the edit log existed, so it is the only
  //     complete contributor list.
  //   · `activityEntries` — what actually changed, and when.
  //   · `coverageByForm`  — document coverage, for the completeness bar.

  const eventsByForm = useMemo(() => {
    const m: Record<string, typeof activityEntries> = {};
    for (const e of activityEntries) {
      if (!e.form_id) continue;
      (m[e.form_id] ??= []).push(e);
    }
    return m;
  }, [activityEntries]);

  const manualByForm = useMemo(() => {
    const m: Record<string, typeof manualStatus> = {};
    for (const r of manualStatus) (m[r.form_id] ??= []).push(r);
    return m;
  }, [manualStatus]);

  /**
   * Everyone who appears anywhere in this project's results — the filter chips.
   *
   * Deliberately NOT the member list: a project can carry fifty members and two
   * extractors, and a filter offering forty-eight rows that match nothing is
   * worse than no filter.
   */
  const activePeople = useMemo(() => {
    const seen = new Map<string, Person>();
    const add = (id: string | null, name?: string | null, email?: string | null) => {
      if (!id || seen.has(id)) return;
      const p = personOf(id, { name, email });
      if (p) seen.set(id, p);
    };
    for (const r of manualStatus) add(r.extracted_by, r.reviewer_name, null);
    for (const e of activityEntries) add(e.user_id, e.user_name, e.user_email);
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [manualStatus, activityEntries, personOf]);

  const cutoff = useMemo(() => windowStart(activity.filters.days), [activity.filters.days]);

  const buildCard = useCallback((
    formId: string,
    displayName: string,
    runs: number,
    latestRunAt: string,
  ): FormCardData => {
    const rows = manualByForm[formId] ?? [];
    const events = eventsByForm[formId] ?? [];
    const cov = coverageByForm[formId];
    const totalDocs = cov?.total_project_documents ?? 0;

    // One contribution per person, carrying the seat they used and how many
    // recorded edits they made. A person who saved a row before the edit log
    // existed still appears, with no count.
    const byPerson = new Map<string, FormContribution>();
    for (const r of rows) {
      const person = personOf(r.extracted_by, { name: r.reviewer_name });
      if (!person) continue;
      byPerson.set(person.userId, {
        person,
        role: seatOf(person.userId, r.document_id, r.reviewer_role),
        edits: byPerson.get(person.userId)?.edits ?? 0,
      });
    }
    for (const e of events) {
      const person = personOf(e.user_id, { name: e.user_name, email: e.user_email });
      if (!person) continue;
      const existing = byPerson.get(person.userId);
      byPerson.set(person.userId, {
        person,
        // A person holds one seat per paper, so the assignment wins over the
        // row's stale label — and over whichever row happened to be seen last,
        // which is what made one card show "Extra" and another "R2" for the
        // same reviewer on the same project.
        role: existing?.role ?? seatOf(person.userId, e.document_id, e.reviewer_role),
        edits: (existing?.edits ?? 0) + 1,
      });
    }
    const contributions = Array.from(byPerson.values())
      .sort((a, b) => b.edits - a.edits || a.person.name.localeCompare(b.person.name));

    const lastManualAt = rows.reduce<string | null>(
      (acc, r) => (r.updated_at && (!acc || r.updated_at > acc) ? r.updated_at : acc),
      null,
    );
    const lastEventAt = events.reduce<string | null>(
      (acc, e) => (!acc || e.created_at > acc ? e.created_at : acc),
      null,
    );
    const lastActivityAt = [lastManualAt, lastEventAt, latestRunAt]
      .filter(Boolean)
      .sort()
      .pop() ?? null;

    return {
      formId,
      displayName,
      papers: totalDocs || null,
      runs,
      lastActivityAt,
      pct: totalDocs > 0 ? Math.round(((cov?.extracted_count ?? 0) / totalDocs) * 100) : null,
      papersExtracted: totalDocs > 0 ? (cov?.extracted_count ?? 0) : null,
      // Any draft still open means somebody is mid-paper. No rows at all means
      // unknown, NOT finished — see the note on `completion`.
      completion: rows.length === 0 ? null : rows.some(r => r.is_partial) ? 'progress' : 'complete',
      contributors: contributions.map(c => c.person),
      contributions,
      // Stamp each event with the resolved seat, so the chip on an activity row
      // says the same thing as the chip on the person above it.
      events: events.map(e => ({
        ...e,
        reviewer_role: seatOf(e.user_id, e.document_id, e.reviewer_role),
      })),
    };
  }, [manualByForm, eventsByForm, coverageByForm, personOf, seatOf]);

  /**
   * Does this card survive the filter bar?
   *
   * Returns the card with its events narrowed, or null. Narrowing matters: with
   * a person or a time window selected, a card whose events all fall outside it
   * has nothing to show and is dropped rather than rendered empty.
   */
  const applyActivityFilters = useCallback((card: FormCardData): FormCardData | null => {
    const { q, personId, completion } = activity.filters;
    // A form with no visible manual row matches neither state.
    if (completion !== 'all' && card.completion !== completion) return null;

    /**
     * Holding a row and having a recorded edit are two different things here,
     * and the person filter has to honour both.
     *
     * The canvas dropped a form as soon as no *event* survived the filter,
     * because its mock gave every user events. In the real data the edit log
     * only starts where the provenance work shipped: on the live Demo project
     * one reviewer has 7 manual rows and 0 audit entries. Filtering to that
     * person under the canvas rule returned "nothing matches" and erased all
     * seven — the same class of bug as a reviewer's saved work reading as
     * un-started, which is what `/results/status` exists to prevent.
     */
    const contributes = card.contributions.some(c => c.person.userId === personId);

    let events = card.events;
    if (cutoff !== null) events = events.filter(e => new Date(e.created_at).getTime() >= cutoff);
    if (personId !== 'all') events = events.filter(e => e.user_id === personId);

    const needle = q.trim().toLowerCase();
    if (needle) {
      const nameMatches = card.displayName.toLowerCase().includes(needle);
      const personMatches = card.contributions.some(c =>
        c.person.name.toLowerCase().includes(needle)
        || (c.person.email ?? '').toLowerCase().includes(needle));
      const matching = events.filter(e => {
        const copy = describeActivity(e);
        return [
          e.user_name, e.user_email, e.study_label, e.field_name,
          copy.summary, copy.diff?.from, copy.diff?.to,
        ].some(v => (v ?? '').toLowerCase().includes(needle));
      });
      // A form survives on its name, on one of its people, or on an event.
      if (!nameMatches && !personMatches && matching.length === 0) return null;
      // Narrow the feed only when the match came from the feed — searching a
      // form by name should not hide the rest of its history.
      if (!nameMatches && !personMatches) events = matching;
    }

    if (personId !== 'all' && !contributes && events.length === 0) return null;

    if (cutoff !== null && events.length === 0) {
      // No edits in the window. The form still belongs here if it was itself
      // touched inside it — a row saved before the edit log existed still has
      // an `updated_at`.
      const touchedAt = card.lastActivityAt ? new Date(card.lastActivityAt).getTime() : null;
      if (touchedAt === null || touchedAt < cutoff) return null;
    }

    if (personId !== 'all') {
      const contributions = card.contributions.filter(c => c.person.userId === personId);
      return { ...card, events, contributions, contributors: contributions.map(c => c.person) };
    }
    return { ...card, events };
  }, [activity.filters, cutoff]);

  /** Absent from the map means "follow the filter": filtering for a person and
   *  then having to click four cards to find their work defeats the filter. */
  const expandedFor = useCallback(
    (formId: string) => expandedForms[formId] ?? activity.active,
    [expandedForms, activity.active],
  );
  const toggleForm = useCallback(
    (formId: string) => setExpandedForms(prev => ({
      ...prev,
      [formId]: !(prev[formId] ?? activity.active),
    })),
    [activity.active],
  );

  /** Cards per picker group, filtered. Groups that empty out are not rendered. */
  const cardGroups = useMemo(() => {
    return pickerGroups
      .map(group => ({
        label: group.label,
        cards: group.forms
          .map(f => applyActivityFilters(
            buildCard(f.formId, f.displayName, f.extractionCount, f.latestDate),
          ))
          .filter((c): c is FormCardData => c !== null),
      }))
      .filter(g => g.cards.length > 0);
  }, [pickerGroups, buildCard, applyActivityFilters]);

  const visibleCardCount = useMemo(
    () => cardGroups.reduce((n, g) => n + g.cards.length, 0),
    [cardGroups],
  );

  // ── The people layer on the detail view ─────────────────────────────────────

  /** Who produced the rows currently on screen, for the toolbar's avatar stack. */
  const viewContributors = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const r of results) {
      const person = personOf((r as any).extracted_by);
      if (person && !seen.has(person.userId)) seen.set(person.userId, person);
    }
    return Array.from(seen.values());
  }, [results, personOf]);

  /** Newest edit on the form being viewed. */
  const viewLastActivity = useMemo(() => {
    if (!formIdParam) return null;
    const events = eventsByForm[formIdParam] ?? [];
    return events.reduce<string | null>(
      (acc, e) => (!acc || e.created_at > acc ? e.created_at : acc),
      null,
    );
  }, [eventsByForm, formIdParam]);

  // Show form picker when no form_id or extraction_id in URL
  const showFormPicker = !isFormView && !extractionIdParam;

  if (!selectedProject) {
    return (
      <DashboardLayout title="Results" description="View and export extraction results">
        <EmptyState
          icon={FolderOpen}
          title="No project selected"
          description="Create or open a project to view extraction results."
          action={{ label: 'Go to projects', onClick: () => router.push('/projects') }}
        />
      </DashboardLayout>
    );
  }

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
          <div className="flex flex-col gap-5">
            {/* Search people, papers and fields; narrow by person, time and
                completion. The Manual tab only: a model run has no contributor
                and no edit log, so on the AI tab every one of these controls
                would filter on data that does not exist. */}
            {sourceTab === 'manual' && (
              <ActivityFilterBar
                filters={activity.filters}
                set={activity.set}
                people={activePeople}
              />
            )}

            {visibleCardCount === 0 ? (
              <DashedEmpty
                title="Nothing matches those filters"
                description="No form has activity from that person in that period. Clear a filter to widen the search."
              />
            ) : (
              <div className="flex flex-col gap-6">
                {cardGroups.map(group => (
                  <div key={group.label}>
                    {cardGroups.length > 1 && (
                      <div className="flex items-center gap-2 mb-3">
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-900 dark:bg-white flex-shrink-0" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
                          {group.label}
                        </span>
                        <span className="flex-1 h-px bg-gray-100 dark:bg-[#1f1f1f]" />
                        <span className="text-xs text-gray-400 dark:text-zinc-500 flex-shrink-0">
                          {group.cards.length} form{group.cards.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col gap-2.5">
                      {group.cards.map(card => (
                        <FormResultsCard
                          key={card.formId}
                          data={card}
                          expanded={expandedFor(card.formId)}
                          onToggle={() => toggleForm(card.formId)}
                          onOpen={() => router.push(
                            `/results?form_id=${card.formId}${sourceTab === 'ai' ? '' : `&tab=${sourceTab}`}`,
                          )}
                          onOpenPerson={(userId) => router.push(
                            `/results?form_id=${card.formId}&tab=${sourceTab}&person=${userId}`,
                          )}
                          showPeople={sourceTab === 'manual'}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      ) : loading && extractions.length === 0 && !isFormView ? (
        <div className="flex justify-center items-center py-12"><Spinner size="lg" /></div>
      ) : !isFormView && extractions.length === 0 ? (
        <DashedEmpty
          title={sourceTab === 'ai' ? 'No AI extractions' : 'No manual extractions'}
          description={sourceTab === 'ai' ? 'Run an extraction first to see results here.' : 'Use Manual Extract to add results.'}
        />
      ) : (
        <div className="flex flex-col gap-5">

          {/* Retry banner */}
          {failedDocIds.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40">
              <span className="text-sm text-amber-700 dark:text-amber-400">
                ⚠ {failedDocIds.length} paper{failedDocIds.length !== 1 ? 's' : ''} failed to extract.
              </span>
              {can_run_extractions && (
                <button
                  onClick={handleRetryFailed}
                  className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-amber-200 dark:hover:bg-amber-900/40"
                >
                  Retry Failed Papers
                </button>
              )}
            </div>
          )}

          {/* Flagged papers banner */}
          {flaggedResults.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40">
              <span className="flex items-center gap-3 min-w-0">
                <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-xs flex-shrink-0">
                  <AlertCircle className="w-3.5 h-3.5" />
                </span>
                <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {flaggedResults.length} {flaggedResults.length === 1 ? 'paper has' : 'papers have'} more than half their fields empty{flaggedOnly ? ' — showing only these' : ''}.
                </span>
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setFlaggedFilter(!flaggedOnly)}
                  className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-100/60 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-amber-200 dark:hover:bg-amber-900/40"
                >
                  {flaggedOnly ? 'Show all' : `View ${flaggedResults.length} flagged`}
                </button>
                {can_run_extractions && retryExtractionId && (
                  <button
                    onClick={handleRetryFlagged}
                    className="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
                  >
                    Retry all flagged
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Back to the picker — the form select below switches forms, this leaves them */}
          {isFormView && (
            <button
              onClick={() => router.push('/results')}
              className="self-start -mb-3 text-xs font-semibold text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors cursor-pointer"
            >
              ← All forms
            </button>
          )}

          {/* Whose answers you are looking at, and the way back to everyone's.
              Without this the table silently hides the other reviewer's rows
              and there is no clue why. */}
          {personParam && (() => {
            const who = personOf(personParam);
            return (
              <div className="flex items-center gap-2 self-start rounded-full border border-gray-200 bg-white py-1 pl-1 pr-2.5 dark:border-[#2a2a2a] dark:bg-[#111111]">
                {who && <Avatar email={who.avatarKey} name={who.name} size="xs" />}
                <span className="text-[12px] text-gray-600 dark:text-zinc-400">
                  Showing only{' '}
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {who?.name ?? 'one reviewer'}
                  </span>
                  &apos;s answers
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.delete('person');
                    router.push(`/results?${params.toString()}`, { scroll: false });
                  }}
                  title="Show everyone's answers"
                  className="ml-0.5 rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-500 dark:hover:bg-[#1f1f1f]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })()}

          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Extraction picker / Form label */}
            <div className="flex items-center gap-2 min-w-0">
              {isFormView ? (
                <div className="flex items-center gap-3 flex-wrap">
                  {/* The form name IS the form switcher — a heading you can change. */}
                  <div className="relative">
                    <select
                      value={formIdParam ?? ''}
                      onChange={e => { if (e.target.value) router.push(`/results?form_id=${e.target.value}`); }}
                      className="max-w-[420px] appearance-none truncate bg-transparent text-[17px] font-bold tracking-tight text-gray-900 dark:text-white border border-transparent rounded-lg py-1 pl-1.5 pr-7 -ml-1.5 outline-none cursor-pointer hover:border-gray-200 dark:hover:border-[#2a2a2a] hover:bg-white dark:hover:bg-[#111111] transition-colors dark:[color-scheme:dark]"
                    >
                      {!formsWithResults.some(f => f.formId === formIdParam) && (
                        <option value={formIdParam ?? ''}>{currentForm?.form_name || 'All runs combined'}</option>
                      )}
                      {formsWithResults.map(f => (
                        <option key={f.formId} value={f.formId}>{f.formName}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                  </div>
                  <span className="text-xs text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                    {/* `filteredResults`, not `results`: with a person filter on, the
                        unfiltered count claimed rows that are not on screen. Still
                        counting result ROWS rather than documents — one paper can
                        carry a row per reviewer — so it is named that way now. */}
                    {filteredResults.length} {filteredResults.length === 1 ? 'row' : 'rows'} · {allFieldNames.length} fields
                  </span>
                  {/* One model, one tag. The table badges rows individually only when
                      they actually differ; when several models ran, the chip row below
                      names them, so a badge here would just repeat it. */}
                  {sourceTab === 'ai' && (() => {
                    const models = [...new Set(filteredResults.map(r => r.model_name).filter(Boolean) as string[])];
                    if (models.length !== 1) return null;
                    return (
                      <Badge className={cn('border-0 font-semibold tracking-tight shadow-sm', modelTagTheme(models[0]))}>
                        {formatModelName(models[0])}
                      </Badge>
                    );
                  })()}
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
                  {/* Model tag — which LLM produced these AI results (one per run) */}
                  {sourceTab === 'ai' && (() => {
                    const models = [...new Set(filteredResults.map(r => r.model_name).filter(Boolean) as string[])];
                    if (models.length === 0) return null;
                    if (models.length === 1) {
                      return <Badge className={cn('border-0 font-semibold tracking-tight shadow-sm', modelTagTheme(models[0]))}>{formatModelName(models[0])}</Badge>;
                    }
                    return (
                      <Badge variant="secondary" title={models.map(formatModelName).join(', ')}>
                        Mixed ({models.length} models)
                      </Badge>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="flex-1" />

            {/* Who produced what is on screen. The design puts this beside the
                export, which is the right place: it is the provenance of the
                thing you are about to download. */}
            {!loading && viewContributors.length > 0 && (
              <div className="flex items-center gap-2.5">
                <AvatarStack people={viewContributors} size="sm" />
                {viewLastActivity && (
                  <span className="whitespace-nowrap text-[11px] text-gray-400 dark:text-zinc-500">
                    last edit <TimeAgo at={viewLastActivity} />
                  </span>
                )}
              </div>
            )}

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

          {/* Per-model toggle — latest result per paper, by model (All runs view) */}
          {isFormView && sourceTab === 'ai' && modelFamiliesInForm.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap py-1">
              <span className="text-[11px] text-gray-400 dark:text-zinc-500 mr-1 whitespace-nowrap">
                {effectiveModel
                  ? `Showing latest ${FAMILY_LABEL[effectiveModel]} results`
                  : 'Latest per paper by model'}
              </span>
              <ModelChip
                label="All models"
                active={!effectiveModel}
                onClick={() => setSelectedModel(null)}
                title="Show each paper's latest result, whichever model produced it"
              />
              {modelFamiliesInForm.map(fam => (
                <ModelChip
                  key={fam}
                  label={FAMILY_LABEL[fam]}
                  active={effectiveModel === fam}
                  theme={modelTagTheme(fam)}
                  onClick={() => setSelectedModel(prev => (prev === fam ? null : fam))}
                  title={`Show each paper's latest ${FAMILY_LABEL[fam]} result`}
                />
              ))}
            </div>
          )}

          {/* Compare with another run — the AI tab's version of "what changed".
              Only when there IS another run: 1,966 of 2,894 live paper+form
              pairs hold two or more, but the rest have nothing to compare. */}
          {isFormView && sourceTab === 'ai'
            && (usableRuns.length > 0 || previousRunRows.length > 0) && (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 dark:border-[#1f1f1f] dark:bg-[#111111]">
                <GitCompare className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 dark:text-zinc-500" />
                <select
                  value={compareRunId ?? ''}
                  onChange={e => setCompareRun(e.target.value || null)}
                  aria-label="Compare with an earlier run"
                  className="cursor-pointer appearance-none border-none bg-transparent pr-4 text-sm text-gray-700 outline-none dark:text-zinc-300 dark:[color-scheme:dark]"
                >
                  <option value="">Compare with…</option>
                  {previousRunRows.length > 0 && (
                    <option value={PREV_RUN}>
                      Each paper&apos;s previous run ({previousRunRows.length}{' '}
                      {previousRunRows.length === 1 ? 'paper' : 'papers'})
                    </option>
                  )}
                  {/* Only runs you can actually pick.
                      These were greyed out and left in place, so the reader
                      could see where the newest run went — sound for one or two
                      exclusions, and wrong at ten: Dental Implants' 27 papers
                      come from 10 of its 11 runs, which rendered ten lines of
                      "already shown" to offer ONE real choice. The count beside
                      the control answers "where did they go" in one line
                      instead. */}
                  {usableRuns.map(r => (
                    <option key={r.id} value={r.id}>
                      {new Date(r.at).toLocaleDateString()}{' '}
                      {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {r.model ? ` · ${formatModelName(r.model)}` : ''}
                      {` · covers ${r.comparable} of ${papersOnScreen} papers`}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-gray-400" />
              </div>
              {/* Where the other runs went, and — the more useful half — how
                  little of this form has a second answer at all. On Dental
                  Implants only 2 of 27 papers do, which is worth saying before
                  someone goes looking for changes that cannot exist. */}
              {!compareRunId && alreadyShownRuns > 0 && (
                <span className="text-[11px] text-gray-400 dark:text-zinc-500">
                  {alreadyShownRuns} earlier {alreadyShownRuns === 1 ? 'run is' : 'runs are'}{' '}
                  already the {alreadyShownRuns === 1 ? 'answer' : 'answers'} on screen
                  {previousRunRows.length > 0
                    ? `. ${previousRunRows.length} of ${papersOnScreen} papers have an earlier answer to compare.`
                    : '.'}
                </span>
              )}
              {/* A `?vs=` link can still name the run that is supplying the
                  screen — an old bookmark, or a URL shared before this list
                  learned to grey it out. Say so rather than showing a table
                  with nothing marked and no explanation. */}
              {compareRunId && compareRunId !== PREV_RUN
                && comparableRuns.some(r => r.id === compareRunId && r.comparable === 0) && (
                <>
                  <span className="text-[11px] text-amber-600 dark:text-amber-500">
                    Every paper from that run is already the answer on screen, so there is
                    nothing to compare. Pick an earlier run, or “each paper’s previous run”.
                  </span>
                  <button
                    type="button"
                    onClick={() => setCompareRun(PREV_RUN)}
                    className="text-[11px] font-semibold text-gray-500 hover:text-gray-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    Use previous run
                  </button>
                </>
              )}
              {compareRunId && baselineCells
                && !comparableRuns.some(r => r.id === compareRunId && r.comparable === 0) && (
                <>
                  <span className="text-[11px] text-gray-400 dark:text-zinc-500">
                    {compareRunId === PREV_RUN
                      ? 'Cells that moved since each paper’s previous run are marked with a bar and show what they said before.'
                      : 'Marked cells moved since that run. A paper you are already viewing FROM that run shows no change, and a paper it never touched shows none either.'}
                    {' '}Table rows pair by position, so a run with a different row count only
                    matches up to where they agree.
                  </span>
                  <button
                    type="button"
                    onClick={() => setCompareRun(null)}
                    className="text-[11px] font-semibold text-gray-500 hover:text-gray-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    Stop comparing
                  </button>
                </>
              )}
              {compareRunId && !baselineCells && (
                <span className="text-[11px] text-amber-600 dark:text-amber-500">
                  That run has no rows for this form.
                </span>
              )}
            </div>
          )}

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
                rowCount={longRowCount}
                activeTags={activeTags}
                onToggleTag={toggleTag}
                onClearTags={clearTags}
              />

              {/* Main view — with optional PDF panel */}
              <div className={cn('flex gap-4', pdfViewerDocId ? 'flex-row' : 'flex-col')}>
                <div className={cn(pdfViewerDocId ? 'flex-1 min-w-0' : 'w-full')}>
                  <LongFormatTable
                    results={filteredResults}
                    documentsMap={documentsMap}
                    formFields={formFields}
                    formId={selectedExtraction?.form_id ?? formIdParam ?? undefined}
                    flaggedDocIds={flaggedSet}
                    activeTags={activeTags}
                    onToggleTag={toggleTag}
                    projectId={selectedProject?.id}
                    personOf={
                      // Manual tab only. An AI row has no author — 0 of 60,091
                      // live AI cells carry a provenance block — so on that tab
                      // the "Show Authors" toggle was a button that did nothing.
                      // Withholding `personOf` is what hides it.
                      sourceTab === 'manual' ? personOf : undefined
                    }
                    seatOf={seatOf}
                    baselineCells={baselineCells}
                    runHistoryFor={runHistoryFor}
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

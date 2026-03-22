'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { AlertCircle, Loader2, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import { apiClient } from '@/lib/api';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { extractionsService, formsService, jobsService, documentsService } from '@/services';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { EmptyState, Button, Card } from '@/components/ui';
import type { Extraction, Form, Job, Document } from '@/types/api';
import { cn, getErrorMessage } from '@/lib/utils';
import { typography } from '@/lib/typography';
import {
  ExtractionStatsPanel,
  ExtractionFilterBar,
  ExtractionCard,
  RunExtractionDialog,
  type ExtractionFilterType,
  type PaperProgressState,
} from '@/components/extractions';

const ITEMS_PER_PAGE = 10;

export default function ExtractionsPage() {
  const { selectedProject } = useProject();
  const { can_run_extractions, can_view_results } = useProjectPermissions();
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [filter, setFilter] = useState<ExtractionFilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [paperProgress, setPaperProgress] = useState<Map<string, PaperProgressState>>(new Map());
  const wsConnsRef = useRef<Map<string, WebSocket>>(new Map());

  const queryKey = ['extractions', selectedProject?.id];

  const { data: extractions = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await extractionsService.getAll(selectedProject!.id);
      const jobPromises = data
        .filter((ext: Extraction) => ext.job_id)
        .map((ext: Extraction) => jobsService.getById(ext.job_id!).catch(() => null));
      const jobResults = await Promise.all(jobPromises);
      const jobsMap: Record<string, Job> = {};
      jobResults.forEach((job) => {
        if (job) jobsMap[job.id] = job;
      });
      setJobs(jobsMap);
      return data;
    },
    enabled: !!selectedProject,
    refetchInterval: 5000,
  });

  const { data: forms = [] } = useQuery({
    queryKey: ['forms', selectedProject?.id],
    queryFn: async () => {
      const data = await formsService.getAll(selectedProject!.id);
      return data.filter((f: Form) => f.status === 'active');
    },
    enabled: !!selectedProject,
  });

  const { data: allDocuments = [] } = useQuery({
    queryKey: ['documents', selectedProject?.id],
    queryFn: () => documentsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
  });

  // Build document name lookup
  const docNamesMap = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    allDocuments.forEach((d: Document) => docNamesMap.current.set(d.id, d.filename));
  }, [allDocuments]);

  // Build WS base URL
  const wsBaseUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const isLocal = /localhost|127\.0\.0\.1/.test(apiUrl);
    if (!isLocal && apiUrl.startsWith('http://')) return apiUrl.replace(/^http:\/\//, 'wss://');
    return apiUrl.replace(/^https?/, (s: string) => (s === 'https' ? 'wss' : 'ws'));
  }, []);

  // Manage WS connections for running extractions
  useEffect(() => {
    if (!wsBaseUrl) return;
    const token = apiClient.getToken();
    const runningJobIds = new Set<string>();

    extractions.forEach((ext: Extraction) => {
      if (ext.status === 'running' || ext.status === 'pending') {
        const job = ext.job_id ? jobs[ext.job_id] : null;
        if (job && (job.status === 'processing' || job.status === 'pending')) {
          runningJobIds.add(job.id);
        }
      }
    });

    runningJobIds.forEach((jobId) => {
      if (!wsConnsRef.current.has(jobId)) {
        const ws = new WebSocket(`${wsBaseUrl}/api/v1/ws/jobs/${jobId}`);
        ws.onopen = () => {
          if (token) ws.send(JSON.stringify({ type: 'auth', token }));
        };
        ws.onmessage = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'paper_done') {
              const docId: string = msg.document_id;
              const success: boolean = msg.success;
              const papersDone: number = msg.papers_done ?? 0;
              const papersTotal: number = msg.papers_total ?? 0;
              setPaperProgress((prev) => {
                const next = new Map(prev);
                const entry = next.get(jobId) ?? { done: 0, total: 0, papers: new Map() };
                const newPapers = new Map(entry.papers);
                newPapers.set(docId, success ? 'success' : 'failed');
                next.set(jobId, { done: papersDone, total: papersTotal, papers: newPapers });
                return next;
              });
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => ws.close();
        wsConnsRef.current.set(jobId, ws);
      }
    });

    wsConnsRef.current.forEach((ws, jobId) => {
      if (!runningJobIds.has(jobId)) {
        ws.close();
        wsConnsRef.current.delete(jobId);
      }
    });
  }, [extractions, jobs, wsBaseUrl]);

  useEffect(() => {
    const conns = wsConnsRef.current;
    return () => {
      conns.forEach((ws) => ws.close());
      conns.clear();
    };
  }, []);

  // Reset pagination on filter/search change
  useEffect(() => { setCurrentPage(1); }, [filter, searchQuery]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getFormName = (formId: string) => {
    const form = forms.find((f) => f.id === formId);
    return form?.form_name || 'Unknown Form';
  };

  const handleRetry = async (extractionId: string) => {
    try {
      await extractionsService.retryFailed(extractionId);
      toast({ title: 'Retrying', description: 'Retry job started for failed papers', variant: 'success' });
      queryClient.invalidateQueries({ queryKey });
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to start retry'), variant: 'error' });
    }
  };

  const handleCancel = async (extractionId: string) => {
    try {
      await extractionsService.cancel(extractionId);
      toast({ title: 'Cancelled', description: 'Extraction has been cancelled', variant: 'success' });
      queryClient.invalidateQueries({ queryKey });
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to cancel extraction'), variant: 'error' });
    }
  };

  const handleDelete = async (extractionId: string) => {
    try {
      await extractionsService.delete(extractionId);
      toast({ title: 'Deleted', description: 'Extraction deleted', variant: 'success' });
      queryClient.invalidateQueries({ queryKey });
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to delete extraction'), variant: 'error' });
    }
  };

  // Computed stats
  const stats = {
    running: extractions.filter((e) => e.status === 'running').length,
    queued: extractions.filter((e) => e.status === 'pending').length,
    completed: extractions.filter((e) => e.status === 'completed').length,
    failed: extractions.filter((e) => e.status === 'failed').length,
    cancelled: extractions.filter((e) => e.status === 'cancelled').length,
  };

  const filterCounts = {
    all: extractions.length,
    running: stats.running,
    pending: stats.queued,
    completed: stats.completed,
    failed: stats.failed,
    cancelled: stats.cancelled,
  };

  const activeExtractionCount = stats.running + stats.queued;

  // Filter and search
  const filteredExtractions = extractions.filter((e) => {
    const matchesFilter = filter === 'all' || e.status === filter;
    const matchesSearch = !searchQuery.trim() ||
      getFormName(e.form_id).toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  // Pagination
  const totalPages = Math.ceil(filteredExtractions.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedExtractions = filteredExtractions.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  // Grouping for "all" tab
  const grouped = filter === 'all' && !searchQuery.trim();
  const needsAttention = extractions.filter((e) => e.status === 'failed');
  const inProgress = extractions.filter((e) => e.status === 'running');
  const queued = extractions.filter((e) => e.status === 'pending');
  const completed = extractions.filter((e) => e.status === 'completed');
  const cancelled = extractions.filter((e) => e.status === 'cancelled');

  // Grouped "all" also uses pagination on the flat ordered list
  const allOrdered = [...needsAttention, ...inProgress, ...queued, ...completed, ...cancelled];
  const allTotalPages = Math.ceil(allOrdered.length / ITEMS_PER_PAGE);
  const allStartIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const allPaginated = allOrdered.slice(allStartIndex, allStartIndex + ITEMS_PER_PAGE);

  // Regroup the paginated slice for section headers
  const pgNeedsAttention = allPaginated.filter((e) => e.status === 'failed');
  const pgInProgress = allPaginated.filter((e) => e.status === 'running');
  const pgQueued = allPaginated.filter((e) => e.status === 'pending');
  const pgCompleted = allPaginated.filter((e) => e.status === 'completed');
  const pgCancelled = allPaginated.filter((e) => e.status === 'cancelled');

  if (!selectedProject) {
    return (
      <DashboardLayout title="Extractions">
        <EmptyState
          icon={AlertCircle}
          title="No Project Selected"
          description="Please create or select a project to run extractions"
          action={{ label: 'Go to Dashboard', onClick: () => router.push('/dashboard') }}
        />
      </DashboardLayout>
    );
  }

  if (!can_view_results) {
    return (
      <DashboardLayout title="Extractions">
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            You do not have permission to view extractions in this project.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const renderCard = (extraction: Extraction) => {
    const job = extraction.job_id ? jobs[extraction.job_id] : null;
    const pp = job ? paperProgress.get(job.id) ?? null : null;
    return (
      <ExtractionCard
        key={extraction.id}
        extraction={extraction}
        job={job}
        pp={pp}
        formName={getFormName(extraction.form_id)}
        docNamesMap={docNamesMap.current}
        canRunExtractions={can_run_extractions}
        isExpanded={expanded.has(extraction.id)}
        onToggle={() => toggle(extraction.id)}
        onRetry={() => handleRetry(extraction.id)}
        onCancel={() => handleCancel(extraction.id)}
        onDelete={() => handleDelete(extraction.id)}
        onViewResults={() => router.push(`/results?extraction_id=${extraction.id}`)}
        onNavigateToDetail={() => router.push(`/extractions/${extraction.id}`)}
      />
    );
  };

  const SectionHeader = ({
    label,
    count,
    dotCls,
    isFirst = false,
  }: {
    label: string;
    count: number;
    dotCls: string;
    isFirst?: boolean;
  }) =>
    count > 0 ? (
      <div className={cn('flex items-center gap-2 mb-4', isFirst ? 'mt-0' : 'mt-10')}>
        <div className={cn('w-1.5 h-1.5 rounded-full', dotCls)} />
        <span className={cn(typography.sectionHeader.default, 'text-gray-400')}>{label}</span>
        <span className={cn(typography.body.tiny, 'text-gray-300 dark:text-zinc-600')}>{count}</span>
      </div>
    ) : null;

  return (
    <DashboardLayout title="Extractions" description="Run and monitor extraction jobs">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : extractions.length === 0 ? (
        <EmptyState
          icon={Play}
          title="No extractions yet"
          description="Start your first extraction to see results here"
          action={
            can_run_extractions
              ? { label: 'Run New Extraction', onClick: () => setShowRunDialog(true) }
              : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          {/* Stats Panel */}
          <ExtractionStatsPanel stats={stats} onFilterChange={(f) => setFilter(f as ExtractionFilterType)} />

          {/* Filter Bar */}
          <ExtractionFilterBar
            filter={filter}
            counts={filterCounts}
            searchQuery={searchQuery}
            canRunExtractions={can_run_extractions}
            onFilterChange={setFilter}
            onSearchChange={setSearchQuery}
            onRunNew={() => setShowRunDialog(true)}
          />

          {/* Extraction List */}
          {filteredExtractions.length === 0 ? (
            <EmptyState
              icon={Play}
              title={searchQuery ? `No extractions matching "${searchQuery}"` : `No ${filter} extractions`}
              description={
                searchQuery
                  ? 'Try a different search term'
                  : `There are no ${filter === 'all' ? '' : filter + ' '}extractions at the moment`
              }
            />
          ) : grouped ? (
            /* Grouped view for "All" tab — paginated */
            (() => {
              const firstKey =
                pgNeedsAttention.length > 0 ? 'attention' :
                pgInProgress.length > 0 ? 'progress' :
                pgQueued.length > 0 ? 'queued' :
                pgCompleted.length > 0 ? 'completed' : 'cancelled';
              return (
                <>
                <div className="flex flex-col">
                  {pgNeedsAttention.length > 0 && (
                    <div>
                      <SectionHeader label="NEEDS ATTENTION" count={needsAttention.length} dotCls="bg-purple-500 animate-pulse" isFirst={firstKey === 'attention'} />
                      <div className="flex flex-col gap-3">{pgNeedsAttention.map(renderCard)}</div>
                    </div>
                  )}
                  {pgInProgress.length > 0 && (
                    <div>
                      <SectionHeader label="IN PROGRESS" count={inProgress.length} dotCls="bg-blue-500 animate-pulse" isFirst={firstKey === 'progress'} />
                      <div className="flex flex-col gap-3">{pgInProgress.map(renderCard)}</div>
                    </div>
                  )}
                  {pgQueued.length > 0 && (
                    <div>
                      <SectionHeader label="QUEUED" count={queued.length} dotCls="bg-amber-500" isFirst={firstKey === 'queued'} />
                      <div className="flex flex-col gap-3">{pgQueued.map(renderCard)}</div>
                    </div>
                  )}
                  {pgCompleted.length > 0 && (
                    <div>
                      <SectionHeader label="COMPLETED" count={completed.length} dotCls="bg-green-500" isFirst={firstKey === 'completed'} />
                      <div className="flex flex-col gap-3">{pgCompleted.map(renderCard)}</div>
                    </div>
                  )}
                  {pgCancelled.length > 0 && (
                    <div>
                      <SectionHeader label="CANCELLED" count={cancelled.length} dotCls="bg-gray-400" isFirst={firstKey === 'cancelled'} />
                      <div className="flex flex-col gap-3">{pgCancelled.map(renderCard)}</div>
                    </div>
                  )}
                </div>

                {/* Pagination */}
                {allTotalPages > 1 && (
                  <Card className="p-3 mt-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-600 dark:text-zinc-400">
                        <span className="font-medium text-gray-900 dark:text-white">{allStartIndex + 1}</span>
                        {' – '}
                        <span className="font-medium text-gray-900 dark:text-white">
                          {Math.min(allStartIndex + ITEMS_PER_PAGE, allOrdered.length)}
                        </span>
                        {' of '}
                        <span className="font-medium text-gray-900 dark:text-white">{allOrdered.length}</span>
                        {' extractions'}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="h-8 w-8 p-0"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-xs text-gray-600 dark:text-zinc-400 min-w-[80px] text-center">
                          Page <span className="font-semibold text-gray-900 dark:text-white">{currentPage}</span> of {allTotalPages}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.min(allTotalPages, p + 1))}
                          disabled={currentPage === allTotalPages}
                          className="h-8 w-8 p-0"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}
                </>
              );
            })()
          ) : (
            /* Flat paginated list for filtered tabs */
            <>
              <div className="flex flex-col gap-3">
                {paginatedExtractions.map(renderCard)}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <Card className="p-3 dark:bg-[#111111] dark:border-[#1f1f1f]">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-600 dark:text-zinc-400">
                      <span className="font-medium text-gray-900 dark:text-white">{startIndex + 1}</span>
                      {' – '}
                      <span className="font-medium text-gray-900 dark:text-white">
                        {Math.min(startIndex + ITEMS_PER_PAGE, filteredExtractions.length)}
                      </span>
                      {' of '}
                      <span className="font-medium text-gray-900 dark:text-white">{filteredExtractions.length}</span>
                      {' extractions'}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="h-8 w-8 p-0"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs text-gray-600 dark:text-zinc-400 min-w-[80px] text-center">
                        Page <span className="font-semibold text-gray-900 dark:text-white">{currentPage}</span> of {totalPages}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="h-8 w-8 p-0"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* Run Extraction Dialog */}
      <RunExtractionDialog
        isOpen={showRunDialog}
        onClose={() => setShowRunDialog(false)}
        forms={forms}
        projectId={selectedProject.id}
        activeExtractionCount={activeExtractionCount}
        queryKey={queryKey}
      />
    </DashboardLayout>
  );
}

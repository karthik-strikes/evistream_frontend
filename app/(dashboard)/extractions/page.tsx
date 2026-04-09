'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { AlertCircle, Loader2, Play, Search } from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import { apiClient } from '@/lib/api';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { extractionsService, formsService, documentsService } from '@/services';
import type { FormCoverage } from '@/services/extractions.service';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { EmptyState, TooltipSimple } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Form, Document } from '@/types/api';
import { getErrorMessage } from '@/lib/utils';
import {
  RunExtractionDialog,
  ActiveStatusLine,
  FormCoverageRow,
  type PaperProgressState,
} from '@/components/extractions';

export default function ExtractionsPage() {
  const { selectedProject } = useProject();
  const { can_run_extractions, can_view_results } = useProjectPermissions();
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [showRunDialog, setShowRunDialog] = useState(false);
  const [runDialogInitialFormId, setRunDialogInitialFormId] = useState<string | undefined>();
  const [runDialogInitialDocIds, setRunDialogInitialDocIds] = useState<string[] | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [paperProgress, setPaperProgress] = useState<Map<string, PaperProgressState>>(new Map());
  const wsConnsRef = useRef<Map<string, WebSocket>>(new Map());

  const coverageQueryKey = ['extraction-coverage', selectedProject?.id];
  // Bug fix #6: Use ref so WebSocket closure always has latest query key
  const coverageQueryKeyRef = useRef(coverageQueryKey);
  coverageQueryKeyRef.current = coverageQueryKey;

  // Fetch per-form coverage data
  const { data: coverageData = [], isLoading } = useQuery({
    queryKey: coverageQueryKey,
    queryFn: () => extractionsService.getCoverage(selectedProject!.id),
    enabled: !!selectedProject,
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      // Fast poll when jobs are active, slow poll otherwise to catch newly started extractions
      return data.some((c: FormCoverage) => c.active_jobs.length > 0) ? 5000 : 15000;
    },
  });

  // Fetch forms for the Run Extraction dialog
  const { data: forms = [] } = useQuery({
    queryKey: ['forms', selectedProject?.id],
    queryFn: async () => {
      const data = await formsService.getAll(selectedProject!.id);
      return data.filter((f: Form) => f.status === 'active');
    },
    enabled: !!selectedProject,
  });

  // Fetch all documents (needed for "Run Remaining" to compute which docs haven't been extracted)
  const { data: allDocuments = [] } = useQuery({
    queryKey: ['documents', selectedProject?.id],
    queryFn: () => documentsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
  });

  // Build docNamesMap from all documents for the running card to show filenames
  const docNamesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const doc of allDocuments) {
      map.set(doc.id, doc.filename || doc.id);
    }
    return map;
  }, [allDocuments]);

  // Count active extractions (for RunExtractionDialog's concurrency warning)
  const activeExtractionCount = coverageData.reduce(
    (sum, c) => sum + c.active_jobs.length, 0
  );

  // Build WS base URL
  const wsBaseUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const isLocal = /localhost|127\.0\.0\.1/.test(apiUrl);
    if (!isLocal && apiUrl.startsWith('http://')) return apiUrl.replace(/^http:\/\//, 'wss://');
    return apiUrl.replace(/^https?/, (s: string) => (s === 'https' ? 'wss' : 'ws'));
  }, []);

  // Manage WS connections for active jobs
  useEffect(() => {
    if (!wsBaseUrl) return;
    const token = apiClient.getToken();
    const activeJobIds = new Set<string>();

    for (const form of coverageData) {
      for (const job of form.active_jobs) {
        if (job.status === 'processing' || job.status === 'pending') {
          activeJobIds.add(job.job_id);
        }
      }
    }

    activeJobIds.forEach((jobId) => {
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
            } else if (msg.type === 'complete') {
              queryClient.invalidateQueries({ queryKey: coverageQueryKeyRef.current });
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => ws.close();
        wsConnsRef.current.set(jobId, ws);
      }
    });

    // Clean up connections for jobs that are no longer active
    // Collect keys first to avoid modifying map during iteration
    const toRemove: string[] = [];
    wsConnsRef.current.forEach((ws, jobId) => {
      if (!activeJobIds.has(jobId)) {
        ws.close();
        toRemove.push(jobId);
      }
    });
    toRemove.forEach((jobId) => wsConnsRef.current.delete(jobId));
  }, [coverageData, wsBaseUrl]);

  // Cleanup on unmount
  useEffect(() => {
    const conns = wsConnsRef.current;
    return () => {
      conns.forEach((ws) => ws.close());
      conns.clear();
    };
  }, []);

  // Actions
  const handleRetryFailed = async (formId: string) => {
    const form = coverageData.find((c) => c.form_id === formId);
    if (!form?.latest_failed_extraction_id) return;
    try {
      await extractionsService.retryFailed(form.latest_failed_extraction_id);
      toast({ title: 'Retrying', description: 'Retry started for failed papers', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: coverageQueryKey });
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to start retry'), variant: 'error' });
    }
  };

  const handleCancel = async (extractionId: string) => {
    try {
      await extractionsService.cancel(extractionId);
      toast({ title: 'Cancelled', description: 'Extraction has been cancelled', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: coverageQueryKey });
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to cancel'), variant: 'error' });
    }
  };

  const handleRunRemaining = (formId: string) => {
    const form = coverageData.find((c) => c.form_id === formId);
    if (!form) return;
    // Compute remaining doc IDs: all project docs minus extracted and failed
    const doneIds = new Set([
      ...(form.extracted_document_ids || []),
      ...(form.failed_document_ids || []),
    ]);
    const allDocIds = allDocuments
      .filter((d) => d.processing_status === 'completed')
      .map((d) => d.id);
    const remainingIds = allDocIds.filter((id) => !doneIds.has(id));

    setRunDialogInitialFormId(formId);
    setRunDialogInitialDocIds(remainingIds);
    setShowRunDialog(true);
  };

  const handleViewResults = (formId: string) => {
    router.push(`/results?form_id=${formId}`);
  };

  const handleRowClick = (formId: string) => {
    const form = coverageData.find((c) => c.form_id === formId);
    if (!form) return;

    if (form.extracted_count > 0) {
      // Has results → show data
      router.push(`/results?form_id=${formId}`);
    } else if (form.failed_count > 0 && form.latest_extraction_id) {
      // All failed, nothing extracted → show error details
      router.push(`/extractions/${form.latest_extraction_id}`);
    }
    // Running/queued with no prior results → don't navigate (progress visible on row)
  };

  // Filter by search
  const filteredCoverage = coverageData.filter((c) =>
    !searchQuery.trim() ||
    c.form_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!selectedProject) return null;

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

  return (
    <DashboardLayout title="Extractions" description="Extract data from papers using your forms">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : coverageData.length === 0 ? (
        <EmptyState
          icon={Play}
          title="No extractions yet"
          description="Start your first extraction to see results here"
          action={
            can_run_extractions
              ? { label: 'Run New Extraction', onClick: () => { setRunDialogInitialFormId(undefined); setRunDialogInitialDocIds(undefined); setShowRunDialog(true); } }
              : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Active status line */}
          <ActiveStatusLine coverageData={coverageData} />

          {/* Search + Run button */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search forms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-zinc-600"
              />
            </div>
            {can_run_extractions ? (
              <button
                onClick={() => { setRunDialogInitialFormId(undefined); setRunDialogInitialDocIds(undefined); setShowRunDialog(true); }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100"
              >
                <Play className="h-3.5 w-3.5" />
                Run New Extraction
              </button>
            ) : (
              <TooltipSimple text='You need the "Run Extractions" permission'>
                <button
                  disabled
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-gray-200 dark:bg-[#2a2a2a] text-gray-400 dark:text-zinc-600 cursor-not-allowed"
                >
                  <Play className="h-3.5 w-3.5" />
                  Run New Extraction
                </button>
              </TooltipSimple>
            )}
          </div>

          {/* Form coverage rows */}
          {filteredCoverage.length === 0 ? (
            <EmptyState
              icon={Search}
              title={`No forms matching "${searchQuery}"`}
              description="Try a different search term"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {filteredCoverage.map((coverage) => (
                <FormCoverageRow
                  key={coverage.form_id}
                  coverage={coverage}
                  paperProgress={paperProgress}
                  docNamesMap={docNamesMap}
                  canRunExtractions={can_run_extractions}
                  onRetryFailed={handleRetryFailed}
                  onRunRemaining={handleRunRemaining}
                  onCancel={handleCancel}
                  onViewResults={handleViewResults}
                  onClick={handleRowClick}
                />
              ))}
            </div>
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
        queryKey={coverageQueryKey}
        coverageData={coverageData}
        initialFormId={runDialogInitialFormId}
        initialDocIds={runDialogInitialDocIds}
      />
    </DashboardLayout>
  );
}

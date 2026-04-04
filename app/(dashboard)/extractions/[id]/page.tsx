'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { Card, Button, Alert } from '@/components/ui';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Clock,
  Download,
  AlertCircle,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';
import { extractionsService, jobsService, resultsService, formsService, documentsService } from '@/services';
import { useQueryClient } from '@tanstack/react-query';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { useToast } from '@/hooks/use-toast';
import { formatDate, cn, getErrorMessage } from '@/lib/utils';
import type { ExtractionResult } from '@/types/api';
import { ExtractionStatusBadge } from '@/components/extractions';
import { JobLogsWebSocket, type LogMessage } from '@/services/jobLogsWebSocket';
import { apiClient } from '@/lib/api';

type TabType = 'papers' | 'logs' | 'export';

function formatDuration(startAt: string | null, endAt?: string | null): string {
  if (!startAt) return '—';
  const start = new Date(startAt).getTime();
  const end = endAt ? new Date(endAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export default function ExtractionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { selectedProject } = useProject();
  const { can_run_extractions } = useProjectPermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const extractionId = params.id as string;

  const [activeTab, setActiveTab] = useState<TabType>('papers');
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [isExportingCSV, setIsExportingCSV] = useState(false);
  const [isExportingJSON, setIsExportingJSON] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<JobLogsWebSocket | null>(null);

  // Fetch extraction
  const { data: extraction, isLoading: loadingExtraction } = useQuery({
    queryKey: ['extraction', extractionId],
    queryFn: () => extractionsService.getById(extractionId),
    enabled: !!extractionId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'running' || s === 'pending' ? 3000 : false;
    },
  });

  // Fetch associated job
  const { data: job, isLoading: isLoadingJob } = useQuery({
    queryKey: ['job', extraction?.job_id],
    queryFn: () => jobsService.getById(extraction!.job_id!),
    enabled: !!extraction?.job_id,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'processing' || s === 'pending' ? 3000 : false;
    },
  });

  // Fetch per-document results
  const { data: results = [], isLoading: loadingResults } = useQuery({
    queryKey: ['results', extractionId],
    queryFn: () => resultsService.getAll({ extractionId }),
    enabled: !!extractionId,
  });

  // Fetch form name
  const { data: forms = [] } = useQuery({
    queryKey: ['forms', selectedProject?.id],
    queryFn: () => formsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
  });

  // Fetch documents for name lookup
  const { data: allDocuments = [] } = useQuery({
    queryKey: ['documents', selectedProject?.id],
    queryFn: () => documentsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
  });

  const docNamesMap = new Map<string, string>();
  allDocuments.forEach((d: any) => docNamesMap.set(d.id, d.filename));

  const formName = extraction
    ? forms.find((f: any) => f.id === extraction.form_id)?.form_name ?? 'Unknown Form'
    : '—';

  // Connect WebSocket for live logs when extraction is running
  useEffect(() => {
    if (!extraction?.job_id || (extraction.status !== 'running' && extraction.status !== 'pending')) {
      return;
    }
    const token = apiClient.getToken() ?? undefined;
    const ws = new JobLogsWebSocket(extraction.job_id, {
      onLog: (msg) => setLogs((prev) => [...prev, msg]),
      onStage: (msg) => setLogs((prev) => [...prev, msg]),
      onProgress: (msg) => setLogs((prev) => [...prev, msg]),
      onComplete: () => {
        queryClient.invalidateQueries({ queryKey: ['extraction', extractionId] });
        queryClient.invalidateQueries({ queryKey: ['extractions', extraction.project_id] });
      },
    });
    ws.connect(token);
    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [extraction?.job_id, extraction?.status]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleExportCSV = async () => {
    if (!extractionId) return;
    try {
      setIsExportingCSV(true);
      const blob = await resultsService.exportCSV({ extractionId });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `extraction-${extractionId.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: 'Export Failed', description: getErrorMessage(error, 'Failed to export CSV'), variant: 'error' });
    } finally {
      setIsExportingCSV(false);
    }
  };

  const handleExportJSON = async () => {
    if (!extractionId) return;
    try {
      setIsExportingJSON(true);
      const blob = await resultsService.exportJSON({ extractionId });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `extraction-${extractionId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: 'Export Failed', description: getErrorMessage(error, 'Failed to export JSON'), variant: 'error' });
    } finally {
      setIsExportingJSON(false);
    }
  };

  const handleRetryFailed = async () => {
    try {
      setIsRetrying(true);
      await extractionsService.retryFailed(extractionId);
      toast({ title: 'Retrying', description: 'Failed papers queued for re-extraction.' });
      queryClient.invalidateQueries({ queryKey: ['extraction', extractionId] });
      queryClient.invalidateQueries({ queryKey: ['extractions'] });
    } catch (error: any) {
      toast({ title: 'Retry Failed', description: getErrorMessage(error, 'Could not retry failed papers'), variant: 'error' });
    } finally {
      setIsRetrying(false);
    }
  };

  // Derived stats
  const totalDocs: number = job?.result_data?.total_documents ?? job?.input_data?.document_ids?.length ?? results.length;
  const successCount: number = job?.result_data?.successful_extractions ?? results.length;
  const failedDocIds: string[] = job?.result_data?.failed_document_ids ?? [];
  const hasPartialFailure = extraction?.status === 'completed' && failedDocIds.length > 0;
  const canRunExtractions = can_run_extractions;
  const duration = isLoadingJob && extraction?.job_id
    ? '...'
    : formatDuration(job?.started_at ?? null, job?.completed_at);

  const toggleResultExpanded = (id: string) => {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Group results by document
  const resultsByDoc = new Map<string, ExtractionResult>();
  results.forEach((r) => resultsByDoc.set(r.document_id, r));

  const logLevelCls = (level?: string) => {
    switch (level) {
      case 'success': return 'text-green-600 dark:text-green-400';
      case 'warning': return 'text-amber-600 dark:text-amber-400';
      case 'error': return 'text-purple-600 dark:text-purple-400';
      default: return 'text-gray-500 dark:text-zinc-400';
    }
  };

  if (loadingExtraction) {
    return (
      <DashboardLayout title="Extraction Detail">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </DashboardLayout>
    );
  }

  if (!extraction) {
    return (
      <DashboardLayout title="Extraction Detail">
        <Alert variant="error" title="Not Found">
          Extraction not found.
        </Alert>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title={`Extraction: ${formName}`}
      description={`ID: ${extractionId.slice(0, 8)}...`}
    >
      <div className="space-y-6">
        {/* Back button */}
        <button
          onClick={() => router.push('/extractions')}
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white bg-transparent border-none cursor-pointer transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Extractions
        </button>

        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className={cn(
            'p-4 dark:border-[#1f1f1f]',
            hasPartialFailure
              ? 'border-l-[3px] border-l-amber-400 bg-amber-50/50 dark:bg-amber-950/20 dark:bg-[#111111]'
              : 'dark:bg-[#111111]',
          )}>
            <p className="text-xs text-gray-500 dark:text-zinc-500 mb-1">Status</p>
            <div className="flex items-center gap-2">
              {hasPartialFailure ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Partial ({successCount}/{totalDocs})
                </span>
              ) : (
                <ExtractionStatusBadge status={extraction.status} />
              )}
            </div>
          </Card>
          <Card className="p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
            <p className="text-xs text-gray-500 dark:text-zinc-500 mb-1">Documents</p>
            <p className="text-2xl font-bold dark:text-white">{totalDocs}</p>
            {failedDocIds.length > 0 && (
              <p className="text-xs text-red-500 mt-0.5">{failedDocIds.length} failed</p>
            )}
          </Card>
          <Card className="p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
            <p className="text-xs text-gray-500 dark:text-zinc-500 mb-1">Duration</p>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-400" />
              <p className="text-xl font-bold dark:text-white">{duration}</p>
            </div>
          </Card>
        </div>

        {/* Metadata */}
        <Card className="p-5 dark:bg-[#111111] dark:border-[#1f1f1f]">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500 dark:text-zinc-500">Form</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">{formName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-zinc-500">Started</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">
                {job?.started_at ? formatDate(job.started_at) : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-zinc-500">Completed</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">
                {job?.completed_at ? formatDate(job.completed_at) : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-zinc-500">Extraction ID</p>
              <p className="text-xs font-mono text-gray-900 dark:text-white mt-0.5 break-all">{extractionId}</p>
            </div>
            {totalDocs > 0 && successCount > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-zinc-500">Success Rate</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">
                  {successCount}/{totalDocs} ({Math.round((successCount / totalDocs) * 100)}%)
                </p>
              </div>
            )}
            {job?.id && (
              <div>
                <p className="text-xs text-gray-500 dark:text-zinc-500">Job ID</p>
                <p className="text-xs font-mono text-gray-900 dark:text-white mt-0.5 break-all">{job.id}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Tabs */}
        <Card className="dark:bg-[#111111] dark:border-[#1f1f1f] overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 pt-4 border-b border-gray-100 dark:border-[#1f1f1f]">
            {(['papers', 'logs', 'export'] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-none cursor-pointer',
                  activeTab === tab
                    ? 'bg-white dark:bg-[#111111] text-gray-900 dark:text-white border-b-2 border-b-gray-900 dark:border-b-white -mb-px'
                    : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 bg-transparent',
                )}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-5">
            {/* Papers tab */}
            {activeTab === 'papers' && (
              <div>
                {loadingResults ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : results.length === 0 && failedDocIds.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-400">
                    No results yet.{' '}
                    {(extraction.status === 'running' || extraction.status === 'pending') &&
                      'Extraction is in progress...'}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Successful results */}
                    {results.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-600 font-medium mb-2">
                          Extracted — {results.length}
                        </p>
                        {results.map((result) => {
                          const isExpanded = expandedResults.has(result.id);
                          const fields = Object.entries(result.extracted_data);
                          return (
                            <div key={result.id}>
                              <button
                                onClick={() => toggleResultExpanded(result.id)}
                                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-gray-50 dark:bg-[#1a1a1a] border border-gray-100 dark:border-[#2a2a2a] cursor-pointer hover:bg-gray-100 dark:hover:bg-[#222222] transition-colors text-left"
                              >
                                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-900 dark:text-white truncate">
                                    {docNamesMap.get(result.document_id) ?? result.document_id}
                                  </p>
                                </div>
                                <span className="text-xs text-gray-400 flex-shrink-0">
                                  {fields.length} fields
                                </span>
                                <ChevronDown
                                  className={cn(
                                    'w-3.5 h-3.5 text-gray-300 dark:text-zinc-600 transition-transform duration-150 flex-shrink-0',
                                    isExpanded && 'rotate-180',
                                  )}
                                />
                              </button>
                              {isExpanded && fields.length > 0 && (
                                <div className="ml-7 mt-1 mb-2 px-3.5 py-3 rounded-lg bg-gray-100/60 dark:bg-[#0d0d0d] border border-gray-100 dark:border-[#1f1f1f]">
                                  <div className="grid grid-cols-1 gap-2">
                                    {fields.map(([key, value]) => (
                                      <div key={key} className="flex items-start gap-3">
                                        <span className="text-[11px] font-medium text-gray-400 dark:text-zinc-500 min-w-[120px] flex-shrink-0 pt-0.5 truncate">
                                          {key}
                                        </span>
                                        <span className="text-xs text-gray-700 dark:text-zinc-300 break-words leading-relaxed">
                                          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '—')}
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
                    )}

                    {/* Failed documents */}
                    {failedDocIds.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-500 font-medium">
                            Failed — {failedDocIds.length}
                          </p>
                          {canRunExtractions && (
                            <button
                              onClick={handleRetryFailed}
                              disabled={isRetrying}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 px-2 py-1 rounded-md border border-amber-200 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-400/20 transition-colors disabled:opacity-50"
                            >
                              {isRetrying ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3" />
                              )}
                              {isRetrying ? 'Retrying...' : 'Retry failed'}
                            </button>
                          )}
                        </div>
                        {failedDocIds.map((docId) => (
                          <div
                            key={docId}
                            className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-900/10 border border-amber-200/60 dark:border-amber-700/30"
                          >
                            <XCircle className="w-4 h-4 text-amber-500 dark:text-amber-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-amber-700 dark:text-amber-400 truncate">
                                {docNamesMap.get(docId) ?? docId}
                              </p>
                            </div>
                            <span className="text-xs text-amber-500 dark:text-amber-500 flex-shrink-0 font-medium">Failed</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Logs tab */}
            {activeTab === 'logs' && (
              <div>
                {logs.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-400">
                    {extraction.status === 'running' || extraction.status === 'pending'
                      ? 'Connecting to live log stream...'
                      : 'No logs available for this extraction.'}
                  </div>
                ) : (
                  <div className="bg-gray-50 dark:bg-[#0a0a0a] rounded-lg border border-gray-100 dark:border-[#1f1f1f] p-4 max-h-[400px] overflow-y-auto font-mono text-xs space-y-1">
                    {logs.map((log, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-gray-400 flex-shrink-0 tabular-nums">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        {log.level && (
                          <span className={cn('font-semibold uppercase flex-shrink-0 text-[10px]', logLevelCls(log.level))}>
                            [{log.level}]
                          </span>
                        )}
                        <span className="text-gray-700 dark:text-zinc-300 break-words">{log.message}</span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            )}

            {/* Export tab */}
            {activeTab === 'export' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-zinc-400">
                  Download extraction results in your preferred format.
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleExportCSV}
                    disabled={isExportingCSV || extraction.status !== 'completed'}
                    className="flex items-center gap-2"
                  >
                    {isExportingCSV ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    Download CSV
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleExportJSON}
                    disabled={isExportingJSON || extraction.status !== 'completed'}
                    className="flex items-center gap-2"
                  >
                    {isExportingJSON ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    Download JSON
                  </Button>
                </div>
                {extraction.status !== 'completed' && (
                  <p className="text-xs text-gray-400 dark:text-zinc-500">
                    Export is only available for completed extractions.
                  </p>
                )}
                {extraction.status === 'completed' && (
                  <div className="pt-4 border-t border-gray-100 dark:border-[#1f1f1f]">
                    <Button
                      variant="secondary"
                      onClick={() => router.push(`/results?extraction_id=${extractionId}`)}
                      className="flex items-center gap-2"
                    >
                      <FileText className="h-4 w-4" />
                      View Full Results Table
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

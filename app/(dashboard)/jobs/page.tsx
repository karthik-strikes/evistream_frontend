'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout';
import { Card, Badge, Button, Progress, EmptyState, Alert } from '@/components/ui';
import {
  PlayCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  X,
  FileText,
  Code,
  Database,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  Ban,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import { jobsService } from '@/services';
import { useToast } from '@/hooks/use-toast';
import { useJobWebSocket } from '@/hooks/useJobWebSocket';
import { formatDate, cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import type { Job } from '@/types/api';

export default function JobsPage() {
  const { selectedProject } = useProject();
  const { toast } = useToast();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'processing' | 'pending' | 'completed' | 'failed' | 'cancelled'>('all');
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  const fetchJobs = useCallback(async () => {
    if (!selectedProject) return;

    try {
      const data = await jobsService.getAll(selectedProject.id);
      setJobs(data);
    } catch (error: any) {
      console.error('Error fetching jobs:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  // Find the first active job for WebSocket connection
  const activeJob = jobs.find(j => j.status === 'pending' || j.status === 'processing');
  const hasActiveJobs = !!activeJob;

  // WebSocket for real-time updates on active jobs
  const { connected: wsConnected } = useJobWebSocket({
    jobId: activeJob?.id ?? null,
    enabled: hasActiveJobs,
    onMessage: () => {
      // Refresh the full list when we get a WS update
      fetchJobs();
    },
  });

  useEffect(() => {
    fetchJobs();

    // Poll at longer interval when WebSocket is connected, shorter when not
    const pollInterval = wsConnected && hasActiveJobs ? 10000 : 3000;
    const interval = setInterval(fetchJobs, pollInterval);
    return () => clearInterval(interval);
  }, [fetchJobs, wsConnected, hasActiveJobs]);

  const handleCancel = async (jobId: string) => {
    try {
      await jobsService.cancel(jobId);
      toast({
        title: 'Job Cancelled',
        description: 'The extraction job has been cancelled',
        variant: 'success',
      });
      fetchJobs();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.response?.data?.detail || 'Failed to cancel job',
        variant: 'error',
      });
    }
  };

  const toggleJobExpand = (jobId: string) => {
    setExpandedJobs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(jobId)) {
        newSet.delete(jobId);
      } else {
        newSet.add(jobId);
      }
      return newSet;
    });
  };

  const getJobTypeIcon = (jobType: Job['job_type']) => {
    switch (jobType) {
      case 'pdf_processing':
        return <FileText className="h-5 w-5 text-purple-600" />;
      case 'form_generation':
        return <Code className="h-5 w-5 text-indigo-600" />;
      case 'extraction':
        return <Database className="h-5 w-5 text-zinc-700" />;
      default:
        return <PlayCircle className="h-5 w-5 text-gray-600" />;
    }
  };

  const getJobTypeLabel = (jobType: Job['job_type']) => {
    switch (jobType) {
      case 'pdf_processing':
        return 'PDF Processing';
      case 'form_generation':
        return 'Code Generation';
      case 'extraction':
        return 'Extraction';
      default:
        return jobType;
    }
  };

  const getStatusIcon = (status: Job['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 text-zinc-700 animate-spin" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-purple-600" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-yellow-600" />;
      case 'cancelled':
        return <Ban className="h-5 w-5 text-gray-500" />;
      default:
        return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: Job['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-zinc-100 text-zinc-900';
      case 'failed':
        return 'bg-purple-100 text-purple-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-600';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredJobs = filter === 'all'
    ? jobs
    : jobs.filter(job => job.status === filter);

  // Organize jobs into sections
  const needsAttentionJobs = jobs.filter(j => j.status === 'failed');
  const inProgressJobs = jobs.filter(j => j.status === 'processing' || j.status === 'pending');
  const completedJobs = jobs.filter(j => j.status === 'completed' || j.status === 'cancelled');

  // Apply filter to sections
  const getFilteredSection = (sectionJobs: Job[]) => {
    if (filter === 'all') return sectionJobs;
    return sectionJobs.filter(job => job.status === filter);
  };

  // Pagination calculations
  const totalPages = Math.ceil(filteredJobs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedJobs = filteredJobs.slice(startIndex, endIndex);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  const stats = {
    processing: jobs.filter(j => j.status === 'processing').length,
    pending: jobs.filter(j => j.status === 'pending').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
    cancelled: jobs.filter(j => j.status === 'cancelled').length,
  };

  if (!selectedProject) {
    return (
      <DashboardLayout title="Jobs Monitor">
        <EmptyState
          icon={PlayCircle}
          title="No Project Selected"
          description="Please select a project to view jobs"
          action={{
            label: 'Go to Dashboard',
            onClick: () => router.push('/dashboard'),
          }}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title="Jobs Monitor"
      description="Track all extraction jobs in real-time"
    >
      <div className="space-y-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-zinc-100 dark:bg-zinc-800 p-2">
                <Loader2 className="h-5 w-5 text-zinc-700 dark:text-zinc-300" />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{stats.processing}</p>
                <p className="text-sm text-gray-600 dark:text-[#c0c0c0]">Processing</p>
              </div>
            </div>
          </Card>

          <Card className="p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-yellow-100 dark:bg-yellow-900/30 p-2">
                <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{stats.pending}</p>
                <p className="text-sm text-gray-600 dark:text-[#c0c0c0]">Pending</p>
              </div>
            </div>
          </Card>

          <Card className="p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-2">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{stats.completed}</p>
                <p className="text-sm text-gray-600 dark:text-[#c0c0c0]">Completed</p>
              </div>
            </div>
          </Card>

          <Card className="p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-purple-100 dark:bg-purple-900/30 p-2">
                <XCircle className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{stats.failed}</p>
                <p className="text-sm text-gray-600 dark:text-[#c0c0c0]">Failed</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Auto-refresh indicator */}
        {(stats.processing > 0 || stats.pending > 0) && (
          <Alert variant="info" title="Live Monitoring">
            {wsConnected ? (
              <span className="flex items-center gap-1"><Wifi className="h-3 w-3" /> Connected via WebSocket - real-time updates active.</span>
            ) : (
              <span className="flex items-center gap-1"><WifiOff className="h-3 w-3" /> Polling every 3 seconds for updates.</span>
            )}
          </Alert>
        )}

        {/* Filter Tabs */}
        <Card className="p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
          <div className="flex items-center gap-2 overflow-x-auto">
            {(['all', 'processing', 'pending', 'completed', 'failed', 'cancelled'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors whitespace-nowrap ${
                  filter === status
                    ? 'bg-black text-white dark:bg-white dark:text-black'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-[#1a1a1a] dark:text-[#c0c0c0] dark:hover:bg-[#222222]'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
                {status !== 'all' && ` (${stats[status]})`}
              </button>
            ))}
          </div>
        </Card>

        {/* Jobs List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : filteredJobs.length === 0 ? (
          <EmptyState
            icon={PlayCircle}
            title={filter === 'all' ? 'No jobs yet' : `No ${filter} jobs`}
            description={
              filter === 'all'
                ? 'Start an extraction to see jobs here'
                : `There are no ${filter} jobs at the moment`
            }
            action={
              filter === 'all'
                ? {
                    label: 'Start Extraction',
                    onClick: () => router.push('/extractions'),
                  }
                : undefined
            }
          />
        ) : filter === 'all' ? (
          /* In Progress Section Only */
          <div>
            {getFilteredSection(inProgressJobs).length > 0 ? (
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <span className="text-xs font-semibold text-gray-400 tracking-wider">
                    IN PROGRESS
                  </span>
                  <span className="text-xs text-gray-300">
                    {getFilteredSection(inProgressJobs).length}
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {getFilteredSection(inProgressJobs).map((job) => {
                    const getStatusStyle = () => {
                      switch (job.status) {
                        case 'processing':
                          return { bg: "#eff6ff", border: "#bfdbfe", color: "#2563eb", label: "Processing" };
                        case 'pending':
                          return { bg: "#fefce8", border: "#fde68a", color: "#ca8a04", label: "Pending" };
                        default:
                          return { bg: "#f3f4f6", border: "#e5e7eb", color: "#6b7280", label: "Unknown" };
                      }
                    };

                    const s = getStatusStyle();

                    return (
                      <div
                        key={job.id}
                        className="bg-white rounded-xl border border-border py-5 px-[22px] relative transition-all duration-150 hover:shadow-card-hover hover:-translate-y-px dark:bg-[#111111] dark:border-[#1f1f1f]"
                      >
                        <div className="flex items-start justify-between gap-4">
                          {/* Left: Job type, status, date */}
                          <div className="flex-1 min-w-0">
                            {/* Job type + status inline */}
                            <div className="flex items-center gap-2.5 mb-1.5">
                              <h3 className="text-base font-semibold text-gray-900 m-0 tracking-tight leading-snug dark:text-white">{getJobTypeLabel(job.job_type)}</h3>
                              <span
                                className="text-[10.5px] font-semibold px-2 py-0.5 rounded-[5px] tracking-wide whitespace-nowrap"
                                style={{
                                  color: s.color,
                                  background: s.bg,
                                  border: `1px solid ${s.border}`,
                                }}
                              >{s.label}</span>
                            </div>
                            {/* Date */}
                            <div className="text-xs text-gray-400">
                              {formatDate(job.created_at)}
                            </div>

                            {/* Progress bar for processing */}
                            {job.status === 'processing' && (
                              <div className="mt-3">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs text-gray-400">Progress</span>
                                  <span className="text-xs font-semibold text-gray-900 dark:text-white">{job.progress || 0}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-gray-100 dark:bg-[#1a1a1a] rounded-sm overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-primary-600 to-primary-500 transition-all duration-300"
                                    style={{ width: `${job.progress || 0}%` }}
                                  />
                                </div>
                                <div className="text-xs text-gray-400 mt-1">
                                  {job.job_type === 'pdf_processing' && 'Processing PDF document...'}
                                  {job.job_type === 'form_generation' && 'Generating extraction code...'}
                                  {job.job_type === 'extraction' && 'Extracting data from documents...'}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Right: Action button */}
                          <div className="flex-shrink-0">
                            {(job.status === 'processing' || job.status === 'pending') && (
                              <button
                                onClick={() => handleCancel(job.id)}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-error-600 bg-transparent border-none px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-error-50"
                              >
                                <X className="w-3.5 h-3.5" />
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyState
                icon={PlayCircle}
                title="No active jobs"
                description="All jobs are completed or no jobs have been started yet"
              />
            )}
          </div>
        ) : (
          /* Filtered View - Keep existing pagination */
          <>
            <div className="space-y-4">
              {paginatedJobs.map((job) => {
              const isExpanded = expandedJobs.has(job.id);
              return (
                <Card key={job.id} className="p-6">
                  <div className="space-y-4">
                    {/* Job Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="rounded-full bg-gray-100 dark:bg-[#1a1a1a] p-2">
                          {getJobTypeIcon(job.job_type)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900 dark:text-white">
                              {getJobTypeLabel(job.job_type)}
                            </h3>
                            {getStatusIcon(job.status)}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">
                            Job ID: {job.id.slice(0, 8)}...
                          </p>
                          <p className="text-sm text-gray-600 dark:text-zinc-400 mt-1">
                            Created {formatDate(job.created_at)}
                          </p>
                        </div>
                      </div>
                      <Badge className={getStatusColor(job.status)}>
                        {job.status}
                      </Badge>
                    </div>

                    {/* Progress Bar (for running jobs) */}
                    {job.status === 'processing' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 dark:text-zinc-400">Progress</span>
                          <span className="font-medium">{job.progress || 0}%</span>
                        </div>
                        <Progress value={job.progress || 0} className="h-2" />
                        <p className="text-xs text-gray-500">
                          {job.job_type === 'pdf_processing' && 'Processing PDF document...'}
                          {job.job_type === 'form_generation' && 'Generating extraction code...'}
                          {job.job_type === 'extraction' && 'Extracting data from documents...'}
                        </p>
                      </div>
                    )}

                    {/* Job Metadata */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-gray-200 dark:border-[#1f1f1f]">
                      <div>
                        <p className="text-xs text-gray-500 dark:text-zinc-500">Type</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                          {getJobTypeLabel(job.job_type)}
                        </p>
                      </div>
                      {job.started_at && (
                        <div>
                          <p className="text-xs text-gray-500 dark:text-zinc-500">Started</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                            {formatDate(job.started_at)}
                          </p>
                        </div>
                      )}
                      {job.completed_at && (
                        <div>
                          <p className="text-xs text-gray-500 dark:text-zinc-500">Completed</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                            {formatDate(job.completed_at)}
                          </p>
                        </div>
                      )}
                      {job.celery_task_id && (
                        <div>
                          <p className="text-xs text-gray-500 dark:text-zinc-500">Task ID</p>
                          <p className="text-sm font-mono text-gray-900 dark:text-white mt-1">
                            {job.celery_task_id.slice(0, 8)}...
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Error Message (for failed jobs) */}
                    {job.status === 'failed' && job.error_message && (
                      <Alert variant="error" title="Job Failed">
                        {job.error_message}
                      </Alert>
                    )}

                    {/* Expandable Details */}
                    {(job.input_data || job.result_data) && (
                      <div className="pt-2 border-t border-gray-200 dark:border-[#1f1f1f]">
                        <button
                          onClick={() => toggleJobExpand(job.id)}
                          className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="h-4 w-4" />
                              Hide Details
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-4 w-4" />
                              Show Details
                            </>
                          )}
                        </button>

                        {isExpanded && (
                          <div className="mt-4 space-y-3">
                            {job.input_data && (
                              <div>
                                <p className="text-xs font-medium text-gray-700 dark:text-zinc-400 mb-2">Input Data:</p>
                                <pre className="bg-gray-50 dark:bg-[#1a1a1a] dark:text-zinc-300 p-3 rounded-lg text-xs overflow-x-auto">
                                  {JSON.stringify(job.input_data, null, 2)}
                                </pre>
                              </div>
                            )}
                            {job.result_data && (
                              <div>
                                <p className="text-xs font-medium text-gray-700 dark:text-zinc-400 mb-2">Result Data:</p>
                                <pre className="bg-gray-50 dark:bg-[#1a1a1a] dark:text-zinc-300 p-3 rounded-lg text-xs overflow-x-auto">
                                  {JSON.stringify(job.result_data, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2">
                      {job.status === 'completed' && job.job_type === 'extraction' && (
                        <Button
                          size="sm"
                          onClick={() => router.push(`/results?extraction_id=${job.input_data?.extraction_id || ''}`)}
                        >
                          View Results
                        </Button>
                      )}
                      {job.status === 'completed' && job.job_type === 'form_generation' && (
                        <Button
                          size="sm"
                          onClick={() => router.push(`/forms`)}
                        >
                          View Form
                        </Button>
                      )}
                      {job.status === 'completed' && job.job_type === 'pdf_processing' && (
                        <Button
                          size="sm"
                          onClick={() => router.push(`/documents`)}
                        >
                          View Documents
                        </Button>
                      )}
                      {(job.status === 'processing' || job.status === 'pending') && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleCancel(job.id)}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                      )}
                      {job.status === 'failed' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => router.push('/extractions')}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Retry
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <Card className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-600 dark:text-zinc-400">
                  <span className="font-medium text-gray-900 dark:text-white">{startIndex + 1}</span>
                  {' '}-{' '}
                  <span className="font-medium text-gray-900 dark:text-white">{Math.min(endIndex, filteredJobs.length)}</span>
                  {' '}of{' '}
                  <span className="font-medium text-gray-900 dark:text-white">{filteredJobs.length}</span>
                  {' '}jobs
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
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
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
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
    </DashboardLayout>
  );
}

'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { EmptyState } from '@/components/ui';
import { Loader2, PlayCircle } from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import { jobsService, formsService } from '@/services';
import { useJobWebSocket } from '@/hooks/useJobWebSocket';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { typography } from '@/lib/typography';
import type { Job, Form } from '@/types/api';
import { getJobTitle, getJobSubtitle } from '@/lib/job-helpers';
import {
  JobCard,
  JobStatsPanel,
  JobFilterBar,
  type JobFilterType,
} from '@/components/jobs';

export default function JobsPage() {
  const { selectedProject } = useProject();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<JobFilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch jobs
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs', selectedProject?.id],
    queryFn: () => jobsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      const hasActive = data.some((j: Job) => j.status === 'pending' || j.status === 'processing');
      return hasActive ? 3000 : false;
    },
  });

  // Fetch forms for name resolution
  const { data: forms = [] } = useQuery({
    queryKey: ['forms', selectedProject?.id],
    queryFn: () => formsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
  });

  const formIdMap = useMemo(() => {
    const map = new Map<string, string>();
    forms.forEach((f: Form) => map.set(f.id, f.form_name));
    return map;
  }, [forms]);

  // WebSocket for real-time updates
  const activeJob = jobs.find(j => j.status === 'pending' || j.status === 'processing');
  useJobWebSocket({
    jobId: activeJob?.id ?? null,
    enabled: !!activeJob,
    onMessage: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs', selectedProject?.id] });
    },
  });

  // Stats for the stats panel
  const stats = useMemo(() => ({
    running: jobs.filter(j => j.status === 'processing').length,
    queued: jobs.filter(j => j.status === 'pending').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  }), [jobs]);

  // Counts for filter tabs
  const counts = useMemo(() => ({
    all: jobs.length,
    running: jobs.filter(j => j.status === 'processing').length,
    pending: jobs.filter(j => j.status === 'pending').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
    cancelled: jobs.filter(j => j.status === 'cancelled').length,
  }), [jobs]);

  // Search filter
  const matchesSearch = (job: Job): boolean => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      getJobTitle(job, formIdMap).toLowerCase().includes(q) ||
      getJobSubtitle(job, formIdMap).toLowerCase().includes(q)
    );
  };

  // Categorize jobs
  const failedJobs = jobs.filter(j => j.status === 'failed');
  const inProgressJobs = jobs.filter(j => j.status === 'processing' || j.status === 'pending');
  const completedJobs = jobs.filter(j => j.status === 'completed' || j.status === 'cancelled');
  const recentCompleted = completedJobs.slice(0, 10);

  // Filtered flat list
  const getFilteredJobs = (): Job[] => {
    let result: Job[];
    switch (activeFilter) {
      case 'running': result = jobs.filter(j => j.status === 'processing'); break;
      case 'pending': result = jobs.filter(j => j.status === 'pending'); break;
      case 'completed': result = jobs.filter(j => j.status === 'completed'); break;
      case 'failed': result = jobs.filter(j => j.status === 'failed'); break;
      case 'cancelled': result = jobs.filter(j => j.status === 'cancelled'); break;
      default: result = jobs;
    }
    return result.filter(matchesSearch);
  };

  const hasActiveJobs = inProgressJobs.length > 0;

  const handleStatsFilterChange = (filter: string) => {
    setActiveFilter(filter as JobFilterType);
  };

  if (!selectedProject) {
    return (
      <DashboardLayout title="Jobs">
        <EmptyState
          icon={PlayCircle}
          title="No Project Selected"
          description="Please select a project to view jobs"
          action={{ label: 'Go to Dashboard', onClick: () => router.push('/dashboard') }}
        />
      </DashboardLayout>
    );
  }

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

  const renderJobCard = (job: Job) => (
    <JobCard key={job.id} job={job} formIdMap={formIdMap} />
  );

  const emptyMessages: Record<JobFilterType, { title: string; description: string }> = {
    all: { title: 'No tasks yet', description: 'Start an extraction or upload documents to see jobs here' },
    running: { title: 'Nothing running', description: 'All tasks have finished. Start a new extraction to see progress here.' },
    pending: { title: 'Nothing queued', description: 'No tasks are waiting. Start a new extraction to queue one.' },
    completed: { title: 'No completed tasks', description: 'Completed tasks will appear here once processing finishes.' },
    failed: { title: 'All clear', description: 'No failed tasks. Everything is running smoothly.' },
    cancelled: { title: 'No cancelled tasks', description: 'Cancelled tasks will appear here.' },
  };

  return (
    <DashboardLayout
      title="Jobs"
      description="Track document processing, code generation, and extractions"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={PlayCircle}
          title="No tasks yet"
          description="Start an extraction or upload documents to see jobs here"
          action={{ label: 'Run Extraction', onClick: () => router.push('/extractions') }}
        />
      ) : (
        <div className="space-y-8">
          {/* Live status indicator */}
          {hasActiveJobs && (
            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              Updates are live &mdash; this page refreshes automatically.
            </div>
          )}

          {/* Stats Panel */}
          <JobStatsPanel stats={stats} onFilterChange={handleStatsFilterChange} />

          {/* Filter Bar */}
          <JobFilterBar
            filter={activeFilter}
            counts={counts}
            searchQuery={searchQuery}
            onFilterChange={setActiveFilter}
            onSearchChange={setSearchQuery}
          />

          {/* Job List */}
          {activeFilter === 'all' && !searchQuery ? (
            // Grouped view
            (() => {
              const hasFailed = failedJobs.length > 0;
              const hasInProgress = inProgressJobs.length > 0;
              const hasCompleted = recentCompleted.length > 0;
              const firstKey = hasFailed ? 'attention' : hasInProgress ? 'progress' : 'completed';

              if (!hasFailed && !hasInProgress && !hasCompleted) {
                const { title, description } = emptyMessages.all;
                return <EmptyState icon={PlayCircle} title={title} description={description} />;
              }

              return (
                <div className="flex flex-col">
                  {hasFailed && (
                    <div>
                      <SectionHeader label="NEEDS ATTENTION" count={failedJobs.length} dotCls="bg-purple-500 animate-pulse" isFirst={firstKey === 'attention'} />
                      <div className="flex flex-col gap-2.5">{failedJobs.map(renderJobCard)}</div>
                    </div>
                  )}
                  {hasInProgress && (
                    <div>
                      <SectionHeader label="IN PROGRESS" count={inProgressJobs.length} dotCls="bg-blue-500 animate-pulse" isFirst={firstKey === 'progress'} />
                      <div className="flex flex-col gap-2.5">{inProgressJobs.map(renderJobCard)}</div>
                    </div>
                  )}
                  {hasCompleted && (
                    <div>
                      <SectionHeader label="RECENTLY COMPLETED" count={recentCompleted.length} dotCls="bg-green-500" isFirst={firstKey === 'completed'} />
                      <div className="flex flex-col gap-2.5">{recentCompleted.map(renderJobCard)}</div>
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            // Filtered flat list
            (() => {
              const filtered = getFilteredJobs();
              if (filtered.length === 0) {
                const { title, description } = emptyMessages[activeFilter];
                return <EmptyState icon={PlayCircle} title={title} description={description} />;
              }
              return (
                <div className="flex flex-col gap-2.5">
                  {filtered.map(renderJobCard)}
                </div>
              );
            })()
          )}
        </div>
      )}
    </DashboardLayout>
  );
}

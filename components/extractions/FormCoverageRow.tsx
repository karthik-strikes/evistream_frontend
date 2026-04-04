'use client';

import { cn } from '@/lib/utils';
import { RotateCcw, Play, FileText, X } from 'lucide-react';
import type { FormCoverage } from '@/services/extractions.service';
import type { PaperProgressState } from './PaperProgressList';

interface FormCoverageRowProps {
  coverage: FormCoverage;
  /** Live WebSocket progress keyed by job_id */
  paperProgress: Map<string, PaperProgressState>;
  canRunExtractions: boolean;
  onRetryFailed: (formId: string) => void;
  onRunRemaining: (formId: string) => void;
  onCancel: (extractionId: string) => void;
  onViewResults: (formId: string) => void;
  onClick: (formId: string) => void;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function FormCoverageRow({
  coverage,
  paperProgress,
  canRunExtractions,
  onRetryFailed,
  onRunRemaining,
  onCancel,
  onViewResults,
  onClick,
}: FormCoverageRowProps) {
  const {
    form_id,
    form_name,
    total_project_documents,
    extracted_count,
    failed_count,
    not_run_count,
    total_runs,
    last_run_at,
    active_jobs,
  } = coverage;

  const hasActiveJobs = active_jobs.length > 0;
  const runningJob = active_jobs.find((j) => j.status === 'processing');
  const queuedJob = active_jobs.find((j) => j.status === 'pending');

  // Use WebSocket progress if available, else fall back to API data
  const liveProgress = runningJob ? paperProgress.get(runningJob.job_id) : null;
  const liveTotal = liveProgress?.total || runningJob?.papers_total || 0;
  const liveDone = liveProgress?.done || runningJob?.papers_done || 0;

  // Coverage percentage (extracted out of total project docs)
  const coveragePct = total_project_documents > 0
    ? Math.round((extracted_count / total_project_documents) * 100)
    : 0;

  // Determine card state: border color + gradient based on dominant outcome
  // Priority: running/queued > mostly failed > mostly extracted > nothing done
  let borderColor: string;
  let gradientBg: string;

  if (hasActiveJobs) {
    // Running or queued → blue
    borderColor = 'border-l-blue-500 dark:border-l-blue-400';
    gradientBg = 'bg-gradient-to-r from-blue-50 to-white dark:from-blue-950/20 dark:to-[#111111]';
  } else if (failed_count > extracted_count) {
    // More failed than extracted → purple
    borderColor = 'border-l-purple-500 dark:border-l-purple-400';
    gradientBg = 'bg-gradient-to-r from-purple-50 to-white dark:from-purple-950/20 dark:to-[#111111]';
  } else if (extracted_count > 0) {
    // More extracted than failed (or equal) → green border, no gradient
    borderColor = 'border-l-green-500 dark:border-l-green-400';
    gradientBg = 'bg-white dark:bg-[#111111]';
  } else {
    // Nothing done yet → gray
    borderColor = 'border-l-gray-400 dark:border-l-zinc-600';
    gradientBg = 'bg-white dark:bg-[#111111]';
  }

  return (
    <div
      className={cn(
        'border border-gray-200 dark:border-[#1f1f1f] rounded-xl',
        'border-l-[4px]',
        borderColor,
        gradientBg,
        'pt-5 pb-5 px-[22px]',
        'cursor-pointer hover:shadow-card-hover hover:-translate-y-px transition-all duration-150',
      )}
      onClick={() => onClick(form_id)}
    >
      {/* Row 1: Form name + actions */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
          {form_name}
        </h3>
        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {hasActiveJobs && (
            <button
              onClick={() => {
                const eid = runningJob?.extraction_id || queuedJob?.extraction_id;
                if (eid) onCancel(eid);
              }}
              className="text-[11px] font-medium px-2 py-1 rounded-md text-gray-400 dark:text-zinc-500 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
            >
              <X className="h-3.5 w-3.5 inline-block mr-1" />
              Cancel
            </button>
          )}
          {!hasActiveJobs && failed_count > 0 && canRunExtractions && (
            <button
              onClick={() => onRetryFailed(form_id)}
              className="text-[11px] font-medium px-2 py-1 rounded-md text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-400/10 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5 inline-block mr-1" />
              Retry Failed
            </button>
          )}
          {!hasActiveJobs && not_run_count > 0 && canRunExtractions && (
            <button
              onClick={() => onRunRemaining(form_id)}
              className="text-[11px] font-medium px-2 py-1 rounded-md text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] transition-colors"
            >
              <Play className="h-3.5 w-3.5 inline-block mr-1" />
              Run Remaining
            </button>
          )}
          {extracted_count > 0 && (
            <button
              onClick={() => onViewResults(form_id)}
              className="text-[11px] font-medium px-2 py-1 rounded-md text-gray-400 dark:text-zinc-500 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
            >
              <FileText className="h-3.5 w-3.5 inline-block mr-1" />
              Results
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Active job status (running/queued) */}
      {runningJob && (
        <div className="mb-3">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="flex-1 bg-gray-100 dark:bg-[#1f1f1f] rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full transition-all duration-500"
                style={{
                  width: `${liveTotal > 0 ? Math.round((liveDone / liveTotal) * 100) : 0}%`,
                  background: 'linear-gradient(to right, #f43f5e, #8b5cf6, #3b82f6)',
                }}
              />
            </div>
            <span className="text-[11px] font-semibold text-blue-500 dark:text-blue-400 flex-shrink-0 tabular-nums">
              {liveDone}/{liveTotal}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-blue-500 dark:text-blue-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            Extracting{liveDone > 0 ? ` ${liveDone}/${liveTotal} done` : '...'}
          </div>
        </div>
      )}
      {queuedJob && !runningJob && (
        <div className="mb-3">
          <div className="flex items-center gap-2 text-xs text-blue-500 dark:text-blue-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            Queued — waiting to start
          </div>
        </div>
      )}

      {/* Row 3: Coverage bar */}
      {!runningJob && total_project_documents > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 bg-gray-100 dark:bg-[#1f1f1f] rounded-full h-1.5 overflow-hidden">
            <div
              className="h-1.5 rounded-full transition-all duration-500 bg-green-500"
              style={{ width: `${coveragePct}%` }}
            />
          </div>
          <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 flex-shrink-0 tabular-nums">
            {coveragePct}%
          </span>
        </div>
      )}

      {/* Row 4: Counts */}
      <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-zinc-400">
        {extracted_count > 0 && (
          <span className="text-green-600 dark:text-green-400">
            {extracted_count} extracted
          </span>
        )}
        {failed_count > 0 && (
          <span className="text-purple-600 dark:text-purple-400">
            {failed_count} failed
          </span>
        )}
        {not_run_count > 0 && (
          <span>
            {not_run_count} not run
          </span>
        )}
      </div>

      {/* Row 5: Meta */}
      <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400 dark:text-zinc-500">
        <span>Last run: {formatDate(last_run_at)}</span>
        <span className="text-gray-300 dark:text-zinc-700">|</span>
        <span>{total_runs} {total_runs === 1 ? 'run' : 'runs'} total</span>
      </div>
    </div>
  );
}

'use client';

import { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Play, Loader2, CheckCircle2 } from 'lucide-react';
import type { FormCoverage } from '@/services/extractions.service';
import type { PaperProgressState } from './PaperProgressList';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FormCoverageRowProps {
  coverage: FormCoverage;
  paperProgress: Map<string, PaperProgressState>;
  docNamesMap: Map<string, string>;
  canRunExtractions: boolean;
  onRetryFailed: (formId: string) => void;
  onRunRemaining: (formId: string) => void;
  onCancel: (extractionId: string) => void;
  onViewResults: (formId: string) => void;
  onClick: (formId: string) => void;
}

type CardStatus = 'complete' | 'incomplete' | 'errors' | 'partial' | 'ready';

// ─── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<CardStatus, {
  label: string;
  sidebarBg: string;
  textColor: string;
  pctColor: string;
  subColor: string;
}> = {
  complete: {
    label: 'COMPLETE',
    sidebarBg: 'bg-[#f0f5f0] dark:bg-[#141e16]',
    textColor: 'text-[#3d6b4e] dark:text-[#6b9b7a]',
    pctColor: 'text-[#2d5a3e] dark:text-[#7aad8a]',
    subColor: 'text-[#5a9b6e] dark:text-[#5a8b6a]',
  },
  incomplete: {
    label: '', // dynamically set based on percentage
    sidebarBg: 'bg-[#f5f3ee] dark:bg-[#1a1918]',
    textColor: 'text-[#6b6b5e] dark:text-[#9b9b8a]',
    pctColor: 'text-[#1a1a1a] dark:text-[#d4d4d4]',
    subColor: 'text-[#8a8a78] dark:text-[#7a7a68]',
  },
  errors: {
    label: 'ERRORS',
    sidebarBg: 'bg-[#faf0f0] dark:bg-[#1e1416]',
    textColor: 'text-[#8b4a4a] dark:text-[#c08080]',
    pctColor: 'text-[#6b3030] dark:text-[#d09090]',
    subColor: 'text-[#9b5a5a] dark:text-[#a07070]',
  },
  partial: {
    label: 'PARTIAL',
    sidebarBg: 'bg-[#faf0f0] dark:bg-[#1e1816]',
    textColor: 'text-[#8a6040] dark:text-[#b09060]',
    pctColor: 'text-[#6a4020] dark:text-[#c0a070]',
    subColor: 'text-[#9a7050] dark:text-[#8a6a50]',
  },
  ready: {
    label: 'READY',
    sidebarBg: 'bg-[#f5f5f3] dark:bg-[#181818]',
    textColor: 'text-[#8a8a80] dark:text-zinc-500',
    pctColor: 'text-[#6a6a60] dark:text-zinc-400',
    subColor: 'text-[#9a9a90] dark:text-zinc-600',
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCardStatus(coverage: FormCoverage): CardStatus {
  const { extracted_count, failed_count, total_project_documents, not_run_count } = coverage;
  if (extracted_count > 0 && extracted_count >= total_project_documents && failed_count === 0) return 'complete';
  if (failed_count > 0 && extracted_count === 0) return 'errors';
  if (failed_count > 0 && extracted_count > 0) return 'partial';
  if (extracted_count > 0 && not_run_count > 0) return 'incomplete';
  if (extracted_count > 0) return 'complete';
  return 'ready';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatEta(seconds: number): string {
  if (seconds < 60) return '<1 min remaining';
  const mins = Math.ceil(seconds / 60);
  return `~${mins} min remaining`;
}

function getProgressLabel(pct: number): string {
  if (pct <= 10) return 'WARMING UP';
  if (pct <= 20) return 'ROLLING';
  if (pct <= 30) return 'GAINING PACE';
  if (pct <= 40) return 'IN STRIDE';
  if (pct <= 50) return 'HALFWAY';
  if (pct <= 60) return 'CRUISING';
  if (pct <= 70) return 'LOCKED IN';
  if (pct <= 80) return 'HOME STRETCH';
  if (pct <= 90) return 'ALMOST THERE';
  return 'WRAPPING UP';
}


// ─── Running Mode ───────────────────────────────────────────────────────────

function RunningCard({
  coverage,
  paperProgress,
  docNamesMap,
  onCancel,
}: {
  coverage: FormCoverage;
  paperProgress: Map<string, PaperProgressState>;
  docNamesMap: Map<string, string>;
  onCancel: (extractionId: string) => void;
}) {
  const { form_name, active_jobs, extracted_count, failed_count, not_run_count, total_project_documents, total_runs } = coverage;
  const runningJob = active_jobs.find((j) => j.status === 'processing');
  const queuedJob = active_jobs.find((j) => j.status === 'pending');
  const activeJob = runningJob || queuedJob;

  const liveProgress = runningJob ? paperProgress.get(runningJob.job_id) : null;
  const jobDone = liveProgress?.done || runningJob?.papers_done || 0;
  const jobTotal = liveProgress?.total || runningJob?.papers_total || 0;

  // Overall progress = prior completions + current job progress
  const overallDone = extracted_count + jobDone;
  const overallTotal = total_project_documents;
  const progressPct = overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : 0;
  const hasJobProgress = jobDone > 0;

  // ETA tracking
  const etaRef = useRef<{ startTime: number; startDone: number } | null>(null);
  const [eta, setEta] = useState<string | null>(null);

  useEffect(() => {
    if (jobDone > 0 && !etaRef.current) {
      etaRef.current = { startTime: Date.now(), startDone: jobDone };
    }
    if (etaRef.current && jobDone > etaRef.current.startDone && jobTotal > 0) {
      const elapsed = (Date.now() - etaRef.current.startTime) / 1000;
      const processed = jobDone - etaRef.current.startDone;
      const rate = processed / elapsed;
      const remaining = jobTotal - jobDone;
      if (rate > 0) setEta(formatEta(remaining / rate));
    }
  }, [jobDone, jobTotal]);

  // Find current document being processed
  const currentDocId = liveProgress
    ? (() => {
        let lastDocId: string | null = null;
        liveProgress.papers.forEach((_status, docId) => { lastDocId = docId; });
        return lastDocId;
      })()
    : null;
  const currentDocName = currentDocId ? (docNamesMap.get(currentDocId) ?? 'Processing...') : null;

  // Count statuses
  const doneCount = liveProgress
    ? Array.from(liveProgress.papers.values()).filter((s) => s === 'success').length
    : 0;
  const failedCount = liveProgress
    ? Array.from(liveProgress.papers.values()).filter((s) => s === 'failed').length
    : 0;
  const processingCount = jobDone < jobTotal ? 1 : 0;
  const queuedCount = Math.max(0, jobTotal - jobDone - processingCount);

  const isQueued = !runningJob && !!queuedJob;

  return (
    <div className="border border-blue-200 dark:border-[#1e2030] rounded-xl bg-white dark:bg-[#141416] overflow-hidden transition-all duration-200 flex shadow-[0_4px_20px_-4px_rgba(59,130,246,0.08)] dark:shadow-[0_4px_24px_-4px_rgba(59,130,246,0.06)]">
      {/* Left sidebar — matches IdleCard layout */}
      <div className="flex flex-col items-center justify-center w-[110px] flex-shrink-0 border-r border-blue-100 dark:border-[#1e2030] py-4 px-2 bg-[#f0f4ff] dark:bg-[#161a2a]">
        <span className="text-[10px] font-semibold tracking-widest uppercase mb-2 text-blue-500 dark:text-blue-400">
          {isQueued ? 'QUEUED' : 'LIVE'}
        </span>
        <span className="text-3xl font-bold tabular-nums leading-none text-blue-600 dark:text-blue-300">
          {progressPct}%
        </span>
        <span className="text-[10px] mt-1.5 text-blue-400 dark:text-blue-500">
          {overallDone} of {overallTotal} docs
        </span>
        {/* Mini progress bar */}
        <div className="w-12 h-1 rounded-full bg-blue-100 dark:bg-[#1e2538] mt-2 overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Right content */}
      <div className="flex-1 min-w-0 px-5 py-3.5 flex flex-col justify-center gap-1.5">
        {/* Row 1: name + badge + cancel */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {form_name}
            </h3>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 flex-shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
              </span>
              {isQueued ? 'Queued' : 'Running'}
            </span>
          </div>
          {activeJob && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancel(activeJob.extraction_id); }}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-gray-200 dark:border-[#2a2a2a] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors flex-shrink-0"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Row 2: progress text + ETA */}
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          {isQueued
            ? 'Waiting in queue...'
            : hasJobProgress
              ? <>Processing document {jobDone + 1} of {jobTotal}{eta ? <> &middot; {eta}</> : ''}</>
              : extracted_count > 0
                ? <>Starting &middot; Prior: <span className="text-gray-600 dark:text-zinc-300 font-medium">{extracted_count}</span> done{failed_count > 0 && <> &middot; <span className="text-red-500 dark:text-red-400 font-medium">{failed_count}</span> errors</>} &middot; <span className="text-gray-600 dark:text-zinc-300 font-medium">{not_run_count}</span> remaining</>
                : 'Starting extraction...'}
        </p>

        {/* Current document */}
        {!isQueued && currentDocName && (
          <div className="bg-gray-50 dark:bg-[#0f1018] rounded-lg px-3.5 py-2 mt-0.5">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin flex-shrink-0" />
              <span className="text-xs text-gray-700 dark:text-zinc-300 truncate font-medium">
                {currentDocName}
              </span>
            </div>
          </div>
        )}

        {/* Row 3: status pills */}
        <div className="flex items-center gap-2 flex-wrap mt-0.5">
          {doneCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              {doneCount} done
            </span>
          )}
          {failedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              {failedCount} failed
            </span>
          )}
          {processingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
              {processingCount} processing
            </span>
          )}
          {queuedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-[#1a1a1a] text-gray-500 dark:text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-zinc-600" />
              {queuedCount} queued
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Idle Mode ──────────────────────────────────────────────────────────────

function IdleCard({
  coverage,
  canRunExtractions,
  onRetryFailed,
  onRunRemaining,
  onViewResults,
  onClick,
}: {
  coverage: FormCoverage;
  canRunExtractions: boolean;
  onRetryFailed: (formId: string) => void;
  onRunRemaining: (formId: string) => void;
  onViewResults: (formId: string) => void;
  onClick: (formId: string) => void;
}) {
  const {
    form_id,
    form_name,
    total_project_documents,
    extracted_count,
    failed_count,
    not_run_count,
    total_runs,
    last_run_at,
  } = coverage;

  const status = getCardStatus(coverage);
  const config = STATUS_CONFIG[status];
  const coveragePct = total_project_documents > 0
    ? Math.round((extracted_count / total_project_documents) * 100)
    : 0;
  const isComplete = status === 'complete';

  // Build meta line
  const metaParts: string[] = [];
  metaParts.push(`${total_runs} ${total_runs === 1 ? 'run' : 'runs'}`);
  metaParts.push(`Last ${formatDate(last_run_at)}`);

  return (
    <div
      className="border border-gray-200 dark:border-[#222226] rounded-xl bg-white dark:bg-[#141416] overflow-hidden cursor-pointer hover:shadow-card-hover hover:-translate-y-px transition-all duration-150 flex"
      onClick={() => onClick(form_id)}
    >
      {/* Left sidebar */}
      <div className={cn(
        'flex flex-col items-center justify-center w-[110px] flex-shrink-0 border-r border-gray-100 dark:border-[#222226] py-4 px-2',
        config.sidebarBg,
      )}>
        <span className={cn('text-[10px] font-semibold tracking-widest uppercase mb-2', config.textColor)}>
          {status === 'incomplete' ? getProgressLabel(coveragePct) : config.label}
        </span>
        {isComplete ? (
          <CheckCircle2 className={cn('h-8 w-8 mb-1', config.pctColor)} strokeWidth={1.5} />
        ) : (
          <span className={cn('text-3xl font-bold tabular-nums leading-none', config.pctColor)}>
            {coveragePct}%
          </span>
        )}
        <span className={cn('text-[10px] mt-1.5', config.subColor)}>
          {isComplete
            ? `All ${total_project_documents} docs done`
            : `${extracted_count} of ${total_project_documents} docs`}
        </span>
      </div>

      {/* Right content */}
      <div className="flex-1 min-w-0 px-5 py-3.5 flex flex-col justify-center gap-1.5">
        {/* Row 1: name + actions */}
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {form_name}
          </h3>
          <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {isComplete ? (
              <>
                <button
                  onClick={() => onViewResults(form_id)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-medium rounded-md bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                >
                  View results
                </button>
                {canRunExtractions && (
                  <button
                    onClick={() => onRunRemaining(form_id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                  >
                    Re-run
                  </button>
                )}
              </>
            ) : (
              <>
                {not_run_count > 0 && canRunExtractions && (
                  <button
                    onClick={() => onRunRemaining(form_id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-medium rounded-md bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                  >
                    <Play className="h-3 w-3" />
                    Run remaining ({not_run_count})
                  </button>
                )}
                {extracted_count > 0 && (
                  <button
                    onClick={() => onViewResults(form_id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                  >
                    Results
                  </button>
                )}
                {failed_count > 0 && canRunExtractions && (
                  <button
                    onClick={() => onRetryFailed(form_id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                  >
                    Fix {failed_count} {failed_count === 1 ? 'error' : 'errors'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Row 2: meta */}
        <p className="text-[11px] text-gray-400 dark:text-zinc-500">
          {metaParts.join(' · ')}
        </p>

        {/* Row 3: stats (plain text) + right context */}
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-gray-400 dark:text-zinc-500">
            <span className="text-gray-600 dark:text-zinc-300 font-medium">{extracted_count}</span> done
            {' · '}
            <span className="text-gray-600 dark:text-zinc-300 font-medium">{not_run_count}</span> pending
            {' · '}
            <span className={cn('font-medium', failed_count > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-zinc-300')}>{failed_count}</span>
            {' '}<span className={failed_count > 0 ? 'text-red-500 dark:text-red-400' : undefined}>errors</span>
          </p>

          <span className="text-[11px] text-gray-400 dark:text-zinc-500 flex-shrink-0">
            {isComplete ? '100% success rate' : null}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export function FormCoverageRow({
  coverage,
  paperProgress,
  docNamesMap,
  canRunExtractions,
  onRetryFailed,
  onRunRemaining,
  onCancel,
  onViewResults,
  onClick,
}: FormCoverageRowProps) {
  const hasActiveJobs = coverage.active_jobs.length > 0;

  if (hasActiveJobs) {
    return (
      <RunningCard
        coverage={coverage}
        paperProgress={paperProgress}
        docNamesMap={docNamesMap}
        onCancel={onCancel}
      />
    );
  }

  return (
    <IdleCard
      coverage={coverage}
      canRunExtractions={canRunExtractions}
      onRetryFailed={onRetryFailed}
      onRunRemaining={onRunRemaining}
      onViewResults={onViewResults}
      onClick={onClick}
    />
  );
}

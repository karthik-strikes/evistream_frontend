'use client';

import { useState, useEffect } from 'react';
import {
  ChevronDown,
  Grid3x3,
  Loader2,
  RotateCcw,
  X,
  Trash2,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils';
import type { Extraction, Job } from '@/types/api';
import { ExtractionStatusBadge } from './ExtractionStatusBadge';
import { PaperProgressList, type PaperProgressState } from './PaperProgressList';

interface ExtractionCardProps {
  extraction: Extraction;
  job: Job | null;
  pp: PaperProgressState | null;
  formName: string;
  docNamesMap: Map<string, string>;
  canRunExtractions: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onViewResults: () => void;
  onNavigateToDetail: () => void;
}

function formatDuration(startAt: string | null, endAt?: string | null): string {
  if (!startAt) return '';
  const start = new Date(startAt).getTime();
  const end = endAt ? new Date(endAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 0) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function ExtractionCard({
  extraction,
  job,
  pp,
  formName,
  docNamesMap,
  canRunExtractions,
  isExpanded,
  onToggle,
  onRetry,
  onCancel,
  onDelete,
  onViewResults,
  onNavigateToDetail,
}: ExtractionCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [elapsed, setElapsed] = useState('');

  const isRunning = extraction.status === 'running';
  const isPending = extraction.status === 'pending';
  const isCompleted = extraction.status === 'completed';
  const isFailed = extraction.status === 'failed';
  const isCancelled = extraction.status === 'cancelled';

  const failedDocIds: string[] = job?.result_data?.failed_document_ids ?? [];
  const hasPartialFailure = isCompleted && failedDocIds.length > 0;

  const totalDocs: number =
    job?.result_data?.total_documents ?? job?.input_data?.document_ids?.length ?? 0;
  const successCount: number = job?.result_data?.successful_extractions ?? 0;
  const failCount: number = job?.result_data?.failed_extractions ?? failedDocIds.length;
  const queuePosition = job?.result_data?.queue_position;

  // Only show expand when there's actually content worth seeing
  const isExpandable = isRunning || isPending || isFailed || hasPartialFailure;

  useEffect(() => {
    if (!isRunning || !job?.started_at) return;
    const tick = () => setElapsed(formatDuration(job.started_at));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRunning, job?.started_at]);

  const progressPct = pp?.total ? Math.round((pp.done / pp.total) * 100) : job?.progress ?? 0;

  const statusLabel = (() => {
    if (isPending && queuePosition != null) return `Queued — #${queuePosition}`;
    if (isRunning && pp) return `Extracting ${pp.done}/${pp.total}`;
    return undefined;
  })();

  const handleBodyClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    onNavigateToDetail();
  };

  return (
    <div
      className={cn(
        'bg-white rounded-xl border border-gray-200 flex flex-col transition-all duration-150 cursor-pointer relative overflow-hidden hover:shadow-card-hover hover:-translate-y-px dark:bg-[#111111] dark:border-[#1f1f1f] group',
        isRunning &&
          'border-l-[4px] border-l-blue-500 dark:border-l-blue-400 bg-gradient-to-r from-blue-50 to-white dark:from-blue-950/20 dark:to-[#111111]',
        isPending && 'border-l-[4px] border-l-amber-500 dark:border-l-amber-400',
        isFailed &&
          'border-l-[4px] border-l-purple-500 dark:border-l-purple-400 bg-gradient-to-r from-purple-50 to-white dark:from-purple-950/20 dark:to-[#111111]',
        hasPartialFailure && !isFailed && 'border-l-[4px] border-l-amber-500 dark:border-l-amber-400',
        isCancelled && 'border-l-[4px] border-l-gray-400 dark:border-l-zinc-600',
      )}
    >
      {/* ── Card body ─────────────────────────────────────────────── */}
      <div className="pt-5 pb-5 px-[22px]" onClick={handleBodyClick}>

        {/* Row 1: title + actions */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 tracking-tight leading-snug dark:text-white truncate m-0">
              {formName}
            </h3>
            <ExtractionStatusBadge status={extraction.status} label={statusLabel} />
          </div>

          {/* Actions — compact, right-aligned */}
          <div className="flex items-center gap-0.5 flex-shrink-0">

            {/* Primary action */}
            {hasPartialFailure && canRunExtractions && (
              <button
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 px-2 py-1 rounded-md border-none bg-transparent cursor-pointer transition-colors hover:bg-amber-50 dark:hover:bg-amber-400/10"
              >
                <RotateCcw className="w-3 h-3" />
                Retry failed
              </button>
            )}

            {isFailed && canRunExtractions && (
              <button
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 px-2 py-1 rounded-md border-none bg-transparent cursor-pointer transition-colors hover:bg-purple-50 dark:hover:bg-purple-400/10"
              >
                <RotateCcw className="w-3 h-3" />
                Retry
              </button>
            )}

            {(isRunning || isPending) && (
              <button
                onClick={(e) => { e.stopPropagation(); onCancel(); }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-zinc-500 px-2 py-1 rounded-md border-none bg-transparent cursor-pointer transition-colors hover:text-gray-700 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-[#1a1a1a]"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
            )}

            {isCompleted && (
              <button
                onClick={(e) => { e.stopPropagation(); onViewResults(); }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-zinc-500 px-2 py-1 rounded-md border-none bg-transparent cursor-pointer transition-colors hover:text-gray-700 dark:hover:text-zinc-200 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
              >
                <Grid3x3 className="w-3 h-3" />
                Results
              </button>
            )}

            {/* Expand chevron — only when there's something to show */}
            {isExpandable && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggle(); }}
                className="inline-flex items-center justify-center w-6 h-6 rounded-md border-none bg-transparent cursor-pointer text-gray-300 dark:text-zinc-700 hover:text-gray-500 dark:hover:text-zinc-400 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] transition-colors"
              >
                <ChevronDown
                  className={cn('w-3.5 h-3.5 transition-transform duration-150', isExpanded && 'rotate-180')}
                />
              </button>
            )}

            {/* Delete — hover-reveal icon */}
            {(isCompleted || isFailed || isCancelled) && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
                className="inline-flex items-center justify-center w-6 h-6 rounded-md border-none bg-transparent cursor-pointer text-gray-200 dark:text-zinc-800 opacity-0 group-hover:opacity-100 hover:text-red-400 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: date + meta chips */}
        <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
          <span>{formatDate(extraction.created_at)}</span>

          {totalDocs > 0 && (
            <>
              <span className="text-gray-200 dark:text-zinc-800">&middot;</span>
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {totalDocs} doc{totalDocs !== 1 ? 's' : ''}
              </span>
            </>
          )}

          {(isCompleted || isFailed) && job?.started_at && (
            <>
              <span className="text-gray-200 dark:text-zinc-800">&middot;</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDuration(job.started_at, job.completed_at)}
              </span>
            </>
          )}

          {isRunning && elapsed && (
            <>
              <span className="text-gray-200 dark:text-zinc-800">&middot;</span>
              <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400">
                <Clock className="w-3 h-3" />
                {elapsed}
              </span>
            </>
          )}

          {isCompleted && successCount > 0 && (
            <>
              <span className="text-gray-200 dark:text-zinc-800">&middot;</span>
              <span className="flex items-center gap-1 text-green-600 dark:text-green-500">
                <CheckCircle2 className="w-3 h-3" />
                {successCount} extracted
              </span>
            </>
          )}

          {hasPartialFailure && (
            <>
              <span className="text-gray-200 dark:text-zinc-800">&middot;</span>
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                ⚠ {failedDocIds.length} failed
              </span>
            </>
          )}
        </div>

        {/* Progress bar — running only */}
        {(isRunning || (isPending && job?.status === 'processing')) && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 bg-gray-100 dark:bg-[#1f1f1f] rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full transition-all duration-500"
                style={{
                  width: `${progressPct}%`,
                  background: 'linear-gradient(to right, #f43f5e, #8b5cf6, #3b82f6)',
                }}
              />
            </div>
            <span className="text-[11px] font-semibold text-green-500 dark:text-green-400 flex-shrink-0 tabular-nums">
              {pp ? `${pp.done}/${pp.total}` : `${progressPct}%`}
            </span>
          </div>
        )}
      </div>

      {/* ── Expanded details ──────────────────────────────────────── */}
      {isExpanded && isExpandable && (
        <div
          className="px-[22px] pt-4 pb-5 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/40 dark:bg-[#0d0d0d]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Stats grid — only for failed/partial */}
          {(isFailed || hasPartialFailure) &&
            (totalDocs > 0 || successCount > 0 || job?.started_at) && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 mb-4">
                {totalDocs > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-1">Documents</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{totalDocs}</p>
                  </div>
                )}
                {successCount > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-1">Extracted</p>
                    <p className="text-sm font-semibold text-green-600 dark:text-green-400">{successCount}</p>
                  </div>
                )}
                {failCount > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-1">Failed</p>
                    <p className="text-sm font-semibold text-red-500 dark:text-red-400">{failCount}</p>
                  </div>
                )}
                {job?.started_at && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-1">Duration</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {formatDuration(job.started_at, job.completed_at)}
                    </p>
                  </div>
                )}
              </div>
            )}

          {/* Error message */}
          {isFailed && (
            <div className="text-xs font-mono px-3 py-3 rounded-lg bg-purple-50 dark:bg-purple-400/10 border border-purple-200 dark:border-purple-400/20 text-purple-700 dark:text-purple-400 leading-relaxed break-words max-h-[160px] overflow-y-auto">
              {job?.error_message ?? 'Extraction failed'}
            </div>
          )}

          {/* Queue position */}
          {isPending && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800/40">
              <Loader2 className="w-3.5 h-3.5 text-orange-500 dark:text-orange-400 animate-spin flex-shrink-0" />
              <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
                {queuePosition != null ? `Position ${queuePosition} in queue` : 'Waiting in queue'}
              </p>
            </div>
          )}

          {/* Paper progress list */}
          {isRunning && pp && pp.total > 0 && (
            <PaperProgressList pp={pp} docNamesMap={docNamesMap} />
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div
          className="px-[22px] py-3 border-t border-red-100 dark:border-red-900/30 bg-red-50/60 dark:bg-red-900/10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-red-700 dark:text-red-400 font-medium">
              Delete this extraction and all its results? This cannot be undone.
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 bg-transparent border-none cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); onDelete(); }}
                className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded-md border-none cursor-pointer transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

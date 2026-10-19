'use client';

import { useState } from 'react';
import { FileText, Settings, FlaskConical, ChevronDown, Clock, Grid3x3, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Job } from '@/types/api';
import { JobStatusBadge } from './JobStatusBadge';
import {
  getJobTitle,
  getJobSubtitle,
  getProgressMessage,
  getRelativeTime,
  getDuration,
  getHumanError,
  getJobActionButton,
} from '@/lib/job-helpers';
import Link from 'next/link';

interface JobCardProps {
  job: Job;
  formIdMap?: Map<string, string>;
}

function JobTypeIcon({ jobType }: { jobType: Job['job_type'] }) {
  switch (jobType) {
    case 'pdf_processing':
      return <FileText className="h-3.5 w-3.5 text-gray-400 dark:text-zinc-500 flex-shrink-0" />;
    case 'form_generation':
      return <Settings className="h-3.5 w-3.5 text-gray-400 dark:text-zinc-500 flex-shrink-0" />;
    case 'extraction':
      return <FlaskConical className="h-3.5 w-3.5 text-gray-400 dark:text-zinc-500 flex-shrink-0" />;
    default:
      return <FileText className="h-3.5 w-3.5 text-gray-400 dark:text-zinc-500 flex-shrink-0" />;
  }
}

export function JobCard({ job, formIdMap }: JobCardProps) {
  const [expanded, setExpanded] = useState(false);

  const title = getJobTitle(job, formIdMap);
  const subtitle = getJobSubtitle(job, formIdMap);
  const progressMsg = getProgressMessage(job);
  const relTime = getRelativeTime(job.created_at);
  const duration = getDuration(job.started_at, job.completed_at);
  const action = getJobActionButton(job);

  const isProcessing = job.status === 'processing';
  const isPending = job.status === 'pending';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isCancelled = job.status === 'cancelled';
  const isActive = isProcessing || isPending;

  return (
    <div
      className={cn(
        'bg-white rounded-xl border border-gray-200 flex flex-col transition-all duration-150 cursor-pointer relative overflow-hidden hover:shadow-card-hover hover:-translate-y-px dark:bg-[#111111] dark:border-[#1f1f1f] group',
        isProcessing &&
          'border-l-[4px] border-l-blue-500 dark:border-l-blue-400 bg-gradient-to-r from-blue-50 to-white dark:from-blue-950/20 dark:to-[#111111]',
        isPending && 'border-l-[4px] border-l-amber-500 dark:border-l-amber-400',
        isFailed &&
          'border-l-[4px] border-l-purple-500 dark:border-l-purple-400 bg-gradient-to-r from-purple-50 to-white dark:from-purple-950/20 dark:to-[#111111]',
        isCancelled && 'border-l-[4px] border-l-gray-400 dark:border-l-zinc-600',
      )}
    >
      {/* ── Card body ─────────────────────────────────────────────── */}
      <div className="pt-5 pb-5 px-[22px]">

        {/* Row 1: title + badge + actions */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 tracking-tight leading-snug dark:text-white truncate m-0">
              {title}
            </h3>
            <JobStatusBadge status={job.status} />
          </div>

          {/* Actions — compact, right-aligned */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {isFailed && action && (
              <Link
                href={action.href}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 px-2 py-1 rounded-md border-none bg-transparent cursor-pointer transition-colors hover:bg-purple-50 dark:hover:bg-purple-400/10"
              >
                <RotateCcw className="w-3 h-3" />
                {action.label}
              </Link>
            )}

            {isCompleted && action && (
              <Link
                href={action.href}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-zinc-500 px-2 py-1 rounded-md border-none bg-transparent cursor-pointer transition-colors hover:text-gray-700 dark:hover:text-zinc-200 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
              >
                <Grid3x3 className="w-3 h-3" />
                {action.label}
              </Link>
            )}

            {/* Expand chevron — only when there's an error to show */}
            {isFailed && job.error_message && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                className="inline-flex items-center justify-center w-6 h-6 rounded-md border-none bg-transparent cursor-pointer text-gray-300 dark:text-zinc-700 hover:text-gray-500 dark:hover:text-zinc-400 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] transition-colors"
              >
                <ChevronDown
                  className={cn('w-3.5 h-3.5 transition-transform duration-150', expanded && 'rotate-180')}
                />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: meta chips */}
        <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
          <span>{relTime}</span>

          <span className="text-gray-200 dark:text-zinc-800">&middot;</span>
          <span className="flex items-center gap-1">
            <JobTypeIcon jobType={job.job_type} />
            {subtitle}
          </span>

          {(isCompleted || isFailed) && duration && (
            <>
              <span className="text-gray-200 dark:text-zinc-800">&middot;</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {duration}
              </span>
            </>
          )}
        </div>

        {/* Progress bar — active jobs only */}
        {isActive && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 bg-gray-100 dark:bg-[#1f1f1f] rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(job.progress || 0, isActive ? 5 : 0)}%`,
                  background: 'linear-gradient(to right, #f43f5e, #8b5cf6, #3b82f6)',
                }}
              />
            </div>
            <span className="text-[11px] font-semibold text-green-500 dark:text-green-400 flex-shrink-0 tabular-nums">
              {progressMsg}
            </span>
          </div>
        )}
      </div>

      {/* ── Expanded error details ─────────────────────────────────── */}
      {expanded && isFailed && job.error_message && (
        <div
          className="px-[22px] pt-4 pb-5 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/40 dark:bg-[#0d0d0d]"
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const { explanation, guidance } = getHumanError(job.error_message, job.job_type);
            return (
              <div className="text-xs font-mono px-3 py-3 rounded-lg bg-purple-50 dark:bg-purple-400/10 border border-purple-200 dark:border-purple-400/20 text-purple-700 dark:text-purple-400 leading-relaxed break-words">
                <p><span className="font-semibold">What went wrong:</span> {explanation}</p>
                <p className="mt-1"><span className="font-semibold">What you can do:</span> {guidance}</p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

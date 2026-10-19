'use client';

import { getJobStatusLabel } from '@/lib/job-helpers';
import { cn } from '@/lib/utils';

interface JobStatusBadgeProps {
  status: string;
}

const statusStyles: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
  processing: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
  completed: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800',
  failed: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800/50',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-zinc-800 dark:text-zinc-500 dark:border-zinc-700',
};

export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  const style = statusStyles[status] || statusStyles.pending;
  const label = getJobStatusLabel(status);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-2 py-0.5 rounded-[5px] tracking-wide whitespace-nowrap border',
        style
      )}
    >
      {status === 'processing' && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      )}
      {label}
    </span>
  );
}

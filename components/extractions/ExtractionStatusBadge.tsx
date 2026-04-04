'use client';

import { cn } from '@/lib/utils';

type ExtractionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'manual' | 'consensus';

interface ExtractionStatusBadgeProps {
  status: ExtractionStatus;
  label?: string;
  className?: string;
}

export function ExtractionStatusBadge({ status, label, className }: ExtractionStatusBadgeProps) {
  const cls = (() => {
    switch (status) {
      case 'completed':
        return 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50';
      case 'running':
        return 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50';
      case 'pending':
        return 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50';
      case 'failed':
        return 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/50';
      case 'cancelled':
        return 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]';
      default:
        return 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]';
    }
  })();

  const defaultLabel = status === 'pending' ? 'Queued' : status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-[5px] tracking-wide whitespace-nowrap', cls, className)}>
      {label ?? defaultLabel}
    </span>
  );
}

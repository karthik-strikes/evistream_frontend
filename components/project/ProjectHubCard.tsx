'use client';

import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface ProjectHubCardProps {
  icon: LucideIcon;
  title: string;
  count: number;
  accentColor: string;        // e.g. 'bg-blue-500'
  breakdownLines?: string[];
  actionLabel?: string;
  badge?: string;
  onClick: () => void;
}

export function ProjectHubCard({
  icon: Icon,
  title,
  count,
  accentColor,
  breakdownLines = [],
  actionLabel,
  badge,
  onClick,
}: ProjectHubCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative bg-white rounded-xl border border-gray-200 flex flex-col text-left transition-all duration-150 cursor-pointer overflow-hidden',
        'hover:shadow-card-hover hover:-translate-y-px',
        'dark:bg-[#111111] dark:border-[#1f1f1f]',
      )}
    >
      {/* Colored left accent bar */}
      <div className={cn('absolute left-0 inset-y-0 w-[4px] rounded-l-xl', accentColor)} />

      <div className="pl-5 pr-5 pt-5 pb-4 flex flex-col gap-3 w-full">
        {/* Top row: icon + title + badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-[#1a1a1a] flex items-center justify-center shrink-0">
              <Icon size={16} className="text-gray-400 dark:text-zinc-500" />
            </div>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
          </div>
          {badge && (
            <span className="text-[10px] font-bold tracking-wider uppercase text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15 px-2 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </div>

        {/* Count */}
        <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white leading-none">
          {count}
        </span>

        {/* Breakdown lines */}
        {breakdownLines.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {breakdownLines.map((line, i) => (
              <span key={i} className="text-xs text-gray-400 dark:text-zinc-500">{line}</span>
            ))}
          </div>
        )}

        {/* Optional action label */}
        {actionLabel && (
          <span className="text-xs font-semibold text-gray-500 dark:text-zinc-400 mt-auto">
            {actionLabel}
          </span>
        )}
      </div>
    </button>
  );
}

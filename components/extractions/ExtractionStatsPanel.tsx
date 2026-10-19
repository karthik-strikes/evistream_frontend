'use client';

import { cn } from '@/lib/utils';
import { Card } from '@/components/ui';

interface ExtractionStats {
  running: number;
  queued: number;
  completed: number;
  failed: number;
}

interface ExtractionStatsPanelProps {
  stats: ExtractionStats;
  onFilterChange: (filter: string) => void;
}

const STATS = [
  {
    key: 'running',
    label: 'Running',
    filter: 'running',
    activeColor: 'text-blue-600 dark:text-blue-400',
    accentBar: 'bg-blue-500',
  },
  {
    key: 'queued',
    label: 'Queued',
    filter: 'pending',
    activeColor: 'text-amber-600 dark:text-amber-400',
    accentBar: 'bg-amber-400',
  },
  {
    key: 'completed',
    label: 'Completed',
    filter: 'completed',
    activeColor: 'text-green-600 dark:text-green-400',
    accentBar: 'bg-green-500',
  },
  {
    key: 'failed',
    label: 'Failed',
    filter: 'failed',
    activeColor: 'text-purple-600 dark:text-purple-400',
    accentBar: 'bg-purple-500',
  },
] as const;

export function ExtractionStatsPanel({ stats, onFilterChange }: ExtractionStatsPanelProps) {
  return (
    <Card className="p-0 overflow-hidden dark:bg-[#111111] dark:border-[#1f1f1f]">
      <div className="grid grid-cols-4 divide-x divide-gray-100 dark:divide-[#1f1f1f]">
        {STATS.map(({ key, label, filter, activeColor, accentBar }) => {
          const value = stats[key as keyof ExtractionStats];
          const hasValue = value > 0;
          return (
            <button
              key={key}
              onClick={() => onFilterChange(filter)}
              className="relative flex flex-col items-start gap-1.5 px-6 py-5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-[#181818] focus:outline-none"
            >
              {/* Colored top accent line — only visible when count > 0 */}
              <div
                className={cn(
                  'absolute inset-x-0 top-0 h-[2px] transition-opacity duration-300',
                  hasValue ? accentBar : 'opacity-0',
                )}
              />

              {/* Number */}
              <span
                className={cn(
                  'text-2xl font-bold tabular-nums leading-none',
                  hasValue ? activeColor : 'text-gray-300 dark:text-zinc-700',
                )}
              >
                {value}
              </span>

              {/* Label */}
              <span className="text-xs text-gray-400 dark:text-zinc-500 font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

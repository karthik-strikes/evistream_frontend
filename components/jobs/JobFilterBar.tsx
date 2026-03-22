'use client';

import { cn } from '@/lib/utils';
import { Card } from '@/components/ui';

export type JobFilterType = 'all' | 'running' | 'pending' | 'completed' | 'failed' | 'cancelled';

interface FilterCounts {
  all: number;
  running: number;
  pending: number;
  completed: number;
  failed: number;
  cancelled: number;
}

interface JobFilterBarProps {
  filter: JobFilterType;
  counts: FilterCounts;
  searchQuery: string;
  onFilterChange: (filter: JobFilterType) => void;
  onSearchChange: (query: string) => void;
}

const TABS: Array<{ key: JobFilterType; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'pending', label: 'Queued' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function JobFilterBar({
  filter,
  counts,
  searchQuery,
  onFilterChange,
  onSearchChange,
}: JobFilterBarProps) {
  return (
    <Card className="p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onFilterChange(key)}
              className={cn(
                'px-4 py-2 rounded-lg font-medium text-sm transition-colors whitespace-nowrap',
                filter === key
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-[#1a1a1a] dark:text-[#c0c0c0] dark:hover:bg-[#222222]',
              )}
            >
              {label}
              {key === 'all'
                ? ` (${counts.all})`
                : counts[key] > 0
                  ? ` (${counts[key]})`
                  : ''}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9ca3af"
              strokeWidth="2"
              strokeLinecap="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search jobs..."
              className="text-sm text-gray-900 dark:text-white bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 pl-9 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 w-48"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

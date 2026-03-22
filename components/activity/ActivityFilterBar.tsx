'use client';

import { cn } from '@/lib/utils';

type TabValue = 'all' | 'upload' | 'extraction' | 'forms';
type DateRange = 'today' | 'week' | 'month' | 'all';

interface Project {
  id: string;
  name: string;
}

interface ActivityFilterBarProps {
  activeTab: TabValue;
  onTabChange: (tab: TabValue) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  projectFilter: string;
  onProjectFilterChange: (projectId: string) => void;
  projects: Project[];
}

const tabs: { value: TabValue; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'upload', label: 'Documents' },
  { value: 'extraction', label: 'Extractions' },
  { value: 'forms', label: 'Forms' },
];

export function ActivityFilterBar({
  activeTab,
  onTabChange,
  dateRange,
  onDateRangeChange,
  projectFilter,
  onProjectFilterChange,
  projects,
}: ActivityFilterBarProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      {/* Pill tabs */}
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#1a1a1a] rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onTabChange(tab.value)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === tab.value
                ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-300'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Dropdowns */}
      <div className="flex items-center gap-2">
        <select
          value={dateRange}
          onChange={(e) => onDateRangeChange(e.target.value as DateRange)}
          className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-[#2a2a2a] rounded-lg bg-white dark:bg-[#111111] text-gray-700 dark:text-zinc-300 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f]"
        >
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="all">All time</option>
        </select>

        <select
          value={projectFilter}
          onChange={(e) => onProjectFilterChange(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-[#2a2a2a] rounded-lg bg-white dark:bg-[#111111] text-gray-700 dark:text-zinc-300 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f]"
        >
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

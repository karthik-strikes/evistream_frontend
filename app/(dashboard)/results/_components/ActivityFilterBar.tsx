'use client';

import { useMemo, useState } from 'react';
import { Search, X, Calendar, CircleDot } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { Person } from '@/hooks/useProjectPeople';

export type DateWindow = 'all' | '7' | '30';
export type CompletionFilter = 'all' | 'complete' | 'progress';

export interface ActivityFilters {
  q: string;
  personId: string | 'all';
  days: DateWindow;
  completion: CompletionFilter;
}

export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = {
  q: '',
  personId: 'all',
  days: 'all',
  completion: 'all',
};

export function useActivityFilters() {
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const active = useMemo(
    () =>
      filters.q.trim() !== '' ||
      filters.personId !== 'all' ||
      filters.days !== 'all' ||
      filters.completion !== 'all',
    [filters],
  );
  return {
    filters,
    active,
    set: <K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) =>
      setFilters(f => ({ ...f, [key]: value })),
    reset: () => setFilters(EMPTY_ACTIVITY_FILTERS),
  };
}

/** Days → the oldest timestamp that still passes. */
export function windowStart(days: DateWindow): number | null {
  if (days === 'all') return null;
  return Date.now() - Number(days) * 24 * 60 * 60 * 1000;
}

const SELECT_WRAP =
  'relative flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 dark:border-[#1f1f1f] dark:bg-[#111111]';
const SELECT =
  'cursor-pointer appearance-none border-none bg-transparent pr-1 text-sm text-gray-700 outline-none dark:text-zinc-300 dark:[color-scheme:dark]';

/**
 * Search, time window, completion, and one chip per person with activity.
 *
 * The chip list is built from the people who actually appear in this project's
 * results — not the member list. A project can carry fifty members and two
 * extractors, and a filter offering forty-eight rows that match nothing is
 * worse than no filter.
 */
export function ActivityFilterBar({
  filters,
  set,
  people,
}: {
  filters: ActivityFilters;
  set: <K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) => void;
  people: Person[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex min-w-[200px] max-w-[340px] flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 dark:border-[#1f1f1f] dark:bg-[#111111]">
        <Search className="h-3.5 w-3.5 flex-shrink-0 text-gray-300 dark:text-zinc-600" />
        <input
          value={filters.q}
          onChange={e => set('q', e.target.value)}
          placeholder="Search people, papers, fields…"
          className="w-full border-none bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-300 dark:text-zinc-300 dark:placeholder:text-zinc-600"
        />
        {filters.q && (
          <button type="button" onClick={() => set('q', '')} className="flex-shrink-0" aria-label="Clear search">
            <X className="h-3 w-3 text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300" />
          </button>
        )}
      </div>

      <div className={SELECT_WRAP}>
        <Calendar className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 dark:text-zinc-500" />
        <select
          value={filters.days}
          onChange={e => set('days', e.target.value as DateWindow)}
          className={SELECT}
          aria-label="Time window"
        >
          <option value="all">All time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
      </div>

      <div className={SELECT_WRAP}>
        <CircleDot className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 dark:text-zinc-500" />
        <select
          value={filters.completion}
          onChange={e => set('completion', e.target.value as CompletionFilter)}
          className={SELECT}
          aria-label="Completion"
        >
          <option value="all">Any status</option>
          <option value="complete">Complete</option>
          <option value="progress">In progress</option>
        </select>
      </div>

      {people.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <PersonFilterChip
            label="Everyone"
            active={filters.personId === 'all'}
            onClick={() => set('personId', 'all')}
          />
          {people.map(p => (
            <PersonFilterChip
              key={p.userId}
              label={p.short}
              title={p.name}
              person={p}
              active={filters.personId === p.userId}
              onClick={() => set('personId', filters.personId === p.userId ? 'all' : p.userId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PersonFilterChip({
  label, title, person, active, onClick,
}: {
  label: string;
  title?: string;
  person?: Person;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border text-[11px] font-semibold transition-colors',
        person ? 'py-0.5 pl-0.5 pr-2.5' : 'px-2.5 py-1',
        active
          ? 'border-gray-900 bg-gray-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900'
          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-400 dark:hover:border-[#3f3f3f]',
      )}
    >
      {person && <Avatar email={person.avatarKey} name={person.name} size="xs" />}
      {label}
    </button>
  );
}

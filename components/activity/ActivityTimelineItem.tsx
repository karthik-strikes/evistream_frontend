'use client';

import { FileText, FlaskConical, ClipboardList, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getActivityDisplay, getRelativeTime } from '@/lib/activity-helpers';
import type { Activity } from '@/types/api';

const iconMap: Record<string, React.ElementType> = {
  file: FileText,
  flask: FlaskConical,
  clipboard: ClipboardList,
  pin: Pin,
};

const colorMap: Record<string, { text: string; bg: string; badge: string; badgeText: string }> = {
  green: {
    text: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30',
    badge: 'bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800/50',
    badgeText: 'text-green-700 dark:text-green-400',
  },
  red: {
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-100 dark:bg-red-900/30',
    badge: 'bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800/50',
    badgeText: 'text-red-700 dark:text-red-400',
  },
  blue: {
    text: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    badge: 'bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800/50',
    badgeText: 'text-blue-700 dark:text-blue-400',
  },
  amber: {
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    badge: 'bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800/50',
    badgeText: 'text-amber-700 dark:text-amber-400',
  },
  gray: {
    text: 'text-gray-500 dark:text-zinc-400',
    bg: 'bg-gray-100 dark:bg-zinc-800',
    badge: 'bg-gray-100 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700',
    badgeText: 'text-gray-600 dark:text-zinc-400',
  },
};

interface ActivityTimelineItemProps {
  activity: Activity;
  isLast: boolean;
}

export function ActivityTimelineItem({ activity, isLast }: ActivityTimelineItemProps) {
  const display = getActivityDisplay(activity);
  const Icon = iconMap[display.icon] ?? Pin;
  const colors = colorMap[display.statusColor] ?? colorMap.gray;

  return (
    <div className="flex gap-3">
      {/* Timeline connector + icon */}
      <div className="flex flex-col items-center">
        <div className={cn('rounded-full p-1.5 flex-shrink-0', colors.bg)}>
          <Icon className={cn('h-4 w-4', colors.text)} />
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-gray-200 dark:bg-[#1f1f1f] min-h-[32px]" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-5 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">
          {display.title}
        </p>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
          {display.description}
        </p>

        {/* Footer: timestamp, project, status badge */}
        <div className="flex items-center flex-wrap gap-2 mt-2">
          <span className="text-xs text-gray-400 dark:text-zinc-500">
            {getRelativeTime(activity.created_at)}
          </span>
          {activity.project_name && (
            <>
              <span className="text-xs text-gray-300 dark:text-zinc-600">&middot;</span>
              <span className="text-xs text-gray-400 dark:text-zinc-500">
                {activity.project_name}
              </span>
            </>
          )}
          <span className="text-xs text-gray-300 dark:text-zinc-600">&middot;</span>
          <span
            className={cn(
              'inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border',
              colors.badge,
              colors.badgeText
            )}
          >
            {display.statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

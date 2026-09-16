'use client';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import { ROLE_COLORS, type ReviewRole } from '@/lib/reviewerColors';
import type { Person } from '@/hooks/useProjectPeople';

/**
 * The people vocabulary for /results: who touched a form, in what seat, when.
 *
 * Colours come from `lib/reviewerColors` and `components/ui/badge`, never from
 * the design canvas — a mockup's own palette (its amber "Reviewer" pill, its
 * green "Complete") reads as a different product next to these screens, and
 * badge.tsx's rule is that colour encodes required human action and nothing
 * else. So "In progress" is `attention` and "Complete" is `neutral`: the amber
 * marks the one that still needs somebody.
 */

const KNOWN_ROLES: ReadonlySet<string> = new Set(['reviewer_1', 'reviewer_2', 'adjudicator', 'ai']);

export function isReviewRole(role: string | null | undefined): role is ReviewRole {
  return !!role && KNOWN_ROLES.has(role);
}

/** R1 / R2 / ADJ, or "Extra" for a save that holds no seat. */
export function RoleTag({ role, className }: { role: string | null; className?: string }) {
  if (!isReviewRole(role)) {
    return (
      <span
        title="Additional extraction — not part of the R1/R2 comparison"
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
          'bg-gray-100 text-gray-500 dark:bg-zinc-700/40 dark:text-zinc-400',
          className,
        )}
      >
        Extra
      </span>
    );
  }
  const def = ROLE_COLORS[role];
  return (
    <span
      title={def.label}
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', def.pill, className)}
    >
      {def.short}
    </span>
  );
}

/**
 * Overlapping avatars, newest-relevant first. Ring colour matches the card it
 * sits on so the overlap reads as a stack rather than a smudge.
 */
export function AvatarStack({
  people,
  size = 'sm',
  max = 4,
  onDark = false,
}: {
  people: Person[];
  size?: 'xs' | 'sm' | 'md';
  max?: number;
  onDark?: boolean;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center" title={people.map(p => p.name).join(', ')}>
      {shown.map((p, i) => (
        <Avatar
          key={p.userId}
          email={p.avatarKey}
          name={p.name}
          size={size}
          className={cn(
            'ring-2',
            onDark ? 'ring-white dark:ring-[#0d0d0d]' : 'ring-white dark:ring-[#111111]',
            i > 0 && '-ml-2',
          )}
        />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            '-ml-2 inline-flex items-center justify-center rounded-full ring-2 font-semibold',
            'bg-gray-100 text-gray-500 dark:bg-[#1f1f1f] dark:text-zinc-400',
            onDark ? 'ring-white dark:ring-[#0d0d0d]' : 'ring-white dark:ring-[#111111]',
            size === 'xs' ? 'h-[22px] w-[22px] text-[9px]' : size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-xs',
          )}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

/** A person and their seat, as one chip. The design's "contribution" pill.
 *
 *  Clickable when `onClick` is given — the chip names a person, so the obvious
 *  thing it should do is show you that person's work. */
export function PersonChip({
  person,
  role,
  count,
  onClick,
}: {
  person: Person;
  role?: string | null;
  count?: number;
  onClick?: () => void;
}) {
  const body = (
    <>
      <Avatar email={person.avatarKey} name={person.name} size="xs" />
      <span className="max-w-[11rem] truncate font-medium">{person.name}</span>
      {role !== undefined && <RoleTag role={role ?? null} />}
      {count != null && (
        <span className="tabular-nums text-[11px] text-gray-400 dark:text-zinc-500">
          {count} {count === 1 ? 'edit' : 'edits'}
        </span>
      )}
    </>
  );
  const base =
    'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white py-1 pl-1 pr-2.5 text-[12px] text-gray-700 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300';
  if (!onClick) return <span className={base}>{body}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Open this form showing only ${person.name}'s answers`}
      className={cn(base, 'cursor-pointer transition-colors hover:border-gray-400 hover:bg-gray-50 dark:hover:border-[#3f3f3f] dark:hover:bg-[#1a1a1a]')}
    >
      {body}
    </button>
  );
}

/**
 * Relative on screen, absolute in the tooltip.
 *
 * The canvas offered an absolute/relative switch. That is a canvas editor prop
 * — it exists so a designer can preview both — not a feature request, the same
 * call the Aug 20 redesign made about the density toggle. Showing the relative
 * form with the exact timestamp on hover gives a reader both without a control.
 */
export function TimeAgo({ at, className }: { at: string | null | undefined; className?: string }) {
  if (!at) return <span className={cn('text-gray-300 dark:text-zinc-600', className)}>—</span>;
  return (
    <span title={formatDate(at)} className={cn('whitespace-nowrap tabular-nums', className)}>
      {formatRelativeTime(at)}
    </span>
  );
}

/** Complete / In progress. See the colour note at the top of this file.
 *
 *  There is deliberately no third badge for "no rows": a form nobody has
 *  started should say nothing, not claim a state. The caller omits it. */
export function CompletionBadge({ completion }: { completion: 'complete' | 'progress' }) {
  // Scoped to THIS form, and the tooltip has to say so: a reviewer with no open
  // draft here can still be mid-way through the paper's other forms, which is
  // exactly how Allocations can read "0/2 done" beside this badge.
  return completion === 'progress' ? (
    <Badge variant="attention" title="Someone has an unsubmitted draft on this form">
      In progress
    </Badge>
  ) : (
    <Badge variant="neutral" title="Every manual save on this form has been submitted. Says nothing about the paper's other forms.">
      Complete
    </Badge>
  );
}

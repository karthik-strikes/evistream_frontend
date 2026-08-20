'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Tags rendered before the rest collapse behind a "+N". Two, not three: every
 * row that carries tags also carries system facts — a status badge, reviewer
 * dots, a provenance chip — and those have to win the space.
 */
export const MAX_VISIBLE_TAGS = 2;

/**
 * One tag chip.
 *
 * Renders as a SPAN, never a `<button>`, even when it is clickable. Four of the
 * rows that show tags are themselves `<button>` elements (the run-extraction
 * picker, the manual-extraction picker, the queue sidebar) and a nested button
 * is invalid HTML that React hydrates unpredictably. `role="button"` plus a
 * keydown handler buys the behaviour without the nesting — and the click always
 * stops propagation, so filtering by a tag never also toggles the row's
 * selection.
 *
 * Colour: neutral, always. Per `badge.tsx`, colour encodes required human
 * action, and a user's own vocabulary asks nothing of the system. The
 * active-filter state is a darker border and text, not a new hue.
 *
 * An earlier version on the Documents page hashed the tag name into five hues,
 * which produced actively misleading output: `included` rendered red, `included`
 * and `excluded` rendered identically, `high risk` got the exact amber that page
 * uses for "needs attention", and `pubmed` got the exact green of the PubMed
 * system badge. A colour nobody chose cannot mean anything, and it collided with
 * colours that do.
 *
 * Casing is preserved (no `uppercase`): it is the user's text, and shouting it
 * made `COVID-19` and `covid-19` — two distinct tags, since dedupe is
 * case-sensitive — render identically.
 *
 * One chip for every context: staged, saved, and being edited. They used to
 * render three different ways, so a tag typed as grey lowercase saved as a
 * shouty violet pill.
 */
export function LabelChip({
  label,
  onRemove,
  onClick,
  active = false,
  className,
}: {
  label: string;
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const interactive = !!onClick;

  const fire = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClick?.();
  };

  return (
    <Tooltip content={label}>
      <Badge
        variant="neutral"
        className={cn(
          'max-w-[9rem] shrink-0',
          interactive && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a1a1a]',
          active && 'border-gray-900 text-gray-900 dark:border-zinc-300 dark:text-zinc-100',
          className,
        )}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-pressed={interactive ? active : undefined}
        onClick={interactive ? fire : undefined}
        onKeyDown={
          interactive
            ? (e: KeyboardEvent) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                fire(e);
              }
            : undefined
        }
      >
        <span className="truncate">{label}</span>
        {onRemove && (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); e.preventDefault(); onRemove(); }}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.stopPropagation();
              e.preventDefault();
              onRemove();
            }}
            aria-label={`Remove tag ${label}`}
            className="shrink-0 cursor-pointer leading-none text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-zinc-300"
          >
            <X className="h-2.5 w-2.5" />
          </span>
        )}
      </Badge>
    </Tooltip>
  );
}

/**
 * A row's tags, inline beside the paper name.
 *
 * Pass `onToggleTag` to make the chips a filter control; leave it off for a
 * read-only row. Overflow past `max` collapses into a "+N" that names the
 * hidden tags on hover — it does not expand in place, because these rows live
 * inside scrolling pickers where a row changing height moves the click target
 * out from under the cursor.
 */
export function DocumentTags({
  labels,
  activeTags = [],
  onToggleTag,
  max = MAX_VISIBLE_TAGS,
  className,
}: {
  labels: string[] | null | undefined;
  activeTags?: string[];
  onToggleTag?: (tag: string) => void;
  max?: number;
  className?: string;
}) {
  const all = labels ?? [];
  if (all.length === 0) return null;

  // An active tag always shows, even past `max` — a filter you cannot see is a
  // filter you cannot turn off.
  const pinned = all.filter(t => activeTags.includes(t));
  const rest = all.filter(t => !activeTags.includes(t));
  const shown = [...pinned, ...rest.slice(0, Math.max(0, max - pinned.length))];
  const hidden = all.filter(t => !shown.includes(t));

  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      {shown.map(tag => (
        <LabelChip
          key={tag}
          label={tag}
          active={activeTags.includes(tag)}
          onClick={onToggleTag ? () => onToggleTag(tag) : undefined}
        />
      ))}
      {hidden.length > 0 && (
        <Tooltip content={hidden.join(', ')} className="max-w-xs whitespace-normal">
          <span className="shrink-0 rounded-full border border-gray-200 px-1.5 py-0.5 text-[11px] font-medium leading-5 text-gray-500 dark:border-[#2a2a2a] dark:text-zinc-400">
            +{hidden.length}
          </span>
        </Tooltip>
      )}
    </span>
  );
}

/**
 * The active tag filter, shown only while something is filtering.
 *
 * Needed because AND semantics can empty the list: with no rows left there are
 * no chips left to click, and without this bar the filter would be unclearable.
 */
export function TagFilterBar({
  activeTags,
  onToggleTag,
  onClear,
  className,
}: {
  activeTags: string[];
  onToggleTag: (tag: string) => void;
  onClear: () => void;
  className?: string;
}) {
  if (activeTags.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="text-[11px] font-medium text-gray-400 dark:text-zinc-500">Tagged</span>
      {activeTags.map(tag => (
        <LabelChip key={tag} label={tag} active onRemove={() => onToggleTag(tag)} />
      ))}
      <button
        type="button"
        onClick={onClear}
        className="cursor-pointer border-none bg-transparent px-1 text-[11px] font-medium text-gray-500 underline-offset-2 transition-colors hover:text-gray-800 hover:underline dark:text-zinc-400 dark:hover:text-white"
      >
        Clear
      </button>
    </div>
  );
}

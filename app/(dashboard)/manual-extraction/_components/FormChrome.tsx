'use client';

import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';
import { FieldInfoTooltip } from '@/components/forms/FieldInfoTooltip';

/**
 * Shared chrome for the manual-extraction form.
 *
 * The form used to nest three levels of card: a bordered field box inside a
 * bordered section inside the bordered panel. At the pane widths reviewers
 * actually work at, that left roughly a 240px usable line for a twenty-column
 * table — and every field paid a 28px numbering gutter plus two lines of
 * description for the privilege. Everything here is flat instead: a heading, a
 * hairline, a responsive grid. The only border left is the panel's own.
 */

export const humanize = (s: string) => s.replace(/_/g, ' ');

/** A hairline between sections. */
export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-gray-100 dark:bg-[#1a1a1a]', className)} />;
}

/**
 * A responsive column grid.
 *
 * `auto-fit` rather than a fixed column count, because this pane is resizable
 * and the PDF beside it takes whatever the reviewer gives it: two columns is
 * right at 700px, one at 380px, three at 1100px — and committing to any one of
 * those in advance is wrong at the other two widths.
 */
export function AutoGrid({ min = 240, gap = 'gap-x-5 gap-y-4', className, children }: {
  min?: number;
  gap?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn('grid', gap, className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}
    >
      {children}
    </div>
  );
}

/** Full width inside an AutoGrid, whatever the current column count. */
export const spanAll: CSSProperties = { gridColumn: '1 / -1' };

export function FieldLabel({
  name, required, field, tone = 'field', color, note, noteColor, children, className,
}: {
  name: string;
  required?: boolean;
  /** The column or field this labels. Its description, options and hints live
   *  in the hover card rather than as prose under every input — reviewers read
   *  a hint on the first paper, not the fortieth. */
  field?: FormField;
  /** `field` for a standalone input, `cell` for a column inside a row grid. */
  tone?: 'field' | 'cell';
  /** Overrides the label colour — used to tint a group's columns with the
   *  group's own hue, which is user-supplied and so cannot be a class. */
  color?: string;
  note?: ReactNode;
  noteColor?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-1.5 flex min-w-0 items-center gap-1.5', className)}>
      <span
        style={color ? { color } : undefined}
        className={cn(
          'min-w-0 truncate leading-none',
          tone === 'cell'
            ? 'text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-zinc-500'
            : 'text-[12px] font-semibold capitalize text-gray-700 dark:text-zinc-300',
        )}
      >
        {humanize(name)}
      </span>
      {required && <span className="flex-none text-[11px] leading-none text-red-400">*</span>}
      {/* Beside the label, not under the input: a hover card cannot cover the
          field it explains if it opens sideways. */}
      <span className="flex-none leading-none"><FieldInfoTooltip field={field} side="right" /></span>
      {note ? (
        <span
          className="flex-none text-[10px] font-semibold leading-none"
          style={noteColor ? { color: noteColor } : undefined}
        >
          {note}
        </span>
      ) : null}
      {children}
    </div>
  );
}

/** A numbered section heading. Flat on purpose — the number and the rule below
 *  the block carry the grouping that a card used to. */
export function SectionHead({
  step, title, note, chip, action, className,
}: {
  step?: number;
  title: string;
  note?: string;
  chip?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1', className)}>
      <span className="text-[13px] font-bold capitalize text-gray-900 dark:text-zinc-100">
        {step != null && <span className="text-gray-400 dark:text-zinc-600">{step} · </span>}
        {title}
      </span>
      {note && <span className="text-[11px] text-gray-400 dark:text-zinc-500">{note}</span>}
      {chip}
      {action && <span className="ml-auto self-center">{action}</span>}
    </div>
  );
}

export function GhostButton({
  onClick, disabled, title, className, children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex flex-none items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-[#2a2a2a] dark:bg-[#161616] dark:text-zinc-300 dark:hover:bg-[#1f1f1f]',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function CountChip({ filled, total, error }: { filled: number; total: number; error?: boolean }) {
  return (
    <span
      className={cn(
        'flex-none rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
        error
          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          : total > 0 && filled >= total
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : filled > 0
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              : 'bg-gray-100 text-gray-500 dark:bg-[#1a1a1a] dark:text-zinc-500',
      )}
    >
      {filled}/{total}
    </span>
  );
}

/** The small numbered disc that opens an arm, an outcome or a result row.
 *  Tinted with the group's own colour, which is user-supplied, so it has to be
 *  an inline style rather than a Tailwind class. */
export function NumBadge({ n, color, size = 20 }: { n: number | string; color?: string; size?: number }) {
  const tint = color ?? '#6b7280';
  return (
    <span
      className="inline-flex flex-none items-center justify-center rounded-full text-[10px] font-bold tabular-nums"
      style={{ width: size, height: size, color: tint, background: `${tint}1f` }}
    >
      {n}
    </span>
  );
}

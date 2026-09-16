'use client';

import { Info } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';

/**
 * What a form field means, on hover.
 *
 * This is the results table's column tooltip — that screen had it first — lifted
 * out so every place that labels a field can use the same one. Manual extraction
 * used `title=`, the browser's own tooltip: unstyled, slow to appear, and it
 * drops a grey slab over the field you are trying to fill. This card is clamped
 * inside the viewport and is `pointer-events-none`, so it never eats a click.
 */

const CARD =
  'rounded-xl border border-gray-200 bg-white p-3.5 text-[11px] font-normal leading-relaxed text-gray-700 shadow-xl w-72 whitespace-normal text-left dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-300';

/** True when the field says anything beyond its own type. A lone "TEXT" pill is
 *  worth an icon on a bare column header, and is noise beside a form label that
 *  already reads as text. */
export function hasFieldInfo(field?: FormField | null): boolean {
  if (!field) return false;
  return !!(
    field.field_description?.trim() ||
    field.extraction_hints?.trim() ||
    field.options?.length
  );
}

export function FieldInfoBody({ field }: { field: FormField }) {
  const opts = field.options ?? [];
  return (
    <div className="space-y-1.5">
      <span className="inline-block rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600 dark:border-[#2a2a2a] dark:bg-[#2a2a2a] dark:text-zinc-400">
        {field.multiple ? `${field.field_type} · multi` : field.field_type}
      </span>
      {field.field_description && (
        <p className="text-xs leading-snug">{field.field_description}</p>
      )}
      {opts.length > 0 && (
        <div>
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
            Options
          </p>
          <ul className="space-y-0.5 text-xs">
            {opts.slice(0, 6).map(o => (
              <li key={o} className="text-gray-600 dark:text-zinc-400">• {o}</li>
            ))}
            {opts.length > 6 && (
              <li className="text-gray-400 dark:text-zinc-600">+{opts.length - 6} more</li>
            )}
          </ul>
        </div>
      )}
      {field.extraction_hints && (
        <div>
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
            Hint
          </p>
          <p className="text-xs leading-snug text-gray-600 dark:text-zinc-400">
            {field.extraction_hints}
          </p>
        </div>
      )}
    </div>
  );
}

export function FieldInfoTooltip({
  field, side = 'top', always, className,
}: {
  field?: FormField | null;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Show the icon even when the field carries only its type — a column header
   *  has nothing else to explain it, a form label does. */
  always?: boolean;
  className?: string;
}) {
  if (!field || (!always && !hasFieldInfo(field))) return null;
  return (
    <Tooltip content={<FieldInfoBody field={field} />} side={side} className={CARD}>
      <Info
        className={cn(
          'h-3 w-3 flex-shrink-0 cursor-default text-blue-400 transition-colors hover:text-blue-500 dark:text-blue-500',
          className,
        )}
      />
    </Tooltip>
  );
}

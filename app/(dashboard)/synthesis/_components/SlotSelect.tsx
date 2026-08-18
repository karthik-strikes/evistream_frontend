'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Mapping, SlotKey } from '../_lib/mapping';

/**
 * One analysis slot.
 *
 * The confirm step is the whole safety mechanism for an AI-suggested mapping:
 * a suggestion is amber and inert, and only a reviewer's tick turns it into
 * something the analysis will read. So the two states have to look different
 * at a glance, and the model's reason has to be reachable without a click.
 */
export function SlotSelect({
  slotKey,
  mapping,
  columns,
  onSelect,
  onConfirm,
  label,
  sourceField,
  showPath = false,
}: {
  slotKey: SlotKey;
  mapping: Mapping;
  columns: string[];
  onSelect: (key: SlotKey, col: string) => void;
  onConfirm: (key: SlotKey) => void;
  label?: string;
  sourceField?: string | null;
  showPath?: boolean;
}) {
  const slot = mapping[slotKey];
  const col = slot?.col ?? '';
  const suggested = slot?.status === 'suggested';
  const confirmed = slot?.status === 'confirmed';

  return (
    <div
      className={cn(
        'rounded-lg px-2.5 py-2 border-[1.5px]',
        confirmed && 'border-solid border-green-300 bg-white dark:border-green-900/70 dark:bg-[#111111]',
        suggested && 'border-dashed border-amber-500 bg-amber-50 dark:border-amber-700 dark:bg-amber-500/5',
        !slot && 'border-dashed border-gray-300 bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#0d0d0d]',
      )}
    >
      {label && (
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 mb-1">
          {label}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <select
          value={col}
          onChange={e => onSelect(slotKey, e.target.value)}
          className="flex-1 min-w-0 border-none bg-transparent text-[13px] text-gray-900 dark:text-white py-0.5 focus:outline-none"
        >
          <option value="">Select column…</option>
          {columns.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {suggested && (
          <>
            <span
              title={slot?.why || 'Suggested — confirm before running'}
              className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800 whitespace-nowrap dark:bg-amber-500/15 dark:text-amber-300 cursor-help"
            >
              Suggested
            </span>
            <button
              type="button"
              onClick={() => onConfirm(slotKey)}
              title="Confirm this mapping"
              className="cursor-pointer border border-gray-200 bg-white rounded-md px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-300 dark:hover:bg-[#222]"
            >
              <Check className="h-3 w-3" />
            </button>
          </>
        )}

        {confirmed && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-green-700 dark:text-green-400 whitespace-nowrap">
            <Check className="h-2.5 w-2.5" />
            Confirmed
          </span>
        )}
      </div>

      {showPath && col && sourceField && (
        <div className="font-mono text-[10.5px] text-gray-400 dark:text-zinc-600 mt-1">
          {sourceField} › {col}
        </div>
      )}
    </div>
  );
}

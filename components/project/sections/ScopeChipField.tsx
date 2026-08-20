'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ScopeChipFieldProps {
  label: string;
  hint: string;
  placeholder: string;
  /** Tailwind fill + text for this family's chips. */
  chipClass: string;
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * One multi-entry scope field: chips in a well, with an inline input.
 * Enter adds, Backspace on an empty input removes the last chip, × removes one.
 * Duplicates are ignored silently — re-typing an entry shouldn't double it.
 */
export function ScopeChipField({
  label,
  hint,
  placeholder,
  chipClass,
  values,
  onChange,
  disabled,
}: ScopeChipFieldProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const t = draft.trim();
    setDraft('');
    if (!t || values.includes(t)) return;
    onChange([...values, t]);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <label className="text-[12px] font-semibold text-gray-700 dark:text-zinc-200">
          {label}
        </label>
        <span className="text-[11px] text-gray-400 dark:text-zinc-500">{hint}</span>
      </div>
      <div
        className={cn(
          'rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-gray-50/60 dark:bg-[#141414]',
          'px-2 py-1.5 flex flex-wrap items-center gap-1.5 transition-colors',
          !disabled && 'focus-within:border-gray-400 dark:focus-within:border-[#3a3a3a]'
        )}
      >
        {values.map((v) => (
          <span
            key={v}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full text-[12px] font-medium',
              disabled ? 'px-2.5 py-1' : 'pl-2.5 pr-1 py-1',
              chipClass
            )}
          >
            {v}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
                className="w-4 h-4 rounded-full bg-black/[0.07] dark:bg-white/10 hover:bg-black/[0.14] dark:hover:bg-white/20 flex items-center justify-center text-[10px] leading-none transition-colors"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            onBlur={commit}
            placeholder={values.length ? 'Add another — Enter' : placeholder}
            className="flex-1 min-w-[150px] bg-transparent border-none outline-none text-[12.5px] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-600 px-1 py-1"
          />
        )}
        {disabled && !values.length && (
          <span className="text-[12px] text-gray-400 dark:text-zinc-600 px-1 py-1">None</span>
        )}
      </div>
    </div>
  );
}

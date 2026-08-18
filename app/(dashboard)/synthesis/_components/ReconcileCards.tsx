'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  EXCLUDE, KEEP,
  type Confirmations, type Directions, type Harmonization,
  type ScaleTally, type ValueTally,
} from '../_lib/reconcile';

/**
 * The two value-reconciliation cards on step 1.
 *
 * Both follow the same rule as every other suggestion on this screen: amber
 * means provisional and **inert** — nothing about the analysis changes until the
 * ✓ is pressed. Rows with no suggestion carry no chip at all, because nothing
 * was inferred about them and asking for a confirmation would be theatre.
 */

function SuggestState({
  suggested, confirmed, why, onConfirm,
}: {
  suggested: boolean;
  confirmed: boolean;
  why?: string;
  onConfirm: () => void;
}) {
  if (!suggested) return <span />;
  if (confirmed) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold text-green-700 dark:text-green-400 whitespace-nowrap">
        <Check className="h-2.5 w-2.5" />
        Confirmed
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <span
        title={why || 'Suggested — confirm before it takes effect'}
        className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800 whitespace-nowrap dark:bg-amber-500/15 dark:text-amber-300 cursor-help"
      >
        Suggested
      </span>
      <button
        type="button"
        onClick={onConfirm}
        title="Apply this"
        className="cursor-pointer border border-gray-200 bg-white rounded-md px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-300 dark:hover:bg-[#222]"
      >
        <Check className="h-3 w-3" />
      </button>
    </div>
  );
}

const selectClass =
  'h-8 border border-gray-200 rounded-md bg-white text-[12.5px] px-2 text-gray-900 ' +
  'dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white focus:outline-none max-w-full';

const cardClass =
  'border border-border rounded-lg bg-white p-4 dark:bg-[#111111] dark:border-[#1f1f1f]';

// ── Harmonize ────────────────────────────────────────────────────────────────

export function HarmonizeCard({
  column,
  values,
  choices,
  reasons,
  confirmed,
  onChoice,
  onConfirm,
  mergedCount,
}: {
  column: string;
  values: ValueTally[];
  choices: Harmonization;
  reasons: Record<string, string>;
  confirmed: Confirmations;
  onChoice: (raw: string, choice: string) => void;
  onConfirm: (raw: string) => void;
  /** How many rows are currently being merged away, once confirmed. */
  mergedCount: number;
}) {
  if (values.length < 2) return null;

  return (
    <div className={cardClass}>
      <div className="text-[15px] font-semibold dark:text-white">Harmonize values</div>
      <div className="text-[12.5px] text-gray-500 dark:text-zinc-400 mt-1 leading-relaxed">
        Distinct raw values in <span className="font-mono text-[11.5px]">{column}</span>. Group
        synonyms so equivalent rows pool together — merges are only ever suggested when two values
        are the same duration, never because they look similar.
      </div>

      <div className="mt-3 border border-gray-100 dark:border-[#1f1f1f] rounded-lg overflow-hidden">
        {values.map(v => {
          const choice = choices[v.raw] ?? KEEP;
          const suggested = !!reasons[v.raw];
          const isMerged = choice !== KEEP && choice !== EXCLUDE;
          return (
            <div
              key={v.raw}
              className={cn(
                'grid grid-cols-[minmax(0,180px)_76px_16px_minmax(0,220px)_130px] gap-3 items-center px-3 py-2 border-b border-gray-100 dark:border-[#1f1f1f] last:border-b-0',
                choice === EXCLUDE && confirmed[v.raw] && 'bg-gray-50 dark:bg-[#0d0d0d]',
              )}
            >
              <span className="font-mono text-[12.5px] text-gray-900 dark:text-white truncate" title={v.raw}>
                &ldquo;{v.raw}&rdquo;
              </span>
              <span className="text-xs text-gray-500 dark:text-zinc-500">
                {v.rows} {v.rows === 1 ? 'row' : 'rows'}
              </span>
              <span className="text-xs text-gray-400 dark:text-zinc-600">
                {isMerged ? '→' : ''}
              </span>
              <select
                value={choice}
                onChange={e => onChoice(v.raw, e.target.value)}
                className={selectClass}
              >
                <option value={KEEP}>Keep as its own value</option>
                {values
                  .filter(o => o.raw !== v.raw)
                  .map(o => (
                    <option key={o.raw} value={o.raw}>
                      Merge into &ldquo;{o.raw}&rdquo;
                    </option>
                  ))}
                <option value={EXCLUDE}>Exclude from analysis</option>
              </select>
              <SuggestState
                suggested={suggested || choice !== KEEP}
                confirmed={!!confirmed[v.raw]}
                why={reasons[v.raw]}
                onConfirm={() => onConfirm(v.raw)}
              />
            </div>
          );
        })}
      </div>

      {mergedCount > 0 && (
        <div className="text-xs text-gray-500 dark:text-zinc-500 mt-2.5 leading-relaxed">
          {mergedCount} {mergedCount === 1 ? 'value is' : 'values are'} waiting to be merged. Until
          confirmed they stay separate, exactly as they are now.
        </div>
      )}
    </div>
  );
}

// ── Effect direction ─────────────────────────────────────────────────────────

export function DirectionCard({
  scales,
  choices,
  reasons,
  confirmed,
  onChoice,
  onConfirm,
}: {
  scales: ScaleTally[];
  choices: Directions;
  reasons: Record<string, string>;
  confirmed: Confirmations;
  onChoice: (scale: string, choice: 'use' | 'reverse') => void;
  onConfirm: (scale: string) => void;
}) {
  if (scales.length < 2) return null;

  return (
    <div className={cardClass}>
      <div className="text-[15px] font-semibold dark:text-white">Effect direction</div>
      <div className="text-[12.5px] text-gray-500 dark:text-zinc-400 mt-1 leading-relaxed">
        Scales must agree on what a higher score means. Reversed scales have their sign flipped
        before pooling — otherwise a real effect on one scale cancels a real effect on the other.
      </div>

      <div className="mt-3 border border-gray-100 dark:border-[#1f1f1f] rounded-lg overflow-hidden">
        {scales.map(s => (
          <div
            key={s.scale}
            className="grid grid-cols-[minmax(0,190px)_80px_minmax(0,120px)_minmax(0,160px)_130px] gap-3 items-center px-3 py-2 border-b border-gray-100 dark:border-[#1f1f1f] last:border-b-0"
          >
            <span className="font-mono text-[12.5px] text-gray-900 dark:text-white truncate" title={s.scale}>
              {s.scale}
            </span>
            <span className="text-xs text-gray-500 dark:text-zinc-500">
              {s.studies} {s.studies === 1 ? 'study' : 'studies'}
            </span>
            <span
              className={cn(
                'text-xs',
                s.direction === 'unknown'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-gray-500 dark:text-zinc-500',
              )}
            >
              {s.note}
            </span>
            <select
              value={choices[s.scale] ?? 'use'}
              onChange={e => onChoice(s.scale, e.target.value as 'use' | 'reverse')}
              className={selectClass}
            >
              <option value="use">Use as-is</option>
              <option value="reverse">Reverse sign</option>
            </select>
            <SuggestState
              suggested={!!reasons[s.scale] || choices[s.scale] === 'reverse'}
              confirmed={!!confirmed[s.scale]}
              why={reasons[s.scale]}
              onConfirm={() => onConfirm(s.scale)}
            />
          </div>
        ))}
      </div>

      {scales.some(s => s.direction === 'unknown') && (
        <div className="text-xs text-gray-500 dark:text-zinc-500 mt-2.5 leading-relaxed">
          A scale whose direction couldn&rsquo;t be read from its name is never flipped on a guess —
          set it yourself if it runs the other way.
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * The five domains, plus Overall, down the left.
 *
 * Each row carries the domain's own judgement, so a reviewer can see at a glance
 * which domain is driving the overall. The counts say answered-of-applicable
 * rather than answered-of-22: RoB 2 routes most of its conditional questions
 * out, and a progress bar that counts questions nobody will be asked is a
 * progress bar that never fills.
 *
 * **The judgement sits under the name, not beside it.** Sharing one 230px row
 * meant the pill's width decided how much of the name survived, so the domains
 * at "Some concerns" truncated harder than the ones at "Low" — "Deviati…" next
 * to "Missing outcom…". The domain a reviewer is looking for is the one they
 * cannot read, and which word gets cut should not depend on the judgement.
 */

import { SEVERITY_GLYPH, SEVERITY_SHORT } from '../_lib/robQueue';
import { ROB2_SIGNALLING, type Severity } from '../_lib/rob2';

interface Props {
  active: number;
  onSelect: (index: number) => void;
  severities: Severity[];
  confirmed: boolean[];
  /**
   * Per domain: answered, applicable, and whether more may yet appear. The `+`
   * is what stops "3/3" reading as finished when one answer would add four
   * questions.
   */
  counts: Array<{ answered: number; applicable: number; mayGrow?: boolean }>;
  overall: Severity;
}

export function SeverityPill({ severity }: { severity: Severity }) {
  const tone: Record<Severity, string> = {
    low: 'border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-900/50 dark:text-emerald-400 dark:bg-emerald-500/5',
    some: 'border-amber-200 text-amber-800 bg-amber-50 dark:border-amber-900/50 dark:text-amber-400 dark:bg-amber-500/5',
    high: 'border-red-200 text-red-700 bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:bg-red-500/5',
    none: 'border-gray-200 text-gray-400 bg-transparent dark:border-[#2a2a2a] dark:text-zinc-600',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold rounded-full border px-1.5 py-px whitespace-nowrap ${tone[severity]}`}>
      {SEVERITY_GLYPH[severity] && <span aria-hidden>{SEVERITY_GLYPH[severity]}</span>}
      {SEVERITY_SHORT[severity]}
    </span>
  );
}

export function DomainRail({ active, onSelect, severities, confirmed, counts, overall }: Props) {
  return (
    <nav className="flex flex-col gap-1 p-2" aria-label="Domains">
      {ROB2_SIGNALLING.map((domain, i) => (
        <button
          key={domain.code}
          type="button"
          aria-current={active === i}
          onClick={() => onSelect(i)}
          className={[
            'flex items-start gap-2.5 w-full text-left rounded-lg px-2.5 py-3 border transition-colors',
            active === i
              ? 'bg-gray-100 border-gray-300 text-gray-900 dark:bg-[#161616] dark:border-[#2a2a2a] dark:text-white'
              : 'border-transparent text-gray-700 hover:bg-gray-50 dark:text-zinc-300 dark:hover:bg-[#141414]',
          ].join(' ')}
        >
          <span className={[
            'flex items-center justify-center w-[25px] h-[25px] rounded-[7px] text-[11px] font-bold flex-shrink-0 border',
            active === i || confirmed[i]
              ? 'bg-gray-900 border-gray-900 text-white dark:bg-white dark:border-white dark:text-gray-900'
              : 'bg-white border-gray-200 text-gray-500 dark:bg-transparent dark:border-[#2a2a2a] dark:text-zinc-500',
          ].join(' ')}>
            {confirmed[i] ? '✓' : i + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold leading-snug">
              {domain.name}
            </span>
            <span className="flex items-center gap-2 flex-wrap mt-1">
              <SeverityPill severity={severities[i] ?? 'none'} />
              <span className="text-[11px] text-gray-500 dark:text-zinc-500">
                {counts[i]?.answered ?? 0}/{counts[i]?.applicable ?? 0}
                {counts[i]?.mayGrow && '+'}
              </span>
            </span>
          </span>
        </button>
      ))}
      <button
        type="button"
        aria-current={active === 5}
        onClick={() => onSelect(5)}
        className={[
          'flex items-start gap-2.5 w-full text-left rounded-lg px-2.5 py-3 border transition-colors',
          active === 5
            ? 'bg-gray-100 border-gray-300 text-gray-900 dark:bg-[#161616] dark:border-[#2a2a2a] dark:text-white'
            : 'border-transparent text-gray-700 hover:bg-gray-50 dark:text-zinc-300 dark:hover:bg-[#141414]',
        ].join(' ')}
      >
        <span className={[
          'flex items-center justify-center w-[25px] h-[25px] rounded-[7px] text-[11px] font-bold flex-shrink-0 border',
          active === 5
            ? 'bg-gray-900 border-gray-900 text-white dark:bg-white dark:border-white dark:text-gray-900'
            : 'bg-white border-gray-200 text-gray-500 dark:bg-transparent dark:border-[#2a2a2a] dark:text-zinc-500',
        ].join(' ')}>
          Σ
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold leading-snug">
            Review &amp; complete
          </span>
          <span className="flex items-center gap-2 flex-wrap mt-1">
            <SeverityPill severity={overall} />
          </span>
        </span>
      </button>
    </nav>
  );
}

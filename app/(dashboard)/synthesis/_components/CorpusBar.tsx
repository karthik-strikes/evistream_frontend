'use client';

import Link from 'next/link';

/**
 * How the plotted corpus splits by provenance, as one line.
 *
 * Every segment is a count of documents, and the four add up to the project's
 * document count — so the grey tail is as much a part of the reading as the
 * green head. The bar replaces a prose warning: the same facts, but the
 * proportions are visible before the sentence is read, which is the point on a
 * screen that pools adjudicated and unreviewed values into one estimate.
 */
export function CorpusBar({
  consensus,
  manual,
  aiOnly,
  missing,
  total,
  href,
}: {
  consensus: number;
  manual: number;
  aiOnly: number;
  missing: number;
  total: number;
  href: string;
}) {
  const segments = [
    { label: 'consensus', count: consensus, bar: 'bg-emerald-600', dot: 'bg-emerald-600' },
    { label: 'manual review', count: manual, bar: 'bg-gray-800 dark:bg-zinc-300', dot: 'bg-gray-800 dark:bg-zinc-300' },
    {
      label: 'AI only — unreviewed',
      count: aiOnly,
      bar: 'bg-amber-500',
      dot: 'bg-amber-500',
    },
    {
      label: 'not extracted',
      count: missing,
      bar: 'bg-gray-200 dark:bg-[#2a2a2a]',
      dot: 'bg-gray-200 dark:bg-[#2a2a2a]',
    },
  ].filter(s => s.count > 0);

  // The denominator is the project's document count, never the sum of what
  // happens to have data — a short bar is the honest picture of thin coverage.
  const denom = Math.max(total, consensus + manual + aiOnly + missing, 1);
  const unresolved = aiOnly + missing > 0;

  return (
    <div className="border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#0d0d0d] rounded-xl px-4 py-3 mb-4">
      <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 mb-2.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-500 dark:text-zinc-500 whitespace-nowrap">
          Corpus · {total} document{total === 1 ? '' : 's'}
        </span>
        {segments.map(s => (
          <span key={s.label} className="flex items-center gap-1.5 whitespace-nowrap">
            <span className={`h-2.5 w-2.5 rounded-[3px] flex-shrink-0 ${s.dot}`} />
            <span className="text-[12.5px] text-gray-700 dark:text-zinc-300">
              {s.count} {s.label}
            </span>
          </span>
        ))}
        {unresolved && (
          <Link
            href={href}
            className="ml-auto text-[12.5px] font-medium text-amber-800 dark:text-amber-300 whitespace-nowrap hover:underline"
          >
            Resolve in Consensus →
          </Link>
        )}
      </div>
      <div className="flex items-center gap-1 h-2">
        {segments.map(s => (
          <div
            key={s.label}
            className={`h-2 rounded-full min-w-[6px] ${s.bar}`}
            style={{ width: `${(s.count / denom) * 100}%` }}
            title={`${s.count} ${s.label}`}
          />
        ))}
      </div>
    </div>
  );
}

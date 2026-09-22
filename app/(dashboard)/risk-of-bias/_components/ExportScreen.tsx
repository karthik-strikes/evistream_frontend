'use client';

/**
 * Take the assessments out — and say exactly what leaves with them.
 *
 * An export is the only artefact most people will ever read, so what it omits
 * matters as much as what it holds. Three things travel that usually do not,
 * and each exists because its absence made a file that could not be checked:
 *
 * **Routing.** A question RoB 2 never asked exports as `Not applicable`; one
 * nobody answered exports blank. Conflate them and a finished assessment is
 * indistinguishable from an abandoned one.
 *
 * **Provenance.** Which judgements came from the algorithm and which a reviewer
 * overrode, with their reason — and which answers were copied from a sibling
 * result rather than made looking at this one.
 *
 * **Identity.** All eight slots, so a row can be matched back to the estimate it
 * is about rather than to a paper.
 */

import { Download, Loader2 } from 'lucide-react';

interface Props {
  resultCount: number;
  completeCount: number;
  busy: boolean;
  onExport: (format: 'csv' | 'json') => void;
  onBack: () => void;
}

const INCLUDED = [
  ['The eight identity slots', 'study, comparison, population, outcome, measurement, timepoint, analysis population, analysis'],
  ['All 22 answers', 'in the tool’s own wording, with skipped questions as "Not applicable" and unanswered ones blank'],
  ['Every domain judgement', 'recomputed from the exported answers, with a column saying whether it came from the algorithm or an override'],
  ['Override reasons', 'the reviewer’s own words, beside the label they chose'],
  ['Completion and staleness', 'whether the review was declared complete, and whether the result’s identity changed after it was made'],
];

export function ExportScreen({ resultCount, completeCount, busy, onExport, onBack }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-bold tracking-tight dark:text-white">
              Export assessments
            </h1>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-1 leading-relaxed max-w-[76ch]">
              One row per assessed result — not per paper. {resultCount} result
              {resultCount === 1 ? '' : 's'} in this project, {completeCount} with a review declared
              complete. Incomplete reviews are included and marked as such, because leaving them out
              silently would make the file disagree with the queue.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex-none text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            ← Back
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-4">
          <button
            type="button"
            disabled={busy || resultCount === 0}
            onClick={() => onExport('csv')}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            Download CSV
          </button>
          <button
            type="button"
            disabled={busy || resultCount === 0}
            onClick={() => onExport('json')}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
          >
            <Download className="h-3 w-3" />
            Download JSON
          </button>
          <span className="text-[11.5px] text-gray-500 dark:text-zinc-500">
            CSV for a spreadsheet; JSON keeps nesting a table flattens.
          </span>
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 py-2">
          What is in the file
        </div>
        {INCLUDED.map(([what, detail]) => (
          <div key={what} className="border-t border-gray-100 dark:border-[#1a1a1a] py-2.5 first:border-t-0">
            <div className="text-[12.5px] font-medium dark:text-zinc-200">{what}</div>
            <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5 leading-relaxed">
              {detail}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#242424] bg-gray-50 dark:bg-[#0d0d0d] rounded-xl px-3 py-2.5 text-[12.5px] text-gray-600 dark:text-zinc-400">
        <span>
          Judgements are <strong>recomputed from the exported answers</strong>, not copied from
          whatever label was stored. A cached label that disagrees with the answers beside it is a
          bug to surface, not to publish — and what you see here is what the answers say.
        </span>
      </div>
    </div>
  );
}

'use client';

/**
 * Which comparison's trial answers to open.
 *
 * The six trial questions are stored per study AND comparison, because one arm
 * of a multi-arm trial can be double-blind and another open-label. So a study
 * with three comparisons has three sets of them, and "Trial answers →" on such
 * a study is a question, not a destination. It used to answer itself by taking
 * whichever comparison sorted first.
 *
 * A study with one comparison never reaches this screen — there is nothing to
 * choose, and making somebody confirm the only option is a click that carries
 * no decision.
 */

interface Comparison {
  contrastId: string;
  label: string;
  resultCount: number;
  complete: boolean;
}

export function TrialPicker({ studyLabel, comparisons, onOpen, onBack }: {
  studyLabel: string;
  comparisons: Comparison[];
  onOpen: (contrastId: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600">
              Queue · trial answers
            </div>
            <h1 className="text-[17px] font-bold tracking-tight dark:text-white">{studyLabel}</h1>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-1 leading-relaxed max-w-[76ch]">
              Choose a comparison. Trial answers are shared only among results with this study
              <em> and</em> this comparison — how participants were randomised is one fact about
              the trial, but who knew the assignment can differ between its arms.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex-none text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            ← Back to queue
          </button>
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-2">
        {comparisons.length === 0 ? (
          <div className="text-[12.5px] text-gray-500 dark:text-zinc-500 py-4">
            This study has no results to answer trial questions for yet. Settle its comparison
            first, and its rows become results.
          </div>
        ) : comparisons.map(c => (
          <div
            key={c.contrastId}
            className="flex items-center gap-3 flex-wrap border-t border-gray-100 dark:border-[#1a1a1a] py-3 first:border-t-0"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium dark:text-zinc-200">{c.label}</div>
              <div className={`text-[11.5px] mt-0.5 ${c.complete
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-gray-600 dark:text-zinc-400'}`}>
                {c.resultCount} result{c.resultCount === 1 ? '' : 's'}
                {' · '}{c.complete ? 'Answered' : 'Needs trial answers'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpen(c.contrastId)}
              className="flex-none text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 text-gray-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-[#1a1a1a]"
            >
              Open trial answers →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

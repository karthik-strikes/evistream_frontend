'use client';

import { Info, Sigma } from 'lucide-react';
import type { MappingSuggestion } from '@/services/synthesis.service';

/**
 * Shown when the selected form has no meta-analysis in it.
 *
 * The form picker deliberately lists every form, so this has to explain rather
 * than just refuse — a reviewer who picks "Risk of Bias" should learn why it
 * cannot be pooled, not stare at an empty mapper and assume the page is broken.
 *
 * Diagnostic-accuracy tables get their own wording because the honest answer is
 * different: those CAN be meta-analysed, just not by this screen.
 */
export function NotPoolableExplainer({
  suggestion,
  formName,
  onUseReportedEffect,
}: {
  suggestion: MappingSuggestion;
  formName: string;
  /**
   * Escape hatch. The classifier only knows how to recognize arm data, so a
   * table holding a published effect estimate lands here wrongly — this lets the
   * reviewer say so and map it directly. Offered on every non-diagnostic verdict
   * because the classifier being wrong is exactly the case it exists for.
   */
  onUseReportedEffect: () => void;
}) {
  const diagnostic = suggestion.verdict === 'diagnostic_accuracy';

  return (
    <div className="border border-border rounded-lg bg-white dark:bg-[#111111] dark:border-[#1f1f1f] p-8 max-w-[640px]">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 dark:bg-[#1a1a1a] mb-4">
        {diagnostic ? (
          <Sigma className="h-5 w-5 text-gray-500 dark:text-zinc-400" />
        ) : (
          <Info className="h-5 w-5 text-gray-500 dark:text-zinc-400" />
        )}
      </div>

      <div className="text-base font-semibold dark:text-white">
        {diagnostic
          ? `${formName} needs a different kind of meta-analysis`
          : `${formName} has nothing to pool`}
      </div>

      <p className="text-[13px] text-gray-600 dark:text-zinc-400 mt-2 leading-relaxed">
        {suggestion.reasoning}
      </p>

      {diagnostic && (
        <p className="text-[13px] text-gray-600 dark:text-zinc-400 mt-3 leading-relaxed">
          Sensitivity and specificity are pooled together, not as a single effect size, so this form
          would need a bivariate model rather than the risk-ratio and mean-difference machinery on
          this screen. Its data is intact and extractable — the analysis simply isn&rsquo;t built yet.
        </p>
      )}

      {!diagnostic && (
        <>
          <p className="text-[13px] text-gray-600 dark:text-zinc-400 mt-3 leading-relaxed">
            A meta-analysis needs, for each group, either an event count with a denominator or a mean
            with a spread and a sample size. Pick a form whose table reports outcomes to continue.
          </p>
          <div className="border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#0d0d0d] rounded-lg px-3.5 py-3 mt-4">
            <div className="text-[13px] text-gray-700 dark:text-zinc-300 leading-relaxed">
              Unless this table reports an <strong>already-computed effect</strong> — an adjusted odds
              ratio, a hazard ratio — with its confidence interval or standard error. That can be
              pooled, and the check above cannot recognize it.
            </div>
            <button
              type="button"
              onClick={onUseReportedEffect}
              className="mt-2.5 cursor-pointer text-[12.5px] font-semibold bg-[#0a0a0a] text-white rounded-md px-3 py-1.5 hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-100"
            >
              Map it as a reported effect →
            </button>
          </div>
        </>
      )}

      {suggestion.columns.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 mb-2">
            Columns in {suggestion.field_name ?? 'this table'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestion.columns.map(c => (
              <span
                key={c.name}
                title={c.description || undefined}
                className="font-mono text-[11px] text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] rounded px-1.5 py-0.5"
              >
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {suggestion.source === 'heuristic' && (
        <div className="text-xs text-amber-700 dark:text-amber-400 mt-4">
          The mapping model was unavailable, so this verdict came from column names alone.
        </div>
      )}
    </div>
  );
}

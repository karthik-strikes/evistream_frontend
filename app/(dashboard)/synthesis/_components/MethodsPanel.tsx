'use client';

import { useEffect, useState } from 'react';
import 'katex/dist/katex.min.css';

import { MODEL_LABEL, type MetaResult } from '@/lib/metaAnalysis';
import { PROPORTION_METHOD_LABEL } from '@/lib/singleGroupMeta';
import { plainReading } from '../_lib/plainReading';
import { methodsFormulas, methodsNotation } from '../_lib/methodsText';

/**
 * What the numbers above mean, and how they were produced.
 *
 * Two audiences, one panel. The reading is for whoever has to write this result
 * down: plain sentences, no jargon a clinician would have to look up, and worded
 * so that quoting it cannot overstate the finding. The formulas are for whoever
 * has to defend it at peer review: the estimators this particular analysis used —
 * not a list of everything the app can do — so the panel can be read straight
 * into a methods section.
 *
 * KaTeX is imported dynamically, on first open. Its stylesheet is small enough to
 * ship with the route; 270KB of layout engine is not, and nobody who never opens
 * the panel should pay for it.
 */
export function MethodsPanel({
  result,
  outcomeLabel,
  comparisonLabel,
}: {
  result: MetaResult;
  outcomeLabel: string;
  comparisonLabel: string;
}) {
  const paragraphs = plainReading(result, { outcomeLabel, comparisonLabel });
  const formulas = methodsFormulas(result);
  const notation = methodsNotation(result);
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg bg-white p-4 mt-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
      <div className="text-[15px] font-semibold dark:text-white">What this says</div>
      <div className="flex flex-col gap-2 mt-2">
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className={
              i === 0
                ? 'text-[13.5px] text-zinc-900 dark:text-zinc-100 leading-relaxed'
                : 'text-[13px] text-gray-600 dark:text-zinc-400 leading-relaxed'
            }
          >
            {p}
          </p>
        ))}
      </div>

      <details
        className="mt-3.5 border-t border-gray-100 dark:border-[#1f1f1f] pt-3"
        onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-[13px] font-medium text-gray-700 dark:text-zinc-300 select-none">
          Methods — the estimators this analysis used
        </summary>

        <div className="text-[12.5px] text-gray-500 dark:text-zinc-400 mt-2.5 leading-relaxed">
          {MODEL_LABEL[result.model]}
          {result.proportionMethod ? ` · ${PROPORTION_METHOD_LABEL[result.proportionMethod]}` : ''}
          {' · '}
          {result.studies.length} {result.studies.length === 1 ? 'study' : 'studies'}
        </div>

        <div className="flex flex-col gap-3.5 mt-3">
          {formulas.map(f => (
            <div key={f.label}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
                {f.label}
              </div>
              <Math latex={f.latex} active={open} />
              <div className="text-[12px] text-gray-500 dark:text-zinc-500 mt-1 leading-relaxed">
                {f.note}
              </div>
            </div>
          ))}
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 mt-4 mb-1.5">
          Notation
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1">
          {notation.map(n => (
            <div key={n.symbol} className="flex items-baseline gap-2">
              <span className="min-w-[74px] shrink-0">
                <Math latex={n.symbol} active={open} inline />
              </span>
              <span className="text-[12px] text-gray-600 dark:text-zinc-400 leading-relaxed">
                {n.meaning}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/**
 * One rendered expression.
 *
 * Falls back to the LaTeX source in a monospace span — which is readable, if
 * ugly — rather than rendering nothing if KaTeX fails to load or the expression
 * does not parse. A formula panel that silently goes blank is worse than one that
 * shows its working.
 */
function Math({ latex, active, inline = false }: { latex: string; active: boolean; inline?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!active || html) return;
    let alive = true;
    import('katex')
      .then(katex => {
        if (!alive) return;
        setHtml(katex.default.renderToString(latex, {
          throwOnError: false,
          displayMode: !inline,
          output: 'html',
        }));
      })
      .catch(() => { /* the fallback below is already correct */ });
    return () => { alive = false; };
  }, [active, latex, inline, html]);

  if (html) {
    return (
      <div
        className={inline ? 'text-[12.5px] dark:text-zinc-200' : 'text-[13px] mt-1 overflow-x-auto dark:text-zinc-200'}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <div className={`font-mono text-[11.5px] text-gray-600 dark:text-zinc-400 ${inline ? '' : 'mt-1 overflow-x-auto'}`}>
      {latex}
    </div>
  );
}

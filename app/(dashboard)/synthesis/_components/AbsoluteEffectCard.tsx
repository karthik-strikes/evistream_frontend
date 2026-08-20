'use client';

import { describeAbsolute, EFFECT_LABEL, type MetaResult } from '@/lib/metaAnalysis';
import { Panel } from './Panel';

/**
 * The pooled relative effect said in absolute terms.
 *
 * A risk ratio of 0.75 means something very different at a 40% baseline than at
 * 0.4%, and a reader cannot do that arithmetic from the forest plot — which is
 * why every GRADE summary-of-findings table leads with the absolute row. The
 * baseline is an assumption, so it is stated, sourced, and editable rather than
 * buried: by default it is this corpus's own pooled comparator event rate, which
 * is the one figure the included studies actually support.
 */
export function AbsoluteEffectCard({
  result,
  assumedRisk,
  onAssumedRisk,
}: {
  result: MetaResult;
  /** As typed, a percentage. Empty means "use the corpus's own rate". */
  assumedRisk: string;
  onAssumedRisk: (v: string) => void;
}) {
  const a = result.absolute;
  const described = a ? describeAbsolute(a) : null;

  return (
    <Panel
      title="Absolute effect"
      summary={a && described
        ? `${described.headline} at a ${(a.comparatorRisk * 100).toFixed(1)}% comparator risk `
          + `(95% CI ${described.interval})${described.nnt ? ` · ${described.nnt}` : ''}`
        : `Not defined for ${EFFECT_LABEL[result.measure]} — it is already on the outcome’s own scale.`}
    >
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <div className="text-[12.5px] text-gray-500 dark:text-zinc-400">
          What the pooled {EFFECT_LABEL[result.measure].toLowerCase()} means per 1000 patients
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12.5px] text-gray-700 dark:text-zinc-300">
            Assumed comparator risk
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={assumedRisk}
            onChange={e => onAssumedRisk(e.target.value)}
            placeholder={a ? `${(a.comparatorRisk * 100).toFixed(1)}` : '—'}
            aria-label="Assumed comparator risk, as a percentage"
            className="h-8 w-[86px] border border-gray-200 rounded-md bg-white text-[13px] px-2 text-right text-gray-900 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white focus:outline-none"
          />
          <span className="text-[12.5px] text-gray-500 dark:text-zinc-500">%</span>
        </div>
      </div>

      {!a ? (
        <div className="text-[13px] text-gray-500 dark:text-zinc-400 mt-3 leading-relaxed">
          {result.pooled
            ? `An absolute effect is only defined for a risk ratio or odds ratio over event counts — `
              + `${EFFECT_LABEL[result.measure]} is already on the outcome's own scale.`
            : 'No pooled estimate yet, so there is nothing to state in absolute terms.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3.5">
            <Stat
              label="Comparator risk"
              value={`${(a.comparatorRisk * 100).toFixed(1)}%`}
              note={a.riskSource === 'corpus' ? "this corpus's pooled rate" : 'you supplied this'}
            />
            <Stat
              label="Risk with treatment"
              value={`${(a.treatmentRisk * 100).toFixed(1)}%`}
              note="the relative effect applied to that baseline"
            />
            <Stat
              label="Per 1000 patients"
              value={describeAbsolute(a).headline}
              note={`95% CI ${describeAbsolute(a).interval}`}
              emphasis
            />
          </div>

          <div className="text-[13px] text-gray-700 dark:text-zinc-300 mt-3 leading-relaxed">
            {describeAbsolute(a).nnt == null ? (
              <>
                The risk difference is too small to express usefully as a number needed to treat —
                below one patient per thousand, the reciprocal runs into the tens of thousands and
                says nothing a reader can act on.
              </>
            ) : (
              <>
                <strong>
                  {a.nntKind === 'benefit' ? 'NNTB' : 'NNTH'} {a.nnt}
                </strong>{' '}
                — treating {a.nnt} patients {a.nntKind === 'benefit' ? 'prevents' : 'causes'} one
                additional event.{' '}
                {a.nntLo != null && a.nntHi != null ? (
                  <>95% CI {a.nntLo} to {a.nntHi}.</>
                ) : (
                  <>
                    No interval is shown: the risk-difference interval includes zero, so its
                    reciprocal passes through infinity partway across and no single range is
                    meaningful (Altman 1998).
                  </>
                )}
              </>
            )}
          </div>

          <div className="text-xs text-gray-400 dark:text-zinc-600 mt-2.5 leading-relaxed">
            The interval here is the pooled relative effect&rsquo;s interval restated on the absolute
            scale — it carries no uncertainty about the baseline risk itself, which is treated as
            known. Change the baseline to see how much of the absolute claim rests on it.
          </div>
        </>
      )}
    </Panel>
  );
}

function Stat({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        'border rounded-lg px-3 py-2.5 '
        + (emphasis
          ? 'border-zinc-300 bg-zinc-50 dark:border-[#3a3a3a] dark:bg-[#1a1a1a]'
          : 'border-gray-200 dark:border-[#2a2a2a]')
      }
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums mt-0.5 dark:text-white">{value}</div>
      <div className="text-[11px] text-gray-400 dark:text-zinc-600 mt-0.5">{note}</div>
    </div>
  );
}

'use client';

import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { DESIGN_LABEL, type DesignGuardResult } from '../_lib/designGuards';
import { Panel, type PanelTone } from './Panel';

/**
 * Whether these studies belong in the same pool.
 *
 * Deliberately never hides itself when there is nothing to say — a reviewer needs
 * to know the check ran and found nothing, and to know when it could not run at
 * all because no design was extracted. Silence would be indistinguishable from
 * "no problem", which is the one reading this card must not allow.
 */
export function DesignGuardCard({
  checks,
  sourceLabel,
}: {
  checks: DesignGuardResult;
  /** Where the design values came from — a column on a named form. */
  sourceLabel: string | null;
}) {
  const { tallies, guards } = checks;

  const blocking = guards.filter(g => g.severity === 'blocking').length;
  const cautions = guards.filter(g => g.severity === 'caution').length;
  const tone: PanelTone = blocking > 0 ? 'alert' : cautions > 0 ? 'caution' : 'neutral';

  /**
   * The conclusion, in one line. A blocking guard has to be legible while folded —
   * the point of the check is that it changes what you do next.
   */
  const summary = !tallies
    ? (sourceLabel
        ? 'Could not run — no design value was read for any of these studies.'
        : 'Could not run — no form in this project records a study design.')
    : guards.length === 0
      ? `${tallies.length === 1 ? 'One design family' : `${tallies.length} design families`}; `
        + 'nothing argues against pooling these studies together.'
      : [
          blocking > 0 ? `${blocking} blocking` : null,
          cautions > 0 ? `${cautions} to weigh` : null,
          guards.length - blocking - cautions > 0
            ? `${guards.length - blocking - cautions} note${guards.length - blocking - cautions === 1 ? '' : 's'}`
            : null,
        ].filter(Boolean).join(', ') + ` — ${guards[0].title.toLowerCase()}.`;

  return (
    <Panel
      title="Design compatibility"
      summary={summary}
      tone={tone}
      defaultOpen={blocking > 0}
    >
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <div className="text-[12.5px] text-gray-500 dark:text-zinc-400">
          Whether these studies can legitimately be averaged together
        </div>
        {sourceLabel && (
          <div className="ml-auto font-mono text-[11px] text-gray-400 dark:text-zinc-600">
            {sourceLabel}
          </div>
        )}
      </div>

      {!tallies ? (
        <div className="text-[13px] text-gray-500 dark:text-zinc-400 mt-3 leading-relaxed">
          {sourceLabel
            ? `No design value could be read for any of these studies from ${sourceLabel}, so this check `
              + `did not run. That is a gap in the extraction, not a clean bill of health.`
            : 'No form in this project records a study design, so this check could not run. Extracting a '
              + 'design field — even a three-option select — is what makes it possible to tell whether '
              + 'pooling these studies is legitimate.'}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {tallies.map(t => (
              <span
                key={t.category}
                title={t.values.length ? `Recorded as: ${t.values.join(', ')}` : 'No value recorded'}
                className="text-[11.5px] rounded-full px-2.5 py-1 bg-gray-100 text-gray-700 dark:bg-[#1a1a1a] dark:text-zinc-300"
              >
                {DESIGN_LABEL[t.category]} · {t.studies.length}
              </span>
            ))}
          </div>

          {guards.length === 0 ? (
            <div className="text-[13px] text-gray-600 dark:text-zinc-400 mt-3 leading-relaxed">
              Nothing here argues against pooling these studies together: one design family, and the
              measure suits it.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 mt-3">
              {guards.map(g => {
                const tone = g.severity === 'blocking'
                  ? 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-500/5'
                  : g.severity === 'caution'
                    ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-500/5'
                    : 'border-gray-200 bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#0d0d0d]';
                const Icon = g.severity === 'blocking' ? ShieldAlert
                  : g.severity === 'caution' ? AlertTriangle : Info;
                const iconTone = g.severity === 'blocking'
                  ? 'text-red-600 dark:text-red-400'
                  : g.severity === 'caution'
                    ? 'text-amber-600 dark:text-amber-500'
                    : 'text-gray-500 dark:text-zinc-500';
                return (
                  <div key={g.title} className={`border rounded-lg px-3.5 py-2.5 ${tone}`}>
                    <div className="flex items-start gap-2">
                      <Icon className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${iconTone}`} />
                      <div>
                        <div className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                          {g.title}
                        </div>
                        <div className="text-[12.5px] text-gray-700 dark:text-zinc-300 mt-1 leading-relaxed">
                          {g.detail}
                        </div>
                        {g.studies.length > 0 && (
                          <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-1.5">
                            {g.studies.slice(0, 6).join(' · ')}
                            {g.studies.length > 6 ? ` · +${g.studies.length - 6} more` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-xs text-gray-400 dark:text-zinc-600 mt-3 leading-relaxed">
            Advice only — nothing here changes a number. Pooling across designs is sometimes exactly
            what you intend; this makes sure it is a decision rather than an accident.
          </div>
        </>
      )}
    </Panel>
  );
}

'use client';

/**
 * Review summary (`?screen=report`): the whole project's risk-of-bias results
 * in the forms a review reports them — a traffic-light plot, the summary bar
 * chart, CSV exports and, for managers and the consensus reviewer, R1/R2
 * agreement.
 *
 * Rows are study × target under the protocol's scope (`reportModel.ts`), and
 * "Final" means what the dashboard's Summary tab calls Consensus: a recorded
 * consensus, or R1 and R2 complete and in agreement. The figures on screen are
 * the exact SVG strings that are downloaded (`robFigures.ts`).
 */

import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';

import { cn } from '@/lib/utils';
import { downloadSvg, downloadSvgAsImage, slugify } from '@/lib/rasterizeSvg';
import { useRob } from '../_lib/useRobData';
import { DOMAIN_SHORT } from '../_lib/robModel';
import { summaryBarsSvg, trafficLightSvg, type Figure } from '../_lib/robFigures';
import {
  MIN_PAIRS, VIEW_LABEL, VIEW_SHORT, distribution, formatKappa, formatPct, interRater, longCsv, wideCsv,
  type ReportView,
} from '../_lib/robReport';
import { BackLink, Banner, Card, Eyebrow, OutlineButton, PrimaryButton, Segmented, useRobNav } from './robUi';
import { scopeOf } from './dashboardModel';
import { agreementPairs, canSeeReviewers, outcomeOptions, reportRows, targetHeading } from './reportModel';

function saveText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ReviewSummary() {
  const rob = useRob();
  const { get, go } = useRobNav();
  const privileged = canSeeReviewers(rob);
  const outcomeScope = scopeOf(rob) === 'outcome';

  const rawView = get('view') as ReportView;
  const view: ReportView = privileged && (rawView === 'reviewer_1' || rawView === 'reviewer_2') ? rawView : 'final';
  const outcomes = useMemo(() => (outcomeScope ? outcomeOptions(rob) : []), [rob, outcomeScope]);
  const outcome = outcomeScope && outcomes.some(o => o.key === get('outcome')) ? get('outcome') : null;
  const outcomeLabel = outcome ? outcomes.find(o => o.key === outcome)?.label ?? '' : '';

  const rows = useMemo(() => reportRows(rob, view, outcome), [rob, view, outcome]);
  const dist = useMemo(() => distribution(rows), [rows]);
  const studyCount = new Set(rows.map(r => r.documentId)).size;
  const judged = rows.filter(r => r.overall || r.domains.some(Boolean)).length;
  const withOverall = rows.filter(r => r.overall).length;

  const unit = (n: number) => (outcomeScope ? (n === 1 ? 'outcome' : 'outcomes') : (n === 1 ? 'result' : 'results'));
  const today = new Date().toISOString().slice(0, 10);
  const footer = [
    `RoB 2 · ${VIEW_LABEL[view]} judgements`, `${rows.length} ${unit(rows.length)} in ${studyCount} ${studyCount === 1 ? 'study' : 'studies'}`,
    outcomeLabel, `exported ${today}`,
  ].filter(Boolean).join(' · ');
  const traffic = useMemo(() => trafficLightSvg(rows, { targetHeading: targetHeading(rob), footer }), [rows, rob, footer]);
  const one = unit(1);
  const bars = useMemo(() => summaryBarsSvg(dist, {
    footer: `Unweighted: each study × ${one} counts once, whatever its size. ${footer}`,
  }), [dist, footer, one]);

  const fileBase = [slugify(rob.projectName || 'review'), 'rob2', outcome ? slugify(outcomeLabel) : '', VIEW_SHORT[view].toLowerCase()]
    .filter(Boolean).join('-');

  const back = () => go({ screen: 'dashboard', view: null, outcome: null });

  if (!rob.studies.length) {
    return (
      <div className="mx-auto max-w-[1080px]">
        <BackLink onClick={back}>Study dashboard</BackLink>
        <Card className="mt-4 px-6 py-8 text-center">
          <div className="text-[15px] font-semibold text-gray-900 dark:text-zinc-100">Nothing to summarise yet</div>
          <p className="mx-auto mt-2 max-w-[520px] text-[13px] leading-5 text-gray-500 dark:text-zinc-400">
            The summary lists every study with results to assess. Once the review protocol&apos;s result sources are
            confirmed, studies appear here with their judgements.
          </p>
          {rob.canManage && (
            <div className="mt-5 flex justify-center">
              <PrimaryButton onClick={() => go({ screen: 'protocol' })}>Open review protocol</PrimaryButton>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-5 pb-10">
      <div>
        <BackLink onClick={back}>Study dashboard</BackLink>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold tracking-[-.01em] text-gray-900 dark:text-zinc-100">Review summary</h2>
            <div className="mt-1 text-[12px] text-gray-500 dark:text-zinc-500">
              RoB 2 · {outcomeScope ? 'Outcome' : 'Result'} scope · {studyCount} {studyCount === 1 ? 'study' : 'studies'} ·{' '}
              {rows.length} {unit(rows.length)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <OutlineButton onClick={() => saveText(longCsv(rows), `${fileBase}-long.csv`)} disabled={!rows.length}>
              <Download className="h-3.5 w-3.5" />CSV · long
            </OutlineButton>
            <OutlineButton onClick={() => saveText(wideCsv(rows), `${fileBase}-wide.csv`)} disabled={!rows.length}>
              <Download className="h-3.5 w-3.5" />CSV · wide
            </OutlineButton>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {privileged && (
          <Segmented<ReportView> value={view} onChange={v => go({ view: v === 'final' ? null : v })}
            options={[{ value: 'final', label: 'Final' }, { value: 'reviewer_1', label: 'Reviewer 1' }, { value: 'reviewer_2', label: 'Reviewer 2' }]}
            className="[&>button]:min-w-0 [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-[12px]" />
        )}
        {outcomeScope && outcomes.length > 1 && (
          <select value={outcome ?? ''} onChange={e => go({ outcome: e.target.value || null })}
            className="h-[32px] max-w-[260px] rounded-[7px] border border-gray-200 bg-white px-2.5 text-[12px] text-gray-700 outline-none focus:border-gray-400 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300">
            <option value="">All outcomes</option>
            {outcomes.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        )}
        <span className="min-w-0 flex-1 text-[12px] text-gray-500 dark:text-zinc-400">
          {view === 'final'
            ? 'Final = a recorded consensus, or R1 and R2 completed and agree. The rest are drawn as not yet judged.'
            : `${VIEW_LABEL[view]}'s own judgements, including assessments still in progress.`}
        </span>
      </div>

      {!rows.length ? (
        <Card className="px-6 py-8 text-center text-[13px] text-gray-500 dark:text-zinc-400">
          No {unit(2)} {outcome ? 'for this outcome' : 'to show'}.
        </Card>
      ) : !judged ? (
        <Card className="px-6 py-8 text-center">
          <div className="text-[15px] font-semibold text-gray-900 dark:text-zinc-100">Nothing judged yet</div>
          <p className="mx-auto mt-2 max-w-[560px] text-[13px] leading-5 text-gray-500 dark:text-zinc-400">
            {view === 'final'
              ? `None of the ${rows.length} ${unit(rows.length)} has a final judgement. One becomes final when the consensus reviewer records it, or when R1 and R2 both complete and agree.`
              : `${VIEW_LABEL[view]} has no judgements you can see yet. A reviewer's judgements stay hidden until both reviewers complete that assessment.`}
          </p>
        </Card>
      ) : (
        <>
          {withOverall < rows.length && (
            <Banner tone="slate">
              {withOverall} of {rows.length} {unit(rows.length)} {withOverall === 1 ? 'has' : 'have'} {view === 'final' ? 'a final' : 'an'} overall
              judgement. The rest are drawn as not yet judged (hollow) and counted as such in the bars.
            </Banner>
          )}
          <FigureCard title="Traffic-light plot" figure={traffic} fileBase={`${fileBase}-traffic-light`}
            note="One row per study and target. Each marker carries a symbol, so the plot reads in greyscale too." />
          <FigureCard title="Summary plot" figure={bars} fileBase={`${fileBase}-summary`}
            note={`Share of ${unit(2)} at each judgement, per domain. Unweighted: every study × ${unit(1)} counts once, whatever its sample size or weight in a meta-analysis.`} />
        </>
      )}

      <AgreementCard outcome={outcome} />
    </div>
  );
}

function FigureCard({ title, note, figure, fileBase }: { title: string; note: string; figure: Figure; fileBase: string }) {
  const [error, setError] = useState<string | null>(null);
  const save = async (format: 'svg' | 'png') => {
    setError(null);
    try {
      if (format === 'svg') downloadSvg(figure.svg, fileBase);
      else await downloadSvgAsImage(figure.svg, fileBase, 'png', { width: figure.width, height: figure.height }, 2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The figure could not be exported.');
    }
  };
  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{title}</Eyebrow>
          <p className="mt-1 text-[12px] text-gray-500 dark:text-zinc-400">{note}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <OutlineButton small onClick={() => save('svg')}><Download className="h-3 w-3" />SVG</OutlineButton>
          <OutlineButton small onClick={() => save('png')}><Download className="h-3 w-3" />PNG</OutlineButton>
        </div>
      </div>
      {error && <div className="mt-2 text-[12px] text-[#b91c1c] dark:text-red-400">{error}</div>}
      {/* The figure is exported on white, so it is previewed on white in both themes. */}
      <div className="mt-3 overflow-x-auto rounded-[10px] border border-gray-100 bg-white dark:border-[#1f1f1f]">
        <div className="w-max [&>svg]:block" dangerouslySetInnerHTML={{ __html: figure.svg }} />
      </div>
    </Card>
  );
}

function AgreementCard({ outcome }: { outcome: string | null }) {
  const rob = useRob();
  const privileged = canSeeReviewers(rob);
  const { pairs, total } = useMemo(() => agreementPairs(rob, outcome), [rob, outcome]);
  const stats = useMemo(() => interRater(pairs), [pairs]);
  const unitWord = scopeOf(rob) === 'outcome' ? 'outcomes' : 'results';

  if (!privileged) {
    return (
      <p className="px-1 text-[12px] text-gray-500 dark:text-zinc-400">
        Inter-rater agreement is shown to the review managers and the consensus reviewer.
      </p>
    );
  }

  const grid = 'grid grid-cols-[minmax(180px,1.4fr)_60px_84px_72px_84px_110px_96px_120px] items-center gap-x-3';
  return (
    <Card className="px-5 py-4">
      <Eyebrow>Inter-rater agreement · R1 vs R2</Eyebrow>
      <p className="mt-1 text-[12px] leading-[18px] text-gray-500 dark:text-zinc-400">
        Over the {pairs.length} of {total} {unitWord} both reviewers completed. κ is Cohen&apos;s kappa over Low / Some
        concerns / High; weighted κ gives half credit to adjacent categories. Strength follows Landis &amp; Koch (1977).
        “—” means kappa is undefined (every judgement fell in one category). Signalling agreement counts questions both
        answered; the second figure treats Yes ≡ Probably yes and No ≡ Probably no.
      </p>
      {pairs.length < MIN_PAIRS ? (
        <div className="mt-3 rounded-[10px] border border-dashed border-gray-300 bg-[#fafafa] px-4 py-4 text-center text-[12.5px] text-gray-500 dark:border-zinc-700 dark:bg-[#0d0d0d] dark:text-zinc-400">
          Not enough pairs yet — agreement needs at least {MIN_PAIRS} {unitWord} completed by both R1 and R2
          ({pairs.length} so far).
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[820px]">
            <div className={cn(grid, 'border-b border-gray-200 pb-2 text-[10.5px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:border-[#1f1f1f] dark:text-zinc-500')}>
              <span>Domain</span><span className="text-right">Pairs</span><span className="text-right">Agreement</span>
              <span className="text-right">κ</span><span className="text-right">Weighted κ</span><span>Strength</span>
              <span className="text-right">Signalling</span><span className="text-right">Y≡PY, N≡PN</span>
            </div>
            {stats.map(s => (
              <div key={s.domain} className={cn(grid, 'border-b border-gray-100 py-2.5 text-[12.5px] last:border-b-0 dark:border-[#1a1a1a]',
                s.domain === 5 && 'font-semibold')}>
                <span className="truncate text-gray-900 dark:text-zinc-100">
                  {s.domain === 5 ? 'Overall' : `D${s.domain + 1} · ${DOMAIN_SHORT[s.domain]}`}
                </span>
                <span className="text-right tabular-nums text-gray-600 dark:text-zinc-400">{s.n}</span>
                {s.n < MIN_PAIRS ? (
                  <span className="col-span-4 text-[12px] font-normal text-gray-400 dark:text-zinc-500">Not enough pairs</span>
                ) : (
                  <>
                    <span className="text-right tabular-nums text-gray-900 dark:text-zinc-100">{formatPct(s.agreement)}</span>
                    <span className="text-right tabular-nums text-gray-900 dark:text-zinc-100">{formatKappa(s.kappa)}</span>
                    <span className="text-right tabular-nums text-gray-900 dark:text-zinc-100">{formatKappa(s.weightedKappa)}</span>
                    <span className="text-gray-600 dark:text-zinc-400">{s.strength || '—'}</span>
                  </>
                )}
                <span className="text-right tabular-nums text-gray-600 dark:text-zinc-400"
                  title={s.signalling.n ? `${s.signalling.n} answers compared` : undefined}>
                  {s.domain === 5 ? '' : formatPct(s.signalling.exact)}
                </span>
                <span className="text-right tabular-nums text-gray-600 dark:text-zinc-400">
                  {s.domain === 5 ? '' : formatPct(s.signalling.collapsed)}
                  {s.domain !== 5 && s.signalling.n > 0 && <span className="ml-1 text-[11px] text-gray-400">· {s.signalling.n}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

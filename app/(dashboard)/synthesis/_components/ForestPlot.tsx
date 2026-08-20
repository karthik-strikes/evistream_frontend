'use client';

import { useState } from 'react';
import { Download, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { downloadSvg, downloadSvgAsImage, slugify } from '@/lib/rasterizeSvg';
import { buildForestSvg } from '../_lib/forestSvg';
import {
  buildAxis, EFFECT_LABEL, formatMeasured, formatMeasuredTick, formatP, formatTick, hasNullValue,
  isRatioMeasure, measureColumnLabel, MIN_POOLABLE, MODEL_SHORT, NOT_ESTIMABLE_TEXT,
  studyDataCells,
  type MetaResult, type StudyEffect,
} from '@/lib/metaAnalysis';
import { PROPORTION_METHOD_LABEL } from '@/lib/singleGroupMeta';

const GRID = 'grid grid-cols-[minmax(140px,180px)_88px_88px_minmax(180px,1fr)_140px_60px] gap-x-3';



/**
 * The forest plot.
 *
 * Marker area is proportional to the study's pooling weight, which is the
 * convention readers expect — a big square must mean a study that actually
 * carried the estimate, so the size comes from the same weights that produced
 * the diamond, never from sample size as a proxy.
 */
export function ForestPlot({
  result,
  outcomeLabel,
  comparisonLabel,
  treatmentHeading,
  comparatorHeading,
  onOpenStudy,
  onExport,
  onDiagnostics,
  fileBase = 'forest-plot',
  mid = null,
}: {
  result: MetaResult;
  outcomeLabel: string;
  comparisonLabel: string;
  treatmentHeading: string;
  comparatorHeading: string;
  onOpenStudy: (s: StudyEffect) => void;
  onExport: () => void;
  onDiagnostics: () => void;
  /** Stem for exported filenames — usually the form name and measure. */
  fileBase?: string;
  /**
   * Minimal important difference on the DISPLAY scale (an RR of 1.25, a mean
   * difference of 4). Shades the zone within which a difference is not
   * clinically important, so a significant-but-trivial result looks trivial.
   */
  mid?: number | null;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const axis = buildAxis(result);
  const maxWeight = Math.max(...result.studies.map(s => s.weightPct), 1);

  /**
   * The exported figure is rebuilt as one SVG rather than scraped off the page —
   * this component is an HTML grid with a CSS-gradient null line, so there is no
   * single element to serialize. `buildForestSvg` reads the same `MetaResult`, so
   * the figure cannot drift from the table above it.
   */
  const saveFigure = async (format: 'png' | 'jpg' | 'svg') => {
    setExportError(null);
    try {
      const { svg, width, height } = buildForestSvg(result, {
        outcomeLabel,
        comparisonLabel,
        treatmentHeading,
        comparatorHeading,
        mid,
        footer: `${outcomeLabel} · ${comparisonLabel} · exported from EviStream`,
      });
      const name = `${slugify(fileBase)}-${slugify(outcomeLabel)}`;
      if (format === 'svg') downloadSvg(svg, name);
      else await downloadSvgAsImage(svg, name, format, { width, height });
    } catch (e) {
      setExportError(
        e instanceof Error ? e.message : 'The figure could not be exported.',
      );
    }
  };

  /**
   * The trivial zone: within +/-MID of no effect. For a ratio measure the zone is
   * multiplicative, so 1.25 means 1/1.25 to 1.25 — a threshold stated one way
   * round has to bound both directions or it would only flag harm.
   */
  const band = mid && mid > 0
    ? (() => {
        const lo = isRatioMeasure(result.measure) ? 1 / mid : -Math.abs(mid);
        const hi = isRatioMeasure(result.measure) ? mid : Math.abs(mid);
        const loX = axis.toX(lo);
        const hiX = axis.toX(hi);
        return hiX > loX ? { loX, hiX, lo, hi } : null;
      })()
    : null;

  const BAND_FILL = 'rgba(35, 135, 91, 0.10)';
  // A prevalence has no null value, so there is no reference line to draw — a line
  // at 0% or 50% would assert a hypothesis the analysis never made.
  const showNull = hasNullValue(result.measure);
  const gridBackground = {
    backgroundImage:
      (band
        ? `linear-gradient(to right, transparent ${band.loX}%, ${BAND_FILL} ${band.loX}%, `
          + `${BAND_FILL} ${band.hiX}%, transparent ${band.hiX}%), `
        : '')
      + (showNull
        ? `linear-gradient(currentColor, currentColor), linear-gradient(currentColor, currentColor)`
        : 'none'),
    backgroundSize: `${band ? '100% 100%, ' : ''}${showNull ? '1px 100%, 1.5px 100%' : 'auto'}`,
    backgroundPosition: `${band ? '0 0, ' : ''}${axis.nullX}% 0, ${axis.nullX}% 0`,
    backgroundRepeat: 'no-repeat',
  } as const;

  return (
    <div className="border border-border rounded-lg bg-white p-5 overflow-x-auto dark:bg-[#111111] dark:border-[#1f1f1f]">
      <div className="min-w-[860px]">
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span className="text-base font-semibold dark:text-white">{outcomeLabel}</span>
          <span className="text-[13px] text-gray-500 dark:text-zinc-400">
            {comparisonLabel} · {EFFECT_LABEL[result.measure]}, {MODEL_SHORT[result.model]}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] text-gray-400 dark:text-zinc-600 flex items-center gap-1">
              <Download className="h-3 w-3" />
              Export
            </span>
            <ExportButton onClick={onExport} title="Study-level numbers as a RevMan-style CSV">
              CSV
            </ExportButton>
            <ExportButton
              onClick={() => saveFigure('png')}
              title="The figure as a PNG image, rendered at 3x for print"
            >
              PNG
            </ExportButton>
            <ExportButton
              onClick={() => saveFigure('jpg')}
              title="The figure as a JPG image, rendered at 3x for print"
            >
              JPG
            </ExportButton>
            <ExportButton
              onClick={() => saveFigure('svg')}
              title="The figure as vector SVG — scales without loss, and stays editable"
            >
              SVG
            </ExportButton>
          </div>
          <button
            type="button"
            onClick={onDiagnostics}
            className="cursor-pointer text-[12.5px] font-semibold bg-[#0a0a0a] text-white rounded-md px-3 py-1.5 hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-100"
          >
            Diagnostics →
          </button>
        </div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mt-1">
          Click any study to open its source evidence.
        </div>
        {exportError && (
          <div className="text-xs text-red-600 dark:text-red-400 mt-1">
            {exportError} Try the SVG export, or take a screenshot.
          </div>
        )}

        {/* Header */}
        <div className={cn(GRID, 'items-center mt-4 pb-1.5 border-b border-gray-200 dark:border-[#2a2a2a]')}>
          <Th>Study</Th>
          <Th right>{treatmentHeading}</Th>
          <Th right>{comparatorHeading}</Th>
          <span />
          <Th>{measureColumnLabel(result.measure)} (95% CI)</Th>
          <Th right>Weight</Th>
        </div>

        {/* Studies */}
        {result.studies.map(s => {
          const size = Math.max(8, Math.round(17 * Math.sqrt(s.weightPct / maxWeight)));
          const lox = axis.toX(s.lo);
          const hix = axis.toX(s.hi);
          const isHover = hover === s.key;
          return (
            <div
              key={s.key}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onOpenStudy(s)}
              className={cn(
                GRID,
                'items-center h-8 cursor-pointer rounded-md',
                isHover && 'bg-gray-50 dark:bg-[#1a1a1a]',
              )}
            >
              <span className="text-[13px] text-zinc-900 dark:text-zinc-100 pl-1.5 truncate" title={s.label}>
                {s.label}
                {s.corrected && (
                  <span title="Continuity correction applied (+0.5 to each cell)" className="text-amber-600 dark:text-amber-500 ml-1">
                    *
                  </span>
                )}
              </span>
              <Num right>{studyDataCells(s).left}</Num>
              <Num right>{studyDataCells(s).right}</Num>
              <div className="relative h-8 text-gray-200 dark:text-[#2a2a2a]" style={gridBackground}>
                <div
                  className="absolute top-1/2 h-[1.5px] bg-zinc-600 dark:bg-zinc-400 -translate-y-1/2"
                  style={{ left: `${lox}%`, width: `${Math.max(hix - lox, 0.5)}%` }}
                />
                <div
                  className="absolute top-1/2 bg-zinc-900 dark:bg-zinc-100 ring-2 ring-white dark:ring-[#111111]"
                  style={{
                    left: `${axis.toX(s.est)}%`,
                    width: size, height: size,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
                {isHover && (
                  <div
                    className="absolute bottom-7 z-10 -translate-x-1/2 bg-[#0a0a0a] text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap shadow-lg dark:bg-white dark:text-black"
                    style={{ left: `${axis.toX(s.est)}%` }}
                  >
                    {s.precomputed
                      ? `as reported ${studyDataCells(s).left}`
                      : `${studyDataCells(s).left} vs ${studyDataCells(s).right}`}{' '}
                    · {formatMeasuredTick(result.measure, s.est)}
                  </div>
                )}
              </div>
              <Num>{formatMeasured(result.measure, s.est, s.lo, s.hi)}</Num>
              <Num right muted>{s.weightPct.toFixed(1)}%</Num>
            </div>
          );
        })}

        {/* Pooled */}
        {result.pooled && (
          <div className={cn(GRID, 'items-center h-9 border-t border-gray-200 dark:border-[#2a2a2a] mt-1')}>
            <span className="text-[13px] font-semibold pl-1.5 dark:text-white">Total (95% CI)</span>
            <Num right bold>{result.totals.treatment}</Num>
            <Num right bold>{result.totals.comparator}</Num>
            <div className="relative h-9 text-gray-200 dark:text-[#2a2a2a]" style={gridBackground}>
              <svg
                width="100%" height="14" viewBox="0 0 100 14" preserveAspectRatio="none"
                className="block absolute top-[11px] left-0"
              >
                <polygon
                  points={[
                    `${axis.toX(result.pooled.lo)},7`,
                    `${axis.toX(result.pooled.est)},0`,
                    `${axis.toX(result.pooled.hi)},7`,
                    `${axis.toX(result.pooled.est)},14`,
                  ].join(' ')}
                  className="fill-blue-500"
                />
              </svg>
            </div>
            <Num bold>
              {formatMeasured(result.measure, result.pooled.est, result.pooled.lo, result.pooled.hi)}
            </Num>
            <Num right bold>100.0%</Num>
          </div>
        )}

        {!result.pooled && result.studies.length > 0 && (
          <div className="flex items-center gap-2.5 border border-dashed border-gray-300 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#0d0d0d] rounded-lg px-3.5 py-2.5 mt-2.5">
            <Info className="h-3.5 w-3.5 text-gray-500 dark:text-zinc-500 flex-shrink-0" />
            <span className="text-[12.5px] text-gray-700 dark:text-zinc-300">
              Pooled estimate suppressed — only {result.studies.length}{' '}
              {result.studies.length === 1 ? 'study matches' : 'studies match'} this comparison.
              Pooling fewer than {MIN_POOLABLE} studies is not meaningful.
            </span>
          </div>
        )}

        {/* Axis */}
        <div className={cn(GRID, 'mt-0.5')}>
          <span /><span /><span />
          <div className="relative h-8 text-[11px] text-gray-400 dark:text-zinc-600 tabular-nums">
            {axis.ticks.map(t => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: `${axis.toX(t)}%` }}>
                {formatMeasuredTick(result.measure, t)}
              </span>
            ))}
            {showNull ? (
              <>
                <span className="absolute top-4 text-[10.5px]" style={{ right: `${100 - axis.nullX + 2}%` }}>
                  ← Favours {comparatorHeading.replace(/\s*n\/N$/i, '') || 'comparator'}
                </span>
                <span className="absolute top-4 text-[10.5px]" style={{ left: `${axis.nullX + 2}%` }}>
                  Favours {treatmentHeading.replace(/\s*n\/N$/i, '') || 'treatment'} →
                </span>
              </>
            ) : (
              <span className="absolute top-4 left-0 text-[10.5px]">
                {EFFECT_LABEL[result.measure]} observed in each study — no comparison, so no direction
                to favour
              </span>
            )}
          </div>
          <span /><span />
        </div>

        {/* Statistics */}
        {result.glmm && (
          <div className="flex items-center gap-3.5 border-t border-gray-100 dark:border-[#1f1f1f] mt-3 pt-3 flex-wrap">
            <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 tabular-nums">
              {PROPORTION_METHOD_LABEL.glmm} · τ² = {result.glmm.tau2.toFixed(3)} (logit scale)
            </span>
            {result.prediction && (
              <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 tabular-nums">
                95% PI {(result.prediction.lo * 100).toFixed(1)}%–
                {(result.prediction.hi * 100).toFixed(1)}%
                <span className="text-gray-400 dark:text-zinc-600"> (t{result.prediction.df})</span>
              </span>
            )}
            <span className="ml-auto text-xs text-gray-400 dark:text-zinc-600">
              One-stage fit — no Cochran&rsquo;s Q or I², and each row&rsquo;s interval is a Wilson
              interval on its own counts
            </span>
          </div>
        )}
        {result.glmm?.seFallback && (
          <div className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">
            The model&rsquo;s standard error came from a conservative fallback rather than the
            likelihood curvature — read the pooled interval as approximate, and cross-check against
            the arcsine transform.
          </div>
        )}
        {result.heterogeneity && (
          <div className="flex items-center gap-3.5 border-t border-gray-100 dark:border-[#1f1f1f] mt-3 pt-3 flex-wrap">
            <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 tabular-nums">
              Heterogeneity: τ² = {result.heterogeneity.tau2.toFixed(3)}; Q ={' '}
              {result.heterogeneity.q.toFixed(1)}, df = {result.heterogeneity.df} (p ={' '}
              {formatP(result.heterogeneity.p)}); I² = {result.heterogeneity.i2.toFixed(0)}%
            </span>
            <span
              className={cn(
                'text-[11px] font-semibold rounded-full px-2.5 py-0.5',
                result.heterogeneity.label === 'Low' && 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
                result.heterogeneity.label === 'Moderate' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
                result.heterogeneity.label === 'Substantial' && 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300',
                result.heterogeneity.label === 'Considerable' && 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
              )}
            >
              {result.heterogeneity.label} heterogeneity
            </span>
            {result.prediction && (
              <span
                className="text-[12.5px] text-gray-700 dark:text-zinc-300 tabular-nums"
                title={
                  `mu +/- t x sqrt(tau^2 + SE^2), t = ${result.prediction.t.toFixed(2)} on ${result.prediction.df} df ` +
                  `(Higgins, Thompson & Spiegelhalter 2009). tau^2 was estimated from these ` +
                  `${result.studies.length} studies, so the multiplier grows as the corpus shrinks — ` +
                  `below about 10 studies read the bounds as illustrative, not precise.`
                }
              >
                95% PI {result.prediction.lo.toFixed(2)}–{result.prediction.hi.toFixed(2)}
                <span className="text-gray-400 dark:text-zinc-600"> (t{result.prediction.df})</span>
              </span>
            )}
            {result.hksj && (
              <span
                className="text-[12.5px] text-gray-700 dark:text-zinc-300 tabular-nums"
                title={
                  `Hartung-Knapp-Sidik-Jonkman: the same pooled estimate referred to t on `
                  + `${result.hksj.df} df with variance q/sum(w*), q = ${result.hksj.q.toFixed(2)}. `
                  + `It stops treating the between-study variance as known. `
                  + (result.hksj.narrower
                    ? 'q below 1 here, so it comes out narrower than the standard interval — see Diagnostics.'
                    : 'Usually wider than the standard interval, and better covering with few studies.')
                }
              >
                HKSJ {result.hksj.lo.toFixed(2)}–{result.hksj.hi.toFixed(2)}
                <span className="text-gray-400 dark:text-zinc-600"> (t{result.hksj.df})</span>
              </span>
            )}
            {result.overallEffect && (
              <span className="ml-auto text-xs text-gray-400 dark:text-zinc-600 tabular-nums">
                Test for overall effect: Z = {result.overallEffect.z.toFixed(2)} (p ={' '}
                {formatP(result.overallEffect.p)})
              </span>
            )}
          </div>
        )}

        {result.poolingMethodRefusal && (
          <div className="border border-amber-200 bg-amber-50 rounded-lg px-3.5 py-2.5 mt-3 text-[12.5px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-500/5 dark:text-amber-200">
            No pooled estimate: {result.poolingMethodRefusal}
          </div>
        )}

        {band && (
          <div className="flex items-center gap-2 mt-2.5">
            <span className="inline-block h-3 w-6 rounded-sm" style={{ background: BAND_FILL }} />
            <span className="text-xs text-gray-500 dark:text-zinc-500">
              Shaded: within the minimal important difference ({formatTick(band.lo)} to{' '}
              {formatTick(band.hi)}) — an interval lying inside it is distinguishable from no effect,
              but not clinically important.
            </span>
          </div>
        )}

        {(result.correctedCount > 0 || result.notEstimable.length > 0) && (
          <div className="mt-2.5 flex flex-col gap-1">
            {result.correctedCount > 0 && (
              <div className="text-xs text-gray-500 dark:text-zinc-500">
                * {result.correctedCount}{' '}
                {result.correctedCount === 1 ? 'study has' : 'studies have'} zero events in one arm;
                0.5 was added to every cell of {result.correctedCount === 1 ? 'that study' : 'those studies'}{' '}
                so a {isRatioMeasure(result.measure) ? 'ratio' : 'difference'} could be estimated
                {result.model === 'mh' || result.model === 'peto'
                  ? ' for its own row. The pooled estimate below uses the raw counts — needing no correction is the reason to pool this way.'
                  : '.'}
              </div>
            )}
            {result.notEstimable.map(n => (
              <div key={n.study.key} className="text-xs text-gray-500 dark:text-zinc-500">
                {n.study.label} is not plotted — {NOT_ESTIMABLE_TEXT[n.reason]}.
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExportButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="cursor-pointer text-[12px] font-semibold bg-white text-zinc-900 border border-zinc-200 rounded-md px-2.5 py-1.5 hover:bg-zinc-50 dark:bg-[#1a1a1a] dark:text-zinc-100 dark:border-[#2a2a2a] dark:hover:bg-[#222]"
    >
      {children}
    </button>
  );
}

function Th({ children, right = false }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <span
      className={cn(
        'text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500',
        right && 'text-right',
      )}
    >
      {children}
    </span>
  );
}

function Num({
  children, right = false, bold = false, muted = false,
}: { children: React.ReactNode; right?: boolean; bold?: boolean; muted?: boolean }) {
  return (
    <span
      className={cn(
        'text-[12.5px] tabular-nums',
        right && 'text-right',
        bold ? 'font-semibold dark:text-white' : 'text-gray-700 dark:text-zinc-300',
        muted && 'text-gray-500 dark:text-zinc-500',
      )}
    >
      {children}
    </span>
  );
}

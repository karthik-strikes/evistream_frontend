'use client';

import { useState } from 'react';
import { Download, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildAxis, EFFECT_LABEL, formatEffect, formatP, formatTick, isBinaryArm, isRatioMeasure,
  MIN_POOLABLE, MODEL_SHORT, NOT_ESTIMABLE_TEXT,
  type BinaryArm, type ContinuousArm, type MetaResult, type StudyEffect,
} from '@/lib/metaAnalysis';

const GRID = 'grid grid-cols-[minmax(140px,180px)_88px_88px_minmax(180px,1fr)_140px_60px] gap-x-3';

function armText(arm: BinaryArm | ContinuousArm): string {
  return isBinaryArm(arm) ? `${arm.events}/${arm.total}` : String(arm.n);
}

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
}: {
  result: MetaResult;
  outcomeLabel: string;
  comparisonLabel: string;
  treatmentHeading: string;
  comparatorHeading: string;
  onOpenStudy: (s: StudyEffect) => void;
  onExport: () => void;
  onDiagnostics: () => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const axis = buildAxis(result);
  const binary = result.studies.length > 0 && isBinaryArm(result.studies[0].treatment);
  const maxWeight = Math.max(...result.studies.map(s => s.weightPct), 1);

  const gridBackground = {
    backgroundImage:
      `linear-gradient(currentColor, currentColor), linear-gradient(currentColor, currentColor)`,
    backgroundSize: '1px 100%, 1.5px 100%',
    backgroundPosition: `${axis.nullX}% 0, ${axis.nullX}% 0`,
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
          <button
            type="button"
            onClick={onExport}
            className="ml-auto flex items-center gap-1.5 cursor-pointer text-[12.5px] font-semibold bg-white text-zinc-900 border border-zinc-200 rounded-md px-3 py-1.5 hover:bg-zinc-50 dark:bg-[#1a1a1a] dark:text-zinc-100 dark:border-[#2a2a2a] dark:hover:bg-[#222]"
          >
            <Download className="h-3 w-3" />
            Export RevMan CSV
          </button>
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

        {/* Header */}
        <div className={cn(GRID, 'items-center mt-4 pb-1.5 border-b border-gray-200 dark:border-[#2a2a2a]')}>
          <Th>Study</Th>
          <Th right>{treatmentHeading}</Th>
          <Th right>{comparatorHeading}</Th>
          <span />
          <Th>{result.measure} (95% CI)</Th>
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
              <Num right>{armText(s.treatment)}</Num>
              <Num right>{armText(s.comparator)}</Num>
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
                    {armText(s.treatment)} vs {armText(s.comparator)} · {result.measure}{' '}
                    {s.est.toFixed(2)}
                  </div>
                )}
              </div>
              <Num>{formatEffect(s.est, s.lo, s.hi)}</Num>
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
            <Num bold>{formatEffect(result.pooled.est, result.pooled.lo, result.pooled.hi)}</Num>
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
                {formatTick(t)}
              </span>
            ))}
            <span className="absolute top-4 text-[10.5px]" style={{ right: `${100 - axis.nullX + 2}%` }}>
              ← Favours {comparatorHeading.replace(/\s*n\/N$/i, '') || 'comparator'}
            </span>
            <span className="absolute top-4 text-[10.5px]" style={{ left: `${axis.nullX + 2}%` }}>
              Favours {treatmentHeading.replace(/\s*n\/N$/i, '') || 'treatment'} →
            </span>
          </div>
          <span /><span />
        </div>

        {/* Statistics */}
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
              <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 tabular-nums">
                95% PI {result.prediction.lo.toFixed(2)}–{result.prediction.hi.toFixed(2)}
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

        {(result.correctedCount > 0 || result.notEstimable.length > 0) && (
          <div className="mt-2.5 flex flex-col gap-1">
            {result.correctedCount > 0 && (
              <div className="text-xs text-gray-500 dark:text-zinc-500">
                * {result.correctedCount}{' '}
                {result.correctedCount === 1 ? 'study has' : 'studies have'} zero events in one arm;
                0.5 was added to every cell of {result.correctedCount === 1 ? 'that study' : 'those studies'}{' '}
                so a {isRatioMeasure(result.measure) ? 'ratio' : 'difference'} could be estimated.
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

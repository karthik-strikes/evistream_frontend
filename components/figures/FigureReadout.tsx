'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { labelFigureQuote } from '@/lib/figureQuote';
import { FigureImage } from '@/components/figures/FigureImage';
import type { DocumentFigure } from '@/types/api';

/** The app's micro-label. Same string as FigureCard and UnifiedFieldCard —
 *  this token is re-declared per file by convention rather than shared. */
const MICRO = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500';

interface FigureReadoutProps {
  documentId: string | null;
  figure: DocumentFigure | null;
  /** The raw source_text the extractor emitted — a markdown table row. */
  quote: string;
  /** Whether the viewer managed to draw a box on the figure. When it didn't,
   *  the reviewer has an unhighlighted PDF and no idea which picture this is,
   *  so the thumbnail earns its space. When it did, the PDF right below already
   *  IS the picture and showing it twice is noise. */
  hasHighlight: boolean;
}

/**
 * The quote for a chart-read value, rendered as what it actually means.
 *
 * `6 | 2.5 | 2.0 | 1.5 | 0.5` is a verbatim row of the digitized table, but it
 * is unreadable and it hides which column each number belongs to. Zipped
 * against the figure's stored `columns` it becomes checkable at a glance —
 * which is the whole point, because a reviewer's job here is to look at the
 * chart and confirm the number.
 *
 * Returns null when the row can't be aligned with confidence; the caller then
 * keeps showing the raw quote. Never guess an alignment.
 */
export function FigureReadout({ documentId, figure, quote, hasHighlight }: FigureReadoutProps) {
  const rows = useMemo(
    () => labelFigureQuote(quote, figure?.columns),
    [quote, figure?.columns],
  );

  if (!rows || rows.length === 0) return null;

  return (
    <div className="space-y-2">
      {!hasHighlight && documentId && figure && (
        <FigureImage
          documentId={documentId}
          image={figure.image}
          alt={figure.title || 'Figure'}
          size="chart"
        />
      )}

      {rows.map((cells, i) => (
        <div
          key={i}
          className={cn(
            'grid grid-cols-2 overflow-hidden rounded-lg border border-gray-200',
            'divide-x divide-y divide-gray-100',
            'dark:divide-[#1f1f1f] dark:border-[#1f1f1f]',
          )}
        >
          {cells.map((cell) => (
            <div key={cell.label} className="min-w-0 px-2.5 py-1.5" title={cell.label}>
              <p className={cn(MICRO, 'truncate')}>{cell.label}</p>
              <p className="mt-0.5 break-words text-[12px] font-medium leading-snug tabular-nums text-gray-700 dark:text-zinc-300">
                {cell.value}
              </p>
            </div>
          ))}
        </div>
      ))}

      {/* Axis calibration: what these numbers were read against. Without it a
          reviewer cannot tell whether 2.5 is on a 0–3 scale or a 0–100 one. */}
      {(figure?.y_axis_label || figure?.dispersion_measure) && (
        <p className="text-[10.5px] leading-relaxed text-gray-500 dark:text-zinc-500">
          {figure.y_axis_label}
          {figure.y_axis_label && figure.y_axis_range ? ` (${figure.y_axis_range})` : ''}
          {figure.dispersion_measure ? ` · ± ${figure.dispersion_measure}` : ''}
        </p>
      )}
    </div>
  );
}

'use client';

/**
 * A figure image, fetched with credentials, shown whole.
 *
 * `object-contain` against a height ceiling, never `cover` — a figure that has
 * been cropped to fill a box is worse than useless here, because the reviewer
 * cannot tell that an axis is missing.
 *
 * Size is a named variant rather than a className the caller passes in. An
 * earlier version let callers hand in raw height classes and one of them set a
 * 56x80px frame, which made the figure unreadable — the one thing this component
 * exists to prevent.
 *
 * The authenticated fetch lives in useFigureImage; see there for why an <img
 * src> pointing at the API cannot work.
 */

import { ImageOff, Loader2, Maximize2 } from 'lucide-react';

import { cn } from '@/lib/utils';

import { useFigureImage } from './useFigureImage';

/** Ceiling on rendered height, applied to the IMAGE, plus a floor on the frame.
 *
 *  The cap must live on the `<img>`. It was on the frame, with `max-h-full` on
 *  the image — and a percentage max-height resolves against the parent's height,
 *  which here is content-driven, so it computed to `none`. `max-w-full` bound
 *  first, the height followed the aspect ratio, and `overflow-hidden` quietly
 *  cropped the overflow: measured at 120px, 39px and 184px off the bottom of
 *  three real figures, taking the bottom of one y-axis with it. A figure missing
 *  its axis is the exact failure this component exists to prevent.
 */
export const FIGURE_SIZES = {
  /** Beside its data table — wide enough to read an axis label. */
  chart: { img: 'max-h-[380px]', frame: 'min-h-[200px]' },
  /** Full card width, nothing to compare against. */
  full: { img: 'max-h-[420px]', frame: 'min-h-[220px]' },
} as const;

interface FigureImageProps {
  documentId: string;
  image: string;
  alt: string;
  size?: keyof typeof FIGURE_SIZES;
  onClick?: () => void;
  className?: string;
}

export function FigureImage({
  documentId, image, alt, size = 'chart', onClick, className,
}: FigureImageProps) {
  const { url, failed } = useFigureImage(documentId, image);

  const frame = cn(
    'group relative flex w-full items-center justify-center overflow-hidden rounded',
    'border border-border bg-white dark:border-[#2a2a2a] dark:bg-[#0a0a0a]',
    FIGURE_SIZES[size].frame,
    onClick && 'cursor-zoom-in',
    className,
  );

  if (failed) {
    return (
      <div className={frame}>
        <span className="flex flex-col items-center gap-1.5 p-4 text-[11px] text-muted">
          <ImageOff className="h-4 w-4" />
          Image unavailable
        </span>
      </div>
    );
  }

  if (!url) {
    return (
      <div className={frame}>
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div
      className={frame}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- object URL from an
          authenticated fetch; next/image cannot carry the Authorization header. */}
      <img
        src={url}
        alt={alt}
        className={cn('w-auto max-w-full object-contain', FIGURE_SIZES[size].img)}
      />
      {onClick && (
        <span className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded bg-black/55 px-1.5 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-3 w-3" />
          Zoom
        </span>
      )}
    </div>
  );
}

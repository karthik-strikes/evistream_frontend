'use client';

/**
 * A figure at full size, with zoom.
 *
 * Fitting the figure to the viewport is the right default — you see the whole
 * chart — but it is not enough on its own. Reading a value off a printed journal
 * figure means getting close to one marker and its error bar, and a scan of a
 * two-column page renders that marker a few pixels wide. So this zooms in past
 * fit, and out below it, and pans when zoomed.
 *
 * Zoom is a CSS transform over the fitted image rather than a re-layout, so
 * `1.0` always means "the whole figure, fit to the viewport" no matter what the
 * source resolution is. Panning is only enabled above fit, since below it there
 * is nothing outside the frame to reach.
 *
 * Rotation is here because journal scans arrive on their side often enough to
 * matter — a landscape table or a time-effect curve photographed sideways is
 * unreadable at any zoom. It turns the view, not the stored image: nothing is
 * re-uploaded, and reopening the figure starts upright again.
 *
 * Hand-rolled overlay rather than the Dialog primitive, matching the app's other
 * modals (components/documents/CitationImportDialog.tsx). z-[70] to clear the
 * source-evidence drawer layer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, Loader2, Maximize2, Minus, Plus, RotateCw, X } from 'lucide-react';

import { cn } from '@/lib/utils';

import { useFigureImage } from '@/components/figures/useFigureImage';

/** Below fit and well past it. 6x is enough to separate an error-bar cap. */
const MIN_SCALE = 0.25;
const MAX_SCALE = 6;
/** Multiplicative, so each press feels the same at 0.5x and at 4x. */
const STEP = 1.25;

const clamp = (value: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 1000) / 1000));

interface FigureLightboxProps {
  documentId: string;
  image: string;
  title: string;
  caption?: string;
  onClose: () => void;
}

export function FigureLightbox({
  documentId, image, title, caption, onClose,
}: FigureLightboxProps) {
  const { url, failed } = useFigureImage(documentId, image);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fitFactor, setFitFactor] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const zoom = useCallback((factor: number) => {
    setScale((current) => {
      const next = clamp(current * factor);
      // Re-centre on the way back to fit: a pan offset that made sense at 4x
      // leaves the figure parked off-screen once it fits again.
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const fit = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // A pan offset that framed the top-left corner means something else entirely
  // once the image is a quarter turn round, so rotating re-centres.
  const rotate = useCallback(() => {
    setRotation((current) => (current + 90) % 360);
    setOffset({ x: 0, y: 0 });
  }, []);

  // A CSS rotation does not re-layout, so a wide figure turned on its side keeps
  // the width it was fitted to and spills out of the frame. Measure the image's
  // untransformed box against the viewport and fold the correction into the
  // applied scale, so "100%" keeps meaning "the whole figure, fit to the
  // viewport" at every angle and the zoom readout stays honest.
  const measureFit = useCallback(() => {
    const img = imgRef.current;
    const view = viewportRef.current;
    if (!img || !view) return;
    if (rotation % 180 === 0) { setFitFactor(1); return; }
    const { offsetWidth: w, offsetHeight: h } = img;
    if (!w || !h) return;
    // clientWidth includes the frame's padding, so fitting against it lets a
    // turned figure run edge-to-edge under the gutter. Fit the content box.
    const box = getComputedStyle(view);
    const availableW = view.clientWidth
      - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
    const availableH = view.clientHeight
      - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom);
    setFitFactor(Math.min(availableW / h, availableH / w) || 1);
  }, [rotation]);

  useEffect(() => {
    measureFit();
    window.addEventListener('resize', measureFit);
    return () => window.removeEventListener('resize', measureFit);
  }, [measureFit, url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(STEP); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(1 / STEP); }
      else if (e.key === '0') { e.preventDefault(); fit(); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotate(); }
    };
    document.addEventListener('keydown', onKey);
    // Stop the page scrolling behind the overlay.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, zoom, fit, rotate]);

  // Native listener, not onWheel: React registers wheel handlers as passive, so
  // preventDefault there is ignored and the page scrolls while you zoom.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? STEP : 1 / STEP);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoom]);

  const startDrag = (e: React.PointerEvent) => {
    if (scale <= 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDrag = (e: React.PointerEvent) => {
    const start = dragRef.current;
    if (!start) return;
    setOffset({
      x: start.ox + (e.clientX - start.x),
      y: start.oy + (e.clientY - start.y),
    });
  };

  const endDrag = () => { dragRef.current = null; };

  const pannable = scale > 1;

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 p-5">
        <p className="max-w-3xl text-[13px] font-semibold text-white">{title}</p>
        <button
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Backdrop click closes; the figure itself does not, so a pan that ends
          outside the image cannot dismiss the whole thing mid-gesture. */}
      <div
        ref={viewportRef}
        className={cn(
          'flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6',
          pannable ? (dragRef.current ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default',
        )}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {failed ? (
          <span className="flex flex-col items-center gap-2 text-[12px] text-white/70">
            <ImageOff className="h-5 w-5" />
            Image unavailable
          </span>
        ) : !url ? (
          <Loader2 className="h-5 w-5 animate-spin text-white/70" />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- object URL from
             an authenticated fetch; next/image cannot carry the Authorization
             header. */
          <img
            ref={imgRef}
            src={url}
            alt={title}
            draggable={false}
            onLoad={measureFit}
            className="max-h-full max-w-full select-none object-contain"
            style={{
              transform:
                `translate(${offset.x}px, ${offset.y}px) `
                + `rotate(${rotation}deg) scale(${scale * fitFactor})`,
              transition: dragRef.current ? 'none' : 'transform 120ms ease-out',
            }}
          />
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-3 p-5">
        {caption && (
          <p className="max-w-3xl text-center text-[12px] leading-relaxed text-white/70">
            {caption}
          </p>
        )}
        <div className="flex items-center gap-1 rounded-full bg-white/10 p-1 backdrop-blur">
          <button
            onClick={() => zoom(1 / STEP)}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
            className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-[4rem] text-center text-[12px] font-medium tabular-nums text-white/90">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => zoom(STEP)}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
            className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={rotate}
            aria-label="Rotate 90 degrees"
            title="Rotate (R)"
            className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <button
            onClick={fit}
            disabled={scale === 1 && offset.x === 0 && offset.y === 0}
            className="ml-1 flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Fit
          </button>
        </div>
        <p className="text-[11px] text-white/40">
          Scroll or +/− to zoom · drag to pan · R to rotate · 0 to fit · Esc to close
        </p>
      </div>
    </div>
  );
}

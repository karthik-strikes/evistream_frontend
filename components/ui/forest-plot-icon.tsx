import { cn } from '@/lib/utils';

/**
 * A forest plot at 16px: the vertical no-effect line with the pooled-estimate
 * diamond sitting on it. This is the Synthesis design's own sidebar glyph.
 *
 * Stroked at 1.6/16 rather than lucide's 2/24 (= 1.33/16). The glyph is almost
 * entirely one hairline, so at lucide's weight it reads thinner than the
 * FileText and BarChart3 icons it sits beside; 1.6 matches their apparent
 * weight. The diamond is filled, not stroked — at this size a stroked one
 * closes up into a blob.
 */
export function ForestPlotIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={cn('h-4 w-4', className)}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 13.5V2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 5l3 3-3 3-3-3z" fill="currentColor" />
    </svg>
  );
}

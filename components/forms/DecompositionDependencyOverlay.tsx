'use client';

import { useLayoutEffect, useState, type MutableRefObject } from 'react';

export interface DecompositionDependencyEdge {
  id: string;
  sourceGroup: string;
  sourceField: string;
  destGroup: string;
  aggregate: boolean;
}

interface DecompositionDependencyOverlayProps {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  groupBoxRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  fieldChipRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>;
  edges: DecompositionDependencyEdge[];
}

/**
 * Draws faint bezier connectors from upstream fields/groups into the
 * downstream groups that consume them, over DecompositionReviewDialog's
 * pipeline tree. Purely additive — the same lineage is always available as
 * text (the "← field · group (S#)" pills), so an edge whose endpoint isn't
 * currently mounted (its group/stage is collapsed) is silently skipped.
 */
export function DecompositionDependencyOverlay({
  containerRef,
  groupBoxRefs,
  fieldChipRefs,
  edges,
}: DecompositionDependencyOverlayProps) {
  const [paths, setPaths] = useState<{ id: string; d: string }[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const recompute = () => {
      const origin = container.getBoundingClientRect();
      const resolved: Array<{ id: string; sourceEl: HTMLElement; destEl: HTMLElement }> = [];

      for (const edge of edges) {
        const destEl = groupBoxRefs.current[edge.destGroup];
        if (!destEl) continue;
        const sourceEl = edge.aggregate
          ? groupBoxRefs.current[edge.sourceGroup]
          : fieldChipRefs.current[`${edge.sourceGroup}::${edge.sourceField}`] || groupBoxRefs.current[edge.sourceGroup];
        if (!sourceEl) continue;
        resolved.push({ id: edge.id, sourceEl, destEl });
      }

      // Fan multiple edges into the same destination out along its top edge.
      const destCounts = new Map<HTMLElement, number>();
      for (const r of resolved) destCounts.set(r.destEl, (destCounts.get(r.destEl) || 0) + 1);
      const destIndex = new Map<HTMLElement, number>();

      const next: { id: string; d: string }[] = [];
      for (const r of resolved) {
        const sRect = r.sourceEl.getBoundingClientRect();
        const dRect = r.destEl.getBoundingClientRect();
        const total = destCounts.get(r.destEl) || 1;
        const idx = (destIndex.get(r.destEl) || 0) + 1;
        destIndex.set(r.destEl, idx);

        const sx = sRect.left + sRect.width / 2 - origin.left;
        const sy = sRect.bottom - origin.top;
        const dx = dRect.left + (dRect.width * idx) / (total + 1) - origin.left;
        const dyTop = dRect.top - origin.top;
        const dy = dyTop - sy;

        let d: string;
        if (dy > 12) {
          const ymid = sy + dy / 2;
          d = `M ${sx} ${sy} C ${sx} ${ymid}, ${dx} ${ymid}, ${dx} ${dyTop}`;
        } else {
          // Source and destination are roughly level (a same-stage sibling
          // dependency) — bow out sideways instead of assuming top-to-bottom flow.
          const sxRight = sRect.right - origin.left;
          const sMidY = sRect.top + sRect.height / 2 - origin.top;
          const dxLeft = dRect.left - origin.left;
          const dMidY = dRect.top + dRect.height / 2 - origin.top;
          const midY = (sMidY + dMidY) / 2;
          d = `M ${sxRight} ${sMidY} C ${sxRight + 18} ${midY}, ${dxLeft - 18} ${midY}, ${dxLeft} ${dMidY}`;
        }
        next.push({ id: r.id, d });
      }

      setPaths(next);
      setSize({ width: container.offsetWidth, height: container.offsetHeight });
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [edges, containerRef, groupBoxRefs, fieldChipRefs]);

  if (paths.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      className="absolute top-0 left-0 pointer-events-none overflow-visible text-violet-300 dark:text-violet-700/70"
      width={size.width}
      height={size.height}
    >
      {paths.map((p) => (
        <path key={p.id} d={p.d} stroke="currentColor" strokeWidth={1.25} fill="none" strokeLinecap="round" opacity={0.6} />
      ))}
    </svg>
  );
}

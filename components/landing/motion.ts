'use client';

import { useEffect, useRef, useState } from 'react';

/** Shared easing for every landing transition. */
export const EZ = 'cubic-bezier(.22,1,.36,1)';

/** Live `prefers-reduced-motion: reduce`. False during SSR and first paint. */
export function useReducedMotion(): boolean {
  const [rm, setRm] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setRm(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setRm(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return rm;
}

/**
 * Reveal-on-first-intersection (threshold .18). Returns a ref for the section
 * and whether it has been seen. Reduced motion (or no IntersectionObserver)
 * renders the final state immediately.
 */
export function useReveal<T extends HTMLElement = HTMLElement>(rm: boolean) {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    if (rm || typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setSeen(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rm, seen]);
  return [ref, seen || rm] as const;
}

/** Offsets used by the reveal system: windows rise 22px, copy slides 18px. */
export function revealStyle(seen: boolean) {
  return seen
    ? { o: 1, y: '0px', x: '0px', nx: '0px' }
    : { o: 0, y: '22px', x: '18px', nx: '-18px' };
}

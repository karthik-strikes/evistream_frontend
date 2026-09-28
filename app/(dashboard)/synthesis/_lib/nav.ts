'use client';

/**
 * URL-backed position for the Synthesis screens:
 * `?screen=welcome|protocol|mapping|dashboard|new|workspace&id=&tab=&form=`.
 *
 * Copied from `useRobNav`: changing screen / id pushes history (Back undoes
 * it); anything else — the tab, the form on the mapping screen — replaces, so
 * clicking through tabs doesn't flood the history.
 */

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type SynthScreen = 'welcome' | 'protocol' | 'mapping' | 'dashboard' | 'new' | 'workspace';
export const SYNTH_SCREENS: SynthScreen[] = ['welcome', 'protocol', 'mapping', 'dashboard', 'new', 'workspace'];

export type WorkspaceTab =
  | 'target' | 'evidence' | 'harmonization' | 'pooling' | 'analysis'
  | 'diagnostics' | 'swim' | 'results' | 'history';

export const MA_TABS: WorkspaceTab[] = [
  'target', 'evidence', 'harmonization', 'pooling', 'analysis', 'diagnostics', 'results', 'history',
];
export const SWIM_TABS: WorkspaceTab[] = ['target', 'evidence', 'pooling', 'swim', 'results', 'history'];

export const TAB_LABEL: Record<WorkspaceTab, string> = {
  target: 'Target',
  evidence: 'Evidence',
  harmonization: 'Harmonization',
  pooling: 'Pooling decision',
  analysis: 'Analysis',
  diagnostics: 'Diagnostics',
  swim: 'Structured synthesis',
  results: 'Results',
  history: 'History',
};

export function useSynthesisNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const get = useCallback((key: string) => params.get(key) ?? '', [params]);
  const go = useCallback((next: Record<string, string | number | null | undefined>, opts?: { replace?: boolean }) => {
    const qs = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === undefined || v === '') qs.delete(k);
      else qs.set(k, String(v));
    }
    const href = qs.toString() ? `${pathname}?${qs}` : pathname;
    const moved = ['screen', 'id'].some(k => k in next && String(next[k] ?? '') !== (params.get(k) ?? ''));
    if (moved && !opts?.replace) router.push(href, { scroll: true });
    else router.replace(href, { scroll: false });
  }, [router, pathname, params]);
  return { get, go };
}

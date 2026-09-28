'use client';

import { useQuery } from '@tanstack/react-query';
import { homeService } from '@/services/dashboard.service';
import { useAuth } from '@/contexts/AuthContext';
import { useProject } from '@/contexts/ProjectContext';

export type NavCountKey = 'extraction' | 'consensus' | 'rob' | 'synthesis';
/** A number, or why there isn't one. Only a number > 0 ever renders. */
export type NavCount = number | 'loading' | 'error' | 'restricted' | undefined;

interface NavData { extraction: number; consensus: number; rob: number; synthesis: number }

/**
 * Personal open items per workflow for the sidebar, from
 * `/dashboard/home/nav` — the same server definitions as Home's My work
 * (`summarize_work`), not Home's full payload. Keyed on user + project so a
 * late answer for the previous project can never badge the current one.
 */
export function useNavCounts(): Record<NavCountKey, NavCount> {
  const { currentUser } = useAuth();
  const { selectedProject } = useProject();
  const uid = currentUser?.id ? String(currentUser.id) : undefined;
  const pid = selectedProject?.id;
  const q = useQuery({
    queryKey: ['home', 'nav', uid ?? null, pid ?? null],
    queryFn: () => homeService.getSection<NavData>(pid!, 'nav'),
    enabled: !!uid && !!pid,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const pick = (k: NavCountKey): NavCount => {
    if (q.isLoading) return 'loading';
    if (q.isError) return 'error';
    const env = q.data;
    if (!env) return undefined;
    if (env.status !== 'ready' || !env.data) return 'restricted';
    return env.data[k];
  };
  return { extraction: pick('extraction'), consensus: pick('consensus'), rob: pick('rob'), synthesis: pick('synthesis') };
}

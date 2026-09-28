'use client';

import { useQuery } from '@tanstack/react-query';
import { homeService, type HomeSection } from '@/services/dashboard.service';
import { activityService } from '@/services/activity.service';
import type { HomeContext, HomeEnvelope, HomeForms, HomeRob, HomeSynthesis, HomeWork } from '@/types/home';

/**
 * One query per Home section, so a slow synthesis summary never holds up the
 * reviewer's own work.
 *
 * Keys carry user + project: a response for project A lives under A's key and
 * can never paint B's page, however late it lands (audit F1).
 */
function useSection<T>(
  section: HomeSection, userId: string | undefined, projectId: string | undefined,
  poll: boolean | ((data: HomeEnvelope<T> | undefined) => boolean),
) {
  return useQuery<HomeEnvelope<T>>({
    queryKey: ['home', section, userId ?? null, projectId ?? null],
    queryFn: () => homeService.getSection<T>(projectId!, section),
    enabled: !!projectId && !!userId,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    // Poll only while runs are active; react-query pauses hidden tabs.
    refetchInterval: q => ((typeof poll === 'function' ? poll(q.state.data) : poll) ? 5_000 : false),
    retry: 1,
  });
}

export function useDashboardHome(userId: string | undefined, projectId: string | undefined) {
  const runsActive = (env: HomeEnvelope<HomeContext> | undefined) => {
    const p = env?.data?.processing;
    return !!p && p.running + p.queued > 0;
  };
  const context = useSection<HomeContext>('context', userId, projectId, runsActive);
  const active = runsActive(context.data);
  const forms = useSection<HomeForms>('forms', userId, projectId, active);
  const work = useSection<HomeWork>('work', userId, projectId, active);
  const rob = useSection<HomeRob>('rob', userId, projectId, false);
  const synthesis = useSection<HomeSynthesis>('synthesis', userId, projectId, false);

  const activity = useQuery({
    queryKey: ['home', 'activity', userId ?? null, projectId ?? null],
    queryFn: () => activityService.getAll({ project_id: projectId!, limit: 5, date_range: 'all' }),
    enabled: !!projectId && !!userId,
    staleTime: 30_000,
    retry: 1,
  });

  const updatedAt = Math.max(
    context.dataUpdatedAt, forms.dataUpdatedAt, work.dataUpdatedAt,
    rob.dataUpdatedAt, synthesis.dataUpdatedAt,
  );

  return { context, forms, work, rob, synthesis, activity, polling: active, updatedAt };
}

export type HomeQueries = ReturnType<typeof useDashboardHome>;

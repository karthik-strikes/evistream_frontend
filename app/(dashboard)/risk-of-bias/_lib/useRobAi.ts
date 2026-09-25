'use client';

/**
 * React-query plumbing for RoB AI suggestions.
 *
 * `useRobAiDrafts` polls every 4 s while any domain is queued or running and
 * stops once every domain is done or failed. `useRobAiRun` starts a run and
 * refreshes the drafts. Triggered runs (`opened`, `consensus_ready`) are fire
 * and forget: the server may answer `{skipped}`, which is not an error.
 */

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { robService, type RobAiRunRequest } from '@/services';
import { draftsPending } from './robAi';

const POLL_MS = 4000;

export const robAiDraftsKey = (projectId: string, documentId: string, targetId: string) =>
  ['rob-ai-drafts', projectId, documentId, targetId] as const;

export function useRobAiDrafts(opts: {
  projectId: string; documentId: string; targetId: string; enabled: boolean;
}) {
  const { projectId, documentId, targetId, enabled } = opts;
  return useQuery({
    queryKey: robAiDraftsKey(projectId, documentId, targetId),
    queryFn: () => robService.aiDrafts(projectId, documentId, targetId),
    enabled: enabled && !!projectId && !!documentId && !!targetId,
    refetchInterval: query => (draftsPending(query.state.data) ? POLL_MS : false),
    staleTime: 30_000,
    retry: false,
  });
}

export function useRobAiRun() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (req: RobAiRunRequest) => robService.aiRun(req),
    onSettled: (_data, _err, req) => {
      qc.invalidateQueries({ queryKey: robAiDraftsKey(req.project_id, req.document_id, req.target_id) });
    },
  });
  const { mutate } = mutation;
  /** Background trigger: never surfaces an error (the drafts query shows the state). */
  const trigger = useCallback((req: RobAiRunRequest) => {
    mutate(req, { onError: () => undefined });
  }, [mutate]);
  return { ...mutation, trigger };
}

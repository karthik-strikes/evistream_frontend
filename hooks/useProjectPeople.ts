'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { projectMembersService } from '@/services';
import { memberDisplayName, firstName } from '@/components/project/sections/allocationShared';
import type { ProjectMember } from '@/types/api';

export interface Person {
  userId: string;
  /** "Esther Shnayderman", else the email, else "Unknown". */
  name: string;
  /** "Esther" — for dense rows. */
  short: string;
  /**
   * What `Avatar` hashes into a colour. Must be the email whenever we know it:
   * hashing the user id instead gives the same person a different colour on a
   * screen that happens to lack the email (the rule `ReviewerAvatar` states).
   */
  avatarKey: string;
  email: string | null;
  /** Their project role, when they are still a member. */
  role: ProjectMember['role'] | null;
}

/**
 * Everyone who can appear as an actor on this project, by user id.
 *
 * Members are the authoritative source of name + email, and the email is what
 * keeps a person's avatar the same colour here as on Allocations and Members.
 * But an actor is not always a current member — someone removed from the
 * project, or a legacy owner with no `project_members` row, still authored
 * rows and audit entries. So `personOf` takes the name and email the payload
 * itself carried as a fallback rather than rendering a UUID.
 */
export function useProjectPeople(projectId: string | undefined) {
  const { data: members = [], isLoading } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectMembersService.listMembers(projectId!).catch(() => [] as ProjectMember[]),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });

  const byId = useMemo(() => {
    const map: Record<string, Person> = {};
    for (const m of members) {
      const name = memberDisplayName(m);
      map[m.user_id] = {
        userId: m.user_id,
        name,
        short: firstName(name),
        avatarKey: m.email || m.user_id,
        email: m.email ?? null,
        role: m.role,
      };
    }
    return map;
  }, [members]);

  const personOf = useMemo(
    () =>
      (
        userId: string | null | undefined,
        fallback?: { name?: string | null; email?: string | null },
      ): Person | null => {
        if (!userId) return null;
        const known = byId[userId];
        if (known) return known;
        const name = (fallback?.name || fallback?.email || '').trim();
        return {
          userId,
          name: name || 'Unknown',
          short: name ? firstName(name) : 'Unknown',
          avatarKey: fallback?.email || userId,
          email: fallback?.email ?? null,
          role: null,
        };
      },
    [byId],
  );

  return { members, byId, personOf, isLoading };
}

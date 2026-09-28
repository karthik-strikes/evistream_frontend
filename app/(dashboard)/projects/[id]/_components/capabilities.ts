import type { MyPermissionsResponse, Project } from '@/types/api';

/**
 * Project settings capabilities (README §4 contract). Read from the TARGET
 * project's `/my-permissions`, never from ProjectContext's perms — those
 * describe the *selected* project, which this page often isn't (audit F1).
 * Archived clears every mutate capability.
 */
export interface SettingsCaps {
  canRename: boolean;
  canEditScope: boolean;
  canManageMembers: boolean;
  canViewMembers: boolean;
  canManageAssignments: boolean;
  canViewAssignments: boolean;
  canManageVocab: boolean;
  canViewVocab: boolean;
  canViewUsage: boolean;
  canTransferOwnership: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canDelete: boolean;
}

export function settingsCaps(
  project: Project,
  perms: MyPermissionsResponse | null,
  opts: { userId?: string; globalAdmin: boolean },
): SettingsCaps {
  const role = perms?.role ?? project.my_role ?? 'member';
  const isAdmin = opts.globalAdmin || !!perms?.is_admin || role === 'admin';
  const isCreator = !!opts.userId && project.user_id === opts.userId;
  const isOwner = !!perms?.is_owner || role === 'owner' || isCreator;
  const isManager = role === 'manager';
  const archived = !!project.archived_at;

  const c: SettingsCaps = {
    // Rename + delete: owners and admins only (feedback: destructive buttons role-gated).
    canRename: isOwner || isAdmin,
    canEditScope: isOwner || isManager || isAdmin,
    canManageMembers: !!perms?.can_manage_members || isOwner || isAdmin,
    canViewMembers: role !== 'viewer' || isAdmin,
    canManageAssignments: !!perms?.can_manage_assignments || isOwner || isManager || isAdmin,
    canViewAssignments: role !== 'viewer' || isAdmin,
    canManageVocab: isOwner || isManager || isAdmin,
    canViewVocab: true,
    // Cost summary was owner-only on the old hub; keep that.
    canViewUsage: isCreator || isOwner || isAdmin,
    canTransferOwnership: isOwner || isAdmin,
    canArchive: isOwner || isManager || isAdmin,
    canRestore: false,
    canDelete: isOwner || isAdmin,
  };
  if (archived) {
    return {
      ...c,
      canRename: false, canEditScope: false, canManageMembers: false, canManageAssignments: false,
      canManageVocab: false, canTransferOwnership: false, canArchive: false,
      canRestore: isOwner || isManager || isAdmin,
    };
  }
  return c;
}

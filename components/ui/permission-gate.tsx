'use client';

import { Lock } from 'lucide-react';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { useProject } from '@/contexts/ProjectContext';
import type { ReactNode } from 'react';

interface PermissionGateProps {
  /** The permission key to check (e.g. "can_view_results") */
  permission: string;
  /** What to render when the user has permission */
  children: ReactNode;
  /** Custom message shown when access is denied */
  message?: string;
  /** If true, renders nothing instead of the denied state (for hiding buttons) */
  silent?: boolean;
}

/**
 * Wraps content that requires a specific project-level permission.
 * Shows a consistent "no access" state when the user lacks the permission.
 * Admin and owner always pass through.
 */
export function PermissionGate({ permission, children, message, silent = false }: PermissionGateProps) {
  const { selectedProject } = useProject();
  const perms = useProjectPermissions();

  // No project selected — let children handle that
  if (!selectedProject) return <>{children}</>;

  // Admin and owner always have access
  if (perms.isAdmin || perms.isOwner) return <>{children}</>;

  // Check the specific permission
  const hasPermission = (perms as Record<string, unknown>)[permission];
  if (hasPermission) return <>{children}</>;

  // Denied
  if (silent) return null;

  const permissionLabels: Record<string, string> = {
    can_view_docs: 'view documents',
    can_upload_docs: 'upload documents',
    can_create_forms: 'create forms',
    can_run_extractions: 'run extractions',
    can_view_results: 'view results',
    can_adjudicate: 'access adjudication',
    can_qa_review: 'access QA reviews',
    can_manage_assignments: 'manage assignments',
    can_manage_members: 'manage members',
  };

  const actionLabel = permissionLabels[permission] || 'access this feature';
  const displayMessage = message || `You don't have permission to ${actionLabel} in this project.`;

  return (
    <div className="flex flex-col items-center justify-center h-64 text-center px-4">
      <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mb-3">
        <Lock size={20} className="text-gray-300 dark:text-zinc-600" />
      </div>
      <p className="text-sm font-medium text-gray-500 dark:text-zinc-400">{displayMessage}</p>
      <p className="text-xs text-gray-400 dark:text-zinc-600 mt-1">Contact a project manager to request access.</p>
    </div>
  );
}

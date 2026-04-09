import { useProject } from '@/contexts/ProjectContext';

export function useProjectPermissions() {
  const { myPermissions, isOwner } = useProject();

  return {
    isOwner,
    isAdmin: myPermissions?.is_admin ?? false,
    role: myPermissions?.role ?? 'member' as const,
    can_view_docs: myPermissions?.can_view_docs ?? true,
    can_upload_docs: myPermissions?.can_upload_docs ?? false,
    can_create_forms: myPermissions?.can_create_forms ?? false,
    can_run_extractions: myPermissions?.can_run_extractions ?? false,
    can_view_results: myPermissions?.can_view_results ?? true,
    can_adjudicate: myPermissions?.can_adjudicate ?? false,
    can_qa_review: myPermissions?.can_qa_review ?? false,
    can_manage_assignments: myPermissions?.can_manage_assignments ?? false,
    can_manage_members: myPermissions?.can_manage_members ?? false,
  };
}

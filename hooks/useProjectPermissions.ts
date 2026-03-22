import { useProject } from '@/contexts/ProjectContext';

export function useProjectPermissions() {
  const { myPermissions, isOwner } = useProject();

  return {
    isOwner,
    can_view_docs: myPermissions?.can_view_docs ?? true,
    can_upload_docs: myPermissions?.can_upload_docs ?? true,
    can_create_forms: myPermissions?.can_create_forms ?? true,
    can_run_extractions: myPermissions?.can_run_extractions ?? true,
    can_view_results: myPermissions?.can_view_results ?? true,
  };
}

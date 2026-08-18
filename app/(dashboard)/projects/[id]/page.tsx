'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { formsService, documentsService, extractionsService, assignmentsService, vocabulariesService } from '@/services';
import { projectMembersService } from '@/services/project-members.service';
import type { ProjectMember, AssignmentProgress } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { typography } from '@/lib/typography';
import {
  ArrowLeft,
  FileText,
  FileCheck,
  Play,
  Trash2,
  Edit2,
  Loader2,
  Users,
  ClipboardList,
  Archive,
  RotateCcw,
  Crosshair,
} from 'lucide-react';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { ProjectMembersModal } from '@/components/project/ProjectMembersModal';
import { ProjectHubCard } from '@/components/project/ProjectHubCard';
import { ProjectCostSummary } from '@/components/project/ProjectCostSummary';
import { ExtractionsSection } from '@/components/project/sections/ExtractionsSection';
import { MembersSection } from '@/components/project/sections/MembersSection';
import { AssignmentsSection } from '@/components/project/sections/AssignmentsSection';
import { VocabulariesSection } from '@/components/project/sections/VocabulariesSection';
import { ReviewScopeSection } from '@/components/project/sections/ReviewScopeSection';

// ============================================================================
// Section type
// ============================================================================

type Section = 'extractions' | 'members' | 'assignments' | 'vocabularies' | 'scope' | null;

const VALID_SECTIONS = ['extractions', 'members', 'assignments', 'vocabularies', 'scope'] as const;

function parseSection(value: string | null): Section {
  if (value && (VALID_SECTIONS as readonly string[]).includes(value)) return value as Section;
  return null;
}

// ============================================================================
// Main page
// ============================================================================

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { projects, allProjects, selectedProject, setSelectedProject, updateProject, deleteProject, archiveProject, unarchiveProject, refreshProjects } = useProject();
  const perms = useProjectPermissions();
  const { currentUser, isAdmin } = useAuth();
  const { confirm, dialog } = useConfirmationDialog();

  // allProjects (not projects) so an ARCHIVED project's detail page still
  // resolves — archived rows are filtered out of `projects` by design.
  const proj = allProjects.find((p: any) => p.id === id) || null;
  const isProjArchived = !!proj?.archived_at;

  // Gate off the project row rather than `perms`: ProjectContext only fetches
  // permissions for the *selected* project, so on a non-active project's page
  // `perms` describes the wrong project.
  const canManageThis = !!proj && (
    isAdmin || proj.user_id === currentUser?.id ||
    proj.my_role === 'owner' || proj.my_role === 'manager'
  );

  const handleArchiveToggle = async () => {
    if (!proj) return;
    if (isProjArchived) {
      try {
        await unarchiveProject(proj.id);
        toast({ title: 'Project restored', variant: 'success' });
      } catch (err: any) {
        toast({ title: 'Error', description: err.message, variant: 'error' });
      }
      return;
    }
    const confirmed = await confirm({
      title: 'Archive project',
      description: `Archive "${proj.name}"? It will be hidden from the project selector and become read-only. Results stay viewable, and you can restore it anytime.`,
      confirmLabel: 'Archive',
      onConfirm: () => {},
    });
    if (!confirmed) return;
    try {
      await archiveProject(proj.id);
      toast({ title: 'Project archived', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    }
  };

  const [forms, setForms] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [extractions, setExtractions] = useState<any[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [progress, setProgress] = useState<AssignmentProgress | null>(null);
  const [vocabularies, setVocabularies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const activeSection: Section = parseSection(searchParams.get('tab'));

  const setActiveSection = (next: Section) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set('tab', next);
    else params.delete('tab');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const navigateToForms = () => {
    if (proj && selectedProject?.id !== proj.id) setSelectedProject(proj);
    router.push('/forms');
  };

  const navigateToDocuments = () => {
    if (proj && selectedProject?.id !== proj.id) setSelectedProject(proj);
    router.push('/documents');
  };

  const [showEdit, setShowEdit] = useState(false);
  const [editData, setEditData] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const isActive = proj?.id === selectedProject?.id;

  useEffect(() => {
    if (!id) return;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [f, d, e, m, v] = await Promise.all([
          formsService.getAll(id),
          documentsService.getAll(id),
          extractionsService.getAll(id),
          perms.can_manage_members
            ? projectMembersService.listMembers(id).catch(() => [])
            : Promise.resolve([]),
          vocabulariesService.list(id).catch(() => []),
        ]);
        setForms(f);
        setDocuments(d);
        setExtractions(e);
        setMembers(m);
        setVocabularies(v);

        try {
          const prog = await assignmentsService.getProgress(id);
          setProgress(prog);
        } catch {
          // no assignments yet
        }
      } catch {
        setForms([]);
        setDocuments([]);
        setExtractions([]);
        toast({ title: 'Error', description: 'Failed to load project data. Try refreshing the page.', variant: 'error' });
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [id, perms.can_manage_members]);

  // Derived stats for card breakdown lines
  const activeForms = forms.filter((f: any) => f.status === 'active').length;
  const draftForms = forms.filter((f: any) => f.status === 'draft').length;
  const completedDocs = documents.filter((d: any) => d.processing_status === 'completed').length;
  const processingDocs = documents.filter((d: any) => d.processing_status === 'processing').length;
  const completedExtractions = extractions.filter((e: any) => e.status === 'completed' || e.status === 'done').length;
  const runningExtractions = extractions.filter((e: any) => e.status === 'running' || e.status === 'pending').length;
  const totalAssignments = progress?.total_assignments ?? 0;
  const completedAssignments = progress ? Object.values(progress.by_role).reduce((s, r) => s + r.completed, 0) : 0;
  const assignmentPct = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0;

  const handleSetActive = () => {
    if (proj) {
      setSelectedProject(proj);
      toast({ title: 'Project set as active', variant: 'success' });
    }
  };

  const handleOpenEdit = () => {
    if (!proj) return;
    setEditData({ name: proj.name, description: proj.description || '' });
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!proj || !editData.name.trim()) return;
    setSubmitting(true);
    try {
      await updateProject(proj.id, { name: editData.name, description: editData.description || undefined });
      setShowEdit(false);
      toast({ title: 'Project updated', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!proj) return;
    const confirmed = await confirm({
      title: 'Delete project',
      description: `Delete "${proj.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onConfirm: () => {},
    });
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await deleteProject(proj.id);
      toast({ title: 'Project deleted', variant: 'success' });
      router.back();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!proj) {
    return (
      <DashboardLayout>
        <div className="p-6 max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => router.back()}
              aria-label="Back to projects"
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
            >
              <ArrowLeft size={15} />
            </button>
            <span className="text-sm text-gray-400">Back to Projects</span>
          </div>
          <div className="text-center py-20">
            <div className="text-sm text-gray-400">Project not found</div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <button
                onClick={() => router.push('/projects')}
                aria-label="Back to projects"
                className="mt-1 flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors shrink-0"
              >
                <ArrowLeft size={15} />
              </button>
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <h1 className={cn(typography.page.title, 'text-gray-900 dark:text-white m-0')}>
                    {proj.name}
                  </h1>
                  {isActive && !isProjArchived && (
                    <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15 px-2 py-0.5 rounded-full">
                      Active
                    </span>
                  )}
                  {isProjArchived && (
                    <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-400/15 px-2 py-0.5 rounded-full">
                      Archived
                    </span>
                  )}
                </div>
                <p className={cn(typography.body.small, 'text-gray-400 dark:text-zinc-500 m-0')}>
                  {proj.description || 'No description'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 mt-1">
              {/* Archived projects are hidden from the selector, so they can't be made active */}
              {!isActive && !isProjArchived && (
                <button
                  onClick={handleSetActive}
                  disabled={submitting}
                  className="text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Set Active
                </button>
              )}
              {/* Archive/restore: owner, manager, admin, or creator */}
              {activeSection === null && canManageThis && (
                <button
                  onClick={handleArchiveToggle}
                  disabled={submitting}
                  title={isProjArchived ? 'Restore project' : 'Archive project'}
                  aria-label={isProjArchived ? 'Restore project' : 'Archive project'}
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:text-gray-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-40"
                >
                  {isProjArchived ? <RotateCcw size={14} /> : <Archive size={14} />}
                </button>
              )}
              {/* Rename is blocked server-side on archived projects (409), so hide it */}
              {activeSection === null && (perms.isOwner || perms.isAdmin) && !isProjArchived && (
                <>
                  <button
                    onClick={handleOpenEdit}
                    disabled={submitting}
                    title="Rename project"
                    aria-label="Rename project"
                    className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:text-gray-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-40"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={submitting}
                    title="Delete project"
                    aria-label="Delete project"
                    className="flex items-center justify-center w-8 h-8 rounded-lg border border-red-200 dark:border-red-900/40 bg-white dark:bg-[#111111] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Content area: hub grid OR drilled-in section */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : activeSection === null ? (
          /* ============================================================ */
          /* Hub Card Grid                                                 */
          /* ============================================================ */
          <>
            {proj.user_id === currentUser?.id && <ProjectCostSummary projectId={id} />}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ProjectHubCard
              icon={FileCheck}
              title="Documents"
              count={documents.length}
              accentColor="bg-blue-500"
              breakdownLines={[
                `${completedDocs} ready`,
                ...(processingDocs > 0 ? [`${processingDocs} processing`] : []),
              ]}
              onClick={navigateToDocuments}
            />
            <ProjectHubCard
              icon={FileText}
              title="Forms"
              count={forms.length}
              accentColor="bg-amber-400"
              breakdownLines={[
                `${activeForms} active`,
                ...(draftForms > 0 ? [`${draftForms} draft`] : []),
              ]}
              onClick={navigateToForms}
            />
            <ProjectHubCard
              icon={Play}
              title="Extractions"
              count={extractions.length}
              accentColor="bg-green-500"
              breakdownLines={[
                ...(runningExtractions > 0 ? [`${runningExtractions} running`] : []),
                `${completedExtractions} done`,
              ]}
              onClick={() => setActiveSection('extractions')}
            />
            <ProjectHubCard
              icon={Users}
              title="Members"
              count={members.length}
              accentColor="bg-purple-500"
              breakdownLines={[]}
              actionLabel="Invite & manage"
              onClick={() => setActiveSection('members')}
            />
            <ProjectHubCard
              icon={ClipboardList}
              title="Assignments"
              count={totalAssignments}
              accentColor="bg-indigo-500"
              breakdownLines={totalAssignments > 0 ? [`${assignmentPct}% done`] : []}
              onClick={() => setActiveSection('assignments')}
            />
            <ProjectHubCard
              icon={Crosshair}
              title="Review scope"
              valueLabel={proj?.review_scope ? 'Set' : 'Not set'}
              accentColor="bg-amber-500"
              breakdownLines={[
                proj?.review_scope ? 'Guides every form' : 'Guides how fields are read',
              ]}
              actionLabel={canManageThis ? 'Edit scope' : undefined}
              onClick={() => setActiveSection('scope')}
            />
            </div>
          </>
        ) : (
          /* ============================================================ */
          /* Drilled-in section                                            */
          /* ============================================================ */
          <div>
            <button
              onClick={() => setActiveSection(null)}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 mb-4 transition-colors"
            >
              <ArrowLeft size={14} />
              Back to hub
            </button>

            <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]">
              <div className="px-6 py-5">
                {activeSection === 'extractions' && (
                  <ExtractionsSection projectId={id} extractions={extractions} />
                )}
                {activeSection === 'members' && (
                  <MembersSection
                    projectId={id}
                    members={members}
                    onMembersChange={setMembers}
                    onInvite={() => setShowMembers(true)}
                    onOwnerTransferred={refreshProjects}
                    ownerId={proj?.user_id}
                    projectName={proj?.name}
                  />
                )}
                {activeSection === 'assignments' && (
                  <AssignmentsSection
                    projectId={id}
                    progress={progress}
                    onProgressChange={setProgress}
                  />
                )}
                {activeSection === 'vocabularies' && (
                  <VocabulariesSection
                    projectId={id}
                    vocabularies={vocabularies}
                    onVocabulariesChange={setVocabularies}
                  />
                )}
                {activeSection === 'scope' && (
                  <ReviewScopeSection
                    projectId={id}
                    reviewScope={proj?.review_scope}
                    onScopeChange={refreshProjects}
                    editable={canManageThis && !isProjArchived}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Members modal */}
      <ProjectMembersModal
        projectId={id}
        projectName={proj.name}
        isOpen={showMembers}
        onClose={() => {
          setShowMembers(false);
          projectMembersService.listMembers(id)
            .then(setMembers)
            .catch(() => {});
        }}
      />

      {/* Edit modal */}
      {showEdit && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowEdit(false); }}
        >
          <div className="w-full sm:max-w-sm mx-0 sm:mx-4 rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#111111] shadow-2xl overflow-hidden">
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-9 h-1 rounded-full bg-gray-200 dark:bg-[#2a2a2a]" />
            </div>
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Edit Project</span>
              <button
                onClick={() => setShowEdit(false)}
                aria-label="Close"
                className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 dark:bg-[#1f1f1f] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xs"
              >
                X
              </button>
            </div>
            <div className="px-5 pb-2 space-y-3">
              <div className="relative">
                <input
                  autoFocus
                  type="text"
                  value={editData.name}
                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setShowEdit(false); }}
                  placeholder="Project name"
                  className="peer w-full text-sm text-gray-900 dark:text-white pt-5 pb-2 px-3 rounded-xl border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#1a1a1a] outline-none focus:border-gray-900 dark:focus:border-white transition-colors placeholder-transparent"
                />
                <label className="absolute left-3 top-1.5 text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider pointer-events-none">
                  Name
                </label>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={editData.description}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setShowEdit(false); }}
                  placeholder="Optional description"
                  className="peer w-full text-sm text-gray-900 dark:text-white pt-5 pb-2 px-3 rounded-xl border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#1a1a1a] outline-none focus:border-gray-900 dark:focus:border-white transition-colors placeholder-transparent"
                />
                <label className="absolute left-3 top-1.5 text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider pointer-events-none">
                  Description
                </label>
              </div>
            </div>
            <div className="px-5 pt-3 pb-5 flex gap-2">
              <button
                onClick={handleSaveEdit}
                disabled={submitting || !editData.name.trim()}
                className={cn(
                  'flex-1 text-sm font-semibold text-white bg-gray-900 dark:bg-white dark:text-gray-900 rounded-xl py-2.5 transition-opacity',
                  (submitting || !editData.name.trim()) && 'opacity-40 cursor-not-allowed'
                )}
              >
                {submitting ? 'Saving...' : 'Save changes'}
              </button>
              <button
                onClick={() => setShowEdit(false)}
                disabled={submitting}
                className="text-sm font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] rounded-xl py-2.5 px-4 hover:bg-gray-200 dark:hover:bg-[#2a2a2a] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog}
    </DashboardLayout>
  );
}

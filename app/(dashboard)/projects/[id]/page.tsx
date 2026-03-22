'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
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
  BookOpen,
} from 'lucide-react';
import { ProjectMembersModal } from '@/components/project/ProjectMembersModal';
import { ProjectHubCard } from '@/components/project/ProjectHubCard';
import { DocumentsSection } from '@/components/project/sections/DocumentsSection';
import { FormsSection } from '@/components/project/sections/FormsSection';
import { ExtractionsSection } from '@/components/project/sections/ExtractionsSection';
import { MembersSection } from '@/components/project/sections/MembersSection';
import { AssignmentsSection } from '@/components/project/sections/AssignmentsSection';
import { VocabulariesSection } from '@/components/project/sections/VocabulariesSection';

// ============================================================================
// Section type
// ============================================================================

type Section = 'documents' | 'forms' | 'extractions' | 'members' | 'assignments' | 'vocabularies' | null;

// ============================================================================
// Main page
// ============================================================================

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { projects, selectedProject, setSelectedProject, updateProject, deleteProject } = useProject();

  const proj = projects.find((p: any) => p.id === id) || null;

  const [forms, setForms] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [extractions, setExtractions] = useState<any[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [progress, setProgress] = useState<AssignmentProgress | null>(null);
  const [vocabularies, setVocabularies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeSection, setActiveSection] = useState<Section>(null);

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
          projectMembersService.listMembers(id).catch(() => []),
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
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [id]);

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
    if (!confirm(`Delete "${proj.name}"? This action cannot be undone.`)) return;
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
                className="mt-1 flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors shrink-0"
              >
                <ArrowLeft size={15} />
              </button>
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <h1 className={cn(typography.page.title, 'text-gray-900 dark:text-white m-0')}>
                    {proj.name}
                  </h1>
                  {isActive && (
                    <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15 px-2 py-0.5 rounded-full">
                      Active
                    </span>
                  )}
                </div>
                <p className={cn(typography.body.small, 'text-gray-400 dark:text-zinc-500 m-0')}>
                  {proj.description || 'No description'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 mt-1">
              {!isActive && (
                <button
                  onClick={handleSetActive}
                  disabled={submitting}
                  className="text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Set Active
                </button>
              )}
              <button
                onClick={handleOpenEdit}
                disabled={submitting}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors disabled:opacity-40"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-red-200 dark:border-red-900/40 bg-white dark:bg-[#111111] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors disabled:opacity-40"
              >
                <Trash2 size={14} />
              </button>
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
              onClick={() => setActiveSection('documents')}
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
              onClick={() => setActiveSection('forms')}
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
              icon={BookOpen}
              title="Vocabularies"
              count={vocabularies.length}
              accentColor="bg-teal-500"
              breakdownLines={[]}
              badge="Beta"
              onClick={() => setActiveSection('vocabularies')}
            />
          </div>
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
                {activeSection === 'documents' && (
                  <DocumentsSection projectId={id} documents={documents} />
                )}
                {activeSection === 'forms' && (
                  <FormsSection projectId={id} forms={forms} />
                )}
                {activeSection === 'extractions' && (
                  <ExtractionsSection projectId={id} extractions={extractions} />
                )}
                {activeSection === 'members' && (
                  <MembersSection
                    projectId={id}
                    members={members}
                    onMembersChange={setMembers}
                    onInvite={() => setShowMembers(true)}
                    ownerId={proj?.user_id}
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
    </DashboardLayout>
  );
}

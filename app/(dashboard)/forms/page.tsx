'use client';

import { DashboardLayout } from '@/components/layout';
import { useRouter } from 'next/navigation';
import { useProject } from '@/contexts/ProjectContext';
import { formsService, documentsService } from '@/services';
import { Form, CreateFormRequest, FormField, ReviewNote } from '@/types/api';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  Button,
  Card,
  Badge,
  Dialog,
  DialogContent,
  DialogTitle,
  Spinner,
  Textarea,
  EmptyState,
} from '@/components/ui';
import { Plus, Trash2, FileText, Code, AlertCircle, Check, Edit3, FolderOpen, ThumbsUp, ThumbsDown, MessageSquare, ChevronDown, ChevronUp, ChevronRight, X, Clipboard, ClipboardCheck, Download, FilePlus2 } from 'lucide-react';
import PilotStudyDialog from '@/components/pilot/PilotStudyDialog';
import { connectToJobLogs, type LogMessage } from '@/services/jobLogsWebSocket';
import { apiClient } from '@/lib/api';
import { cn, formatDate, formatRelativeTime, getErrorMessage } from '@/lib/utils';
import { TooltipSimple } from '@/components/ui';
import { typography } from '@/lib/typography';
import { statusColors, statusBgs } from '@/lib/colors';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import {
  FieldEditorPane,
  AutoTextarea,
  humanizeFieldName,
  autoDetectAnchors,
  type UEFCalField,
  type UEFEditableField,
} from '@/components/forms/FieldEditorPane';
import {
  DecompositionDependencyOverlay,
  type DecompositionDependencyEdge,
} from '@/components/forms/DecompositionDependencyOverlay';

export default function FormsPage() {
  const { selectedProject, projects } = useProject();
  const router = useRouter();
  const { can_create_forms, can_view_docs, can_run_extractions } = useProjectPermissions();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [openForm, setOpenForm] = useState<Form | null>(null);
  const [reviewForm, setReviewForm] = useState<Form | null>(null);
  const [pilotForm, setPilotForm] = useState<Form | null>(null);
  const [refineForm, setRefineForm] = useState<Form | null>(null);
  const [editUnifiedForm, setEditUnifiedForm] = useState<Form | null>(null);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [generatingJobs, setGeneratingJobs] = useState<Record<string, string>>({});

  // Debounce search query (300ms) so we don't hit the API on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const queryClient = useQueryClient();
  const { data: forms = [], isLoading, error: queryError } = useQuery({
    queryKey: ['forms', selectedProject?.id, debouncedSearch],
    queryFn: () => formsService.getAll(selectedProject!.id, debouncedSearch || undefined),
    enabled: !!selectedProject,
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      const hasPilotRunning = data.some((f: Form) => {
        const m = typeof f.metadata === 'string' ? JSON.parse(f.metadata || '{}') : (f.metadata || {});
        return m?.pilot?.status === 'running';
      });
      return data.some((f: Form) => f.status === 'generating' || f.status === 'regenerating' || f.status === 'awaiting_review') || hasPilotRunning ? 5000 : false;
    },
    placeholderData: keepPreviousData,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['documents', selectedProject?.id],
    queryFn: () => documentsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
  });

  const docNames = useMemo(() => {
    const map: Record<string, string> = {};
    documents.forEach((d: any) => { map[d.id] = d.filename; });
    return map;
  }, [documents]);

  const error = queryError ? getErrorMessage(queryError as any, 'Failed to load forms') : null;

  const filteredForms = forms;

  const handleGenerateCode = async (formId: string, enableReview?: boolean) => {
    try {
      const response = await formsService.generateCode(formId, enableReview);

      if (response.job_id) {
        setGeneratingJobs(prev => ({ ...prev, [formId]: response.job_id! }));
      }

      toast({
        title: 'Code Generation Started',
        description: 'AI is generating extraction code.',
        variant: 'success',
      });

      // Refresh forms to see updated status
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
    } catch (err: any) {
      console.error('Failed to generate code:', err);
      toast({
        title: 'Error',
        description: getErrorMessage(err, 'Failed to generate code'),
        variant: 'error',
      });
    }
  };

  const handleDeleteForm = async (formId: string) => {
    if (!confirm('Are you sure you want to delete this form?')) return;

    try {
      await formsService.delete(formId);
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
      toast({
        title: 'Success',
        description: 'Form deleted successfully',
        variant: 'success',
      });
    } catch (err: any) {
      console.error('Failed to delete form:', err);
      toast({
        title: 'Error',
        description: getErrorMessage(err, 'Failed to delete form'),
        variant: 'error',
      });
    }
  };

  const handleApproveDecomposition = async (formId: string) => {
    try {
      const response = await formsService.approveDecomposition(formId, { silent: true });
      if (response.job_id) {
        setGeneratingJobs(prev => ({ ...prev, [formId]: response.job_id }));
      }
      toast({
        title: 'Decomposition Approved',
        description: 'Continuing with code generation...',
        variant: 'success',
      });
      setReviewForm(null);
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
    } catch (err: any) {
      const httpStatus = err?.response?.status;
      const detail: string = err?.response?.data?.detail || '';

      // Stale-state: another tab/double-click already moved the form past awaiting_review.
      // Treat as informational rather than an error.
      if (httpStatus === 400 && /not awaiting review/i.test(detail)) {
        toast({
          title: 'Already processed',
          description: 'This form was already reviewed elsewhere — refreshing.',
          variant: 'warning',
        });
        setReviewForm(null);
        await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
        return;
      }

      console.error('Failed to approve decomposition:', err);
      toast({
        title: 'Error',
        description: getErrorMessage(err, 'Failed to approve decomposition'),
        variant: 'error',
      });
    }
  };

  const handleRejectDecomposition = async (formId: string, feedback: string, notes: ReviewNote[]) => {
    const acceptedRefs: string[] = [];
    try {
      const response = await formsService.rejectDecomposition(formId, { feedback: feedback || undefined, notes, accepted_refs: acceptedRefs });
      if (response.job_id) {
        setGeneratingJobs(prev => ({ ...prev, [formId]: response.job_id }));
      }
      toast({
        title: 'Feedback Submitted',
        description: 'Regenerating decomposition with your feedback...',
        variant: 'success',
      });
      setReviewForm(null);
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
    } catch (err: any) {
      console.error('Failed to reject decomposition:', err);
      toast({
        title: 'Error',
        description: getErrorMessage(err, 'Failed to reject decomposition'),
        variant: 'error',
      });
    }
  };

  const handleUpdateForm = async (formId: string, data: Partial<CreateFormRequest>) => {
    await formsService.update(formId, data);
    try {
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
    } catch (err) {
      console.error('Failed to refresh forms list after update:', err);
    }
  };

  if (!selectedProject) {
    return (
      <DashboardLayout title="Forms" description="Create and manage extraction forms">
        <EmptyState
          icon={FolderOpen}
          title="No project selected"
          description="Create or open a project to manage forms."
          action={{ label: 'Go to projects', onClick: () => router.push('/projects') }}
        />
      </DashboardLayout>
    );
  }

  if (!can_view_docs) {
    return (
      <DashboardLayout title="Forms" description="Create and manage extraction forms">
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">You do not have permission to view forms in this project.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title="Forms"
      description="Create and manage extraction forms"
    >
      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center dark:bg-red-900/20 dark:border-red-800/50">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
          <p className={cn(typography.message.error, "text-red-800 dark:text-red-400")}>{error}</p>
          <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false })} className="mt-4">
            Retry
          </Button>
        </div>
      ) : forms.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className={cn(typography.emptyState.title, "text-gray-900 dark:text-white mb-2")}>No forms yet</h3>
          <p className={cn(typography.emptyState.description, "mb-6")}>
            Create your first extraction form to start extracting data from documents.
          </p>
          {can_create_forms && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Your First Form
          </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Search + Create row */}
          <div className="flex items-center justify-end gap-2">
            <div className="relative">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search forms..."
                className="w-56 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2 pl-9 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400"
              />
            </div>
            <TooltipSimple text={can_create_forms ? '' : 'You need the "Create Forms" permission'}>
            <button
              onClick={() => setShowCreateDialog(true)}
              disabled={!can_create_forms}
              className={cn(
                "text-sm font-semibold border-none rounded-lg px-4 py-2 flex items-center gap-1.5 transition-colors",
                can_create_forms
                  ? "text-white bg-gray-900 dark:bg-white dark:text-black cursor-pointer hover:bg-gray-700 dark:hover:bg-zinc-100"
                  : "bg-gray-200 dark:bg-[#2a2a2a] text-gray-400 dark:text-zinc-600 cursor-not-allowed"
              )}
            >
              <Plus className="h-4 w-4" />
              Create Form
            </button>
            </TooltipSimple>
          </div>

          {/* Forms Sections */}
          {filteredForms.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">No forms matching &ldquo;{searchQuery}&rdquo;</div>
          ) : (
            <div className="space-y-8">
              {/* Needs Attention Section */}
              {filteredForms.filter(f => f.status === 'failed' || f.status === 'awaiting_review').length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <h2 className={cn(typography.sectionHeader.default, "text-gray-500")}>
                      Needs Attention
                    </h2>
                    <span className={cn(typography.body.tiny, "text-gray-400")}>
                      {filteredForms.filter(f => f.status === 'failed' || f.status === 'awaiting_review').length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredForms
                      .filter(f => f.status === 'failed' || f.status === 'awaiting_review')
                      .map((form) => (
                        <FormCard
                          key={form.id}
                          form={form}
                          onGenerateCode={handleGenerateCode}
                          onDelete={handleDeleteForm}
                          onClick={() => setOpenForm(form)}
                          onReview={(form) => setReviewForm(form)}
                          onApprove={handleApproveDecomposition}
                          onEdit={(form) => setOpenForm(form)}
                          onPilot={(form) => setPilotForm(form)}
                          onRefine={(form) => setRefineForm(form)}
                          onEditUnified={(form) => setEditUnifiedForm(form)}
                          jobId={generatingJobs[form.id] || (typeof form.metadata === 'string' ? JSON.parse(form.metadata || '{}') : (form.metadata || {}))?.current_job_id}
                          docNames={docNames}
                          canManage={can_create_forms}
                          canPilot={can_create_forms || can_run_extractions}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* In Progress Section */}
              {filteredForms.filter(f => f.status === 'generating' || f.status === 'regenerating').length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-pulse" />
                    <h2 className={cn(typography.sectionHeader.default, "text-gray-500")}>
                      In Progress
                    </h2>
                    <span className={cn(typography.body.tiny, "text-gray-400")}>
                      {filteredForms.filter(f => f.status === 'generating' || f.status === 'regenerating').length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredForms
                      .filter(f => f.status === 'generating' || f.status === 'regenerating')
                      .map((form) => (
                        <FormCard
                          key={form.id}
                          form={form}
                          onGenerateCode={handleGenerateCode}
                          onDelete={handleDeleteForm}
                          onClick={() => setOpenForm(form)}
                          onReview={(form) => setReviewForm(form)}
                          onApprove={handleApproveDecomposition}
                          onEdit={(form) => setOpenForm(form)}
                          onPilot={(form) => setPilotForm(form)}
                          onRefine={(form) => setRefineForm(form)}
                          onEditUnified={(form) => setEditUnifiedForm(form)}
                          jobId={generatingJobs[form.id] || (typeof form.metadata === 'string' ? JSON.parse(form.metadata || '{}') : (form.metadata || {}))?.current_job_id}
                          docNames={docNames}
                          canManage={can_create_forms}
                          canPilot={can_create_forms || can_run_extractions}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* Draft Section */}
              {filteredForms.filter(f => f.status === 'draft').length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                    <h2 className={cn(typography.sectionHeader.default, "text-gray-500")}>
                      Draft
                    </h2>
                    <span className={cn(typography.body.tiny, "text-gray-400")}>
                      {filteredForms.filter(f => f.status === 'draft').length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredForms
                      .filter(f => f.status === 'draft')
                      .map((form) => (
                        <FormCard
                          key={form.id}
                          form={form}
                          onGenerateCode={handleGenerateCode}
                          onDelete={handleDeleteForm}
                          onClick={() => setOpenForm(form)}
                          onReview={(form) => setReviewForm(form)}
                          onApprove={handleApproveDecomposition}
                          onEdit={(form) => setOpenForm(form)}
                          onPilot={(form) => setPilotForm(form)}
                          onRefine={(form) => setRefineForm(form)}
                          onEditUnified={(form) => setEditUnifiedForm(form)}
                          jobId={generatingJobs[form.id] || (typeof form.metadata === 'string' ? JSON.parse(form.metadata || '{}') : (form.metadata || {}))?.current_job_id}
                          docNames={docNames}
                          canManage={can_create_forms}
                          canPilot={can_create_forms || can_run_extractions}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* Active Section */}
              {filteredForms.filter(f => f.status === 'active').length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    <h2 className={cn(typography.sectionHeader.default, "text-gray-500")}>
                      Active
                    </h2>
                    <span className={cn(typography.body.tiny, "text-gray-400")}>
                      {filteredForms.filter(f => f.status === 'active').length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredForms
                      .filter(f => f.status === 'active')
                      .map((form) => (
                        <FormCard
                          key={form.id}
                          form={form}
                          onGenerateCode={handleGenerateCode}
                          onDelete={handleDeleteForm}
                          onClick={() => setOpenForm(form)}
                          onReview={(form) => setReviewForm(form)}
                          onApprove={handleApproveDecomposition}
                          onEdit={(form) => setOpenForm(form)}
                          onPilot={(form) => setPilotForm(form)}
                          onRefine={(form) => setRefineForm(form)}
                          onEditUnified={(form) => setEditUnifiedForm(form)}
                          jobId={generatingJobs[form.id] || (typeof form.metadata === 'string' ? JSON.parse(form.metadata || '{}') : (form.metadata || {}))?.current_job_id}
                          docNames={docNames}
                          canManage={can_create_forms}
                          canPilot={can_create_forms || can_run_extractions}
                        />
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Clone an existing form — single page-level action at the bottom of the page */}
          {can_create_forms && filteredForms.some(f => f.status === 'active') && (
            <div className="pt-7 mt-3 border-t border-gray-100 dark:border-[#1a1a1a] flex flex-col items-center text-center">
              <button
                onClick={() => setShowCloneDialog(true)}
                className="text-sm font-medium text-gray-600 dark:text-zinc-300 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-4 py-2 inline-flex items-center gap-1.5 transition-colors hover:border-gray-300 dark:hover:border-[#3f3f3f] hover:text-gray-900 dark:hover:text-white"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                Clone form
              </button>
              <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-2">Reuse an existing form&rsquo;s fields and instructions in a new copy — no code generation.</p>
            </div>
          )}
        </div>
      )}

      {showCreateDialog && (
        <CreateFormDialog
          projectId={selectedProject.id}
          existingForms={forms}
          onClose={() => setShowCreateDialog(false)}
          onSuccess={(form) => {
            setShowCreateDialog(false);
            queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
          }}
        />
      )}

      {openForm && (
        <FormDialog
          form={openForm}
          existingForms={forms}
          canManage={can_create_forms}
          onClose={() => setOpenForm(null)}
          onSuccess={() => {
            setOpenForm(null);
            queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
          }}
          onUpdate={handleUpdateForm}
          onGenerateCode={handleGenerateCode}
          onDelete={handleDeleteForm}
          onOpenInstructions={(f) => { setOpenForm(null); setRefineForm(f); }}
        />
      )}

      {reviewForm && (
        <DecompositionReviewDialog
          form={reviewForm}
          onClose={() => setReviewForm(null)}
          onApprove={handleApproveDecomposition}
          onReject={handleRejectDecomposition}
        />
      )}

      {pilotForm && (
        <PilotStudyDialog
          form={pilotForm}
          onClose={() => {
            setPilotForm(null);
            queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
          }}
        />
      )}

      {refineForm && (
        <PromptRefinementDialog
          form={refineForm}
          onClose={() => setRefineForm(null)}
        />
      )}

      {editUnifiedForm && (
        <EditFormDialog
          form={editUnifiedForm}
          existingForms={forms}
          canManage={can_create_forms}
          onClose={() => setEditUnifiedForm(null)}
          onSuccess={() => {
            setEditUnifiedForm(null);
            queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
          }}
        />
      )}

      {showCloneDialog && (
        <CloneFormDialog
          forms={forms}
          projects={projects}
          currentProjectId={selectedProject.id}
          onClose={() => setShowCloneDialog(false)}
          onSuccess={() => {
            setShowCloneDialog(false);
            queryClient.invalidateQueries({ queryKey: ['forms'], exact: false });
          }}
        />
      )}
    </DashboardLayout>
  );
}

// Form Card Component
function CloneFormDialog({
  forms,
  projects,
  currentProjectId,
  onClose,
  onSuccess,
}: {
  forms: Form[];
  projects: { id: string; name: string }[];
  currentProjectId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  // Only active forms have a compiled schema_def and can be cloned without codegen.
  const activeForms = useMemo(() => forms.filter(f => f.status === 'active'), [forms]);
  const [sourceId, setSourceId] = useState(activeForms[0]?.id ?? '');
  const source = activeForms.find(f => f.id === sourceId) ?? null;
  const [name, setName] = useState(source ? `${source.form_name} (copy)` : '');
  const [targetProjectId, setTargetProjectId] = useState(currentProjectId);
  const [submitting, setSubmitting] = useState(false);

  // When the chosen source changes, follow it: reset the proposed name.
  useEffect(() => {
    if (!source) return;
    setName(`${source.form_name} (copy)`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  const trimmed = name.trim();
  const sameProject = targetProjectId === currentProjectId;
  // The inline name-clash hint is reliable only for the current project (the only
  // project whose forms are loaded). The backend 409 is the source of truth otherwise.
  const nameClash = sameProject && !!source && forms.some(
    f => f.id !== source.id && f.form_name.trim().toLowerCase() === trimmed.toLowerCase()
  );
  const canSubmit = !!source && trimmed.length > 0 && !nameClash && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !source) return;
    setSubmitting(true);
    try {
      await formsService.duplicate(source.id, {
        form_name: trimmed,
        target_project_id: targetProjectId,
      });
      const projName = projects.find(p => p.id === targetProjectId)?.name;
      toast({
        title: 'Form cloned',
        description: sameProject
          ? `"${trimmed}" is ready to use — no code generation needed.`
          : `"${trimmed}" was cloned into ${projName ?? 'the selected project'}.`,
        variant: 'success',
      });
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Could not clone form', description: getErrorMessage(err, 'Failed to clone form'), variant: 'error' });
      setSubmitting(false);
    }
  };

  const lbl = "block text-[11px] font-semibold tracking-wider text-gray-400 dark:text-zinc-500 uppercase mb-1.5";
  const fieldCls = "w-full text-sm text-gray-700 dark:text-zinc-200 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none transition-colors focus:border-gray-400 dark:focus:border-[#3f3f3f]";

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={() => { if (!submitting) onClose(); }}>
      <div className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-[460px] shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header — matches DecompositionReviewDialog */}
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-[#1a1a1a] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">Clone form</h2>
            <p className="text-sm text-gray-400 dark:text-zinc-500 mt-0.5">Reuse a form&rsquo;s fields and instructions — no code generation.</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-300 transition-colors p-1 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          {activeForms.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-zinc-500 py-4 text-center">No active forms to clone yet.</p>
          ) : (
            <div className="space-y-4">
              {/* Source form */}
              <div>
                <label className={lbl}>Form to clone</label>
                <div className="relative">
                  <select value={sourceId} onChange={e => setSourceId(e.target.value)} className={cn(fieldCls, "pr-8 cursor-pointer appearance-none dark:[color-scheme:dark]")}>
                    {activeForms.map(f => (
                      <option key={f.id} value={f.id}>{f.form_name}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* New name */}
              <div>
                <label className={lbl}>New name</label>
                <input value={name} onChange={e => setName(e.target.value)} className={fieldCls} />
                {nameClash && (
                  <p className="text-[11px] text-red-500 mt-1.5">A form with this name already exists in this project.</p>
                )}
              </div>

              {/* Destination project */}
              <div>
                <label className={lbl}>Destination project</label>
                <div className="relative">
                  <select value={targetProjectId} onChange={e => setTargetProjectId(e.target.value)} className={cn(fieldCls, "pr-8 cursor-pointer appearance-none dark:[color-scheme:dark]")}>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}{p.id === currentProjectId ? ' (current)' : ''}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 mt-6">
            <button type="button" onClick={onClose} disabled={submitting} className="text-sm font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-50">Cancel</button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit}
              className={cn(
                "text-sm font-semibold rounded-lg px-4 py-2 inline-flex items-center gap-1.5 transition-colors",
                canSubmit
                  ? "text-white bg-gray-900 dark:bg-white dark:text-black hover:bg-gray-700 dark:hover:bg-zinc-100 cursor-pointer"
                  : "bg-gray-200 dark:bg-[#2a2a2a] text-gray-400 dark:text-zinc-600 cursor-not-allowed"
              )}>
              {submitting ? (<><Spinner size="sm" className="mr-1" /> Cloning…</>) : 'Clone form'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormCard({
  form,
  onGenerateCode,
  onDelete,
  onClick,
  onReview,
  onApprove,
  onEdit,
  onPilot,
  onRefine,
  onEditUnified,
  jobId,
  docNames = {},
  canManage = false,
  canPilot = false,
}: {
  form: Form;
  onGenerateCode: (id: string, enableReview?: boolean) => void;
  onDelete: (id: string) => void;
  onClick: () => void;
  onReview?: (form: Form) => void;
  onApprove?: (formId: string) => void;
  onEdit?: (form: Form) => void;
  onPilot?: (form: Form) => void;
  onRefine?: (form: Form) => void;
  onEditUnified?: (form: Form) => void;
  jobId?: string;
  docNames?: Record<string, string>;
  canManage?: boolean;
  canPilot?: boolean;
}) {
  const [showError, setShowError] = useState(false);
  const [activeDocIdx, setActiveDocIdx] = useState(0);
  const [docFade, setDocFade] = useState(true);

  const isGenerating = form.status === 'generating' || form.status === 'regenerating';

  const elapsedLabel = (dateStr: string) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'just started';
    if (mins === 1) return '1 min';
    return `${mins} min`;
  };

  const statusConfig: Record<string, { label: string; cls: string }> = {
    draft: { label: 'Draft', cls: 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]' },
    generating: { label: 'Generating', cls: 'text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/50' },
    awaiting_review: { label: 'Review', cls: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50' },
    regenerating: { label: 'Regenerating', cls: 'text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/50' },
    active: { label: 'Active', cls: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50' },
    failed: { label: 'Failed', cls: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50' },
  };

  const s = statusConfig[form.status];
  const isFailed = form.status === 'failed';
  const isDraft = form.status === 'draft';
  const isReview = form.status === 'awaiting_review';

  // Hoist pilot data so it's available for card-level styling
  const meta = typeof form.metadata === 'string' ? JSON.parse(form.metadata || '{}') : (form.metadata || {});
  const pilot = meta.pilot;
  const pilotStatus = pilot?.status;
  const sampleIds: string[] = pilot?.sample_document_ids || [];

  useEffect(() => {
    if (pilotStatus !== 'running' || sampleIds.length <= 1) return;
    const interval = setInterval(() => {
      setDocFade(false);
      setTimeout(() => {
        setActiveDocIdx(prev => (prev + 1) % sampleIds.length);
        setDocFade(true);
      }, 300);
    }, 2500);
    return () => clearInterval(interval);
  }, [pilotStatus, sampleIds.length]);

  const currentDocName = sampleIds.length > 0
    ? (docNames[sampleIds[activeDocIdx]] || sampleIds[activeDocIdx]?.slice(0, 8) || '').replace(/\.(pdf|md)$/i, '')
    : '';

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white rounded-xl border border-gray-200 flex flex-col transition-all duration-150 relative overflow-hidden dark:bg-[#111111] dark:border-[#1f1f1f] group cursor-pointer",
        !isFailed && !isReview && "hover:border-gray-300 dark:hover:border-[#2a2a2a]",
        isFailed && "border-l-[4px] border-l-red-400 dark:border-l-red-500 bg-gradient-to-r from-red-50/60 to-white dark:from-red-400/10 dark:to-[#111111] hover:border-l-red-400 dark:hover:border-l-red-500",
        isReview && "border-l-[4px] border-l-amber-500 dark:border-l-amber-400 bg-gradient-to-r from-amber-50 to-white dark:from-amber-400/10 dark:to-[#111111] hover:border-l-amber-500 dark:hover:border-l-amber-400",
        isDraft && "border-l-[4px] border-l-slate-400 dark:border-l-zinc-400",
      )}
    >
      <div className="pt-5 px-[22px]">
        {/* Title + status */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-sm font-semibold text-gray-900 m-0 tracking-tight leading-[1.35] flex-1 dark:text-white">{form.form_name}</h3>
          <span
            className={cn("text-xs font-semibold rounded-[5px] px-2 py-0.5 tracking-wide whitespace-nowrap shrink-0", s?.cls)}
          >{s?.label}</span>
        </div>

        {/* Description */}
        {form.form_description && (
          <p className="text-sm text-gray-400 dark:text-zinc-500 mb-3.5 leading-relaxed" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{form.form_description}</p>
        )}

        {/* Meta */}
        <div className={cn("flex items-center gap-2.5 text-xs text-gray-400", isFailed || isReview ? "mb-3.5" : "mb-[18px]")}>
          <span className="flex items-center gap-1">
            <span className="text-gray-500 font-medium">{form.fields.length}</span> {form.fields.length === 1 ? 'field' : 'fields'}
          </span>
          <span className="text-gray-200">&middot;</span>
          <TooltipSimple text={formatDate(form.updated_at || form.created_at)}>
            <span className="cursor-default">{formatRelativeTime(form.updated_at || form.created_at)}</span>
          </TooltipSimple>
        </div>
      </div>

      {/* Error for failed — enhanced with actionable info */}
      {isFailed && (() => {
        const err = form.error || '';
        // Extract failed signature names from error text
        const failedNames = [...err.matchAll(/Failed to generate (\w+)/g)].map(m => m[1]);
        // Convert PascalCase to readable
        const readableNames = failedNames.map(n => n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'));
        // Determine human-readable cause
        const isTimeout = /timeout|time.limit|timed.out/i.test(err);
        const isFieldFailure = failedNames.length > 0;

        const title = isTimeout
          ? 'Generation timed out'
          : isFieldFailure
            ? `${failedNames.length} field group${failedNames.length > 1 ? 's' : ''} failed to generate`
            : 'Code generation failed';

        const description = isTimeout
          ? 'The process took too long. Try reducing the number of fields or simplifying descriptions.'
          : isFieldFailure
            ? "The extraction schema couldn't be built for some field groups. This usually happens when field descriptions are too vague for structured output."
            : 'Something went wrong during code generation. You can retry or edit your form and try again.';

        const suggestedFix = isTimeout
          ? { title: 'Simplify and retry', desc: 'Reduce the number of fields or split into multiple forms, then retry' }
          : isFieldFailure
            ? { title: 'Improve field descriptions', desc: `Open the form, add more specific descriptions for vague fields, then retry generation` }
            : { title: 'Retry generation', desc: 'Sometimes a simple retry resolves transient issues' };

        return (
          <div className="px-[22px] pb-3.5" onClick={e => e.stopPropagation()}>
            <div className="h-px bg-gray-100 dark:bg-[#1a1a1a] mb-3" />

            {/* Error summary */}
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#fde8e8] dark:bg-red-900/10 mb-3">
              <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-[#f5c6c6] dark:bg-red-800/40">
                <X className="w-2.5 h-2.5 text-[#b91c1c] dark:text-red-400" />
              </div>
              <div>
                <p className="text-xs font-semibold text-[#7f1d1d] dark:text-red-300">{title}</p>
                <p className="text-[11px] mt-0.5 leading-relaxed text-[#b45858] dark:text-red-400">{description}</p>
              </div>
            </div>

            {/* Failed groups as tags */}
            {readableNames.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-500 uppercase mb-1.5">Failed groups</div>
                <div className="flex flex-wrap gap-1.5">
                  {readableNames.map((name, i) => (
                    <span key={i} className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/15 border border-red-200/50 dark:border-red-800/30 px-2 py-0.5 rounded-md">{name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Suggested fix */}
            <div className="mb-3">
              <div className="text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-500 uppercase mb-1.5">Suggested fix</div>
              <div className="flex items-start gap-2 p-2.5 rounded-lg">
                <Check className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300">{suggestedFix.title}</p>
                  <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 leading-relaxed">{suggestedFix.desc}</p>
                </div>
              </div>
            </div>

            {/* Collapsible raw log */}
            <button
              onClick={() => setShowError(!showError)}
              className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 bg-transparent border-none cursor-pointer p-0 mb-3 transition-colors"
            >
              <ChevronRight className={cn("w-3 h-3 transition-transform", showError && "rotate-90")} />
              {showError ? 'Hide' : 'Show'} raw error log
            </button>
            {showError && (
              <div className="text-[11px] text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#141414] rounded-lg p-3 mb-3 font-mono leading-relaxed break-all max-h-32 overflow-y-auto">
                {err}
              </div>
            )}

            {/* Action buttons */}
            {canManage && (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => onGenerateCode(form.id)}>Retry</Button>
                {onEdit && (
                  <Button variant="ghost" size="sm" onClick={() => onEdit(form)}>Edit form</Button>
                )}
                <Button variant="ghost" size="sm" className="ml-auto h-8 w-8 p-0 text-gray-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400" onClick={() => onDelete(form.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Draft CTA */}
      {isDraft && canManage && (
        <div className="px-[22px] pb-3.5">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={e => { e.stopPropagation(); onEdit?.(form); }}>
              <Edit3 className="w-3.5 h-3.5" />
              Continue editing
            </Button>
            <Button variant="ghost" size="sm" className="ml-auto h-8 w-8 p-0 text-gray-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400" onClick={e => { e.stopPropagation(); onDelete(form.id); }}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Review CTA — enhanced with context */}
      {isReview && (() => {
        const meta = typeof form.metadata === 'string' ? JSON.parse(form.metadata || '{}') : (form.metadata || {});
        const decomp = meta.decomposition || {};
        const sigs = decomp.signatures || [];
        const totalFields = sigs.reduce((s: number, sig: any) => s + Object.keys(sig.fields || {}).length, 0);

        return (
          <div className="px-[22px] pb-3.5" onClick={e => e.stopPropagation()}>
            <div className="h-px bg-gray-100 dark:bg-[#1a1a1a] mb-3" />
            <div className="text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-500 uppercase mb-2.5">What to review</div>

            <div className="space-y-2 mb-3.5">
              {/* Info item */}
              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#fef3e2] dark:bg-amber-900/10">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#b45309] dark:text-amber-500" />
                <div>
                  <p className="text-xs font-semibold text-[#78350f] dark:text-amber-300">{sigs.length} field groups created from {totalFields} fields</p>
                  <p className="text-[11px] mt-0.5 leading-relaxed text-[#92620a] dark:text-amber-400">AI grouped your fields into {sigs.length} extraction tasks — verify the grouping makes sense</p>
                </div>
              </div>

              {/* Pipeline info */}
              <div className="flex items-start gap-2.5 p-2.5 rounded-lg">
                <div className="w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-zinc-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300">{decomp.pipeline?.length || 1} execution {(decomp.pipeline?.length || 1) === 1 ? 'stage' : 'stages'} planned</p>
                  <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 leading-relaxed">Groups will run {decomp.pipeline?.length === 1 ? 'in parallel' : 'across stages'} — check the order makes sense for your data</p>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            {canManage && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => onReview?.(form)}>Review schema</Button>
              <Button variant="ghost" size="sm" className="ml-auto h-8 w-8 p-0 text-gray-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400" onClick={e => { e.stopPropagation(); onDelete(form.id); }}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
            )}
          </div>
        );
      })()}

      {/* Generating progress — live activity card or shimmer fallback */}
      {isGenerating && (
        <>
          <GeneratingProgress jobId={jobId} form={form} elapsedLabel={elapsedLabel} />
          {canManage && (
          <div className="flex justify-end px-[18px] pb-3 pt-2.5 border-t border-gray-100 dark:border-[#1f1f1f]" onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-gray-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400" onClick={e => { e.stopPropagation(); onDelete(form.id); }}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          )}
        </>
      )}

      {/* Active form — context-aware card */}
      {form.status === 'active' && (() => {
        const totalExamples = pilot?.field_examples ? Object.values(pilot.field_examples as Record<string, any[]>).reduce((s: number, arr: any[]) => s + arr.length, 0) : 0;
        const fieldsCalibrated = pilot?.field_examples ? Object.keys(pilot.field_examples).length : 0;
        const fieldNames = form.fields.map((f: FormField) => f.field_name.replace(/_/g, ' ')).filter(Boolean);

        // Pilot in progress
        if (pilotStatus === 'running' || pilotStatus === 'reviewing') {
          const pilotTotal = sampleIds.length;
          const currentIter = pilot?.iterations?.[(pilot?.current_iteration || 1) - 1];
          const pilotDone = currentIter?.results ? Object.keys(currentIter.results).length : 0;
          const progressPct = pilotTotal > 0 ? Math.round((pilotDone / pilotTotal) * 100) : 0;
          const isReviewing = pilotStatus === 'reviewing';

          return (
            <div className="px-[22px] pb-3.5" onClick={e => e.stopPropagation()}>
              <div className="h-px bg-gray-100 dark:bg-[#1a1a1a] mb-3.5" />

              {/* Section label */}
              <div className="text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-500 uppercase mb-2.5">
                {isReviewing ? 'Ready for review' : 'Pilot running'}
              </div>

              {/* Running state */}
              {!isReviewing && (
                <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-gray-50 dark:bg-[#141414] mb-3.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-xs font-semibold text-gray-800 dark:text-zinc-200 truncate transition-opacity duration-300"
                      style={{ opacity: docFade ? 1 : 0 }}
                    >
                      {currentDocName || `${pilotTotal} ${pilotTotal === 1 ? 'paper' : 'papers'}`}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">
                      {pilotDone} of {pilotTotal} completed
                    </p>
                    <div className="h-1 w-full rounded-full bg-gray-200 dark:bg-[#2a2a2a] overflow-hidden mt-2">
                      <div
                        className="h-full rounded-full bg-violet-400 dark:bg-violet-500 transition-all duration-500"
                        style={{ width: `${Math.max(progressPct, pilotTotal > 0 ? 3 : 0)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Reviewing state */}
              {isReviewing && (
                <>
                  <div className="flex gap-2 mb-3.5">
                    <div className="flex-1 rounded-lg bg-[#f0f0ec] dark:bg-green-900/10 p-3 text-center">
                      <div className="text-base font-bold text-blue-600 dark:text-blue-400">{pilotDone}</div>
                      <div className="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">{pilotDone === 1 ? 'Paper' : 'Papers'} extracted</div>
                    </div>
                    <div className="flex-1 rounded-lg bg-[#f0f0ec] dark:bg-green-900/10 p-3 text-center">
                      <div className="text-base font-bold text-gray-700 dark:text-zinc-200">{form.fields.length}</div>
                      <div className="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">Total fields</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#eef5ec] dark:bg-green-900/10 mb-3.5">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 bg-[#c8e6c9] dark:bg-green-800/40">
                      <Check className="w-2.5 h-2.5 text-[#2e7d32] dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-[#1b4332] dark:text-green-300">Results are ready</p>
                      <p className="text-[11px] text-[#4a7c59] dark:text-green-400 leading-relaxed">Review extractions and provide feedback</p>
                    </div>
                  </div>
                  {fieldNames.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3.5">
                      {fieldNames.slice(0, 5).map((name: string, i: number) => (
                        <span key={i} className="text-[11px] text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-full">{name}</span>
                      ))}
                      {fieldNames.length > 5 && (
                        <span className="text-[11px] text-gray-400 dark:text-zinc-500 py-0.5">+{fieldNames.length - 5} more</span>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Actions */}
              {(canManage || canPilot) && (
              <div className="flex items-center gap-2">
                {onPilot && (
                  <Button size="sm" onClick={() => onPilot(form)}>
                    {isReviewing ? 'Review results' : 'View pilot'}
                  </Button>
                )}
                {canManage && onEditUnified && (
                  <Button variant="ghost" size="sm" onClick={() => onEditUnified(form)}>Edit form</Button>
                )}
                {canManage && (
                  <Button variant="ghost" size="sm" className="ml-auto h-8 w-8 p-0 text-gray-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400" onClick={e => { e.stopPropagation(); onDelete(form.id); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
              )}
            </div>
          );
        }

        // Pilot completed — calibrated form
        if (pilotStatus === 'completed') {
          return (
            <div className="px-[22px] pb-3.5" onClick={e => e.stopPropagation()}>
              <div className="h-px bg-gray-100 dark:bg-[#1a1a1a] mb-3.5" />

              {/* Stats row */}
              <div className="flex gap-2 mb-3.5">
                <div className="flex-1 rounded-lg bg-gray-50 dark:bg-[#141414] p-3 text-center">
                  <div className="text-base font-bold text-blue-600 dark:text-blue-400">{totalExamples}</div>
                  <div className="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">Examples</div>
                </div>
                <div className="flex-1 rounded-lg bg-gray-50 dark:bg-[#141414] p-3 text-center">
                  <div className="text-base font-bold text-gray-700 dark:text-zinc-200">{fieldsCalibrated}</div>
                  <div className="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">Fields calibrated</div>
                </div>
                <div className="flex-1 rounded-lg bg-gray-50 dark:bg-[#141414] p-3 text-center">
                  <div className="text-base font-bold text-gray-700 dark:text-zinc-200">{form.fields.length}</div>
                  <div className="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">Total fields</div>
                </div>
              </div>

              {/* Nudge if not all fields calibrated */}
              {fieldsCalibrated < form.fields.length && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50/50 dark:bg-amber-900/5 mb-3.5">
                  <AlertCircle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700/80 dark:text-amber-400/60 leading-relaxed">
                    {form.fields.length - fieldsCalibrated} fields not yet calibrated — add more examples to improve accuracy
                  </p>
                </div>
              )}

              {/* Actions */}
              {(canManage || canPilot) && (
              <div className="flex items-center gap-2">
                {onPilot && (
                  <Button size="sm" onClick={() => onPilot(form)}>Review results</Button>
                )}
                {canManage && onEditUnified && (
                  <Button variant="ghost" size="sm" onClick={() => onEditUnified(form)}>Edit form</Button>
                )}
                {canManage && (
                  <Button variant="ghost" size="sm" className="ml-auto h-8 w-8 p-0 text-gray-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400" onClick={e => { e.stopPropagation(); onDelete(form.id); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
              )}
            </div>
          );
        }

        // No pilot yet — guide the researcher
        return (
          <div className="px-[22px] pb-3.5" onClick={e => e.stopPropagation()}>
            <div className="h-px bg-gray-100 dark:bg-[#1a1a1a] mb-3.5" />

            {/* Next step guidance */}
            <div className="text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-500 uppercase mb-2.5">Next step</div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#edeee7] dark:bg-[#1e2a1e] mb-3.5">
              <Plus className="w-3.5 h-3.5 text-gray-500 dark:text-zinc-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-gray-800 dark:text-zinc-200">Run a pilot study</p>
                <p className="text-[11px] text-gray-500 dark:text-zinc-500 mt-0.5 leading-relaxed">Test extraction on a few papers and provide feedback to calibrate your fields</p>
              </div>
            </div>

            {/* Field tags */}
            {fieldNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3.5">
                {fieldNames.slice(0, 5).map((name: string, i: number) => (
                  <span key={i} className="text-[11px] text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-full">{name}</span>
                ))}
                {fieldNames.length > 5 && (
                  <span className="text-[11px] text-gray-400 dark:text-zinc-500 py-0.5">+{fieldNames.length - 5} more</span>
                )}
              </div>
            )}

            {/* Actions */}
            {(canManage || canPilot) && (
            <div className="flex items-center gap-2">
              {onPilot && (
                <Button size="sm" onClick={() => onPilot(form)}>Run pilot</Button>
              )}
              {canManage && onEditUnified && (
                <Button variant="ghost" size="sm" onClick={() => onEditUnified(form)}>Edit form</Button>
              )}
              {canManage && (
                <Button variant="ghost" size="sm" className="ml-auto h-8 w-8 p-0 text-gray-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400" onClick={e => { e.stopPropagation(); onDelete(form.id); }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            )}
          </div>
        );
      })()}

    </div>
  );
}

// Pipeline step definitions
const PIPELINE_STEPS_DIRECT = [
  'Analyzing your form',
  'Grouping related fields',
  'Building extraction rules',
  'Validating rules',
  'Finalizing',
];
const PIPELINE_STEPS_REVIEW = [
  'Analyzing your form',
  'Grouping related fields',
  'Waiting for your review',
  'Building extraction rules',
  'Validating rules',
  'Finalizing',
];

// Map backend stage names to step index (direct flow)
const STAGE_TO_STEP_DIRECT: Record<string, number> = {
  initializing: 0,
  decomposing: 1,
  generating_signatures: 2,
  generating_modules: 2,
  finalizing: 3,
  completed: 4,
};
const STAGE_TO_STEP_REVIEW: Record<string, number> = {
  initializing: 0,
  decomposing: 1,
  awaiting_review: 2,
  generating_signatures: 3,
  generating_modules: 3,
  finalizing: 4,
  completed: 5,
};

interface FieldEntry { name: string; fields: string[]; status: 'pending' | 'active' | 'done' }

function GeneratingProgress({ jobId, form, elapsedLabel }: { jobId?: string; form: Form; elapsedLabel: (d: string) => string }) {
  const queryClient = useQueryClient();
  const { selectedProject } = useProject();

  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [fieldEntries, setFieldEntries] = useState<FieldEntry[]>([]);
  const [isReviewFlow, setIsReviewFlow] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Use refs so WebSocket callbacks always see the latest values (no stale closures)
  const stageMapRef = useRef(STAGE_TO_STEP_DIRECT);
  const stepsRef = useRef(PIPELINE_STEPS_DIRECT);
  const steps = isReviewFlow ? PIPELINE_STEPS_REVIEW : PIPELINE_STEPS_DIRECT;
  useEffect(() => {
    stageMapRef.current = isReviewFlow ? STAGE_TO_STEP_REVIEW : STAGE_TO_STEP_DIRECT;
    stepsRef.current = isReviewFlow ? PIPELINE_STEPS_REVIEW : PIPELINE_STEPS_DIRECT;
  }, [isReviewFlow]);

  useEffect(() => {
    if (!jobId) return;
    const token = apiClient.getToken() || undefined;

    const ws = connectToJobLogs(jobId, {
      onStage: (msg: LogMessage) => {
        const stage = msg.stage || '';
        if (stage === 'awaiting_review') setIsReviewFlow(true);
        const step = stageMapRef.current[stage];
        if (step !== undefined) setCurrentStep(step);
      },
      onProgress: (msg: LogMessage) => {
        if (msg.progress != null) setProgress(msg.progress);
      },
      onData: (msg: LogMessage) => {
        const data = msg.data;
        if (!data) return;
        if (data._type === 'field_list') {
          setFieldEntries((data.signatures || []).map((s: any, i: number) => ({
            name: s.name,
            fields: s.fields || [],
            status: i === 0 ? 'active' as const : 'pending' as const,
          })));
        } else if (data._type === 'field_done') {
          setFieldEntries(prev => {
            const updated = [...prev];
            const idx = updated.findIndex(e => e.name === data.name);
            if (idx >= 0) {
              updated[idx] = { ...updated[idx], status: 'done' };
              // Mark next pending entry as active
              if (idx + 1 < updated.length && updated[idx + 1].status === 'pending') {
                updated[idx + 1] = { ...updated[idx + 1], status: 'active' };
              }
            }
            return updated;
          });
        }
      },
      onComplete: () => {
        setCurrentStep(stepsRef.current.length - 1);
        setProgress(100);
        setCompleted(true);
        queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
      },
    }, token);

    return () => ws.close();
  }, [jobId]);

  // Fallback: no jobId (page refreshed) — show simple shimmer
  if (!jobId) {
    return (
      <div className="px-[22px] pb-3.5">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse shrink-0" />
          <span className="text-xs text-violet-600 dark:text-violet-400 font-medium">
            {form.status === 'regenerating' ? 'Regenerating code…' : 'Generating code…'}
          </span>
          <span className="text-xs text-gray-400 dark:text-zinc-500 ml-auto shrink-0">{elapsedLabel(form.updated_at)}</span>
        </div>
        <div className="h-[3px] w-full rounded-full bg-violet-100 dark:bg-violet-900/30 overflow-hidden">
          <div className="h-full w-full rounded-full bg-gradient-to-r from-violet-400 via-purple-400 to-violet-400 animate-[shimmer_2s_linear_infinite]" style={{ backgroundSize: '200% 100%' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="px-[22px] pb-3.5">
      {/* Divider */}
      <div className="h-px bg-gray-100 dark:bg-[#1a1a1a] mb-3" />

      {/* Two column layout */}
      <div className="flex gap-5 min-h-0">
        {/* Left: Pipeline */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-500 uppercase mb-2">Pipeline</div>
          <div className="space-y-1">
            {steps.map((label, i) => {
              const isDone = completed || i < currentStep;
              const isActive = !completed && i === currentStep;
              const isPending = !completed && i > currentStep;
              const isReviewStep = isReviewFlow && i === 2;

              return (
                <div key={i} className="flex items-center gap-2 py-0.5">
                  {isDone && <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
                  {isActive && !isReviewStep && <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse shrink-0" />}
                  {isActive && isReviewStep && <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                  {isPending && <div className="w-1.5 h-1.5 rounded-full bg-gray-200 dark:bg-zinc-700 shrink-0" />}
                  <span className={cn(
                    "text-xs leading-tight",
                    isDone && "text-gray-700 dark:text-zinc-300",
                    isActive && !isReviewStep && "text-violet-600 dark:text-violet-400 font-medium",
                    isActive && isReviewStep && "text-amber-600 dark:text-amber-400 font-medium",
                    isPending && "text-gray-300 dark:text-zinc-600",
                  )}>
                    {label}{isActive ? '…' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Field groups being built */}
        {fieldEntries.length > 0 && (
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-500 uppercase mb-2">
              Groups <span className="normal-case tracking-normal font-normal">{fieldEntries.filter(f => f.status === 'done').length}/{fieldEntries.length}</span>
            </div>
            <div className="space-y-1">
              {fieldEntries.map((entry, i) => {
                // Convert PascalCase to readable: "ClassifyStudySetting" → "Classify Study Setting"
                const readable = entry.name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
                return (
                  <div key={i} className={cn(
                    "flex items-center gap-2 py-1 px-2 rounded-md text-xs",
                    entry.status === 'done' && "bg-green-50 dark:bg-green-900/10",
                    entry.status === 'active' && "bg-violet-50 dark:bg-violet-900/10",
                    entry.status === 'pending' && "bg-gray-50 dark:bg-[#141414]",
                  )}>
                    {entry.status === 'done' && <Check className="w-3 h-3 text-green-500 shrink-0" />}
                    {entry.status === 'active' && <div className="w-3 h-3 shrink-0 flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" /></div>}
                    {entry.status === 'pending' && <div className="w-3 h-3 shrink-0" />}
                    <span className={cn(
                      "flex-1 min-w-0",
                      entry.status === 'done' && "text-gray-700 dark:text-zinc-300",
                      entry.status === 'active' && "text-violet-600 dark:text-violet-400",
                      entry.status === 'pending' && "text-gray-300 dark:text-zinc-600",
                    )}>{readable}</span>
                    <span className="text-[10px] text-gray-300 dark:text-zinc-600 shrink-0 whitespace-nowrap">{entry.fields.length}f</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer: progress bar + step indicator */}
      <div className="mt-3">
        <div className="h-[3px] w-full rounded-full bg-gray-100 dark:bg-[#1a1a1a] overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-700 ease-out", completed ? "bg-green-500" : "bg-violet-500")}
            style={{ width: `${Math.max(progress, 3)}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className={cn("text-[10px]", completed ? "text-green-600 dark:text-green-400 font-medium" : "text-gray-400 dark:text-zinc-500")}>
            {completed ? 'Complete! Ready for extraction.' : `Step ${Math.min(currentStep + 1, steps.length)} of ${steps.length} · ${elapsedLabel(form.updated_at)}`}
          </span>
        </div>
      </div>
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  text:     "Text",
  number:   "Number",
  select:   "Select",
  boolean:  "Yes / No",
  array:    "Table",
};

const FIELD_TYPE_COLORS: Record<string, { bg: string; border: string; text: string; sidebar: string }> = {
  text:    { bg: "#f0f3f8", border: "#d0d8e8", text: "#4a6085", sidebar: "#c4d0e4" },
  number:  { bg: "#f0f5f0", border: "#c8dcc8", text: "#3d6b4e", sidebar: "#b8d4be" },
  select:  { bg: "#f3f0f8", border: "#d4cce8", text: "#605085", sidebar: "#c4b8dc" },
  boolean: { bg: "#f8f0f3", border: "#e8c8d4", text: "#854a60", sidebar: "#d8b0c0" },
  array:   { bg: "#f5f3ee", border: "#dcd4c0", text: "#6b5a3d", sidebar: "#ccc4a8" },
};

const TYPE_ALIASES: Record<string, string> = {
  // canonical types
  "text":             "text",
  "number":           "number",
  "select":           "select",
  "boolean":          "boolean",
  "array":            "array",
  // human-friendly labels
  "multiple choice":  "select",
  "table / list":     "array",
  "table":            "array",
  // legacy aliases (enum → select)
  "enum":             "select",
  "dropdown":         "select",
  "multiple_choice":  "select",
  "multiselect":      "select",
  "multi_select":     "select",
  // other aliases
  "structured object":"array",
  "object":           "array",
  text_long:          "text",
  long_text:          "text",
  list:               "array",
  integer:            "number",
  float:              "number",
  decimal:            "number",
};

// ─── Recursive field helpers (walk subform_fields for table fields) ───

const aliasFieldType = (t: any): string => {
  const raw = (t || 'text').toString().toLowerCase().trim();
  return TYPE_ALIASES[raw] ?? raw;
};

const aliasFieldTypeRec = (f: FormField): FormField => ({
  ...f,
  field_type: aliasFieldType(f.field_type),
  ...(Array.isArray(f.subform_fields) ? { subform_fields: f.subform_fields.map(aliasFieldTypeRec) } : {}),
});

const importJsonFieldRec = (f: any): FormField => {
  const rawType = (f.field_type || f.type || '').toString().toLowerCase().trim();
  const inferredMultiple = rawType === 'multiselect' || rawType === 'multi_select';
  return ({
  field_name: f.field_name || f.name || '',
  field_type: aliasFieldType(f.field_type || f.type),
  field_description: f.field_description || f.description || '',
  example: f.example != null ? String(f.example) : '',
  ...(f.options ? { options: f.options } : {}),
  ...(f.extraction_hints ? { extraction_hints: f.extraction_hints } : {}),
  ...(f.display_name ? { display_name: f.display_name } : {}),
  ...(f.field_control_type ? { field_control_type: f.field_control_type } : {}),
  ...(f.multiple != null || inferredMultiple ? { multiple: f.multiple || inferredMultiple } : {}),
  ...(f.required != null ? { required: f.required } : {}),
  ...(Array.isArray(f.hints) ? { hints: f.hints } : {}),
  ...(Array.isArray(f.rules) ? { rules: f.rules } : {}),
  ...(Array.isArray(f.examples) ? { examples: f.examples } : f.example != null ? { examples: [{ value: String(f.example), source_text: '' }] } : {}),
  ...(Array.isArray(f.subform_fields) ? { subform_fields: f.subform_fields.map(importJsonFieldRec) } : {}),
  });
};

const sanitizeNameForApi = (name: string): string =>
  (name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_{2,}/g, '_').replace(/^(\d)/, '_$1');

const sanitizeFieldDeep = (f: FormField): FormField => ({
  ...f,
  field_name: sanitizeNameForApi(f.field_name),
  ...(f.field_type === 'select' && f.options ? { options: f.options.filter(o => o.trim()) } : {}),
  ...(Array.isArray(f.subform_fields) ? { subform_fields: f.subform_fields.map(sanitizeFieldDeep) } : {}),
});

const validateFieldRec = (f: FormField, parentPath = ''): string | null => {
  const here = parentPath ? `${parentPath} → ${f.field_name || '(unnamed)'}` : (f.field_name || '(unnamed)');
  if (!(f.field_name || '').trim()) return `Field "${here}" needs a name`;
  if (!(f.field_description || '').trim()) return `Field "${here}" needs a description`;
  if (f.field_type === 'select') {
    const opts = (f.options || []).filter(o => o.trim());
    if (opts.length === 0) return `Select field "${here}" needs at least one option`;
  }
  if (f.field_type === 'array') {
    const subs = f.subform_fields || [];
    if (subs.length === 0) return `Table "${here}" needs at least one column`;
    const seen = new Set<string>();
    for (const sub of subs) {
      const key = sanitizeNameForApi(sub.field_name);
      if (key && seen.has(key)) return `Table "${here}" has duplicate column "${sub.field_name}"`;
      if (key) seen.add(key);
      const childErr = validateFieldRec(sub, here);
      if (childErr) return childErr;
    }
  }
  return null;
};

const serializeFieldForCopy = (f: FormField): any => ({
  field_name: f.field_name,
  field_type: f.field_type,
  field_description: f.field_description,
  ...(f.example ? { example: f.example } : {}),
  ...(f.options ? { options: f.options } : {}),
  ...(f.extraction_hints ? { extraction_hints: f.extraction_hints } : {}),
  ...(f.display_name ? { display_name: f.display_name } : {}),
  ...(f.field_control_type ? { field_control_type: f.field_control_type } : {}),
  ...(f.multiple != null ? { multiple: f.multiple } : {}),
  ...(f.required != null ? { required: f.required } : {}),
  ...((f as any).hints?.length ? { hints: (f as any).hints } : {}),
  ...((f as any).rules?.length ? { rules: (f as any).rules } : {}),
  ...((f as any).examples?.length ? { examples: (f as any).examples } : {}),
  ...(f.field_type === 'array'
    ? { subform_fields: (f.subform_fields || []).map(serializeFieldForCopy) }
    : (f.subform_fields?.length ? { subform_fields: f.subform_fields.map(serializeFieldForCopy) } : {})),
});

// Unified Form Dialog Component
function FormDialog({
  form,
  existingForms,
  canManage,
  onClose,
  onSuccess,
  onUpdate,
  onGenerateCode,
  onDelete,
  onOpenInstructions,
}: {
  form: Form;
  existingForms: Form[];
  canManage: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onUpdate: (formId: string, data: Partial<CreateFormRequest>) => Promise<void>;
  onGenerateCode: (formId: string, enableReview?: boolean) => void;
  onDelete: (formId: string) => void;
  onOpenInstructions?: (form: Form) => void;
}) {
  const { toast } = useToast();

  // Local editable state
  const [formName, setFormName] = useState(form.form_name);
  const [formDescription, setFormDescription] = useState(form.form_description || '');
  const [fields, setFields] = useState<FormField[]>(form.fields.map(aliasFieldTypeRec));
  const [enableReview, setEnableReview] = useState<boolean>(form.metadata?.enable_review ?? false);
  const [saving, setSaving] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);

  // Inline editing
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);

  // View switching
  const metadata = useMemo(() => typeof form.metadata === 'string' ? JSON.parse(form.metadata) : form.metadata, [form.metadata]);
  const pipeline = useMemo(() => metadata?.decomposition?.pipeline || [], [metadata]);
  const signatures = metadata?.decomposition?.signatures || [];
  // Fields view state
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const [fieldSearch, setFieldSearch] = useState('');
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const isStatusEditable = form.status === 'draft' || form.status === 'active' || form.status === 'failed';
  const isEditable = isStatusEditable && canManage;

  const hasChanges = () => {
    return formName !== form.form_name ||
      formDescription !== (form.form_description || '') ||
      JSON.stringify(fields) !== JSON.stringify(form.fields.map(aliasFieldTypeRec)) ||
      enableReview !== (form.metadata?.enable_review ?? false);
  };

  const hasFieldChanges = () => JSON.stringify(fields) !== JSON.stringify(form.fields.map(aliasFieldTypeRec));

  // Field helpers
  const toggle = (i: number) => {
    setOpenSet(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; });
  };
  const toggleAll = () => {
    if (openSet.size === fields.length) setOpenSet(new Set());
    else setOpenSet(new Set(fields.map((_, i) => i)));
  };
  const addField = () => {
    const newFields = [...fields, { field_name: '', field_type: 'text', field_description: '', example: '' }];
    setFields(newFields);
    setOpenSet(new Set([...openSet, newFields.length - 1]));
    setTimeout(() => setFocusIndex(newFields.length - 1), 100);
  };
  const removeField = (index: number) => setFields(fields.filter((_, i) => i !== index));
  const updateField = (index: number, updates: Partial<FormField>) => {
    const updatedField = { ...fields[index], ...updates };
    if (updates.field_type === 'select' && !updatedField.options) updatedField.options = [''];
    if (updates.field_type && updates.field_type !== 'select') delete updatedField.options;
    setFields(fields.map((field, i) => (i === index ? updatedField : field)));
  };
  const addOption = (fi: number) => updateField(fi, { options: [...(fields[fi].options || []), ''] });
  const removeOption = (fi: number, oi: number) => updateField(fi, { options: (fields[fi].options || []).filter((_, i) => i !== oi) });
  const updateOption = (fi: number, oi: number, value: string) => {
    const opts = [...(fields[fi].options || [])]; opts[oi] = value; updateField(fi, { options: opts });
  };
  const sanitizeFieldName = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_{2,}/g, '_').replace(/^(\d)/, '_$1');
  const addSubfield = (fi: number) => updateField(fi, { subform_fields: [...(fields[fi].subform_fields || []), { field_name: '', field_type: 'text', field_description: '' }] });
  const removeSubfield = (fi: number, si: number) => updateField(fi, { subform_fields: (fields[fi].subform_fields || []).filter((_: any, i: number) => i !== si) });
  const updateSubfield = (fi: number, si: number, updates: Partial<FormField>) => {
    const subs = [...(fields[fi].subform_fields || [])];
    subs[si] = { ...subs[si], ...updates };
    updateField(fi, { subform_fields: subs });
  };

  const handleClose = () => {
    if (canManage && hasChanges() && !confirm('You have unsaved changes. Discard?')) return;
    onClose();
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete "${form.form_name}"?`)) { onDelete(form.id); onClose(); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) { toast({ title: 'Validation', description: 'Please enter a form name', variant: 'error' }); return; }
    const duplicate = existingForms.some(f => f.id !== form.id && f.form_name.trim().toLowerCase() === formName.trim().toLowerCase());
    if (duplicate) { toast({ title: 'Duplicate name', description: `A form named "${formName.trim()}" already exists.`, variant: 'error' }); return; }
    if (!formDescription.trim()) { toast({ title: 'Validation', description: 'Please enter a form description', variant: 'error' }); return; }
    if (formDescription.length < 10) { toast({ title: 'Validation', description: 'Description must be at least 10 characters', variant: 'error' }); return; }
    if (fields.length === 0) { toast({ title: 'Validation', description: 'Please add at least one field', variant: 'error' }); return; }
    for (const field of fields) {
      const err = validateFieldRec(field);
      if (err) { toast({ title: 'Validation', description: err, variant: 'error' }); return; }
    }
    setSaving(true);
    try {
      const sanitizedFields = fields.map(sanitizeFieldDeep);
      await onUpdate(form.id, { form_name: formName, form_description: formDescription, fields: sanitizedFields, enable_review: enableReview });
      if (hasFieldChanges() && form.status === 'active') {
        await onGenerateCode(form.id, enableReview);
        toast({ title: 'Regenerating', description: 'Fields changed — code regeneration started.', variant: 'success' });
      } else {
        toast({ title: 'Success', description: 'Form updated successfully', variant: 'success' });
      }
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Error', description: getErrorMessage(err, 'Failed to update form'), variant: 'error' });
    } finally { setSaving(false); }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setFocusIndex(p => Math.min(p + 1, fields.length - 1)); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setFocusIndex(p => Math.max(p - 1, 0)); }
      else if ((e.key === 'Enter' || e.key === ' ') && tag !== 'BUTTON') { e.preventDefault(); toggle(focusIndex); }
      else if (e.key === 'Escape') { handleClose(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [focusIndex, fields.length]);

  useEffect(() => { rowRefs.current[focusIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focusIndex]);

  const statusBadgeVariant: Record<string, string> = {
    draft: 'default', generating: 'processing', awaiting_review: 'warning',
    regenerating: 'processing', active: 'success', failed: 'error',
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {editingName && isEditable ? (
                <input
                  autoFocus
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  onBlur={() => setEditingName(false)}
                  onKeyDown={e => e.key === 'Enter' && setEditingName(false)}
                  className="text-base font-semibold text-gray-900 dark:text-white tracking-tight bg-transparent border-b border-gray-300 dark:border-zinc-600 outline-none py-0.5 flex-1 min-w-0"
                />
              ) : (
                <h2
                  className={cn("text-base font-semibold text-gray-900 dark:text-white tracking-tight truncate", isEditable && "cursor-pointer hover:text-gray-600 dark:hover:text-zinc-300")}
                  onClick={() => isEditable && setEditingName(true)}
                >{formName}</h2>
              )}
              <Badge variant={(statusBadgeVariant[form.status] || 'default') as any}>{form.status === 'awaiting_review' ? 'Review' : form.status.charAt(0).toUpperCase() + form.status.slice(1)}</Badge>
            </div>
            <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8 shrink-0">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {editingDescription && isEditable ? (
            <textarea
              autoFocus
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              onBlur={() => setEditingDescription(false)}
              rows={2}
              className="w-full text-sm text-gray-500 dark:text-zinc-400 bg-transparent border-b border-gray-300 dark:border-zinc-600 outline-none leading-relaxed resize-none mt-1"
            />
          ) : (
            <p
              className={cn("text-sm text-gray-400 dark:text-zinc-500 leading-relaxed mt-1 line-clamp-3", isEditable && "cursor-pointer hover:text-gray-600 dark:hover:text-zinc-300")}
              onClick={() => isEditable && setEditingDescription(true)}
              title={formDescription || undefined}
            >{formDescription || 'No description — click to add'}</p>
          )}
          {formDescription.length > 0 && formDescription.length < 10 && (
            <p className="text-[11px] text-amber-500 mt-1">{formDescription.length}/10 chars min</p>
          )}
          <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-1 leading-relaxed">
            Describe what this form extracts in plain English — topic, data points to capture, and any scope limits. The AI uses this to generate fields, hints, and rules, so be specific.
          </p>
        </div>

        {/* Metadata bar */}
        <div className="px-6 pb-3 flex-shrink-0">
          <div className="flex items-center gap-4 text-sm text-gray-400 dark:text-zinc-500">
            <span><span className="font-semibold text-gray-700 dark:text-zinc-300">{fields.length}</span> field{fields.length !== 1 ? 's' : ''}</span>
            <span className="text-gray-200 dark:text-zinc-700">·</span>
            <span>{formatDate(form.created_at)}</span>
            {isEditable && (
              <>
                <span className="text-gray-200 dark:text-zinc-700">·</span>
                <button
                  type="button"
                  onClick={() => setEnableReview(!enableReview)}
                  className={cn("text-xs bg-transparent border-none cursor-pointer p-0 transition-colors", enableReview ? "text-amber-500 font-semibold" : "text-gray-400 dark:text-zinc-500 hover:text-gray-600")}
                >
                  Human Review: {enableReview ? 'ON' : 'OFF'}
                </button>
              </>
            )}
            {hasChanges() && canManage && <span className="text-amber-500 text-xs font-medium ml-auto">unsaved</span>}
          </div>
        </div>



        {/* Regen warning banner */}
        {(form.status === 'active' || form.status === 'failed') && (
          <div className="mx-6 mt-1 flex items-start gap-3 p-3 rounded-lg bg-red-50/70 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 dark:text-red-400 shrink-0 mt-0.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                {form.status === 'failed' ? 'Changes here will retry the extractor build' : 'Changes here will rebuild the extractor'}
              </p>
              <p className="text-[11px] text-red-700/85 dark:text-red-300/85 leading-relaxed mt-1">
                Adding, renaming, retyping, or removing fields rebuilds the extractor from scratch (about 2 minutes). Any feedback you gave during pilot testing will be erased.
              </p>
            </div>
          </div>
        )}

        {/* Error banner */}
        {form.error && (
          <div className="mx-6 mt-3 flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
            <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">{form.error}</p>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 flex flex-col min-h-0 border-t border-gray-100 dark:border-[#1a1a1a] mt-3">

          {/* === FIELDS VIEW === */}
          <form id="edit-form-body" onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                {/* Toolbar */}
                <div className="flex items-center gap-3 px-6 py-3 flex-shrink-0">
                  <div className="relative flex-1">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 dark:text-zinc-600 pointer-events-none"><circle cx="7" cy="7" r="5"/><path d="M12 12l-2.5-2.5"/></svg>
                    <input
                      type="text"
                      placeholder={`Search ${fields.length} fields…`}
                      value={fieldSearch}
                      onChange={e => setFieldSearch(e.target.value)}
                      className="w-full text-xs text-gray-700 dark:text-zinc-300 bg-transparent border-none outline-none py-1.5 pl-8 pr-3"
                    />
                  </div>
                  <span className="text-xs text-gray-400 dark:text-zinc-500 shrink-0">
                    {fields.filter(f => f.field_name.trim()).length}/{fields.length} named
                  </span>
                  <button type="button" onClick={toggleAll} className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 bg-transparent border-none cursor-pointer p-0 transition-colors shrink-0">
                    {openSet.size === fields.length ? 'Collapse all' : 'Expand all'}
                  </button>
                </div>

                {/* Field list */}
                <div className="flex-1 overflow-y-auto px-6 pb-3">
                  {fields.map((field, idx) => {
                    const isOpen = openSet.has(idx);
                    const isFocused = focusIndex === idx;
                    const tc = FIELD_TYPE_COLORS[field.field_type] || FIELD_TYPE_COLORS.text;
                    const matchesSearch = !fieldSearch.trim() ||
                      field.field_name.toLowerCase().includes(fieldSearch.toLowerCase()) ||
                      field.field_description.toLowerCase().includes(fieldSearch.toLowerCase());
                    if (!matchesSearch) return null;
                    return (
                      <div key={idx} ref={el => { rowRefs.current[idx] = el; }}>
                        {/* Collapsed row */}
                        <div
                          className={cn(
                            "flex items-center gap-3 py-2.5 px-2 cursor-pointer rounded-lg transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]",
                            isFocused && "bg-black/[0.02] dark:bg-white/[0.02]"
                          )}
                          onClick={() => { setFocusIndex(idx); toggle(idx); }}
                        >
                          <div className="w-2 h-2 rounded-full shrink-0 transition-opacity" style={{ background: tc.text, opacity: isOpen ? 0.7 : 0.3 }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={cn("text-sm truncate", isOpen ? "font-semibold text-gray-900 dark:text-white" : field.field_name.trim() ? "font-medium text-gray-600 dark:text-zinc-300" : "font-medium text-gray-300 dark:text-zinc-600")}>{field.field_name.trim() || `field_${idx + 1}`}</span>
                              <span className="text-xs font-medium py-0.5 px-2 rounded-[5px] tracking-tight shrink-0 text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]">{TYPE_LABELS[field.field_type] ?? field.field_type}</span>
                              {field.field_type === 'select' && field.options && field.options.filter((o: string) => o.trim()).length > 0 && (
                                <span className="text-xs text-gray-300 dark:text-zinc-600">{field.options.filter((o: string) => o.trim()).length} opts</span>
                              )}
                            </div>
                            {!isOpen && field.field_description.trim() && (
                              <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 truncate">{field.field_description}</div>
                            )}
                          </div>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 transition-transform duration-200 text-gray-300 dark:text-zinc-600" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>
                            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>

                        {/* Expanded content */}
                        {isOpen && (
                          <div className="ml-4 mb-2 pl-4 py-3 border-l-2" style={{ borderLeftColor: tc.border }}>
                            {isEditable ? (
                              <>
                                <div className="flex gap-3 mb-3">
                                  <div className="flex-1">
                                    <label className="text-xs text-gray-400 dark:text-zinc-600 block mb-1">Name</label>
                                    <input value={field.field_name} onChange={e => updateField(idx, { field_name: e.target.value })} placeholder="field_name" onClick={e => e.stopPropagation()} className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none transition-colors focus:border-gray-400 dark:focus:border-[#3f3f3f]" />
                                  </div>
                                  <div className="w-[130px] shrink-0">
                                    <label className="text-xs text-gray-400 dark:text-zinc-600 block mb-1">Type</label>
                                    <select value={field.field_type} onChange={e => updateField(idx, { field_type: e.target.value })} onClick={e => e.stopPropagation()} className="w-full text-sm font-medium rounded-md py-2 pr-7 pl-3 outline-none cursor-pointer appearance-none text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] dark:[color-scheme:dark]">
                                      {Object.keys(FIELD_TYPE_COLORS).map(t => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
                                    </select>
                                  </div>
                                </div>
                                {field.field_type === 'select' && (
                                  <div className="mb-3">
                                    <label className="text-xs text-gray-400 dark:text-zinc-600 block mb-1">Options</label>
                                    <div className="flex flex-wrap gap-1.5">
                                      {(field.options || ['']).map((opt: string, oi: number) => (
                                        <div key={oi} className="flex items-center relative">
                                          <input value={opt} onChange={e => updateOption(idx, oi, e.target.value)} placeholder={`option ${oi + 1}`} onClick={e => e.stopPropagation()} className="text-xs text-gray-600 dark:text-zinc-300 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-1.5 pr-6 pl-2.5 outline-none w-[120px]" style={{ borderLeft: `2.5px solid ${tc.text}60` }} />
                                          {(field.options?.length || 0) > 1 && (
                                            <button type="button" onClick={e => { e.stopPropagation(); removeOption(idx, oi); }} className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-300 p-0.5 hover:text-red-500 transition-colors">
                                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                      <button type="button" onClick={e => { e.stopPropagation(); addOption(idx); }} className="text-xs bg-transparent rounded-md py-1.5 px-3 cursor-pointer transition-colors" style={{ color: `${tc.text}80`, border: `1px dashed ${tc.text}30` }}>+ add</button>
                                    </div>
                                    <label className="flex items-center gap-2 mt-2 cursor-pointer" onClick={e => e.stopPropagation()}>
                                      <input type="checkbox" checked={field.multiple ?? false} onChange={e => updateField(idx, { multiple: e.target.checked })} className="w-3.5 h-3.5 rounded border-gray-300 dark:border-zinc-600 accent-violet-500" />
                                      <span className="text-xs text-gray-500 dark:text-zinc-400">Allow multiple selections</span>
                                    </label>
                                  </div>
                                )}
                                <div className="mb-3">
                                  <label className="text-xs text-gray-400 dark:text-zinc-600 block mb-1">Description</label>
                                  <textarea value={field.field_description} onChange={e => updateField(idx, { field_description: e.target.value })} placeholder="What to extract..." rows={2} onClick={e => e.stopPropagation()} className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none leading-relaxed resize-none transition-colors focus:border-gray-400 dark:focus:border-[#3f3f3f]" />
                                </div>
                                {field.field_type === 'array' && (
                                  <div className="mb-3">
                                    <div className="flex items-center justify-between mb-1">
                                      <label className="text-xs text-gray-400 dark:text-zinc-600">Subfields</label>
                                      <button type="button" onClick={e => { e.stopPropagation(); addSubfield(idx); }} className="text-[11px] text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer p-0 transition-colors">+ add</button>
                                    </div>
                                    {(field.subform_fields || []).map((sf: FormField, si: number) => (
                                      <div key={si} className="mb-2 group" onClick={e => e.stopPropagation()}>
                                        <div className="flex items-center gap-1.5">
                                          <div className="w-1 h-1 rounded-full bg-gray-300 dark:bg-zinc-700 shrink-0" />
                                          <input value={sf.field_name} onChange={e => updateSubfield(idx, si, { field_name: e.target.value })} placeholder="name" className="flex-1 text-xs font-mono text-gray-600 dark:text-zinc-300 bg-transparent border-none outline-none py-0.5 focus:bg-gray-50 dark:focus:bg-[#0d0d0d] focus:px-1.5 focus:rounded transition-all" />
                                          <select value={sf.field_type} onChange={e => updateSubfield(idx, si, { field_type: e.target.value })} onClick={e => e.stopPropagation()} className="text-[11px] text-gray-400 bg-transparent border-none outline-none cursor-pointer appearance-none dark:[color-scheme:dark]">
                                            {Object.keys(FIELD_TYPE_COLORS).filter(t => t !== 'array').map(t => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
                                          </select>
                                          <button type="button" onClick={e => { e.stopPropagation(); removeSubfield(idx, si); }} className="bg-transparent border-none cursor-pointer text-gray-300 dark:text-zinc-700 p-0 hover:text-red-500 transition-colors shrink-0 opacity-0 group-hover:opacity-100">
                                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                          </button>
                                        </div>
                                        <textarea value={sf.field_description} onChange={e => updateSubfield(idx, si, { field_description: e.target.value })} placeholder="Description..." rows={2} onClick={e => e.stopPropagation()} className="w-full ml-2.5 mt-0.5 text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-1.5 px-2 outline-none resize-none leading-relaxed transition-colors focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-300 dark:placeholder:text-zinc-600" />
                                      </div>
                                    ))}
                                    {(field.subform_fields || []).length === 0 && (
                                      <p className="text-[11px] text-gray-300 dark:text-zinc-700">No subfields yet</p>
                                    )}
                                  </div>
                                )}
                                <div className="mb-3">
                                  <label className="text-xs text-gray-400 dark:text-zinc-600 block mb-1">Example <span className="text-gray-300 dark:text-zinc-600">optional</span></label>
                                  <input value={field.example || ''} onChange={e => updateField(idx, { example: e.target.value })} placeholder='"18-65 years"' onClick={e => e.stopPropagation()} className="w-full text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none transition-colors focus:border-gray-400 dark:focus:border-[#3f3f3f]" />
                                </div>
                                {fields.length > 1 && (
                                  <button type="button" onClick={e => { e.stopPropagation(); removeField(idx); }} className="text-xs text-gray-300 dark:text-zinc-600 bg-transparent border-none cursor-pointer py-1 flex items-center gap-1 transition-colors hover:text-red-500">
                                    <Trash2 className="w-3 h-3" /> Remove
                                  </button>
                                )}
                              </>
                            ) : (
                              <>
                                <p className="text-sm text-gray-500 dark:text-zinc-400 leading-relaxed mb-3">{field.field_description}</p>
                                {field.example && (
                                  <div className="mb-3">
                                    <span className="text-xs text-gray-300 dark:text-zinc-600">Example</span>
                                    <div className="text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border-l-2 border-l-gray-200 dark:border-l-[#2a2a2a] rounded-md p-3 mt-1">{field.example}</div>
                                  </div>
                                )}
                                {field.field_type === 'select' && field.options && field.options.length > 0 && (
                                  <div>
                                    <span className="text-xs text-gray-300 dark:text-zinc-600">Options ({field.options.length})</span>
                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                      {field.options.map((opt: string, oi: number) => (
                                        <span key={oi} className="text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] py-0.5 px-2 rounded-md">{opt}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {field.field_type === 'array' && (field.subform_fields || []).length > 0 && (
                                  <div>
                                    <span className="text-xs text-gray-300 dark:text-zinc-600">Subfields ({field.subform_fields!.length})</span>
                                    <div className="flex flex-col gap-1.5 mt-1.5">
                                      {field.subform_fields!.map((sf: FormField, si: number) => (
                                        <div key={si}>
                                          <div className="flex items-center gap-2">
                                            <div className="w-1 h-1 rounded-full bg-gray-300 dark:bg-zinc-700 shrink-0" />
                                            <span className="text-xs font-mono text-gray-600 dark:text-zinc-300">{sf.field_name}</span>
                                            <span className="text-[11px] text-gray-300 dark:text-zinc-600">{TYPE_LABELS[sf.field_type] ?? sf.field_type}</span>
                                          </div>
                                          {sf.field_description && (
                                            <p className="text-[11px] text-gray-400 dark:text-zinc-500 ml-3 mt-0.5 leading-relaxed">{sf.field_description}</p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add field */}
                  {isEditable && (
                    <div onClick={addField} className="flex items-center justify-center gap-1.5 p-3 border border-dashed border-gray-200 dark:border-[#2a2a2a] rounded-lg cursor-pointer mt-2 text-gray-300 dark:text-zinc-600 text-sm transition-colors hover:border-gray-400 dark:hover:border-[#3f3f3f] hover:text-gray-500 dark:hover:text-zinc-400">
                      <Plus className="w-3.5 h-3.5" /> Add field
                    </div>
                  )}
                </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-[#1a1a1a] rounded-b-2xl flex-shrink-0">
          <div className="flex items-center gap-1">
            {isEditable && (
              <Button variant="ghost" size="sm" onClick={handleDelete} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300"
              onClick={() => {
                const json = JSON.stringify({
                  form_name: formName,
                  form_description: formDescription,
                  fields: fields.map(serializeFieldForCopy),
                }, null, 2);
                navigator.clipboard.writeText(json);
                setJsonCopied(true);
                setTimeout(() => setJsonCopied(false), 2000);
              }}
            >
              {jsonCopied ? <ClipboardCheck className="w-3.5 h-3.5 mr-1" /> : <Clipboard className="w-3.5 h-3.5 mr-1" />}
              {jsonCopied ? 'Copied!' : 'Copy JSON'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300"
              onClick={() => {
                const json = JSON.stringify({ form_name: formName, form_description: formDescription, fields: fields.map(serializeFieldForCopy) }, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${formName.replace(/\s+/g, '_').toLowerCase()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              Download JSON
            </Button>
          </div>
          <div className="flex gap-2">
            {form.status === 'draft' && (
              <>
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving}>Close</Button>
                {isEditable && hasChanges() && (
                  <Button variant="secondary" size="sm" type="submit" form="edit-form-body" loading={saving}>Update Form</Button>
                )}
                {canManage && (
                  <Button size="sm" onClick={() => { if (hasChanges()) { handleSubmit({ preventDefault: () => {} } as any).then(() => {}); } else { onGenerateCode(form.id, enableReview); onClose(); } }}>Generate Code</Button>
                )}
              </>
            )}
            {form.status === 'active' && (!hasChanges() || !canManage) && (
              <Button variant="ghost" size="sm" onClick={handleClose}>Close</Button>
            )}
            {form.status === 'active' && hasChanges() && canManage && (
              <>
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving}>Cancel</Button>
                <Button size="sm" type="submit" form="edit-form-body" loading={saving}>
                  {hasFieldChanges() ? 'Save & Generate' : 'Update Form'}
                </Button>
              </>
            )}
            {form.status === 'failed' && (
              <>
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving}>Cancel</Button>
                {hasChanges() && <Button variant="secondary" size="sm" type="submit" form="edit-form-body" loading={saving}>Save</Button>}
                {canManage && (
                  <Button size="sm" onClick={() => { onGenerateCode(form.id, enableReview); onClose(); }}>Retry</Button>
                )}
              </>
            )}
            {(form.status === 'generating' || form.status === 'regenerating' || form.status === 'awaiting_review') && (
              <Button variant="ghost" size="sm" onClick={handleClose}>Close</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Create Form Dialog Component
function CreateFormDialog({
  projectId,
  existingForms,
  onClose,
  onSuccess,
}: {
  projectId: string;
  existingForms: Form[];
  onClose: () => void;
  onSuccess: (form: Form, launchTest?: boolean) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form-level state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [enableReview, setEnableReview] = useState(false);

  // Field state
  const blankCal = (): UEFCalField => ({ description: '', hints: [], rules: [], examples: [] });
  const [fields, setFields] = useState<UEFEditableField[]>([
    { field_name: '', field_type: 'text', field_description: '', _isNew: true },
  ]);
  const [calState, setCalState] = useState<Record<string, UEFCalField>>({ '': blankCal() });
  const [selectedIdx, setSelectedIdx] = useState(0);

  // JSON import panel
  const [showJsonPanel, setShowJsonPanel] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [jsonError, setJsonError] = useState('');

  // Saving
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingBuild, setSavingBuild] = useState(false);
  const saving = savingDraft || savingBuild;

  // ── Inline validation ────────────────────────────────────────────────────────
  const nameError = useMemo(() => {
    if (!formName.trim()) return null;
    const dupe = existingForms.some(f => f.form_name.trim().toLowerCase() === formName.trim().toLowerCase());
    return dupe ? `A form named "${formName.trim()}" already exists.` : null;
  }, [formName, existingForms]);

  const isValid = useMemo(() => {
    if (!formName.trim() || nameError) return false;
    if (!formDescription.trim() || formDescription.length < 10) return false;
    if (fields.length === 0) return false;
    for (const f of fields) {
      const effectiveDesc = calState[f.field_name]?.description || f.field_description || '';
      if (validateFieldRec({ ...f, field_description: effectiveDesc })) return false;
    }
    return true;
  }, [formName, nameError, formDescription, fields, calState]);

  // ── Field helpers ─────────────────────────────────────────────────────────────
  const addField = () => {
    setFields(prev => [...prev, { field_name: '', field_type: 'text', field_description: '', _isNew: true }]);
    setCalState(prev => ({ ...prev, '': prev[''] ?? blankCal() }));
    setSelectedIdx(fields.length);
  };

  const removeField = (idx: number) => {
    const fname = fields[idx]?.field_name;
    setFields(prev => prev.filter((_, i) => i !== idx));
    if (fname !== undefined) setCalState(prev => { const n = { ...prev }; delete n[fname]; return n; });
    setSelectedIdx(prev => Math.min(prev, Math.max(0, fields.length - 2)));
  };

  const updateField = (idx: number, patch: Partial<FormField>) => {
    setFields(prev => prev.map((f, i) => {
      if (i !== idx) return f;
      const updated = { ...f, ...patch };
      if (patch.field_type === 'select' && !updated.options) updated.options = [''];
      if (patch.field_type && patch.field_type !== 'select') delete updated.options;
      return updated;
    }));
  };

  const updateFieldAndRekey = (idx: number, patch: Partial<FormField>) => {
    const oldName = fields[idx]?.field_name;
    const newName = patch.field_name !== undefined ? patch.field_name : oldName;
    updateField(idx, patch);
    if (newName !== oldName) {
      setCalState(prev => {
        const next = { ...prev };
        next[newName] = next[oldName] ?? blankCal();
        delete next[oldName];
        return next;
      });
    }
  };

  const updateCal = (fname: string, patch: Partial<UEFCalField>) => {
    setCalState(prev => ({ ...prev, [fname]: { ...(prev[fname] ?? blankCal()), ...patch } }));
  };

  // ── JSON import ──────────────────────────────────────────────────────────────
  const handleLoadJson = () => {
    setJsonError('');
    let parsed: any;
    try {
      const cleaned = jsonInput.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      parsed = JSON.parse(cleaned);
    } catch (e: any) { setJsonError(`Invalid JSON: ${e.message}`); return; }
    let newName = '', newDescription = '', newFields: FormField[] = [];
    if (Array.isArray(parsed)) { newFields = parsed; }
    else {
      if (parsed.form_name) newName = parsed.form_name; else if (parsed.name) newName = parsed.name;
      if (parsed.form_description) newDescription = parsed.form_description; else if (parsed.description) newDescription = parsed.description;
      if (Array.isArray(parsed.fields)) newFields = parsed.fields;
      else if (Array.isArray(parsed.field_definitions)) newFields = parsed.field_definitions;
    }
    if (newFields.length === 0) { setJsonError('No fields found. Expected { fields: [...] } or a top-level array.'); return; }
    try {
      const normalized = newFields.map(importJsonFieldRec);
      if (newName) setFormName(newName);
      if (newDescription) setFormDescription(newDescription);
      setFields(normalized.map(f => ({ ...f })));
      const newCal: Record<string, UEFCalField> = {};
      for (const f of normalized) {
        const rawHints = (f as any).extraction_hints;
        const rawRules = (f as any).rules;
        const rawExamples = (f as any).examples;
        newCal[f.field_name] = {
          description: f.field_description || '',
          hints: Array.isArray(rawHints) ? rawHints : rawHints ? [String(rawHints)] : [],
          rules: Array.isArray(rawRules) ? rawRules : rawRules ? [String(rawRules)] : [],
          examples: (Array.isArray(rawExamples) ? rawExamples : []).map((e: any) => typeof e === 'string' ? { value: e, source_text: '' } : e),
        };
      }
      setCalState(newCal);
      setSelectedIdx(0);
      setShowJsonPanel(false);
      setJsonInput('');
    } catch (err: any) {
      setJsonError(`Import failed: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleJsonFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setJsonInput((ev.target?.result as string) || ''); setJsonError(''); };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Build request ─────────────────────────────────────────────────────────────
  const buildRequest = (saveDraft = false) => ({
    project_id: projectId,
    form_name: formName.trim(),
    form_description: formDescription.trim(),
    fields: fields.map(({ _isNew, _isDeleted, ...f }) => sanitizeFieldDeep({
      ...f,
      field_description: calState[f.field_name]?.description || f.field_description || '',
    } as FormField)),
    enable_review: enableReview,
    ...(saveDraft ? { save_as_draft: true } : {}),
  });

  const handleSaveDraft = async () => {
    if (!isValid) return;
    setSavingDraft(true);
    try {
      const form = await formsService.create(buildRequest(true) as any);
      toast({ title: 'Draft saved', variant: 'success' });
      onSuccess(form, false);
    } catch (err: any) {
      toast({ title: 'Error', description: getErrorMessage(err, 'Failed to save form'), variant: 'error' });
    } finally { setSavingDraft(false); }
  };

  const handleBuild = async () => {
    if (!isValid) return;
    setSavingBuild(true);
    try {
      const form = await formsService.create(buildRequest(false) as any);
      toast({ title: 'Generating', description: 'Code generation started.', variant: 'success' });
      onSuccess(form, false);
    } catch (err: any) {
      toast({ title: 'Error', description: getErrorMessage(err, 'Failed to create form'), variant: 'error' });
    } finally { setSavingBuild(false); }
  };

  // ── Selected field ────────────────────────────────────────────────────────────
  const selectedField = fields[selectedIdx] ?? null;
  const selectedCal = selectedField ? (calState[selectedField.field_name] ?? blankCal()) : null;

  // ── Close guard: don't discard in-progress work on backdrop click / Esc ─────────
  const hasProgress = () =>
    formName.trim() !== '' ||
    formDescription.trim() !== '' ||
    enableReview ||
    jsonInput.trim() !== '' ||
    fields.some(f => f.field_name.trim() !== '' || (f.field_description ?? '').trim() !== '');

  const handleClose = () => {
    if (saving) return;
    if (hasProgress() && !confirm('You have unsaved changes. Discard this form?')) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [formName, formDescription, enableReview, jsonInput, fields, saving]);

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-[95vw] xl:max-w-[1400px] max-h-[95vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">New extraction form</h2>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Define fields, descriptions, hints, and rules. Codegen builds the DSPy extraction pipeline.</p>
            </div>
            <button type="button" onClick={handleClose} disabled={saving} className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors p-1 shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Form name</label>
              <input autoFocus value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Oral cancer outcomes"
                className={cn("w-full text-sm bg-gray-50 dark:bg-[#141414] border rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:outline-none transition-colors placeholder-gray-400 dark:placeholder-zinc-500",
                  nameError ? "border-red-400 dark:border-red-600" : "border-gray-200 dark:border-[#2a2a2a] focus:border-gray-400 dark:focus:border-zinc-500")} />
              {nameError && <p className="text-[11px] text-red-500 mt-1">{nameError}</p>}
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
                Description
                {formDescription.length > 0 && formDescription.length < 10 && (
                  <span className="text-amber-500 font-normal ml-2">{formDescription.length}/10 chars min</span>
                )}
              </label>
              <input value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="What does this form extract?"
                className="w-full text-sm bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:border-gray-400 dark:focus:border-zinc-500 transition-colors placeholder-gray-400 dark:placeholder-zinc-500" />
              <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-1 leading-relaxed">
                Describe what this form extracts in plain English — topic, the data points to capture, and any scope limits. This drives the AI decomposition that builds your fields, hints, and rules, so be specific (e.g. &ldquo;Extract harms and benefits of dental implants from RCTs: outcomes, effect sizes, follow-up duration, sample size&rdquo;).
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Left rail */}
          <div className="w-[280px] shrink-0 flex flex-col min-h-0 border-r border-gray-100 dark:border-[#1a1a1a]">
            <div className="px-4 py-2.5 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a] flex items-center justify-between">
              <p className="text-xs text-gray-600 dark:text-zinc-400">
                <span className="font-semibold text-gray-800 dark:text-zinc-200">{fields.length}</span> field{fields.length !== 1 ? 's' : ''}
              </p>
              <button type="button" onClick={addField} className="text-[11px] text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-1">
                <Plus className="h-3 w-3" /> Add field
              </button>
            </div>

            {/* JSON import panel */}
            <div className="px-4 py-2 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a]">
              <button type="button" onClick={() => { setShowJsonPanel(!showJsonPanel); setJsonError(''); }} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors flex items-center gap-1.5 w-full">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Import from JSON
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none" className="ml-auto shrink-0" style={{ transform: showJsonPanel ? 'rotate(180deg)' : '', transition: 'transform 0.15s' }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {showJsonPanel && (
                <div className="mt-2">
                  <textarea value={jsonInput} onChange={e => { setJsonInput(e.target.value); setJsonError(''); }} placeholder={`{"form_name":"My Form","fields":[...]}`} rows={5}
                    className={cn("w-full text-[11px] font-mono bg-gray-50 dark:bg-[#141414] border rounded-lg p-2.5 text-gray-700 dark:text-zinc-300 resize-none focus:outline-none leading-relaxed placeholder-gray-400 dark:placeholder-zinc-500 transition-colors", jsonError ? "border-red-400 dark:border-red-600" : "border-gray-200 dark:border-[#2a2a2a] focus:border-gray-400 dark:focus:border-zinc-500")} />
                  {jsonError && <p className="text-[11px] text-red-500 mt-1 leading-snug">{jsonError}</p>}
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="text-[11px] text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] rounded-md px-2.5 py-1 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">Upload .json</button>
                    <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleJsonFileUpload} className="hidden" />
                    <button type="button" onClick={handleLoadJson} disabled={!jsonInput.trim()} className="text-[11px] text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-200 rounded-md px-2.5 py-1 transition-colors disabled:opacity-40 hover:opacity-90">Load</button>
                  </div>
                </div>
              )}
            </div>

            {/* Field list */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {fields.length === 0 ? (
                <p className="text-[11px] text-gray-400 dark:text-zinc-500 italic leading-snug">Add a field or import a schema to get started.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {fields.map((f, idx) => {
                    const isSelected = idx === selectedIdx;
                    const typeGlyph = f.field_type === 'array' ? '▦' : f.field_type === 'select' ? '⊙' : '⊡';
                    const displayName = f.display_name || humanizeFieldName(f.field_name);
                    const hasErr = !!validateFieldRec(f);
                    return (
                      <div key={idx} className="group flex items-center gap-1">
                        <button type="button" onClick={() => setSelectedIdx(idx)}
                          className={cn("flex-1 min-w-0 text-left px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors",
                            isSelected ? "bg-gray-900 dark:bg-zinc-200 text-white dark:text-gray-900" : "text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]")}>
                          <span className={cn("text-xs shrink-0", isSelected ? "text-gray-400 dark:text-zinc-600" : "text-gray-400 dark:text-zinc-500")}>{typeGlyph}</span>
                          <span className="flex-1 truncate">{f.field_name.trim() ? displayName : <span className="italic opacity-60">unnamed</span>}</span>
                          {hasErr && !isSelected && <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />}
                        </button>
                        {fields.length > 1 && (
                          <button type="button" onClick={() => removeField(idx)} className="shrink-0 p-1 text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 rounded">
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: field editor */}
          <div className="flex-1 flex flex-col border-l border-gray-100 dark:border-[#1a1a1a] min-w-0">
            <div className="px-5 py-2.5 border-b border-gray-100 dark:border-[#1a1a1a] flex-shrink-0 flex items-center justify-between">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Field editor</p>
              {selectedField && fields.length > 1 && (
                <button type="button" onClick={() => removeField(selectedIdx)} className="text-[11px] text-gray-500 dark:text-zinc-400 hover:text-red-500 transition-colors">× Remove field</button>
              )}
            </div>
            {!selectedField ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-gray-400 dark:text-zinc-500">Add a field to get started.</p>
              </div>
            ) : (
              <FieldEditorPane
                field={selectedField}
                cal={selectedCal!}
                editable={true}
                simple={true}
                onFieldPatch={patch => updateFieldAndRekey(selectedIdx, patch)}
                onCalPatch={patch => updateCal(selectedField.field_name, patch)}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-[#1a1a1a] bg-white dark:bg-[#111111] flex items-center gap-3 px-6 py-4 flex-shrink-0 rounded-b-2xl">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={enableReview} onChange={e => setEnableReview(e.target.checked)} className="w-3.5 h-3.5 rounded border-gray-300 dark:border-zinc-600 accent-amber-500" />
            <span className="text-xs text-gray-500 dark:text-zinc-400">Enable decomposition review (HITL #1)</span>
          </label>
          <div className="flex-1" />
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={onClose} disabled={saving} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">Cancel</button>
            <button type="button" disabled={saving || !isValid} onClick={handleSaveDraft} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {savingDraft ? 'Saving…' : 'Save Draft'}
            </button>
            <button type="button" disabled={saving || !isValid} onClick={handleBuild} className="text-sm font-semibold px-5 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-none">
              {savingBuild ? 'Building…' : 'Build →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper functions for the review dialog
// humanizeFieldName is imported from @/components/forms/FieldEditorPane (top of file)
function humanizeSigName(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').trim();
}
function getBehaviorLabel(sig: any): string {
  const flds = Object.values(sig.fields || {}) as any[];
  if ((sig.depends_on || []).length > 0) return 'Synthesizes';
  if (flds.some((f: any) => f.field_type === 'select' || f.field_type === 'enum')) return 'Classifies';
  if (flds.some((f: any) => f.field_type === 'text')) return 'Interprets';
  return 'Reads';
}

function getBehaviorTint(sig: any): string {
  const label = getBehaviorLabel(sig);
  if (label === 'Reads') return 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-1 ring-sky-100 dark:ring-sky-900/40';
  if (label === 'Classifies') return 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-1 ring-violet-100 dark:ring-violet-900/40';
  if (label === 'Interprets') return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-1 ring-amber-100 dark:ring-amber-900/40';
  if (label === 'Synthesizes') return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-100 dark:ring-emerald-900/40';
  return 'bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-300';
}

// Decomposition Review Dialog Component
function DecompositionReviewDialog({
  form,
  onClose,
  onApprove,
  onReject,
}: {
  form: Form;
  onClose: () => void;
  onApprove: (formId: string) => void;
  onReject: (formId: string, feedback: string, notes: ReviewNote[]) => void;
}) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string>(form.status);
  const isStale = currentStatus !== 'awaiting_review';
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set());
  const [expandedSignatures, setExpandedSignatures] = useState<Set<string>>(new Set());
  const [expandedDepGroups, setExpandedDepGroups] = useState<Set<string>>(new Set());
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const treeWrapperRef = useRef<HTMLDivElement | null>(null);
  const groupBoxRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fieldChipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [sideTab, setSideTab] = useState<'group' | 'field' | 'feedback'>('group');
  const [selectedSig, setSelectedSig] = useState<string | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [generalFeedback, setGeneralFeedback] = useState('');

  const metadata = useMemo(() => {
    if (typeof form.metadata === 'string') {
      try { return JSON.parse(form.metadata); } catch { return {}; }
    }
    return form.metadata || {};
  }, [form.metadata]);

  const signatures = metadata?.decomposition?.signatures || [];
  const pipeline = useMemo(() => metadata?.decomposition?.pipeline || [], [metadata]);
  const attempt: number = metadata?.decomposition?.attempt || 1;
  const reasoningTrace: string | null = metadata?.decomposition?.reasoning_trace || metadata?.decomposition_summary || null;
  const formFields: FormField[] = form.fields || [];
  const totalFields = signatures.reduce((sum: number, sig: any) =>
    sum + Object.keys(sig.fields || {}).length, 0
  );

  const signatureDependencyMap = useMemo(() => {
    const map: Record<string, Array<{ field: string; sourceSignature: string; sourceStage: number }>> = {};
    for (const stage of pipeline) {
      const stageSigs = (stage.signatures || [])
        .map((sigName: string) => signatures.find((s: any) => s.name === sigName))
        .filter(Boolean);
      for (const sig of stageSigs) {
        const deps: Array<{ field: string; sourceSignature: string; sourceStage: number }> = [];
        for (const field of (sig.depends_on || [])) {
          for (const earlierStage of pipeline) {
            if (earlierStage.stage > stage.stage) continue;
            const earlierSigs = (earlierStage.signatures || [])
              .map((sigName: string) => signatures.find((s: any) => s.name === sigName))
              .filter((s: any) => s && s.name !== sig.name);
            for (const src of earlierSigs) {
              if (src.fields && field in src.fields) {
                deps.push({ field, sourceSignature: src.name, sourceStage: earlierStage.stage });
                break;
              }
            }
          }
        }
        if (deps.length > 0) map[sig.name] = deps;
      }
    }
    return map;
  }, [pipeline, signatures]);

  const downstreamMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const sig of signatures) map[sig.name] = [];
    for (const src of signatures) {
      const srcFields = Object.keys(src.fields || {});
      if (srcFields.length === 0) continue;
      for (const consumer of signatures) {
        if (consumer.name === src.name) continue;
        const deps = consumer.depends_on || [];
        if (srcFields.some((f: string) => deps.includes(f))) {
          map[src.name].push(consumer.name);
        }
      }
    }
    return map;
  }, [signatures]);

  // Same bucketing the dependency pills already render (per destination group,
  // grouped by source group) — hoisted so the connector overlay reuses the
  // identical tiers instead of recomputing/duplicating the grouping logic.
  const dependencyBucketsBySig = useMemo(() => {
    const result: Record<string, Array<{ key: string; sourceSignature: string; sourceStage: number; fields: string[] }>> = {};
    for (const [destGroup, deps] of Object.entries(signatureDependencyMap)) {
      const groupMap: Record<string, { fields: string[]; sourceSignature: string; sourceStage: number }> = {};
      for (const dep of deps as Array<{ field: string; sourceSignature: string; sourceStage: number }>) {
        const key = `${dep.sourceSignature}::${dep.sourceStage}`;
        if (!groupMap[key]) groupMap[key] = { fields: [], sourceSignature: dep.sourceSignature, sourceStage: dep.sourceStage };
        groupMap[key].fields.push(dep.field);
      }
      result[destGroup] = Object.entries(groupMap).map(([key, g]) => ({ key, ...g }));
    }
    return result;
  }, [signatureDependencyMap]);

  const hasAnyDependencies = Object.keys(signatureDependencyMap).length > 0;

  // Edge granularity mirrors what's already visible as text: a collapsed
  // source group or an unexpanded ">3 fields" bucket draws one aggregate
  // group→group line instead of one line per field, so line count never
  // exceeds what the pills already show. Capped defensively — realistic
  // decompositions stay well under this, it only guards pathological data.
  const dependencyEdges = useMemo(() => {
    const THRESHOLD = 3;
    const edges: DecompositionDependencyEdge[] = [];
    for (const [destGroup, buckets] of Object.entries(dependencyBucketsBySig)) {
      for (const bucket of buckets) {
        const expandKey = `${destGroup}::${bucket.key}`;
        const sourceGroupOpen = expandedSignatures.has(bucket.sourceSignature);
        const bucketCollapsed = bucket.fields.length > THRESHOLD && !expandedDepGroups.has(expandKey);
        if (!sourceGroupOpen || bucketCollapsed) {
          edges.push({ id: `${expandKey}::agg`, sourceGroup: bucket.sourceSignature, sourceField: '', destGroup, aggregate: true });
        } else {
          for (const field of bucket.fields) {
            edges.push({ id: `${expandKey}::${field}`, sourceGroup: bucket.sourceSignature, sourceField: field, destGroup, aggregate: false });
          }
        }
      }
    }
    return edges.length > 40 ? [] : edges;
  }, [dependencyBucketsBySig, expandedSignatures, expandedDepGroups]);

  // Lines only render while hovering a group — declutters dense graphs by
  // default, while the static tint/ring accents still hint where to hover.
  const visibleDependencyEdges = useMemo(() => {
    if (!hoveredGroup) return [];
    return dependencyEdges.filter((e) => e.sourceGroup === hoveredGroup || e.destGroup === hoveredGroup);
  }, [dependencyEdges, hoveredGroup]);

  const startedAgo = useMemo(() => {
    if (!form.updated_at) return null;
    const diffMs = Date.now() - new Date(form.updated_at).getTime();
    if (diffMs < 0) return null;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }, [form.updated_at]);

  const toggleStage = (stageNum: number) => {
    const s = new Set(expandedStages);
    s.has(stageNum) ? s.delete(stageNum) : s.add(stageNum);
    setExpandedStages(s);
  };
  const toggleSignature = (sigName: string) => {
    const s = new Set(expandedSignatures);
    s.has(sigName) ? s.delete(sigName) : s.add(sigName);
    setExpandedSignatures(s);
  };
  const expandAll = () => {
    setExpandedStages(new Set<number>(pipeline.map((s: any) => s.stage)));
    setExpandedSignatures(new Set<string>(signatures.map((s: any) => s.name)));
  };
  const collapseAll = () => { setExpandedStages(new Set()); setExpandedSignatures(new Set()); };

  const handleClose = () => onClose();

  const selectedSigData = selectedSig ? signatures.find((s: any) => s.name === selectedSig) : null;
  const selectedFieldData = useMemo(() => {
    if (!selectedField) return null;
    const ff = formFields.find(f => f.field_name === selectedField);
    if (ff) return ff;
    for (const sig of signatures) {
      if (sig.fields && selectedField in sig.fields) return { field_name: selectedField, ...sig.fields[selectedField] };
    }
    return null;
  }, [selectedField, formFields, signatures]);

  const handleApprove = async () => {
    if (generalFeedback.trim()) {
      setSideTab('feedback');
      toast({
        title: 'You have unsent feedback',
        description: 'Click "Request Changes" to send it, or clear the textarea to approve as-is.',
        variant: 'error',
      });
      return;
    }
    setSubmitting(true);
    try { await onApprove(form.id); } finally { setSubmitting(false); }
  };

  const handleReject = async () => {
    if (!generalFeedback.trim()) {
      setSideTab('feedback');
      toast({ title: 'Add feedback', description: 'Describe what should change before requesting changes.', variant: 'error' });
      return;
    }
    setSubmitting(true);
    try { await onReject(form.id, generalFeedback, []); } finally { setSubmitting(false); }
  };

  useEffect(() => {
    setExpandedStages(new Set<number>(pipeline.map((s: any) => s.stage)));
  }, [pipeline]);

  // Refetch the form on mount so we don't act on a stale snapshot
  // (e.g. another tab approved it, or the dialog was opened from cached list data).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fresh = await formsService.get(form.id);
        if (cancelled) return;
        setCurrentStatus(fresh.status);
        if (fresh.status !== 'awaiting_review') {
          toast({
            title: 'Already processed',
            description: `This form is now ${fresh.status} — closing review.`,
            variant: 'warning',
          });
          onClose();
        }
      } catch {
        // Network/permission error: keep the dialog open with whatever status we have.
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id]);

  const ml = "text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider";

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-[95vw] xl:max-w-[1200px] max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">{form.form_name}</h2>
                <Badge variant="warning">Pending review</Badge>
              </div>
              {form.form_description && <p className="text-sm text-gray-400 dark:text-zinc-500 mt-1 line-clamp-2">{form.form_description}</p>}
            </div>
            <button type="button" onClick={handleClose} className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-300 transition-colors p-1 shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Metrics strip */}
          <div className="grid grid-cols-3 mt-3 rounded-xl border border-gray-100 dark:border-[#1f1f1f] divide-x divide-gray-100 dark:divide-[#1f1f1f] overflow-hidden">
            <div className="px-3 py-2">
              <p className={ml}>Fields covered</p>
              <p className={cn("text-lg font-semibold tabular-nums mt-0.5", formFields.length > 0 && totalFields >= formFields.length ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                {totalFields}{formFields.length > 0 && <span className="text-xs text-gray-300 dark:text-zinc-600 font-normal"> / {formFields.length}</span>}
              </p>
              <p className="text-[10px] text-gray-300 dark:text-zinc-600 mt-1">
                {formFields.length === 0 ? 'No fields' : totalFields >= formFields.length ? 'Every field assigned' : `${formFields.length - totalFields} unassigned`}
              </p>
            </div>
            <div className="px-3 py-2">
              <p className={ml}>Groups</p>
              <p className="text-lg font-semibold tabular-nums text-sky-600 dark:text-sky-400 mt-0.5">{signatures.length}</p>
              <p className="text-[10px] text-gray-300 dark:text-zinc-600 mt-1">across {pipeline.length} stage{pipeline.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="px-3 py-2">
              <p className={ml}>Revision</p>
              <p className="text-lg font-semibold tabular-nums text-violet-600 dark:text-violet-400 mt-0.5">{attempt} <span className="text-xs text-gray-300 dark:text-zinc-600 font-normal">of 3</span></p>
              <p className="text-[10px] text-gray-300 dark:text-zinc-600 mt-1">{Math.max(0, 3 - attempt)} regen{3 - attempt === 1 ? '' : 's'} remaining</p>
            </div>
          </div>
        </div>

        {/* Body: dual panel */}
        <div className="flex-1 flex min-h-0">
          {/* Left: pipeline tree */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {reasoningTrace && (
              <details className="px-6 py-2 border-b border-gray-100 dark:border-[#1a1a1a] flex-shrink-0">
                <summary className="text-xs text-gray-400 dark:text-zinc-500 cursor-pointer hover:text-gray-600 dark:hover:text-zinc-300 transition-colors select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-gray-300 dark:focus-visible:ring-zinc-600 rounded-sm inline-block">Reasoning trace</summary>
                <div className="max-h-36 overflow-y-auto mt-2">
                  <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{reasoningTrace}</p>
                </div>
              </details>
            )}
            <div className="px-6 pt-3 pb-1 flex-shrink-0">
              <p className="text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-500 uppercase">
                Extraction plan
                {hasAnyDependencies && (
                  <span className="ml-1.5 font-medium tracking-normal normal-case text-violet-400 dark:text-violet-500">— inputs merge into later-stage groups</span>
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1 leading-relaxed">
                Fields are grouped into tasks. Each stage runs its groups in parallel; later stages can use results from earlier ones.
              </p>
            </div>
            <div className="flex items-center justify-between px-6 py-2 flex-shrink-0">
              <span className="text-xs text-gray-400 dark:text-zinc-500">
                <span className="font-semibold text-gray-700 dark:text-zinc-300">{pipeline.length}</span> stages · <span className="font-semibold text-gray-700 dark:text-zinc-300">{signatures.length}</span> groups · <span className="font-semibold text-gray-700 dark:text-zinc-300">{totalFields}</span> fields
              </span>
              <div className="flex items-center gap-3">
                <button type="button" onClick={expandedStages.size === pipeline.length ? collapseAll : expandAll} className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 bg-transparent border-none cursor-pointer p-0 transition-colors">
                  {expandedStages.size === pipeline.length ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <div ref={treeWrapperRef} className="relative">
              {pipeline.map((stage: any, si: number) => {
                const isOpen = expandedStages.has(stage.stage);
                const isLastStage = si === pipeline.length - 1;
                const execution = (stage.execution || 'parallel').toLowerCase();
                const isParallel = execution === 'parallel';
                const stageSignatures = (stage.signatures || []).map((sigName: string) => signatures.find((s: any) => s.name === sigName)).filter(Boolean);
                const stageFieldCount = stageSignatures.reduce((s: number, sig: any) => s + Object.keys(sig.fields || {}).length, 0);
                return (
                  <div key={stage.stage} className="flex gap-0">
                    <div className="flex flex-col items-center w-7 shrink-0 pt-[14px]">
                      <div className={cn("w-2.5 h-2.5 shrink-0 ring-2 ring-white dark:ring-[#111111]", isParallel ? "rounded-full" : "rounded-[3px]", isParallel ? (isOpen ? "bg-sky-500 dark:bg-sky-400" : "bg-sky-200 dark:bg-sky-900") : (isOpen ? "bg-amber-500 dark:bg-amber-400" : "bg-amber-200 dark:bg-amber-900"))} />
                      {!isLastStage && <div className="w-px flex-1 mt-1 bg-gray-200 dark:bg-[#222]" />}
                    </div>
                    <div className="flex-1 pb-4 min-w-0">
                      <div className="flex items-center gap-2 py-1.5 pr-2 pl-1 cursor-pointer rounded-lg -ml-1 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]" onClick={() => toggleStage(stage.stage)}>
                        <span className={cn("text-sm tracking-tight flex-1", isOpen ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-500 dark:text-zinc-400")}>Stage {stage.stage}</span>
                        <span className="text-xs text-gray-400 dark:text-zinc-600">{execution} · {stageSignatures.length} group{stageSignatures.length !== 1 ? 's' : ''}{!isOpen ? ` · ${stageFieldCount} fields` : ''}</span>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 transition-transform duration-200 text-gray-300 dark:text-zinc-600" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </div>
                      {isOpen && (
                        <div className="mt-1">
                          {stageSignatures.map((sig: any, ti: number) => {
                            const taskOpen = expandedSignatures.has(sig.name);
                            const isLastTask = ti === stageSignatures.length - 1;
                            const sigFields = Object.keys(sig.fields || {});
                            const isSelected = selectedSig === sig.name;
                            return (
                              <div key={sig.name} className="flex gap-0">
                                <div className="flex flex-col items-center w-6 shrink-0 pt-[11px]">
                                  <div className={cn("w-1.5 h-1.5 shrink-0 rounded-full transition-colors", taskOpen ? "bg-gray-600 dark:bg-zinc-300" : "bg-gray-300 dark:bg-zinc-600")} />
                                  {(!isLastTask || taskOpen) && <div className="w-px flex-1 mt-1 bg-gray-100 dark:bg-[#1f1f1f]" />}
                                </div>
                                <div
                                  ref={(el) => { groupBoxRefs.current[sig.name] = el; }}
                                  className={cn(
                                    "flex-1 pb-2 min-w-0 transition-colors rounded-lg",
                                    visibleDependencyEdges.some((e) => e.destGroup === sig.name) && "-mx-2 px-2 bg-violet-50/60 dark:bg-violet-500/[0.06]"
                                  )}
                                >
                                  <div
                                    className={cn("flex items-center gap-2 py-1 pr-2 pl-1 cursor-pointer rounded-lg -ml-1 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.025]", isSelected && "bg-gray-50 dark:bg-white/[0.03]")}
                                    onClick={() => { toggleSignature(sig.name); setSelectedSig(sig.name); setSideTab('group'); }}
                                    onMouseEnter={() => setHoveredGroup(sig.name)}
                                    onMouseLeave={() => setHoveredGroup(null)}
                                  >
                                    <span className={cn("text-[13px] flex-1 tracking-tight min-w-0 truncate flex items-center gap-1.5", taskOpen ? "text-gray-800 dark:text-zinc-100" : "text-gray-400 dark:text-zinc-500")}>
                                      <span className="truncate">{humanizeSigName(sig.name)}</span>
                                    </span>
                                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md shrink-0 font-medium", getBehaviorTint(sig))}>{getBehaviorLabel(sig)}</span>
                                    <span className="text-[11px] text-gray-300 dark:text-zinc-600 tabular-nums shrink-0">{sigFields.length}</span>
                                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0 transition-transform duration-200 text-gray-300 dark:text-zinc-700" style={{ transform: taskOpen ? 'rotate(180deg)' : 'rotate(0)' }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  </div>
                                  {taskOpen && (() => {
                                    const buckets = dependencyBucketsBySig[sig.name] || [];
                                    const THRESHOLD = 3;
                                    return (
                                      <div className="mt-1.5 mb-1 pl-1 flex flex-col gap-1.5">
                                        {buckets.length > 0 && (
                                          <div className="flex flex-wrap gap-1.5">
                                            {buckets.map((group) => {
                                              const key = group.key;
                                              const expandKey = `${sig.name}::${key}`;
                                              const isGroupExpanded = expandedDepGroups.has(expandKey);
                                              const collapsed = group.fields.length > THRESHOLD;
                                              return (
                                                <div key={key} className="flex flex-col gap-1">
                                                  {collapsed ? (
                                                    <>
                                                      <button type="button" onClick={() => { const s = new Set(expandedDepGroups); s.has(expandKey) ? s.delete(expandKey) : s.add(expandKey); setExpandedDepGroups(s); }} className="text-xs text-violet-500 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 py-0.5 px-2 rounded-md flex items-center gap-1 cursor-pointer hover:bg-violet-100 dark:hover:bg-violet-950/60 transition-colors">
                                                        ← {group.fields.length} fields from {group.sourceSignature} (S{group.sourceStage})
                                                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ transform: isGroupExpanded ? 'rotate(180deg)' : 'rotate(0)' }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                                      </button>
                                                      {isGroupExpanded && (
                                                        <div className="flex flex-wrap gap-1.5 pl-1">
                                                          {group.fields.map((f) => (
                                                            <button key={f} type="button" onClick={() => { setSelectedField(f); setSideTab('field'); }} className="text-xs text-violet-500 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 py-0.5 px-2 rounded-md hover:bg-violet-100 transition-colors">
                                                              ← {formFields.find(ff => ff.field_name === f)?.display_name || humanizeFieldName(f)}
                                                            </button>
                                                          ))}
                                                        </div>
                                                      )}
                                                    </>
                                                  ) : (
                                                    <div className="flex flex-wrap gap-1.5">
                                                      {group.fields.map((f) => (
                                                        <button key={f} type="button" onClick={() => { setSelectedField(f); setSideTab('field'); }} className="text-xs text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 py-0.5 px-2 rounded-md hover:bg-blue-100 transition-colors">
                                                          ← {formFields.find(ff => ff.field_name === f)?.display_name || humanizeFieldName(f)} · {group.sourceSignature} (S{group.sourceStage})
                                                        </button>
                                                      ))}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                        {sigFields.length > 0 && (
                                          <div className="flex flex-wrap gap-1.5">
                                            {sigFields.map((f: string) => {
                                              const fmeta: any = formFields.find(ff => ff.field_name === f) || (sig.fields?.[f] ? { field_name: f, ...sig.fields[f] } : null);
                                              const isArray = fmeta?.field_type === 'array';
                                              const subCount = Array.isArray(fmeta?.subform_fields) ? fmeta.subform_fields.length : 0;
                                              const label = fmeta?.display_name || humanizeFieldName(f);
                                              const isConsumedDownstream = visibleDependencyEdges.some((e) => e.sourceGroup === sig.name && (e.aggregate || e.sourceField === f));
                                              return (
                                                <button
                                                  key={f}
                                                  type="button"
                                                  ref={(el) => { fieldChipRefs.current[`${sig.name}::${f}`] = el; }}
                                                  onClick={() => { setSelectedField(f); setSideTab('field'); }}
                                                  className={cn(
                                                    "text-xs py-0.5 px-2 rounded-md transition-colors inline-flex items-center gap-1",
                                                    isArray ? "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50" : "text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] hover:bg-gray-100 dark:hover:bg-[#222]",
                                                    isConsumedDownstream && "ring-1 ring-inset ring-violet-300 dark:ring-violet-700/70"
                                                  )}
                                                >
                                                  {isArray && <span className="text-[10px] leading-none">▦</span>}
                                                  <span>{label}</span>
                                                  {isArray && subCount > 0 && <span className="text-[10px] tabular-nums text-amber-600/80 dark:text-amber-400/80">·{subCount}</span>}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <DecompositionDependencyOverlay
                containerRef={treeWrapperRef}
                groupBoxRefs={groupBoxRefs}
                fieldChipRefs={fieldChipRefs}
                edges={visibleDependencyEdges}
              />
              </div>
            </div>
          </div>

          {/* Right: sidebar */}
          <div className="w-[340px] shrink-0 flex flex-col border-l border-gray-100 dark:border-[#1a1a1a]">
            <div className="flex border-b border-gray-100 dark:border-[#1a1a1a] flex-shrink-0">
              {(['group', 'field', 'feedback'] as const).map(tab => {
                const label = tab.charAt(0).toUpperCase() + tab.slice(1);
                const isFeedback = tab === 'feedback';
                const hasFeedback = isFeedback && generalFeedback.trim().length > 0;
                const active = sideTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSideTab(tab)}
                    className={cn(
                      "flex-1 py-2.5 text-[10px] font-semibold uppercase tracking-wider transition-colors border-b-2 flex items-center justify-center gap-1.5",
                      active
                        ? isFeedback
                          ? "text-amber-600 dark:text-amber-400 border-amber-500 dark:border-amber-400"
                          : "text-gray-900 dark:text-white border-gray-900 dark:border-zinc-200"
                        : isFeedback
                          ? "text-amber-500/80 dark:text-amber-400/70 border-transparent hover:text-amber-600 dark:hover:text-amber-300"
                          : "text-gray-400 dark:text-zinc-500 border-transparent hover:text-gray-600 dark:hover:text-zinc-300"
                    )}
                  >
                    {label}
                    {hasFeedback && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-6 text-sm">
              {/* Group tab */}
              {sideTab === 'group' && !selectedSigData && <p className="text-xs text-gray-400 dark:text-zinc-500">Click a group in the pipeline to inspect it.</p>}
              {sideTab === 'group' && selectedSigData && (() => {
                const downstream = downstreamMap[selectedSigData.name] || [];
                const deps = selectedSigData.depends_on || [];
                const sigFieldNames = Object.keys(selectedSigData.fields || {});
                return (
                <div className="flex flex-col gap-3">
                  <div>
                    <p className={ml}>Group</p>
                    <p className="font-semibold text-gray-900 dark:text-white mt-0.5">{humanizeSigName(selectedSigData.name)}</p>
                  </div>
                  {selectedSigData.reasoning_explanation && (
                    <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed border-l-2 border-gray-900/40 dark:border-zinc-300/40 pl-3">{selectedSigData.reasoning_explanation}</p>
                  )}
                  <div>
                    <p className={ml}>Behavior</p>
                    <span className={cn("mt-0.5 inline-block text-xs px-2 py-0.5 rounded-md font-medium", getBehaviorTint(selectedSigData))}>{getBehaviorLabel(selectedSigData)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="border border-gray-100 dark:border-[#1f1f1f] rounded-lg p-2">
                      <p className={ml}>Inputs</p>
                      <ul className="mt-1 font-mono text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
                        {deps.length === 0 ? <li>markdown_content</li> : deps.map((d: string) => <li key={d}>{d}</li>)}
                      </ul>
                    </div>
                    <div className="border border-gray-100 dark:border-[#1f1f1f] rounded-lg p-2">
                      <p className={ml}>Outputs ({sigFieldNames.length})</p>
                      <ul className="mt-1 font-mono text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
                        {sigFieldNames.slice(0, 6).map((f: string) => <li key={f} className="truncate">{f}</li>)}
                        {sigFieldNames.length > 6 && <li className="text-gray-300 dark:text-zinc-600">+{sigFieldNames.length - 6} more</li>}
                      </ul>
                    </div>
                  </div>
                  <div>
                    <p className={ml}>Fields</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {sigFieldNames.map((f: string) => {
                        const fmeta: any = formFields.find(ff => ff.field_name === f) || (selectedSigData.fields?.[f] ? { field_name: f, ...selectedSigData.fields[f] } : null);
                        const isArray = fmeta?.field_type === 'array';
                        const subCount = Array.isArray(fmeta?.subform_fields) ? fmeta.subform_fields.length : 0;
                        const label = fmeta?.display_name || humanizeFieldName(f);
                        return (
                          <button key={f} type="button" onClick={() => { setSelectedField(f); setSideTab('field'); }} className={cn("text-xs py-0.5 px-2 rounded-md transition-colors inline-flex items-center gap-1", isArray ? "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50" : "text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] hover:bg-gray-100 dark:hover:bg-[#222]")}>
                            {isArray && <span className="text-[10px] leading-none">▦</span>}
                            <span>{label}</span>
                            {isArray && subCount > 0 && <span className="text-[10px] tabular-nums text-amber-600/80 dark:text-amber-400/80">·{subCount}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {deps.length > 0 && (
                    <div>
                      <p className={ml}>Depends on</p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {deps.map((f: string) => <span key={f} className="text-xs text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 py-0.5 px-2 rounded-md">{f}</span>)}
                      </div>
                    </div>
                  )}
                  {downstream.length > 0 ? (
                    <div>
                      <p className={ml}>Used by</p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {downstream.map((s: string) => (
                          <button key={s} type="button" onClick={() => { setSelectedSig(s); }} className="text-xs text-purple-500 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 py-0.5 px-2 rounded-md hover:bg-purple-100 dark:hover:bg-purple-950/60 transition-colors">
                            → {humanizeSigName(s)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : deps.length === 0 ? (
                    <p className="text-[11px] text-gray-400 dark:text-zinc-500">Reads directly from the document · terminal (no downstream groups)</p>
                  ) : null}
                </div>
                );
              })()}

              {/* Field tab */}
              {sideTab === 'field' && !selectedFieldData && <p className="text-xs text-gray-400 dark:text-zinc-500">Click a field chip to inspect it.</p>}
              {sideTab === 'field' && selectedFieldData && (() => {
                const fname = selectedFieldData.field_name;
                return (
                <div className="flex flex-col gap-3">
                  <div>
                    <p className={ml}>Field</p>
                    <p className="font-semibold text-gray-900 dark:text-white mt-0.5">{(selectedFieldData as any).display_name || humanizeFieldName(fname)}</p>
                    <p className="font-mono text-xs text-gray-400 dark:text-zinc-500 mt-0.5">{fname}</p>
                  </div>
                  <div>
                    <p className={ml}>Type</p>
                    <span className={cn("text-xs px-2 py-0.5 rounded-md inline-flex items-center gap-1", selectedFieldData.field_type === 'array' ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300" : "bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-300")}>
                      {selectedFieldData.field_type === 'array' && <span className="text-[10px] leading-none">▦</span>}
                      {selectedFieldData.field_type === 'array' ? 'table' : selectedFieldData.field_type}
                    </span>
                  </div>
                  {selectedFieldData.field_type === 'array' && (() => {
                    const sfs: any[] = (selectedFieldData as any).subform_fields || [];
                    const autoAnchors = autoDetectAnchors(sfs);
                    const strategy = sfs.length > 5 ? 'row_then_columns' : 'single_call';
                    return (
                      <div className="flex flex-col gap-2">
                        <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/20 p-3 flex gap-2">
                          <span className="text-amber-600 dark:text-amber-400 text-base leading-none mt-0.5">▦</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Table field — extracted as one unit</p>
                            <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 leading-relaxed mt-1">
                              The whole table (parent + every subfield below) is handled by a single signature. The decomposer can&apos;t split subfields across groups — any wording change must address the entire table in one prompt.
                            </p>
                          </div>
                        </div>
                        {sfs.length > 0 && (
                          <div className="rounded-lg border border-blue-100 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-950/10 px-3 py-2.5">
                            <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider mb-1.5">Extraction strategy (auto-configured)</p>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", strategy === 'row_then_columns' ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300" : "bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-400")}>
                                {strategy === 'row_then_columns'
                                  ? `2-stage · 1 row call + ${sfs.length - autoAnchors.length} focused calls`
                                  : 'All-in-one (1 call)'
                                }
                              </span>
                            </div>
                            {strategy === 'row_then_columns' && autoAnchors.length > 0 && (
                              <div>
                                <p className="text-[10px] text-blue-600/70 dark:text-blue-400/60 mb-1">Anchor columns (Stage 1 — row discovery):</p>
                                <div className="flex flex-wrap gap-1">
                                  {autoAnchors.map((a:string) => <span key={a} className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-mono">{a}</span>)}
                                </div>
                              </div>
                            )}
                            <p className="text-[10px] text-blue-500/60 dark:text-blue-400/40 mt-1.5">Anchors shown are a preview — the final split is classified automatically during generation.</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {selectedFieldData.options && selectedFieldData.options.length > 0 && (
                    <div><p className={ml}>Options</p><div className="flex flex-wrap gap-1.5 mt-1">{selectedFieldData.options.map((o: string) => <span key={o} className="text-xs bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-300 px-2 py-0.5 rounded-md">{o}</span>)}</div></div>
                  )}
                  {Array.isArray((selectedFieldData as any).subform_fields) && (selectedFieldData as any).subform_fields.length > 0 && (
                    <div>
                      <p className={ml}>Subfields ({(selectedFieldData as any).subform_fields.length})</p>
                      <p className="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">All extracted together with the parent table.</p>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        {(selectedFieldData as any).subform_fields.map((sf: any, i: number) => (
                          <div key={`${sf.field_name || i}-${i}`} className="rounded-lg border border-gray-100 dark:border-[#1f1f1f] px-2.5 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-gray-700 dark:text-zinc-300 truncate">{sf.display_name || humanizeFieldName(sf.field_name || '')}</span>
                              <span className="ml-auto text-[10px] bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-400 px-1.5 py-0.5 rounded shrink-0">{sf.field_type || 'text'}</span>
                            </div>
                            {sf.field_name && <p className="font-mono text-[10px] text-gray-400 dark:text-zinc-600 mt-0.5 truncate">{sf.field_name}</p>}
                            {sf.field_description && <p className="text-[11px] text-gray-500 dark:text-zinc-500 leading-relaxed mt-1 whitespace-pre-wrap">{sf.field_description}</p>}
                            {Array.isArray(sf.options) && sf.options.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {sf.options.map((o: string) => <span key={o} className="text-[10px] bg-gray-50 dark:bg-[#181818] text-gray-500 dark:text-zinc-400 px-1.5 py-0.5 rounded">{o}</span>)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-gray-100 dark:border-[#1f1f1f] pt-3 flex flex-col gap-2">
                    <p className={ml}>Description</p>
                    <p className="text-xs text-gray-600 dark:text-zinc-400 whitespace-pre-wrap">
                      {selectedFieldData.field_description || <span className="text-gray-400 dark:text-zinc-500 italic">No description.</span>}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-1">Review only at this step. You&apos;ll refine description, hints, rules, and examples after the plan is approved.</p>
                  </div>

                </div>
                );
              })()}

              {/* Feedback tab */}
              {sideTab === 'feedback' && (
                <div className="flex flex-col gap-3">
                  <div>
                    <p className={cn(ml, "mb-1")}>What&apos;s wrong with this plan?</p>
                    <Textarea value={generalFeedback} onChange={e => setGeneralFeedback(e.target.value)} placeholder="Describe what should change — wrong grouping, missing field, bad stage order, redundant work. Hints/rules/examples come later." rows={6} className="resize-none text-xs" />
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-[#1a1a1a] bg-white dark:bg-[#111111] flex items-center justify-between px-6 py-4 flex-shrink-0 rounded-b-2xl shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.06)] dark:shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.4)]">
          <span className="text-xs text-gray-400 dark:text-zinc-500">
            {isStale
              ? <span className="text-amber-500 dark:text-amber-400">Form is {currentStatus} — already processed</span>
              : startedAgo ? <>Started {startedAgo}</> : <span />
            }
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Close</Button>
            <Button variant="secondary" size="sm" onClick={handleReject} loading={submitting} disabled={isStale}>
              Request Changes
            </Button>
            <Button size="sm" onClick={handleApprove} loading={submitting} disabled={isStale}>Approve plan</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Unified Edit Form Dialog ─────────────────────────────────────────────────
// One dialog for structural + calibration edits with diff-on-save routing.

// UEFCalField, UEFEditableField, FieldEditorPane, AutoTextarea, humanizeFieldName,
// and autoDetectAnchors live in '@/components/forms/FieldEditorPane' so they can be
// reused outside this Next.js page (page files can't export non-page symbols).

type UEFDiffKind = 'none' | 'calibration' | 'schema';

interface UEFDiff {
  kind: UEFDiffKind;
  schemaChanges: { added: string[]; removed: string[]; typeChanged: Array<{ field_name: string; from: string; to: string }> };
  calibrationChanges: string[];
  optionsChanged: string[];
  subfieldParentFields: string[];
}

function computeUEFDiff(
  original: Form,
  editedFields: UEFEditableField[],
  calState: Record<string, UEFCalField>,
  origCalState: Record<string, UEFCalField>,
  baselineFields?: UEFEditableField[],
): UEFDiff {
  const originalFields = baselineFields || original.fields.map(aliasFieldTypeRec);
  const origMap = new Map(originalFields.map(f => [f.field_name, f]));
  const activeEdited = editedFields.filter(f => !f._isDeleted);
  const editedMap = new Map(activeEdited.map(f => [f.field_name, f]));

  const added = activeEdited.filter(f => f._isNew).map(f => f.field_name);
  const removed = originalFields.filter(f => !editedMap.has(f.field_name)).map(f => f.field_name);
  const typeChanged: Array<{ field_name: string; from: string; to: string }> = [];
  const optionsChanged: string[] = [];
  const subfieldParentFields: string[] = [];

  for (const [fname, ef] of editedMap) {
    if (ef._isNew) continue;
    const orig = origMap.get(fname);
    if (!orig) continue;
    if (orig.field_type !== ef.field_type) {
      typeChanged.push({ field_name: fname, from: orig.field_type, to: ef.field_type });
    } else if (JSON.stringify(orig.options) !== JSON.stringify(ef.options)) {
      // Options are field-level metadata (like description/hints/rules), not a
      // pipeline-shape decision — save instantly, same as calibration edits.
      optionsChanged.push(fname);
    } else if (JSON.stringify(orig.subform_fields || []) !== JSON.stringify(ef.subform_fields || [])) {
      subfieldParentFields.push(fname);
    }
  }

  const calibrationChanges: string[] = [];
  for (const [fname, cal] of Object.entries(calState)) {
    const orig = origCalState[fname];
    if (!orig) continue;
    if (
      cal.description !== orig.description ||
      JSON.stringify(cal.hints) !== JSON.stringify(orig.hints) ||
      JSON.stringify(cal.rules) !== JSON.stringify(orig.rules) ||
      JSON.stringify(cal.examples) !== JSON.stringify(orig.examples)
    ) calibrationChanges.push(fname);
  }

  const hasSchema = added.length > 0 || removed.length > 0 || typeChanged.length > 0;
  const hasCalibration = calibrationChanges.length > 0 || subfieldParentFields.length > 0 || optionsChanged.length > 0;
  return {
    kind: hasSchema ? 'schema' : hasCalibration ? 'calibration' : 'none',
    schemaChanges: { added, removed, typeChanged },
    calibrationChanges,
    optionsChanged,
    subfieldParentFields,
  };
}

function EditFormDialog({
  form,
  existingForms,
  canManage,
  onClose,
  onSuccess,
}: {
  form: Form;
  existingForms: Form[];
  canManage: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isActive = form.status === 'active';
  const isDraftOrFailed = form.status === 'draft' || form.status === 'failed';
  const isReadOnly = !isActive && !isDraftOrFailed;

  // ── Structural state ──────────────────────────────────────────────────────
  const originalFields = useMemo(() => form.fields.map(aliasFieldTypeRec), [form.fields]);
  const [fields, setFields] = useState<UEFEditableField[]>(() => originalFields.map(f => ({ ...f })));
  const [origStructuralFields, setOrigStructuralFields] = useState<UEFEditableField[]>(() => originalFields.map(f => ({ ...f })));
  const [selectedIdx, setSelectedIdx] = useState<number>(0);

  // ── Calibration state ─────────────────────────────────────────────────────
  const [calState, setCalState] = useState<Record<string, UEFCalField>>(() => {
    const seed: Record<string, UEFCalField> = {};
    for (const f of form.fields) {
      seed[f.field_name] = {
        description: f.field_description || '',
        hints: (f as any).hints || [],
        rules: (f as any).rules || [],
        examples: ((f as any).examples || []).map((e: any) => typeof e === 'string' ? { value: e, source_text: '' } : e),
      };
    }
    return seed;
  });
  const [origCalState, setOrigCalState] = useState<Record<string, UEFCalField>>({});
  const [calLoading, setCalLoading] = useState(isActive);

  // Load field-prompts for active forms (overrides form.fields calibration data)
  useEffect(() => {
    if (!isActive) { setOrigCalState(JSON.parse(JSON.stringify(calState))); return; }
    (async () => {
      try {
        const data = await formsService.getFieldPrompts(form.id);
        const seed: Record<string, UEFCalField> = {};
        for (const [fname, fp] of Object.entries(data.field_prompts)) {
          seed[fname] = {
            description: fp.description || '',
            hints: fp.hints || [],
            rules: fp.rules || [],
            examples: (fp.examples || []).map((e: any) => typeof e === 'string' ? { value: e, source_text: '' } : e),
          };
        }
        setCalState(seed);
        setOrigCalState(JSON.parse(JSON.stringify(seed)));
        // Seed structural fields with enriched subform_fields from schema_def
        const enrichSubfields = (prev: UEFEditableField[]) => prev.map(f => {
          const fp = data.field_prompts[f.field_name];
          if (fp?.subform_fields?.length) return { ...f, subform_fields: fp.subform_fields as any as FormField[] };
          return f;
        });
        setFields(enrichSubfields);
        setOrigStructuralFields(enrichSubfields);
      } catch { /* use seeded from form.fields */ setOrigCalState(JSON.parse(JSON.stringify(calState))); }
      finally { setCalLoading(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id, isActive]);

  // ── Diff ─────────────────────────────────────────────────────────────────
  const diff = useMemo<UEFDiff>(() => {
    if (!isActive) return { kind: 'schema', schemaChanges: { added: [], removed: [], typeChanged: [] }, calibrationChanges: [], optionsChanged: [], subfieldParentFields: [] };
    if (calLoading) return { kind: 'none', schemaChanges: { added: [], removed: [], typeChanged: [] }, calibrationChanges: [], optionsChanged: [], subfieldParentFields: [] };
    return computeUEFDiff(form, fields, calState, origCalState, origStructuralFields);
  }, [isActive, calLoading, fields, calState, origCalState, form]);

  const isStructurallyLocked = isActive;

  // ── Add/remove field state (active forms) ─────────────────────────────────
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addPanel, setAddPanel] = useState({ field_name: '', display_name: '', field_type: 'text', target_signature_class: '', options: [] as string[], description: '', examples: [] as Array<{ value: string; source_text: string }> });
  const [addingField, setAddingField] = useState(false);
  const [addPanelError, setAddPanelError] = useState('');
  const [removeModal, setRemoveModal] = useState<null | { fieldName: string; consumers: string[]; phase: 'confirm' | 'blocked' }>(null);
  const [removingField, setRemovingField] = useState(false);

  // ── Saving ────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);

  const handleSave = async () => {
    if (isReadOnly) return;
    if (isDraftOrFailed) { await doStructuralSave(false); return; }
    // active form
    if (diff.kind === 'none') { onClose(); return; }
    if (diff.kind === 'schema') { setShowConfirm(true); return; }
    await doCalibrationSave();
  };

  const doCalibrationSave = async () => {
    setSaving(true);
    try {
      const fieldNamesToUpdate = Array.from(new Set([...diff.calibrationChanges, ...diff.optionsChanged]));
      if (fieldNamesToUpdate.length > 0) {
        const updates = fieldNamesToUpdate.map(fname => ({
          field_name: fname,
          description: calState[fname]?.description || '',
          hints: calState[fname]?.hints || [],
          rules: calState[fname]?.rules || [],
          examples: calState[fname]?.examples || [],
          ...(diff.optionsChanged.includes(fname)
            ? { options: fields.find(f => f.field_name === fname)?.options || [] }
            : {}),
        }));
        await formsService.updateFieldEdits(form.id, updates);
      }
      let droppedBlankCount = 0;
      for (const fname of diff.subfieldParentFields) {
        const editedField = fields.find(f => f.field_name === fname);
        if (!editedField) continue;
        const raw = editedField.subform_fields || [];
        const clean = raw
          .map((sf: any) => ({ ...sf, field_name: (sf.field_name || '').trim() }))
          .filter((sf: any) => sf.field_name);
        droppedBlankCount += raw.length - clean.length;
        const origLen = (origStructuralFields.find(f => f.field_name === fname)?.subform_fields || []).length;
        if (clean.length === 0 && origLen > 0) {
          toast({ title: 'Skipped', description: `Cannot remove all columns from "${fname}" via calibration edit.`, variant: 'error' });
          continue;
        }
        await formsService.updateSubfieldEdit(form.id, fname, clean);
      }
      toast({
        title: 'Saved',
        description: droppedBlankCount > 0 ? `Dropped ${droppedBlankCount} blank subfield row${droppedBlankCount === 1 ? '' : 's'}.` : undefined,
        variant: 'success',
      });
      onSuccess();
    } catch (err: any) { toast({ title: 'Error', description: getErrorMessage(err), variant: 'error' }); }
    finally { setSaving(false); }
  };

  const doStructuralSave = async (andRegen: boolean) => {
    setSaving(true);
    setShowConfirm(false);
    try {
      const validFields = fields.filter(f => !f._isDeleted).map(({ _isNew, _isDeleted, ...f }) => sanitizeFieldDeep(f as FormField));
      await formsService.update(form.id, { form_name: form.form_name, form_description: form.form_description || '', fields: validFields });
      if (andRegen) {
        await formsService.generateCode(form.id, form.metadata?.enable_review ?? false);
        toast({ title: 'Regenerating', description: 'Pipeline rebuild started.', variant: 'success' });
      } else {
        toast({ title: 'Saved', variant: 'success' });
      }
      onSuccess();
    } catch (err: any) { toast({ title: 'Error', description: getErrorMessage(err), variant: 'error' }); }
    finally { setSaving(false); }
  };

  // ── Field helpers ─────────────────────────────────────────────────────────
  const addField = () => {
    if (isActive) { setShowAddPanel(true); setAddPanelError(''); return; }
    const newF: UEFEditableField = { field_name: `new_field_${Date.now()}`, field_type: 'text', field_description: '', field_control_type: 'text_input', _isNew: true };
    setFields(prev => [...prev, newF]);
    setCalState(prev => ({ ...prev, [newF.field_name]: { description: '', hints: [], rules: [], examples: [] } }));
    setSelectedIdx(fields.length);
  };

  const handleAddSubmit = async () => {
    if (!addPanel.field_name.trim() || !addPanel.target_signature_class || !addPanel.description.trim()) {
      setAddPanelError('Field name, signature group, and description are required.');
      return;
    }
    setAddingField(true);
    setAddPanelError('');
    try {
      const validExamples = addPanel.examples.filter(e => e.value.trim());
      await formsService.addField(form.id, {
        field_name: addPanel.field_name.trim(),
        field_type: addPanel.field_type,
        target_signature_class: addPanel.target_signature_class,
        description: addPanel.description.trim(),
        ...(addPanel.display_name.trim() ? { display_name: addPanel.display_name.trim() } : {}),
        ...(addPanel.field_type === 'select' ? { options: addPanel.options.filter(Boolean) } : {}),
        ...(validExamples.length > 0 ? { examples: validExamples } : {}),
      });
      toast({ title: 'Field added', variant: 'success' });
      setShowAddPanel(false);
      setAddPanel({ field_name: '', display_name: '', field_type: 'text', target_signature_class: '', options: [], description: '', examples: [] });
      onSuccess();
    } catch (err: any) { setAddPanelError(getErrorMessage(err)); }
    finally { setAddingField(false); }
  };

  const handleRemoveClick = async (idx: number) => {
    const f = fields[idx];
    try {
      const deps = await formsService.getFieldDependencies(form.id, f.field_name);
      if (deps.consuming_signatures.length > 0) {
        setRemoveModal({ fieldName: f.field_name, consumers: deps.consuming_signatures, phase: 'blocked' });
      } else {
        setRemoveModal({ fieldName: f.field_name, consumers: [], phase: 'confirm' });
      }
    } catch (err: any) { toast({ title: 'Error', description: getErrorMessage(err), variant: 'error' }); }
  };

  const handleRemoveConfirm = async () => {
    if (!removeModal) return;
    setRemovingField(true);
    try {
      await formsService.removeField(form.id, removeModal.fieldName);
      toast({ title: 'Field removed', variant: 'success' });
      setRemoveModal(null);
      onSuccess();
    } catch (err: any) { toast({ title: 'Error', description: getErrorMessage(err), variant: 'error' }); }
    finally { setRemovingField(false); }
  };

  const toggleDelete = (idx: number) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, _isDeleted: !f._isDeleted } : f));
  };

  const updateField = (idx: number, patch: Partial<FormField>) => {
    setFields(prev => prev.map((f, i) => {
      if (i !== idx) return f;
      const updated = { ...f, ...patch };
      if (patch.field_type === 'select' && !updated.options) updated.options = [''];
      if (patch.field_type && patch.field_type !== 'select') delete updated.options;
      return updated;
    }));
  };

  const updateCal = (fname: string, patch: Partial<UEFCalField>) => {
    setCalState(prev => ({ ...prev, [fname]: { ...(prev[fname] || { description: '', hints: [], rules: [], examples: [] }), ...patch } }));
  };

  // ── Selected field ────────────────────────────────────────────────────────
  const visibleFields = fields;
  const selectedField = visibleFields[selectedIdx] ?? null;
  const selectedCal = selectedField ? (calState[selectedField.field_name] ?? { description: '', hints: [], rules: [], examples: [] }) : null;

  // ── Cost pill ─────────────────────────────────────────────────────────────
  const activeFieldCount = fields.filter(f => !f._isDeleted).length;
  const pillContent = (() => {
    if (!isActive || calLoading) return null;
    if (diff.kind === 'none') return null;
    if (diff.kind === 'calibration') {
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-full border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span><strong>Calibration update</strong> · no regeneration · ~1s save</span>
        </div>
      );
    }
    // schema
    const changes: string[] = [];
    diff.schemaChanges.added.forEach(n => changes.push(`Added: ${n}`));
    diff.schemaChanges.removed.forEach(n => changes.push(`Removed: ${n}`));
    diff.schemaChanges.typeChanged.forEach(t => changes.push(`Changed: ${t.field_name}`));
    const preview = changes.slice(0, 2).join(' · ') + (changes.length > 2 ? ` +${changes.length - 2} more` : '');
    return (
      <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20">
        <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          <span><strong>Schema change</strong> · regenerates pipeline · ~2–4 min · re-runs HITL review</span>
        </div>
        {preview && <p className="text-[11px] text-amber-600 dark:text-amber-400 pl-3.5">{preview}</p>}
      </div>
    );
  })();

  const saveLabel = (() => {
    if (saving) return 'Saving…';
    if (isReadOnly) return 'Close';
    if (isDraftOrFailed) return 'Save';
    if (diff.kind === 'none') return 'Done';
    if (diff.kind === 'schema') return 'Save →';
    return 'Save';
  })();

  const ml = "text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider";

  // Pipeline metadata for grouped rail
  const uefMeta = useMemo(() => {
    const m = typeof form.metadata === 'string' ? JSON.parse(form.metadata || '{}') : (form.metadata || {});
    return { pipeline: m?.decomposition?.pipeline || [], signatures: m?.decomposition?.signatures || [] };
  }, [form.metadata]);
  const [uefExpandedStages, setUefExpandedStages] = useState<Set<number>>(() => new Set(uefMeta.pipeline.map((s: any) => s.stage)));
  const [uefExpandedSigs, setUefExpandedSigs] = useState<Set<string>>(new Set(uefMeta.signatures.map((s: any) => s.name)));
  const fieldIndexByName = useMemo(() => {
    const m: Record<string, number> = {};
    fields.forEach((f, i) => { m[f.field_name] = i; });
    return m;
  }, [fields]);

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-[95vw] xl:max-w-[1500px] max-h-[95vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">{form.form_name}</h2>
                <span className="text-xs px-2 py-0.5 rounded-md bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-300 border border-gray-200 dark:border-[#2a2a2a] font-medium">Edit form</span>
                {isReadOnly && (
                  <span className="text-xs px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40 font-medium">Read-only while {form.status}</span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                {isActive ? 'Calibration edits save instantly. Use Add / Remove for structural changes.' : 'Edit fields, descriptions, hints, rules, and examples. Save when ready.'}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors p-1 shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Left rail */}
          <div className="w-[280px] shrink-0 flex flex-col min-h-0 border-r border-gray-100 dark:border-[#1a1a1a]">
            <div className="px-4 py-2.5 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a] flex items-center justify-between">
              <p className="text-xs text-gray-600 dark:text-zinc-400">
                <span className="font-semibold text-gray-800 dark:text-zinc-200">{activeFieldCount}</span> fields
              </p>
              {!isReadOnly && (
                <button type="button" onClick={addField} className="text-[11px] text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add field
                </button>
              )}
            </div>
            {/* Inline add-field panel for active forms */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {uefMeta.pipeline.length > 0 ? (
                // Pipeline-grouped view
                <>
                  {uefMeta.pipeline.map((stage: any, si: number) => {
                    const isOpen = uefExpandedStages.has(stage.stage);
                    const isLast = si === uefMeta.pipeline.length - 1;
                    const stageSigs = (stage.signatures || [])
                      .map((sn: string) => uefMeta.signatures.find((s: any) => s.name === sn))
                      .filter(Boolean);
                    return (
                      <div key={stage.stage} className="flex gap-0 mb-0.5">
                        <div className="flex flex-col items-center w-6 shrink-0 pt-[13px]">
                          <div className={cn("w-2 h-2 rounded-full ring-2 ring-white dark:ring-[#111111] shrink-0", isOpen ? "bg-sky-500 dark:bg-sky-400" : "bg-sky-200 dark:bg-sky-800")} />
                          {!isLast && <div className="w-px flex-1 mt-1 bg-gray-200 dark:bg-[#222]" />}
                        </div>
                        <div className="flex-1 pb-3 min-w-0 pl-1">
                          <button
                            type="button"
                            onClick={() => { const s = new Set(uefExpandedStages); s.has(stage.stage) ? s.delete(stage.stage) : s.add(stage.stage); setUefExpandedStages(s); }}
                            className="flex items-center gap-2 w-full py-1.5 px-1 rounded-lg hover:bg-black/[0.025] dark:hover:bg-white/[0.03] transition-colors"
                          >
                            <span className={cn("text-sm tracking-tight flex-1 text-left", isOpen ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-600 dark:text-zinc-400")}>Stage {stage.stage}</span>
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="shrink-0 text-gray-400 dark:text-zinc-500" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                          {isOpen && stageSigs.map((sig: any) => {
                            const sigOpen = uefExpandedSigs.has(sig.name);
                            const sigFieldNames = Object.keys(sig.fields || {});
                            return (
                              <div key={sig.name} className="ml-2 mb-1">
                                <button
                                  type="button"
                                  onClick={() => { const s = new Set(uefExpandedSigs); s.has(sig.name) ? s.delete(sig.name) : s.add(sig.name); setUefExpandedSigs(s); }}
                                  className="flex items-center gap-1.5 py-1 w-full hover:opacity-80"
                                >
                                  <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", sigOpen ? "bg-gray-600 dark:bg-zinc-300" : "bg-gray-300 dark:bg-zinc-600")} />
                                  <span className={cn("text-[12.5px] tracking-tight text-left flex-1", sigOpen ? "text-gray-800 dark:text-zinc-100 font-medium" : "text-gray-500 dark:text-zinc-500")}>{humanizeSigName(sig.name)}</span>
                                </button>
                                {sigOpen && (
                                  <div className="flex flex-wrap gap-1.5 mt-1 ml-3">
                                    {sigFieldNames.map((fname: string) => {
                                      const idx = fieldIndexByName[fname];
                                      if (idx === undefined) return null;
                                      const f = fields[idx];
                                      const isSelected = idx === selectedIdx;
                                      return (
                                        <button
                                          key={fname}
                                          type="button"
                                          onClick={() => setSelectedIdx(idx)}
                                          className={cn(
                                            "text-xs py-0.5 px-2 rounded-md transition-colors",
                                            isSelected ? "bg-gray-900 dark:bg-zinc-200 text-white dark:text-gray-900" : "text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-[#1a1a1a] hover:bg-gray-200 dark:hover:bg-[#222]",
                                            f?._isDeleted && "line-through opacity-50",
                                          )}
                                        >
                                          {f?.display_name || humanizeFieldName(fname)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {/* New fields not in pipeline */}
                  {fields.filter(f => f._isNew).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-[#1a1a1a]">
                      <p className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5 px-1">New fields</p>
                      <div className="flex flex-wrap gap-1.5">
                        {fields.map((f, idx) => f._isNew ? (
                          <button key={idx} type="button" onClick={() => setSelectedIdx(idx)}
                            className={cn("text-xs py-0.5 px-2 rounded-md transition-colors", idx === selectedIdx ? "bg-emerald-600 text-white" : "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50")}>
                            {f.display_name || humanizeFieldName(f.field_name)}
                          </button>
                        ) : null)}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                // Flat list fallback (draft/failed forms with no pipeline yet)
                <div className="flex flex-col gap-0.5">
                  {fields.map((f, idx) => {
                    const isSelected = idx === selectedIdx;
                    const typeGlyph = f.field_type === 'array' ? '▦' : f.field_type === 'select' ? '⊙' : '⊡';
                    const displayName = f.display_name || humanizeFieldName(f.field_name);
                    return (
                      <button key={idx} type="button" onClick={() => setSelectedIdx(idx)}
                        className={cn("w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors",
                          isSelected ? "bg-gray-900 dark:bg-zinc-200 text-white dark:text-gray-900" : "text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]",
                          f._isDeleted && "opacity-40 line-through")}>
                        <span className="text-xs text-gray-400 dark:text-zinc-500 shrink-0">{typeGlyph}</span>
                        <span className="flex-1 truncate">{f._isNew ? <em className="not-italic text-emerald-600 dark:text-emerald-400">{displayName}</em> : displayName}</span>
                        {f._isDeleted && <span className="text-[10px] text-red-400 shrink-0">del</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: editor */}
          <div className="flex-1 flex flex-col border-l border-gray-100 dark:border-[#1a1a1a] min-w-0">
            <div className="px-5 py-2.5 border-b border-gray-100 dark:border-[#1a1a1a] flex-shrink-0 flex items-center justify-between">
              <p className={ml}>Field editor</p>
              {selectedField && !isReadOnly && !selectedField._isNew && !showAddPanel && (
                <button
                  type="button"
                  onClick={() => isActive ? handleRemoveClick(selectedIdx) : toggleDelete(selectedIdx)}
                  className={cn("text-[11px] flex items-center gap-1 transition-colors", selectedField._isDeleted ? "text-emerald-500 hover:text-emerald-600" : "text-gray-500 dark:text-zinc-400 hover:text-red-500")}
                >
                  {selectedField._isDeleted ? '↩ Restore' : '× Remove field'}
                </button>
              )}
            </div>

            {showAddPanel && isActive ? (
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="mb-5">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Add field</h3>
                  <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">Provide a description — hints and rules are auto-generated from it (~3–8 s).</p>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <p className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Field name</p>
                      <input
                        value={addPanel.field_name}
                        onChange={e => setAddPanel(p => ({ ...p, field_name: e.target.value }))}
                        placeholder="snake_case_name"
                        autoFocus
                        className="w-full font-mono text-sm bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2 text-gray-800 dark:text-zinc-200 focus:outline-none focus:border-gray-400 dark:focus:border-zinc-500"
                      />
                    </div>
                    <div className="shrink-0">
                      <p className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Type</p>
                      <select
                        value={addPanel.field_type}
                        onChange={e => setAddPanel(p => ({ ...p, field_type: e.target.value }))}
                        className="bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-zinc-300 focus:outline-none"
                      >
                        <option value="text">text</option>
                        <option value="number">number</option>
                        <option value="boolean">boolean</option>
                        <option value="select">select</option>
                        <option value="array">table</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Display name <span className="normal-case font-normal text-gray-400 dark:text-zinc-500">(optional)</span></p>
                    <input
                      value={addPanel.display_name}
                      onChange={e => setAddPanel(p => ({ ...p, display_name: e.target.value }))}
                      placeholder="Human-readable label, e.g. Study Duration"
                      className="w-full text-sm bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2 text-gray-800 dark:text-zinc-200 focus:outline-none focus:border-gray-400 dark:focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Signature group</p>
                    <select
                      value={addPanel.target_signature_class}
                      onChange={e => setAddPanel(p => ({ ...p, target_signature_class: e.target.value }))}
                      className="w-full bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-zinc-300 focus:outline-none"
                    >
                      <option value="">— choose where this field lives —</option>
                      {uefMeta.signatures.map((sig: any) => {
                        const stageNum = uefMeta.pipeline.find((s: any) => (s.signatures || []).includes(sig.name))?.stage ?? '?';
                        const fieldList = Object.keys(sig.fields || {}).slice(0, 3).join(', ');
                        return (
                          <option key={sig.name} value={sig.name}>
                            Stage {stageNum} — {humanizeSigName(sig.name)}{fieldList ? ` (${fieldList}…)` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Description <span className="normal-case font-normal text-red-400">*</span></p>
                    <AutoTextarea
                      value={addPanel.description}
                      onChange={e => setAddPanel(p => ({ ...p, description: e.target.value }))}
                      placeholder="What should the LLM extract for this field? Be specific about meaning, units, format, etc."
                      className="w-full text-sm bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2 text-gray-800 dark:text-zinc-200 focus:outline-none focus:border-gray-400 dark:focus:border-zinc-500 resize-none overflow-hidden leading-relaxed"
                    />
                    <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-1">Hints and rules will be auto-generated from this description.</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Examples <span className="normal-case font-normal text-gray-400 dark:text-zinc-500">(optional)</span></p>
                    {addPanel.examples.map((ex, i) => (
                      <div key={i} className="flex gap-2 items-start mb-2">
                        <div className="flex-1 bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2">
                          <AutoTextarea
                            value={ex.value}
                            onChange={e => { const next = [...addPanel.examples]; next[i] = { ...next[i], value: e.target.value }; setAddPanel(p => ({ ...p, examples: next })); }}
                            placeholder="extracted value"
                            className="text-xs w-full bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed"
                          />
                          <AutoTextarea
                            value={ex.source_text}
                            onChange={e => { const next = [...addPanel.examples]; next[i] = { ...next[i], source_text: e.target.value }; setAddPanel(p => ({ ...p, examples: next })); }}
                            placeholder="exact quote from document…"
                            className="text-[11px] w-full bg-transparent text-gray-500 dark:text-zinc-400 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed mt-1"
                          />
                        </div>
                        <button type="button" onClick={() => setAddPanel(p => ({ ...p, examples: p.examples.filter((_, j) => j !== i) }))} className="text-gray-400 hover:text-red-400 transition-colors mt-2 shrink-0 bg-transparent border-none cursor-pointer p-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setAddPanel(p => ({ ...p, examples: [...p.examples, { value: '', source_text: '' }] }))} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors bg-transparent border-none cursor-pointer p-0">
                      + Add example
                    </button>
                  </div>
                  {addPanelError && (
                    <p className="text-xs text-red-500 -mt-1">{addPanelError}</p>
                  )}
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => { setShowAddPanel(false); setAddPanelError(''); }} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">
                      Cancel
                    </button>
                    <button disabled={addingField} onClick={handleAddSubmit} className="text-sm font-semibold px-5 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-90 border-none transition-colors disabled:opacity-40 flex items-center gap-2">
                      {addingField ? (<><div className="w-3.5 h-3.5 border-2 border-white/30 dark:border-gray-900/30 border-t-white dark:border-t-gray-900 rounded-full animate-spin" />Generating…</>) : 'Add field'}
                    </button>
                  </div>
                </div>
              </div>
            ) : calLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-5 h-5 border-2 border-gray-200 dark:border-zinc-700 border-t-gray-500 dark:border-t-zinc-400 rounded-full animate-spin" />
                  <p className="text-xs text-gray-400 dark:text-zinc-500">Loading field prompts…</p>
                </div>
              </div>
            ) : !selectedField ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-gray-400 dark:text-zinc-500">Select a field to edit.</p>
              </div>
            ) : (
              <FieldEditorPane
                field={selectedField}
                cal={selectedCal!}
                editable={!isReadOnly && !selectedField._isDeleted}
                structuralEditable={!isReadOnly && !selectedField._isDeleted && !isStructurallyLocked}
                onFieldPatch={patch => updateField(selectedIdx, patch)}
                onCalPatch={patch => updateCal(selectedField.field_name, patch)}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-[#1a1a1a] bg-white dark:bg-[#111111] flex items-center gap-3 px-6 py-4 flex-shrink-0 rounded-b-2xl">
          <div className="flex-1 flex items-center gap-2">
            {pillContent}
            <button
              type="button"
              onClick={() => {
                const json = JSON.stringify({
                  form_name: form.form_name,
                  form_description: form.form_description,
                  fields: fields.map(serializeFieldForCopy),
                }, null, 2);
                navigator.clipboard.writeText(json);
                setJsonCopied(true);
                setTimeout(() => setJsonCopied(false), 2000);
              }}
              className="flex items-center gap-1 text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors bg-transparent border-none cursor-pointer shrink-0"
            >
              {jsonCopied ? <ClipboardCheck className="w-3.5 h-3.5" /> : <Clipboard className="w-3.5 h-3.5" />}
              {jsonCopied ? 'Copied!' : 'Copy JSON'}
            </button>
            <button
              type="button"
              onClick={() => {
                const mergedFields = fields.map(f => {
                  const cal = calState[f.field_name];
                  return {
                    ...serializeFieldForCopy(f),
                    ...(cal ? {
                      field_description: cal.description || f.field_description,
                      ...(cal.hints?.length ? { hints: cal.hints } : {}),
                      ...(cal.rules?.length ? { rules: cal.rules } : {}),
                      ...(cal.examples?.length ? { examples: cal.examples } : {}),
                    } : {}),
                  };
                });
                const json = JSON.stringify({ form_name: form.form_name, form_description: form.form_description, fields: mergedFields }, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${form.form_name.replace(/\s+/g, '_').toLowerCase()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1 text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors bg-transparent border-none cursor-pointer shrink-0 ml-3"
            >
              <Download className="w-3.5 h-3.5" />
              Download Form
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">
              Cancel
            </button>
            {!isReadOnly && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className={cn(
                  "text-sm font-semibold px-5 py-2 rounded-lg transition-colors",
                  diff.kind === 'schema' && isActive
                    ? "bg-amber-500 hover:bg-amber-400 text-black border-none"
                    : "bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-90 border-none",
                  saving && "opacity-40 cursor-not-allowed"
                )}
              >
                {saveLabel}
              </button>
            )}
            {isDraftOrFailed && (
              <button
                type="button"
                disabled={saving}
                onClick={() => doStructuralSave(true)}
                className="text-sm font-semibold px-5 py-2 rounded-lg border-none bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Save & Generate'}
              </button>
            )}
          </div>
        </div>

        {/* Schema confirm modal */}
        {showConfirm && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-2xl z-10">
            <div className="bg-white dark:bg-[#111111] rounded-xl border border-gray-200 dark:border-[#2a2a2a] shadow-2xl w-[480px] p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Regenerate extraction pipeline?</h3>
              <p className="text-sm text-gray-500 dark:text-zinc-400 mb-4 leading-relaxed">This change rewrites the DSPy pipeline. The form will go through code generation and HITL review again.</p>
              <div className="rounded-lg bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-4 py-3 mb-4 space-y-1">
                {diff.schemaChanges.added.map(n => <p key={n} className="font-mono text-xs text-emerald-600 dark:text-emerald-400">+ Added: {n}</p>)}
                {diff.schemaChanges.removed.map(n => <p key={n} className="font-mono text-xs text-red-500">− Removed: {n}</p>)}
                {diff.schemaChanges.typeChanged.map(t => <p key={t.field_name} className="font-mono text-xs text-amber-600 dark:text-amber-400">↻ Changed: {t.field_name}</p>)}
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-5">Cost: ~2–4 min · re-runs decomposition review</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowConfirm(false)} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">
                  Cancel
                </button>
                <button disabled={saving} onClick={() => doStructuralSave(true)} className="text-sm font-semibold px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black border-none transition-colors disabled:opacity-40">
                  {saving ? 'Starting…' : 'Regenerate'}
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Remove field — blocked (has consumers) */}
        {removeModal?.phase === 'blocked' && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-2xl z-10">
            <div className="bg-white dark:bg-[#111111] rounded-xl border border-gray-200 dark:border-[#2a2a2a] shadow-2xl w-[420px] p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Cannot remove field</h3>
              <p className="text-sm text-gray-500 dark:text-zinc-400 mb-3 leading-relaxed">
                <span className="font-mono text-gray-700 dark:text-zinc-300">{removeModal.fieldName}</span> is consumed by downstream signatures:
              </p>
              <div className="rounded-lg bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-4 py-3 mb-4 space-y-1">
                {removeModal.consumers.map(s => <p key={s} className="font-mono text-xs text-amber-600 dark:text-amber-400">· {s}</p>)}
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mb-4">Remove or reassign those signatures first, then retry.</p>
              <div className="flex justify-end">
                <button onClick={() => setRemoveModal(null)} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Remove field — confirm */}
        {removeModal?.phase === 'confirm' && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-2xl z-10">
            <div className="bg-white dark:bg-[#111111] rounded-xl border border-gray-200 dark:border-[#2a2a2a] shadow-2xl w-[420px] p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Remove field?</h3>
              <p className="text-sm text-gray-500 dark:text-zinc-400 mb-4 leading-relaxed">
                Remove <span className="font-mono text-gray-700 dark:text-zinc-300">{removeModal.fieldName}</span>? Past extraction values will be hidden but kept in audit history.
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setRemoveModal(null)} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">
                  Cancel
                </button>
                <button disabled={removingField} onClick={handleRemoveConfirm} className="text-sm font-semibold px-5 py-2 rounded-lg bg-red-500 hover:bg-red-400 text-white border-none transition-colors disabled:opacity-40">
                  {removingField ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── HITL #1b — Prompt Refinement Dialog ──────────────────────────────────────
// Opens on active forms; seeds editors from signatures.py via GET /field-prompts.
// Auto-saves via existing PATCH /fields endpoint (which splices signatures.py).

// AutoTextarea is imported from @/components/forms/FieldEditorPane (top of file)

function PromptRefinementDialog({
  form,
  onClose,
}: {
  form: Form;
  onClose: () => void;
}) {
  const { toast } = useToast();

  type FieldEditState = {
    description: string;
    examples: { value: string; source_text?: string; note?: string }[];
    hints: string[];
    rules: string[];
  };
  type SaveState = 'dirty' | 'saving' | 'saved' | 'error';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldEdits, setFieldEdits] = useState<Record<string, FieldEditState>>({});
  const [fieldSaveState, setFieldSaveState] = useState<Record<string, SaveState>>({});
  const [fieldWarnings, setFieldWarnings] = useState<Record<string, string[]>>({});
  const [selectedField, setSelectedField] = useState<string | null>(null);

  const fieldEditsRef = useRef(fieldEdits);
  useEffect(() => { fieldEditsRef.current = fieldEdits; }, [fieldEdits]);
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const firstSaveToastedRef = useRef(false);
  const firstErrorToastedRef = useRef(false);

  // Fetch from signatures.py on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await formsService.getFieldPrompts(form.id);
        if (cancelled) return;
        const seed: Record<string, FieldEditState> = {};
        for (const [fname, fp] of Object.entries(data.field_prompts)) {
          seed[fname] = {
            description: fp.description || '',
            hints: fp.hints || [],
            rules: fp.rules || [],
            examples: (fp.examples || []).map((e: any) =>
              typeof e === 'string' ? { value: e, source_text: '' } : e
            ),
          };
        }
        setFieldEdits(seed);
        // Auto-select first field
        const first = Object.keys(seed)[0] || null;
        setSelectedField(first);
      } catch (err: any) {
        if (cancelled) return;
        const msg = err?.message || 'Failed to load field prompts';
        setLoadError(msg);
        if (msg.includes('409') || msg.toLowerCase().includes('not yet active') || msg.toLowerCase().includes('active')) {
          toast({ title: 'Form not active', description: 'Approve the decomposition plan first.', variant: 'error' });
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id]);

  const getEdits = (fname: string): FieldEditState =>
    fieldEdits[fname] || { description: '', examples: [], hints: [], rules: [] };

  const doSaveField = async (fname: string) => {
    setFieldSaveState(prev => ({ ...prev, [fname]: 'saving' }));
    try {
      const edits = fieldEditsRef.current[fname] || { description: '', examples: [], hints: [], rules: [] };
      const resp = await formsService.updateFieldEdits(form.id, [{
        field_name: fname,
        description: edits.description,
        examples: edits.examples,
        hints: edits.hints,
        rules: edits.rules,
      }]);
      const msgs = (resp.warnings || []).filter((w: any) => w.field === fname).map((w: any) => w.message);
      if (resp.extraction_warning) {
        toast({ title: 'Warning', description: resp.extraction_warning, variant: 'warning' });
      }
      setFieldWarnings(prev => ({ ...prev, [fname]: msgs }));
      setFieldSaveState(prev => ({ ...prev, [fname]: 'saved' }));
      setTimeout(() => setFieldSaveState(prev => {
        const next = { ...prev }; delete next[fname]; return next;
      }), 2000);
    } catch (err: any) {
      setFieldSaveState(prev => ({ ...prev, [fname]: 'error' }));
      if (firstErrorToastedRef.current) return;
      firstErrorToastedRef.current = true;
      const detail: string = err?.response?.data?.detail || err?.message || '';
      if (detail.includes('is generating') || detail.includes('is regenerating') || detail.includes('not allowed while form is')) {
        toast({ title: 'Cannot save', description: 'The form is currently regenerating — edits will be available once it finishes.', variant: 'error' });
      } else if (detail.includes('modified by another editor')) {
        toast({ title: 'Edit conflict', description: 'Another editor saved first — reload the dialog to get the latest version.', variant: 'error' });
      } else {
        toast({ title: 'Save failed', description: 'Could not save this edit. Try again or reload.', variant: 'error' });
      }
    }
  };

  // M12: flush all pending debounced saves immediately (used by Done button)
  const flushPendingSaves = async () => {
    const pending = Object.keys(saveTimersRef.current);
    if (pending.length === 0) return;
    firstErrorToastedRef.current = false;
    firstSaveToastedRef.current = false;
    pending.forEach(fname => {
      clearTimeout(saveTimersRef.current[fname]);
      delete saveTimersRef.current[fname];
    });
    await Promise.allSettled(pending.map(fname => doSaveField(fname)));
  };

  const scheduleFieldSave = (fname: string) => {
    if (saveTimersRef.current[fname]) clearTimeout(saveTimersRef.current[fname]);
    setFieldSaveState(prev => ({ ...prev, [fname]: 'dirty' }));
    saveTimersRef.current[fname] = setTimeout(() => {
      firstErrorToastedRef.current = false;
      firstSaveToastedRef.current = false;
      doSaveField(fname);
    }, 800);
  };

  const accentColor = (fname: string) => {
    const s = fieldSaveState[fname];
    if (s === 'dirty') return '#f59e0b';
    if (s === 'saving') return '#3b82f6';
    if (s === 'saved') return '#10b981';
    if (s === 'error') return '#ef4444';
    return 'transparent';
  };

  const handleClose = () => {
    const pending = Object.values(fieldSaveState).some(s => s === 'dirty' || s === 'saving');
    if (pending && !window.confirm('Some edits are still saving — close anyway?')) return;
    Object.values(saveTimersRef.current).forEach(clearTimeout);
    saveTimersRef.current = {};
    onClose();
  };

  const handleDone = async () => {
    await flushPendingSaves();
    onClose();
  };

  const metadata = useMemo(() => {
    if (typeof form.metadata === 'string') { try { return JSON.parse(form.metadata); } catch { return {}; } }
    return form.metadata || {};
  }, [form.metadata]);

  const signatures = metadata?.decomposition?.signatures || [];
  const pipeline = useMemo(() => metadata?.decomposition?.pipeline || [], [metadata]);
  const [expandedStages, setExpandedStages] = useState<Set<number>>(() =>
    new Set(pipeline.map((s: any) => s.stage))
  );
  const [expandedSignatures, setExpandedSignatures] = useState<Set<string>>(new Set());

  const ml = "text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider";

  const fieldNames = Object.keys(fieldEdits);

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-[95vw] xl:max-w-[1500px] max-h-[95vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">{form.form_name}</h2>
                <span className="text-xs px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 border border-violet-200/60 dark:border-violet-800/40 font-medium">Edit Instructions</span>
              </div>
              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">
                Edit the description, hints, rules, and examples the extractor uses for each field. Changes apply to the next extraction run — no rebuild needed.
              </p>
            </div>
            <button type="button" onClick={handleClose} className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-300 transition-colors p-1 shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Left: field list */}
          <div className="w-[280px] shrink-0 flex flex-col min-h-0">
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-5 h-5 border-2 border-gray-200 dark:border-zinc-700 border-t-gray-500 dark:border-t-zinc-400 rounded-full animate-spin" />
                  <p className="text-xs text-gray-400 dark:text-zinc-500">Loading field prompts…</p>
                </div>
              </div>
            ) : loadError ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <p className="text-sm text-red-500">{loadError}</p>
              </div>
            ) : (
              <>
                <div className="px-6 py-2.5 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a]">
                  <p className="text-xs text-gray-400 dark:text-zinc-500">
                    <span className="font-semibold text-gray-700 dark:text-zinc-300">{fieldNames.length}</span> fields · click a field to edit its prompt
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {pipeline.length > 0 ? (
                    pipeline.map((stage: any, si: number) => {
                      const isOpen = expandedStages.has(stage.stage);
                      const isLastStage = si === pipeline.length - 1;
                      const stageSignatures = (stage.signatures || []).map((sigName: string) => signatures.find((s: any) => s.name === sigName)).filter(Boolean);
                      return (
                        <div key={stage.stage} className="flex gap-0">
                          <div className="flex flex-col items-center w-7 shrink-0 pt-[14px]">
                            <div className={cn("w-2.5 h-2.5 shrink-0 rounded-full ring-2 ring-white dark:ring-[#111111]", isOpen ? "bg-sky-500 dark:bg-sky-400" : "bg-sky-200 dark:bg-sky-900")} />
                            {!isLastStage && <div className="w-px flex-1 mt-1 bg-gray-200 dark:bg-[#222]" />}
                          </div>
                          <div className="flex-1 pb-4 min-w-0">
                            <div className="flex items-center gap-2 py-1.5 pr-2 pl-1 cursor-pointer rounded-lg -ml-1 hover:bg-black/[0.025] dark:hover:bg-white/[0.03] transition-colors" onClick={() => {
                              const s = new Set(expandedStages);
                              s.has(stage.stage) ? s.delete(stage.stage) : s.add(stage.stage);
                              setExpandedStages(s);
                            }}>
                              <span className={cn("text-sm tracking-tight flex-1", isOpen ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-500 dark:text-zinc-400")}>Stage {stage.stage}</span>
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 text-gray-300 dark:text-zinc-600 transition-transform duration-200" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </div>
                            {isOpen && stageSignatures.map((sig: any) => {
                              const sigOpen = expandedSignatures.has(sig.name);
                              const sigFields = Object.keys(sig.fields || {}).filter(f => f in fieldEdits);
                              return (
                                <div key={sig.name} className="ml-2 mb-2">
                                  <div className="flex items-center gap-1.5 py-1 cursor-pointer" onClick={() => {
                                    const s = new Set(expandedSignatures);
                                    s.has(sig.name) ? s.delete(sig.name) : s.add(sig.name);
                                    setExpandedSignatures(s);
                                  }}>
                                    <div className={cn("w-1.5 h-1.5 rounded-full", sigOpen ? "bg-gray-600 dark:bg-zinc-300" : "bg-gray-300 dark:bg-zinc-600")} />
                                    <span className={cn("text-[13px] tracking-tight", sigOpen ? "text-gray-800 dark:text-zinc-100 font-medium" : "text-gray-400 dark:text-zinc-500")}>{humanizeSigName(sig.name)}</span>
                                  </div>
                                  {sigOpen && sigFields.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-1 ml-3">
                                      {sigFields.map((f: string) => {
                                        const bar = accentColor(f);
                                        const isSelected = selectedField === f;
                                        return (
                                          <button
                                            key={f}
                                            type="button"
                                            onClick={() => setSelectedField(f)}
                                            style={bar !== 'transparent' ? { borderLeft: `3px solid ${bar}`, paddingLeft: '5px' } : undefined}
                                            className={cn(
                                              "text-xs py-0.5 px-2 rounded-md transition-colors",
                                              isSelected
                                                ? "bg-gray-900 dark:bg-zinc-200 text-white dark:text-gray-900"
                                                : "text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] hover:bg-gray-100 dark:hover:bg-[#222]"
                                            )}
                                          >
                                            {form.fields.find(ff => ff.field_name === f)?.display_name || humanizeFieldName(f)}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    // Flat list fallback if no pipeline metadata
                    <div className="flex flex-wrap gap-1.5">
                      {fieldNames.map(f => {
                        const bar = accentColor(f);
                        const isSelected = selectedField === f;
                        return (
                          <button key={f} type="button" onClick={() => setSelectedField(f)}
                            style={bar !== 'transparent' ? { borderLeft: `3px solid ${bar}`, paddingLeft: '5px' } : undefined}
                            className={cn("text-xs py-0.5 px-2 rounded-md transition-colors", isSelected ? "bg-gray-900 dark:bg-zinc-200 text-white dark:text-gray-900" : "text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] hover:bg-gray-100 dark:hover:bg-[#222]")}>
                            {form.fields.find(ff => ff.field_name === f)?.display_name || humanizeFieldName(f)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Right: field editor */}
          <div className="flex-1 flex flex-col border-l border-gray-100 dark:border-[#1a1a1a] min-w-0">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-[#1a1a1a] flex-shrink-0">
              <p className={ml}>Field editor</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 pb-6">
              {!selectedField || !fieldEdits[selectedField] ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500">Select a field to edit its extraction prompt.</p>
              ) : (() => {
                const fname = selectedField;
                const edits = getEdits(fname);
                const warns = fieldWarnings[fname] || [];
                const saveState = fieldSaveState[fname];
                const fieldMeta = form.fields.find(ff => ff.field_name === fname);

                const updateEdits = (patch: Partial<FieldEditState>) => {
                  setFieldEdits(prev => ({ ...prev, [fname]: { ...getEdits(fname), ...patch } }));
                  scheduleFieldSave(fname);
                };

                const isTableField = fieldMeta?.field_type === 'array';
                const subformFields: any[] = isTableField && Array.isArray((fieldMeta as any).subform_fields) ? (fieldMeta as any).subform_fields : [];

                return (
                  <div className="flex flex-col gap-0">

                    {/* ── Field identity ── */}
                    <div className="pb-4 mb-4 border-b border-gray-100 dark:border-[#1f1f1f]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className={ml}>Field</p>
                          <p className="font-semibold text-gray-900 dark:text-white mt-0.5 text-base leading-snug">{fieldMeta?.display_name || humanizeFieldName(fname)}</p>
                          <p className="font-mono text-xs text-gray-400 dark:text-zinc-500 mt-0.5">{fname}</p>
                        </div>
                        {fieldMeta?.field_type && (
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-md font-medium shrink-0 mt-1",
                            isTableField
                              ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40"
                              : "bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-300"
                          )}>
                            {isTableField ? '▦ table' : fieldMeta.field_type}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ── Table callout ── */}
                    {isTableField && (
                      <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-4 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-amber-600 dark:text-amber-400">▦</span>
                          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Table field — extracted as one unit</p>
                        </div>
                        <p className="text-xs text-amber-700/80 dark:text-amber-300/70 leading-relaxed">
                          The whole table (one row per entry) is handled by a single signature.
                          Hints, rules, and examples below apply to the entire table.
                          To rename columns or change types, use <strong>Edit Form</strong> — that triggers a rebuild.
                        </p>
                      </div>
                    )}

                    {/* ── Subfields ── */}
                    {isTableField && subformFields.length > 0 && (
                      <div className="mb-5">
                        <p className={cn(ml, "mb-1")}>Subfields ({subformFields.length})</p>
                        <p className="text-[11px] text-gray-400 dark:text-zinc-500 mb-3">All extracted together with the parent table.</p>
                        <div className="flex flex-col gap-2">
                          {subformFields.map((sf: any, i: number) => (
                            <div key={i} className="rounded-lg border border-gray-100 dark:border-[#1f1f1f] bg-white dark:bg-[#0d0d0d] p-3">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <p className="text-sm font-semibold text-gray-800 dark:text-zinc-100 leading-snug">{sf.display_name || humanizeFieldName(sf.field_name)}</p>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#1f1f1f] text-gray-500 dark:text-zinc-400 shrink-0">{sf.field_type || 'text'}</span>
                              </div>
                              <p className="font-mono text-[11px] text-gray-400 dark:text-zinc-500 mb-1">{sf.field_name}</p>
                              {sf.field_description && (
                                <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">{sf.field_description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Edit prompt ── */}
                    <div className={cn("flex flex-col gap-4", isTableField && "border-t border-gray-100 dark:border-[#1f1f1f] pt-4")}>
                      <div className="flex items-center justify-between">
                        <p className={ml}>Edit prompt</p>
                        {saveState && (
                          <span className="text-[10px]" style={{ color: accentColor(fname) }}>
                            {saveState === 'dirty' ? 'Unsaved' : saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Error'}
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Description</p>
                        <Textarea value={edits.description} onChange={e => updateEdits({ description: e.target.value })} placeholder="What this field captures…" rows={3} className="resize-none text-xs leading-relaxed" />
                      </div>

                      {/* Hints */}
                      <div className="flex flex-col gap-2">
                        <p className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Extraction Hints</p>
                        {edits.hints.length === 0 && <p className="text-[11px] text-gray-300 dark:text-zinc-600 italic">No hints yet — add where/how to find this value.</p>}
                        {edits.hints.map((h, i) => (
                          <div key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-3 py-2">
                            <span className="text-gray-500 dark:text-zinc-400 text-xs mt-0.5 shrink-0">→</span>
                            <AutoTextarea value={h} onChange={e => { const next = [...edits.hints]; next[i] = e.target.value; updateEdits({ hints: next }); }} placeholder="where or how to locate this value…" className="flex-1 text-xs bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                            <button type="button" onClick={() => updateEdits({ hints: edits.hints.filter((_, idx) => idx !== i) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => updateEdits({ hints: [...edits.hints, ''] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add hint</button>
                      </div>

                      {/* Rules */}
                      <div className="flex flex-col gap-2">
                        <p className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Rules</p>
                        {edits.rules.length === 0 && <p className="text-[11px] text-gray-300 dark:text-zinc-600 italic">No rules yet — add hard constraints on format or values.</p>}
                        {edits.rules.map((r, i) => (
                          <div key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-3 py-2">
                            <span className="text-gray-500 dark:text-zinc-400 text-xs mt-0.5 shrink-0">·</span>
                            <AutoTextarea value={r} onChange={e => { const next = [...edits.rules]; next[i] = e.target.value; updateEdits({ rules: next }); }} placeholder="must / must-not constraint…" className="flex-1 text-xs bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                            <button type="button" onClick={() => updateEdits({ rules: edits.rules.filter((_, idx) => idx !== i) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => updateEdits({ rules: [...edits.rules, ''] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add rule</button>
                      </div>

                      {/* Examples */}
                      <div className="flex flex-col gap-2">
                        <p className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Examples</p>
                        {edits.examples.length === 0 && <p className="text-[11px] text-gray-300 dark:text-zinc-600 italic">No examples yet — add value + source quote pairs.</p>}
                        {edits.examples.map((ex, i) => (
                          <div key={i} className="rounded-lg border border-gray-100 dark:border-[#1f1f1f] overflow-hidden">
                            <div className="flex items-start gap-2 bg-gray-50 dark:bg-[#141414] px-3 py-2 border-b border-gray-100 dark:border-[#1f1f1f]">
                              <div className="flex-1 flex flex-col gap-0.5">
                                <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">Value</p>
                                <AutoTextarea value={String(ex.value ?? '')} onChange={e => { const next = [...edits.examples]; next[i] = { ...next[i], value: e.target.value }; updateEdits({ examples: next }); }} placeholder="extracted value" className="text-xs bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                              </div>
                              <button type="button" onClick={() => updateEdits({ examples: edits.examples.filter((_, idx) => idx !== i) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 mt-4 shrink-0"><X className="h-3 w-3" /></button>
                            </div>
                            <div className="px-3 py-2 bg-white dark:bg-[#0d0d0d]">
                              <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-0.5">Source quote (optional)</p>
                              <AutoTextarea value={ex.source_text || ''} onChange={e => { const next = [...edits.examples]; next[i] = { ...next[i], source_text: e.target.value }; updateEdits({ examples: next }); }} placeholder="exact text from the document…" className="text-[11px] w-full bg-transparent text-gray-500 dark:text-zinc-400 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                            </div>
                          </div>
                        ))}
                        <button type="button" onClick={() => updateEdits({ examples: [...edits.examples, { value: '', source_text: '' }] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add example</button>
                      </div>

                      {warns.length > 0 && (
                        <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 p-3">
                          {warns.map((w, i) => <p key={i} className="text-[11px] text-amber-700 dark:text-amber-300">{w}</p>)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-[#1a1a1a] bg-white dark:bg-[#111111] flex items-center justify-between px-6 py-4 flex-shrink-0 rounded-b-2xl">
          <p className="text-xs text-gray-400 dark:text-zinc-500">
            Changes apply to the extraction prompt — no rebuild needed.
          </p>
          <Button size="sm" onClick={handleDone}>Done</Button>
        </div>
      </div>
    </div>
  );
}

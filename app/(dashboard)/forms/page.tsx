'use client';

import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { formsService } from '@/services';
import { Form, CreateFormRequest, FormField } from '@/types/api';
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
} from '@/components/ui';
import { Plus, Trash2, FileText, Code, AlertCircle, Check, Edit3, ThumbsUp, ThumbsDown, MessageSquare, ChevronDown, ChevronUp, ChevronRight, X } from 'lucide-react';
import { JobLogsViewer } from '@/components/JobLogsViewer';
import PilotStudyDialog from '@/components/pilot/PilotStudyDialog';
import { cn, formatDate, getErrorMessage } from '@/lib/utils';
import { typography } from '@/lib/typography';
import { statusColors, statusBgs } from '@/lib/colors';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';

export default function FormsPage() {
  const { selectedProject } = useProject();
  const { can_create_forms, can_view_docs } = useProjectPermissions();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [openForm, setOpenForm] = useState<Form | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobFormId, setActiveJobFormId] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState<Form | null>(null);
  const [pilotForm, setPilotForm] = useState<Form | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

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
      return data.some((f: Form) => f.status === 'generating' || f.status === 'regenerating' || f.status === 'awaiting_review') ? 2000 : false;
    },
    placeholderData: keepPreviousData,
  });

  const error = queryError ? getErrorMessage(queryError as any, 'Failed to load forms') : null;

  const filteredForms = forms;

  const handleGenerateCode = async (formId: string, enableReview?: boolean) => {
    try {
      const response = await formsService.generateCode(formId, enableReview);

      // Set active job ID for live log streaming
      if (response.job_id) {
        setActiveJobId(response.job_id);
        setActiveJobFormId(formId);
      }

      toast({
        title: 'Code Generation Started',
        description: 'AI is generating extraction code. Watch the progress below!',
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
      await formsService.approveDecomposition(formId);
      toast({
        title: 'Decomposition Approved',
        description: 'Continuing with code generation...',
        variant: 'success',
      });
      setReviewForm(null);
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
    } catch (err: any) {
      console.error('Failed to approve decomposition:', err);
      toast({
        title: 'Error',
        description: getErrorMessage(err, 'Failed to approve decomposition'),
        variant: 'error',
      });
    }
  };

  const handleRejectDecomposition = async (formId: string, feedback: string) => {
    try {
      await formsService.rejectDecomposition(formId, feedback);
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
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-3" />
          <p className="text-yellow-800 font-medium">No project selected</p>
          <p className="text-yellow-600 text-sm mt-1">
            Please select a project from the dropdown above to manage forms.
          </p>
        </div>
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
            {can_create_forms && (
            <button
              onClick={() => setShowCreateDialog(true)}
              className="text-sm font-semibold text-white bg-gray-900 dark:bg-white dark:text-black border-none rounded-lg px-4 py-2 cursor-pointer flex items-center gap-1.5 hover:bg-gray-700 dark:hover:bg-zinc-100 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create Form
            </button>
            )}
          </div>

          {/* Live Log Streaming */}
          {activeJobId && (
            <div className="mb-6">
              <JobLogsViewer
                jobId={activeJobId}
                onComplete={(status) => {
                  setActiveJobId(null);
                  setActiveJobFormId(null);
                  queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
                  if (status === 'awaiting_review') {
                    toast({
                      title: 'Review Required',
                      description: 'Code generation is paused. Please review and approve the decomposition plan.',
                      variant: 'warning',
                    });
                  }
                }}
              />
            </div>
          )}

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
                          onEdit={(form) => setOpenForm(form)}
                          onPilot={(form) => setPilotForm(form)}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* In Progress Section */}
              {filteredForms.filter(f => f.status === 'generating' || f.status === 'regenerating').length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
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
                          onEdit={(form) => setOpenForm(form)}
                          onPilot={(form) => setPilotForm(form)}
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
                          onEdit={(form) => setOpenForm(form)}
                          onPilot={(form) => setPilotForm(form)}
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
                          onEdit={(form) => setOpenForm(form)}
                          onPilot={(form) => setPilotForm(form)}
                        />
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showCreateDialog && (
        <CreateFormDialog
          projectId={selectedProject.id}
          existingForms={forms}
          onClose={() => setShowCreateDialog(false)}
          onSuccess={() => {
            setShowCreateDialog(false);
            queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
          }}
        />
      )}

      {openForm && (
        <FormDialog
          form={openForm}
          existingForms={forms}
          onClose={() => setOpenForm(null)}
          onSuccess={() => {
            setOpenForm(null);
            queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
          }}
          onUpdate={handleUpdateForm}
          onGenerateCode={handleGenerateCode}
          onDelete={handleDeleteForm}
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
    </DashboardLayout>
  );
}

// Form Card Component
function FormCard({
  form,
  onGenerateCode,
  onDelete,
  onClick,
  onReview,
  onEdit,
  onPilot,
}: {
  form: Form;
  onGenerateCode: (id: string, enableReview?: boolean) => void;
  onDelete: (id: string) => void;
  onClick: () => void;
  onReview?: (form: Form) => void;
  onEdit?: (form: Form) => void;
  onPilot?: (form: Form) => void;
}) {
  const [showError, setShowError] = useState(false);

  const isGenerating = form.status === 'generating' || form.status === 'regenerating';

  const elapsedLabel = (dateStr: string) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'just started';
    if (mins === 1) return '1 min';
    return `${mins} min`;
  };

  const statusConfig: Record<string, { label: string; cls: string }> = {
    draft: { label: 'Draft', cls: 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]' },
    generating: { label: 'Generating', cls: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50' },
    awaiting_review: { label: 'Review', cls: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50' },
    regenerating: { label: 'Regenerating', cls: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50' },
    active: { label: 'Active', cls: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50' },
    failed: { label: 'Failed', cls: 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/50' },
  };

  const s = statusConfig[form.status];
  const isFailed = form.status === 'failed';
  const isDraft = form.status === 'draft';
  const isReview = form.status === 'awaiting_review';

  const timeAgo = (dateStr: string) => {
    const now = new Date();
    const d = new Date(dateStr);
    const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };


  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-gray-200 flex flex-col transition-all duration-150 relative overflow-hidden dark:bg-[#111111] dark:border-[#1f1f1f]",
        isFailed && "border-l-[4px] border-l-purple-500 dark:border-l-purple-400 bg-gradient-to-r from-purple-50 to-white dark:from-purple-400/10 dark:to-[#111111]",
        isReview && "border-l-[4px] border-l-amber-500 dark:border-l-amber-400 bg-gradient-to-r from-amber-50 to-white dark:from-amber-400/10 dark:to-[#111111]",
        isDraft && "border-l-[4px] border-l-gray-400 dark:border-l-zinc-500",
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
        <p className="text-sm text-gray-400 mb-3.5 leading-relaxed line-clamp-2">{form.form_description || 'No description'}</p>

        {/* Meta */}
        <div className={cn("flex items-center gap-2.5 text-xs text-gray-400", isFailed || isReview ? "mb-3.5" : "mb-[18px]")}>
          <span className="flex items-center gap-1">
            <span className="text-gray-500 font-medium">{form.fields.length}</span> fields
          </span>
          <span className="text-gray-200">&middot;</span>
          <span>{formatDate(form.created_at)}</span>
          {form.updated_at && form.updated_at !== form.created_at && (
            <>
              <span className="text-gray-200">&middot;</span>
              <span className="flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#ccc" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="8" cy="8" r="6" /><path d="M8 5v3.5l2.5 1.5" />
                </svg>
                {timeAgo(form.updated_at)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Error for failed */}
      {isFailed && form.error && (
        <div className="px-[22px] pb-3.5">
          <div
            onClick={(e) => { e.stopPropagation(); setShowError(!showError); }}
            className="flex items-center gap-2 p-2.5 px-3.5 rounded-lg bg-purple-50 border border-purple-200 cursor-pointer dark:bg-purple-900/20 dark:border-purple-800/50"
          >
            <div className="w-[5px] h-[5px] rounded-full bg-purple-500 shrink-0" />
            <span className={cn(
              "text-xs text-purple-700 dark:text-purple-400 flex-1 font-medium leading-[1.4]",
              !showError && "overflow-hidden text-ellipsis whitespace-nowrap",
            )}>{form.error}</span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 opacity-30 transition-transform duration-200 text-gray-700 dark:text-zinc-400" style={{
              transform: showError ? "rotate(180deg)" : "rotate(0)",
            }}>
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}

      {/* Draft CTA */}
      {isDraft && (
        <div className="px-[22px] pb-3.5">
          <button
            onClick={e => { e.stopPropagation(); onGenerateCode(form.id); }}
            className="w-full text-sm font-semibold rounded-lg py-2.5 cursor-pointer flex items-center justify-center gap-2 transition-all duration-200 hover:-translate-y-px text-white border-none bg-gradient-to-br from-gray-700 to-gray-900 shadow-[0_4px_14px_rgba(0,0,0,0.18)] dark:from-zinc-600 dark:to-zinc-800"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 7 8 3 12 7"/><polyline points="4 13 8 9 12 13"/>
            </svg>
            Generate Code
          </button>
        </div>
      )}

      {/* Review CTA */}
      {isReview && onReview && (
        <div className="px-[22px] pb-3.5">
          <button
            onClick={e => { e.stopPropagation(); onReview(form); }}
            className="w-full text-sm font-semibold rounded-lg py-2.5 cursor-pointer flex items-center justify-center gap-2 transition-all duration-200 hover:-translate-y-px text-white border-none bg-gradient-to-br from-amber-500 to-orange-500 shadow-[0_4px_14px_rgba(245,158,11,0.35)] dark:from-amber-600 dark:to-orange-600 dark:shadow-[0_4px_14px_rgba(217,119,6,0.25)]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            Review Schema
          </button>
        </div>
      )}

      {/* Generating progress indicator */}
      {isGenerating && (
        <div className="px-[22px] pb-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
              {form.status === 'regenerating' ? 'Regenerating code…' : 'Generating code…'} (~5–10 min)
            </span>
            <span className="text-xs text-gray-400 dark:text-zinc-500 ml-auto shrink-0">{elapsedLabel(form.updated_at)}</span>
          </div>
          <div className="h-[3px] w-full rounded-full bg-blue-100 dark:bg-blue-900/30 overflow-hidden">
            <div className="h-full w-full rounded-full bg-gradient-to-r from-blue-400 via-indigo-400 to-blue-400 animate-[shimmer_2s_linear_infinite]" style={{ backgroundSize: '200% 100%' }} />
          </div>
        </div>
      )}

      {/* Pilot CTA for active forms */}
      {form.status === 'active' && onPilot && (() => {
        const meta = typeof form.metadata === 'string' ? JSON.parse(form.metadata || '{}') : (form.metadata || {});
        const pilot = meta.pilot;
        const pilotStatus = pilot?.status;
        const totalExamples = pilot?.field_examples ? Object.values(pilot.field_examples as Record<string, any[]>).reduce((s: number, arr: any[]) => s + arr.length, 0) : 0;
        const fieldsCalibrated = pilot?.field_examples ? Object.keys(pilot.field_examples).length : 0;

        if (pilotStatus === 'completed') {
          return (
            <div className="px-[22px] pb-3.5">
              <button
                onClick={e => { e.stopPropagation(); onPilot(form); }}
                className="w-full flex items-center gap-2 p-2.5 px-3.5 rounded-lg bg-green-50 border border-green-200 dark:bg-green-900/10 dark:border-green-800/30 cursor-pointer transition-colors hover:bg-green-100 dark:hover:bg-green-900/20"
              >
                <div className="w-[5px] h-[5px] rounded-full bg-green-500 shrink-0" />
                <span className="text-xs text-green-700 dark:text-green-400 font-medium flex-1 text-left">
                  Calibrated &middot; {totalExamples} examples &middot; {fieldsCalibrated} fields
                </span>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-green-400 shrink-0">
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          );
        } else if (pilotStatus === 'running' || pilotStatus === 'reviewing') {
          return (
            <div className="px-[22px] pb-3.5">
              <button
                onClick={e => { e.stopPropagation(); onPilot(form); }}
                className="w-full flex items-center gap-2 p-2.5 px-3.5 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/10 dark:border-amber-800/30 cursor-pointer transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/20"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                <span className="text-xs text-amber-700 dark:text-amber-400 font-medium flex-1 text-left">
                  Pilot in progress &middot; Iteration {pilot?.current_iteration || 1}
                </span>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-amber-400 shrink-0">
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          );
        } else {
          return (
            <div className="px-[22px] pb-3.5">
              <button
                onClick={e => { e.stopPropagation(); onPilot(form); }}
                className="w-full text-xs font-medium rounded-lg py-2.5 cursor-pointer flex items-center justify-center gap-2 transition-all duration-200 hover:-translate-y-px text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#0a0a0a] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 14 8 5 13" />
                </svg>
                Run Pilot
              </button>
            </div>
          );
        }
      })()}

      {/* Footer */}
      <div className="flex items-center justify-end gap-0.5 py-2.5 px-[18px] border-t border-gray-100 mt-auto dark:border-[#1f1f1f]">
        {isFailed && (
          <button onClick={e => { e.stopPropagation(); onGenerateCode(form.id); }} className={cn(typography.badge.default, "text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors bg-transparent border-none py-1.5 px-2.5 rounded-md cursor-pointer flex items-center gap-[5px] mr-auto")}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 8a6 6 0 0111.46-2.46M14 8a6 6 0 01-11.46 2.46" />
              <path d="M14 2v4h-4M2 14v-4h4" />
            </svg>
            Retry
          </button>
        )}
        {onEdit && (
          <button onClick={e => { e.stopPropagation(); onEdit(form); }} className={cn(typography.badge.default, "text-gray-500 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-[#1a1a1a] transition-colors bg-transparent border-none py-1.5 px-2.5 rounded-md cursor-pointer flex items-center gap-[5px]")}>
            <Edit3 className="w-[13px] h-[13px]" />
            Edit
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); onDelete(form.id); }} className={cn(typography.badge.default, "text-gray-500 hover:bg-red-50 hover:text-red-500 dark:text-zinc-400 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-all bg-transparent border-none py-1.5 px-2.5 rounded-md cursor-pointer flex items-center gap-[5px]")}>
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </button>
      </div>
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  text:   "Text",
  number: "Number",
  enum:   "Multiple Choice",
  array:  "Table",
};

const FIELD_TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  text:   { bg: "rgba(59,130,246,0.08)",  border: "rgba(59,130,246,0.2)",  text: "#3b82f6" },
  number: { bg: "rgba(22,163,74,0.08)",   border: "rgba(22,163,74,0.2)",   text: "#16a34a" },
  enum:   { bg: "rgba(139,92,246,0.08)",  border: "rgba(139,92,246,0.2)",  text: "#8b5cf6" },
  array:  { bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)",  text: "#f59e0b" },
  object: { bg: "rgba(236,72,153,0.08)",  border: "rgba(236,72,153,0.2)",  text: "#ec4899" },
};

const TYPE_ALIASES: Record<string, string> = {
  // human-friendly labels
  "text":             "text",
  "number":           "number",
  "multiple choice":  "enum",
  "table / list":     "array",
  "table":            "array",
  "structured object":"array",
  "object":           "array",
  // developer aliases
  text_long:        "text",
  long_text:        "text",
  dropdown:         "enum",
  multiple_choice:  "enum",
  select:           "enum",
  list:             "array",
  integer:          "number",
  float:            "number",
  decimal:          "number",
  boolean:          "text",
};

// Unified Form Dialog Component
function FormDialog({
  form,
  existingForms,
  onClose,
  onSuccess,
  onUpdate,
  onGenerateCode,
  onDelete,
}: {
  form: Form;
  existingForms: Form[];
  onClose: () => void;
  onSuccess: () => void;
  onUpdate: (formId: string, data: Partial<CreateFormRequest>) => Promise<void>;
  onGenerateCode: (formId: string, enableReview?: boolean) => void;
  onDelete: (formId: string) => void;
}) {
  const { toast } = useToast();

  // Local editable state
  const [formName, setFormName] = useState(form.form_name);
  const [formDescription, setFormDescription] = useState(form.form_description || '');
  const [fields, setFields] = useState<FormField[]>(form.fields);
  const [enableReview, setEnableReview] = useState<boolean>(form.metadata?.enable_review ?? false);
  const [saving, setSaving] = useState(false);

  // Inline editing
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);

  // View switching
  const metadata = useMemo(() => typeof form.metadata === 'string' ? JSON.parse(form.metadata) : form.metadata, [form.metadata]);
  const pipeline = useMemo(() => metadata?.decomposition?.pipeline || [], [metadata]);
  const signatures = metadata?.decomposition?.signatures || [];
  const hasPipeline = pipeline.length > 0;
  const [activeView, setActiveView] = useState<'fields' | 'pipeline'>(hasPipeline ? 'pipeline' : 'fields');

  // Fields view state
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const [fieldSearch, setFieldSearch] = useState('');
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Pipeline view state
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set());
  const [expandedSignatures, setExpandedSignatures] = useState<Set<string>>(new Set());

  const isEditable = form.status === 'draft' || form.status === 'active' || form.status === 'failed';

  const hasChanges = () => {
    return formName !== form.form_name ||
      formDescription !== (form.form_description || '') ||
      JSON.stringify(fields) !== JSON.stringify(form.fields) ||
      enableReview !== (form.metadata?.enable_review ?? false);
  };

  const hasFieldChanges = () => JSON.stringify(fields) !== JSON.stringify(form.fields);

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
    if (updates.field_type === 'enum' && !updatedField.options) updatedField.options = [''];
    if (updates.field_type && updates.field_type !== 'enum') delete updatedField.options;
    setFields(fields.map((field, i) => (i === index ? updatedField : field)));
  };
  const addOption = (fi: number) => updateField(fi, { options: [...(fields[fi].options || []), ''] });
  const removeOption = (fi: number, oi: number) => updateField(fi, { options: (fields[fi].options || []).filter((_, i) => i !== oi) });
  const updateOption = (fi: number, oi: number, value: string) => {
    const opts = [...(fields[fi].options || [])]; opts[oi] = value; updateField(fi, { options: opts });
  };
  const sanitizeFieldName = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_{2,}/g, '_').replace(/^(\d)/, '_$1');

  // Pipeline helpers
  const toggleStage = (n: number) => { const s = new Set(expandedStages); s.has(n) ? s.delete(n) : s.add(n); setExpandedStages(s); };
  const toggleSignature = (n: string) => { const s = new Set(expandedSignatures); s.has(n) ? s.delete(n) : s.add(n); setExpandedSignatures(s); };
  const expandAllPipeline = () => { setExpandedStages(new Set(pipeline.map((s: any) => s.stage))); setExpandedSignatures(new Set(signatures.map((s: any) => s.name))); };
  const collapseAllPipeline = () => { setExpandedStages(new Set()); setExpandedSignatures(new Set()); };

  const handleClose = () => {
    if (hasChanges() && !confirm('You have unsaved changes. Discard?')) return;
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
      if (!field.field_name.trim()) { toast({ title: 'Validation', description: 'All fields must have a name', variant: 'error' }); return; }
      if (!field.field_description.trim()) { toast({ title: 'Validation', description: 'All fields must have a description', variant: 'error' }); return; }
      if (field.field_type === 'enum') {
        const nonEmpty = (field.options || []).filter(o => o.trim());
        if (nonEmpty.length === 0) { toast({ title: 'Validation', description: `Enum field "${field.field_name}" needs at least one option`, variant: 'error' }); return; }
      }
    }
    setSaving(true);
    try {
      const sanitizedFields = fields.map(f => ({ ...f, field_name: sanitizeFieldName(f.field_name), options: f.field_type === 'enum' ? (f.options || []).filter(o => o.trim()) : f.options }));
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
      if (activeView !== 'fields') return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setFocusIndex(p => Math.min(p + 1, fields.length - 1)); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setFocusIndex(p => Math.max(p - 1, 0)); }
      else if ((e.key === 'Enter' || e.key === ' ') && tag !== 'BUTTON') { e.preventDefault(); toggle(focusIndex); }
      else if (e.key === 'Escape') { handleClose(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [focusIndex, fields.length, activeView]);

  useEffect(() => { rowRefs.current[focusIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focusIndex]);
  useEffect(() => { setExpandedStages(new Set(pipeline.map((s: any) => s.stage))); }, [pipeline]);

  const statusBadgeVariant: Record<string, string> = {
    draft: 'default', generating: 'processing', awaiting_review: 'warning',
    regenerating: 'processing', active: 'success', failed: 'error',
  };

  const totalPipelineFields = signatures.reduce((sum: number, sig: any) => sum + Object.keys(sig.fields || {}).length, 0);

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
              className={cn("text-sm text-gray-400 dark:text-zinc-500 leading-relaxed mt-1 line-clamp-2", isEditable && "cursor-pointer hover:text-gray-600 dark:hover:text-zinc-300")}
              onClick={() => isEditable && setEditingDescription(true)}
            >{formDescription || 'No description — click to add'}</p>
          )}
          {formDescription.length > 0 && formDescription.length < 10 && (
            <p className="text-[11px] text-amber-500 mt-1">{formDescription.length}/10 chars min</p>
          )}
        </div>

        {/* Metadata bar */}
        <div className="px-6 pb-3 flex-shrink-0">
          <div className="flex items-center gap-4 text-sm text-gray-400 dark:text-zinc-500">
            <span><span className="font-semibold text-gray-700 dark:text-zinc-300">{fields.length}</span> fields</span>
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
            {hasChanges() && <span className="text-amber-500 text-xs font-medium ml-auto">unsaved</span>}
          </div>
        </div>

        {/* View tabs */}
        {hasPipeline && (
          <div className="px-6 flex gap-4 flex-shrink-0">
            <button
              type="button"
              onClick={() => setActiveView('fields')}
              className={cn("text-sm pb-2 bg-transparent border-none cursor-pointer transition-colors px-0", activeView === 'fields' ? "text-gray-900 dark:text-white font-semibold border-b-2 border-gray-900 dark:border-white" : "text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300")}
            >Fields</button>
            <button
              type="button"
              onClick={() => setActiveView('pipeline')}
              className={cn("text-sm pb-2 bg-transparent border-none cursor-pointer transition-colors px-0", activeView === 'pipeline' ? "text-gray-900 dark:text-white font-semibold border-b-2 border-gray-900 dark:border-white" : "text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300")}
            >Pipeline</button>
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
          {activeView === 'fields' && (
            <>
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
                              {field.field_type === 'enum' && field.options && field.options.filter((o: string) => o.trim()).length > 0 && (
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
                                {field.field_type === 'enum' && (
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
                                  </div>
                                )}
                                <div className="mb-3">
                                  <label className="text-xs text-gray-400 dark:text-zinc-600 block mb-1">Description</label>
                                  <textarea value={field.field_description} onChange={e => updateField(idx, { field_description: e.target.value })} placeholder="What to extract..." rows={2} onClick={e => e.stopPropagation()} className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none leading-relaxed resize-none transition-colors focus:border-gray-400 dark:focus:border-[#3f3f3f]" />
                                </div>
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
                                {field.field_type === 'enum' && field.options && field.options.length > 0 && (
                                  <div>
                                    <span className="text-xs text-gray-300 dark:text-zinc-600">Options ({field.options.length})</span>
                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                      {field.options.map((opt: string, oi: number) => (
                                        <span key={oi} className="text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] py-0.5 px-2 rounded-md">{opt}</span>
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
            </>
          )}

          {/* === PIPELINE VIEW === */}
          {activeView === 'pipeline' && (
            <>
              <div className="flex items-center justify-between px-6 py-3 flex-shrink-0">
                <span className="text-xs text-gray-400 dark:text-zinc-500">
                  <span className="font-semibold text-gray-700 dark:text-zinc-300">{pipeline.length}</span> stages · <span className="font-semibold text-gray-700 dark:text-zinc-300">{signatures.length}</span> tasks · <span className="font-semibold text-gray-700 dark:text-zinc-300">{totalPipelineFields}</span> fields
                </span>
                <button type="button" onClick={expandedStages.size === pipeline.length ? collapseAllPipeline : expandAllPipeline} className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 bg-transparent border-none cursor-pointer p-0 transition-colors">
                  {expandedStages.size === pipeline.length ? 'Collapse all' : 'Expand all'}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-4">
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
                        <div className={cn("w-2.5 h-2.5 shrink-0 ring-2 ring-white dark:ring-[#111111]", isParallel ? "rounded-full" : "rounded-[3px]", isOpen ? "bg-gray-900 dark:bg-zinc-200" : "bg-gray-300 dark:bg-zinc-600")} />
                        {!isLastStage && <div className="w-px flex-1 mt-1 bg-gray-200 dark:bg-[#222]" />}
                      </div>
                      <div className="flex-1 pb-4 min-w-0">
                        <div className="flex items-center gap-2 py-1.5 pr-2 pl-1 cursor-pointer rounded-lg -ml-1 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]" onClick={() => toggleStage(stage.stage)}>
                          <span className={cn("text-sm tracking-tight flex-1", isOpen ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-500 dark:text-zinc-400")}>Stage {stage.stage}</span>
                          <span className="text-xs text-gray-400 dark:text-zinc-600">{execution} · {stageSignatures.length} task{stageSignatures.length !== 1 ? 's' : ''}{!isOpen ? ` · ${stageFieldCount} fields` : ''}</span>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 transition-transform duration-200 text-gray-300 dark:text-zinc-600" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </div>
                        {isOpen && (
                          <div className="mt-1">
                            {stageSignatures.map((sig: any, ti: number) => {
                              const taskOpen = expandedSignatures.has(sig.name);
                              const isLastTask = ti === stageSignatures.length - 1;
                              const sigFields = Object.keys(sig.fields || {});
                              return (
                                <div key={sig.name} className="flex gap-0">
                                  <div className="flex flex-col items-center w-6 shrink-0 pt-[11px]">
                                    <div className={cn("w-1.5 h-1.5 shrink-0 rounded-full transition-colors", taskOpen ? "bg-gray-600 dark:bg-zinc-300" : "bg-gray-300 dark:bg-zinc-600")} />
                                    {(!isLastTask || taskOpen) && <div className="w-px flex-1 mt-1 bg-gray-100 dark:bg-[#1f1f1f]" />}
                                  </div>
                                  <div className="flex-1 pb-2 min-w-0">
                                    <div className="flex items-center gap-2 py-1 pr-2 pl-1 cursor-pointer rounded-lg -ml-1 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.025]" onClick={() => toggleSignature(sig.name)}>
                                      <span className={cn("text-[13px] flex-1 font-mono tracking-tight min-w-0 truncate", taskOpen ? "text-gray-800 dark:text-zinc-100" : "text-gray-400 dark:text-zinc-500")}>{sig.name}</span>
                                      <span className="text-[11px] text-gray-300 dark:text-zinc-600 tabular-nums">{sigFields.length}</span>
                                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0 transition-transform duration-200 text-gray-300 dark:text-zinc-700" style={{ transform: taskOpen ? "rotate(180deg)" : "rotate(0)" }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    </div>
                                    {taskOpen && (
                                      <div className="mt-1.5 mb-1 flex flex-wrap gap-1.5 pl-1">
                                        {sigFields.map((f: string) => (
                                          <span key={f} className="text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] py-0.5 px-2 rounded-md">{f}</span>
                                        ))}
                                      </div>
                                    )}
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
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-[#1a1a1a] rounded-b-2xl flex-shrink-0">
          <div>
            {isEditable && (
              <Button variant="ghost" size="sm" onClick={handleDelete} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {form.status === 'draft' && (
              <>
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving}>Close</Button>
                {isEditable && hasChanges() && (
                  <Button variant="secondary" size="sm" type="submit" form="edit-form-body" loading={saving}>Update Form</Button>
                )}
                <Button size="sm" onClick={() => { if (hasChanges()) { handleSubmit({ preventDefault: () => {} } as any).then(() => {}); } else { onGenerateCode(form.id, enableReview); onClose(); } }}>Generate Code</Button>
              </>
            )}
            {form.status === 'active' && !hasChanges() && (
              <Button variant="ghost" size="sm" onClick={handleClose}>Close</Button>
            )}
            {form.status === 'active' && hasChanges() && (
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
                <Button size="sm" onClick={() => { onGenerateCode(form.id, enableReview); onClose(); }}>Retry</Button>
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
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [fields, setFields] = useState<FormField[]>([
    { field_name: '', field_type: 'text', field_description: '', example: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [enableReview, setEnableReview] = useState(false);
  const [expandedFields, setExpandedFields] = useState<Set<number>>(new Set([0]));
  const [focusIndex, setFocusIndex] = useState(0);
  const [mode, setMode] = useState<'manual' | 'json'>('manual');
  const [jsonInput, setJsonInput] = useState('');
  const [jsonError, setJsonError] = useState('');

  const typeColors = FIELD_TYPE_COLORS;

  const toggleField = (idx: number) => {
    const newSet = new Set(expandedFields);
    if (newSet.has(idx)) {
      newSet.delete(idx);
    } else {
      newSet.add(idx);
    }
    setExpandedFields(newSet);
  };

  const allExpanded = fields.every((_, i) => expandedFields.has(i));
  const toggleAll = () => {
    if (allExpanded) {
      setExpandedFields(new Set());
    } else {
      setExpandedFields(new Set(fields.map((_, i) => i)));
    }
  };

  const addField = () => {
    setFields([
      ...fields,
      { field_name: '', field_type: 'text', field_description: '', example: '' },
    ]);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    const updatedField = { ...fields[index], ...updates };

    // If field type changed to enum and no options, initialize empty array
    if (updates.field_type === 'enum' && !updatedField.options) {
      updatedField.options = [''];
    }

    // If field type changed from enum to something else, remove options
    if (updates.field_type && updates.field_type !== 'enum') {
      delete updatedField.options;
    }

    setFields(fields.map((field, i) => (i === index ? updatedField : field)));
  };

  const addOption = (fieldIndex: number) => {
    const field = fields[fieldIndex];
    const newOptions = [...(field.options || []), ''];
    updateField(fieldIndex, { options: newOptions });
  };

  const removeOption = (fieldIndex: number, optionIndex: number) => {
    const field = fields[fieldIndex];
    const newOptions = (field.options || []).filter((_, i) => i !== optionIndex);
    updateField(fieldIndex, { options: newOptions });
  };

  const updateOption = (fieldIndex: number, optionIndex: number, value: string) => {
    const field = fields[fieldIndex];
    const newOptions = [...(field.options || [])];
    newOptions[optionIndex] = value;
    updateField(fieldIndex, { options: newOptions });
  };

  const addSubfield = (fieldIndex: number) => {
    const field = fields[fieldIndex];
    const newSub: FormField = { field_name: '', field_type: 'text', field_description: '', example: '' };
    updateField(fieldIndex, { subform_fields: [...(field.subform_fields || []), newSub] });
  };

  const removeSubfield = (fieldIndex: number, subIndex: number) => {
    const field = fields[fieldIndex];
    updateField(fieldIndex, { subform_fields: (field.subform_fields || []).filter((_: any, i: number) => i !== subIndex) });
  };

  const updateSubfield = (fieldIndex: number, subIndex: number, updates: Partial<FormField>) => {
    const field = fields[fieldIndex];
    const subs = [...(field.subform_fields || [])];
    subs[subIndex] = { ...subs[subIndex], ...updates };
    updateField(fieldIndex, { subform_fields: subs });
  };

  const sanitizeFieldName = (name: string): string => {
    // Convert to snake_case: "Author Name" -> "author_name"
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with underscore
      .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
      .replace(/_{2,}/g, '_') // Replace multiple underscores with single
      .replace(/^(\d)/, '_$1'); // Prepend underscore if starts with digit
  };

  const handleLoadJson = () => {
    setJsonError('');
    let parsed: any;
    try {
      // Strip control characters (except tab, newline, carriage return) introduced by copy-paste
      const cleaned = jsonInput.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      setJsonError(`Invalid JSON: ${e.message}`);
      return;
    }

    let newName = '';
    let newDescription = '';
    let newFields: FormField[] = [];

    if (Array.isArray(parsed)) {
      newFields = parsed;
    } else {
      if (parsed.form_name) newName = parsed.form_name;
      else if (parsed.name) newName = parsed.name;
      if (parsed.form_description) newDescription = parsed.form_description;
      else if (parsed.description) newDescription = parsed.description;
      if (Array.isArray(parsed.fields)) newFields = parsed.fields;
      else if (Array.isArray(parsed.field_definitions)) newFields = parsed.field_definitions;
    }

    if (newFields.length === 0) {
      setJsonError('No fields found. Expected { fields: [...] } or a top-level array of fields.');
      return;
    }

    const normalized: FormField[] = newFields.map((f: any) => ({
      field_name: f.field_name || f.name || '',
      field_type: (() => { const raw = (f.field_type || f.type || 'text').toLowerCase().trim(); return TYPE_ALIASES[raw] ?? raw; })(),
      field_description: f.field_description || f.description || '',
      example: f.example != null ? String(f.example) : '',
      ...(f.options ? { options: f.options } : {}),
      ...(f.extraction_hints ? { extraction_hints: f.extraction_hints } : {}),
      ...(f.subform_fields ? { subform_fields: f.subform_fields } : {}),
    }));

    if (newName) setFormName(newName);
    if (newDescription) setFormDescription(newDescription);
    setFields(normalized);
    setExpandedFields(new Set(normalized.map((_, i) => i)));
    setMode('manual');
    setJsonInput('');
  };

  const handleJsonFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setJsonInput((ev.target?.result as string) || '');
      setJsonError('');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!formName.trim()) {
      toast({ title: 'Validation', description: 'Please enter a form name', variant: 'error' });
      return;
    }
    const duplicate = existingForms.some(
      (f) => f.form_name.trim().toLowerCase() === formName.trim().toLowerCase()
    );
    if (duplicate) {
      toast({ title: 'Duplicate name', description: `A form named "${formName.trim()}" already exists. Please use a different name.`, variant: 'error' });
      return;
    }
    if (!formDescription.trim()) {
      toast({ title: 'Validation', description: 'Please enter a form description', variant: 'error' });
      return;
    }
    if (formDescription.length < 10) {
      toast({ title: 'Validation', description: 'Form description must be at least 10 characters long', variant: 'error' });
      return;
    }
    if (fields.length === 0) {
      toast({ title: 'Validation', description: 'Please add at least one field', variant: 'error' });
      return;
    }
    for (const field of fields) {
      if (!field.field_name.trim()) {
        toast({ title: 'Validation', description: 'All fields must have a name', variant: 'error' });
        return;
      }
      if (!field.field_description.trim()) {
        toast({ title: 'Validation', description: 'All fields must have a description', variant: 'error' });
        return;
      }
      if (field.field_type === 'enum') {
        if (!field.options || field.options.length === 0) {
          toast({ title: 'Validation', description: `Enum field "${field.field_name}" must have at least one option`, variant: 'error' });
          return;
        }
        const nonEmptyOptions = field.options.filter(opt => opt.trim());
        if (nonEmptyOptions.length === 0) {
          toast({ title: 'Validation', description: `Enum field "${field.field_name}" must have at least one non-empty option`, variant: 'error' });
          return;
        }
      }
    }

    setSaving(true);
    try {
      // Sanitize field names and clean up options before submission
      const sanitizedFields = fields.map(field => {
        const sanitized: any = {
          ...field,
          field_name: sanitizeFieldName(field.field_name),
        };

        // Clean up options for enum fields - remove empty strings
        if (field.field_type === 'enum' && field.options) {
          sanitized.options = field.options.filter(opt => opt.trim());
        }

        return sanitized;
      });

      const request: CreateFormRequest = {
        project_id: projectId,
        form_name: formName,
        form_description: formDescription,
        fields: sanitizedFields,
        enable_review: enableReview,
      };

      await formsService.create(request);
      toast({
        title: 'Success',
        description: 'Form created successfully',
        variant: 'success',
      });
      onSuccess();
    } catch (err: any) {
      console.error('Failed to create form:', err);
      console.error('Error response:', err.response?.data);

      toast({
        title: 'Error',
        description: getErrorMessage(err, 'Failed to create form'),
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">Create Form</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Form name + description — compact, heading-like */}
        <div className="px-6 pb-3 flex-shrink-0">
          <input
            autoFocus
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder="Form name, e.g. Patient Population"
            className="w-full text-base font-semibold text-gray-900 dark:text-white bg-transparent border-none outline-none py-1 placeholder:text-gray-300 dark:placeholder:text-zinc-600 placeholder:font-normal"
          />
          <input
            value={formDescription}
            onChange={e => setFormDescription(e.target.value)}
            placeholder="Describe what this form extracts from papers..."
            className="w-full text-sm text-gray-500 dark:text-zinc-400 bg-transparent border-none outline-none py-0.5 placeholder:text-gray-300 dark:placeholder:text-zinc-600"
          />
          {formDescription.length > 0 && formDescription.length < 10 && (
            <p className="text-[11px] text-amber-500 mt-0.5">{formDescription.length}/10 chars min</p>
          )}
        </div>

        {/* Metadata bar + mode tabs */}
        <div className="px-6 pb-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4 text-sm text-gray-400 dark:text-zinc-500">
            <span><span className="font-semibold text-gray-700 dark:text-zinc-300">{fields.length}</span> field{fields.length !== 1 ? 's' : ''}</span>
            <span className="text-gray-200 dark:text-zinc-700">·</span>
            <button
              type="button"
              onClick={() => setEnableReview(!enableReview)}
              className={cn("text-xs bg-transparent border-none cursor-pointer p-0 transition-colors", enableReview ? "text-amber-500 font-semibold" : "text-gray-400 dark:text-zinc-500 hover:text-gray-600")}
            >
              Human Review: {enableReview ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="flex items-center gap-4">
            <button type="button" onClick={toggleAll} className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 bg-transparent border-none cursor-pointer p-0 transition-colors">
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
            <span className="text-gray-200 dark:text-zinc-700">|</span>
            <button type="button" onClick={() => setMode('manual')} className={cn("text-xs bg-transparent border-none cursor-pointer transition-colors px-0 pb-0.5", mode === 'manual' ? "text-gray-900 dark:text-white font-semibold border-b border-gray-900 dark:border-white" : "text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300")}>Manual</button>
            <button type="button" onClick={() => { setMode('json'); setJsonError(''); }} className={cn("text-xs bg-transparent border-none cursor-pointer transition-colors px-0 pb-0.5", mode === 'json' ? "text-gray-900 dark:text-white font-semibold border-b border-gray-900 dark:border-white" : "text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300")}>JSON</button>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 border-t border-gray-100 dark:border-[#1a1a1a]">

          {mode === 'json' ? (
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <p className="text-xs text-gray-400 dark:text-zinc-500 mb-3">Paste your form schema as JSON, or upload a file.</p>
              <textarea
                value={jsonInput}
                onChange={e => { setJsonInput(e.target.value); setJsonError(''); }}
                placeholder={`{\n  "form_name": "My Form",\n  "fields": [\n    { "field_name": "age", "field_type": "number", "field_description": "Patient age" },\n    { "field_name": "severity", "field_type": "enum", "field_description": "Severity", "options": ["mild", "moderate", "severe"] }\n  ]\n}`}
                rows={10}
                className={cn("w-full text-xs font-mono text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] rounded-lg p-4 outline-none leading-[1.7] resize-none mb-3 transition-colors border", jsonError ? "border-red-400 dark:border-red-600" : "border-gray-200 dark:border-[#2a2a2a] focus:border-gray-400 dark:focus:border-[#3f3f3f]")}
              />
              {jsonError && <p className="text-xs text-red-500 dark:text-red-400 mb-3">{jsonError}</p>}
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => fileInputRef.current?.click()}>
                  Upload .json
                </Button>
                <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleJsonFileUpload} className="hidden" />
                <Button size="sm" type="button" onClick={handleLoadJson} disabled={!jsonInput.trim()}>
                  Load JSON
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {fields.map((field, idx) => {
                const isOpen = expandedFields.has(idx);
                const tc = typeColors[field.field_type] || FIELD_TYPE_COLORS.text;
                return (
                  <div key={idx}>
                    {/* Collapsed row */}
                    <div
                      className="flex items-center gap-3 py-2.5 px-2 cursor-pointer rounded-lg transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
                      onClick={() => { setFocusIndex(idx); toggleField(idx); }}
                    >
                      <div className="w-2 h-2 rounded-full shrink-0 transition-opacity" style={{ background: tc.text, opacity: isOpen ? 0.7 : 0.3 }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-sm truncate", isOpen ? "font-semibold text-gray-900 dark:text-white" : field.field_name.trim() ? "font-medium text-gray-600 dark:text-zinc-300" : "font-medium text-gray-300 dark:text-zinc-600")}>{field.field_name.trim() || `field_${idx + 1}`}</span>
                          <span className="text-xs font-medium py-0.5 px-2 rounded-[5px] tracking-tight shrink-0 text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]">{TYPE_LABELS[field.field_type] ?? field.field_type}</span>
                          {field.field_type === 'enum' && field.options && field.options.filter((o: string) => o.trim()).length > 0 && (
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

                    {/* Expanded — borderless inline editing */}
                    {isOpen && (
                      <div className="ml-5 mb-3 pl-4 border-l-2 space-y-1.5" style={{ borderLeftColor: `${tc.text}30` }}>
                        <div className="flex gap-2 items-center">
                          <input value={field.field_name} onChange={e => updateField(idx, { field_name: e.target.value })} placeholder="field_name" onClick={e => e.stopPropagation()} className="flex-1 text-sm font-mono text-gray-700 dark:text-zinc-300 bg-transparent border-none outline-none py-1 px-0 focus:bg-gray-50 dark:focus:bg-[#0d0d0d] focus:px-2 focus:rounded transition-all placeholder:text-gray-300 dark:placeholder:text-zinc-600" />
                          <select value={field.field_type} onChange={e => updateField(idx, { field_type: e.target.value })} onClick={e => e.stopPropagation()} className="text-xs text-gray-500 dark:text-zinc-400 bg-transparent border-none outline-none cursor-pointer appearance-none pr-4 dark:[color-scheme:dark]">
                            {Object.keys(FIELD_TYPE_COLORS).map(t => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
                          </select>
                          {fields.length > 1 && (
                            <button type="button" onClick={e => { e.stopPropagation(); removeField(idx); }} className="text-gray-300 dark:text-zinc-700 bg-transparent border-none cursor-pointer p-0 hover:text-red-500 transition-colors shrink-0">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <input value={field.field_description} onChange={e => updateField(idx, { field_description: e.target.value })} placeholder="What to extract from the paper..." onClick={e => e.stopPropagation()} className="w-full text-sm text-gray-500 dark:text-zinc-400 bg-transparent border-none outline-none py-0.5 px-0 focus:bg-gray-50 dark:focus:bg-[#0d0d0d] focus:px-2 focus:rounded transition-all placeholder:text-gray-300 dark:placeholder:text-zinc-600" />
                        <input value={field.example || ''} onChange={e => updateField(idx, { example: e.target.value })} placeholder='Example: "18-65 years" (optional)' onClick={e => e.stopPropagation()} className="w-full text-xs text-gray-400 dark:text-zinc-500 bg-transparent border-none outline-none py-0.5 px-0 focus:bg-gray-50 dark:focus:bg-[#0d0d0d] focus:px-2 focus:rounded transition-all placeholder:text-gray-300 dark:placeholder:text-zinc-700" />
                        {field.field_type === 'enum' && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {(field.options || ['']).map((opt: string, oi: number) => (
                              <div key={oi} className="flex items-center relative group">
                                <input value={opt} onChange={e => updateOption(idx, oi, e.target.value)} placeholder={`option ${oi + 1}`} onClick={e => e.stopPropagation()} className="text-xs text-gray-600 dark:text-zinc-300 bg-gray-50 dark:bg-[#0d0d0d] border-none rounded-full py-1 pr-5 pl-2.5 outline-none w-[100px] focus:ring-1 focus:ring-gray-200 dark:focus:ring-[#333] transition-all" />
                                {(field.options?.length || 0) > 1 && (
                                  <button type="button" onClick={e => { e.stopPropagation(); removeOption(idx, oi); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-300 p-0 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                  </button>
                                )}
                              </div>
                            ))}
                            <button type="button" onClick={e => { e.stopPropagation(); addOption(idx); }} className="text-xs text-gray-400 bg-gray-50 dark:bg-[#0d0d0d] rounded-full py-1 px-2.5 cursor-pointer border-none hover:text-gray-600 transition-colors">+</button>
                          </div>
                        )}
                        {(field.field_type === 'array' || field.field_type === 'object') && (
                          <div className="pt-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] text-gray-400 dark:text-zinc-600">Subfields</span>
                              <button type="button" onClick={e => { e.stopPropagation(); addSubfield(idx); }} className="text-[11px] text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer p-0 transition-colors">+ add</button>
                            </div>
                            {(field.subform_fields || []).map((sf: FormField, si: number) => (
                              <div key={si} className="flex items-center gap-1.5 mb-1 group" onClick={e => e.stopPropagation()}>
                                <div className="w-1 h-1 rounded-full bg-gray-300 dark:bg-zinc-700 shrink-0" />
                                <input value={sf.field_name} onChange={e => updateSubfield(idx, si, { field_name: e.target.value })} placeholder="name" className="flex-1 text-xs font-mono text-gray-600 dark:text-zinc-300 bg-transparent border-none outline-none py-0.5 focus:bg-gray-50 dark:focus:bg-[#0d0d0d] focus:px-1.5 focus:rounded transition-all" />
                                <select value={sf.field_type} onChange={e => updateSubfield(idx, si, { field_type: e.target.value })} className="text-[11px] text-gray-400 bg-transparent border-none outline-none cursor-pointer appearance-none dark:[color-scheme:dark]">
                                  {Object.keys(FIELD_TYPE_COLORS).filter(t => t !== 'array' && t !== 'object').map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <button type="button" onClick={() => removeSubfield(idx, si)} className="bg-transparent border-none cursor-pointer text-gray-300 dark:text-zinc-700 p-0 hover:text-red-500 transition-colors shrink-0 opacity-0 group-hover:opacity-100">
                                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                </button>
                              </div>
                            ))}
                            {(field.subform_fields || []).length === 0 && (
                              <p className="text-[11px] text-gray-300 dark:text-zinc-700">No subfields yet</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div onClick={addField} className="flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-gray-200 dark:border-[#2a2a2a] rounded-lg cursor-pointer mt-1 text-gray-300 dark:text-zinc-600 text-xs transition-colors hover:border-gray-400 dark:hover:border-[#3f3f3f] hover:text-gray-500 dark:hover:text-zinc-400">
                <Plus className="w-3 h-3" /> Add field
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-gray-100 dark:border-[#1a1a1a] rounded-b-2xl flex-shrink-0">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit as any} loading={saving}>Create Form</Button>
          </div>
        </div>
      </div>
    </div>
  );
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
  onReject: (formId: string, feedback: string) => void;
}) {
  const { toast } = useToast();
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set());
  const [expandedSignatures, setExpandedSignatures] = useState<Set<string>>(new Set());
  const [showSummary, setShowSummary] = useState(false);

  const metadata = useMemo(() => typeof form.metadata === 'string' ? JSON.parse(form.metadata) : form.metadata, [form.metadata]);
  const signatures = metadata?.decomposition?.signatures || [];
  const pipeline = useMemo(() => metadata?.decomposition?.pipeline || [], [metadata]);
  const summary = metadata?.decomposition_summary;

  const totalFields = signatures.reduce((sum: number, sig: any) =>
    sum + Object.keys(sig.fields || {}).length, 0
  );

  const toggleStage = (stageNum: number) => {
    const newExpanded = new Set(expandedStages);
    if (newExpanded.has(stageNum)) {
      newExpanded.delete(stageNum);
    } else {
      newExpanded.add(stageNum);
    }
    setExpandedStages(newExpanded);
  };

  const toggleSignature = (sigName: string) => {
    const newExpanded = new Set(expandedSignatures);
    if (newExpanded.has(sigName)) {
      newExpanded.delete(sigName);
    } else {
      newExpanded.add(sigName);
    }
    setExpandedSignatures(newExpanded);
  };

  const expandAll = () => {
    const allStages = new Set<number>(pipeline.map((s: any) => s.stage));
    const allSigs = new Set<string>(signatures.map((s: any) => s.name));
    setExpandedStages(allStages);
    setExpandedSignatures(allSigs);
  };

  const collapseAll = () => {
    setExpandedStages(new Set());
    setExpandedSignatures(new Set());
  };

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await onApprove(form.id);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!feedback.trim()) {
      toast({
        title: 'Validation',
        description: 'Please provide feedback for regeneration',
        variant: 'error',
      });
      return;
    }

    setSubmitting(true);
    try {
      await onReject(form.id, feedback);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const allStages = new Set<number>(pipeline.map((s: any) => s.stage));
    setExpandedStages(allStages);
  }, [pipeline]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">{form.form_name}</h2>
            <Badge variant="warning">Pending review</Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Metadata bar */}
        <div className="px-6 pb-4 flex-shrink-0">
          <div className="flex items-center gap-4 text-sm text-gray-400 dark:text-zinc-500">
            <span><span className="font-semibold text-gray-700 dark:text-zinc-300">{pipeline.length}</span> stages</span>
            <span className="text-gray-200 dark:text-zinc-700">·</span>
            <span><span className="font-semibold text-gray-700 dark:text-zinc-300">{signatures.length}</span> tasks</span>
            <span className="text-gray-200 dark:text-zinc-700">·</span>
            <span><span className="font-semibold text-gray-700 dark:text-zinc-300">{totalFields}</span> fields</span>
          </div>
          {summary && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowSummary(!showSummary)}
                className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 bg-transparent border-none cursor-pointer p-0 transition-colors"
              >
                {showSummary ? 'Hide summary' : 'Show summary'}
              </button>
              {showSummary && (
                <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed mt-1.5">{summary}</p>
              )}
            </div>
          )}
        </div>

        {/* Pipeline */}
        <div className="flex-1 flex flex-col min-h-0 border-t border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-center justify-between px-6 pt-4 pb-3 flex-shrink-0">
            <span className="text-xs font-medium text-gray-400 dark:text-zinc-500">Pipeline</span>
            <button
              type="button"
              onClick={expandedStages.size === pipeline.length ? collapseAll : expandAll}
              className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 bg-transparent border-none cursor-pointer p-0 transition-colors"
            >
              {expandedStages.size === pipeline.length ? "Collapse all" : "Expand all"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-4">
            {pipeline.map((stage: any, si: number) => {
              const isOpen = expandedStages.has(stage.stage);
              const isLastStage = si === pipeline.length - 1;
              const execution = (stage.execution || 'parallel').toLowerCase();
              const isParallel = execution === 'parallel';

              const stageSignatures = (stage.signatures || []).map((sigName: string) =>
                signatures.find((s: any) => s.name === sigName)
              ).filter(Boolean);

              const stageFieldCount = stageSignatures.reduce((s: number, sig: any) => s + Object.keys(sig.fields || {}).length, 0);

              return (
                <div key={stage.stage} className="flex gap-0">
                  {/* Rail */}
                  <div className="flex flex-col items-center w-7 shrink-0 pt-[14px]">
                    <div className={cn(
                      "w-2.5 h-2.5 shrink-0 ring-2 ring-white dark:ring-[#111111]",
                      isParallel ? "rounded-full" : "rounded-[3px]",
                      isOpen ? "bg-gray-900 dark:bg-zinc-200" : "bg-gray-300 dark:bg-zinc-600"
                    )} />
                    {!isLastStage && <div className="w-px flex-1 mt-1 bg-gray-200 dark:bg-[#222]" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-4 min-w-0">
                    <div
                      className="flex items-center gap-2 py-1.5 pr-2 pl-1 cursor-pointer rounded-lg -ml-1 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
                      onClick={() => toggleStage(stage.stage)}
                    >
                      <span className={cn("text-sm tracking-tight flex-1", isOpen ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-500 dark:text-zinc-400")}>
                        Stage {stage.stage}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-zinc-600">
                        {execution} · {stageSignatures.length} task{stageSignatures.length !== 1 ? "s" : ""}{!isOpen ? ` · ${stageFieldCount} fields` : ""}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 transition-transform duration-200 text-gray-300 dark:text-zinc-600" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>
                        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>

                    {isOpen && (
                      <div className="mt-1">
                        {stageSignatures.map((sig: any, ti: number) => {
                          const taskOpen = expandedSignatures.has(sig.name);
                          const isLastTask = ti === stageSignatures.length - 1;
                          const sigFields = Object.keys(sig.fields || {});

                          return (
                            <div key={sig.name} className="flex gap-0">
                              <div className="flex flex-col items-center w-6 shrink-0 pt-[11px]">
                                <div className={cn(
                                  "w-1.5 h-1.5 shrink-0 rounded-full transition-colors",
                                  taskOpen ? "bg-gray-600 dark:bg-zinc-300" : "bg-gray-300 dark:bg-zinc-600"
                                )} />
                                {(!isLastTask || taskOpen) && <div className="w-px flex-1 mt-1 bg-gray-100 dark:bg-[#1f1f1f]" />}
                              </div>
                              <div className="flex-1 pb-2 min-w-0">
                                <div
                                  className="flex items-center gap-2 py-1 pr-2 pl-1 cursor-pointer rounded-lg -ml-1 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.025]"
                                  onClick={() => toggleSignature(sig.name)}
                                >
                                  <span className={cn("text-[13px] flex-1 font-mono tracking-tight min-w-0 truncate", taskOpen ? "text-gray-800 dark:text-zinc-100" : "text-gray-400 dark:text-zinc-500")}>{sig.name}</span>
                                  <span className="text-[11px] text-gray-300 dark:text-zinc-600 tabular-nums">{sigFields.length}</span>
                                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0 transition-transform duration-200 text-gray-300 dark:text-zinc-700" style={{ transform: taskOpen ? "rotate(180deg)" : "rotate(0)" }}>
                                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </div>
                                {taskOpen && (
                                  <div className="mt-1.5 mb-1 flex flex-wrap gap-1.5 pl-1">
                                    {sigFields.map((field: string) => (
                                      <span key={field} className="text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] py-0.5 px-2 rounded-md">{field}</span>
                                    ))}
                                  </div>
                                )}
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
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-[#1a1a1a] rounded-b-2xl flex-shrink-0">
          {/* Expandable feedback area */}
          <div className={cn("overflow-hidden transition-all duration-300 ease-in-out", showFeedback ? "max-h-[200px] opacity-100" : "max-h-0 opacity-0")}>
            <div className="px-6 pt-4">
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Describe what needs to be changed or improved..."
                rows={3}
                className="resize-none"
              />
              <p className="text-[11px] text-gray-400 dark:text-zinc-600 mt-1.5">Be specific. The AI will use your feedback to regenerate.</p>
            </div>
          </div>

          <div className="flex items-center justify-between px-6 py-4">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              Close
            </Button>
            <div className="flex gap-2">
              {!showFeedback ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setShowFeedback(true)} disabled={submitting}>
                    Request Changes
                  </Button>
                  <Button size="sm" onClick={handleApprove} loading={submitting}>
                    Approve
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => { setShowFeedback(false); setFeedback(''); }} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleReject} loading={submitting} disabled={!feedback.trim()}>
                    Submit Feedback
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

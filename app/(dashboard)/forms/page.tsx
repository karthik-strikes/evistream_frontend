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
} from '@/components/ui';
import { Plus, Trash2, FileText, Code, AlertCircle, Check, Edit3, ThumbsUp, ThumbsDown, MessageSquare, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import { JobLogsViewer } from '@/components/JobLogsViewer';
import { cn, formatDate, getErrorMessage } from '@/lib/utils';
import { typography } from '@/lib/typography';
import { statusColors, statusBgs } from '@/lib/colors';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';

export default function FormsPage() {
  const { selectedProject } = useProject();
  const { can_create_forms, can_view_docs } = useProjectPermissions();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedForm, setSelectedForm] = useState<Form | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState<Form | null>(null);
  const [editForm, setEditForm] = useState<Form | null>(null);
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
      }

      toast({
        title: 'Code Generation Started',
        description: 'AI is generating extraction code. Watch the progress below!',
        variant: 'success',
      });

      // Refresh forms to see updated status
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id] });
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
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id] });
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
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id] });
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
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id] });
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
      await queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id] });
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
          <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id] })} className="mt-4">
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
              <JobLogsViewer jobId={activeJobId} />
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
                          onClick={() => setSelectedForm(form)}
                          onReview={(form) => setReviewForm(form)}
                          onEdit={(form) => setEditForm(form)}
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
                          onClick={() => setSelectedForm(form)}
                          onReview={(form) => setReviewForm(form)}
                          onEdit={(form) => setEditForm(form)}
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
                          onClick={() => setSelectedForm(form)}
                          onReview={(form) => setReviewForm(form)}
                          onEdit={(form) => setEditForm(form)}
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
                          onClick={() => setSelectedForm(form)}
                          onReview={(form) => setReviewForm(form)}
                          onEdit={(form) => setEditForm(form)}
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
            queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id] });
          }}
        />
      )}

      {selectedForm && (
        <FormDetailDialog
          form={selectedForm}
          onClose={() => setSelectedForm(null)}
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

      {editForm && (
        <EditFormDialog
          form={editForm}
          existingForms={forms}
          onClose={() => setEditForm(null)}
          onSuccess={() => {
            setEditForm(null);
            queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id] });
          }}
          onUpdate={handleUpdateForm}
          onGenerateCode={handleGenerateCode}
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
}: {
  form: Form;
  onGenerateCode: (id: string, enableReview?: boolean) => void;
  onDelete: (id: string) => void;
  onClick: () => void;
  onReview?: (form: Form) => void;
  onEdit?: (form: Form) => void;
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
        "bg-white rounded-xl border border-gray-200 flex flex-col transition-all duration-150 cursor-pointer relative overflow-hidden hover:shadow-card-hover hover:-translate-y-px dark:bg-[#111111] dark:border-[#1f1f1f]",
        isFailed && "border-l-[4px] border-l-purple-500 dark:border-l-purple-400 bg-gradient-to-r from-purple-50 to-white dark:from-purple-400/10 dark:to-[#111111]",
        isReview && "border-l-[4px] border-l-amber-500 dark:border-l-amber-400 bg-gradient-to-r from-amber-50 to-white dark:from-amber-400/10 dark:to-[#111111]",
        isDraft && "border-l-[4px] border-l-gray-400 dark:border-l-zinc-500",
      )}
    >
      <div className="pt-5 px-[22px]" onClick={onClick}>
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
            <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-indigo-500 animate-[shimmer_2s_linear_infinite]" style={{ width: '45%', backgroundSize: '200% 100%' }} />
          </div>
        </div>
      )}

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

// Form Detail Dialog Component
function FormDetailDialog({
  form,
  onClose,
  onGenerateCode,
  onDelete,
}: {
  form: Form;
  onClose: () => void;
  onGenerateCode: (id: string, enableReview?: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const [focus, setFocus] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const typeColors: Record<string, { bg: string; border: string; text: string }> = {
    text: { bg: "rgba(59, 130, 246, 0.08)", border: "rgba(59, 130, 246, 0.2)", text: "#3b82f6" },
    number: { bg: "rgba(22, 163, 74, 0.08)", border: "rgba(22, 163, 74, 0.2)", text: "#16a34a" },
    enum: { bg: "rgba(139, 92, 246, 0.08)", border: "rgba(139, 92, 246, 0.2)", text: "#8b5cf6" },
    array: { bg: "rgba(245, 158, 11, 0.08)", border: "rgba(245, 158, 11, 0.2)", text: "#f59e0b" },
    object: { bg: "rgba(236, 72, 153, 0.08)", border: "rgba(236, 72, 153, 0.2)", text: "#ec4899" },
  };

  const toggle = (i: number) => {
    setOpenSet(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    if (openSet.size === form.fields.length) {
      setOpenSet(new Set());
    } else {
      setOpenSet(new Set(form.fields.map((_, i) => i)));
    }
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete "${form.form_name}"?`)) {
      onDelete(form.id);
      onClose();
    }
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setFocus(p => Math.min(p + 1, form.fields.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setFocus(p => Math.max(p - 1, 0));
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (tag !== 'BUTTON') {
          e.preventDefault();
          toggle(focus);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [focus, form.fields.length]);

  useEffect(() => {
    rowRefs.current[focus]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focus]);

  const statusLabels: Record<string, string> = {
    draft: 'DRAFT',
    generating: 'GENERATING',
    awaiting_review: 'REVIEW',
    regenerating: 'REGENERATING',
    active: 'ACTIVE',
    failed: 'FAILED',
  };

  // statusColors and statusBgs imported from @/lib/colors

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[900px] max-h-[90vh] overflow-y-auto border-0 shadow-2xl p-0 bg-white dark:bg-[#111111]">
        <DialogTitle className="sr-only">{form.form_name}</DialogTitle>
        <style>{`
          @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
          .field-row-detail { transition: all 0.15s ease; outline: none; }
          .field-row-detail:hover { background: rgba(0,0,0,0.025) !important; }
          .field-row-detail.focused-detail { background: rgba(0,0,0,0.035) !important; }
          .dark .field-row-detail:hover { background: rgba(255,255,255,0.03) !important; }
          .dark .field-row-detail.focused-detail { background: rgba(255,255,255,0.04) !important; }
          .expand-btn-detail { transition: all 0.15s ease; }
          .expand-btn-detail:hover { background: #f3f4f6 !important; }
          .dark .expand-btn-detail:hover { background: rgba(255,255,255,0.06) !important; }
        `}</style>

        <div className="pt-14 px-12 pb-12 relative">
          {/* Header */}
          <div className="mb-6 relative z-[1]">
            <div className="flex items-center gap-3 mb-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white m-0 tracking-tight">{form.form_name}</h1>
              <span
                className="text-xs font-bold py-[5px] px-3 rounded-lg tracking-wide"
                style={{
                  color: statusColors[form.status],
                  background: statusBgs[form.status],
                  border: `1px solid ${statusColors[form.status]}22`,
                }}
              >{statusLabels[form.status]}</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-zinc-400 m-0 leading-relaxed max-w-[520px]">
              {form.form_description || 'No description provided'}
            </p>
          </div>

          {/* Meta */}
          <div className="flex gap-6 text-sm mb-10 pb-8 border-b-2 border-gray-200 dark:border-[#1f1f1f] relative z-[1]">
            <div className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]">
              <span className="text-base font-bold text-gray-800 dark:text-white">{form.fields.length}</span>
              <span className="text-gray-500 dark:text-zinc-400 font-medium">fields</span>
            </div>
            <div className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]">
              <span className="text-gray-400 dark:text-zinc-500 font-medium">Created</span>
              <span className="text-sm font-semibold text-gray-700 dark:text-zinc-300">{formatDate(form.created_at)}</span>
            </div>
          </div>

          {/* Error */}
          {form.error && (
            <div className="flex gap-3.5 items-start p-[18px] px-5 rounded-[10px] border border-purple-200 dark:border-purple-800/50 dark:bg-purple-900/10 mb-10">
              <div className="w-5 h-5 rounded-full bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center shrink-0 mt-px">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              </div>
              <div className="flex-1">
                <div className="text-sm text-gray-900 dark:text-white font-medium leading-normal mb-1.5">
                  Error Occurred
                </div>
                <div className="text-xs text-purple-700 dark:text-purple-400">
                  {form.error}
                </div>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center justify-between mb-5 p-3.5 px-4 bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-[#2a2a2a] relative z-[1]">
            {/* Legend */}
            <div className="flex gap-4 flex-wrap">
              {Object.keys(typeColors).map((type) => (
                <span key={type} className="text-xs font-medium text-gray-400 dark:text-zinc-500">{TYPE_LABELS[type] ?? type}</span>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-medium text-gray-400 dark:text-zinc-600 mr-1">
                &uarr;&darr; navigate &middot; &crarr; expand
              </span>
              <button type="button" onClick={toggleAll} className="expand-btn-detail text-xs font-semibold text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#222222] rounded-lg py-1.5 px-3.5 cursor-pointer border border-gray-200 dark:border-[#2a2a2a]">{openSet.size === form.fields.length ? "Collapse all" : "Expand all"}</button>
            </div>
          </div>

          {/* Fields */}
          <div className="border-t border-gray-200 dark:border-[#1f1f1f]">
            {form.fields.map((field, index) => {
              const isOpen = openSet.has(index);
              const isFocused = focus === index;
              return (
                <div
                  key={index}
                  ref={el => { rowRefs.current[index] = el; }}
                  className="border-b border-gray-200 dark:border-[#1f1f1f]"
                >
                  {/* Row */}
                  <div
                    className={cn("field-row-detail grid items-start gap-3.5 p-4 px-2 cursor-pointer rounded-sm mx-[-8px]", isFocused ? "focused-detail border-l-2 border-l-gray-300" : "border-l-2 border-l-transparent")}
                    onClick={() => { setFocus(index); toggle(index); }}
                    style={{ gridTemplateColumns: "12px 1fr auto auto" }}
                  >
                    {/* Dot */}
                    <div className="pt-[5px]">
                      <div className={cn("w-2 h-2 rounded-full transition-opacity duration-150", isOpen ? "bg-gray-400 dark:bg-zinc-500" : "bg-gray-300 dark:bg-zinc-700")} />
                    </div>

                    {/* Name + desc */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn("text-sm", isOpen ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-700 dark:text-zinc-300")}>{field.field_name}</span>
                        {field.options && (
                          <span className="text-[10px] text-gray-300 font-medium">{field.options.length}</span>
                        )}
                      </div>
                      {!isOpen && (
                        <div className="text-xs text-gray-400 mt-1 leading-[1.4] overflow-hidden text-ellipsis whitespace-nowrap">{field.field_description}</div>
                      )}
                    </div>

                    {/* Type */}
                    <span className="text-xs font-medium py-0.5 px-2 rounded-[5px] mt-0.5 tracking-tight text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]">{TYPE_LABELS[field.field_type] ?? field.field_type}</span>

                    {/* Chevron */}
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="opacity-20 mt-1 transition-transform duration-300 text-gray-700 dark:text-zinc-400" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>
                      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>

                  {/* Expanded */}
                  {isOpen && (
                    <div className="pb-7 pl-[22px] animate-[slideOpen_0.2s_ease]">
                      <p className="text-sm text-gray-500 mb-5 leading-[1.7] max-w-[480px]">{field.field_description}</p>

                      <div className={cn("grid gap-4", field.options ? "grid-cols-2" : "grid-cols-1")}>
                        {/* Example */}
                        {field.example && (
                          <div>
                            <div className="text-[10px] font-semibold text-gray-300 dark:text-zinc-600 uppercase tracking-widest mb-2">Example</div>
                            <div className="text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border-l-2 border-l-gray-200 dark:border-l-[#2a2a2a] rounded-lg p-3.5 px-4 leading-relaxed break-words">{field.example}</div>
                          </div>
                        )}

                        {/* Options */}
                        {field.field_type === 'enum' && field.options && field.options.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold text-gray-300 dark:text-zinc-600 uppercase tracking-widest mb-2">Options <span className="text-gray-300 dark:text-zinc-600">({field.options.length})</span></div>
                            <div className="flex flex-col gap-0.5">
                              {field.options.map((opt, optIndex) => {
                                const isDef = opt === field.example;
                                return (
                                  <div key={optIndex} className={cn("flex items-center gap-2 py-[7px] px-3 rounded-md", isDef ? "bg-gray-100 dark:bg-[#1a1a1a]" : "")}>
                                    <div className={cn("w-[5px] h-[5px] rounded-full shrink-0", isDef ? "bg-gray-500 dark:bg-zinc-400" : "bg-gray-200 dark:bg-zinc-700")} />
                                    <span className={cn("text-xs", isDef ? "font-semibold text-gray-800 dark:text-zinc-200" : "font-normal text-gray-500 dark:text-zinc-400")}>{opt}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center mt-12 pt-7 relative z-[1]">
            <button
              onClick={onClose}
              className="text-sm font-medium text-gray-400 hover:text-gray-500 dark:text-zinc-500 dark:hover:text-zinc-300 bg-transparent border-none rounded-[10px] py-2.5 px-6 cursor-pointer transition-all duration-200"
            >Close</button>
            <div className="flex gap-2.5">
              {form.status === 'draft' && (
                <button
                  onClick={() => {
                    onGenerateCode(form.id);
                    onClose();
                  }}
                  className="text-sm font-semibold text-white bg-gray-900 border-none rounded-[10px] py-2.5 px-[22px] cursor-pointer transition-all duration-200 hover:bg-black dark:bg-white dark:text-black dark:hover:bg-zinc-100"
                >Generate Code</button>
              )}
              <button
                onClick={handleDelete}
                className="text-sm font-semibold text-white bg-gray-900 border-none rounded-[10px] py-2.5 px-[22px] cursor-pointer transition-all duration-200 hover:bg-black dark:bg-white dark:text-black dark:hover:bg-zinc-100"
              >Delete Form</button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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

  const typeColors: Record<string, { bg: string; border: string; text: string }> = {
    text: { bg: "rgba(99, 102, 241, 0.08)", border: "rgba(99, 102, 241, 0.2)", text: "#6366f1" },
    number: { bg: "rgba(8, 145, 178, 0.08)", border: "rgba(8, 145, 178, 0.2)", text: "#0891b2" },
    enum: { bg: "rgba(139, 92, 246, 0.08)", border: "rgba(139, 92, 246, 0.2)", text: "#8b5cf6" },
    array: { bg: "rgba(236, 72, 153, 0.08)", border: "rgba(236, 72, 153, 0.2)", text: "#ec4899" },
  };

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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          .row-hover { transition: background 0.12s ease; outline: none; }
          .row-hover:hover { background: rgba(0,0,0,0.025) !important; }
          .row-hover.focused-create { background: rgba(0,0,0,0.03) !important; }
          .dark .row-hover:hover { background: rgba(255,255,255,0.03) !important; }
          .dark .row-hover.focused-create { background: rgba(255,255,255,0.04) !important; }
          .expand-btn-create { transition: background 0.12s ease; }
          .expand-btn-create:hover { background: rgba(0,0,0,0.06) !important; }
          .dark .expand-btn-create:hover { background: rgba(255,255,255,0.07) !important; }
          input::placeholder, textarea::placeholder { color: #ccc; }
          .dark input::placeholder, .dark textarea::placeholder { color: #3f3f3f; }
          textarea { resize: vertical; }
        `}</style>

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">Create Extraction Form</h2>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Define fields for data extraction from research papers</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:text-zinc-300 transition-colors border-none bg-transparent cursor-pointer mt-0.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Two-column body */}
        <form onSubmit={handleSubmit} className="flex flex-1 min-h-0">

          {/* Left — Form Details */}
          <div className="w-[38%] flex flex-col border-r border-gray-100 dark:border-[#1f1f1f] min-h-0">
            <div className="flex-1 overflow-y-auto px-5 pt-4 pb-4 space-y-5">
              <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block">Form Details</span>

              {/* Mode toggle */}
              <div className="flex items-center bg-gray-100 dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#1f1f1f] rounded-lg p-0.5 gap-0.5 w-fit">
                <button type="button" onClick={() => setMode('manual')} className={cn("text-[11px] font-semibold px-3 py-1 rounded-md transition-all duration-150 cursor-pointer border-none", mode === 'manual' ? "bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-white shadow-sm" : "bg-transparent text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300")}>Build manually</button>
                <button type="button" onClick={() => { setMode('json'); setJsonError(''); }} className={cn("text-[11px] font-semibold px-3 py-1 rounded-md transition-all duration-150 cursor-pointer border-none", mode === 'json' ? "bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-white shadow-sm" : "bg-transparent text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300")}>Import JSON</button>
              </div>

              {/* Form name */}
              <div>
                <label className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block mb-1.5">Form Name</label>
                <input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g., Patient Population"
                  className="w-full text-sm font-medium text-gray-900 dark:text-white bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2 px-3 outline-none transition-colors duration-150 focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-300 dark:placeholder:text-zinc-600"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block mb-1.5">Description</label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Describe what this form extracts..."
                  rows={3}
                  className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2 px-3 outline-none leading-relaxed transition-colors duration-150 focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-300 dark:placeholder:text-zinc-600"
                />
                <div className={cn("text-xs mt-1 transition-colors duration-150", formDescription.length >= 10 ? "text-green-600 dark:text-green-400" : "text-gray-300 dark:text-zinc-600")}>
                  {formDescription.length < 10 ? `${formDescription.length}/10 min` : "Good"}
                </div>
              </div>

              {/* Human review toggle */}
              <div
                onClick={() => setEnableReview(!enableReview)}
                className={cn(
                  "flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all duration-150 border",
                  enableReview ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/40" : "bg-gray-50 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a] hover:border-gray-300 dark:hover:border-[#3a3a3a]"
                )}
              >
                <div className={cn("w-5 h-5 rounded-[5px] flex items-center justify-center transition-all duration-150 shrink-0", enableReview ? "bg-amber-500" : "border-[1.5px] border-gray-300 dark:border-zinc-600 bg-transparent")}>
                  {enableReview && <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-sm font-semibold", enableReview ? "text-amber-800 dark:text-amber-300" : "text-gray-700 dark:text-zinc-300")}>Human Review</span>
                    {enableReview && <span className="text-[10px] font-semibold text-amber-500 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 px-[7px] py-px rounded-sm">ON</span>}
                  </div>
                  <span className="text-xs text-gray-400 dark:text-zinc-500 leading-[1.4]">Pause after decomposition to review extraction plan</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right — Fields / JSON */}
          <div className="flex-1 flex flex-col min-h-0">
            {mode === 'json' ? (
              <div className="flex-1 overflow-y-auto px-5 pt-4 pb-4">
                <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block mb-3">JSON Definition</span>
                <textarea
                  value={jsonInput}
                  onChange={e => { setJsonInput(e.target.value); setJsonError(''); }}
                  placeholder={`{\n  "form_name": "My Form",\n  "form_description": "Extracts ...",\n  "fields": [\n    {\n      "field_name": "age",\n      "field_type": "number",\n      "field_description": "Patient age in years"\n    },\n    {\n      "field_name": "diagnosis",\n      "field_type": "text",\n      "field_description": "Primary diagnosis"\n    },\n    {\n      "field_name": "severity",\n      "field_type": "enum",\n      "field_description": "Severity level",\n      "options": ["mild", "moderate", "severe"]\n    },\n    {\n      "field_name": "interventions",\n      "field_type": "array",\n      "field_description": "List of interventions",\n      "subform_fields": [\n        { "field_name": "drug", "field_type": "text" },\n        { "field_name": "dose_mg", "field_type": "number" }\n      ]\n    }\n  ]\n}\n\n// field_type options: text, number, enum, array\n// aliases: text_long→text, dropdown→enum, list→array, integer→number`}
                  rows={12}
                  className={cn("w-full text-xs font-mono text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl p-4 outline-none leading-[1.7] resize-none mb-3 transition-colors duration-150", jsonError ? "border border-red-500" : "border border-gray-200 dark:border-[#2a2a2a]")}
                  onFocus={e => { e.currentTarget.style.borderColor = jsonError ? "#ef4444" : "#6b7280"; }}
                  onBlur={e => { e.currentTarget.style.borderColor = jsonError ? "#ef4444" : ""; }}
                />
                {jsonError && (
                  <div className="text-xs text-red-500 dark:text-red-400 mb-3 flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="8" cy="8" r="7"/><path d="M8 5v3M8 11h.01"/></svg>
                    {jsonError}
                  </div>
                )}

                <div className="flex gap-2.5 items-center">
                  <label className="text-xs font-semibold text-gray-600 dark:text-zinc-300 rounded-lg py-2 px-4 cursor-pointer flex items-center gap-1.5 transition-all duration-150 hover:bg-gray-100 dark:hover:bg-[#1a1a1a]" style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)" }}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 10v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2M8 2v8M5 5l3-3 3 3"/></svg>
                    Upload .json
                    <input type="file" accept=".json,application/json" onChange={handleJsonFileUpload} className="hidden" />
                  </label>
                  <button type="button" onClick={handleLoadJson} disabled={!jsonInput.trim()} className={cn("text-xs font-semibold text-white border-none rounded-lg py-2 px-5 flex items-center gap-1.5 transition-all duration-150", jsonInput.trim() ? "bg-gray-900 dark:bg-white dark:text-gray-900 cursor-pointer hover:bg-black dark:hover:bg-gray-100" : "bg-gray-300 dark:bg-zinc-700 cursor-not-allowed")}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 8h14M8 1l7 7-7 7"/></svg>
                    Load JSON
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Fields header */}
                <div className="px-5 pt-4 pb-3 flex-shrink-0">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Fields</span>
                      <span className="text-[10px] font-semibold text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] px-1.5 py-0.5 rounded-[4px]">{fields.length}</span>
                    </div>
                    <button type="button" onClick={toggleAll} className="expand-btn-create text-[11px] font-semibold text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-1 px-2.5 cursor-pointer">{allExpanded ? "Collapse" : "Expand all"}</button>
                  </div>
                </div>

                {/* Field tree */}
                <div className="flex-1 overflow-y-auto px-5 pb-3">
                  <div>
                    {fields.map((field, idx) => {
                      const isOpen = expandedFields.has(idx);
                      const isFocused = focusIndex === idx;
                      const isLast = idx === fields.length - 1;
                      const tc = typeColors[field.field_type] || { bg: "rgba(99, 102, 241, 0.08)", border: "rgba(99, 102, 241, 0.2)", text: "#6366f1" };
                      const lineC = tc.border;
                      return (
                        <div key={idx} className="relative">
                          <div className="absolute left-[14px] top-0 w-[1.5px] bg-gray-300 dark:bg-zinc-700" style={{ bottom: isLast && !isOpen ? "50%" : 0 }} />
                          <div className="absolute left-[14px] top-[22px] w-4 h-[1.5px] bg-gray-300 dark:bg-zinc-700" />
                          {isLast && <div className="absolute left-3 top-[23px] bottom-0 w-[5px] bg-white dark:bg-[#111111]" />}
                          <div className={cn("row-hover flex items-center gap-3 py-3.5 px-2 pl-10 cursor-pointer rounded-sm relative mx-[-8px]", isFocused ? "focused-create border-l-2 border-l-gray-300" : "border-l-2 border-l-transparent")} onClick={() => { setFocusIndex(idx); toggleField(idx); }}>
                            <div className="w-2 h-2 rounded-full transition-opacity duration-150" style={{ background: tc.text, opacity: isOpen ? 0.6 : 0.3 }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={cn("text-sm overflow-hidden text-ellipsis whitespace-nowrap", isOpen ? "font-semibold text-gray-900 dark:text-white" : field.field_name.trim() ? "font-medium text-gray-600 dark:text-zinc-300" : "font-medium text-gray-300 dark:text-zinc-600")}>{field.field_name.trim() || `field_${idx + 1}`}</span>
                                <span className="text-xs font-medium py-0.5 px-2 rounded-[5px] tracking-tight" style={{ color: tc.text, background: tc.bg, border: `1px solid ${tc.border}` }}>{TYPE_LABELS[field.field_type] ?? field.field_type}</span>
                                {field.field_type === 'enum' && field.options && field.options.filter((o: string) => o.trim()).length > 0 && <span className="text-xs text-gray-300 dark:text-zinc-600">{field.options.filter((o: string) => o.trim()).length} opts</span>}
                              </div>
                              {!isOpen && field.field_description.trim() && <div className="text-xs text-gray-400 dark:text-zinc-500 mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap">{field.field_description}</div>}
                            </div>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="opacity-20 shrink-0 transition-transform duration-300 text-gray-700 dark:text-zinc-400" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </div>
                          {isOpen && (
                            <div className="relative animate-[slideOpen_0.2s_ease]">
                              <div className="absolute left-[52px] top-0 bottom-0 w-[1.5px]" style={{ background: lineC }} />
                              {!isLast && <div className="absolute left-[14px] top-0 bottom-0 w-[1.5px] bg-gray-300 dark:bg-zinc-700" />}
                              <div className="pr-2 pb-5 pl-[70px]">
                                <div className="flex gap-3 mb-4">
                                  <div className="flex-1">
                                    <label className="text-xs font-semibold text-gray-400 dark:text-zinc-600 block mb-1.5">NAME</label>
                                    <input value={field.field_name} onChange={e => updateField(idx, { field_name: e.target.value })} placeholder="age_range" onClick={e => e.stopPropagation()} className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none transition-all duration-150" onFocus={e => { e.currentTarget.style.borderColor = tc.text; e.currentTarget.style.boxShadow = `0 0 0 2px ${tc.text}20`; }} onBlur={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = "none"; }} />
                                  </div>
                                  <div className="w-[120px] shrink-0">
                                    <label className="text-xs font-semibold text-gray-400 dark:text-zinc-600 block mb-1.5">TYPE</label>
                                    <div className="relative">
                                      <select value={field.field_type} onChange={e => updateField(idx, { field_type: e.target.value })} onClick={e => e.stopPropagation()} className="w-full text-sm font-medium rounded-md py-2 pr-7 pl-3 outline-none cursor-pointer appearance-none transition-all duration-150 dark:[color-scheme:dark]" style={{ color: tc.text, background: `${tc.text}08`, border: `1px solid ${tc.text}20` }} onFocus={e => e.currentTarget.style.borderColor = `${tc.text}50`} onBlur={e => e.currentTarget.style.borderColor = `${tc.text}20`}>
                                        {Object.keys(typeColors).map(t => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
                                      </select>
                                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-35"><path d="M4 6l4 4 4-4" stroke={tc.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    </div>
                                  </div>
                                </div>
                                {field.field_type === 'enum' && (
                                  <div className="mb-4 p-3.5 rounded-lg" style={{ background: `${tc.text}08`, border: `1px solid ${tc.text}18` }}>
                                    <label className="text-xs font-semibold block mb-2 opacity-70" style={{ color: tc.text }}>OPTIONS</label>
                                    <div className="flex flex-wrap gap-1.5">
                                      {(field.options || ['']).map((opt: string, oi: number) => (
                                        <div key={oi} className="flex items-center relative">
                                          <input value={opt} onChange={e => updateOption(idx, oi, e.target.value)} placeholder={`option ${oi + 1}`} onClick={e => e.stopPropagation()} className="text-xs text-gray-600 dark:text-zinc-300 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-1.5 pr-[26px] pl-2.5 outline-none w-[120px] transition-all duration-150" style={{ borderLeft: `2.5px solid ${tc.text}60` }} onFocus={e => { e.currentTarget.style.borderColor = `${tc.text}40`; e.currentTarget.style.borderLeftColor = tc.text; e.currentTarget.style.boxShadow = `0 0 0 2px ${tc.text}14`; }} onBlur={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.borderLeftColor = `${tc.text}60`; e.currentTarget.style.boxShadow = "none"; }} />
                                          {(field.options?.length || 0) > 1 && <button type="button" onClick={e => { e.stopPropagation(); removeOption(idx, oi); }} className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-300 p-0.5 flex transition-colors duration-100 hover:text-red-500"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg></button>}
                                        </div>
                                      ))}
                                      <button type="button" onClick={e => { e.stopPropagation(); addOption(idx); }} className="text-xs font-medium bg-transparent rounded-md py-1.5 px-3 cursor-pointer flex items-center gap-1 transition-all duration-100" style={{ color: `${tc.text}80`, border: `1px dashed ${tc.text}30` }} onMouseEnter={e => { e.currentTarget.style.borderColor = `${tc.text}60`; e.currentTarget.style.color = tc.text; }} onMouseLeave={e => { e.currentTarget.style.borderColor = `${tc.text}30`; e.currentTarget.style.color = `${tc.text}80`; }}>
                                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                                        add
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {/* Subform fields for array/object types */}
                                {(field.field_type === 'array' || field.field_type === 'object') && (
                                  <div className="mb-4 rounded-lg overflow-hidden" style={{ background: `${tc.text}05`, border: `1px solid ${tc.text}18` }}>
                                    <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${tc.text}12` }}>
                                      <div className="flex items-center gap-2">
                                        <label className="text-xs font-semibold opacity-70" style={{ color: tc.text }}>SUBFIELDS</label>
                                        <span className="text-[10px] font-semibold px-1.5 py-[1px] rounded-[4px]" style={{ background: `${tc.text}10`, color: tc.text }}>{(field.subform_fields || []).length}</span>
                                      </div>
                                      <button type="button" onClick={e => { e.stopPropagation(); addSubfield(idx); }} className="text-[11px] font-medium flex items-center gap-1 bg-transparent border-none cursor-pointer transition-opacity hover:opacity-100 opacity-60" style={{ color: tc.text }}>
                                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                                        Add
                                      </button>
                                    </div>
                                    {(field.subform_fields || []).length > 0 && (
                                      <div className="divide-y" style={{ borderColor: `${tc.text}10` }}>
                                        {(field.subform_fields || []).map((sf: FormField, si: number) => {
                                          const stc = typeColors[sf.field_type] || typeColors.text;
                                          return (
                                            <div key={si} className="px-3 py-2.5 flex items-start gap-2" onClick={e => e.stopPropagation()}>
                                              <div className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: stc.text }} />
                                              <div className="flex-1 min-w-0 space-y-1.5">
                                                <div className="flex gap-2">
                                                  <input value={sf.field_name} onChange={e => updateSubfield(idx, si, { field_name: e.target.value })} placeholder="field_name" className="flex-1 text-xs font-mono text-gray-700 dark:text-zinc-300 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-1.5 px-2.5 outline-none transition-all duration-150 focus:border-gray-400 dark:focus:border-[#3f3f3f]" />
                                                  <div className="relative w-[90px] shrink-0">
                                                    <select value={sf.field_type} onChange={e => updateSubfield(idx, si, { field_type: e.target.value })} className="w-full text-[11px] font-medium rounded-md py-1.5 pr-5 pl-2 outline-none cursor-pointer appearance-none transition-all duration-150 dark:[color-scheme:dark]" style={{ color: stc.text, background: `${stc.text}08`, border: `1px solid ${stc.text}20` }}>
                                                      {Object.keys(typeColors).filter(t => t !== 'array' && t !== 'object').map(t => <option key={t} value={t}>{t}</option>)}
                                                    </select>
                                                    <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-35"><path d="M4 6l4 4 4-4" stroke={stc.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                                  </div>
                                                </div>
                                                <input value={sf.field_description || ''} onChange={e => updateSubfield(idx, si, { field_description: e.target.value })} placeholder="Description..." className="w-full text-[11px] text-gray-500 dark:text-zinc-400 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-1.5 px-2.5 outline-none transition-all duration-150 focus:border-gray-400 dark:focus:border-[#3f3f3f]" />
                                              </div>
                                              <button type="button" onClick={() => removeSubfield(idx, si)} className="mt-1 bg-transparent border-none cursor-pointer text-gray-300 dark:text-zinc-600 p-0.5 flex transition-colors duration-100 hover:text-red-500 shrink-0">
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                    {(field.subform_fields || []).length === 0 && (
                                      <div className="px-3 py-3 text-center">
                                        <span className="text-[11px] text-gray-300 dark:text-zinc-600">No subfields yet</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="mb-4">
                                  <label className="text-xs font-semibold text-gray-400 dark:text-zinc-600 block mb-1.5">DESCRIPTION</label>
                                  <textarea value={field.field_description} onChange={e => updateField(idx, { field_description: e.target.value })} placeholder="What to extract..." rows={2} onClick={e => e.stopPropagation()} className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none leading-relaxed transition-all duration-150" onFocus={e => { e.currentTarget.style.borderColor = tc.text; e.currentTarget.style.boxShadow = `0 0 0 2px ${tc.text}20`; }} onBlur={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = "none"; }} />
                                </div>
                                <div className="mb-3">
                                  <label className="text-xs font-semibold text-gray-400 dark:text-zinc-600 block mb-1.5">EXAMPLE <span className="font-normal text-gray-300 dark:text-zinc-600">optional</span></label>
                                  <input value={field.example || ''} onChange={e => updateField(idx, { example: e.target.value })} placeholder='"18-65 years"' onClick={e => e.stopPropagation()} className="w-full text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none transition-all duration-150 focus:border-gray-300 dark:focus:border-[#3a3a3a]" />
                                </div>
                                {fields.length > 1 && <button type="button" onClick={e => { e.stopPropagation(); removeField(idx); }} className="text-xs font-medium text-gray-300 dark:text-zinc-600 bg-transparent border-none cursor-pointer py-1 flex items-center gap-[5px] transition-colors duration-100 hover:text-red-500 dark:hover:text-red-400"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h10M6 4V3h4v1M5 4v9h6V4" /><path d="M7 7v4M9 7v4" /></svg>Remove field</button>}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Add field */}
                  <div onClick={addField} className="flex items-center justify-center gap-1.5 p-3 border border-dashed border-gray-200 dark:border-[#2a2a2a] rounded-lg cursor-pointer mt-2 text-gray-300 dark:text-zinc-600 text-sm font-medium transition-all duration-150 hover:border-gray-400 dark:hover:border-[#3f3f3f] hover:text-gray-600 dark:hover:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                    Add field
                  </div>
                </div>
              </>
            )}
          </div>

        </form>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] rounded-b-2xl flex-shrink-0">
          <p className="text-xs text-gray-400 dark:text-zinc-500 italic">
            {mode === 'json' ? 'Paste or upload a JSON schema to import fields' : `${fields.length} field${fields.length !== 1 ? 's' : ''} · ${fields.filter(f => f.field_name.trim()).length} named`}
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-zinc-300 bg-transparent border border-gray-200 dark:border-[#2a2a2a] rounded-lg hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:border-[#3a3a3a] cursor-pointer transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            {mode === 'manual' && (
              <button
                type="button"
                onClick={handleSubmit as any}
                disabled={saving}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-lg border-none transition-all duration-150 hover:bg-gray-700 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed",
                  saving ? "cursor-not-allowed" : "cursor-pointer",
                )}
              >
                {saving ? (
                  <><div className="w-4 h-4 rounded-full border-2 border-white/30 dark:border-gray-900/30 border-t-white dark:border-t-gray-900 animate-spin" />Creating...</>
                ) : (
                  <><Plus className="h-4 w-4" />Create Form</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Edit Form Dialog Component
function EditFormDialog({
  form,
  existingForms,
  onClose,
  onSuccess,
  onUpdate,
  onGenerateCode,
}: {
  form: Form;
  existingForms: Form[];
  onClose: () => void;
  onSuccess: () => void;
  onUpdate: (formId: string, data: Partial<CreateFormRequest>) => Promise<void>;
  onGenerateCode: (formId: string, enableReview?: boolean) => void;
}) {
  const { toast } = useToast();
  const [formName, setFormName] = useState(form.form_name);
  const [formDescription, setFormDescription] = useState(form.form_description || '');
  const [fields, setFields] = useState<FormField[]>(form.fields);
  const [saving, setSaving] = useState(false);
  const [enableReview, setEnableReview] = useState<boolean>(form.metadata?.enable_review ?? false);
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const [fieldSearch, setFieldSearch] = useState('');
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const typeColors: Record<string, { bg: string; border: string; text: string }> = {
    text: { bg: "rgba(99, 102, 241, 0.08)", border: "rgba(99, 102, 241, 0.2)", text: "#6366f1" },
    number: { bg: "rgba(8, 145, 178, 0.08)", border: "rgba(8, 145, 178, 0.2)", text: "#0891b2" },
    enum: { bg: "rgba(139, 92, 246, 0.08)", border: "rgba(139, 92, 246, 0.2)", text: "#8b5cf6" },
    array: { bg: "rgba(236, 72, 153, 0.08)", border: "rgba(236, 72, 153, 0.2)", text: "#ec4899" },
  };

  const toggle = (i: number) => {
    setOpenSet(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    if (openSet.size === fields.length) {
      setOpenSet(new Set());
    } else {
      setOpenSet(new Set(fields.map((_, i) => i)));
    }
  };

  const addField = () => {
    const newFields = [
      ...fields,
      { field_name: '', field_type: 'text', field_description: '', example: '' },
    ];
    setFields(newFields);
    setOpenSet(new Set([...openSet, newFields.length - 1]));
    setTimeout(() => setFocusIndex(newFields.length - 1), 100);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    const updatedField = { ...fields[index], ...updates };

    if (updates.field_type === 'enum' && !updatedField.options) {
      updatedField.options = [''];
    }

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

  const sanitizeFieldName = (name: string): string => {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_{2,}/g, '_')
      .replace(/^(\d)/, '_$1');
  };

  const hasFieldChanges = () => {
    return JSON.stringify(fields) !== JSON.stringify(form.fields);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;
      if (isEditable) return;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setFocusIndex(p => Math.min(p + 1, fields.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setFocusIndex(p => Math.max(p - 1, 0));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle(focusIndex);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [focusIndex, fields.length]);

  // Auto-scroll focused row into view
  useEffect(() => {
    rowRefs.current[focusIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIndex]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!formName.trim()) {
      toast({ title: 'Validation', description: 'Please enter a form name', variant: 'error' });
      return;
    }
    const duplicate = existingForms.some(
      (f) => f.id !== form.id && f.form_name.trim().toLowerCase() === formName.trim().toLowerCase()
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
      const sanitizedFields = fields.map(field => {
        const sanitized: any = {
          ...field,
          field_name: sanitizeFieldName(field.field_name),
        };

        if (field.field_type === 'enum' && field.options) {
          sanitized.options = field.options.filter(opt => opt.trim());
        }

        return sanitized;
      });

      const updateData: Partial<CreateFormRequest> = {
        form_name: formName,
        form_description: formDescription,
        fields: sanitizedFields,
        enable_review: enableReview,
      };

      await onUpdate(form.id, updateData);

      if (hasFieldChanges() && form.status === 'active') {
        await onGenerateCode(form.id, enableReview);
        toast({
          title: 'Regenerating',
          description: 'Fields changed — code regeneration started.',
          variant: 'success',
        });
      } else {
        toast({
          title: 'Success',
          description: 'Form updated successfully',
          variant: 'success',
        });
      }
      onSuccess();
    } catch (err: any) {
      console.error('Failed to update form:', err);
      toast({
        title: 'Error',
        description: getErrorMessage(err, 'Failed to update form'),
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <style>{`
          @keyframes slideOpen {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: translateY(0);    }
          }
          .efd-row { transition: background 0.12s ease; outline: none; }
          .efd-row:hover { background: rgba(0,0,0,0.025) !important; }
          .efd-row.efd-focused { background: rgba(0,0,0,0.03) !important; }
          .dark .efd-row:hover { background: rgba(255,255,255,0.03) !important; }
          .dark .efd-row.efd-focused { background: rgba(255,255,255,0.035) !important; }
        `}</style>

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">Edit Form</h2>
              {(() => {
                const statusCls: Record<string, string> = {
                  active: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50',
                  draft: 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]',
                  generating: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50',
                  failed: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50',
                };
                const cls = statusCls[form.status] || statusCls.draft;
                return <span className={`text-[10px] font-bold py-[3px] px-2 rounded-md tracking-wide border ${cls}`}>{form.status.toUpperCase()}</span>;
              })()}
            </div>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 truncate max-w-[340px]" title={form.form_name}>{form.form_name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:text-zinc-300 transition-colors border-none bg-transparent cursor-pointer mt-0.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <>
            <form id="edit-form-body" onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">

              {/* Metadata — full width, fixed height */}
              <div className="flex-shrink-0 px-6 pt-4 pb-4 border-b border-gray-100 dark:border-[#1f1f1f] grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block mb-1.5">Form Name</label>
                  <input
                    autoFocus
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g., Patient Population"
                    className="w-full text-sm font-medium text-gray-900 dark:text-white bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2 px-3 outline-none transition-colors focus:border-gray-400 dark:focus:border-[#3f3f3f]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block mb-1.5">Description</label>
                  <div className="relative">
                    <textarea
                      value={formDescription}
                      onChange={e => setFormDescription(e.target.value)}
                      placeholder="Describe what this form extracts…"
                      rows={3}
                      className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2 px-3 outline-none transition-colors focus:border-gray-400 dark:focus:border-[#3f3f3f] resize-none"
                    />
                  </div>
                  {formDescription.length < 10 && formDescription.length > 0 && (
                    <p className="text-[11px] text-gray-300 dark:text-zinc-600 mt-1">{formDescription.length} / 10 chars min</p>
                  )}
                </div>
              </div>

              {/* Human review toggle */}
              <div className="flex-shrink-0 px-6 py-3 border-b border-gray-100 dark:border-[#1f1f1f]">
                <div
                  onClick={() => setEnableReview(!enableReview)}
                  className={cn(
                    "flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all duration-150 border",
                    enableReview ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/40" : "bg-gray-50 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a] hover:border-gray-300 dark:hover:border-[#3a3a3a]"
                  )}
                >
                  <div className={cn("w-5 h-5 rounded-[5px] flex items-center justify-center transition-all duration-150 shrink-0", enableReview ? "bg-amber-500" : "border-[1.5px] border-gray-300 dark:border-zinc-600 bg-transparent")}>
                    {enableReview && <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-sm font-semibold", enableReview ? "text-amber-800 dark:text-amber-300" : "text-gray-700 dark:text-zinc-300")}>Human Review</span>
                      {enableReview && <span className="text-[10px] font-semibold text-amber-500 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 px-[7px] py-px rounded-sm">ON</span>}
                    </div>
                    <span className="text-xs text-gray-400 dark:text-zinc-500 leading-[1.4]">Pause after decomposition to review extraction plan</span>
                  </div>
                </div>
              </div>

              {/* Fields section — scrollable */}
              <div className="flex flex-col flex-1 min-h-0">
                {/* Fields toolbar */}
                <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-gray-100 dark:border-[#1f1f1f]">
                  <div className="relative flex-1">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 dark:text-zinc-600 pointer-events-none"><circle cx="7" cy="7" r="5"/><path d="M12 12l-2.5-2.5"/></svg>
                    <input
                      type="text"
                      placeholder={`Search ${fields.length} fields…`}
                      value={fieldSearch}
                      onChange={e => setFieldSearch(e.target.value)}
                      className="w-full text-xs text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-1.5 pl-8 pr-3 outline-none focus:border-gray-300 dark:focus:border-[#3a3a3a]"
                    />
                  </div>
                  <span className="text-xs text-gray-400 dark:text-zinc-500 shrink-0">
                    {fields.filter(f => f.field_name.trim()).length}/{fields.length} named
                    {hasFieldChanges() && <span className="text-amber-500 ml-1">· unsaved</span>}
                  </span>
                  <button type="button" onClick={toggleAll} className="shrink-0 text-[11px] font-semibold text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] rounded-lg py-1.5 px-2.5 cursor-pointer border border-gray-200 dark:border-[#2a2a2a] hover:bg-gray-200 dark:hover:bg-[#222] transition-colors">
                    {openSet.size === fields.length ? 'Collapse' : 'Expand all'}
                  </button>
                </div>

                {/* Field list */}
                <div className="flex-1 overflow-y-auto px-6 pb-3 pt-1">
                  <div>
                    {fields.map((field, idx) => {
                      const isOpen = openSet.has(idx);
                      const isFocused = focusIndex === idx;
                      const tc = typeColors[field.field_type] || { bg: "rgba(99, 102, 241, 0.08)", border: "rgba(99, 102, 241, 0.2)", text: "#6366f1" };
                      const lineC = tc.border;
                      const matchesSearch = !fieldSearch.trim() ||
                        field.field_name.toLowerCase().includes(fieldSearch.toLowerCase()) ||
                        field.field_description.toLowerCase().includes(fieldSearch.toLowerCase());
                      if (!matchesSearch) return null;
                      return (
                        <div key={idx}>
                          <div ref={el => { rowRefs.current[idx] = el; }} className={cn("efd-row flex items-center gap-3 py-2.5 px-3 cursor-pointer rounded-lg relative", isFocused ? "efd-focused border-l-2 border-l-gray-300 dark:border-l-zinc-600" : "border-l-2 border-l-transparent")} onClick={() => { setFocusIndex(idx); toggle(idx); }}>
                            <div className="w-2 h-2 rounded-full transition-opacity duration-150" style={{ background: tc.text, opacity: isOpen ? 0.6 : 0.3 }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={cn("text-sm overflow-hidden text-ellipsis whitespace-nowrap", isOpen ? "font-semibold text-gray-900 dark:text-white" : field.field_name.trim() ? "font-medium text-gray-600 dark:text-zinc-300" : "font-medium text-gray-300 dark:text-zinc-600")}>{field.field_name.trim() || `field_${idx + 1}`}</span>
                                <span className="text-xs font-medium py-0.5 px-2 rounded-[5px] tracking-tight" style={{ color: tc.text, background: tc.bg, border: `1px solid ${tc.border}` }}>{TYPE_LABELS[field.field_type] ?? field.field_type}</span>
                                {field.field_type === 'enum' && field.options && field.options.filter((o: string) => o.trim()).length > 0 && <span className="text-xs text-gray-300 dark:text-zinc-600">{field.options.filter((o: string) => o.trim()).length} opts</span>}
                              </div>
                              {!isOpen && field.field_description.trim() && <div className="text-xs text-gray-400 dark:text-zinc-500 mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap">{field.field_description}</div>}
                            </div>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="opacity-20 shrink-0 transition-transform duration-300 text-gray-700 dark:text-zinc-400" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </div>
                          {isOpen && (
                            <div className="animate-[slideOpen_0.2s_ease] ml-3 mb-1 rounded-lg border-l-2 px-4 py-3" style={{ borderLeftColor: lineC, background: `${tc.text}04` }}>
                              <div className="flex gap-3 mb-4">
                                  <div className="flex-1">
                                    <label className="text-xs font-semibold text-gray-400 dark:text-zinc-600 block mb-1.5">NAME</label>
                                    <input value={field.field_name} onChange={e => updateField(idx, { field_name: e.target.value })} placeholder="age_range" onClick={e => e.stopPropagation()} className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none transition-all duration-150" onFocus={e => { e.currentTarget.style.borderColor = tc.text; e.currentTarget.style.boxShadow = `0 0 0 2px ${tc.text}20`; }} onBlur={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = "none"; }} />
                                  </div>
                                  <div className="w-[120px] shrink-0">
                                    <label className="text-xs font-semibold text-gray-400 dark:text-zinc-600 block mb-1.5">TYPE</label>
                                    <div className="relative">
                                      <select value={field.field_type} onChange={e => updateField(idx, { field_type: e.target.value })} onClick={e => e.stopPropagation()} className="w-full text-sm font-medium rounded-md py-2 pr-7 pl-3 outline-none cursor-pointer appearance-none transition-all duration-150 dark:[color-scheme:dark]" style={{ color: tc.text, background: `${tc.text}08`, border: `1px solid ${tc.text}20` }} onFocus={e => e.currentTarget.style.borderColor = `${tc.text}50`} onBlur={e => e.currentTarget.style.borderColor = `${tc.text}20`}>
                                        {Object.keys(typeColors).map(t => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
                                      </select>
                                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-35"><path d="M4 6l4 4 4-4" stroke={tc.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    </div>
                                  </div>
                              </div>
                              {field.field_type === 'enum' && (
                                  <div className="mb-4 p-3.5 rounded-lg" style={{ background: `${tc.text}08`, border: `1px solid ${tc.text}18` }}>
                                    <label className="text-xs font-semibold block mb-2 opacity-70" style={{ color: tc.text }}>OPTIONS</label>
                                    <div className="flex flex-wrap gap-1.5">
                                      {(field.options || ['']).map((opt: string, oi: number) => (
                                        <div key={oi} className="flex items-center relative">
                                          <input value={opt} onChange={e => updateOption(idx, oi, e.target.value)} placeholder={`option ${oi + 1}`} onClick={e => e.stopPropagation()} className="text-xs text-gray-600 dark:text-zinc-300 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-1.5 pr-[26px] pl-2.5 outline-none w-[120px] transition-all duration-150" style={{ borderLeft: `2.5px solid ${tc.text}60` }} onFocus={e => { e.currentTarget.style.borderColor = `${tc.text}40`; e.currentTarget.style.borderLeftColor = tc.text; e.currentTarget.style.boxShadow = `0 0 0 2px ${tc.text}14`; }} onBlur={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.borderLeftColor = `${tc.text}60`; e.currentTarget.style.boxShadow = "none"; }} />
                                          {(field.options?.length || 0) > 1 && <button type="button" onClick={e => { e.stopPropagation(); removeOption(idx, oi); }} className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-300 p-0.5 flex transition-colors duration-100 hover:text-red-500"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg></button>}
                                        </div>
                                      ))}
                                      <button type="button" onClick={e => { e.stopPropagation(); addOption(idx); }} className="text-xs font-medium bg-transparent rounded-md py-1.5 px-3 cursor-pointer flex items-center gap-1 transition-all duration-100" style={{ color: `${tc.text}80`, border: `1px dashed ${tc.text}30` }} onMouseEnter={e => { e.currentTarget.style.borderColor = `${tc.text}60`; e.currentTarget.style.color = tc.text; }} onMouseLeave={e => { e.currentTarget.style.borderColor = `${tc.text}30`; e.currentTarget.style.color = `${tc.text}80`; }}>
                                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                                        add
                                      </button>
                                    </div>
                                  </div>
                              )}
                              <div className="mb-4">
                                  <label className="text-xs font-semibold text-gray-400 dark:text-zinc-600 block mb-1.5">DESCRIPTION</label>
                                  <textarea value={field.field_description} onChange={e => updateField(idx, { field_description: e.target.value })} placeholder="What to extract..." rows={2} onClick={e => e.stopPropagation()} className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none leading-relaxed transition-all duration-150 resize-none" onFocus={e => { e.currentTarget.style.borderColor = tc.text; e.currentTarget.style.boxShadow = `0 0 0 2px ${tc.text}20`; }} onBlur={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = "none"; }} />
                              </div>
                              <div className="mb-3">
                                  <label className="text-xs font-semibold text-gray-400 dark:text-zinc-600 block mb-1.5">EXAMPLE <span className="font-normal text-gray-300 dark:text-zinc-600">optional</span></label>
                                  <input value={field.example || ''} onChange={e => updateField(idx, { example: e.target.value })} placeholder='"18-65 years"' onClick={e => e.stopPropagation()} className="w-full text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-md py-2 px-3 outline-none transition-all duration-150 dark:focus:border-[#3a3a3a]" />
                              </div>
                              {fields.length > 1 && <button type="button" onClick={e => { e.stopPropagation(); removeField(idx); }} className="text-xs font-medium text-gray-300 dark:text-zinc-600 bg-transparent border-none cursor-pointer py-1 flex items-center gap-[5px] transition-colors duration-100 hover:text-red-500 dark:hover:text-red-400"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h10M6 4V3h4v1M5 4v9h6V4" /><path d="M7 7v4M9 7v4" /></svg>Remove field</button>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Add field */}
                  <div onClick={addField} className="flex items-center justify-center gap-1.5 p-3 border border-dashed border-gray-200 dark:border-[#2a2a2a] rounded-lg cursor-pointer mt-2 text-gray-300 dark:text-zinc-600 text-sm font-medium transition-all duration-150 hover:border-gray-400 dark:hover:border-[#3f3f3f] hover:text-gray-600 dark:hover:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                    Add field
                  </div>
                </div>
              </div>
            </form>


            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] rounded-b-2xl flex-shrink-0">
              <button
                type="button"
                onClick={onSuccess}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-zinc-300 bg-transparent border border-gray-200 dark:border-[#2a2a2a] rounded-lg hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:border-[#3a3a3a] cursor-pointer transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="edit-form-body"
                disabled={saving}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-lg border-none transition-all duration-150 hover:bg-gray-700 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed",
                  saving ? "cursor-not-allowed" : "cursor-pointer",
                )}
              >
                {saving ? (
                  <><div className="w-4 h-4 rounded-full border-2 border-white/30 dark:border-gray-900/30 border-t-white dark:border-t-gray-900 animate-spin" />Saving…</>
                ) : hasFieldChanges() && form.status === 'active' ? (
                  <><Code className="h-4 w-4" />Save & Generate</>
                ) : (
                  <>Update Form</>
                )}
              </button>
            </div>
          </>
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
  const [rootOpen, setRootOpen] = useState(true);
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set());
  const [expandedSignatures, setExpandedSignatures] = useState<Set<string>>(new Set());

  // Extract metadata early so functions can use it
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

  // Initialize all stages as expanded by default
  useEffect(() => {
    const allStages = new Set<number>(pipeline.map((s: any) => s.stage));
    setExpandedStages(allStages);
  }, [pipeline]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <style>{`
          @keyframes slideOpen { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
          .decomp-stage-row { transition: all 0.15s ease; outline: none; }
          .decomp-stage-row:hover { background: rgba(0,0,0,0.025) !important; }
          .dark .decomp-stage-row:hover { background: rgba(255,255,255,0.03) !important; }
          .decomp-sig-row { transition: all 0.15s ease; outline: none; }
          .decomp-sig-row:hover { background: rgba(0,0,0,0.02) !important; }
          .dark .decomp-sig-row:hover { background: rgba(255,255,255,0.025) !important; }
          .decomp-expand-btn { transition: all 0.15s ease; }
          .decomp-expand-btn:hover { background: #f3f4f6 !important; }
          .dark .decomp-expand-btn:hover { background: rgba(255,255,255,0.06) !important; }
        `}</style>

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">{form.form_name}</h2>
              <span className="text-[10px] font-bold py-[3px] px-2 rounded-md tracking-wide border whitespace-nowrap text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50">PENDING REVIEW</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Review the AI decomposition plan, then approve or request changes</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:text-zinc-300 transition-colors border-none bg-transparent cursor-pointer mt-0.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Two-column body */}
        <div className="flex flex-1 min-h-0">

          {/* Left — Meta & Info */}
          <div className="w-[38%] flex flex-col border-r border-gray-100 dark:border-[#1f1f1f] min-h-0">
            <div className="flex-1 overflow-y-auto px-5 pt-4 pb-4 space-y-5">
              <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block">Decomposition Plan</span>

              {/* Stats */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-[#1a1a1a] border border-gray-100 dark:border-[#2a2a2a]">
                  <span className="text-xs font-medium text-gray-500 dark:text-zinc-400">Stages</span>
                  <span className="text-sm font-bold text-gray-800 dark:text-white">{pipeline.length}</span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-[#1a1a1a] border border-gray-100 dark:border-[#2a2a2a]">
                  <span className="text-xs font-medium text-gray-500 dark:text-zinc-400">Extraction Tasks</span>
                  <span className="text-sm font-bold text-gray-800 dark:text-white">{signatures.length}</span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-[#1a1a1a] border border-gray-100 dark:border-[#2a2a2a]">
                  <span className="text-xs font-medium text-gray-500 dark:text-zinc-400">Total Fields</span>
                  <span className="text-sm font-bold text-gray-800 dark:text-white">{totalFields}</span>
                </div>
              </div>

              {/* Legend */}
              <div>
                <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block mb-2.5">Execution Mode</span>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-gray-50 dark:bg-[#1a1a1a] border border-gray-100 dark:border-[#2a2a2a]">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-gray-400 dark:bg-zinc-500" />
                    <div>
                      <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Parallel</p>
                      <p className="text-[10.5px] text-gray-400 dark:text-zinc-600 leading-snug">Tasks run simultaneously</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-gray-50 dark:bg-[#1a1a1a] border border-gray-100 dark:border-[#2a2a2a]">
                    <div className="w-2.5 h-2.5 rounded-[2px] shrink-0 bg-gray-400 dark:bg-zinc-500" />
                    <div>
                      <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Sequential</p>
                      <p className="text-[10.5px] text-gray-400 dark:text-zinc-600 leading-snug">Tasks run one after another</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Summary */}
              {summary && (
                <div>
                  <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block mb-2">Summary</span>
                  <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">{summary}</p>
                </div>
              )}

              {/* Feedback */}
              {showFeedback && (
                <div>
                  <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block mb-2">Your Feedback</span>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Describe what needs to be changed or improved..."
                    rows={4}
                    className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2 px-3 outline-none leading-relaxed resize-none transition-colors duration-150 focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-300 dark:placeholder:text-zinc-600"
                  />
                  <p className="text-[10.5px] text-gray-400 dark:text-zinc-600 mt-1.5 leading-snug">Be specific. The AI will use your feedback to regenerate.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right — Pipeline Tree */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
              <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Pipeline</span>
              <button
                type="button"
                onClick={expandedStages.size === pipeline.length ? collapseAll : expandAll}
                className="decomp-expand-btn text-[11px] font-semibold text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-1 px-2.5 cursor-pointer"
              >
                {expandedStages.size === pipeline.length ? "Collapse all" : "Expand all"}
              </button>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-y-auto px-5 pb-4">
              <div>
                {pipeline.map((stage: any, si: number) => {
                  const isOpen = expandedStages.has(stage.stage);
                  const isLastStage = si === pipeline.length - 1;
                  const execution = (stage.execution || 'parallel').toLowerCase();
                  const cs = execution === 'parallel'
                    ? { bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.22)", text: "#8b5cf6" }
                    : { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.22)", text: "#f59e0b" };

                  const stageSignatures = (stage.signatures || []).map((sigName: string) =>
                    signatures.find((s: any) => s.name === sigName)
                  ).filter(Boolean);

                  return (
                    <div key={stage.stage} className="flex gap-0">
                      {/* Stage rail */}
                      <div className="flex flex-col items-center w-8 shrink-0 pt-[14px]">
                        <div className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white dark:ring-[#111111] bg-gray-300 dark:bg-zinc-600" />
                        {!isLastStage && <div className="w-px flex-1 mt-1.5 bg-gray-200 dark:bg-[#2a2a2a]" />}
                      </div>

                      {/* Stage content */}
                      <div className="flex-1 pb-5 min-w-0">
                        <div
                          className="decomp-stage-row flex items-center gap-2.5 py-2 pr-2 pl-1 cursor-pointer rounded-lg -ml-1"
                          onClick={() => toggleStage(stage.stage)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn("text-sm tracking-tight", isOpen ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-600 dark:text-zinc-400")}>Stage {stage.stage}</span>
                              <span className="text-[10px] font-bold py-0.5 px-2 rounded-[5px] tracking-wide" style={{ color: cs.text, background: cs.bg, border: `1px solid ${cs.border}` }}>{execution}</span>
                              {!isOpen && <span className="text-xs text-gray-400 dark:text-zinc-600">{stageSignatures.length} task{stageSignatures.length !== 1 ? "s" : ""} · {stageSignatures.reduce((s: number, sig: any) => s + Object.keys(sig.fields || {}).length, 0)} fields</span>}
                            </div>
                          </div>
                          <span className="text-[10px] font-bold py-0.5 px-2 rounded-md shrink-0" style={{ color: cs.text, background: cs.bg, border: `1px solid ${cs.border}` }}>{stageSignatures.length} task{stageSignatures.length !== 1 ? "s" : ""}</span>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 transition-transform duration-300 text-gray-400 dark:text-zinc-600" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>
                            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>

                        {isOpen && (
                          <div className="mt-1 animate-[slideOpen_0.18s_ease]">
                            {stageSignatures.map((sig: any, ti: number) => {
                              const taskOpen = expandedSignatures.has(sig.name);
                              const isLastTask = ti === stageSignatures.length - 1;
                              const sigFields = Object.keys(sig.fields || {});

                              return (
                                <div key={sig.name} className="flex gap-0">
                                  <div className="flex flex-col items-center w-7 shrink-0 pt-[13px]">
                                    <div className="w-2 h-2 rounded-[2px] shrink-0 transition-all duration-150" style={{ border: `1.5px solid ${cs.text}`, background: taskOpen ? cs.text : "transparent", opacity: taskOpen ? 0.8 : 0.4 }} />
                                    {(!isLastTask || taskOpen) && <div className="w-px flex-1 mt-1" style={{ background: `${cs.text}25` }} />}
                                  </div>
                                  <div className="flex-1 pb-3 min-w-0">
                                    <div
                                      className="decomp-sig-row flex items-center gap-2 py-1.5 pr-2 pl-1 cursor-pointer rounded-lg -ml-1"
                                      onClick={() => toggleSignature(sig.name)}
                                    >
                                      <span className={cn("text-[13px] flex-1 font-mono tracking-tight min-w-0 truncate", taskOpen ? "font-semibold text-gray-800 dark:text-zinc-100" : "text-gray-500 dark:text-zinc-400")}>{sig.name}</span>
                                      {sig.description && !taskOpen && <span className="text-xs text-gray-400 dark:text-zinc-600 truncate max-w-[150px] hidden lg:block">{sig.description}</span>}
                                      <span className="text-[10px] font-bold py-0.5 px-1.5 rounded shrink-0" style={{ color: cs.text, background: cs.bg, border: `1px solid ${cs.border}` }}>{sigFields.length}</span>
                                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0 transition-transform duration-300 text-gray-400 dark:text-zinc-600 opacity-60" style={{ transform: taskOpen ? "rotate(180deg)" : "rotate(0)" }}>
                                        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    </div>
                                    {taskOpen && (
                                      <div className="mt-1.5 mb-1 flex flex-wrap gap-1 animate-[slideOpen_0.14s_ease]">
                                        {sigFields.map((field: string) => (
                                          <span key={field} className="text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-[#1a1a1a] py-1 px-2.5 rounded-md border border-gray-100 dark:border-[#2a2a2a] cursor-default transition-all duration-100 hover:-translate-y-px hover:shadow-sm" style={{ borderLeft: `2px solid ${cs.text}50` }}>{field}</span>
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
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] rounded-b-2xl flex-shrink-0">
          <button type="button" onClick={onClose} disabled={submitting} className="text-sm font-medium text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 bg-transparent border-none cursor-pointer transition-colors">
            Close
          </button>
          <div className="flex gap-2">
            {!showFeedback ? (
              <>
                <button type="button" onClick={() => setShowFeedback(true)} disabled={submitting} className="text-sm font-semibold text-gray-700 dark:text-zinc-200 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-xl py-2 px-5 cursor-pointer transition-all hover:bg-gray-200 dark:hover:bg-[#222]">
                  Request Changes
                </button>
                <button type="button" onClick={handleApprove} disabled={submitting} className="text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 hover:bg-gray-700 dark:hover:bg-white rounded-xl py-2 px-5 cursor-pointer border-none transition-all">
                  {submitting ? 'Approving...' : 'Approve & Continue'}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setShowFeedback(false); setFeedback(''); }} disabled={submitting} className="text-sm font-semibold text-gray-700 dark:text-zinc-200 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-xl py-2 px-5 cursor-pointer transition-all hover:bg-gray-200 dark:hover:bg-[#222]">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={submitting || !feedback.trim()}
                  className={cn("text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-xl py-2 px-5 border-none transition-all", submitting || !feedback.trim() ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-gray-700 dark:hover:bg-white")}
                >
                  {submitting ? 'Submitting...' : 'Submit Feedback'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

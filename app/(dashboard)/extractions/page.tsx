'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { Play, Grid3x3, ChevronDown, Loader2, AlertCircle, X, FileText, Check } from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import { extractionsService, formsService, jobsService, documentsService } from '@/services';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { EmptyState, Alert, Button } from '@/components/ui';
import type { Extraction, Form, Job, Document } from '@/types/api';
import { formatDate, cn, getErrorMessage } from '@/lib/utils';
import { typography } from '@/lib/typography';

/* --- Main Page --------------------------------------------------------- */

export default function ExtractionsPage() {
  const { selectedProject } = useProject();
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [selectedFormId, setSelectedFormId] = useState<string>('');
  const [runningExtraction, setRunningExtraction] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [allDocs, setAllDocs] = useState(true);
  const [formSearch, setFormSearch] = useState('');
  const [docSearch, setDocSearch] = useState('');

  const { data: extractions = [], isLoading } = useQuery({
    queryKey: ['extractions', selectedProject?.id],
    queryFn: async () => {
      const data = await extractionsService.getAll(selectedProject!.id);
      // Fetch job details for each extraction
      const jobPromises = data
        .filter((ext: Extraction) => ext.job_id)
        .map((ext: Extraction) => jobsService.getById(ext.job_id!).catch(() => null));
      const jobResults = await Promise.all(jobPromises);
      const jobsMap: Record<string, Job> = {};
      jobResults.forEach((job) => {
        if (job) jobsMap[job.id] = job;
      });
      setJobs(jobsMap);
      return data;
    },
    enabled: !!selectedProject,
  });

  const { data: forms = [] } = useQuery({
    queryKey: ['forms', selectedProject?.id],
    queryFn: async () => {
      const data = await formsService.getAll(selectedProject!.id);
      return data.filter((f: Form) => f.status === 'active');
    },
    enabled: !!selectedProject,
  });

  const toggle = (id: string) => {
    const newSet = new Set(expanded);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpanded(newSet);
  };

  const openRunDialog = useCallback(async () => {
    setShowRunDialog(true);
    setSelectedFormId('');
    setSelectedDocIds(new Set());
    setAllDocs(true);
    setFormSearch('');
    setDocSearch('');
    if (!selectedProject) return;
    try {
      const docs = await documentsService.getAll(selectedProject.id);
      setDocuments(docs.filter(d => d.processing_status === 'completed'));
    } catch {
      setDocuments([]);
    }
  }, [selectedProject]);

  const handleRunExtraction = async () => {
    if (!selectedProject || !selectedFormId) {
      toast({ title: 'Error', description: 'Please select a form', variant: 'error' });
      return;
    }

    try {
      setRunningExtraction(true);
      await extractionsService.create({
        project_id: selectedProject.id,
        form_id: selectedFormId,
        document_ids: allDocs ? undefined : Array.from(selectedDocIds),
      });

      toast({ title: 'Success', description: 'Extraction started successfully', variant: 'success' });
      setShowRunDialog(false);
      queryClient.invalidateQueries({ queryKey: ['extractions', selectedProject?.id] });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: getErrorMessage(error, 'Failed to start extraction'),
        variant: 'error',
      });
    } finally {
      setRunningExtraction(false);
    }
  };

  const toggleDoc = (id: string) => {
    const next = new Set(selectedDocIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedDocIds(next);
  };

  const getFormName = (formId: string) => {
    const form = forms.find(f => f.id === formId);
    return form?.form_name || 'Unknown Form';
  };

  const getErrorMessage = (extraction: Extraction) => {
    if (extraction.job_id && jobs[extraction.job_id]) {
      return jobs[extraction.job_id].error_message || 'Unknown error';
    }
    return 'Extraction failed';
  };

  const filteredExtractions = searchQuery.trim()
    ? extractions.filter(e => getFormName(e.form_id).toLowerCase().includes(searchQuery.toLowerCase()))
    : extractions;

  if (!selectedProject) {
    return (
      <DashboardLayout title="Extractions">
        <EmptyState
          icon={AlertCircle}
          title="No Project Selected"
          description="Please create or select a project to run extractions"
          action={{
            label: 'Go to Dashboard',
            onClick: () => router.push('/dashboard'),
          }}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title="Extractions"
      description="Run and monitor extraction jobs"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : extractions.length === 0 ? (
        <EmptyState
          icon={Play}
          title="No extractions yet"
          description="Start your first extraction to see results here"
          action={{
            label: 'Run New Extraction',
            onClick: openRunDialog,
          }}
        />
      ) : (
        <div className="max-w-full overflow-hidden">
          {/* Header: label + count + search + button */}
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-2">
              <span className={cn(typography.sectionHeader.default, 'text-gray-400')}>
                EXTRACTION JOBS
              </span>
              <span className={cn(typography.body.tiny, 'text-gray-300 dark:text-zinc-600')}>
                {extractions.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {extractions.length > 0 && (
                <div className="relative">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search extractions..."
                    className="text-sm text-gray-900 dark:text-white bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 pl-9 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 w-52"
                  />
                </div>
              )}
              <button
                onClick={openRunDialog}
                className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-gray-900 dark:bg-white dark:text-gray-900 px-4 py-2 rounded-lg cursor-pointer border-none transition-all duration-150 hover:bg-gray-700 dark:hover:bg-gray-100 hover:-translate-y-px"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Run New Extraction
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
          {filteredExtractions.length === 0 && searchQuery.trim() ? (
            <div className="text-center py-10 text-sm text-gray-400">No extractions matching &ldquo;{searchQuery}&rdquo;</div>
          ) : filteredExtractions.map(extraction => {
            const failed = extraction.status === 'failed';
            const isExpanded = expanded.has(extraction.id);
            const formName = getFormName(extraction.form_id);

            const getStatusCls = () => {
              switch (extraction.status) {
                case 'completed': return { cls: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50', label: 'Completed' };
                case 'running':   return { cls: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50', label: 'Running' };
                case 'failed':    return { cls: 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/50', label: 'Failed' };
                case 'pending':   return { cls: 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50', label: 'Pending' };
                default:          return { cls: 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]', label: 'Unknown' };
              }
            };

            const s = getStatusCls();

            return (
              <div
                key={extraction.id}
                className={cn(
                  "bg-white rounded-xl border border-border py-5 px-[22px] relative transition-all duration-150 hover:shadow-card-hover hover:-translate-y-px dark:bg-[#111111] dark:border-[#1f1f1f]",
                  failed && "border-l-[4px] border-l-purple-500 dark:border-l-purple-400 bg-gradient-to-r from-purple-50 to-white dark:from-purple-400/10 dark:to-[#111111]"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Title, date, status */}
                  <div className="flex-1 min-w-0">
                    {/* Title + status inline */}
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <h3 className="text-base font-semibold text-gray-900 m-0 tracking-tight leading-snug dark:text-white">{formName}</h3>
                      <span className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-[5px] tracking-wide whitespace-nowrap', s.cls)}>{s.label}</span>
                    </div>
                    {/* Date */}
                    <div className="text-xs text-gray-400">
                      {formatDate(extraction.created_at)}
                    </div>
                  </div>

                  {/* Right: Action button */}
                  <div className="flex-shrink-0">
                    {failed ? (
                      <button
                        onClick={() => toggle(extraction.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 bg-transparent border-none px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-purple-50 dark:hover:bg-purple-400/10"
                      >
                        {isExpanded ? "Hide" : "Show"} Details
                        <ChevronDown
                          className={cn(
                            "w-3.5 h-3.5 transition-transform duration-150",
                            isExpanded && "rotate-180"
                          )}
                        />
                      </button>
                    ) : (
                      <button
                        onClick={() => router.push(`/results?extraction_id=${extraction.id}`)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 bg-transparent border-none px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                      >
                        <Grid3x3 className="w-3.5 h-3.5" />
                        View Results
                      </button>
                    )}
                  </div>
                </div>

                {/* Error message */}
                {failed && isExpanded && (
                  <div className="mt-4 pt-4 border-t border-purple-100 dark:border-purple-400/20">
                    <div className="text-xs font-mono px-3.5 py-3 rounded-lg bg-purple-50 dark:bg-purple-400/10 border border-purple-200 dark:border-purple-400/20 text-purple-700 dark:text-purple-400 leading-relaxed break-words max-h-[200px] overflow-y-auto">
                      {getErrorMessage(extraction)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* Run Extraction Dialog */}
      {showRunDialog && (() => {
        const filteredForms = formSearch.trim()
          ? forms.filter(f => f.form_name.toLowerCase().includes(formSearch.toLowerCase()))
          : forms;
        const filteredDocs = docSearch.trim()
          ? documents.filter(d => d.filename.toLowerCase().includes(docSearch.toLowerCase()))
          : documents;
        const selectedForm = forms.find(f => f.id === selectedFormId);
        const docSummary = allDocs
          ? `${documents.length} document${documents.length !== 1 ? 's' : ''}`
          : `${selectedDocIds.size} document${selectedDocIds.size !== 1 ? 's' : ''}`;

        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowRunDialog(false)}>
            <div
              className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
                <div>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">New Extraction</h2>
                  <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Choose a form schema and the documents to run it on</p>
                </div>
                <button
                  onClick={() => setShowRunDialog(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:text-zinc-300 transition-colors border-none bg-transparent cursor-pointer mt-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Two-column body */}
              <div className="flex flex-1 min-h-0">

                {/* Left — Form */}
                <div className="w-[42%] flex flex-col border-r border-gray-100 dark:border-[#1f1f1f] min-h-0">
                  {/* Column header */}
                  <div className="px-5 pt-4 pb-3 flex-shrink-0">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Form</span>
                      {selectedFormId && (
                        <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 px-1.5 py-0.5 rounded-[4px]">Selected</span>
                      )}
                    </div>
                    {/* Form search */}
                    <div className="relative">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                      </svg>
                      <input
                        type="text"
                        value={formSearch}
                        onChange={e => setFormSearch(e.target.value)}
                        placeholder="Search forms..."
                        className="w-full text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-1.5 pl-8 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 dark:placeholder:text-zinc-600"
                      />
                    </div>
                  </div>

                  {/* Form list */}
                  <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1.5">
                    {forms.length === 0 ? (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                        No active forms. Create and activate a form first.
                      </div>
                    ) : filteredForms.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">No forms matching &ldquo;{formSearch}&rdquo;</p>
                    ) : filteredForms.map((form) => {
                      const isSelected = selectedFormId === form.id;
                      return (
                        <button
                          key={form.id}
                          onClick={() => setSelectedFormId(form.id)}
                          className={cn(
                            "w-full text-left px-3.5 py-3 rounded-xl border transition-all duration-150 cursor-pointer group",
                            isSelected
                              ? "border-gray-900 dark:border-zinc-500 bg-gray-900 dark:bg-[#1f1f1f]"
                              : "border-gray-100 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] hover:border-gray-300 dark:hover:border-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                          )}
                        >
                          <div className="flex items-start gap-2.5">
                            <div className={cn(
                              "w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 transition-colors",
                              isSelected ? "bg-white dark:bg-zinc-300" : "bg-gray-300 dark:bg-zinc-600 group-hover:bg-gray-400 dark:group-hover:bg-zinc-500"
                            )} />
                            <div className="flex-1 min-w-0">
                              <p className={cn("text-sm font-semibold truncate leading-snug", isSelected ? "text-white" : "text-gray-900 dark:text-white")}>{form.form_name}</p>
                              {form.form_description && (
                                <p className={cn("text-xs mt-0.5 truncate leading-snug", isSelected ? "text-gray-300 dark:text-zinc-400" : "text-gray-400 dark:text-zinc-500")}>{form.form_description}</p>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Right — Documents */}
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="px-5 pt-4 pb-3 flex-shrink-0">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Documents</span>
                      {/* All / Specific pill toggle */}
                      <div className="flex items-center bg-gray-100 dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#1f1f1f] rounded-lg p-0.5 gap-0.5">
                        <button
                          onClick={() => { setAllDocs(true); setSelectedDocIds(new Set()); setDocSearch(''); }}
                          className={cn(
                            "text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all duration-150 cursor-pointer border-none",
                            allDocs
                              ? "bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-white shadow-sm"
                              : "bg-transparent text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
                          )}
                        >All</button>
                        <button
                          onClick={() => setAllDocs(false)}
                          className={cn(
                            "text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all duration-150 cursor-pointer border-none",
                            !allDocs
                              ? "bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-white shadow-sm"
                              : "bg-transparent text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
                          )}
                        >Specific</button>
                      </div>
                    </div>

                    {allDocs ? (
                      <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a1a1a] border border-gray-100 dark:border-[#2a2a2a]">
                        <div className="w-7 h-7 rounded-lg bg-gray-200 dark:bg-[#2a2a2a] flex items-center justify-center flex-shrink-0">
                          <FileText className="w-3.5 h-3.5 text-gray-500 dark:text-zinc-400" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{documents.length} document{documents.length !== 1 ? 's' : ''}</p>
                          <p className="text-xs text-gray-400 dark:text-zinc-500">All processed documents will be included</p>
                        </div>
                      </div>
                    ) : (
                      /* Doc search + select-all row */
                      <div className="space-y-2">
                        <div className="relative">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                          </svg>
                          <input
                            type="text"
                            value={docSearch}
                            onChange={e => setDocSearch(e.target.value)}
                            placeholder="Search documents..."
                            className="w-full text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-1.5 pl-8 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 dark:placeholder:text-zinc-600"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400 dark:text-zinc-500">{selectedDocIds.size} of {documents.length} selected</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setSelectedDocIds(new Set(documents.map(d => d.id)))}
                              className="text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-white bg-transparent border-none cursor-pointer transition-colors underline-offset-2 hover:underline"
                            >Select all</button>
                            <span className="text-gray-300 dark:text-zinc-700">·</span>
                            <button
                              onClick={() => setSelectedDocIds(new Set())}
                              className="text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-white bg-transparent border-none cursor-pointer transition-colors underline-offset-2 hover:underline"
                            >Clear</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Document list (specific mode) */}
                  {!allDocs && (
                    <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1">
                      {filteredDocs.length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">
                          {documents.length === 0 ? 'No processed documents available' : `No documents matching "${docSearch}"`}
                        </p>
                      ) : filteredDocs.map((doc) => {
                        const checked = selectedDocIds.has(doc.id);
                        return (
                          <button
                            key={doc.id}
                            onClick={() => toggleDoc(doc.id)}
                            className={cn(
                              "w-full text-left flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all duration-100 cursor-pointer",
                              checked
                                ? "border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#1a1a1a]"
                                : "border-transparent bg-transparent hover:border-gray-200 dark:hover:border-[#1f1f1f] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                            )}
                          >
                            <div className={cn(
                              "w-4 h-4 rounded-[4px] flex items-center justify-center flex-shrink-0 border transition-colors",
                              checked
                                ? "bg-gray-900 dark:bg-white border-gray-900 dark:border-white"
                                : "border-gray-300 dark:border-[#3a3a3a] bg-white dark:bg-[#0a0a0a]"
                            )}>
                              {checked && <Check className="w-2.5 h-2.5 text-white dark:text-gray-900" />}
                            </div>
                            <div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center flex-shrink-0">
                              <FileText className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-900 dark:text-white truncate leading-snug">{doc.filename}</p>
                              <p className="text-xs text-gray-400 dark:text-zinc-500">{formatDate(doc.created_at)}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] rounded-b-2xl flex-shrink-0">
                {/* Summary */}
                <div className="flex items-center gap-1.5 min-w-0">
                  {selectedForm ? (
                    <>
                      <span className="text-xs font-semibold text-gray-800 dark:text-zinc-200 truncate">{selectedForm.form_name}</span>
                      <span className="text-gray-300 dark:text-zinc-600 text-xs flex-shrink-0">·</span>
                      <span className="text-xs text-gray-400 dark:text-zinc-500 flex-shrink-0">{docSummary}</span>
                    </>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-zinc-500 italic">Select a form to continue</span>
                  )}
                </div>
                <div className="flex items-center gap-2.5 flex-shrink-0">
                  <button
                    onClick={() => setShowRunDialog(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-zinc-300 bg-transparent border border-gray-200 dark:border-[#2a2a2a] rounded-lg hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:border-[#3a3a3a] cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRunExtraction}
                    disabled={!selectedFormId || runningExtraction || (!allDocs && selectedDocIds.size === 0)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-lg cursor-pointer border-none transition-all duration-150 hover:bg-gray-700 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {runningExtraction ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />Starting...</>
                    ) : (
                      <><Play className="h-3.5 w-3.5 fill-current" />Start Extraction</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </DashboardLayout>
  );
}

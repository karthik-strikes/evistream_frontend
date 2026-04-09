'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, X, FileText, Check, Loader2, AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { extractionsService, documentsService } from '@/services';
import type { FormCoverage } from '@/services/extractions.service';
import { useToast } from '@/hooks/use-toast';
import { formatDate, cn, getErrorMessage } from '@/lib/utils';
import type { Form, Document } from '@/types/api';

const MAX_DOCS_PER_JOB = 100;

interface RunExtractionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  forms: Form[];
  projectId: string;
  activeExtractionCount: number;
  queryKey: unknown[];
  coverageData?: FormCoverage[];
  /** Pre-select a form when opening (e.g. from "Run Remaining" button) */
  initialFormId?: string;
  /** Pre-select specific documents when opening */
  initialDocIds?: string[];
}

export function RunExtractionDialog({
  isOpen,
  onClose,
  forms,
  projectId,
  activeExtractionCount,
  queryKey,
  coverageData = [],
  initialFormId,
  initialDocIds,
}: RunExtractionDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedFormId, setSelectedFormId] = useState('');
  const [runningExtraction, setRunningExtraction] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [formSearch, setFormSearch] = useState('');
  const [docSearch, setDocSearch] = useState('');

  // Draggable divider state
  const [leftWidth, setLeftWidth] = useState(42);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftWidth(Math.min(65, Math.max(25, pct)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Load docs and reset state when dialog opens or initial values change
  useEffect(() => {
    if (!isOpen) return;
    setSelectedFormId(initialFormId || '');
    setSelectedDocIds(initialDocIds ? new Set(initialDocIds) : new Set());
    setFormSearch('');
    setDocSearch('');

    documentsService
      .getAll(projectId)
      .then((docs) => setDocuments(docs.filter((d) => d.processing_status === 'completed')))
      .catch(() => setDocuments([]));
  }, [isOpen, projectId, initialFormId, initialDocIds]);

  const handleRunExtraction = async () => {
    if (!projectId || !selectedFormId) {
      toast({ title: 'Error', description: 'Please select a form', variant: 'error' });
      return;
    }
    try {
      setRunningExtraction(true);
      await extractionsService.create({
        project_id: projectId,
        form_id: selectedFormId,
        document_ids: Array.from(selectedDocIds),
      });
      toast({ title: 'Success', description: 'Extraction started successfully', variant: 'success' });
      onClose();
      queryClient.invalidateQueries({ queryKey });
      // Second invalidation after a short delay to catch backend state update
      setTimeout(() => queryClient.invalidateQueries({ queryKey }), 2000);
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
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedDocIds(next);
  };

  if (!isOpen) return null;

  const filteredForms = formSearch.trim()
    ? forms.filter((f) => f.form_name.toLowerCase().includes(formSearch.toLowerCase()))
    : forms;
  const filteredDocs = docSearch.trim()
    ? documents.filter((d) => d.filename.toLowerCase().includes(docSearch.toLowerCase()))
    : documents;
  const selectedForm = forms.find((f) => f.id === selectedFormId);
  const docSummary = `${selectedDocIds.size} document${selectedDocIds.size !== 1 ? 's' : ''}`;
  const effectiveDocCount = selectedDocIds.size;
  const overLimit = effectiveDocCount > MAX_DOCS_PER_JOB;
  const tooManyActive = activeExtractionCount >= 10;
  const hasQueuedJobs = activeExtractionCount >= 2 && !tooManyActive;
  const canStart =
    !!selectedFormId &&
    !runningExtraction &&
    !overLimit &&
    !tooManyActive &&
    selectedDocIds.size > 0;

  // Check for already-extracted documents with the selected form
  const selectedFormCoverage = coverageData.find((c) => c.form_id === selectedFormId);
  const alreadyExtractedIds = new Set(selectedFormCoverage?.extracted_document_ids ?? []);
  const overlapCount = selectedFormId
    ? Array.from(selectedDocIds).filter((id) => alreadyExtractedIds.has(id)).length
    : 0;
  const allOverlap = overlapCount > 0 && overlapCount === selectedDocIds.size;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
              New Extraction
            </h2>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
              Choose a form schema and the documents to run it on
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:text-zinc-300 transition-colors border-none bg-transparent cursor-pointer mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Active extractions warning */}
        {tooManyActive && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 inline-block mr-1.5 -mt-0.5" />
            You have {activeExtractionCount} extractions queued. Wait for some to finish before submitting more.
          </div>
        )}

        {/* Queued jobs info — not blocking, just informational */}
        {hasQueuedJobs && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/40 text-xs text-blue-700 dark:text-blue-400">
            You have {activeExtractionCount} extractions in progress. This one will be queued and start automatically when a slot opens.
          </div>
        )}

        {/* Already-extracted documents warning */}
        {overlapCount > 0 && !tooManyActive && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 inline-block mr-1.5 -mt-0.5" />
            {allOverlap ? (
              <>All {overlapCount} selected documents have already been extracted with this form. Running again will use LLM credits for duplicate results.</>
            ) : (
              <>{overlapCount} of {selectedDocIds.size} selected documents have already been extracted with this form. These will be re-extracted, using additional LLM credits.</>
            )}
          </div>
        )}

        {/* Two-column body */}
        <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left — Form */}
          <div style={{ width: `${leftWidth}%` }} className="flex flex-col min-h-0 overflow-hidden flex-shrink-0">
            <div className="px-5 pt-4 pb-3 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">
                  Form
                </span>
                {selectedFormId && (
                  <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 px-1.5 py-0.5 rounded-[4px]">
                    Selected
                  </span>
                )}
              </div>
              <div className="relative">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#9ca3af"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  value={formSearch}
                  onChange={(e) => setFormSearch(e.target.value)}
                  placeholder="Search forms..."
                  className="w-full text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-1.5 pl-8 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 dark:placeholder:text-zinc-600"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1.5">
              {forms.length === 0 ? (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  No active forms. Create and activate a form first.
                </div>
              ) : filteredForms.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">
                  No forms matching &ldquo;{formSearch}&rdquo;
                </p>
              ) : (
                filteredForms.map((form) => {
                  const isSelected = selectedFormId === form.id;
                  return (
                    <button
                      key={form.id}
                      onClick={() => setSelectedFormId(form.id)}
                      className={cn(
                        'w-full text-left px-3.5 py-3 rounded-xl border transition-all duration-150 cursor-pointer group',
                        isSelected
                          ? 'border-gray-900 dark:border-zinc-500 bg-gray-900 dark:bg-[#1f1f1f]'
                          : 'border-gray-100 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] hover:border-gray-300 dark:hover:border-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]',
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={cn(
                            'w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 transition-colors',
                            isSelected
                              ? 'bg-white dark:bg-zinc-300'
                              : 'bg-gray-300 dark:bg-zinc-600 group-hover:bg-gray-400 dark:group-hover:bg-zinc-500',
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              'text-sm font-semibold truncate leading-snug',
                              isSelected ? 'text-white' : 'text-gray-900 dark:text-white',
                            )}
                          >
                            {form.form_name}
                          </p>
                          {form.form_description && (
                            <p
                              className={cn(
                                'text-xs mt-0.5 truncate leading-snug',
                                isSelected
                                  ? 'text-gray-300 dark:text-zinc-400'
                                  : 'text-gray-400 dark:text-zinc-500',
                              )}
                            >
                              {form.form_description}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Draggable divider */}
          <div
            onMouseDown={handleMouseDown}
            className="w-1 flex-shrink-0 cursor-col-resize relative group"
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
            <div className="absolute inset-y-0 left-0 w-px bg-gray-100 dark:bg-[#1f1f1f] group-hover:bg-gray-300 dark:group-hover:bg-[#3a3a3a] transition-colors" />
          </div>

          {/* Right — Documents */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">
                  Documents
                </span>
              </div>

              <div className="space-y-2">
                <div className="relative">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#9ca3af"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={docSearch}
                    onChange={(e) => setDocSearch(e.target.value)}
                    placeholder="Search documents..."
                    className="w-full text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-1.5 pl-8 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 dark:placeholder:text-zinc-600"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'text-xs',
                      overLimit
                        ? 'text-red-600 dark:text-red-400 font-semibold'
                        : 'text-gray-400 dark:text-zinc-500',
                    )}
                  >
                    {selectedDocIds.size} selected / {MAX_DOCS_PER_JOB} max
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedDocIds(new Set(filteredDocs.map((d) => d.id)))}
                      className="text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-white bg-transparent border-none cursor-pointer transition-colors underline-offset-2 hover:underline"
                    >
                      Select all
                    </button>
                    <span className="text-gray-300 dark:text-zinc-700">·</span>
                    <button
                      onClick={() => setSelectedDocIds(new Set())}
                      className="text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-white bg-transparent border-none cursor-pointer transition-colors underline-offset-2 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1">
              {filteredDocs.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">
                  {documents.length === 0
                    ? 'No processed documents available'
                    : `No documents matching "${docSearch}"`}
                </p>
              ) : (
                filteredDocs.map((doc) => {
                  const checked = selectedDocIds.has(doc.id);
                  const alreadyDone = selectedFormId ? alreadyExtractedIds.has(doc.id) : false;
                  return (
                    <button
                      key={doc.id}
                      onClick={() => toggleDoc(doc.id)}
                      className={cn(
                        'w-full min-w-0 text-left flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all duration-100 cursor-pointer overflow-hidden',
                        checked
                          ? 'border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#1a1a1a]'
                          : 'border-transparent bg-transparent hover:border-gray-200 dark:hover:border-[#1f1f1f] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]',
                      )}
                    >
                      <div
                        className={cn(
                          'w-4 h-4 rounded-[4px] flex items-center justify-center flex-shrink-0 border transition-colors',
                          checked
                            ? 'bg-gray-900 dark:bg-white border-gray-900 dark:border-white'
                            : 'border-gray-300 dark:border-[#3a3a3a] bg-white dark:bg-[#0a0a0a]',
                        )}
                      >
                        {checked && <Check className="w-2.5 h-2.5 text-white dark:text-gray-900" />}
                      </div>
                      <div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center flex-shrink-0">
                        <FileText className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-gray-900 dark:text-white truncate leading-snug">
                            {doc.filename}
                          </p>
                          {alreadyDone && (
                            <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 px-1.5 py-0.5 rounded-[4px] flex-shrink-0">
                              Extracted
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 dark:text-zinc-500">
                          {formatDate(doc.created_at)}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] rounded-b-2xl flex-shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {selectedForm ? (
              <>
                <span className="text-xs font-semibold text-gray-800 dark:text-zinc-200 truncate">
                  {selectedForm.form_name}
                </span>
                <span className="text-gray-300 dark:text-zinc-600 text-xs flex-shrink-0">·</span>
                <span
                  className={cn(
                    'text-xs flex-shrink-0',
                    overLimit ? 'text-red-500 font-semibold' : 'text-gray-400 dark:text-zinc-500',
                  )}
                >
                  {docSummary}
                  {overLimit ? ` (max ${MAX_DOCS_PER_JOB})` : ''}
                </span>
              </>
            ) : (
              <span className="text-xs text-gray-400 dark:text-zinc-500 italic">
                Select a form to continue
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-zinc-300 bg-transparent border border-gray-200 dark:border-[#2a2a2a] rounded-lg hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:border-[#3a3a3a] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRunExtraction}
              disabled={!canStart}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-lg cursor-pointer border-none transition-all duration-150 hover:bg-gray-700 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {runningExtraction ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Start Extraction
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

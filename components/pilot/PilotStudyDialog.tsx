'use client';

import { EMPTY_DISPLAY_TOKENS, FAILED_LABEL } from '@/lib/absence';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Search, Loader2, ThumbsUp, ThumbsDown, Check, RotateCcw, Quote, ScanText } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import { useProject } from '@/contexts/ProjectContext';
import { formsService, documentsService } from '@/services';
import { apiClient } from '@/lib/api';
import { cn, getErrorMessage } from '@/lib/utils';
import { transformToLongFormat } from '@/lib/longFormatTransform';
import type { Form, Document, PilotState, PilotFieldFeedback, FormField, FieldPrompt } from '@/types/api';
import { FieldEditorPane, type UEFCalField, type UEFEditableField } from '@/components/forms/FieldEditorPane';
import { SourceEvidenceDrawer } from '@/components/source-evidence/SourceEvidenceDrawer';

type Step = 'select' | 'running' | 'review';

// Metadata keys that wrap every extracted field — must be filtered out
const METADATA_KEYS = new Set(['source_text', 'source_location', 'confidence', 'reasoning']);

function extractDisplayValue(fieldData: any): string {
  if (fieldData === null || fieldData === undefined) return '---';
  const value = (fieldData && typeof fieldData === 'object' && !Array.isArray(fieldData) && 'value' in fieldData) ? fieldData.value : fieldData;
  if (value === null || value === undefined) return '---';
  if (typeof value === 'string') return value.trim() || '---';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length === 0 ? '---' : `${value.length} items`;
  const j = JSON.stringify(value);
  return j.length > 80 ? j.slice(0, 80) + '...' : j;
}

// Source-evidence helpers (mirrors results/_components/LongFormatTable.tsx)
function getSourceText(data: any): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (typeof data.source_text === 'string' && data.source_text.trim() && data.source_text !== 'NR') return data.source_text;
  return null;
}
function getPageRef(data: any): number | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (typeof data.page === 'number') return data.page;
  const loc = data.source_location;
  if (loc && typeof loc === 'object' && loc.page) return Number(loc.page);
  return null;
}

const formatFieldName = (f: string) =>
  f.replace(/_/g, ' ').replace(/\./g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

interface Props {
  form: Form;
  onClose: () => void;
}

export default function PilotStudyDialog({ form, onClose }: Props) {
  const { selectedProject } = useProject();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('select');
  const [showEvidence, setShowEvidence] = useState(false);
  const [active, setActive] = useState<{ ri: number; col: string } | null>(null);
  const [pilotState, setPilotState] = useState<PilotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Document selection
  const [selectionMode, setSelectionMode] = useState<'manual' | 'random'>('random');
  const [count, setCount] = useState(3);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [docSearch, setDocSearch] = useState('');

  // Step 2: Running
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [paperProgress, setPaperProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  // Step 3: Review (table)
  const [fieldFeedback, setFieldFeedback] = useState<Record<string, PilotFieldFeedback>>({});
  const [expandedCell, setExpandedCell] = useState<string | null>(null); // "fieldName:docId"

  // Column reorder (Paper column is locked at index 0)
  const colOrderKey = `pilot-col-order:${form.id}`;
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(colOrderKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(colOrderKey, JSON.stringify(columnOrder)); } catch {}
  }, [columnOrder, colOrderKey]);
  const draggedColRef = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const moveColumn = useCallback((dataCols: string[], dragged: string, target: string) => {
    if (dragged === target || dragged === 'Paper' || target === 'Paper') return;
    const next = [...dataCols];
    const from = next.indexOf(dragged);
    const to = next.indexOf(target);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragged);
    setColumnOrder(next);
  }, []);

  // Inline field editor (👎 in column header opens this for overall field feedback)
  const [editingFieldName, setEditingFieldName] = useState<string | null>(null);
  const [editingCal, setEditingCal] = useState<UEFCalField | null>(null);
  const [editingFieldPatch, setEditingFieldPatch] = useState<Partial<FormField>>({});
  const [savingFieldEdit, setSavingFieldEdit] = useState(false);
  // Which subfield card the editor should scroll to (👎 on a table column)
  const [focusSubfield, setFocusSubfield] = useState<{ name: string; nonce: number } | null>(null);
  const focusNonceRef = useRef(0);
  // Calibration (description/hints/rules/examples) is loaded from /field-prompts, NOT from form.fields
  const [fieldPrompts, setFieldPrompts] = useState<Record<string, FieldPrompt> | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);

  const fetchFieldPrompts = useCallback(async (): Promise<Record<string, FieldPrompt> | null> => {
    if (fieldPrompts) return fieldPrompts;
    try {
      const data = await formsService.getFieldPrompts(form.id);
      setFieldPrompts(data.field_prompts);
      return data.field_prompts;
    } catch {
      return null;
    }
  }, [fieldPrompts, form.id]);

  const calFromPromptOrField = useCallback((fieldName: string, prompts: Record<string, FieldPrompt> | null): UEFCalField => {
    const fp = prompts?.[fieldName];
    const f = form.fields.find(ff => ff.field_name === fieldName);
    return {
      description: fp?.description || f?.field_description || '',
      hints: fp?.hints || f?.hints || [],
      rules: fp?.rules || f?.rules || [],
      examples: (fp?.examples || f?.examples || (f?.example ? [{ value: f.example, source_text: '' }] : [])).map((e: any) =>
        typeof e === 'string' ? { value: e, source_text: '' } : { value: String(e?.value ?? ''), source_text: e?.source_text || '' }
      ),
    };
  }, [form.fields]);

  const openFieldEditor = useCallback(async (fieldName: string, subfieldName: string | null = null) => {
    const f = form.fields.find(ff => ff.field_name === fieldName);
    if (!f) return;
    setEditingFieldName(fieldName);
    setEditingFieldPatch({});
    if (subfieldName) {
      focusNonceRef.current += 1;
      setFocusSubfield({ name: subfieldName, nonce: focusNonceRef.current });
    } else {
      setFocusSubfield(null);
    }
    // Show editor immediately with whatever we have, then refine once prompts load
    setEditingCal(calFromPromptOrField(fieldName, fieldPrompts));
    if (!fieldPrompts) {
      setEditorLoading(true);
      const prompts = await fetchFieldPrompts();
      // Re-seed cal from freshly loaded prompts (only if this field is still being edited)
      setEditingFieldName(curr => {
        if (curr === fieldName) setEditingCal(calFromPromptOrField(fieldName, prompts));
        return curr;
      });
      setEditorLoading(false);
    }
  }, [form.fields, fieldPrompts, fetchFieldPrompts, calFromPromptOrField]);

  const closeFieldEditor = useCallback(() => {
    setEditingFieldName(null);
    setEditingCal(null);
    setEditingFieldPatch({});
    setFocusSubfield(null);
  }, []);

  const saveFieldEdit = useCallback(async () => {
    if (!editingFieldName || !editingCal) return;
    setSavingFieldEdit(true);
    try {
      const patchedOptions = (editingFieldPatch as any).options;
      await formsService.updateFieldEdits(form.id, [{
        field_name: editingFieldName,
        description: editingCal.description,
        hints: editingCal.hints,
        rules: editingCal.rules,
        examples: editingCal.examples,
        ...(Array.isArray(patchedOptions) ? { options: patchedOptions } : {}),
      }]);
      const patchedSubfields = (editingFieldPatch as any).subform_fields;
      if (Array.isArray(patchedSubfields)) {
        const clean = patchedSubfields
          .map((sf: any) => ({ ...sf, field_name: (sf.field_name || '').trim() }))
          .filter((sf: any) => sf.field_name);
        if (clean.length > 0) {
          await formsService.updateSubfieldEdit(form.id, editingFieldName, clean);
        }
      }
      toast({ title: 'Field updated', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['forms'] });
      setFieldPrompts(null); // force refetch on next openFieldEditor
      closeFieldEditor();
    } catch (err: any) {
      toast({ title: 'Error', description: getErrorMessage(err, 'Failed to update field'), variant: 'error' });
    } finally {
      setSavingFieldEdit(false);
    }
  }, [editingFieldName, editingCal, editingFieldPatch, form.id, toast, queryClient, closeFieldEditor]);

  // Fetch documents for manual selection
  const { data: documents = [] } = useQuery({
    queryKey: ['documents', selectedProject?.id],
    queryFn: () => documentsService.getAll(selectedProject!.id),
    enabled: !!selectedProject,
  });

  const completedDocs = useMemo(
    () => documents.filter((d: Document) => d.processing_status === 'completed'),
    [documents]
  );

  const filteredDocs = useMemo(() => {
    if (!docSearch.trim()) return completedDocs;
    const q = docSearch.toLowerCase();
    return completedDocs.filter((d: Document) => d.filename.toLowerCase().includes(q));
  }, [completedDocs, docSearch]);

  // Build doc name lookup
  const docNames = useMemo(() => {
    const map: Record<string, string> = {};
    documents.forEach((d: Document) => { map[d.id] = d.filename; });
    return map;
  }, [documents]);

  // Build doc ref_id lookup
  const docRefIds = useMemo(() => {
    const map: Record<string, number> = {};
    documents.forEach((d: Document) => { if (d.ref_id != null) map[d.id] = d.ref_id; });
    return map;
  }, [documents]);

  // Short doc name (e.g., "569_Seymour.pdf" → "569_Seymour")
  const shortDocName = (docId: string) => {
    const name = docNames[docId] || docId.slice(0, 8);
    return name.replace(/\.(pdf|md)$/i, '');
  };

  // Load pilot state on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await formsService.getPilot(form.id);
        if (cancelled) return;
        setPilotState(state);

        if (state.status === 'running') {
          setStep('running');
          const latestIter = state.iterations?.[state.iterations.length - 1];
          if (latestIter?.job_id) setActiveJobId(latestIter.job_id);
        } else if (state.status === 'reviewing' || state.status === 'completed') {
          setStep('review');
          _initReviewState(state);
        }
      } catch {
        // No pilot state yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [form.id]);

  const _initReviewState = (state: PilotState) => {
    const latestIter = state.iterations?.[state.iterations.length - 1];
    if (!latestIter?.results) return;
    if (latestIter.feedback && Object.keys(latestIter.feedback).length > 0) {
      setFieldFeedback(latestIter.feedback);
    } else {
      setFieldFeedback({});
    }
    setExpandedCell(null);
  };

  // WebSocket for job progress
  useEffect(() => {
    if (!activeJobId || step !== 'running') return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || window.location.origin;
    const wsBase = apiUrl.replace(/^https?/, (s: string) => (s === 'https' ? 'wss' : 'ws'));
    const token = apiClient.getToken();
    const ws = new WebSocket(`${wsBase}/api/v1/ws/jobs/${activeJobId}${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (token) ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'paper_done') {
          setPaperProgress({ done: msg.papers_done || 0, total: msg.papers_total || 0 });
        } else if (msg.type === 'complete') {
          _refreshPilotState();
        }
      } catch { /* ignore */ }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [activeJobId, step]);

  // Poll for completion when running (fallback)
  useEffect(() => {
    if (step !== 'running') return;
    const interval = setInterval(() => { _refreshPilotState(); }, 5000);
    return () => clearInterval(interval);
  }, [step, form.id]);

  const _refreshPilotState = useCallback(async () => {
    try {
      const state = await formsService.getPilot(form.id);
      setPilotState(state);
      if (state.status === 'reviewing') {
        setStep('review');
        _initReviewState(state);
        setActiveJobId(null);
      } else if (state.status === 'failed') {
        setStep('select');
        setActiveJobId(null);
        toast({ title: 'Pilot extraction failed', description: 'Please try again', variant: 'error' });
      }
    } catch { /* ignore */ }
  }, [form.id]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleStartPilot = async () => {
    setSubmitting(true);
    try {
      const docIds = selectionMode === 'manual' ? Array.from(selectedDocIds) : undefined;
      const effectiveCount = docIds?.length || count;
      await formsService.startPilot(form.id, docIds, count);
      toast({ title: 'Pilot started', description: `Extracting ${effectiveCount} papers`, variant: 'success' });
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: getErrorMessage(err, 'Failed to start pilot'), variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitFeedback = async () => {
    if (!pilotState?.current_iteration) return;
    setSubmitting(true);
    try {
      const resp = await formsService.submitPilotFeedback(
        form.id, pilotState.current_iteration, fieldFeedback
      );
      setActiveJobId(resp.job_id);
      setFieldFeedback({});
      setExpandedCell(null);
      setPaperProgress({ done: 0, total: pilotState?.sample_document_ids?.length || 0 });
      setStep('running');
      toast({ title: 'Feedback submitted', description: `Starting iteration ${resp.iteration}`, variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: getErrorMessage(err, 'Failed to submit feedback'), variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinalize = async () => {
    setSubmitting(true);
    try {
      const resp = await formsService.completePilot(form.id);
      toast({
        title: 'Pilot finalized',
        description: `${resp.total_examples} calibration examples across ${resp.fields_with_examples} fields`,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: getErrorMessage(err, 'Failed to finalize'), variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async () => {
    setSubmitting(true);
    try {
      await formsService.resetPilot(form.id);
      setPilotState(null);
      setStep('select');
      setFieldFeedback({});
      setExpandedCell(null);
      queryClient.invalidateQueries({ queryKey: ['forms', selectedProject?.id], exact: false });
      toast({ title: 'Pilot reset', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: getErrorMessage(err, 'Failed to reset'), variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Field feedback helpers ────────────────────────────────────────────────

  const setRating = (fieldName: string, docId: string, rating: 'correct' | 'incorrect') => {
    setFieldFeedback(prev => ({
      ...prev,
      [fieldName]: {
        ...prev[fieldName],
        rating,
        document_id: docId,
        ...(rating === 'correct' ? { correct_value: undefined, correct_source_text: undefined, note: undefined } : {}),
      },
    }));
  };

  // Table columns are rated individually — the rating lives under the parent
  // field's subfield_corrections so the backend can key it as "parent.col".
  const setSubfieldRating = (
    parentField: string,
    colName: string,
    docId: string,
    rating: 'correct' | 'incorrect',
  ) => {
    setFieldFeedback(prev => {
      const parent = prev[parentField];
      return {
        ...prev,
        [parentField]: {
          ...parent,
          document_id: docId,
          subfield_corrections: {
            ...(parent?.subfield_corrections || {}),
            [colName]: {
              ...(parent?.subfield_corrections?.[colName] || {}),
              rating,
              ...(rating === 'correct'
                ? { correct_value: undefined, correct_source_text: undefined, note: undefined }
                : {}),
            },
          },
        },
      };
    });
  };

  const setCorrectionField = (fieldName: string, key: keyof PilotFieldFeedback, value: string) => {
    setFieldFeedback(prev => ({
      ...prev,
      [fieldName]: { ...prev[fieldName], [key]: value },
    }));
  };

  const setSubfieldCorrection = (fieldName: string, colName: string, key: string, value: string) => {
    setFieldFeedback(prev => ({
      ...prev,
      [fieldName]: {
        ...prev[fieldName],
        subfield_corrections: {
          ...((prev[fieldName] as any)?.subfield_corrections || {}),
          [colName]: {
            ...((prev[fieldName] as any)?.subfield_corrections?.[colName] || {}),
            [key]: value,
          },
        },
      },
    }));
  };

  // ── Computed ──────────────────────────────────────────────────────────────

  const latestResults = useMemo(() => {
    if (!pilotState?.iterations?.length) return {};
    return pilotState.iterations[pilotState.iterations.length - 1].results || {};
  }, [pilotState]);

  const docIds = useMemo(() => Object.keys(latestResults), [latestResults]);

  // Filter out metadata keys — only real form fields
  const fieldNames = useMemo(() => {
    const names = new Set<string>();
    for (const docResults of Object.values(latestResults)) {
      for (const key of Object.keys(docResults as Record<string, any>)) {
        if (!METADATA_KEYS.has(key)) names.add(key);
      }
    }
    return Array.from(names);
  }, [latestResults]);

  // Count rated *columns*, not rated entries — one table field can hold a
  // rating per column under subfield_corrections.
  const reviewedCount = useMemo(() => {
    let n = 0;
    for (const fb of Object.values(fieldFeedback)) {
      if (fb?.rating) n += 1;
      for (const col of Object.values(fb?.subfield_corrections || {})) {
        if (col?.rating) n += 1;
      }
    }
    return n;
  }, [fieldFeedback]);
  const totalFieldCount = fieldNames.length;

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white dark:bg-[#111111] rounded-2xl p-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400 mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className={cn(
          "bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] flex flex-col shadow-2xl",
          step === 'review'
            ? "w-full max-w-[95vw] xl:max-w-[1500px] max-h-[95vh]"
            : "w-full max-w-[95vw] xl:max-w-[1200px] max-h-[90vh]"
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">{form.form_name}</h2>
                <span className="text-xs px-2 py-0.5 rounded-md bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-300 border border-gray-200 dark:border-[#2a2a2a] font-medium">Pilot</span>
                {pilotState?.current_iteration && pilotState.current_iteration > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border border-sky-200/60 dark:border-sky-800/40 font-medium">
                    Iteration {pilotState.current_iteration}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                {step === 'select' && 'Run extraction on a small sample to verify quality before processing all documents.'}
                {step === 'running' && 'Extracting from selected papers — this usually takes a minute or two.'}
                {step === 'review' && 'Review the extracted values. 👍 looks correct, 👎 to refine that column’s prompt.'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(pilotState?.status === 'reviewing' || pilotState?.status === 'completed') && (
                <button
                  onClick={handleReset}
                  disabled={submitting}
                  className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              )}
              <button type="button" onClick={onClose} className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors p-1 shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-5">

          {/* ── STEP 1: Document Selection ──────────────────────────────── */}
          {step === 'select' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">Select papers for pilot</h3>
                <p className="text-xs text-gray-400">
                  Run extraction on a small sample to verify quality before processing all documents.
                </p>
              </div>

              {/* Mode + Count */}
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="selectionMode"
                      checked={selectionMode === 'random'}
                      onChange={() => setSelectionMode('random')}
                      className="accent-gray-900 dark:accent-white"
                    />
                    <span className="text-xs text-gray-600 dark:text-zinc-300">Random</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="selectionMode"
                      checked={selectionMode === 'manual'}
                      onChange={() => setSelectionMode('manual')}
                      className="accent-gray-900 dark:accent-white"
                    />
                    <span className="text-xs text-gray-600 dark:text-zinc-300">Let me choose</span>
                  </label>
                </div>

                {/* Only show count picker for random mode */}
                {selectionMode === 'random' && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 dark:text-zinc-400">Papers:</label>
                    <select
                      value={count}
                      onChange={e => setCount(Number(e.target.value))}
                      className="text-xs border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 py-1.5 bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-white"
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Manual selection list */}
              {selectionMode === 'manual' && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search documents..."
                      value={docSearch}
                      onChange={e => setDocSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-zinc-600"
                    />
                  </div>
                  <div className="border border-gray-200 dark:border-[#1f1f1f] rounded-lg max-h-[280px] overflow-y-auto divide-y divide-gray-100 dark:divide-[#1f1f1f]">
                    {filteredDocs.length === 0 ? (
                      <div className="p-4 text-xs text-gray-400 text-center">No completed documents found</div>
                    ) : (
                      filteredDocs.map((doc: Document) => (
                        <label
                          key={doc.id}
                          className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedDocIds.has(doc.id)}
                            onChange={() => {
                              setSelectedDocIds(prev => {
                                const next = new Set(prev);
                                next.has(doc.id) ? next.delete(doc.id) : next.add(doc.id);
                                return next;
                              });
                            }}
                            className="accent-gray-900 dark:accent-white shrink-0"
                          />
                          <span className="text-xs text-gray-700 dark:text-zinc-300 truncate">{doc.filename}</span>
                        </label>
                      ))
                    )}
                  </div>
                  {selectedDocIds.size > 0 && (
                    <p className="text-xs text-gray-400">{selectedDocIds.size} selected (max 10)</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Running ─────────────────────────────────────────── */}
          {step === 'running' && (
            <div className="space-y-6 py-8">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400 mx-auto mb-4" />
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                  Extracting pilot papers...
                </h3>
                <p className="text-xs text-gray-400">
                  {paperProgress.done} of {paperProgress.total || '?'} papers complete
                </p>
              </div>
              {paperProgress.total > 0 && (
                <div className="max-w-sm mx-auto">
                  <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-[#1a1a1a] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gray-900 dark:bg-white transition-all duration-500"
                      style={{ width: `${Math.round((paperProgress.done / paperProgress.total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Review — Evidence Table Style ───────────────────── */}
          {step === 'review' && docIds.length > 0 && (() => {
            // Build long-format joined table from pilot results
            const pilotResults = docIds.map(docId => ({
              id: docId,
              document_id: docId,
              extracted_data: (latestResults[docId] as Record<string, any>) || {},
            }));
            const docsMap = Object.fromEntries(
              docIds.map(id => [id, { id, filename: shortDocName(id), ref_id: docRefIds[id] }])
            );
            const { columns, rows } = transformToLongFormat(pilotResults, form.fields, docsMap);

            // Apply user column order (Paper stays pinned at index 0)
            const PAPER_COL = 'Paper';
            const colSet = new Set(columns);
            const userOrdered = columnOrder.filter(c => colSet.has(c) && c !== PAPER_COL);
            const remaining = columns.filter(c => c !== PAPER_COL && !userOrdered.includes(c));
            const dataCols = [...userOrdered, ...remaining];
            const orderedColumns = columns.includes(PAPER_COL) ? [PAPER_COL, ...dataCols] : dataCols;

            // Map each column to its owning form-field (parent for subfield columns)
            const columnToField: Record<string, FormField> = {};
            for (const f of form.fields) {
              if (f.field_type === 'array' && Array.isArray(f.subform_fields)) {
                for (const sf of f.subform_fields) columnToField[sf.field_name] = f;
              } else {
                columnToField[f.field_name] = f;
              }
            }
            // Every column owned by a form field carries its own thumbs. For a
            // table, the rating is scoped to that subfield (parent.col on the
            // backend); for a flat field it's scoped to the field itself.
            const subfieldForCol = (col: string): string | null => {
              const owner = columnToField[col];
              if (!owner) return null;
              return owner.field_type === 'array' && owner.field_name !== col ? col : null;
            };

            // Detect paper boundaries for visual grouping
            const paperBoundaries = new Set<number>();
            for (let i = 1; i < rows.length; i++) {
              if (rows[i]._documentId !== rows[i - 1]._documentId) paperBoundaries.add(i);
            }

            // Use original form field names for rating bar
            const ratingFields = form.fields.map(f => f.field_name);
            // A pipeline failure is not the paper being silent — keep it
            // visually distinct so calibration is judged on real answers.
            const isFailed = (val: string) => val === FAILED_LABEL;
            const isMissing = (val: string) =>
              !val || val === '—' || val === '' || EMPTY_DISPLAY_TOKENS.has(String(val).trim().toUpperCase());

            // Source evidence: every non-Paper cell carrying a source_text, in reading order (for prev/next)
            const chipOrder: Array<{ ri: number; col: string }> = [];
            rows.forEach((row, ri) => {
              orderedColumns.forEach((col, ci) => {
                if (ci === 0) return;
                if (getSourceText(row._rawCells?.[col])) chipOrder.push({ ri, col });
              });
            });
            const activeIndex = active ? chipOrder.findIndex(c => c.ri === active.ri && c.col === active.col) : -1;
            const hasPrev = activeIndex > 0;
            const hasNext = activeIndex >= 0 && activeIndex < chipOrder.length - 1;
            const goPrev = () => { if (hasPrev) setActive(chipOrder[activeIndex - 1]); };
            const goNext = () => { if (hasNext) setActive(chipOrder[activeIndex + 1]); };
            const activeRaw = active ? rows[active.ri]?._rawCells?.[active.col] : null;
            const activeSourceText = getSourceText(activeRaw);
            const _activeDocId = active ? (rows[active.ri]?._documentId ?? null) : null;
            const _activeDoc = _activeDocId ? documents.find((d: Document) => d.id === _activeDocId) : undefined;
            const activeData = (active && activeSourceText) ? {
              sourceText: activeSourceText,
              storedValue: rows[active.ri]?.[active.col] != null ? String(rows[active.ri][active.col]) : null,
              page: getPageRef(activeRaw),
              documentId: rows[active.ri]?._documentId ?? null,
              documentFilename: docsMap[rows[active.ri]?._documentId]?.filename ?? rows[active.ri]?._paperFilename ?? null,
              fieldLabel: formatFieldName(active.col),
              hasPdf: !!_activeDoc?.s3_pdf_path,
              sourceType: _activeDoc?.source_type ?? null,
              recordId: _activeDoc?.nct_id ?? _activeDoc?.pmid ?? null,
              doi: _activeDoc?.doi ?? null,
            } : null;

            return (
              <div className="space-y-3">
                {/* Stats bar */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span><span className="font-medium text-gray-700 dark:text-zinc-300">{rows.length}</span> rows</span>
                    <span className="text-gray-200 dark:text-zinc-700">&middot;</span>
                    <span><span className="font-medium text-gray-700 dark:text-zinc-300">{docIds.length}</span> papers</span>
                    {reviewedCount > 0 && (
                      <>
                        <span className="text-gray-200 dark:text-zinc-700">&middot;</span>
                        <span><span className="font-medium text-gray-700 dark:text-zinc-300">{reviewedCount}</span> rated</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-3 text-[10px] font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-green-200 dark:bg-green-700 inline-block" />Reported</span>
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-rose-200 dark:bg-rose-700 inline-block" />Not reported</span>
                      {showEvidence && <span className="flex items-center gap-1.5"><Quote className="w-2.5 h-2.5 text-green-500" />Has source</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setShowEvidence(v => !v); setActive(null); }}
                      className={cn(
                        'flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all',
                        showEvidence
                          ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400'
                          : 'bg-white dark:bg-[#111111] border-gray-200 dark:border-[#1f1f1f] text-gray-500 dark:text-zinc-400 hover:border-gray-300 dark:hover:border-[#2a2a2a]'
                      )}
                    >
                      <ScanText className="w-3.5 h-3.5" />
                      {showEvidence ? 'Hide sources' : 'Show sources'}
                    </button>
                  </div>
                </div>

                {/* Long-format evidence table */}
                <div className="overflow-auto rounded-xl border border-gray-200 dark:border-zinc-800/50 max-h-[calc(90vh-280px)]">
                  <table className="w-full text-xs border-separate border-spacing-0">
                    <thead>
                      <tr>
                        {orderedColumns.map((col, ci) => {
                          const isPaper = col === PAPER_COL;
                          const isDragOver = dragOverCol === col && !isPaper;
                          const owner = !isPaper ? columnToField[col] : null;
                          const hasThumbs = !!owner;
                          const subCol = !isPaper ? subfieldForCol(col) : null;
                          const fb = owner ? fieldFeedback[owner.field_name] : undefined;
                          const colRating = subCol
                            ? fb?.subfield_corrections?.[subCol]?.rating
                            : fb?.rating;
                          const isCorrect = colRating === 'correct';
                          const isIncorrect = colRating === 'incorrect';
                          const rate = (rating: 'correct' | 'incorrect') => {
                            if (!owner) return;
                            if (subCol) setSubfieldRating(owner.field_name, subCol, docIds[0], rating);
                            else setRating(owner.field_name, docIds[0], rating);
                          };
                          return (
                            <th
                              key={col}
                              draggable={!isPaper}
                              onDragStart={() => { if (!isPaper) draggedColRef.current = col; }}
                              onDragOver={(e) => {
                                if (isPaper) return;
                                e.preventDefault();
                                if (dragOverCol !== col) setDragOverCol(col);
                              }}
                              onDragLeave={() => { if (dragOverCol === col) setDragOverCol(null); }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const dragged = draggedColRef.current;
                                draggedColRef.current = null;
                                setDragOverCol(null);
                                if (dragged) moveColumn(dataCols, dragged, col);
                              }}
                              onDragEnd={() => { draggedColRef.current = null; setDragOverCol(null); }}
                              className={cn(
                                'sticky top-0 z-20 bg-gray-50 dark:bg-[#0d0d0d] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 border-b-2 border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 whitespace-nowrap select-none',
                                ci === 0 && 'sticky left-0 z-40 min-w-[140px]',
                                ci > 0 && 'min-w-[110px]',
                                !isPaper && 'cursor-grab active:cursor-grabbing hover:text-gray-600 dark:hover:text-zinc-300',
                                isDragOver && 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400',
                                isCorrect && 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400',
                                isIncorrect && 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                              )}
                              title={isPaper ? undefined : 'Drag to reorder'}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span>{col === 'Paper' ? 'Paper' : col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                                {hasThumbs && owner && (
                                  <span
                                    className="flex items-center gap-0.5"
                                    draggable={false}
                                    onDragStart={(e) => e.preventDefault()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      draggable={false}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        rate('correct');
                                      }}
                                      className={cn(
                                        'p-0.5 rounded transition-colors',
                                        isCorrect ? 'text-green-600 dark:text-green-400' : 'text-gray-300 dark:text-zinc-600 hover:text-green-500'
                                      )}
                                      title="Looks correct"
                                    >
                                      <ThumbsUp className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      draggable={false}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        rate('incorrect');
                                        openFieldEditor(owner.field_name, subCol);
                                      }}
                                      className={cn(
                                        'p-0.5 rounded transition-colors',
                                        isIncorrect ? 'text-red-600 dark:text-red-400' : 'text-gray-300 dark:text-zinc-600 hover:text-red-500'
                                      )}
                                      title={subCol ? 'Edit this column' : 'Edit this field'}
                                    >
                                      <ThumbsDown className="w-3 h-3" />
                                    </button>
                                  </span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, ri) => {
                        const isNewPaper = paperBoundaries.has(ri);
                        // For visual grouping: only show Paper + flat fields on first row of each paper
                        const isFirstRowOfPaper = ri === 0 || isNewPaper;
                        return (
                          <tr key={`${row._resultId}-${ri}`}>
                            {orderedColumns.map((col, ci) => {
                              const val = row[col] ?? '';
                              const failed = isFailed(val);
                              const missing = !failed && isMissing(val);
                              const isFirstCol = ci === 0;
                              // For flat fields (non-Paper), blank out duplicate rows in same paper group
                              const isFlatField = form.fields.some(f => f.field_type !== 'array' && f.field_name === col);
                              const showBlank = !isFirstCol && isFlatField && !isFirstRowOfPaper;
                              const cellSource = showEvidence && !isFirstCol && !showBlank ? getSourceText(row._rawCells?.[col]) : null;

                              return (
                                <td
                                  key={col}
                                  className={cn(
                                    'px-3 py-2 border-b border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 align-top',
                                    isFirstCol && 'sticky left-0 z-10 bg-white dark:bg-[#111111] font-medium text-gray-700 dark:text-zinc-300',
                                    !isFirstCol && !showBlank && (failed
                                      ? 'bg-amber-50 dark:bg-[#1a150d]'
                                      : missing ? 'bg-rose-50 dark:bg-[#1a0d0d]' : 'bg-green-50 dark:bg-[#0d1a10]'),
                                    !isFirstCol && showBlank && 'bg-white dark:bg-[#111111]',
                                    isNewPaper && 'border-t-2 border-t-gray-400 dark:border-t-zinc-600'
                                  )}
                                >
                                  {showBlank ? null : failed && !isFirstCol ? (
                                    <span
                                      className="text-amber-600 dark:text-amber-500"
                                      title="Extraction failed for this cell — not a statement about the paper"
                                    >{val}</span>
                                  ) : missing && !isFirstCol ? (
                                    <span className="text-gray-300 dark:text-zinc-700">{val || 'NR'}</span>
                                  ) : cellSource ? (
                                    <div className="flex items-start gap-1.5">
                                      <span className="text-gray-800 dark:text-zinc-200">{val}</span>
                                      <button type="button" onClick={() => setActive({ ri, col })} title="View source passage"
                                        className={cn(
                                          'flex-none inline-flex items-center justify-center p-0.5 rounded transition-all',
                                          active && active.ri === ri && active.col === col
                                            ? 'bg-green-500 text-white dark:bg-green-400 dark:text-[#0a0a0a]'
                                            : 'text-green-500 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30'
                                        )}>
                                        <Quote className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className={cn(isFirstCol ? "text-gray-700 dark:text-zinc-300" : "text-gray-800 dark:text-zinc-200")}>
                                      {val}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Inline field editor — opens when 👎 clicked on a column header */}
                {editingFieldName && editingCal && (() => {
                  const field = form.fields.find(f => f.field_name === editingFieldName);
                  if (!field) return null;
                  const mergedField: UEFEditableField = { ...field, ...editingFieldPatch } as UEFEditableField;
                  return (
                    <div className="mt-4 rounded-2xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#0d0d0d] overflow-hidden shadow-sm">
                      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-[#1a1a1a]">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span className="flex items-center justify-center w-6 h-6 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40 shrink-0">
                            <ThumbsDown className="w-3 h-3 text-red-500 dark:text-red-400" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-gray-900 dark:text-white tracking-tight truncate">
                                {formatFieldName(field.field_name)}
                              </p>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-[#1f1f1f] text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] font-mono">
                                {field.field_name}
                              </span>
                              {focusSubfield && (
                                <>
                                  <span className="text-gray-300 dark:text-zinc-600">/</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200/60 dark:border-red-800/40 font-mono">
                                    {focusSubfield.name}
                                  </span>
                                </>
                              )}
                              {editorLoading && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">
                              {focusSubfield
                                ? 'Refine this column — description, hints, rules, examples. Applies to all papers.'
                                : 'Refine description, hints, rules, examples — applies to all papers.'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button size="sm" variant="ghost" onClick={closeFieldEditor} disabled={savingFieldEdit}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={saveFieldEdit} disabled={savingFieldEdit}>
                            {savingFieldEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Save changes
                          </Button>
                        </div>
                      </div>
                      <div className="max-h-[60vh] overflow-y-auto">
                        <FieldEditorPane
                          field={mergedField}
                          cal={editingCal}
                          editable={true}
                          structuralEditable={false}
                          focusSubfield={focusSubfield}
                          onFieldPatch={(patch) => setEditingFieldPatch((prev) => ({ ...prev, ...patch }))}
                          onCalPatch={(patch) => setEditingCal((prev) => (prev ? { ...prev, ...patch } : prev))}
                        />
                      </div>
                    </div>
                  );
                })()}

                <SourceEvidenceDrawer
                  open={!!active && !!activeData}
                  onClose={() => setActive(null)}
                  documentId={activeData?.documentId ?? null}
                  documentFilename={activeData?.documentFilename ?? null}
                  sourceText={activeData?.sourceText ?? null}
                  storedValue={activeData?.storedValue ?? null}
                  fieldLabel={activeData?.fieldLabel}
                  page={activeData?.page ?? null}
                  hasPdf={activeData?.hasPdf ?? true}
                  sourceType={activeData?.sourceType ?? null}
                  recordId={activeData?.recordId ?? null}
                  doi={activeData?.doi ?? null}
                  onPrev={goPrev}
                  onNext={goNext}
                  hasPrev={hasPrev}
                  hasNext={hasNext}
                />
              </div>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
          {step === 'select' && (
            <>
              <p className="text-xs text-gray-400">
                {completedDocs.length} documents available
              </p>
              <button
                onClick={handleStartPilot}
                disabled={submitting || (selectionMode === 'manual' && selectedDocIds.size === 0)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors",
                  "bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100",
                  "disabled:opacity-40 disabled:cursor-not-allowed"
                )}
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Start Pilot
              </button>
            </>
          )}

          {step === 'running' && (
            <p className="text-xs text-gray-400 mx-auto">Extraction in progress...</p>
          )}

          {step === 'review' && (
            <>
              <p className="text-xs text-gray-400">
                {reviewedCount > 0 ? `${reviewedCount} rated` : 'Click thumbs up/down on any column to rate it'}
              </p>
              <div className="flex items-center gap-2">
                {reviewedCount > 0 && (
                  <button
                    onClick={handleSubmitFeedback}
                    disabled={submitting}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors border",
                      "border-gray-200 dark:border-[#2a2a2a] text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]",
                      "disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    Submit & Re-run
                  </button>
                )}
                <button
                  onClick={handleFinalize}
                  disabled={submitting}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors",
                    "bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100",
                    "disabled:opacity-40 disabled:cursor-not-allowed"
                  )}
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Looks Good -- Finalize
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

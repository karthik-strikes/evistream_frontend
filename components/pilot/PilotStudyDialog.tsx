'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Search, Loader2, ThumbsUp, ThumbsDown, Check, RotateCcw } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import { useProject } from '@/contexts/ProjectContext';
import { formsService, documentsService } from '@/services';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Form, Document, PilotState, PilotFieldFeedback } from '@/types/api';

type Step = 'select' | 'running' | 'review';

// Metadata keys that wrap every extracted field — must be filtered out
const METADATA_KEYS = new Set(['source_text', 'source_location', 'confidence', 'reasoning']);

function unwrapValue(v: any): any {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) return v.value;
  return v;
}

function extractDisplayValue(fieldData: any): string {
  const value = unwrapValue(fieldData);
  if (value === null || value === undefined) return '---';
  if (typeof value === 'string') return value.trim() || '---';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '---';
    if (value.every((v: any) => typeof v === 'string' || typeof v === 'number')) return value.join(', ');
    return `${value.length} items`;
  }
  const j = JSON.stringify(value);
  return j.length > 80 ? j.slice(0, 80) + '...' : j;
}

function getSourceText(fieldData: any): string | null {
  if (fieldData && typeof fieldData === 'object' && !Array.isArray(fieldData)) {
    return fieldData.source_text || null;
  }
  return null;
}

function getSourceLocation(fieldData: any): any {
  if (fieldData && typeof fieldData === 'object' && !Array.isArray(fieldData)) {
    return fieldData.source_location || null;
  }
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
    const ws = new WebSocket(`${wsBase}/api/v1/ws/jobs/${activeJobId}`);
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
      const resp = await formsService.startPilot(form.id, docIds, count);
      setActiveJobId(resp.job_id);
      setPaperProgress({ done: 0, total: effectiveCount });
      setStep('running');
      toast({ title: 'Pilot started', description: `Extracting ${effectiveCount} papers`, variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to start pilot', variant: 'error' });
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
      toast({ title: 'Error', description: err?.message || 'Failed to submit feedback', variant: 'error' });
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
      toast({ title: 'Error', description: err?.message || 'Failed to finalize', variant: 'error' });
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
      toast({ title: 'Error', description: err?.message || 'Failed to reset', variant: 'error' });
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

  const setCorrectionField = (fieldName: string, key: keyof PilotFieldFeedback, value: string) => {
    setFieldFeedback(prev => ({
      ...prev,
      [fieldName]: { ...prev[fieldName], [key]: value },
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

  const reviewedCount = Object.keys(fieldFeedback).length;
  const totalFieldCount = fieldNames.length;

  // Cell status helper
  const cellStatus = (fieldData: any): 'reported' | 'missing' => {
    const display = extractDisplayValue(fieldData);
    return (!display || display === '---' || display === 'NR') ? 'missing' : 'reported';
  };

  const cellBg = (status: 'reported' | 'missing') =>
    status === 'reported' ? 'bg-green-50 dark:bg-[#0d1a10]' : 'bg-rose-50 dark:bg-[#1a0d0d]';

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className={cn(
          "bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] flex flex-col shadow-2xl",
          step === 'review' ? "w-full max-w-[95vw] max-h-[90vh]" : "w-full max-w-4xl max-h-[90vh]"
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0 border-b border-gray-100 dark:border-[#1f1f1f]">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
              Pilot
            </h2>
            <span className="text-sm text-gray-400 dark:text-zinc-500">{form.form_name}</span>
            {pilotState?.current_iteration && pilotState.current_iteration > 0 && (
              <Badge variant="secondary">Iteration {pilotState.current_iteration}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
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
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0">
              <X className="h-4 w-4" />
            </Button>
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

          {/* ── STEP 3: Review — Table Grid ─────────────────────────────── */}
          {step === 'review' && docIds.length > 0 && (
            <div className="space-y-3">
              {/* Stats bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span><span className="font-medium text-gray-700 dark:text-zinc-300">{totalFieldCount}</span> fields</span>
                  <span className="text-gray-200 dark:text-zinc-700">&middot;</span>
                  <span><span className="font-medium text-gray-700 dark:text-zinc-300">{docIds.length}</span> papers</span>
                  {reviewedCount > 0 && (
                    <>
                      <span className="text-gray-200 dark:text-zinc-700">&middot;</span>
                      <span><span className="font-medium text-gray-700 dark:text-zinc-300">{reviewedCount}</span> rated</span>
                    </>
                  )}
                  {pilotState?.field_examples && Object.keys(pilotState.field_examples).length > 0 && (
                    <>
                      <span className="text-gray-200 dark:text-zinc-700">&middot;</span>
                      <span className="text-green-600 dark:text-green-400">
                        {Object.values(pilotState.field_examples).reduce((s, arr) => s + arr.length, 0)} examples
                      </span>
                    </>
                  )}
                </div>
                {/* Legend */}
                <div className="flex items-center gap-3 text-[10px] font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-green-200 dark:bg-green-700 inline-block" />Reported</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-rose-200 dark:bg-rose-700 inline-block" />Not reported</span>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-auto rounded-xl border border-gray-200 dark:border-zinc-800/50 max-h-[calc(90vh-220px)]">
                <table className="w-full text-xs border-separate border-spacing-0">
                  <thead>
                    <tr>
                      {/* Sticky field name header */}
                      <th className="sticky top-0 left-0 z-30 bg-gray-50 dark:bg-[#0d0d0d] px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-zinc-500 border-b-2 border-r border-gray-200 dark:border-zinc-800/60 min-w-[180px]">
                        Field
                      </th>
                      {/* Rating header */}
                      <th className="sticky top-0 z-20 bg-gray-50 dark:bg-[#0d0d0d] px-2 py-3 text-center text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-zinc-500 border-b-2 border-r border-gray-200 dark:border-zinc-800/60 w-[70px]">
                        Rate
                      </th>
                      {/* Document columns */}
                      {docIds.map(docId => (
                        <th key={docId} className="sticky top-0 z-20 bg-gray-50 dark:bg-[#0d0d0d] px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 border-b-2 border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 min-w-[180px] max-w-[240px]">
                          <span className="truncate block">{shortDocName(docId)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fieldNames.map(fieldName => {
                      const fb = fieldFeedback[fieldName];
                      const isCorrect = fb?.rating === 'correct';
                      const isIncorrect = fb?.rating === 'incorrect';
                      const isExpanded = expandedCell === fieldName;

                      return (
                        <React.Fragment key={fieldName}>
                          <tr className={cn("group", isExpanded && "bg-gray-50/50 dark:bg-[#0d0d0d]/50")}>
                            {/* Field name — sticky left */}
                            <td
                              className={cn(
                                "sticky left-0 z-10 px-4 py-2.5 border-r border-gray-200 dark:border-zinc-800/60 align-top cursor-pointer",
                                isExpanded ? "border-b-0 bg-gray-50 dark:bg-[#0d0d0d]" : "border-b bg-white dark:bg-[#111111]",
                                isCorrect && "bg-green-50/50 dark:bg-green-900/10",
                                isIncorrect && "bg-red-50/50 dark:bg-red-900/10",
                              )}
                              onClick={() => setExpandedCell(isExpanded ? null : fieldName)}
                            >
                              <span className="text-xs font-medium text-gray-700 dark:text-zinc-300">
                                {formatFieldName(fieldName)}
                              </span>
                              {isCorrect && <span className="ml-1.5 text-[9px] text-green-500">OK</span>}
                              {isIncorrect && <span className="ml-1.5 text-[9px] text-red-500">FIX</span>}
                            </td>

                            {/* Rating buttons */}
                            <td className={cn(
                              "px-1 py-2.5 border-r border-gray-200 dark:border-zinc-800/60 align-top",
                              isExpanded ? "border-b-0 bg-gray-50 dark:bg-[#0d0d0d]" : "border-b bg-white dark:bg-[#111111]",
                            )}>
                              <div className="flex items-center justify-center gap-0.5">
                                <button
                                  onClick={() => setRating(fieldName, docIds[0], 'correct')}
                                  className={cn(
                                    "p-1.5 rounded transition-all",
                                    isCorrect
                                      ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                                      : "text-gray-300 hover:text-green-500 hover:bg-green-50 dark:text-zinc-600 dark:hover:text-green-400"
                                  )}
                                  title="Looks correct"
                                >
                                  <ThumbsUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => { setRating(fieldName, docIds[0], 'incorrect'); setExpandedCell(fieldName); }}
                                  className={cn(
                                    "p-1.5 rounded transition-all",
                                    isIncorrect
                                      ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                                      : "text-gray-300 hover:text-red-500 hover:bg-red-50 dark:text-zinc-600 dark:hover:text-red-400"
                                  )}
                                  title="Needs correction"
                                >
                                  <ThumbsDown className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>

                            {/* Document cells */}
                            {docIds.map(docId => {
                              const docData = latestResults[docId] as Record<string, any> | undefined;
                              const fieldData = docData?.[fieldName];
                              const status = cellStatus(fieldData);
                              const display = extractDisplayValue(fieldData);
                              const srcText = getSourceText(fieldData);
                              const srcLoc = getSourceLocation(fieldData);

                              return (
                                <td
                                  key={docId}
                                  className={cn(
                                    "px-3 py-2.5 border-r border-gray-200 dark:border-zinc-800/60 last:border-r-0 align-top min-w-[180px] max-w-[240px] transition-colors",
                                    isExpanded ? "border-b-0" : "border-b",
                                    cellBg(status),
                                    "cursor-pointer hover:brightness-95 dark:hover:brightness-110"
                                  )}
                                  onClick={() => setExpandedCell(isExpanded ? null : fieldName)}
                                >
                                  <div className="flex items-start gap-1">
                                    <span className={cn(
                                      "leading-relaxed line-clamp-2",
                                      status === 'missing' ? "text-gray-400 dark:text-zinc-600 italic" : "text-gray-900 dark:text-white"
                                    )}>
                                      {display}
                                    </span>
                                    {srcLoc?.page && (
                                      <span className="text-[9px] text-gray-400 dark:text-zinc-600 shrink-0 mt-0.5">
                                        p.{srcLoc.page}
                                      </span>
                                    )}
                                  </div>
                                  {srcLoc?.section && (
                                    <span className="text-[9px] text-gray-400 dark:text-zinc-600 block mt-0.5">
                                      {srcLoc.section}
                                    </span>
                                  )}
                                  {/* Source text preview on expand */}
                                  {isExpanded && srcText && srcText !== 'NR' && (
                                    <p className="mt-1.5 pl-2 border-l-2 border-green-300 dark:border-green-700 text-[10px] text-gray-400 dark:text-zinc-500 italic leading-relaxed line-clamp-3">
                                      {srcText}
                                    </p>
                                  )}
                                </td>
                              );
                            })}
                          </tr>

                          {/* Correction form — ALWAYS visible when thumbs down is active */}
                          {isIncorrect && (
                            <tr>
                              <td colSpan={2 + docIds.length} className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800/60 bg-red-50 dark:bg-red-900/10 border-l-4 border-l-red-400">
                                <div className="flex items-center gap-2 mb-2">
                                  <ThumbsDown className="w-3 h-3 text-red-500" />
                                  <p className="text-[11px] font-semibold text-red-700 dark:text-red-400">
                                    {formatFieldName(fieldName)} -- provide the correct answer:
                                  </p>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                  <div>
                                    <label className="text-[10px] font-medium text-gray-500 dark:text-zinc-400">Correct value</label>
                                    <input
                                      type="text"
                                      value={fb?.correct_value || ''}
                                      onChange={e => setCorrectionField(fieldName, 'correct_value', e.target.value)}
                                      placeholder="What should the value be?"
                                      autoFocus={expandedCell === fieldName}
                                      className="mt-0.5 w-full text-xs px-2.5 py-2 rounded-md border border-red-200 dark:border-red-800/30 bg-white dark:bg-[#111111] text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-medium text-gray-500 dark:text-zinc-400">Source text from paper</label>
                                    <input
                                      type="text"
                                      value={fb?.correct_source_text || ''}
                                      onChange={e => setCorrectionField(fieldName, 'correct_source_text', e.target.value)}
                                      placeholder="Copy the relevant sentence from the paper"
                                      className="mt-0.5 w-full text-xs px-2.5 py-2 rounded-md border border-red-200 dark:border-red-800/30 bg-white dark:bg-[#111111] text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-medium text-gray-500 dark:text-zinc-400">Instruction for AI (optional)</label>
                                    <input
                                      type="text"
                                      value={fb?.note || ''}
                                      onChange={e => setCorrectionField(fieldName, 'note', e.target.value)}
                                      placeholder="e.g., Look in the acknowledgements section"
                                      className="mt-0.5 w-full text-xs px-2.5 py-2 rounded-md border border-red-200 dark:border-red-800/30 bg-white dark:bg-[#111111] text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
                                    />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
                {reviewedCount > 0 ? `${reviewedCount} fields rated` : 'Click thumbs up/down to rate fields'}
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

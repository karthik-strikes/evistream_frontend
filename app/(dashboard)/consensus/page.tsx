'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { formsService, documentsService, resultsService, adjudicationService } from '@/services';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ConsensusSummary, ConsensusSummaryDoc } from '@/types/api';
import {
  ArrowLeft, ArrowRight, FileText, GripVertical, Loader2, Search,
  CheckCircle2, Clock, AlertTriangle, Download, ChevronDown, ChevronUp, Info,
} from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Tooltip } from '@/components/ui/tooltip';
import { RingChart } from './_components/RingChart';
import { UnifiedFieldCard } from './_components/UnifiedFieldCard';

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'needs_review' | 'disputed' | 'done';
type Screen = 'dashboard' | 'review' | 'summary';

interface FieldDecision {
  fieldName: string;
  sources: { ai?: string | null; r1?: string | null; r2?: string | null };
  agreed: boolean;
  suggestion?: { value: string; source: string; reason: string };
  decision: string | null;
  customValue: string;
  legacyCorrection: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function agreementBadge(pct: number | null) {
  if (pct === null) return null;
  if (pct >= 80) return { label: `${pct}%`, cls: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800/40' };
  if (pct >= 50) return { label: `${pct}%`, cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40' };
  return { label: `${pct}%`, cls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40' };
}

function normalizeValue(raw: any): string {
  if (raw == null) return '';
  if (typeof raw === 'object') return String(raw?.final_value ?? raw?.value ?? JSON.stringify(raw));
  return String(raw);
}

function valuesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Treat has_manual as equivalent to has_r1 for unified view */
function docHasR1(doc: ConsensusSummaryDoc): boolean {
  return doc.has_r1 || doc.has_manual;
}

/** Compute the "smart" status for a document row */
function docStatus(doc: ConsensusSummaryDoc): { label: string; type: 'done' | 'conflicts' | 'ai_only' | 'agree' | 'pending' | 'none' } {
  if (doc.has_consensus || doc.has_adjudication) return { label: 'Done', type: 'done' };
  const hasR1 = docHasR1(doc);
  const sourceCount = [doc.has_ai, hasR1, doc.has_r2].filter(Boolean).length;
  if (sourceCount === 0) return { label: 'No data', type: 'none' };
  if (sourceCount === 1 && doc.has_ai) return { label: 'AI only', type: 'ai_only' };
  if (doc.disputed_fields != null && doc.disputed_fields > 0) return { label: `${doc.disputed_fields} conflicts`, type: 'conflicts' };
  // Compute agreement across all available sources
  const pct = doc.r1_r2_agreement_pct ?? doc.agreement_pct;
  if (pct === 100) return { label: 'All agree', type: 'agree' };
  if (sourceCount > 1 && pct !== null && pct < 100) return { label: 'Needs review', type: 'pending' };
  if (sourceCount > 1) return { label: 'Needs review', type: 'pending' };
  return { label: 'Pending', type: 'pending' };
}

function sortDocs(docs: ConsensusSummaryDoc[]): ConsensusSummaryDoc[] {
  const rank = (d: ConsensusSummaryDoc) => {
    const s = docStatus(d);
    if (s.type === 'none') return 4;
    if (s.type === 'done') return 3;
    if (s.type === 'conflicts') return 0;
    if (s.type === 'ai_only' || s.type === 'pending') return 1;
    return 2;
  };
  return [...docs].sort((a, b) => {
    const rd = rank(a) - rank(b);
    if (rd !== 0) return rd;
    const pa = a.r1_r2_agreement_pct ?? a.agreement_pct;
    const pb = b.r1_r2_agreement_pct ?? b.agreement_pct;
    if (pa !== null && pb !== null) return pa - pb;
    return 0;
  });
}

function filterDocs(docs: ConsensusSummaryDoc[], tab: FilterTab): ConsensusSummaryDoc[] {
  switch (tab) {
    case 'needs_review': return docs.filter(d => {
      const s = docStatus(d);
      return s.type !== 'done' && s.type !== 'none';
    });
    case 'disputed': return docs.filter(d => docStatus(d).type === 'conflicts');
    case 'done': return docs.filter(d => docStatus(d).type === 'done');
    default: return docs;
  }
}

function tabCount(docs: ConsensusSummaryDoc[], tab: FilterTab): number {
  return filterDocs(docs, tab).length;
}

/** Compute majority suggestion when 2+ sources agree */
function computeSuggestion(sources: { ai?: string | null; r1?: string | null; r2?: string | null }): { value: string; source: string; reason: string } | undefined {
  const entries: { key: string; val: string }[] = [];
  if (sources.ai != null && sources.ai !== '') entries.push({ key: 'AI', val: sources.ai });
  if (sources.r1 != null && sources.r1 !== '') entries.push({ key: 'R1', val: sources.r1 });
  if (sources.r2 != null && sources.r2 !== '') entries.push({ key: 'R2', val: sources.r2 });

  if (entries.length < 2) return undefined;

  // Check each pair
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (valuesMatch(entries[i].val, entries[j].val)) {
        const matchingKeys = [entries[i].key, entries[j].key];
        // Check if a third also matches
        for (let k = 0; k < entries.length; k++) {
          if (k !== i && k !== j && valuesMatch(entries[k].val, entries[i].val)) {
            matchingKeys.push(entries[k].key);
          }
        }
        return {
          value: entries[i].val,
          source: matchingKeys.join(' + '),
          reason: `${matchingKeys.join(' + ')} agree (${matchingKeys.length}/${entries.length})`,
        };
      }
    }
  }
  return undefined;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConsensusPro() {
  const { selectedProject } = useProject();
  const { toast } = useToast();

  const [screen, setScreen] = useState<Screen>('dashboard');
  const [forms, setForms] = useState<any[]>([]);
  const [selectedForm, setSelectedForm] = useState<any>(null);
  const [formPickerOpen, setFormPickerOpen] = useState(false);
  const [loadingForms, setLoadingForms] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summary, setSummary] = useState<ConsensusSummary | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Review state
  const [reviewDoc, setReviewDoc] = useState<ConsensusSummaryDoc | null>(null);
  const [fields, setFields] = useState<FieldDecision[]>([]);
  const [activeField, setActiveField] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingDocId, setLoadingDocId] = useState<string | null>(null);
  const [agreedCollapsed, setAgreedCollapsed] = useState(true);
  const [pdfUrl, setPdfUrl] = useState('');

  // Track what sources are present for this doc
  const [hasR1R2, setHasR1R2] = useState(false);
  const [isAiOnly, setIsAiOnly] = useState(false);

  // Summary screen state (after submit)
  const [lastReviewDoc, setLastReviewDoc] = useState<ConsensusSummaryDoc | null>(null);
  const [lastFields, setLastFields] = useState<FieldDecision[]>([]);

  // Export state
  const [exporting, setExporting] = useState(false);

  const reviewSeqRef = useRef(0);

  const fetchForms = useCallback(async () => {
    if (!selectedProject) return;
    setLoadingForms(true);
    try {
      const data = await formsService.getAll(selectedProject.id);
      setForms(data.filter((f: any) => f.status === 'active'));
    } catch { /* ignore */ } finally {
      setLoadingForms(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    if (selectedProject) fetchForms();
  }, [selectedProject, fetchForms]);

  useEffect(() => {
    return () => { if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  const handleFormSelect = async (form: any) => {
    if (selectedForm?.id === form.id) { setFormPickerOpen(false); return; }
    setSelectedForm(form);
    setFormPickerOpen(false);
    setSummary(null);
    setFilterTab('all');
    setLoadingSummary(true);
    try {
      const data = await resultsService.getConsensusSummary(selectedProject!.id, form.id);
      setSummary(data);
    } catch {
      toast({ title: 'Failed to load consensus summary', variant: 'error' });
    } finally {
      setLoadingSummary(false);
    }
  };

  // ── Open Review ─────────────────────────────────────────────────────────────
  const openReview = async (doc: ConsensusSummaryDoc) => {
    setLoadingDocId(doc.document_id);
    const seq = ++reviewSeqRef.current;
    const isCurrent = () => seq === reviewSeqRef.current;

    try {
      // Get PDF
      let blobUrl = '';
      try {
        const presignedUrl = await documentsService.getDownloadUrl(doc.document_id);
        if (!isCurrent()) return;
        const resp = await fetch(presignedUrl);
        if (resp.ok && isCurrent()) {
          const blob = await resp.blob();
          if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
          blobUrl = URL.createObjectURL(blob);
          setPdfUrl(blobUrl);
        }
      } catch { /* PDF unavailable */ }

      if (!isCurrent()) return;

      // Check for existing consensus/adjudication
      let existingConsensus: any = null;
      let existingAdj: any = null;
      if (doc.has_consensus) {
        try { existingConsensus = await resultsService.getConsensus(doc.document_id, selectedForm.id); } catch {}
      }
      if (doc.has_adjudication) {
        try { existingAdj = await adjudicationService.get(doc.document_id, selectedProject!.id, selectedForm.id); } catch {}
      }

      if (!isCurrent()) return;

      // Fetch ALL extraction results
      const allResults = await resultsService.getAll({
        projectId: selectedProject!.id,
        formId: selectedForm.id,
        documentId: doc.document_id,
      });

      if (!isCurrent()) return;

      const aiResult = allResults.find((r: any) => r.extraction_type === 'ai');
      const r1Result = allResults.find((r: any) => r.reviewer_role === 'reviewer_1');
      const r2Result = allResults.find((r: any) => r.reviewer_role === 'reviewer_2');
      // Fallback: manual extraction (not R1/R2-assigned) treated as R1
      const manualResult = allResults.find((r: any) => r.extraction_type === 'manual' && !r.reviewer_role);

      const hasR1 = !!(r1Result || manualResult);
      const hasR2 = !!r2Result;
      setHasR1R2(hasR1 && hasR2);
      setIsAiOnly(!!aiResult && !hasR1 && !hasR2);

      // Normalize AI data (strip .value suffix)
      const rawAiData: Record<string, any> = aiResult?.extracted_data ?? {};
      const aiData: Record<string, any> = {};
      for (const [key, val] of Object.entries(rawAiData)) {
        if (key.endsWith('.value')) aiData[key.slice(0, -6)] = val;
        else if (!(key + '.value' in rawAiData)) aiData[key] = val;
      }
      const normalizedAiData = Object.keys(aiData).length > 0 ? aiData : rawAiData;

      const r1Data: Record<string, any> = (r1Result ?? manualResult)?.extracted_data ?? {};
      const r2Data: Record<string, any> = r2Result?.extracted_data ?? {};

      // Collect all field names
      const allFieldNames = new Set([
        ...Object.keys(normalizedAiData),
        ...Object.keys(r1Data),
        ...Object.keys(r2Data),
      ]);

      // Merge existing decisions from consensus + adjudication
      const existingDecisions = existingConsensus?.field_decisions ?? {};
      const existingResolutions = existingAdj?.field_resolutions ?? {};

      // Build unified field list
      const built: FieldDecision[] = [];
      for (const fn of Array.from(allFieldNames).sort()) {
        const aiVal = normalizedAiData[fn] != null ? normalizeValue(normalizedAiData[fn]) : undefined;
        const r1Val = r1Data[fn] != null ? normalizeValue(r1Data[fn]) : undefined;
        const r2Val = r2Data[fn] != null ? normalizeValue(r2Data[fn]) : undefined;

        const sources: FieldDecision['sources'] = {};
        if (aiVal !== undefined) sources.ai = aiVal || null;
        if (r1Val !== undefined) sources.r1 = r1Val || null;
        if (r2Val !== undefined) sources.r2 = r2Val || null;

        // Determine agreement: all non-null sources must match
        const vals = [aiVal, r1Val, r2Val].filter((v): v is string => v != null && v !== '');
        const allAgree = vals.length > 1 && vals.every(v => valuesMatch(v, vals[0]));
        const singleSource = vals.length <= 1;
        const agreed = allAgree;

        // Compute suggestion for multi-source disagreements
        const suggestion = (!agreed && !singleSource) ? computeSuggestion(sources) : undefined;

        // Restore existing decision
        let decision: string | null = agreed ? 'agreed' : null;
        let customValue = '';
        let legacyCorrection = '';

        // From consensus_results (AI-only or AI+manual modes)
        if (existingDecisions[fn]) {
          const ed = existingDecisions[fn];
          if (ed.status === 'correct') decision = 'correct';
          else if (ed.status === 'incorrect') { decision = 'incorrect'; legacyCorrection = ed.correction ?? ''; }
          else if (ed.decision) {
            decision = ed.decision;
            if (ed.decision === 'custom') customValue = ed.final_value ?? '';
          }
        }
        // From adjudication_results (R1 vs R2)
        if (existingResolutions[fn]) {
          const res = existingResolutions[fn];
          if (res.agreed) decision = 'agreed';
          else if (res.resolution_source === 'reviewer_1') decision = 'accept_r1';
          else if (res.resolution_source === 'reviewer_2') decision = 'accept_r2';
          else if (res.resolution_source === 'custom') { decision = 'custom'; customValue = res.final_value ?? ''; }
        }

        built.push({ fieldName: fn, sources, agreed, suggestion, decision, customValue, legacyCorrection });
      }

      setFields(built);
      setActiveField(null);
      setAgreedCollapsed(true);
      setReviewDoc(doc);
      setScreen('review');
    } catch {
      toast({ title: 'Failed to load document review', variant: 'error' });
    } finally {
      if (isCurrent()) setLoadingDocId(null);
    }
  };

  // ── Field update helpers ──────────────────────────────────────────────────────
  const updateFieldDecision = (idx: number, decision: string) => {
    setFields(prev => prev.map((f, i) => {
      if (i !== idx) return f;
      // For AI-only correct, auto-advance to next
      if (decision === 'correct' || decision === 'incorrect') {
        return { ...f, decision, legacyCorrection: decision === 'correct' ? '' : f.legacyCorrection };
      }
      // For accept_suggestion, map to the underlying source
      if (decision === 'accept_suggestion' && f.suggestion) {
        // Keep as accept_suggestion so we can track it in summary
        return { ...f, decision: 'accept_suggestion' };
      }
      return { ...f, decision };
    }));
    // Auto-advance for AI-only correct
    if (decision === 'correct') {
      const next = fields.findIndex((f, i) => i > idx && f.decision === null);
      setActiveField(next >= 0 ? next : idx);
    } else if (decision === 'incorrect') {
      setActiveField(idx);
    }
  };

  const updateCustomValue = (idx: number, val: string) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, customValue: val } : f));
  };

  const updateCorrection = (idx: number, val: string) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, legacyCorrection: val } : f));
  };

  // ── Submit validation ──────────────────────────────────────────────────────────
  const canSubmit = () => {
    if (fields.length === 0) return false;
    return fields.every(f => {
      if (f.agreed) return true; // auto-accepted
      if (f.decision === null) return false;
      if (f.decision === 'custom') return f.customValue.trim() !== '';
      return true;
    });
  };

  // ── Submit ──────────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canSubmit() || !reviewDoc || !selectedForm) return;
    setSubmitting(true);
    try {
      let agreedCount = 0;
      let disputedCount = 0;

      // If R1/R2 data is involved, save adjudication
      if (hasR1R2) {
        const fieldResolutions: Record<string, any> = {};
        for (const f of fields) {
          const finalVal = resolveFieldValue(f);
          fieldResolutions[f.fieldName] = {
            reviewer_1_value: f.sources.r1 ?? '',
            reviewer_2_value: f.sources.r2 ?? '',
            agreed: f.agreed || f.decision === 'agreed',
            final_value: finalVal,
            resolution_source: f.agreed || f.decision === 'agreed' ? 'agreed'
              : f.decision === 'accept_r1' ? 'reviewer_1'
              : f.decision === 'accept_r2' ? 'reviewer_2'
              : f.decision === 'accept_ai' ? 'ai'
              : f.decision === 'accept_suggestion' ? 'suggestion'
              : 'custom',
          };
          if (f.agreed || f.decision === 'agreed') agreedCount++;
          else disputedCount++;
        }

        await adjudicationService.resolve({
          project_id: selectedProject!.id,
          form_id: selectedForm.id,
          document_id: reviewDoc.document_id,
          field_resolutions: fieldResolutions,
          status: 'completed',
        });
      }

      // Always save consensus record
      const fieldDecisions: Record<string, any> = {};
      agreedCount = 0;
      disputedCount = 0;

      for (const f of fields) {
        const finalVal = resolveFieldValue(f);
        if (isAiOnly) {
          // AI-only mode: correct/incorrect
          fieldDecisions[f.fieldName] = {
            ai_value: f.sources.ai ?? '',
            status: f.decision === 'correct' ? 'correct' : f.decision === 'incorrect' ? 'incorrect' : null,
            correction: f.legacyCorrection || null,
            final_value: finalVal,
          };
          if (f.decision === 'correct') agreedCount++;
          else disputedCount++;
        } else {
          fieldDecisions[f.fieldName] = {
            ai_value: f.sources.ai ?? '',
            r1_value: f.sources.r1 ?? null,
            r2_value: f.sources.r2 ?? null,
            decision: f.decision,
            final_value: finalVal,
          };
          if (f.agreed || f.decision === 'agreed') agreedCount++;
          else disputedCount++;
        }
      }

      const totalFields = fields.length;
      const agreementPct = totalFields > 0 ? Math.round(agreedCount / totalFields * 100) : null;

      await resultsService.saveConsensus({
        document_id: reviewDoc.document_id,
        form_id: selectedForm.id,
        review_mode: isAiOnly ? 'ai_only' : 'ai_manual',
        field_decisions: fieldDecisions,
        agreed_count: agreedCount,
        disputed_count: disputedCount,
        total_fields: totalFields,
        agreement_pct: agreementPct,
      });

      // Refresh summary
      try {
        const fresh = await resultsService.getConsensusSummary(selectedProject!.id, selectedForm.id);
        setSummary(fresh);
      } catch {}

      setLastReviewDoc(reviewDoc);
      setLastFields([...fields]);
      setScreen('summary');
    } catch {
      toast({ title: 'Failed to save consensus', variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  /** Resolve the final value for a field based on its decision */
  function resolveFieldValue(f: FieldDecision): string {
    if (f.agreed || f.decision === 'agreed') return f.sources.ai ?? f.sources.r1 ?? f.sources.r2 ?? '';
    if (f.decision === 'accept_ai') return f.sources.ai ?? '';
    if (f.decision === 'accept_r1') return f.sources.r1 ?? '';
    if (f.decision === 'accept_r2') return f.sources.r2 ?? '';
    if (f.decision === 'accept_suggestion' && f.suggestion) return f.suggestion.value;
    if (f.decision === 'custom') return f.customValue;
    if (f.decision === 'correct') return f.sources.ai ?? '';
    if (f.decision === 'incorrect') return f.legacyCorrection || f.sources.ai || '';
    return '';
  }

  const goBackToDashboard = () => {
    if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
    setPdfUrl('');
    setReviewDoc(null);
    setFields([]);
    setActiveField(null);
    setScreen('dashboard');
  };

  const goToNextPending = (freshSummary: ConsensusSummary | null = summary) => {
    const docs = freshSummary ? sortDocs(freshSummary.documents) : [];
    const pending = docs.find(d => {
      const s = docStatus(d);
      return s.type !== 'done' && s.type !== 'none' && d.document_id !== lastReviewDoc?.document_id;
    });
    if (pending) openReview(pending);
    else goBackToDashboard();
  };

  // ── No project ──────────────────────────────────────────────────────────────────
  if (!selectedProject) {
    return (
      <DashboardLayout title="Consensus" description="Corpus-level consensus review">
        <div className="flex items-center justify-center h-48 text-sm text-gray-400">Select a project to get started</div>
      </DashboardLayout>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SUMMARY SCREEN
  // ══════════════════════════════════════════════════════════════════════════════
  if (screen === 'summary' && lastReviewDoc) {
    const reviewedFields = lastFields;
    const total = reviewedFields.length;

    const agreedCount = reviewedFields.filter(f => f.agreed || f.decision === 'agreed' || f.decision === 'correct').length;
    const resolvedCount = total - agreedCount;
    const pct = total > 0 ? Math.round(agreedCount / total * 100) : 0;
    const errorRate = total > 0 ? Math.round(resolvedCount / total * 100) : 0;

    // Per-source breakdown
    const acceptAi = reviewedFields.filter(f => f.decision === 'accept_ai').length;
    const acceptR1 = reviewedFields.filter(f => f.decision === 'accept_r1').length;
    const acceptR2 = reviewedFields.filter(f => f.decision === 'accept_r2').length;
    const acceptSuggestion = reviewedFields.filter(f => f.decision === 'accept_suggestion').length;
    const customCount = reviewedFields.filter(f => f.decision === 'custom').length;
    const correctedCount = reviewedFields.filter(f => f.decision === 'incorrect').length;

    return (
      <DashboardLayout title="Consensus" description="Corpus-level consensus review">
        <div className="pt-6">
          {/* Stats card */}
          <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] overflow-hidden mb-4">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-[#1f1f1f] flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">Consensus Saved</div>
                <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 truncate">
                  {lastReviewDoc.filename} · {selectedForm?.form_name}
                </div>
              </div>
              <RingChart size={96} strokeWidth={8} green={agreedCount} amber={resolvedCount} total={total} centerLabel={`${pct}%`} />
            </div>

            <div className="flex divide-x divide-gray-100 dark:divide-[#1f1f1f]">
              <div className="flex-1 px-5 py-3.5">
                <div className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-1">Agreed</div>
                <div className="text-xl font-bold text-green-600 dark:text-green-400">{agreedCount}</div>
              </div>
              <div className="flex-1 px-5 py-3.5">
                <div className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-1">Corrections</div>
                <div className="text-xl font-bold text-amber-600 dark:text-amber-400">{resolvedCount}</div>
              </div>
              <div className="flex-1 px-5 py-3.5">
                <div className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-1">Total Fields</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white">{total}</div>
              </div>
              <div className="flex-1 px-5 py-3.5">
                <div className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-1">Error Rate</div>
                <div className={cn('text-xl font-bold', errorRate >= 20 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>{errorRate}%</div>
              </div>
            </div>

            {/* Per-source breakdown */}
            {(acceptAi > 0 || acceptR1 > 0 || acceptR2 > 0 || acceptSuggestion > 0 || customCount > 0 || correctedCount > 0) && (
              <div className="flex divide-x divide-gray-100 dark:divide-[#1f1f1f] border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/50 dark:bg-[#0d0d0d]">
                {acceptAi > 0 && (
                  <div className="flex-1 px-5 py-3">
                    <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-0.5">Accept AI</div>
                    <div className="text-lg font-bold text-gray-700 dark:text-zinc-300">{acceptAi}</div>
                  </div>
                )}
                {acceptR1 > 0 && (
                  <div className="flex-1 px-5 py-3">
                    <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-0.5">Accept R1</div>
                    <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{acceptR1}</div>
                  </div>
                )}
                {acceptR2 > 0 && (
                  <div className="flex-1 px-5 py-3">
                    <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-0.5">Accept R2</div>
                    <div className="text-lg font-bold text-purple-600 dark:text-purple-400">{acceptR2}</div>
                  </div>
                )}
                {acceptSuggestion > 0 && (
                  <div className="flex-1 px-5 py-3">
                    <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-0.5">Auto-accepted</div>
                    <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{acceptSuggestion}</div>
                  </div>
                )}
                {customCount > 0 && (
                  <div className="flex-1 px-5 py-3">
                    <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-0.5">Custom</div>
                    <div className="text-lg font-bold text-gray-700 dark:text-zinc-300">{customCount}</div>
                  </div>
                )}
                {correctedCount > 0 && (
                  <div className="flex-1 px-5 py-3">
                    <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-0.5">Corrected</div>
                    <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{correctedCount}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Field breakdown */}
          <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] overflow-hidden mb-4">
            <div className="px-5 py-3.5 border-b border-gray-100 dark:border-[#1f1f1f]">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Field Decisions</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
              {reviewedFields.map((f, i) => {
                const isAgreed = f.agreed || f.decision === 'agreed' || f.decision === 'correct';
                const finalVal = resolveFieldValue(f);
                const decisionLabel =
                  f.decision === 'accept_ai' ? 'Accepted AI' :
                  f.decision === 'accept_r1' ? 'Accepted R1' :
                  f.decision === 'accept_r2' ? 'Accepted R2' :
                  f.decision === 'accept_suggestion' ? 'Auto-accepted (majority)' :
                  f.decision === 'custom' ? 'Custom' :
                  f.decision === 'incorrect' ? 'Corrected' : null;

                return (
                  <div key={i} className="flex items-start gap-3 px-5 py-3">
                    <div className={cn('mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0',
                      isAgreed ? 'bg-green-100 dark:bg-green-900/20' : 'bg-amber-100 dark:bg-amber-900/20'
                    )}>
                      {isAgreed
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                        : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide mb-0.5">
                        {f.fieldName.replace(/_/g, ' ')}
                      </div>
                      <div className="text-sm text-gray-700 dark:text-zinc-300">
                        {finalVal || <span className="text-gray-300 dark:text-zinc-600 italic text-xs">empty</span>}
                      </div>
                      {decisionLabel && !isAgreed && (
                        <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Decision: {decisionLabel}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => goToNextPending(summary)}
              className="flex-1 inline-flex items-center justify-center gap-2 text-sm font-semibold py-2.5 px-4 rounded-lg bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white transition-colors"
            >
              Next paper <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={goBackToDashboard}
              className="text-sm font-medium text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-2.5 px-4 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors bg-white dark:bg-[#111111]"
            >
              Back to overview
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // REVIEW SCREEN
  // ══════════════════════════════════════════════════════════════════════════════
  if (screen === 'review' && reviewDoc) {
    const totalFields = fields.length;
    const disputedFields = fields.filter(f => !f.agreed);
    const agreedFields = fields.filter(f => f.agreed);
    const totalDisputed = disputedFields.length;

    // Progress: for AI-only mode count all fields, else count disputed
    let reviewedCount: number;
    let progressDenominator: number;
    if (isAiOnly) {
      reviewedCount = fields.filter(f => f.decision !== null).length;
      progressDenominator = totalFields;
    } else {
      reviewedCount = disputedFields.filter(f => f.decision !== null).length;
      progressDenominator = totalDisputed;
    }
    const progressPct = progressDenominator > 0 ? (reviewedCount / progressDenominator) * 100 : 0;

    // Count source-specific resolutions for split progress bar
    const sourceResolved = disputedFields.filter(f =>
      f.decision === 'accept_ai' || f.decision === 'accept_r1' || f.decision === 'accept_r2' || f.decision === 'accept_suggestion'
    ).length;
    const customResolved = disputedFields.filter(f => f.decision === 'custom').length;

    return (
      <DashboardLayout title="Consensus" description="Corpus-level consensus review">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={goBackToDashboard}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 bg-transparent border-none cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
          <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md">{selectedForm?.form_name}</span>
          <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
          <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md truncate max-w-[200px]">{reviewDoc.filename}</span>
          <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
          <span className="text-xs text-gray-400 dark:text-zinc-500">{totalFields} fields · {totalDisputed} disputed</span>
        </div>

        <PanelGroup orientation="horizontal" className="gap-0">
          {/* PDF Panel */}
          <Panel defaultSize={60} minSize={30}>
            <div
              className="flex flex-col rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]"
              style={{ height: 'calc(100vh - 160px)' }}
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f] shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs font-medium text-gray-600 dark:text-zinc-400 truncate max-w-[260px]">{reviewDoc.filename}</span>
                </div>
                <span className="text-xs text-gray-400">{reviewedCount}/{progressDenominator} reviewed</span>
              </div>
              <div className="flex-1 relative min-h-0">
                {pdfUrl
                  ? <iframe src={pdfUrl} className="w-full h-full border-0" title="PDF viewer" />
                  : <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No PDF available</div>
                }
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-2 mx-1 flex items-center justify-center group cursor-col-resize">
            <div className="w-1 h-full rounded-full bg-gray-200 dark:bg-[#2a2a2a] group-hover:bg-gray-400 dark:group-hover:bg-zinc-600 transition-colors flex items-center justify-center">
              <GripVertical className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </PanelResizeHandle>

          {/* Fields Panel */}
          <Panel defaultSize={40} minSize={25}>
            <div
              className="flex flex-col rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]"
              style={{ height: 'calc(100vh - 160px)' }}
            >
              {/* Progress bar */}
              <div className="px-4 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f] shrink-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">
                    {isAiOnly ? 'Review fields' : `Resolve ${totalDisputed} conflicts`}
                  </span>
                  <span className="text-xs text-gray-400">{reviewedCount}/{progressDenominator}</span>
                </div>
                {isAiOnly ? (
                  <div className="h-1 bg-gray-100 dark:bg-[#1a1a1a] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gray-800 dark:bg-zinc-300 rounded-full transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                ) : (
                  <div className="h-1.5 bg-gray-100 dark:bg-[#1a1a1a] rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-green-500 transition-all duration-300"
                      style={{ width: `${totalDisputed > 0 ? (sourceResolved / totalDisputed) * 100 : 0}%` }}
                    />
                    <div
                      className="h-full bg-amber-400 transition-all duration-300"
                      style={{ width: `${totalDisputed > 0 ? (customResolved / totalDisputed) * 100 : 0}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Field list */}
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-[#1f1f1f] min-h-0">
                {/* Agreed fields section (collapsible) */}
                {agreedFields.length > 0 && !isAiOnly && (
                  <div>
                    <button
                      onClick={() => setAgreedCollapsed(c => !c)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-400 dark:text-zinc-500 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        {agreedCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        {agreedFields.length} agreed field{agreedFields.length !== 1 ? 's' : ''}
                      </span>
                    </button>
                    {!agreedCollapsed && agreedFields.map((f) => {
                      const realIdx = fields.indexOf(f);
                      return (
                        <UnifiedFieldCard
                          key={realIdx}
                          fieldName={f.fieldName}
                          sources={f.sources}
                          agreed={f.agreed}
                          suggestion={f.suggestion}
                          decision={f.decision}
                          customValue={f.customValue}
                          legacyCorrection={f.legacyCorrection}
                          onDecision={(d) => updateFieldDecision(realIdx, d)}
                          onCustomValue={(v) => updateCustomValue(realIdx, v)}
                          onCorrection={(v) => updateCorrection(realIdx, v)}
                          isActive={activeField === realIdx}
                          onClick={() => setActiveField(realIdx)}
                        />
                      );
                    })}
                    {totalDisputed > 0 && (
                      <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-600 bg-gray-50/60 dark:bg-[#0a0a0a]">
                        {totalDisputed} field{totalDisputed !== 1 ? 's' : ''} need{totalDisputed === 1 ? 's' : ''} your decision
                      </div>
                    )}
                  </div>
                )}

                {/* Disputed / AI-only fields */}
                {(isAiOnly ? fields : disputedFields).map((f) => {
                  const realIdx = fields.indexOf(f);
                  return (
                    <UnifiedFieldCard
                      key={realIdx}
                      fieldName={f.fieldName}
                      sources={f.sources}
                      agreed={f.agreed}
                      suggestion={f.suggestion}
                      decision={f.decision}
                      customValue={f.customValue}
                      legacyCorrection={f.legacyCorrection}
                      onDecision={(d) => updateFieldDecision(realIdx, d)}
                      onCustomValue={(v) => updateCustomValue(realIdx, v)}
                      onCorrection={(v) => updateCorrection(realIdx, v)}
                      isActive={activeField === realIdx}
                      onClick={() => setActiveField(realIdx)}
                    />
                  );
                })}
              </div>

              {/* Submit */}
              <div className="px-4 py-3 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] shrink-0">
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !canSubmit()}
                  className={cn(
                    'w-full text-sm font-semibold rounded-lg py-2.5 transition-colors',
                    canSubmit() && !submitting
                      ? 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white'
                      : 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-400 dark:text-zinc-600 cursor-not-allowed'
                  )}
                >
                  {submitting
                    ? 'Saving...'
                    : !canSubmit()
                    ? isAiOnly
                      ? `${totalFields - reviewedCount} fields left`
                      : `${totalDisputed - reviewedCount} conflicts left`
                    : (reviewDoc.has_consensus || reviewDoc.has_adjudication)
                    ? 'Update consensus'
                    : 'Submit consensus'
                  }
                </button>
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </DashboardLayout>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DASHBOARD SCREEN
  // ══════════════════════════════════════════════════════════════════════════════

  const exportFinalDataset = async () => {
    if (!summary || !selectedForm) return;
    const reviewedDocs = summary.documents.filter(d => d.has_consensus);
    if (reviewedDocs.length === 0) {
      toast({ title: 'No reviewed documents', description: 'Complete at least one consensus review first.' });
      return;
    }
    setExporting(true);
    try {
      const results = await Promise.all(
        reviewedDocs.map(d => resultsService.getConsensus(d.document_id, selectedForm.id))
      );
      const allFields = new Set<string>();
      results.forEach(r => { if (r) Object.keys(r.field_decisions).forEach(f => allFields.add(f)); });
      const fieldNames = Array.from(allFields).sort();

      const header = ['document', ...fieldNames];
      const rows = results.map((r, i) => {
        if (!r) return null;
        const row: string[] = [reviewedDocs[i].filename];
        fieldNames.forEach(f => {
          const d = r.field_decisions[f];
          const val = d?.final_value ?? d?.correction ?? '';
          row.push(String(val ?? ''));
        });
        return row;
      }).filter(Boolean) as string[][];

      const csv = [header, ...rows]
        .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `consensus_${selectedForm.form_name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Export failed', description: 'Could not fetch consensus results.', variant: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const sortedDocs = summary ? sortDocs(summary.documents) : [];
  const searchedDocs = searchQuery
    ? sortedDocs.filter(d => d.filename.toLowerCase().includes(searchQuery.toLowerCase()))
    : sortedDocs;
  const filteredDocs = filterDocs(searchedDocs, filterTab);

  const consensusDone = summary?.summary.consensus_done ?? 0;
  const adjDone = summary?.summary.adjudication_done ?? 0;
  const totalDone = consensusDone + adjDone;
  const totalDocs = summary?.summary.total_docs ?? 0;
  const needsReviewCount = summary ? tabCount(sortedDocs, 'needs_review') : 0;
  const doneCount = summary ? tabCount(sortedDocs, 'done') : 0;
  const avgAgreement = summary?.summary.avg_agreement_pct ?? null;

  return (
    <DashboardLayout title="Consensus" description="Corpus-level consensus review">
      {/* Top bar: form picker + export */}
      <div className="flex items-center justify-between mb-4 gap-3">
        {/* Form picker */}
        <div className="relative">
          {loadingForms ? (
            <div className="flex items-center gap-2 h-9 px-3 text-sm text-gray-400 border border-gray-200 dark:border-[#2a2a2a] rounded-lg bg-white dark:bg-[#111111]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Loading forms...</span>
            </div>
          ) : (
            <>
              <button
                onClick={() => setFormPickerOpen(o => !o)}
                className="flex items-center gap-2 h-9 pl-3 pr-3 text-sm bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#2a2a2a] rounded-lg hover:border-gray-400 dark:hover:border-[#3f3f3f] transition-colors text-gray-900 dark:text-white"
              >
                <span className="max-w-[200px] truncate">
                  {selectedForm ? selectedForm.form_name : 'Select form...'}
                </span>
                <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform', formPickerOpen && 'rotate-180')} />
              </button>
              {formPickerOpen && forms.length > 0 && (
                <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#2a2a2a] rounded-xl shadow-lg overflow-hidden min-w-[220px]">
                  {forms.map(f => (
                    <button
                      key={f.id}
                      onClick={() => handleFormSelect(f)}
                      className={cn(
                        'w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors',
                        selectedForm?.id === f.id
                          ? 'text-gray-900 dark:text-white font-semibold'
                          : 'text-gray-600 dark:text-zinc-400'
                      )}
                    >
                      {f.form_name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Summary text */}
        {summary && (
          <div className="flex-1 text-xs text-gray-400 dark:text-zinc-500 text-center">
            {totalDocs} documents · {needsReviewCount} need review · {doneCount} done
            {avgAgreement !== null && ` · ${avgAgreement}% avg agreement`}
          </div>
        )}

        <button
          disabled={!summary || exporting}
          onClick={exportFinalDataset}
          className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Stats bar */}
      {summary && (
        <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] p-0 overflow-hidden mb-4">
          <div className="grid grid-cols-6 divide-x divide-gray-100 dark:divide-[#1f1f1f]">
            {[
              { label: 'Papers', value: summary.summary.total_docs, color: 'text-gray-900 dark:text-white', bar: 'bg-gray-400' },
              { label: 'AI Done', value: summary.summary.ai_done, color: 'text-blue-600 dark:text-blue-400', bar: 'bg-blue-500' },
              { label: 'R1 Done', value: summary.summary.r1_done + summary.summary.manual_done, color: 'text-blue-600 dark:text-blue-400', bar: 'bg-blue-400' },
              { label: 'R2 Done', value: summary.summary.r2_done, color: 'text-purple-600 dark:text-purple-400', bar: 'bg-purple-500' },
              { label: 'Consensus Done', value: totalDone || summary.summary.consensus_done, color: 'text-green-600 dark:text-green-400', bar: 'bg-green-500' },
              { label: 'Avg Agreement', value: avgAgreement, color: 'text-cyan-600 dark:text-cyan-400', bar: 'bg-cyan-500', suffix: '%' },
            ].map(({ label, value, color, bar, suffix }) => {
              const hasValue = value !== null && value > 0;
              return (
                <div key={label} className="relative flex flex-col items-start gap-1.5 px-6 py-5 text-left">
                  <div className={cn('absolute inset-x-0 top-0 h-[2px] transition-opacity duration-300', hasValue ? bar : 'opacity-0')} />
                  <span className={cn('text-2xl font-bold tabular-nums leading-none', hasValue ? color : 'text-gray-300 dark:text-zinc-700')}>
                    {value !== null ? `${value}${suffix || ''}` : '—'}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-zinc-500 font-medium">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search + Filter tabs */}
      {summary && (
        <div className="flex items-center gap-2 mb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-zinc-500" />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-zinc-600 w-48"
            />
          </div>
          <div className="flex items-center gap-1">
          {(['all', 'needs_review', 'disputed', 'done'] as FilterTab[]).map(tab => {
            const count = tabCount(searchedDocs, tab);
            const label = tab === 'all' ? 'All' : tab === 'needs_review' ? 'Needs Review' : tab === 'disputed' ? 'Conflicts' : 'Done';
            return (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  filterTab === tab
                    ? 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900'
                    : 'bg-transparent text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-[#1a1a1a]'
                )}
              >
                {label} ({count})
              </button>
            );
          })}
          </div>
        </div>
      )}

      {/* Document table */}
      {!selectedForm ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="w-12 h-12 rounded-xl bg-gray-50 dark:bg-[#1a1a1a] flex items-center justify-center">
            <FileText className="w-6 h-6 text-gray-300 dark:text-zinc-600" />
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-gray-700 dark:text-zinc-300">Select a form</div>
            <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Choose an active form above to see your corpus</div>
          </div>
        </div>
      ) : loadingSummary ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
        </div>
      ) : summary && filteredDocs.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm text-gray-400">No documents match this filter</div>
      ) : summary ? (
        <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] overflow-hidden">
          {/* Table header — unified: AI | R1 | R2 columns always visible */}
          <div className="grid gap-3 px-5 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a]" style={{ gridTemplateColumns: '1fr 50px 50px 50px 90px 110px 80px' }}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Document</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">AI</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-400 dark:text-blue-500">R1</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-purple-400 dark:text-purple-500">R2</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">
              Agreement
              <Tooltip side="bottom" className="rounded-none text-[11px] px-2 py-1.5 shadow-none border border-zinc-700 bg-zinc-900 whitespace-normal max-w-[250px] leading-relaxed" content="Cross-source agreement percentage across all available extractions.">
                <Info className="w-3 h-3 text-blue-400 dark:text-blue-500 flex-shrink-0 cursor-default" />
              </Tooltip>
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Status</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Action</span>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
            {filteredDocs.map(doc => {
              const status = docStatus(doc);
              const pct = doc.r1_r2_agreement_pct ?? doc.agreement_pct;
              const badge = agreementBadge(pct);
              const hasAnySource = doc.has_ai || doc.has_r1 || doc.has_r2 || doc.has_manual;
              const isLoading = loadingDocId === doc.document_id;

              return (
                <div
                  key={doc.document_id}
                  className={cn(
                    'grid gap-3 items-center px-5 py-3 transition-colors',
                    !hasAnySource ? 'opacity-40' : 'hover:bg-gray-50/60 dark:hover:bg-[rgba(255,255,255,0.01)]',
                    status.type === 'conflicts' && 'border-l-2 border-amber-400',
                    status.type === 'done' && 'border-l-2 border-green-500',
                  )}
                  style={{ gridTemplateColumns: '1fr 50px 50px 50px 90px 110px 80px' }}
                >
                  {/* Filename */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-600 flex-shrink-0" />
                      <span className="text-sm text-gray-800 dark:text-zinc-200 truncate">{doc.filename}</span>
                    </div>
                  </div>

                  {/* AI */}
                  <div>
                    {doc.has_ai
                      ? <span className="text-xs font-medium text-green-600 dark:text-green-400">&#10003;</span>
                      : <span className="text-xs text-gray-300 dark:text-zinc-700">&mdash;</span>
                    }
                  </div>

                  {/* R1 */}
                  <div>
                    {(doc.has_r1 || doc.has_manual)
                      ? <span className="text-xs font-medium text-blue-600 dark:text-blue-400">&#10003;</span>
                      : <span className="text-xs text-gray-300 dark:text-zinc-700">&mdash;</span>
                    }
                  </div>

                  {/* R2 */}
                  <div>
                    {doc.has_r2
                      ? <span className="text-xs font-medium text-purple-600 dark:text-purple-400">&#10003;</span>
                      : <span className="text-xs text-gray-300 dark:text-zinc-700">&mdash;</span>
                    }
                  </div>

                  {/* Agreement */}
                  <div>
                    {badge ? (
                      <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-md cursor-default', badge.cls)}>{badge.label}</span>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-zinc-700">&mdash;</span>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    {status.type === 'done' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 px-2 py-0.5 rounded-md">
                        <CheckCircle2 className="w-3 h-3" /> Done
                      </span>
                    ) : status.type === 'conflicts' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-md">
                        <AlertTriangle className="w-3 h-3" /> {status.label}
                      </span>
                    ) : status.type === 'agree' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 px-2 py-0.5 rounded-md">
                        <CheckCircle2 className="w-3 h-3" /> All agree
                      </span>
                    ) : status.type === 'ai_only' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-zinc-500 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md">
                        AI only
                      </span>
                    ) : status.type === 'pending' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-zinc-500 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md">
                        <Clock className="w-3 h-3" /> Pending
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-zinc-700">&mdash;</span>
                    )}
                  </div>

                  {/* Action */}
                  <div>
                    {hasAnySource ? (
                      <button
                        onClick={() => openReview(doc)}
                        disabled={isLoading || loadingDocId !== null}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                      >
                        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        {status.type === 'done' ? 'View' : status.type === 'ai_only' ? 'Verify' : 'Review'}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}

'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { DashboardLayout } from '@/components/layout';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProject } from '@/contexts/ProjectContext';
import { formsService, documentsService, resultsService, adjudicationService, assignmentsService } from '@/services';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { PermissionGate } from '@/components/ui/permission-gate';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import type { ConsensusSummary, ConsensusSummaryDoc, Form, FormField } from '@/types/api';
import { flattenScalarFields, isTableField } from '../manual-extraction/_lib/fieldKinds';
import {
  ArrowLeft, ArrowRight, FileText, FolderOpen, GripVertical, Loader2, Search,
  CheckCircle2, Clock, AlertTriangle, Download, ChevronDown, ChevronUp, Info, User, ClipboardList,
} from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Tooltip } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/ui';
import { RingChart } from './_components/RingChart';
import { UnifiedFieldCard } from './_components/UnifiedFieldCard';

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'needs_review' | 'disputed' | 'done';
type Screen = 'dashboard' | 'review' | 'summary';

type SourceMeta = { source_text?: string; page?: number; section?: string };

interface FieldDecision {
  fieldName: string;
  field?: FormField;
  sources: { ai?: any; r1?: any; r2?: any };
  sourceMeta?: { ai?: SourceMeta; r1?: SourceMeta; r2?: SourceMeta };
  agreed: boolean;
  suggestion?: { value: any; source: string; reason: string };
  decision: string | null;
  customValue: any;
  legacyCorrection: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function agreementBadge(pct: number | null) {
  if (pct === null) return null;
  if (pct >= 80) return { label: `${pct}%`, cls: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800/40' };
  if (pct >= 50) return { label: `${pct}%`, cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40' };
  return { label: `${pct}%`, cls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40' };
}

/** Unwrap DSPy-style {value, source_text, ...} or [{rating, ...}] wrappers to native value. */
function unwrap(raw: any): any {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    if (raw.length > 0 && raw[0] && typeof raw[0] === 'object' && 'rating' in raw[0]) {
      return raw[0].rating;
    }
    return raw;
  }
  if (typeof raw === 'object') {
    if ('value' in raw) return raw.value;
    if ('final_value' in raw) return raw.final_value;
    if ('rating' in raw) return raw.rating;
    return raw;
  }
  return raw;
}

function valueIsEmpty(v: any): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === '' || s === 'nr';
  }
  return false;
}

function normalizeForCompare(v: any): string {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return [...v]
      .map(x => typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x).trim().toLowerCase())
      .sort()
      .join('|');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return String(v).trim().toLowerCase();
}

function valuesMatch(a: any, b: any): boolean {
  if (valueIsEmpty(a) || valueIsEmpty(b)) return false;
  return normalizeForCompare(a) === normalizeForCompare(b);
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

function extractMeta(raw: any): SourceMeta | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const text = typeof raw.source_text === 'string' && raw.source_text.trim() && raw.source_text !== 'NR' ? raw.source_text : undefined;
  const page = raw.source_location?.page ? Number(raw.source_location.page) : undefined;
  const section = typeof raw.source_location?.section === 'string' ? raw.source_location.section : undefined;
  if (!text && !page) return undefined;
  return { ...(text && { source_text: text }), ...(page && { page }), ...(section && { section }) };
}

/** Compute majority suggestion when 2+ sources agree */
function computeSuggestion(sources: { ai?: any; r1?: any; r2?: any }): { value: any; source: string; reason: string } | undefined {
  const entries: { key: string; val: any }[] = [];
  if (!valueIsEmpty(sources.ai)) entries.push({ key: 'AI', val: sources.ai });
  if (!valueIsEmpty(sources.r1)) entries.push({ key: 'R1', val: sources.r1 });
  if (!valueIsEmpty(sources.r2)) entries.push({ key: 'R2', val: sources.r2 });

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

function ConsensusContent() {
  const { selectedProject } = useProject();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [screen, setScreen] = useState<Screen>('dashboard');
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedForm, setSelectedForm] = useState<Form | null>(null);
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

  // Reviewer assignment map: document_id → { reviewer_1?, reviewer_2?, adjudicator? }
  const [assignmentMap, setAssignmentMap] = useState<Map<string, Record<string, { name: string; status: string; completed_at: string | null; form_details: Array<{ form_id: string; form_name: string; completed: boolean }> }>>>(new Map());
  // Active dot popover: { docId, role }
  const [activePopover, setActivePopover] = useState<{ docId: string; role: string } | null>(null);

  const fetchForms = useCallback(async () => {
    if (!selectedProject) return;
    setLoadingForms(true);
    try {
      const data = await formsService.getAll(selectedProject.id);
      const active = data.filter((f: any) => f.status === 'active');
      setForms(active);
      if (active.length > 0) {
        const urlFormId = searchParams.get('form');
        const preferred = (urlFormId && active.find((f: any) => f.id === urlFormId)) || active[0];
        setSelectedForm(preferred);
        setLoadingSummary(true);
        try {
          const [summaryData, assignments] = await Promise.all([
            resultsService.getConsensusSummary(selectedProject.id, preferred.id),
            assignmentsService.getProjectAssignments(selectedProject.id).catch(() => [] as any[]),
          ]);
          setSummary(summaryData);
          const map = new Map<string, Record<string, { name: string; status: string; completed_at: string | null; form_details: Array<{ form_id: string; form_name: string; completed: boolean }> }>>();
          for (const a of (assignments as any[])) {
            if (!map.has(a.document_id)) map.set(a.document_id, {});
            map.get(a.document_id)![a.reviewer_role] = {
              name: a.reviewer_name ?? 'Assigned',
              status: a.status,
              completed_at: a.completed_at,
              form_details: a.form_details ?? [],
            };
          }
          setAssignmentMap(map);
        } catch { /* silent — user can retry by picking form manually */ } finally {
          setLoadingSummary(false);
        }
      }
    } catch { /* ignore */ } finally {
      setLoadingForms(false);
    }
  }, [selectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedProject) fetchForms();
  }, [selectedProject, fetchForms]);

  // Re-fetch summary + assignments when the tab regains focus (e.g. after saving in manual-extraction)
  useEffect(() => {
    if (!selectedProject || !selectedForm) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      resultsService.getConsensusSummary(selectedProject.id, selectedForm.id)
        .then(d => setSummary(d)).catch(() => {});
      assignmentsService.getProjectAssignments(selectedProject.id)
        .then((asgs: any[]) => {
          const map = new Map<string, Record<string, { name: string; status: string; completed_at: string | null; form_details: Array<{ form_id: string; form_name: string; completed: boolean }> }>>();
          for (const a of asgs) {
            if (!map.has(a.document_id)) map.set(a.document_id, {});
            map.get(a.document_id)![a.reviewer_role] = { name: a.reviewer_name ?? 'Assigned', status: a.status, completed_at: a.completed_at, form_details: a.form_details ?? [] };
          }
          setAssignmentMap(map);
        }).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedProject?.id, selectedForm?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  // URL → state: handles deep links and browser back/forward
  useEffect(() => {
    if (loadingForms || forms.length === 0) return;
    const urlForm = searchParams.get('form');
    const urlDoc = searchParams.get('doc');

    // URL form differs from current → switch form
    if (urlForm && urlForm !== selectedForm?.id) {
      const newForm = forms.find((f: any) => f.id === urlForm);
      if (newForm) {
        handleFormSelect(newForm);
        return;
      }
    }

    // URL has doc → ensure we're reviewing it
    if (urlDoc && summary) {
      if (reviewDoc?.document_id === urlDoc) return;
      const doc = summary.documents.find(d => d.document_id === urlDoc);
      if (doc) {
        openReview(doc);
        return;
      }
    }

    // URL has no doc but we're in review → return to dashboard
    if (!urlDoc && screen === 'review') {
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl('');
      setReviewDoc(null);
      setFields([]);
      setActiveField(null);
      setScreen('dashboard');
    }
  }, [searchParams, forms, summary, loadingForms]); // eslint-disable-line react-hooks/exhaustive-deps

  // State → URL: push for new form/doc (so back returns), replace for transitions back
  useEffect(() => {
    if (loadingForms || forms.length === 0) return;
    if (screen === 'summary') return; // keep URL as-is during summary

    const urlForm = searchParams.get('form');
    const urlDoc = searchParams.get('doc');

    if (screen === 'review' && selectedForm && reviewDoc) {
      const targetForm = selectedForm.id;
      const targetDoc = reviewDoc.document_id;
      if (urlForm === targetForm && urlDoc === targetDoc) return;
      const target = `/consensus?form=${targetForm}&doc=${targetDoc}`;
      const formOrDocChanged = urlForm !== targetForm || urlDoc !== targetDoc;
      if (formOrDocChanged) router.push(target, { scroll: false });
      else router.replace(target, { scroll: false });
      return;
    }

    if (screen === 'dashboard' && selectedForm) {
      const targetForm = selectedForm.id;
      if (urlForm === targetForm && !urlDoc) return;
      const target = `/consensus?form=${targetForm}`;
      // Form change (with form already in URL) → push; otherwise (initial load or doc removal) → replace
      if (urlForm && urlForm !== targetForm) router.push(target, { scroll: false });
      else router.replace(target, { scroll: false });
    }
  }, [screen, selectedForm?.id, reviewDoc?.document_id, loadingForms, forms.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFormSelect = async (form: any) => {
    if (selectedForm?.id === form.id) { setFormPickerOpen(false); return; }
    setSelectedForm(form);
    setFormPickerOpen(false);
    setSummary(null);
    setFilterTab('all');
    setLoadingSummary(true);
    try {
      const [data, assignments] = await Promise.all([
        resultsService.getConsensusSummary(selectedProject!.id, form.id),
        assignmentsService.getProjectAssignments(selectedProject!.id).catch(() => [] as any[]),
      ]);
      setSummary(data);
      const map = new Map<string, Record<string, { name: string; status: string; completed_at: string | null; form_details: Array<{ form_id: string; form_name: string; completed: boolean }> }>>();
      for (const a of (assignments as any[])) {
        if (!map.has(a.document_id)) map.set(a.document_id, {});
        map.get(a.document_id)![a.reviewer_role] = {
          name: a.reviewer_name ?? 'Assigned',
          status: a.status,
          completed_at: a.completed_at,
          form_details: a.form_details ?? [],
        };
      }
      setAssignmentMap(map);
    } catch {
      toast({ title: 'Failed to load consensus summary', variant: 'error' });
    } finally {
      setLoadingSummary(false);
    }
  };

  // ── Open Review ─────────────────────────────────────────────────────────────
  const openReview = async (doc: ConsensusSummaryDoc) => {
    setLoadingDocId(doc.document_id);
    if (!selectedForm || !selectedProject) { setLoadingDocId(null); return; }
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

      // Build unified field list (schema-ordered: scalars → tables → leftover data-only keys)
      const formFields: FormField[] = selectedForm.fields ?? [];
      const scalarFields = flattenScalarFields(formFields);
      const tableFields = formFields.filter(isTableField);
      const knownNames = new Set([...scalarFields, ...tableFields].map(f => f.field_name));
      const orderedFields: Array<{ name: string; field?: FormField }> = [
        ...scalarFields.map(f => ({ name: f.field_name, field: f })),
        ...tableFields.map(f => ({ name: f.field_name, field: f })),
      ];
      for (const k of Array.from(allFieldNames).sort()) {
        if (!knownNames.has(k)) orderedFields.push({ name: k });
      }

      const built: FieldDecision[] = [];
      for (const { name: fn, field } of orderedFields) {
        const sources: FieldDecision['sources'] = {};
        if (fn in normalizedAiData) sources.ai = unwrap(normalizedAiData[fn]);
        if (fn in r1Data) sources.r1 = unwrap(r1Data[fn]);
        if (fn in r2Data) sources.r2 = unwrap(r2Data[fn]);

        // Agreement: ≥2 non-empty sources matching (single-source is NOT auto-agreed)
        const presentVals: any[] = [];
        if (sources.ai !== undefined && !valueIsEmpty(sources.ai)) presentVals.push(sources.ai);
        if (sources.r1 !== undefined && !valueIsEmpty(sources.r1)) presentVals.push(sources.r1);
        if (sources.r2 !== undefined && !valueIsEmpty(sources.r2)) presentVals.push(sources.r2);
        const agreed = presentVals.length >= 2 && presentVals.every(v => valuesMatch(v, presentVals[0]));

        const suggestion = (!agreed && presentVals.length >= 2) ? computeSuggestion(sources) : undefined;

        let decision: string | null = agreed ? 'agreed' : null;
        let customValue: any = '';
        let legacyCorrection = '';

        if (existingDecisions[fn]) {
          const ed = existingDecisions[fn];
          if (ed.status === 'correct') decision = 'correct';
          else if (ed.status === 'incorrect') { decision = 'incorrect'; legacyCorrection = ed.correction ?? ''; }
          else if (ed.decision) {
            decision = ed.decision;
            if (ed.decision === 'custom') customValue = ed.final_value ?? '';
          }
        }
        if (existingResolutions[fn]) {
          const res = existingResolutions[fn];
          if (res.agreed) decision = 'agreed';
          else if (res.resolution_source === 'reviewer_1') decision = 'accept_r1';
          else if (res.resolution_source === 'reviewer_2') decision = 'accept_r2';
          else if (res.resolution_source === 'custom') { decision = 'custom'; customValue = res.final_value ?? ''; }
        }

        const sm: FieldDecision['sourceMeta'] = {};
        if (fn in normalizedAiData) { const m = extractMeta(normalizedAiData[fn]); if (m) sm.ai = m; }
        if (fn in r1Data) { const m = extractMeta(r1Data[fn]); if (m) sm.r1 = m; }
        if (fn in r2Data) { const m = extractMeta(r2Data[fn]); if (m) sm.r2 = m; }
        built.push({ fieldName: fn, field, sources, sourceMeta: Object.keys(sm).length ? sm : undefined, agreed, suggestion, decision, customValue, legacyCorrection });
      }

      // Restore draft from localStorage
      const lsKey = `cdr:${selectedProject!.id}:${selectedForm.id}:${doc.document_id}`;
      try {
        const saved = localStorage.getItem(lsKey);
        if (saved) {
          const draft: Array<{ fieldName: string; decision: string | null; customValue: any; legacyCorrection: string }> = JSON.parse(saved);
          const draftMap = new Map(draft.map(d => [d.fieldName, d]));
          for (const b of built) {
            const d = draftMap.get(b.fieldName);
            if (d && d.decision !== null) {
              b.decision = d.decision;
              b.customValue = d.customValue;
              b.legacyCorrection = d.legacyCorrection;
            }
          }
        }
      } catch {}

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
      if (f.agreed) return true;
      if (f.decision === null) return false;
      if (f.decision === 'custom') return !valueIsEmpty(f.customValue);
      return true;
    });
  };

  // ── Keyboard navigation ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'review') return;
    const visibleFields = isAiOnly ? fields : fields.filter(f => !f.agreed);
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const visibleIndices = visibleFields.map(f => fields.indexOf(f));
      const curPos = activeField !== null ? visibleIndices.indexOf(activeField) : -1;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = curPos + 1 < visibleIndices.length ? visibleIndices[curPos + 1] : visibleIndices[0];
        if (next !== undefined) { setActiveField(next); document.getElementById(`field-card-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = curPos > 0 ? visibleIndices[curPos - 1] : visibleIndices[visibleIndices.length - 1];
        if (prev !== undefined) { setActiveField(prev); document.getElementById(`field-card-${prev}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      } else if (activeField !== null) {
        const f = fields[activeField];
        if (!f) return;
        if (e.key === 'a') {
          if (isAiOnly) updateFieldDecision(activeField, 'correct');
          else if (f.sources.ai !== undefined) updateFieldDecision(activeField, 'accept_ai');
        } else if (e.key === '1' && f.sources.r1 !== undefined) {
          updateFieldDecision(activeField, 'accept_r1');
        } else if (e.key === '2' && f.sources.r2 !== undefined) {
          updateFieldDecision(activeField, 'accept_r2');
        } else if (e.key === 'n') {
          updateFieldDecision(activeField, 'nr');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [screen, isAiOnly, fields, activeField]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autosave draft to localStorage ──────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'review' || !selectedProject || !selectedForm || !reviewDoc) return;
    const key = `cdr:${selectedProject.id}:${selectedForm.id}:${reviewDoc.document_id}`;
    try {
      const draft = fields.map(f => ({ fieldName: f.fieldName, decision: f.decision, customValue: f.customValue, legacyCorrection: f.legacyCorrection }));
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {}
  }, [fields, screen, selectedProject?.id, selectedForm?.id, reviewDoc?.document_id]); // eslint-disable-line react-hooks/exhaustive-deps

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

      // Refresh summary + assignments so dots/counters reflect the new consensus
      try {
        const [freshSummary, freshAsgs] = await Promise.allSettled([
          resultsService.getConsensusSummary(selectedProject!.id, selectedForm.id),
          assignmentsService.getProjectAssignments(selectedProject!.id),
        ]);
        if (freshSummary.status === 'fulfilled') setSummary(freshSummary.value);
        if (freshAsgs.status === 'fulfilled') {
          const map = new Map<string, Record<string, { name: string; status: string; completed_at: string | null; form_details: Array<{ form_id: string; form_name: string; completed: boolean }> }>>();
          for (const a of (freshAsgs.value as any[])) {
            if (!map.has(a.document_id)) map.set(a.document_id, {});
            map.get(a.document_id)![a.reviewer_role] = { name: a.reviewer_name ?? 'Assigned', status: a.status, completed_at: a.completed_at, form_details: a.form_details ?? [] };
          }
          setAssignmentMap(map);
        }
      } catch {}

      setLastReviewDoc(reviewDoc);
      setLastFields([...fields]);
      try { localStorage.removeItem(`cdr:${selectedProject!.id}:${selectedForm!.id}:${reviewDoc.document_id}`); } catch {}
      setScreen('summary');
    } catch {
      toast({ title: 'Failed to save consensus', variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  /** Resolve the final value for a field based on its decision */
  function resolveFieldValue(f: FieldDecision): any {
    const pickPresent = () => {
      if (f.sources.ai !== undefined && !valueIsEmpty(f.sources.ai)) return f.sources.ai;
      if (f.sources.r1 !== undefined && !valueIsEmpty(f.sources.r1)) return f.sources.r1;
      if (f.sources.r2 !== undefined && !valueIsEmpty(f.sources.r2)) return f.sources.r2;
      return null;
    };
    if (f.agreed || f.decision === 'agreed') return pickPresent();
    if (f.decision === 'accept_ai') return f.sources.ai ?? null;
    if (f.decision === 'accept_r1') return f.sources.r1 ?? null;
    if (f.decision === 'accept_r2') return f.sources.r2 ?? null;
    if (f.decision === 'accept_suggestion' && f.suggestion) return f.suggestion.value;
    if (f.decision === 'custom') return f.customValue;
    if (f.decision === 'correct') return f.sources.ai ?? null;
    if (f.decision === 'incorrect') return f.legacyCorrection || f.sources.ai || null;
    if (f.decision === 'nr') return null;
    return null;
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

  const { can_adjudicate, isAdmin, isOwner, role, can_manage_assignments } = useProjectPermissions();

  // ── No project ──────────────────────────────────────────────────────────────────
  if (!selectedProject) {
    return (
      <DashboardLayout title="Consensus" description="Corpus-level consensus review">
        <EmptyState
          icon={FolderOpen}
          title="No project selected"
          description="Create or open a project to review consensus data."
          action={{ label: 'Go to projects', onClick: () => router.push('/projects') }}
        />
      </DashboardLayout>
    );
  }

  // ── Permission gate ──────────────────────────────────────────────────────────
  if (!can_adjudicate && !isAdmin && !isOwner) {
    return (
      <DashboardLayout title="Consensus" description="Corpus-level consensus review">
        <PermissionGate permission="can_adjudicate">{null}</PermissionGate>
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
                        {valueIsEmpty(finalVal)
                          ? <span className="text-gray-300 dark:text-zinc-600 italic text-xs">empty</span>
                          : Array.isArray(finalVal)
                            ? (finalVal.every((x: any) => typeof x !== 'object' || x === null)
                                ? finalVal.join(', ')
                                : `${finalVal.length} row${finalVal.length === 1 ? '' : 's'}`)
                            : typeof finalVal === 'object'
                              ? JSON.stringify(finalVal)
                              : String(finalVal)}
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
                    {isAiOnly ? 'Review fields' : reviewedCount === totalDisputed && totalDisputed > 0 ? 'All conflicts resolved' : `Resolve ${totalDisputed - reviewedCount} conflict${totalDisputed - reviewedCount !== 1 ? 's' : ''}`}
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
                {/* Empty state — no extracted fields */}
                {fields.length === 0 && (
                  <div className="flex flex-col items-center justify-center text-center px-6 py-16">
                    <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-3">
                      <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                    </div>
                    <div className="text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-2">No extracted fields for this document</div>
                    <div className="max-w-[320px] flex flex-col gap-2">
                      <p className="text-xs text-gray-500 dark:text-zinc-500 leading-relaxed">
                        The extraction job ran but produced no field values. The most common cause is an LLM API error during extraction (rate limit, credit balance, or upstream model failure). The row was written empty.
                      </p>
                      <p className="text-[11px] text-gray-400 dark:text-zinc-500 leading-relaxed">
                        Re-run the extraction for this document from the Extractions page once the upstream issue is resolved.
                      </p>
                    </div>
                  </div>
                )}

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
                          id={`field-card-${realIdx}`}
                          fieldName={f.fieldName}
                          field={f.field}
                          sources={f.sources}
                          sourceMeta={f.sourceMeta}
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
                      id={`field-card-${realIdx}`}
                      fieldName={f.fieldName}
                      field={f.field}
                      sources={f.sources}
                      sourceMeta={f.sourceMeta}
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
                    : fields.length === 0
                    ? 'Nothing to review'
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
      const formatCsv = (v: any): string => {
        if (v == null) return '';
        if (Array.isArray(v)) {
          if (v.every(x => typeof x !== 'object' || x === null)) return v.join('; ');
          return JSON.stringify(v);
        }
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      };
      const rows = results.map((r, i) => {
        if (!r) return null;
        const row: string[] = [reviewedDocs[i].filename];
        fieldNames.forEach(f => {
          const d = r.field_decisions[f];
          const val = d?.final_value ?? d?.correction ?? '';
          row.push(formatCsv(val));
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
  // When any dual-reviewer assignments exist, unroled manual extractions should NOT
  // be counted under R1 Done — they belong to a role we can't determine without the DB.
  const hasDualReviewerAssignments = assignmentMap.size > 0 &&
    Array.from(assignmentMap.values()).some(r => !!r['reviewer_1'] || !!r['reviewer_2']);

  return (
    <DashboardLayout title="Consensus" description="Corpus-level consensus review">
      <div className="space-y-4" onClick={() => setActivePopover(null)}>
        {/* ── Card header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 pb-5">
          {/* Left: eyebrow + form name title + summary line */}
          <div className="min-w-0 flex-1">
            {loadingForms ? (
              <div className="h-8 flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading forms…
              </div>
            ) : selectedForm ? (
              <>
                <div className="text-2xl font-bold text-gray-900 dark:text-white leading-tight truncate">{selectedForm.form_name}</div>
              </>
            ) : (
              <>
                <div className="text-xl font-bold text-gray-400 dark:text-zinc-600">No active forms</div>
                <div className="text-sm text-gray-400 dark:text-zinc-600 mt-1">Create and activate a form to begin consensus review.</div>
              </>
            )}
          </div>

          {/* Right: Allocations shortcut + Export + Form picker */}
          <div className="flex items-center gap-2 shrink-0">
            {selectedProject && (isOwner || isAdmin || role === 'manager' || can_manage_assignments) && (
              <button
                onClick={e => { e.stopPropagation(); router.push(`/projects/${selectedProject.id}?tab=assignments`); }}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                Allocations
              </button>
            )}
            <button
              disabled={!summary || exporting}
              onClick={e => { e.stopPropagation(); exportFinalDataset(); }}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>

            {!loadingForms && forms.length > 0 && (
              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setFormPickerOpen(o => !o)}
                  className="flex items-center gap-2 h-9 pl-3 pr-2.5 text-xs bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#2a2a2a] rounded-lg hover:border-gray-400 dark:hover:border-[#3f3f3f] transition-colors text-gray-700 dark:text-zinc-300 max-w-[200px]"
                >
                  <span className="truncate">{selectedForm ? selectedForm.form_name : 'Select form'}</span>
                  <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform', formPickerOpen && 'rotate-180')} />
                </button>
                {formPickerOpen && (
                  <div className="absolute top-full right-0 mt-1 z-20 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#2a2a2a] rounded-xl shadow-lg overflow-hidden min-w-[220px]">
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
              </div>
            )}
          </div>
        </div>

        {/* ── Stats bar ─────────────────────────────────────────────────────────── */}
        {summary && (
          <div className="grid grid-cols-6 divide-x divide-gray-100 dark:divide-[#1f1f1f] rounded-xl overflow-hidden">
            {([
              { label: 'Papers',    value: summary.summary.total_docs,                                                                                         color: 'text-gray-700 dark:text-zinc-300',         bar: 'bg-gray-400' },
              { label: 'AI Done',   value: summary.summary.ai_done,                                                                                            color: 'text-blue-500 dark:text-blue-400',         bar: 'bg-blue-500' },
              { label: 'R1 Done',   value: hasDualReviewerAssignments ? summary.summary.r1_done : summary.summary.r1_done + summary.summary.manual_done,       color: 'text-orange-500 dark:text-orange-400',     bar: 'bg-orange-500' },
              { label: 'R2 Done',   value: summary.summary.r2_done,                                                                                            color: 'text-green-500 dark:text-green-400',       bar: 'bg-green-500' },
              { label: 'Consensus', value: totalDone || summary.summary.consensus_done,                                                                        color: 'text-emerald-700 dark:text-emerald-500',   bar: 'bg-emerald-600' },
              { label: 'Agreement', value: avgAgreement,                                                                                                       color: 'text-purple-500 dark:text-purple-400',     bar: 'bg-purple-500', suffix: '%' },
            ] as { label: string; value: number | null; color: string; bar: string; suffix?: string }[]).map(({ label, value, color, bar, suffix }) => {
              const hasValue = value !== null && value > 0;
              return (
                <div key={label} className="relative flex flex-col items-start gap-1.5 px-6 py-5">
                  <div className={cn('absolute inset-x-0 top-0 h-[3px]', hasValue ? bar : 'bg-transparent')} />
                  <span className={cn('text-2xl font-bold tabular-nums leading-none', hasValue ? color : 'text-gray-300 dark:text-zinc-700')}>
                    {value !== null ? `${value}${suffix ?? ''}` : '—'}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">{label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Loading state */}
        {selectedForm && loadingSummary && !summary && (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
          </div>
        )}

        {/* No active forms */}
        {!loadingForms && forms.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <FileText className="w-8 h-8 text-gray-300 dark:text-zinc-600" />
            <div className="text-center">
              <div className="text-sm font-semibold text-gray-500 dark:text-zinc-400">No active forms</div>
              <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Activate a form to start consensus review</div>
            </div>
          </div>
        )}

        {/* ── Search + Filter tabs ─────────────────────────────────────────────── */}
        {summary && (
          <div className="flex items-center gap-2 py-1" onClick={e => e.stopPropagation()}>
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
                const label = tab === 'all' ? 'All' : tab === 'needs_review' ? 'Needs review' : tab === 'disputed' ? 'Conflicts' : 'Done';
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
                    {label} {count}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Document table ───────────────────────────────────────────────────── */}
        {summary && filteredDocs.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">No documents match this filter</div>
        )}

        {summary && filteredDocs.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]">
            {/* Table header */}
            <div
              className="grid gap-3 px-5 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] rounded-t-xl"
              style={{ gridTemplateColumns: '1fr 52px 52px 52px 120px 130px 96px' }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Document</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">AI</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-orange-500 dark:text-orange-400">R1</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-green-500 dark:text-green-400">R2</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">
                Agreement
                <Tooltip side="bottom" align="end" className="rounded-xl shadow-xl border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a] text-gray-700 dark:text-zinc-300 text-[11px] p-3.5 w-56 whitespace-normal leading-relaxed" content="Cross-source agreement percentage across all available extractions.">
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
                const hasAnySource = doc.has_ai || doc.has_r1 || doc.has_r2 || doc.has_manual;
                const isLoading = loadingDocId === doc.document_id;
                const docAssignments = assignmentMap.get(doc.document_id) ?? {};

                const DotPopover = ({ role, color, present }: { role: string; color: string; present: boolean }) => {
                  const isOpen = activePopover?.docId === doc.document_id && activePopover.role === role;
                  const assignment = role !== 'ai' ? docAssignments[role] : undefined;
                  const adj = role !== 'ai' ? docAssignments['adjudicator'] : undefined;

                  const dotColor = role === 'ai'
                    ? (present ? 'bg-blue-500 border-blue-500' : 'bg-transparent border-blue-200 dark:border-blue-900')
                    : role === 'reviewer_1'
                      ? (present ? 'bg-orange-500 border-orange-500' : 'bg-transparent border-orange-300 dark:border-orange-800')
                      : (present ? 'bg-green-500 border-green-500' : 'bg-transparent border-green-300 dark:border-green-800');

                  const avatarColor = role === 'reviewer_1'
                    ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-500'
                    : 'bg-green-100 dark:bg-green-900/20 text-green-500';

                  return (
                    <div className="relative flex items-center">
                      <button
                        onClick={e => { e.stopPropagation(); setActivePopover(p => p?.docId === doc.document_id && p.role === role ? null : { docId: doc.document_id, role }); }}
                        className={cn('w-3 h-3 rounded-full border-2 transition-all hover:scale-125 focus:outline-none', dotColor)}
                      />
                      {isOpen && (
                        <div
                          className="absolute left-0 top-6 z-30 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-xl shadow-xl p-3.5 w-56 text-left"
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-2.5">
                            {role === 'ai' ? 'AI Extraction' : role === 'reviewer_1' ? 'Reviewer 1' : 'Reviewer 2'}
                          </div>

                          {role === 'ai' ? (
                            <>
                              <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-md',
                                present
                                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                  : 'bg-gray-100 dark:bg-[#2a2a2a] text-gray-500 dark:text-zinc-400'
                              )}>
                                {present ? 'Completed' : 'Pending'}
                              </span>
                              <div className="text-[11px] text-gray-400 dark:text-zinc-500 mt-2">Automated extraction by AI model</div>
                            </>
                          ) : assignment ? (
                            (() => {
                              const formEntry = selectedForm
                                ? assignment.form_details?.find(f => f.form_id === selectedForm.id)
                                : undefined;
                              const formStatus: 'completed' | 'in_progress' | 'pending' =
                                present
                                  ? 'completed'
                                  : assignment.status === 'pending' ? 'pending' : 'in_progress';
                              return (
                                <>
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', avatarColor)}>
                                      <User className="w-3.5 h-3.5" />
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-gray-800 dark:text-zinc-200 truncate">{assignment.name}</div>
                                    </div>
                                  </div>
                                  <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-md',
                                    formStatus === 'completed'   ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                                    : formStatus === 'in_progress' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                                    : 'bg-gray-100 dark:bg-[#2a2a2a] text-gray-500 dark:text-zinc-400'
                                  )}>
                                    {formStatus === 'completed' ? 'Completed' : formStatus === 'in_progress' ? 'In progress' : 'Pending'}
                                  </span>
                                  {assignment.completed_at && formStatus === 'completed' && (
                                    <div className="text-[10px] text-gray-400 dark:text-zinc-500 mt-1.5">
                                      {new Date(assignment.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </div>
                                  )}
                                </>
                              );
                            })()
                          ) : (
                            <div className="text-xs text-gray-400 dark:text-zinc-500">Unassigned</div>
                          )}

                          {role !== 'ai' && (
                            <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-[#2a2a2a] text-[11px] text-gray-400 dark:text-zinc-500">
                              Consensus reviewer:{' '}
                              <span className="font-semibold text-gray-700 dark:text-zinc-300">{adj?.name ?? 'Unassigned'}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <div
                    key={doc.document_id}
                    className={cn(
                      'grid gap-3 items-center px-5 py-3.5 transition-colors',
                      !hasAnySource ? 'opacity-40' : 'hover:bg-gray-50/40 dark:hover:bg-[rgba(255,255,255,0.01)]',
                      status.type === 'conflicts' && 'border-l-2 border-orange-400',
                      status.type === 'done'      && 'border-l-2 border-green-500',
                    )}
                    style={{ gridTemplateColumns: '1fr 52px 52px 52px 120px 130px 96px' }}
                  >
                    {/* Filename */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-600 flex-shrink-0" />
                        <span className="text-sm text-gray-800 dark:text-zinc-200 truncate">{doc.filename}</span>
                      </div>
                    </div>

                    {/* AI dot */}
                    <DotPopover role="ai"         color="blue"   present={!!doc.has_ai} />
                    {/* R1 dot: in dual-reviewer mode, only fill when role-tagged R1 data exists */}
                    {(() => {
                      const isDualReviewer = !!docAssignments['reviewer_1'] || !!docAssignments['reviewer_2'];
                      return <DotPopover role="reviewer_1" color="orange" present={isDualReviewer ? !!doc.has_r1 : docHasR1(doc)} />;
                    })()}
                    {/* R2 dot */}
                    <DotPopover role="reviewer_2" color="green"  present={!!doc.has_r2} />

                    {/* Agreement bar */}
                    <div className="flex items-center gap-2">
                      {pct !== null && pct !== undefined ? (
                        <>
                          <div className="w-16 h-1.5 rounded-full bg-gray-100 dark:bg-[#2a2a2a] overflow-hidden flex-shrink-0">
                            <div
                              className={cn('h-full rounded-full transition-all', pct >= 90 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500')}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={cn('text-xs font-semibold tabular-nums', pct >= 90 ? 'text-green-600 dark:text-green-400' : pct >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400')}>
                            {pct}%
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-zinc-700">—</span>
                      )}
                    </div>

                    {/* Status */}
                    <div>
                      {status.type === 'done' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-400/15 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> Done
                        </span>
                      ) : status.type === 'conflicts' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> {status.label}
                        </span>
                      ) : status.type === 'agree' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-400/15 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> All agree
                        </span>
                      ) : status.type === 'ai_only' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15 px-2 py-0.5 rounded-full">
                          AI only
                        </span>
                      ) : status.type === 'pending' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15 px-2 py-0.5 rounded-full">
                          <Clock className="w-3 h-3" /> In progress
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-zinc-700">—</span>
                      )}
                    </div>

                    {/* Action */}
                    <div>
                      {hasAnySource && (
                        <button
                          onClick={e => { e.stopPropagation(); openReview(doc); }}
                          disabled={isLoading || loadingDocId !== null}
                          className={cn(
                            'text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5',
                            status.type === 'done' || status.type === 'agree'
                              ? 'border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] bg-white dark:bg-[#111111]'
                              : 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white'
                          )}
                        >
                          {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                          {status.type === 'done' ? 'View' : status.type === 'ai_only' ? 'Verify' : 'Review'}
                          {status.type !== 'done' && status.type !== 'agree' && !isLoading && <ArrowRight className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

export default function ConsensusPro() {
  return (
    <Suspense>
      <ConsensusContent />
    </Suspense>
  );
}

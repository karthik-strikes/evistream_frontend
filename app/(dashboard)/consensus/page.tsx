'use client';

import { compareKey, NR_LABEL, NA_LABEL } from '@/lib/absence';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { DashboardLayout } from '@/components/layout';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProject } from '@/contexts/ProjectContext';
import { formsService, documentsService, resultsService, adjudicationService, assignmentsService } from '@/services';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { PermissionGate } from '@/components/ui/permission-gate';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import type { ConsensusSummary, ConsensusSummaryDoc, Form, FormField } from '@/types/api';
import { DocumentTags, TagFilterBar } from '@/components/documents/DocumentTags';
import { useTagFilter } from '@/hooks/useTagFilter';
import { docMatchesQuery } from '@/lib/documentTags';
import { flattenScalarFields, isTableField } from '../manual-extraction/_lib/fieldKinds';
import {
  ArrowLeft, ArrowRight, FileText, FolderOpen, GripVertical, Loader2, Search,
  CheckCircle2, Clock, AlertTriangle, Download, ChevronDown, ChevronRight, ChevronUp, Info, User, ClipboardList,
} from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Tooltip } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/ui';
import { RingChart } from './_components/RingChart';
import { AgreedFieldRow, UnifiedFieldCard, type EvidenceMeta } from './_components/UnifiedFieldCard';
import {
  decisionFromResolutionSource,
  isFieldResolved,
  isUnfilled,
  resolveField,
  type Decision,
  type SourceKey,
} from './_lib/resolve';
import { ROLE_COLORS, sourceColors, STATE_COLORS } from '@/lib/reviewerColors';

// react-pdf pulls in pdfjs-dist, which needs browser-only APIs (DOMMatrix,
// DOMRect). Lazy-load on the client, exactly as SourceEvidenceDrawer does.
const PdfHighlightViewer = dynamic(
  () => import('@/components/PdfHighlightViewer').then(m => m.PdfHighlightViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs italic text-gray-400 dark:text-zinc-600">
        Loading PDF viewer…
      </div>
    ),
  },
);

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'needs_review' | 'disputed' | 'done';
type Screen = 'dashboard' | 'review' | 'summary';

type SourceMeta = { source_text?: string; page?: number; section?: string };

interface FieldDecision {
  fieldName: string;
  field?: FormField;
  /** Unwrapped values, for display and for what gets saved. */
  sources: { ai?: any; r1?: any; r2?: any };
  /**
   * The same answers with their `{value, source_text, status}` envelopes intact,
   * used only for agreement comparison.
   *
   * Why both: `unwrap()` throws `status` away, so comparing unwrapped values
   * asked `compareKey` to distinguish a failed extraction from a genuine "not
   * reported" using nothing but the value text — the one distinction it exists to
   * make. Two cells that both faulted could read as two reviewers agreeing.
   * Display still wants the bare value, so the envelope rides alongside rather
   * than replacing it.
   */
  sourceCells: { ai?: any; r1?: any; r2?: any };
  sourceMeta?: { ai?: SourceMeta; r1?: SourceMeta; r2?: SourceMeta };
  agreed: boolean;
  suggestion?: { value: any; source: string; reason: string };
  decision: Decision | null;
  customValue: any;
  legacyCorrection: string;
  /**
   * The field's declared options. Carried so `resolveField` can recognise a form
   * author's own spelling of an absence — RoB2's "Not applicable" — as the claim
   * it is, without rewriting it to the generic token.
   */
  options?: string[] | null;
}

/** The per-document reviewer assignment map, keyed doc → role → who/when. */
type AssignmentInfo = {
  name: string;
  status: string;
  completed_at: string | null;
  form_details: Array<{ form_id: string; form_name: string; completed: boolean }>;
};
type AssignmentMap = Map<string, Record<string, AssignmentInfo>>;

/** Built in four places from the same rows; one function now. */
function buildAssignmentMap(rows: any[]): AssignmentMap {
  const map: AssignmentMap = new Map();
  for (const a of rows ?? []) {
    if (!map.has(a.document_id)) map.set(a.document_id, {});
    map.get(a.document_id)![a.reviewer_role] = {
      name: a.reviewer_name ?? 'Assigned',
      status: a.status,
      completed_at: a.completed_at,
      form_details: a.form_details ?? [],
    };
  }
  return map;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Do two sources say the same thing?
 *
 * Takes the raw `{value, source_text, status}` cell, not an unwrapped value —
 * `compareKey` reads `status` to keep a failed extraction from reading as
 * agreement with a genuine "not reported", and unwrapping first threw that away.
 * Mirrors `values_agree` in the backend's `utils/value_compare.py`.
 *
 * `isUnfilled` first: nothing-recorded is not a claim, so two blanks do not
 * agree — while two explicit NRs do.
 */
function valuesMatch(a: any, b: any): boolean {
  if (isUnfilled(unwrap(a)) || isUnfilled(unwrap(b))) return false;
  const ka = compareKey(a);
  const kb = compareKey(b);
  if (ka === null || kb === null) return false;
  return ka === kb;
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

/**
 * When some but not all sources agree, which value has the majority behind it.
 *
 * Takes envelopes (so the comparison keeps `status`) and returns the unwrapped
 * value, which is what actually gets saved. `reason` is rendered verbatim on the
 * majority bar — the affordance that made this function reachable at all; it had
 * been computed, stored and counted in the summary for a value the user could
 * never see or click.
 */
function computeSuggestion(cells: { ai?: any; r1?: any; r2?: any }): { value: any; source: string; reason: string } | undefined {
  const entries = (['ai', 'r1', 'r2'] as SourceKey[])
    .filter(k => !isUnfilled(unwrap(cells[k])))
    .map(k => ({ key: sourceColors(k).short, cell: cells[k] }));

  if (entries.length < 2) return undefined;

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (!valuesMatch(entries[i].cell, entries[j].cell)) continue;
      const agreeing = [entries[i].key, entries[j].key];
      for (let k = 0; k < entries.length; k++) {
        if (k !== i && k !== j && valuesMatch(entries[k].cell, entries[i].cell)) {
          agreeing.push(entries[k].key);
        }
      }
      return {
        value: unwrap(entries[i].cell),
        source: agreeing.join(' + '),
        reason: `${agreeing.join(' + ')} agree (${agreeing.length} of ${entries.length})`,
      };
    }
  }
  return undefined;
}

/**
 * The AI / R1 / R2 status dot in a document row, with its detail popover.
 *
 * Declared at module scope deliberately. It used to be defined *inside* the
 * `filteredDocs.map` callback, so React saw a brand-new component type for every
 * row on every render and remounted all of them — on every keystroke in the
 * search box, among other things.
 *
 * The popover also flips above the dot when there isn't room below. Fixed at
 * `top-6`, the last rows in a long list opened their popover past the bottom of
 * the card, where it was clipped.
 */
function DotPopover({
  role, present, assignment, adjudicatorName, isOpen, onToggle, onClose,
}: {
  role: 'ai' | 'reviewer_1' | 'reviewer_2';
  present: boolean;
  assignment?: AssignmentInfo;
  adjudicatorName?: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [flipUp, setFlipUp] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const rect = btnRef.current?.getBoundingClientRect();
    // ~230px of popover; open upward when that would run off the viewport.
    if (rect) setFlipUp(window.innerHeight - rect.bottom < 230);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const c = ROLE_COLORS[role];
  const roleLabel = role === 'ai' ? 'AI Extraction' : c.label;
  const formStatus: 'completed' | 'in_progress' | 'pending' =
    present ? 'completed' : assignment?.status === 'pending' ? 'pending' : 'in_progress';

  return (
    <div className="relative flex items-center">
      <button
        ref={btnRef}
        aria-label={`${roleLabel}: ${present ? 'completed' : 'pending'}`}
        aria-expanded={isOpen}
        onClick={e => { e.stopPropagation(); onToggle(); }}
        className={cn(
          'h-3 w-3 rounded-full border-2 transition-all hover:scale-125 focus:outline-none',
          present ? cn(c.dot, 'border-transparent') : cn('bg-transparent', c.border),
        )}
      />
      {isOpen && (
        <div
          className={cn(
            'absolute left-0 z-30 w-56 rounded-xl border border-gray-200 bg-white p-3.5 text-left shadow-xl dark:border-[#2a2a2a] dark:bg-[#1a1a1a]',
            flipUp ? 'bottom-6' : 'top-6',
          )}
          onClick={e => e.stopPropagation()}
        >
          <div className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
            {roleLabel}
          </div>

          {role === 'ai' ? (
            <>
              <span className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-semibold',
                present ? c.pill : 'bg-gray-100 text-gray-500 dark:bg-[#2a2a2a] dark:text-zinc-400',
              )}>
                {present ? 'Completed' : 'Pending'}
              </span>
              <div className="mt-2 text-[11px] text-gray-400 dark:text-zinc-500">Automated extraction by AI model</div>
            </>
          ) : assignment ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', c.pill)}>
                  <User className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-gray-800 dark:text-zinc-200">{assignment.name}</div>
                </div>
              </div>
              <span className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-semibold',
                formStatus === 'completed'
                  ? cn(STATE_COLORS.resolved.bg, STATE_COLORS.resolved.text)
                  : formStatus === 'in_progress'
                    ? cn(STATE_COLORS.active.bg, STATE_COLORS.active.text)
                    : 'bg-gray-100 text-gray-500 dark:bg-[#2a2a2a] dark:text-zinc-400',
              )}>
                {formStatus === 'completed' ? 'Completed' : formStatus === 'in_progress' ? 'In progress' : 'Pending'}
              </span>
              {assignment.completed_at && formStatus === 'completed' && (
                <div className="mt-1.5 text-[10px] text-gray-400 dark:text-zinc-500">
                  {new Date(assignment.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-gray-400 dark:text-zinc-500">Unassigned</div>
          )}

          {role !== 'ai' && (
            <div className="mt-3 border-t border-gray-100 pt-2.5 text-[11px] text-gray-400 dark:border-[#2a2a2a] dark:text-zinc-500">
              Consensus reviewer:{' '}
              <span className="font-semibold text-gray-700 dark:text-zinc-300">{adjudicatorName ?? 'Unassigned'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  /**
   * Document tags, keyed by document id.
   *
   * Fetched separately because the consensus summary payload is built from
   * extraction_results and carries no `labels`. Read from the documents endpoint
   * rather than widening that payload: tags are a property of the document, and
   * one more GET here beats a second place that has to remember to join them.
   */
  const [docTags, setDocTags] = useState<Record<string, string[]>>({});
  const { activeTags, toggleTag, clearTags, matchesTags } = useTagFilter();

  // Review state
  const [reviewDoc, setReviewDoc] = useState<ConsensusSummaryDoc | null>(null);
  const [fields, setFields] = useState<FieldDecision[]>([]);
  const [activeField, setActiveField] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingDocId, setLoadingDocId] = useState<string | null>(null);
  const [agreedCollapsed, setAgreedCollapsed] = useState(true);
  /**
   * The quote the PDF pane is showing.
   *
   * Replaces the old `pdfUrl` blob-URL state entirely: PdfHighlightViewer takes a
   * documentId and owns its own fetch and module-level blob cache, which also
   * retires the four separate revoke sites this page had — two of which could
   * revoke the same URL twice.
   */
  const [evidenceFocus, setEvidenceFocus] = useState<
    { source: SourceKey; fieldLabel: string; meta: EvidenceMeta; value: any } | null
  >(null);

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
  const [assignmentMap, setAssignmentMap] = useState<AssignmentMap>(new Map());
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
          const [summaryData, assignments, docs] = await Promise.all([
            resultsService.getConsensusSummary(selectedProject.id, preferred.id),
            assignmentsService.getProjectAssignments(selectedProject.id).catch(() => [] as any[]),
            documentsService.getAll(selectedProject.id).catch(() => [] as any[]),
          ]);
          setSummary(summaryData);
          setDocTags(Object.fromEntries((docs as any[]).map(d => [d.id, d.labels ?? []])));
          setAssignmentMap(buildAssignmentMap(assignments as any[]));
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
        .then((asgs: any[]) => setAssignmentMap(buildAssignmentMap(asgs)))
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedProject?.id, selectedForm?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setEvidenceFocus(null);
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
      setAssignmentMap(buildAssignmentMap(assignments as any[]));
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
      // No PDF fetch here any more — PdfHighlightViewer takes the documentId and
      // owns the download, the blocks sidecar and its own blob cache.
      setEvidenceFocus(null);

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
        // Envelopes for comparison, unwrapped values for display and saving.
        const sourceCells: FieldDecision['sourceCells'] = {};
        if (fn in normalizedAiData) sourceCells.ai = normalizedAiData[fn];
        if (fn in r1Data) sourceCells.r1 = r1Data[fn];
        if (fn in r2Data) sourceCells.r2 = r2Data[fn];

        const sources: FieldDecision['sources'] = {};
        for (const k of ['ai', 'r1', 'r2'] as SourceKey[]) {
          if (k in sourceCells) sources[k] = unwrap(sourceCells[k]);
        }

        // Agreement: ≥2 recorded sources matching (single-source is NOT auto-agreed)
        const presentCells = (['ai', 'r1', 'r2'] as SourceKey[])
          .filter(k => sourceCells[k] !== undefined && !isUnfilled(sources[k]))
          .map(k => sourceCells[k]);
        const agreed = presentCells.length >= 2 && presentCells.every(c => valuesMatch(c, presentCells[0]));

        const suggestion = (!agreed && presentCells.length >= 2) ? computeSuggestion(sourceCells) : undefined;

        let decision: Decision | null = agreed ? 'agreed' : null;
        let customValue: any = '';
        let legacyCorrection = '';

        if (existingDecisions[fn]) {
          const ed = existingDecisions[fn];
          if (ed.status === 'correct') decision = 'correct';
          else if (ed.status === 'incorrect') { decision = 'incorrect'; legacyCorrection = ed.correction ?? ''; }
          else if (ed.decision) {
            decision = ed.decision as Decision;
            if (ed.decision === 'custom') customValue = ed.final_value ?? '';
          }
        }
        if (existingResolutions[fn]) {
          // Every resolution_source now has a branch. `ai` and `majority` had
          // none, so a field settled by accepting AI came back undecided and
          // canSubmit() blocked the document from ever being re-saved.
          const res = existingResolutions[fn];
          const restored = decisionFromResolutionSource(res.resolution_source, res.final_value);
          if (restored) {
            decision = restored.decision;
            if (restored.customValue !== undefined) customValue = restored.customValue;
          } else if (res.agreed) {
            decision = 'agreed';
          }
        }

        const sm: FieldDecision['sourceMeta'] = {};
        for (const k of ['ai', 'r1', 'r2'] as SourceKey[]) {
          if (k in sourceCells) { const m = extractMeta(sourceCells[k]); if (m) sm[k] = m; }
        }
        built.push({
          fieldName: fn, field, sources, sourceCells,
          sourceMeta: Object.keys(sm).length ? sm : undefined,
          // The resolver needs the declared options to recognise a form author's
          // own spelling of an absence without rewriting it.
          options: field?.options,
          agreed, suggestion, decision, customValue, legacyCorrection,
        });
      }

      // Restore draft from localStorage
      const lsKey = `cdr:${selectedProject!.id}:${selectedForm.id}:${doc.document_id}`;
      try {
        const saved = localStorage.getItem(lsKey);
        if (saved) {
          const draft: Array<{ fieldName: string; decision: Decision | null; customValue: any; legacyCorrection: string }> = JSON.parse(saved);
          const draftMap = new Map(draft.map(d => [d.fieldName, d]));
          for (const b of built) {
            const d = draftMap.get(b.fieldName);
            if (d && d.decision !== null) {
              // Drafts written before the rename still say accept_suggestion.
              b.decision = d.decision === ('accept_suggestion' as Decision) ? 'accept_majority' : d.decision;
              b.customValue = d.customValue;
              b.legacyCorrection = d.legacyCorrection;
            }
          }
        }
      } catch {}

      // The NR/NA buttons are gone, so a stored or drafted `decision: 'nr'|'na'`
      // has no control to render — the reviewer would see a "Not reported" pill
      // above an empty card. Move them into the value editor, where absence now
      // lives. Placed after every restore (saved decisions, saved resolutions,
      // and the localStorage draft) so one loop covers all three sources.
      for (const b of built) {
        if (b.decision === 'nr') { b.decision = 'custom'; b.customValue = NR_LABEL; }
        else if (b.decision === 'na') { b.decision = 'custom'; b.customValue = NA_LABEL; }
      }

      // The NR/NA buttons are gone, so a stored or drafted `decision: 'nr'|'na'`
      // has no control to render — the reviewer would see a "Not reported" pill
      // above a card with nothing on it. Move them into the value editor, where
      // absence now lives. Placed after every restore (saved decisions, saved
      // resolutions, the localStorage draft) so one loop covers all three.
      for (const b of built) {
        if (b.decision === 'nr') { b.decision = 'custom'; b.customValue = NR_LABEL; }
        else if (b.decision === 'na') { b.decision = 'custom'; b.customValue = NA_LABEL; }
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
  const updateFieldDecision = (idx: number, decision: Decision) => {
    // Build the next array first and advance from *that*. The old version read
    // the pre-update `fields` closure right after setFields, so fast keyboard use
    // could pick the advance target from stale state.
    const next = fields.map((f, i) => {
      if (i !== idx) return f;
      if (decision === 'correct') return { ...f, decision, legacyCorrection: '' };
      return { ...f, decision };
    });
    setFields(next);

    // 'custom' and 'incorrect' open a text box that needs to keep focus, so they
    // stay put; everything else moves to the next field still awaiting a call.
    if (decision === 'custom' || decision === 'incorrect') {
      setActiveField(idx);
      return;
    }
    const visible = isAiOnly ? next : next.filter(f => !f.agreed);
    const order = visible.map(f => next.indexOf(f));
    const here = order.indexOf(idx);
    const upcoming = [...order.slice(here + 1), ...order.slice(0, Math.max(here, 0))];
    const target = upcoming.find(i => !isFieldResolved(next[i]));
    if (target !== undefined) {
      setActiveField(target);
      document.getElementById(`field-card-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      setActiveField(idx);
    }
  };

  // `any`, not `string`: the table and multi-select editors send arrays, so the
  // old annotation was simply false.
  const updateCustomValue = (idx: number, val: any) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, customValue: val } : f));
  };

  const updateCorrection = (idx: number, val: string) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, legacyCorrection: val } : f));
  };

  // ── Submit validation ──────────────────────────────────────────────────────────
  // Memoized: this was called three times per render. isFieldResolved also
  // requires a non-empty correction for 'incorrect', which submission used to
  // allow — and the resolver then saved the value the reviewer had just rejected.
  const canSubmit = useMemo(
    () => fields.length > 0 && fields.every(isFieldResolved),
    [fields],
  );

  // No keyboard shortcuts on this screen, by decision.
  //
  // There used to be a window-level keydown handler where a single unmodified
  // letter committed a decision to the active field — `a` accepted AI, `n` set
  // "not reported", and so on, with no confirmation and no undo beyond picking
  // again. That is a lot of authority for a keystroke on a screen whose output is
  // the study's canonical answer, and it fires whenever focus happens to be off
  // an input. Decisions are click-only now.
  //
  // If shortcuts come back, they should be opt-in and should not include the
  // keys that write a value.

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
    if (!canSubmit || !reviewDoc || !selectedForm) return;
    setSubmitting(true);
    try {
      // Resolve every field ONCE. `final_value` and `resolution_source` come out
      // of the same call, so they cannot disagree — they used to be two separate
      // decision trees, which is where the agreed-override and empty-correction
      // bugs lived. The counts come from the same pass too; the adjudication loop
      // used to compute a pair of counters and then throw them away.
      const resolved = fields.map(f => ({ f, r: resolveField(f) }));
      const agreedCount = resolved.filter(({ r }) => r.agreed).length;
      const disputedCount = resolved.length - agreedCount;

      // If R1/R2 data is involved, save adjudication
      if (hasR1R2) {
        const fieldResolutions: Record<string, any> = {};
        for (const { f, r } of resolved) {
          fieldResolutions[f.fieldName] = {
            reviewer_1_value: f.sources.r1 ?? '',
            reviewer_2_value: f.sources.r2 ?? '',
            agreed: r.agreed,
            final_value: r.finalValue,
            resolution_source: r.source,
          };
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

      for (const { f, r } of resolved) {
        if (isAiOnly) {
          fieldDecisions[f.fieldName] = {
            ai_value: f.sources.ai ?? '',
            status: f.decision === 'correct' ? 'correct' : f.decision === 'incorrect' ? 'incorrect' : null,
            correction: f.legacyCorrection || null,
            // `decision` was missing from this shape, and the restore path needs
            // it for anything that isn't correct/incorrect — so nr / na / custom
            // on an AI-only document came back as "Pending" on reopen.
            decision: f.decision,
            resolution_source: r.source,
            final_value: r.finalValue,
          };
        } else {
          fieldDecisions[f.fieldName] = {
            ai_value: f.sources.ai ?? '',
            r1_value: f.sources.r1 ?? null,
            r2_value: f.sources.r2 ?? null,
            decision: f.decision,
            resolution_source: r.source,
            final_value: r.finalValue,
          };
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
        if (freshAsgs.status === 'fulfilled') setAssignmentMap(buildAssignmentMap(freshAsgs.value as any[]));
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

  const goBackToDashboard = () => {
    setEvidenceFocus(null);
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
    const acceptSuggestion = reviewedFields.filter(f => f.decision === 'accept_majority').length;
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
                  {lastReviewDoc.study_label || lastReviewDoc.filename} · {selectedForm?.form_name}
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
                const finalVal = resolveField(f).finalValue;
                const decisionLabel =
                  f.decision === 'accept_ai' ? 'Accepted AI' :
                  f.decision === 'accept_r1' ? 'Accepted R1' :
                  f.decision === 'accept_r2' ? 'Accepted R2' :
                  f.decision === 'accept_majority' ? 'Accepted majority' :
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
                        {isUnfilled(finalVal)
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

    // Progress: for AI-only mode count all fields, else count disputed.
    // Counted with isFieldResolved, so a half-finished "needs correction" no
    // longer reads as reviewed while submission is still blocked on it.
    const reviewPool = isAiOnly ? fields : disputedFields;
    const reviewedCount = reviewPool.filter(isFieldResolved).length;
    const progressDenominator = reviewPool.length;
    const progressPct = progressDenominator > 0 ? (reviewedCount / progressDenominator) * 100 : 0;
    const remaining = progressDenominator - reviewedCount;

    return (
      <DashboardLayout title="Consensus" description="Corpus-level consensus review" fullHeight>
        {/* Header */}
        <div className="mb-3 flex flex-shrink-0 items-center gap-2">
          <button
            onClick={goBackToDashboard}
            className="flex cursor-pointer items-center gap-1.5 border-none bg-transparent text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <span className="text-xs text-gray-300 dark:text-zinc-700">·</span>
          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-[#1a1a1a] dark:text-zinc-400">{selectedForm?.form_name}</span>
          <span className="text-xs text-gray-300 dark:text-zinc-700">·</span>
          <span className="max-w-[200px] truncate rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-[#1a1a1a] dark:text-zinc-400" title={reviewDoc.filename}>{reviewDoc.study_label || reviewDoc.filename}</span>
          <span className="text-xs text-gray-300 dark:text-zinc-700">·</span>
          <span className="text-xs text-gray-400 dark:text-zinc-500">{totalFields} fields · {totalDisputed} need review</span>
          <div className="flex-1" />
          <span className="text-xs font-semibold tabular-nums text-gray-500 dark:text-zinc-400">
            {reviewedCount} of {progressDenominator} resolved
          </span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-gray-100 dark:bg-[#1a1a1a]">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                remaining === 0 ? 'bg-emerald-500' : 'bg-gray-800 dark:bg-zinc-300',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* min-h-0 + the layout's fullHeight is what replaced `calc(100vh - 160px)`:
            the panes now measure themselves instead of assuming a navbar height. */}
        <PanelGroup orientation="horizontal" className="min-h-0 flex-1 gap-0">
          {/* Source document */}
          <Panel defaultSize={54} minSize={30}>
            <div className="h-full min-h-0">
              <PdfHighlightViewer
                documentId={reviewDoc.document_id}
                filename={reviewDoc.study_label || reviewDoc.filename}
                sourceText={evidenceFocus?.meta.source_text ?? null}
                initialPage={evidenceFocus?.meta.page ?? null}
                storedValue={
                  evidenceFocus ? (typeof evidenceFocus.value === 'string' ? evidenceFocus.value : JSON.stringify(evidenceFocus.value)) : null
                }
                fieldLabel={
                  evidenceFocus ? `${evidenceFocus.fieldLabel} · ${sourceColors(evidenceFocus.source).label}` : null
                }
              />
            </div>
          </Panel>

          <PanelResizeHandle className="group mx-1 flex w-2 cursor-col-resize items-center justify-center">
            <div className="flex h-full w-1 items-center justify-center rounded-full bg-gray-200 transition-colors group-hover:bg-gray-400 dark:bg-[#2a2a2a] dark:group-hover:bg-zinc-600">
              <GripVertical className="h-4 w-4 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </PanelResizeHandle>

          {/* Fields */}
          <Panel defaultSize={46} minSize={25}>
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
              {/* Panel title */}
              <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-4 py-2.5 dark:border-[#1f1f1f]">
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {isAiOnly
                    ? 'Review fields'
                    : remaining === 0 && progressDenominator > 0
                      ? 'All conflicts resolved'
                      : `Resolve ${remaining} conflict${remaining === 1 ? '' : 's'}`}
                </span>
                <span className="text-xs tabular-nums text-gray-400 dark:text-zinc-500">
                  {reviewedCount}/{progressDenominator}
                </span>
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

                {/* Fields every source agreed on — one quiet line each, not cards. */}
                {agreedFields.length > 0 && !isAiOnly && (
                  <div>
                    <button
                      onClick={() => setAgreedCollapsed(c => !c)}
                      className="flex w-full items-center gap-2 border-b border-gray-100 bg-gray-50/60 px-4 py-2.5 text-left transition-colors hover:bg-gray-100/60 dark:border-[#1a1a1a] dark:bg-[#0a0a0a] dark:hover:bg-[#141414]"
                    >
                      {agreedCollapsed
                        ? <ChevronRight className="h-3 w-3 text-gray-400" />
                        : <ChevronDown className="h-3 w-3 text-gray-400" />}
                      <span className={cn('flex h-4 w-4 items-center justify-center rounded-full', STATE_COLORS.resolved.bg, STATE_COLORS.resolved.text)}>
                        <CheckCircle2 className="h-3 w-3" />
                      </span>
                      <span className="text-xs font-semibold text-gray-500 dark:text-zinc-400">
                        {agreedFields.length} field{agreedFields.length === 1 ? '' : 's'} agree — no action needed
                      </span>
                    </button>
                    {!agreedCollapsed && agreedFields.map(f => {
                      const realIdx = fields.indexOf(f);
                      return (
                        <AgreedFieldRow
                          key={realIdx}
                          fieldName={f.fieldName}
                          field={f.field}
                          sources={f.sources}
                          decision={f.decision}
                          customValue={f.customValue}
                          onDecision={d => updateFieldDecision(realIdx, d)}
                          onCustomValue={v => updateCustomValue(realIdx, v)}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Fields that need a decision */}
                {(isAiOnly ? fields : disputedFields).map(f => {
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
                      onDecision={d => updateFieldDecision(realIdx, d)}
                      onCustomValue={v => updateCustomValue(realIdx, v)}
                      onCorrection={v => updateCorrection(realIdx, v)}
                      isActive={activeField === realIdx}
                      onClick={() => setActiveField(realIdx)}
                      onJumpToEvidence={(source, meta) => {
                        setActiveField(realIdx);
                        setEvidenceFocus({
                          source,
                          fieldLabel: f.field?.display_name || f.fieldName.replace(/_/g, ' '),
                          meta,
                          value: f.sources[source],
                        });
                      }}
                    />
                  );
                })}
              </div>

              {/* Submit */}
              <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3 dark:border-[#1f1f1f]">
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !canSubmit}
                  className={cn(
                    'w-full rounded-lg py-2.5 text-sm font-bold transition-colors',
                    canSubmit && !submitting
                      ? 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white'
                      : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-[#1a1a1a] dark:text-zinc-600',
                  )}
                >
                  {submitting
                    ? 'Saving…'
                    : fields.length === 0
                    ? 'Nothing to review'
                    : !canSubmit
                    ? `${remaining} decision${remaining === 1 ? '' : 's'} left`
                    : (reviewDoc.has_consensus || reviewDoc.has_adjudication)
                    ? 'Update consensus'
                    : 'Submit consensus'}
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

      const header = ['document', 'ref_id', ...fieldNames];
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
        const row: string[] = [reviewedDocs[i].study_label || reviewedDocs[i].filename, String(reviewedDocs[i].ref_id ?? '')];
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
  const searchedDocs = sortedDocs.filter(
    d =>
      docMatchesQuery([d.study_label, d.filename], docTags[d.document_id], searchQuery) &&
      matchesTags(docTags[d.document_id]),
  );
  const filteredDocs = filterDocs(searchedDocs, filterTab);

  /**
   * Documents finished, counted once each.
   *
   * This used to be `consensus_done + adjudication_done`, and a dual-reviewer
   * submit writes BOTH rows — so four finished papers displayed as "Consensus 8",
   * a number that can exceed the paper count. The backend now returns `docs_done`
   * (has_consensus OR a *completed* adjudication); the fallback keeps this correct
   * against an API that hasn't been redeployed yet, since a consensus row is
   * always written.
   */
  const docsDone = summary?.summary.docs_done ?? summary?.summary.consensus_done ?? 0;
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
              // Role tiles read their hue from lib/reviewerColors, so a role is
              // the same colour here as in the field cards, the queue and the
              // allocation views. Only the non-role tiles carry literals.
              { label: 'Papers',    value: summary.summary.total_docs,                                                                                         color: 'text-gray-700 dark:text-zinc-300',         bar: 'bg-gray-400' },
              { label: 'AI Done',   value: summary.summary.ai_done,                                                                                            color: ROLE_COLORS.ai.text,                        bar: ROLE_COLORS.ai.dot },
              { label: 'R1 Done',   value: hasDualReviewerAssignments ? summary.summary.r1_done : summary.summary.r1_done + summary.summary.manual_done,       color: ROLE_COLORS.reviewer_1.text,                bar: ROLE_COLORS.reviewer_1.dot },
              { label: 'R2 Done',   value: summary.summary.r2_done,                                                                                            color: ROLE_COLORS.reviewer_2.text,                bar: ROLE_COLORS.reviewer_2.dot },
              { label: 'Consensus', value: docsDone,                                                                                                          color: STATE_COLORS.resolved.text,                 bar: 'bg-emerald-600' },
              // Agreement is a metric, not a role or a state — neutral, so it
              // doesn't read as "R2" (purple) or "done" (green).
              { label: 'Agreement', value: avgAgreement,                                                                                                       color: 'text-gray-900 dark:text-white',            bar: 'bg-gray-800 dark:bg-zinc-300', suffix: '%' },
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
                placeholder="Search documents or tags..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-8 pl-8 pr-3 text-xs rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-zinc-600 w-48"
              />
            </div>
            <TagFilterBar activeTags={activeTags} onToggleTag={toggleTag} onClear={clearTags} />
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
              <span className={cn('text-[11px] font-semibold uppercase tracking-wide', ROLE_COLORS.ai.text)}>AI</span>
              <span className={cn('text-[11px] font-semibold uppercase tracking-wide', ROLE_COLORS.reviewer_1.text)}>R1</span>
              <span className={cn('text-[11px] font-semibold uppercase tracking-wide', ROLE_COLORS.reviewer_2.text)}>R2</span>
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

                const dotFor = (role: 'ai' | 'reviewer_1' | 'reviewer_2', present: boolean) => (
                  <DotPopover
                    role={role}
                    present={present}
                    assignment={role === 'ai' ? undefined : docAssignments[role]}
                    adjudicatorName={docAssignments['adjudicator']?.name}
                    isOpen={activePopover?.docId === doc.document_id && activePopover.role === role}
                    onToggle={() => setActivePopover(p =>
                      p?.docId === doc.document_id && p.role === role ? null : { docId: doc.document_id, role },
                    )}
                    onClose={() => setActivePopover(null)}
                  />
                );

                return (
                  <div
                    key={doc.document_id}
                    className={cn(
                      'grid gap-3 items-center px-5 py-3.5 transition-colors',
                      !hasAnySource ? 'opacity-40' : 'hover:bg-gray-50/40 dark:hover:bg-[rgba(255,255,255,0.01)]',
                      // Amber = needs you, emerald = settled. Orange used to mean
                      // "conflicts" here while also meaning R1 two columns over.
                      status.type === 'conflicts' && 'border-l-2 border-amber-500',
                      status.type === 'done'      && 'border-l-2 border-emerald-500',
                    )}
                    style={{ gridTemplateColumns: '1fr 52px 52px 52px 120px 130px 96px' }}
                  >
                    {/* Filename */}
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-600 flex-shrink-0" />
                        <span className="min-w-0 text-sm text-gray-800 dark:text-zinc-200 truncate" title={doc.filename}>{doc.study_label || doc.filename}</span>
                        <DocumentTags
                          labels={docTags[doc.document_id]}
                          activeTags={activeTags}
                          onToggleTag={toggleTag}
                        />
                      </div>
                    </div>

                    {/* AI dot */}
                    {dotFor('ai', !!doc.has_ai)}
                    {/* R1 dot: in dual-reviewer mode, only fill when role-tagged R1 data exists */}
                    {(() => {
                      const isDualReviewer = !!docAssignments['reviewer_1'] || !!docAssignments['reviewer_2'];
                      return dotFor('reviewer_1', isDualReviewer ? !!doc.has_r1 : docHasR1(doc));
                    })()}
                    {/* R2 dot */}
                    {dotFor('reviewer_2', !!doc.has_r2)}

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

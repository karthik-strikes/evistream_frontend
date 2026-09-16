'use client';

import { isFailure } from '@/lib/absence';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { DashboardLayout } from '@/components/layout';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useProject } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState } from '@/components/ui';
import { FolderOpen } from 'lucide-react';
import { documentsService, formsService, resultsService, assignmentsService } from '@/services';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { PermissionGate } from '@/components/ui/permission-gate';
import type { Document, Form, ReviewAssignment } from '@/types/api';

import { SelectionView } from './_components/SelectionView';
import { ExtractionView } from './_components/ExtractionView';
import { MyQueueView, formStatusBucket, type FormState } from './_components/MyQueueView';
import type { ExtractionMode } from './_components/ExtractionToolbar';
import { useDraftAutoSave } from './_hooks/useDraftAutoSave';
import { useExtractionKeyboard } from './_hooks/useExtractionKeyboard';
import { isTableField, flattenScalarFields, isRequiredField, type AiTablePrefill } from './_lib/fieldKinds';
import { SCOPE_ROW, scopeOf } from '@/lib/fieldScopes';
import { reachableCellFilter, spreadSharedSources } from './_lib/linkedGroups';
import {
  remapAiPrefill, remapKeySet, remapRows, remapSources, rowsRemoved, type RowRemap,
} from './_lib/rowMoves';
import { SourcingProvider, type SourcingValue } from './_lib/SourcingContext';
import {
  applySources, pruneSources, unsourcedKeys, describeKey,
  evidencedKeys, sourcesFromSaved, aiEvidenceFromRow, resolveAiEvidence,
  boxesFromLocation,
  type SourceMap, type AttachedSource, type EvidenceBoxes,
} from './_lib/sourcing';
import type { SelectedQuote, SourceMarker } from '@/components/PdfHighlightViewer';
import { buildLabelMap } from '@/lib/documentLabel';

/** How long after the last keystroke in-progress work is pushed to the server.
 *  Long enough not to post on every character, short enough that a reviewer who
 *  closes the laptop mid-study loses nothing. */
const DRAFT_DEBOUNCE_MS = 3500;

/** Normalize AI extraction keys: strip '.value' suffix, preserve arrays for table fields */
function normalizeAiData(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(raw)) {
    const cleanKey = key.endsWith('.value') ? key.slice(0, -6) : key;
    if (Array.isArray(val)) {
      out[cleanKey] = val;
    } else if (typeof val === 'object' && val !== null) {
      if ('value' in val && Array.isArray((val as any).value)) {
        out[cleanKey] = (val as any).value;
      } else if (isFailure((val as any)?.status)) {
        // A cell the pipeline failed on must NOT prefill as "NR": the reviewer
        // would be signing their name to an assertion that the paper is silent.
        // Leave it blank so it reads as unanswered.
        out[cleanKey] = '';
      } else {
        const extracted = (val as any)?.final_value ?? (val as any)?.value;
        if (extracted == null) {
          out[cleanKey] = '';
        } else if (typeof extracted === 'object') {
          // Doubly-nested — give up rather than render [object Object]
          out[cleanKey] = '';
        } else {
          out[cleanKey] = String(extracted);
        }
      }
    } else {
      out[cleanKey] = val;
    }
  }
  return out;
}

/**
 * Flatten a *saved* row's table cells to display strings.
 *
 * `normalizeAiData` unwraps scalars but hands a table field's row array back
 * untouched — the per-cell unwrap lives separately inside `loadAiData`'s own
 * table loop. So reusing only `normalizeAiData` for a saved extraction left
 * every table cell as a `{value, source_text, provenance}` object and the grid
 * rendered blank, while scalars restored correctly. Exactly the Mehlisch 2010a
 * report: the age band came back, the outcomes table did not.
 */
function unwrapSavedTables(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(data)) {
    if (!Array.isArray(val)) { out[key] = val; continue; }
    out[key] = val.map(row => {
      if (!row || typeof row !== 'object') return row;
      const flat: Record<string, string> = {};
      for (const [col, cell] of Object.entries(row)) {
        if (cell != null && typeof cell === 'object') {
          const c = cell as any;
          // A cell the pipeline failed on must not prefill as a value — the
          // same rule normalizeAiData applies to scalars.
          if (isFailure(c?.status)) { flat[col] = ''; continue; }
          const v = 'final_value' in c ? c.final_value : c.value;
          flat[col] = v == null || typeof v === 'object' ? '' : String(v);
        } else {
          flat[col] = cell == null ? '' : String(cell);
        }
      }
      return flat;
    });
  }
  return out;
}

/** One string standing for "the work currently on screen" — the values *and*
 *  the quotes attached to them. `sources` has to be in it: attaching a quote
 *  changes no value, so a snapshot of `formData` alone reads a newly cited
 *  cell as saved. Used for the dirty check and for the draft signature, which
 *  must agree or Back prompts about work the autosave already pushed. */
const snapshotOf = (data: Record<string, any>, srcs: SourceMap): string =>
  JSON.stringify([data, srcs]);

/**
 * Is there anything on this form at all?
 *
 * Worth asking because a full save of a blank form is a *deliberate clear*
 * server-side — `merge_extracted_data` reads blanks on a non-partial save as
 * "the reviewer emptied this" and overwrites what is stored. That is the right
 * rule (it is the only way to retract an answer), but it used to be unreachable
 * by accident: every field counted as required, so an empty form failed
 * validation before it could be sent. Nothing on a live form declares
 * `required`, so once that was corrected, one stray Ctrl+S on a finished study
 * would wipe it and still leave the assignment marked complete.
 */
function isFormBlank(data: Record<string, any>): boolean {
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    if (Array.isArray(value)) {
      const anyCell = value.some(row =>
        row && typeof row === 'object'
          ? Object.values(row).some(v => String(v ?? '').trim() !== '')
          : String(row ?? '').trim() !== '',
      );
      if (anyCell) return false;
      continue;
    }
    if (String(value ?? '').trim() !== '') return false;
  }
  return true;
}

/**
 * Take the AI's answers back off the form without taking the reviewer's.
 *
 * Switching to Blind used to blank every AI-prefilled field and empty every
 * prefilled table outright, so a value the reviewer had typed over the model's
 * and rows they had added themselves went with it — no prompt, no undo. A cell
 * that no longer holds what the AI extracted is the reviewer's own assertion
 * and stays; only the model's own words are cleared, and a row left completely
 * empty was pure AI content, so it goes.
 */
function stripAiValues(
  data: Record<string, any>,
  aiOriginal: Record<string, any>,
): { data: Record<string, any>; remaps: Record<string, RowRemap> } {
  const same = (a: any, b: any) => String(a ?? '').trim() === String(b ?? '').trim();
  const filled = (row: any) =>
    !row || typeof row !== 'object' || Object.values(row).some(v => String(v ?? '').trim() !== '');
  const out: Record<string, any> = { ...data };
  // Dropping a row moves every row under it, and the reviewer's quotes are keyed
  // by position — so this path owes a remap exactly like a delete does. Without
  // one, switching to Blind after an edit re-pointed the citations a row up.
  const remaps: Record<string, RowRemap> = {};

  for (const [key, aiVal] of Object.entries(aiOriginal)) {
    if (Array.isArray(aiVal)) {
      const cur = out[key];
      if (!Array.isArray(cur)) continue;
      const cleared = cur.map((row, i) => {
        const aiRow = aiVal[i];
        if (!row || typeof row !== 'object' || !aiRow || typeof aiRow !== 'object') return row;
        const next: Record<string, string> = { ...row };
        for (const [col, aiCell] of Object.entries(aiRow)) {
          if (same(next[col], aiCell)) next[col] = '';
        }
        return next;
      });
      const dropped = cleared.map((row, i) => (filled(row) ? -1 : i)).filter(i => i >= 0);
      out[key] = cleared.filter(filled);
      if (dropped.length) remaps[key] = rowsRemoved(dropped);
      continue;
    }
    if (same(out[key], aiVal)) out[key] = '';
  }
  return { data: out, remaps };
}

function ManualExtractionContent() {
  const { toast } = useToast();
  const { selectedProject } = useProject();
  const { currentUser } = useAuth();
  const { isOwner, isAdmin, role, can_manage_assignments, can_create_forms } = useProjectPermissions();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<'select' | 'extract'>('select');
  const [currentPage, setCurrentPage] = useState<number | null>(null);

  const [documents, setDocuments] = useState<Document[]>([]);
  // Every list on this screen is filtered to `completed` documents, but a study
  // ID's a/b suffix is a whole-project computation: label from a subset and a
  // second "Mehlisch 2010" that is still processing makes this screen show a
  // bare "Mehlisch 2010" while Documents shows "Mehlisch 2010a". Keep the
  // unfiltered list purely to build the label map.
  const [allDocuments, setAllDocuments] = useState<Document[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  /**
   * The role this sitting is being extracted as.
   *
   * Held explicitly rather than looked up per document, because the queue
   * offers a *row per role* (R1 work, Adjudication waiting) while the lookup
   * could only ever return one role for a document. A reviewer who held both
   * therefore opened the adjudication row and saved as R1. The queue now says
   * which role it started, and every load and save uses that answer.
   */
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [selectedForm, setSelectedForm] = useState<Form | null>(null);
  const [savingGrouping, setSavingGrouping] = useState<string | null>(null);
  const [formSearch, setFormSearch] = useState('');
  const [docSearch, setDocSearch] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const [starting, setStarting] = useState(false);

  const [formData, setFormData] = useState<Record<string, any>>({});
  const savedSnapshotRef = useRef<string>('');
  /** The snapshot as it stands right now, kept in a ref.
   *
   *  `confirmDiscard` and the beforeunload guard both need "is anything
   *  unsaved?" at the moment they run, not at the moment they were built.
   *  Closing over `formData` rebuilt them on every keystroke, and that churned
   *  the identity of everything downstream of them — as far as the queue rail's
   *  `onSelectDoc`. */
  const liveSnapshotRef = useRef<string>('');
  const [saving, setSaving] = useState(false);
  const [aiPrefilledKeys, setAiPrefilledKeys] = useState<Set<string>>(new Set());
  // The values the AI actually prefilled, kept so "did the reviewer change this?"
  // is answerable without asking the server. `aiPrefilledKeys` says *which*
  // fields were prefilled; deciding whether a cell owes a source needs the
  // original *value* too.
  const [aiOriginal, setAiOriginal] = useState<Record<string, any>>({});
  // The AI extraction row exactly as stored, kept for its quotes: normalizeAiData
  // throws the evidence away, and the reviewer needs it to check a prefilled value.
  const [aiRawRow, setAiRawRow] = useState<Record<string, any> | null>(null);
  // Reviewer-attached source quotes, keyed by field / field[row].column.
  const [sources, setSources] = useState<SourceMap>({});
  const [activeSourceKey, setActiveSourceKey] = useState<string | null>(null);
  // The saved quote currently being shown in the PDF, set by clicking a "p.N"
  // chip. Separate from `activeSourceKey` (the attach target) because reading
  // your own evidence back and pointing at new evidence are different acts.
  const [activeQuote, setActiveQuote] = useState<
    {
      text: string;
      page: number | null;
      figureImage: string | null;
      /** Stored rectangles, when the evidence has them — this is what makes a
       *  drawn box, and a citation on a scanned page, visible again. */
      boxes: EvidenceBoxes | null;
    } | null
  >(null);
  // Armed by the viewer's "Box" toggle: drag to draw instead of selecting text.
  const [regionMode, setRegionMode] = useState(false);
  const shownQuoteRef = useRef<string>('');
  // Draft autosave — replaces the old "Save partial" button. `rowComplete` is the
  // one thing it must respect: a finished row is not a draft.
  const [rowComplete, setRowComplete] = useState(false);
  // Whether the server already holds a row for this doc+form+role. The browser
  // draft is only a crash fallback and must lose to it — see useDraftAutoSave.
  const [hasServerRow, setHasServerRow] = useState(false);
  /** When the stored row was last written — the other half of the draft
   *  comparison. Only answerable since `extraction_results.updated_at` existed
   *  (migrations/add_updated_at_to_extraction_results.sql). */
  const [serverSavedAt, setServerSavedAt] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<'off' | 'idle' | 'saving' | 'saved' | 'error'>('off');
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const draftScopeRef = useRef<string>('');
  const draftSigRef = useRef<string>('');
  // Whether the change on screen came from the reviewer rather than from the
  // page itself. AI-assisted prefill and a reopen both rewrite `formData`
  // wholesale, and neither is work worth saving on their behalf.
  const userTouchedRef = useRef(false);
  // Cells whose *saved* row already records evidence (inherited / reanchored /
  // reviewer-supplied / absence). Kept apart from `sources`, which is only the
  // quotes attached in this sitting: reposting an inherited quote as a reviewer
  // selection would relabel the AI's evidence as human-selected.
  const [savedEvidence, setSavedEvidence] = useState<Set<string>>(new Set());
  const [aiPrefilledTablePrefill, setAiPrefilledTablePrefill] = useState<Record<string, AiTablePrefill>>({});
  const [tableErrors, setTableErrors] = useState<Record<string, Record<number, Set<string>>>>({});

  const [extractionMode, setExtractionMode] = useState<ExtractionMode>(() => {
    if (typeof window !== 'undefined') {
      return (sessionStorage.getItem('evistream:extractionMode') as ExtractionMode) || 'blind';
    }
    return 'blind';
  });

  const [queueOpen, setQueueOpen] = useState(false);
  const [doneDocs, setDoneDocs] = useState<Set<string>>(new Set());
  const [partialDocs, setPartialDocs] = useState<Set<string>>(new Set());
  const [aiAvailableDocs, setAiAvailableDocs] = useState<Set<string>>(new Set());
  /** Whether the AI-availability answer has actually come back. Without it an
   *  empty `aiAvailableDocs` is ambiguous — "no AI" and "not asked yet" look
   *  identical, and the mode guard below would fire on every first render. */
  const [aiStatusLoaded, setAiStatusLoaded] = useState(false);
  const [myAssignments, setMyAssignments] = useState<ReviewAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  /** Assignment id whose status is being written, so one row can show a spinner. */
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  // `role:docId` → formId → state, built from this reviewer's OWN rows. Keyed
  // by role because the queue lists one row per (role, paper).
  const [myFormStatusByDoc, setMyFormStatusByDoc] = useState<Map<string, Map<string, FormState>>>(new Map());
  const [view, setView] = useState<'queue' | 'browse'>('queue');
  const [startingKey, setStartingKey] = useState<string | null>(null);

  /**
   * Fallback role per document, for the paths with no row to ask (browse mode,
   * a deep link). A reviewer row wins over an adjudicator one so this is
   * deterministic — it used to keep whichever assignment came last in the list
   * — and it matches the order the save endpoint resolves an omitted role in.
   * When the queue knows the role, `activeRole` is used instead.
   */
  const myRoleByDoc = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of myAssignments) {
      if (a.status === 'skipped') continue;
      const held = m.get(a.document_id);
      if (held && held !== 'adjudicator') continue;
      m.set(a.document_id, a.reviewer_role);
    }
    return m;
  }, [myAssignments]);

  const { clearDraft } = useDraftAutoSave(
    selectedForm?.id, selectedDoc?.id, formData, setFormData, mode === 'extract',
    !hasServerRow, serverSavedAt, sources, setSources,
  );

  useEffect(() => {
    liveSnapshotRef.current = snapshotOf(formData, sources);
  }, [formData, sources]);

  useEffect(() => {
    sessionStorage.setItem('evistream:extractionMode', extractionMode);
  }, [extractionMode]);

  // One map, passed down to every child — never recomputed from a child's own
  // (filtered) `documents` prop.
  const docLabels = useMemo(() => buildLabelMap(allDocuments), [allDocuments]);

  useEffect(() => {
    if (selectedProject) {
      setLoadingData(true);
      Promise.all([
        formsService.getAll(selectedProject.id),
        documentsService.getAll(selectedProject.id),
      ]).then(([f, d]) => {
        setForms(f.filter((x: any) => x.status === 'active'));
        setAllDocuments(d);
        setDocuments(d.filter((x: any) => x.processing_status === 'completed'));
      }).catch(() => {
        toast({ title: 'Error', description: 'Failed to load forms and documents', variant: 'error' });
      }).finally(() => setLoadingData(false));

      setLoadingAssignments(true);
      assignmentsService.getMyAssignments({ projectId: selectedProject.id })
        .then(asgs => setMyAssignments(asgs))
        .catch(() => setMyAssignments([]))
        .finally(() => setLoadingAssignments(false));
    }
    // Keyed on the project *id*, never the object.
    //
    // ProjectContext hydrates from localStorage and then refetches /projects,
    // replacing every project object with an equal-but-new one. Any effect
    // keyed on the object therefore ran a second time the moment that response
    // landed — measured on a live load: /projects returned at 743ms and forms,
    // documents, assignments and results/status all refired at 774ms. Same
    // data, twice, and on a real network that is seconds.
  }, [selectedProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh roles when window regains focus (e.g. after admin reassigns mid-session)
  useEffect(() => {
    if (!selectedProject) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      assignmentsService.getMyAssignments({ projectId: selectedProject.id })
        .then(asgs => setMyAssignments(asgs))
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default to "browse" if user has no assignments after assignments load resolves
  useEffect(() => {
    if (!loadingAssignments && myAssignments.length === 0) setView('browse');
    if (!loadingAssignments && myAssignments.length > 0) setView('queue');
  }, [loadingAssignments, myAssignments.length]);

  // Build (role:docId → formId → state) from MY OWN rows
  useEffect(() => {
    if (!selectedProject) { setMyFormStatusByDoc(new Map()); return; }
    let cancelled = false;
    // `getStatus`, not `getAll`: the value endpoint answers with its newest 50
    // rows, so in a project holding a few thousand AI results every manual row
    // fell off the page and this map came back empty — the queue then showed
    // saved work as un-started. Six live projects were in that state.
    resultsService.getStatus({ projectId: selectedProject.id })
      .then(status => {
        if (cancelled) return;
        const out = new Map<string, Map<string, FormState>>();
        for (const r of status.manual) {
          // Mine, and filed under the role it was actually saved as.
          //
          // Two things this gets right that the doc-keyed version could not.
          // `is_mine` is the only thing that identifies my work when a row has
          // no role at all (29 of the 65 live manual rows), where matching on a
          // null role would let another person's extraction tick off my queue.
          // And keying by role means a reviewer who is *also* the adjudicator
          // on a paper sees the two jobs scored separately, instead of one
          // strip repeated on both rows.
          if (!r.is_mine) continue;
          // `formStatusBucket`, not the raw role: a row's `reviewer_role` is
          // the label it was saved under and goes stale when a seat moves, so
          // keying on it filed a reviewer's own finished form under a key
          // nothing looked up. Reader labels are interchangeable (nobody holds
          // both reader seats); only `adjudicator` is a separate job. Same
          // rule as `reviewer_slots.authored_by_holder` on the server.
          const key = `${formStatusBucket(r.reviewer_role)}:${r.document_id}`;
          if (!out.has(key)) out.set(key, new Map());
          out.get(key)!.set(r.form_id, r.is_partial ? 'partial' : 'done');
        }
        setMyFormStatusByDoc(out);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedProject || !selectedForm) {
      setDoneDocs(new Set()); setPartialDocs(new Set()); setAiAvailableDocs(new Set());
      setAiStatusLoaded(false);
      return;
    }
    let cancelled = false;
    setAiStatusLoaded(false);
    // Same reason as the map above, and these three sets carry more weight than
    // a badge: `doneDocs` picks the Save & Next target and `aiAvailableDocs`
    // decides whether the AI-assisted toggle appears at all.
    resultsService.getStatus({ projectId: selectedProject.id, formId: selectedForm.id })
      .then(status => {
        if (cancelled) return;
        const done = new Set<string>();
        const partial = new Set<string>();
        for (const r of status.manual) {
          // My own work only. These two sets draw the "Done" badge and pick the
          // Save & Next target, and they counted *anyone's* manual row — so a
          // reviewer saw a paper marked done because their colleague had
          // finished it, and Save & Next jumped over their own outstanding work.
          if (!r.is_mine) continue;
          if (r.is_partial) partial.add(r.document_id);
          else done.add(r.document_id);
        }
        setDoneDocs(done);
        setPartialDocs(partial);
        setAiAvailableDocs(new Set(status.ai_document_ids));
        setAiStatusLoaded(true);
      }).catch(() => { if (!cancelled) setAiStatusLoaded(true); });
    return () => { cancelled = true; };
  }, [selectedForm?.id, selectedProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A shown quote belongs to the document it was read in. Every doc-switching
  // path (queue rail, Save & Next, a deep link) used to leave `activeQuote`
  // standing, so the next study's PDF opened with the previous study's passage
  // being hunted for and highlighted. Cleared here rather than in each handler
  // so a new path cannot forget.
  useEffect(() => {
    setActiveQuote(null);
    shownQuoteRef.current = '';
    setRegionMode(false);
  }, [selectedDoc?.id]);

  // Closing the tab or reloading is the one exit this page cannot intercept, so
  // ask the browser to. Conditional on purpose: a guard that fires even when
  // everything is saved just teaches people to click through it.
  useEffect(() => {
    if (mode !== 'extract') return;
    const warn = (e: BeforeUnloadEvent) => {
      if (liveSnapshotRef.current === savedSnapshotRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [mode]);

  // URL → state: handles initial load, deep links, and browser back/forward
  useEffect(() => {
    // Readiness is `allDocuments`, not `documents`: a project with nothing
    // processed yet has an empty `documents` for good, and keying on it meant
    // the effect below never ran there at all.
    if (forms.length === 0 || allDocuments.length === 0) return;
    const formId = searchParams.get('form');
    const docId = searchParams.get('doc');
    const pageParam = parseInt(searchParams.get('page') ?? '', 10);
    const urlPage = (!isNaN(pageParam) && pageParam >= 1) ? pageParam : null;

    // URL has no extraction params → ensure we're at the picker
    if (!formId || !docId) {
      if (mode === 'extract') {
        setCurrentPage(null);
        clearAiPrefill();
        setTableErrors({});
        setMode('select');
      }
      return;
    }

    // URL form/doc match current state → only sync page param
    if (mode === 'extract' && selectedForm?.id === formId && selectedDoc?.id === docId) {
      if (urlPage !== currentPage) setCurrentPage(urlPage);
      return;
    }

    // URL points at a form/doc we're not currently showing → load it
    const form = forms.find(f => f.id === formId);
    const doc = documents.find(d => d.id === docId);
    if (!form || !doc) {
      // Say why. A link to a paper that is still being processed, or to a form
      // that has since been archived, used to land on the picker with no
      // explanation — and with the dead parameters still in the URL, so a
      // reload repeated the nothing.
      const unprocessed = !doc ? allDocuments.find(d => d.id === docId) : null;
      toast({
        title: 'Cannot open that link',
        description: unprocessed
          ? `"${docLabels[unprocessed.id] ?? unprocessed.filename}" has not finished processing yet — `
            + 'extraction opens once its text is ready.'
          : !doc
            ? 'That document is not in this project, or has been removed.'
            : 'That form is no longer active in this project.',
        variant: 'error',
      });
      router.replace('/manual-extraction', { scroll: false });
      return;
    }
    setCurrentPage(urlPage);
    setStarting(true);
    (async () => {
      try {
        const role = myRoleByDoc.get(doc.id) ?? null;
        setActiveRole(role);
        let init = initFormData(form);
        if (extractionMode === 'ai_assisted') {
          const { data, keys, tablePrefill } = await loadAiData(form, doc.id);
          init = { ...init, ...data };
          setAiPrefilledKeys(keys);
          setAiPrefilledTablePrefill(tablePrefill);
          setAiOriginal(data);
        }
        const saved = await loadExistingManual(form, doc.id, role);
        init = { ...init, ...(saved?.data ?? {}) };
        applySaved(saved);
        setFormData(init);
        savedSnapshotRef.current = snapshotOf(init, saved?.sources ?? {});
        setSelectedForm(form);
        setSelectedDoc(doc);
        setMode('extract');
      } catch {
        toast({ title: 'Error', description: 'Failed to load document from URL', variant: 'error' });
      } finally {
        setStarting(false);
      }
    })();
  }, [searchParams, forms, documents, allDocuments]); // eslint-disable-line react-hooks/exhaustive-deps

  // State → URL: push for new form/doc (so browser back returns to picker), replace for page changes
  useEffect(() => {
    if (mode === 'extract' && selectedForm && selectedDoc) {
      const urlForm = searchParams.get('form');
      const urlDoc = searchParams.get('doc');
      const urlPageStr = searchParams.get('page');
      const targetPageStr = currentPage && currentPage > 1 ? String(currentPage) : null;
      if (urlForm === selectedForm.id && urlDoc === selectedDoc.id && urlPageStr === targetPageStr) return;

      const params = new URLSearchParams();
      params.set('form', selectedForm.id);
      params.set('doc', selectedDoc.id);
      if (targetPageStr) params.set('page', targetPageStr);
      const target = `/manual-extraction?${params.toString()}`;

      const formOrDocChanged = urlForm !== selectedForm.id || urlDoc !== selectedDoc.id;
      if (formOrDocChanged) router.push(target, { scroll: false });
      else router.replace(target, { scroll: false });
    } else if (
      mode === 'select'
      && (searchParams.get('form') || searchParams.get('doc') || searchParams.get('page'))
      // ...but not before the deep-link effect above has had the data it needs
      // to act on them. This branch runs on mount, while `mode` is still
      // 'select' and the lists are still loading, and it used to strip the
      // parameters of a shared link before anything could read them — so a
      // link to a study opened the picker, and the "cannot open that link"
      // message never fired either, because by then there was no link left.
      && forms.length > 0 && allDocuments.length > 0
    ) {
      router.replace('/manual-extraction', { scroll: false });
    }
  }, [mode, selectedForm?.id, selectedDoc?.id, currentPage, forms.length, allDocuments.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The reader scrolled to a new page. Kept out of the URL for page 1 so a
   *  link to the top of a paper stays clean. */
  const handleViewerPage = useCallback((page: number) => {
    setCurrentPage(page > 1 ? page : null);
  }, []);

  const hasAnyAiResults = aiAvailableDocs.size > 0;

  /**
   * The remembered mode cannot outrank the project's privacy setting.
   *
   * `extractionMode` is restored from sessionStorage, so a reviewer who worked
   * in AI-assisted mode before "Hide AI results from reviewers" was switched on
   * came back still in it — with the toggle now (correctly) hidden and no way
   * to leave. The server already refuses the data; this is the screen agreeing
   * with it rather than sitting in a mode it cannot serve.
   */
  useEffect(() => {
    if (!aiStatusLoaded || hasAnyAiResults || extractionMode !== 'ai_assisted') return;
    setExtractionMode('blind');
    // The setters rather than `clearAiPrefill`, which is declared further down
    // and would be in its temporal dead zone here. These four are the same
    // work, and a state setter is stable so the effect stays honest.
    setAiPrefilledKeys(new Set());
    setAiPrefilledTablePrefill({});
    setAiOriginal({});
    setAiRawRow(null);
  }, [aiStatusLoaded, hasAnyAiResults, extractionMode]);
  /**
   * The paper Save & Next moves on to.
   *
   * Restricted to papers this reviewer actually holds a seat on, when they hold
   * any. It used to be "the next document in the project", which mattered little
   * while a save was just a save — but the server now claims a free reader seat
   * for whoever saves one (`reviewer_slots.claim_role`), so typing a single
   * character on a paper the app had walked you onto quietly assigned you to it.
   * A reviewer with no assignments at all still gets every document, because
   * browsing is the whole point for them.
   */
  const nextUnextractedDoc = useMemo(() => {
    if (!selectedDoc) return null;
    const notDone = documents.filter(d => d.id !== selectedDoc.id && !doneDocs.has(d.id));
    if (myRoleByDoc.size > 0) return notDone.find(d => myRoleByDoc.has(d.id)) ?? null;
    return notDone[0] ?? null;
  }, [documents, selectedDoc, doneDocs, myRoleByDoc]);

  // ── Core helpers ──────────────────────────────────────────────────

  // There is deliberately no PDF fetch here. `PdfHighlightViewer` takes a
  // `documentId` and downloads the file itself, with its own blob cache — so
  // the presigned full-file fetch this page used to `await` before showing the
  // form was a second copy of every PDF that nothing ever read, and a
  // 30-second blocking step on the way into every study.

  const initFormData = useCallback((form: Form): Record<string, any> => {
    const init: Record<string, any> = {};
    flattenScalarFields(form.fields).forEach(f => { init[f.field_name] = ''; });
    form.fields.forEach(f => { if (isTableField(f)) init[f.field_name] = []; });
    return init;
  }, []);

  const loadAiData = useCallback(async (form: Form, docId: string): Promise<{
    data: Record<string, any>;
    keys: Set<string>;
    tablePrefill: Record<string, AiTablePrefill>;
  }> => {
    if (!selectedProject) return { data: {}, keys: new Set(), tablePrefill: {} };
    try {
      const results = await resultsService.getAll({
        projectId: selectedProject.id, formId: form.id, documentId: docId,
      });
      const aiResult = results.find(r => r.extraction_type === 'ai');
      if (!aiResult) { setAiRawRow(null); return { data: {}, keys: new Set(), tablePrefill: {} }; }
      setAiRawRow(aiResult.extracted_data as Record<string, any>);
      const normalized = normalizeAiData(aiResult.extracted_data);

      // Scalar fields
      const scalarNames = new Set(flattenScalarFields(form.fields).map(f => f.field_name));
      const prefilled: Record<string, any> = {};
      const prefilledKeys = new Set<string>();
      for (const [key, val] of Object.entries(normalized)) {
        if (scalarNames.has(key) && val != null && val !== '' && !Array.isArray(val)) {
          prefilled[key] = String(val);
          prefilledKeys.add(key);
        }
      }

      // Table fields — build per-row, per-cell prefill map
      const tablePrefill: Record<string, AiTablePrefill> = {};
      for (const field of form.fields) {
        if (!isTableField(field)) continue;
        const arr: any[] = Array.isArray(normalized[field.field_name]) ? normalized[field.field_name] : [];
        if (arr.length === 0) continue;
        const subCols = (field.subform_fields ?? []).map(sf => sf.field_name);
        const rowIndices = new Set<number>();
        const cells: Record<number, Set<string>> = {};
        const rows = arr.map((item: any, rowIdx: number) => {
          const row: Record<string, string> = {};
          const aiCells = new Set<string>();
          for (const col of subCols) {
            const cell = item?.[col];
            let val = '';
            if (cell == null) {
              val = '';
            } else if (typeof cell === 'object' && 'final_value' in cell) {
              val = cell.final_value != null ? String(cell.final_value) : '';
            } else if (typeof cell === 'object' && 'value' in cell) {
              val = cell.value != null ? String(cell.value) : '';
            } else {
              val = String(cell);
            }
            row[col] = val;
            if (val.trim()) aiCells.add(col);
          }
          rowIndices.add(rowIdx);
          cells[rowIdx] = aiCells;
          return row;
        });
        prefilled[field.field_name] = rows;
        tablePrefill[field.field_name] = { rowIndices, cells };
      }

      return { data: prefilled, keys: prefilledKeys, tablePrefill };
    } catch {
      return { data: {}, keys: new Set(), tablePrefill: {} };
    }
    // Project id, not the object — see the note on the forms/documents effect.
  }, [selectedProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Restore the sourcing state that came back with a saved extraction. */
  const applySaved = useCallback((
    saved: { sources: SourceMap; evidenced: Set<string>; wasPartial: boolean; savedAt: string | null } | null,
  ) => {
    setSources(saved?.sources ?? {});
    setSavedEvidence(saved?.evidenced ?? new Set());
    setActiveSourceKey(null);
    setHasServerRow(!!saved);
    setServerSavedAt(saved?.savedAt ?? null);
    // A row saved as complete is not a draft — the autosave leaves it alone, so a
    // reviewer reopening a finished study can look without changing anything.
    setRowComplete(!!saved && !saved.wasPartial);
  }, []);

  const clearAiPrefill = () => {
    setAiPrefilledKeys(new Set());
    setAiPrefilledTablePrefill({});
    setAiOriginal({});
    // Blind mode must not leak the AI's quotes either.
    setAiRawRow(null);
  };

  // Fetch a previously-saved partial extraction for this doc+role and return the form data
  // (with the _partial marker stripped). Returns null when no partial save exists.
  /**
   * Reload this reviewer's own saved extraction for the doc+role, so reopening a
   * study shows what they already entered instead of a blank form.
   *
   * Two things this has to get right:
   *
   *  1. **Completed saves count, not just partials.** This used to bail unless
   *     `_partial === true`, so a finished extraction reopened empty and a
   *     reviewer amending one study silently retyped it from scratch.
   *  2. **Unwrap the envelopes.** Saved cells are now
   *     `{value, source_text, source_location, provenance}`, so handing them
   *     straight to `formData` renders every input blank and the next save nests
   *     `{value: {value: …}}`. `normalizeAiData` already flattens exactly this
   *     shape, tables included.
   *
   * Also returns what the row already knows about evidence, so the sourcing
   * chips come back and nothing is nagged for twice.
   */
  const loadExistingManual = useCallback(async (
    form: Form,
    docId: string,
    /** The role being extracted as. Passed in rather than looked up: on a
     *  document where the reviewer holds two roles, the lookup answers with the
     *  wrong one half the time. */
    role: string | null,
  ): Promise<{
    data: Record<string, any>;
    sources: SourceMap;
    evidenced: Set<string>;
    wasPartial: boolean;
    /** When the server last wrote this row, so the browser's crash-recovery
     *  copy can be compared against it instead of guessed about. */
    savedAt: string | null;
  } | null> => {
    if (!selectedProject) return null;
    try {
      const results = await resultsService.getAll({
        projectId: selectedProject.id, formId: form.id, documentId: docId,
      });
      // The server stores one manual row per (document, form, AUTHOR) — "THE
      // PERSON is the key, not the role" (results.py) — so that is what a reopen
      // must look for. Matching on the role instead failed in both directions,
      // and both were live: 15 rows across 9 documents carry a role whose seat
      // has since moved to someone else.
      //
      //  * It opened somebody else's row. The current seat holder saw their
      //    predecessor's answers, and because a save is matched by author, the
      //    next Save copied that text into the holder's own row under their name.
      //  * It missed the reviewer's own row after they were moved to a different
      //    seat, so the study reopened blank — and a full Save reads blanks as a
      //    deliberate clear, emptying the row they could no longer see.
      const manualRows = results.filter(r => r.extraction_type === 'manual');
      const myId = currentUser?.id ?? null;
      const manualResult =
        // Mine, whatever seat it happens to be labelled with.
        (myId ? manualRows.find(r => r.extracted_by === myId) : undefined)
        // ...else a legacy row with no author at all, which the seat holder
        // adopts on save (`reviewer_slots.can_adopt_unattributed`). Never one
        // written by somebody else.
        ?? (role !== null
              ? manualRows.find(r => !r.extracted_by && (r.reviewer_role ?? null) === role)
              : undefined)
        // ...else, only while the signed-in user is still unknown (a cold deep
        // link racing the auth fetch), the old role match rather than a blank
        // form.
        ?? (myId ? undefined : manualRows.find(r => (r.reviewer_role ?? null) === role));
      if (!manualResult) return null;
      const raw = { ...manualResult.extracted_data } as Record<string, any>;
      const wasPartial = raw._partial === true;
      delete raw._partial;
      if (Object.keys(raw).length === 0) return null;
      return {
        data: unwrapSavedTables(normalizeAiData(raw)),
        sources: sourcesFromSaved(raw),
        evidenced: evidencedKeys(raw),
        wasPartial,
        savedAt: manualResult.updated_at ?? manualResult.created_at ?? null,
      };
    } catch { return null; }
  }, [selectedProject?.id, currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────

  const handleStart = async () => {
    if (!selectedForm || !selectedDoc) return;
    setStarting(true);
    try {
      const role = myRoleByDoc.get(selectedDoc.id) ?? null;
      setActiveRole(role);
      let init = initFormData(selectedForm);
      if (extractionMode === 'ai_assisted') {
        const { data, keys, tablePrefill } = await loadAiData(selectedForm, selectedDoc.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
        setAiPrefilledTablePrefill(tablePrefill);
        setAiOriginal(data);
      } else {
        clearAiPrefill();
      }
      const saved = await loadExistingManual(selectedForm, selectedDoc.id, role);
      init = { ...init, ...(saved?.data ?? {}) };
      applySaved(saved);
      setTableErrors({});
      setFormData(init);
      // Where this form started, so Back can tell a real edit from a load.
      // Only handleStartFormForDoc used to do this, so every other entry path
      // compared against the *previous* study and cried "unsaved changes" on a
      // form nobody had touched.
      savedSnapshotRef.current = snapshotOf(init, saved?.sources ?? {});
      setMode('extract');
    } catch {
      toast({ title: 'Error', description: 'Failed to load document', variant: 'error' });
    } finally {
      setStarting(false);
    }
  };

  const handleStartFormForDoc = useCallback(async (
    doc: Document,
    form: Form,
    /** The role of the queue row that was clicked — the only place that knows,
     *  when a reviewer holds two roles on one document. */
    role?: string | null,
  ) => {
    const key = `${doc.id}:${form.id}`;
    setStartingKey(key);
    setStarting(true);
    try {
      const asRole = role ?? myRoleByDoc.get(doc.id) ?? null;
      setActiveRole(asRole);
      let init = initFormData(form);
      if (extractionMode === 'ai_assisted') {
        const { data, keys, tablePrefill } = await loadAiData(form, doc.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
        setAiPrefilledTablePrefill(tablePrefill);
        setAiOriginal(data);
      } else {
        clearAiPrefill();
      }
      const saved = await loadExistingManual(form, doc.id, asRole);
      init = { ...init, ...(saved?.data ?? {}) };
      applySaved(saved);
      setTableErrors({});
      setFormData(init);
      savedSnapshotRef.current = snapshotOf(init, saved?.sources ?? {});
      setSelectedForm(form);
      setSelectedDoc(doc);
      setMode('extract');
    } catch {
      toast({ title: 'Error', description: 'Failed to load document', variant: 'error' });
    } finally {
      setStarting(false);
      setStartingKey(null);
    }
  }, [myRoleByDoc, extractionMode, initFormData, loadAiData, loadExistingManual, applySaved, toast]);

  /**
   * True when it is safe to leave: nothing is unsaved, or the reviewer said to
   * drop it.
   *
   * The draft autosave covers work in progress, but a row already saved as
   * complete is deliberately left alone by it (flipping a finished row back to
   * `_partial` would drop the study out of consensus), so on that path this
   * prompt is the only thing standing between an edit and losing it.
   */
  const isDirty = useCallback(
    () => liveSnapshotRef.current !== savedSnapshotRef.current,
    [],
  );

  const confirmDiscard = useCallback((): boolean => {
    if (!isDirty()) return true;
    return window.confirm('You have unsaved changes on this study. Discard them?');
  }, [isDirty]);

  const leaveToPicker = useCallback(() => {
    setActiveRole(null);
    clearAiPrefill();
    setTableErrors({});
    setCurrentPage(null);
    setSources({});
    setSavedEvidence(new Set());
    setActiveSourceKey(null);
    setActiveQuote(null);
    shownQuoteRef.current = '';
    setRegionMode(false);
    setDraftState('off');
    setDraftAt(null);
    draftScopeRef.current = '';
    userTouchedRef.current = false;
    setHasServerRow(false);
    setServerSavedAt(null);
    setMode('select');
  }, []);

  const handleBack = useCallback(() => {
    const dirty = isDirty();
    if (!confirmDiscard()) return;
    // They chose to drop it, so the browser's copy goes too — otherwise the
    // next reopen offers back the very work they just discarded.
    if (dirty) clearDraft();
    leaveToPicker();
  }, [confirmDiscard, isDirty, leaveToPicker, clearDraft]);

  /**
   * The reviewer saying a paper is finished, or taking it back.
   *
   * The only thing that writes `completed` anywhere in the system now. It used
   * to be written by the save endpoint the moment every active form held a
   * row, which read a save as a declaration it never was — and with no
   * transition back out of `completed`, the paper was then frozen out of the
   * reviewer's own queue. See assignment_service.mark_assignment_started.
   */
  const handleSetAssignmentStatus = useCallback(async (
    assignment: ReviewAssignment,
    next: 'completed' | 'in_progress',
  ) => {
    setStatusBusyId(assignment.id);
    try {
      const updated = await assignmentsService.updateStatus(assignment.id, next);
      // Merge rather than replace: the response is enriched with
      // forms_completed/forms_total, but keeping the local row's other fields
      // means a partial response can never blank the queue row.
      setMyAssignments(prev => prev.map(a => (a.id === assignment.id ? { ...a, ...updated } : a)));
      toast({
        title: next === 'completed' ? 'Marked complete' : 'Reopened',
        description: next === 'completed'
          ? 'This paper has moved to Done. Reopen it there whenever you want to edit it.'
          : 'Back on your list — every form is editable again.',
        variant: 'success',
      });
    } catch (err: any) {
      console.error('[ManualExtraction] Status change failed:', err);
      toast({
        title: 'Could not change the status',
        description: err?.message || 'Your extractions are untouched. Try again.',
        variant: 'error',
      });
    } finally {
      setStatusBusyId(null);
    }
  }, [toast]);

  /** The assignment this sitting is being worked under, if any. Browsing a
   *  paper you hold no seat on leaves this null, and there is then nothing to
   *  declare finished. */
  const activeAssignment = useMemo(() => {
    if (!selectedDoc || !activeRole) return null;
    return myAssignments.find(
      a => a.document_id === selectedDoc.id && a.reviewer_role === activeRole && a.status !== 'skipped',
    ) ?? null;
  }, [myAssignments, selectedDoc?.id, activeRole]); // eslint-disable-line react-hooks/exhaustive-deps

  /** This reviewer's per-form state on the open paper, for the switcher. */
  const activeFormStates = useMemo(() => {
    const out: Record<string, FormState> = {};
    if (!selectedDoc) return out;
    const inner = myFormStatusByDoc.get(`${formStatusBucket(activeRole)}:${selectedDoc.id}`);
    if (inner) inner.forEach((state, formId) => { out[formId] = state; });
    return out;
  }, [myFormStatusByDoc, selectedDoc?.id, activeRole]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Move to another form on the paper already open, without going back to the
   *  queue for it. Same unsaved-work guard as switching documents. */
  const handleSwitchForm = useCallback(async (form: Form) => {
    if (!selectedDoc || form.id === selectedForm?.id) return;
    const dirty = isDirty();
    if (!confirmDiscard()) return;
    if (dirty) clearDraft();
    await handleStartFormForDoc(selectedDoc, form, activeRole);
  }, [selectedDoc, selectedForm?.id, activeRole, isDirty, confirmDiscard, clearDraft, handleStartFormForDoc]);

  // ── Reviewer-supplied source quotes ─────────────────────────────────────
  // Which cells still owe a quote. Only values the reviewer typed or changed:
  // anything left exactly as the AI extracted it already keeps the AI's own
  // quote server-side (recorded `inherited`), so counting those would invent
  // work. See _lib/sourcing.needsSource.
  // On a grouped table a shared value is stored on every row it describes but
  // rendered once, so only the cell the editor actually shows can owe a source.
  const reachableCell = useMemo(
    () => reachableCellFilter(selectedForm?.fields ?? [], formData),
    [selectedForm, formData],
  );

  const unsourced = useMemo(
    () => unsourcedKeys(formData, aiOriginal, sources, savedEvidence, reachableCell),
    [formData, aiOriginal, sources, savedEvidence, reachableCell],
  );

  const attachSource = useCallback((key: string, source: AttachedSource) => {
    userTouchedRef.current = true;
    setSources(prev => ({ ...prev, [key]: source }));
  }, []);

  const clearSource = useCallback((key: string) => {
    userTouchedRef.current = true;
    setSources(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /** A passage confirmed in the PDF lands on whichever field is focused. When
   *  nothing is focused we steer to the first cell that owes a source rather
   *  than dropping the selection on the floor. */
  const handleSelectQuote = useCallback((quote: SelectedQuote) => {
    const target = activeSourceKey ?? unsourced[0] ?? null;
    if (!target) {
      toast({
        title: 'Pick a field first',
        description: 'Click the field this passage supports, then highlight it again.',
        variant: 'error',
      });
      return;
    }
    attachSource(target, { source_text: quote.text, source_location: quote.location });
    setActiveSourceKey(target);
    toast({
      title: 'Source attached',
      description: `${describeKey(target)} — page ${quote.page}`,
      variant: 'success',
    });
  }, [activeSourceKey, unsourced, attachSource, toast]);

  /** Same, for a box drawn round a figure, a table, or a scanned page. There is
   *  no quote to carry — the rectangle *is* the citation, which is the only
   *  honest claim for a number read off a chart or a page with no text layer. */
  const handleSelectRegion = useCallback((region: SelectedQuote) => {
    const target = activeSourceKey ?? unsourced[0] ?? null;
    if (!target) {
      toast({
        title: 'Pick a field first',
        description: 'Click the field this box supports, then draw it again.',
        variant: 'error',
      });
      return;
    }
    attachSource(target, { source_text: '', source_location: region.location });
    setActiveSourceKey(target);
    toast({
      title: 'Box attached',
      description: `${describeKey(target)} — page ${region.page}`,
      variant: 'success',
    });
  }, [activeSourceKey, unsourced, attachSource, toast]);

  /** The AI's quotes, as stored. Rebuilt only when the row or the form changes. */
  const aiEvidenceRaw = useMemo(
    () => aiEvidenceFromRow(aiRawRow, (selectedForm?.fields ?? []).filter(isTableField)),
    [aiRawRow, selectedForm],
  );

  /** ...mapped onto the rows as they currently stand on screen. Depends on
   *  formData because a table row's identity moves when the reviewer edits it. */
  const aiEvidence = useMemo(
    () => (extractionMode === 'ai_assisted' ? resolveAiEvidence(aiEvidenceRaw, formData) : {}),
    [aiEvidenceRaw, formData, extractionMode],
  );

  /** Clicking a "p.N" chip puts that passage back on screen. The viewer keys its
   *  scroll on the quote text, so re-clicking the chip you are already showing
   *  has to look like a change or it silently does nothing after you have
   *  scrolled away — hence the clear-then-set. */
  const revealSource = useCallback((key: string) => {
    const mine = sources[key];
    // The reviewer's own quote wins; the AI's is the fallback for a value they
    // have not touched. Both are just "a passage on a page" to the viewer.
    const ev = mine
      ? {
          text: mine.source_text ?? '',
          page: mine.source_location?.page ?? null,
          figureImage: null,
          boxes: boxesFromLocation(mine.source_location),
        }
      : aiEvidence[key];
    if (!ev) return;
    setActiveSourceKey(key);
    const next = {
      text: ev.text ?? '',
      page: ev.page ?? null,
      figureImage: ev.figureImage ?? null,
      boxes: ev.boxes ?? null,
    };
    // A drawn box has no text, so the box itself has to be part of the identity
    // or clicking two different boxes would look like the same reveal.
    const sig = `${next.text}::${next.page}::${
      next.boxes ? next.boxes.boxes.map((b: number[]) => b.join(',')).join('|') : ''
    }`;
    if (shownQuoteRef.current === sig) {
      setActiveQuote(null);
      requestAnimationFrame(() => setActiveQuote(next));
    } else {
      setActiveQuote(next);
    }
    shownQuoteRef.current = sig;
  }, [sources, aiEvidence]);

  /**
   * The passages the model quoted, offered as clickable marks on the PDF.
   *
   * Blind mode contributes none, deliberately: which passage the model chose is
   * part of the model's answer, and marking it would tell a blinded reviewer
   * where to look. `aiEvidence` is already empty there — this is the reason it
   * is, spelled out so nobody "fixes" it later.
   *
   * A chart reading is skipped too. Its quote is a row of a table that was
   * never printed in the PDF, so any text it matched would be a coincidence.
   */
  const sourceMarkers = useMemo<SourceMarker[]>(
    () => Object.entries(aiEvidence)
      .filter(([, ev]) => !!ev?.text?.trim() && !ev.figureImage)
      .map(([key, ev]) => ({
        key,
        label: describeKey(key),
        text: ev.text,
        used: !!sources[key],
      })),
    [aiEvidence, sources],
  );

  /** Clicking a mark cites it for every cell that quoted it. The value is not
   *  touched: in AI-assisted mode it is already on screen, and overwriting what
   *  a reviewer typed because they clicked the passage they were reading would
   *  be the opposite of what they asked for. */
  const handleMarkerClick = useCallback((keys: string[], quote: SelectedQuote) => {
    if (!keys.length) return;
    for (const key of keys) {
      attachSource(key, { source_text: quote.text, source_location: quote.location });
    }
    setActiveSourceKey(keys[0]);
    // Same reason the marker tooltip counts rather than lists: one passage
    // routinely covers a whole column, and a toast naming twenty cells is a
    // wall of text that scrolls itself off screen.
    const named = keys.length <= 3
      ? keys.map(describeKey).join(', ')
      : `${describeKey(keys[0])} and ${keys.length - 1} more`;
    toast({
      title: keys.length === 1 ? 'Source attached' : `${keys.length} sources attached`,
      description: `${named} — page ${quote.page}`,
      variant: 'success',
    });
  }, [attachSource, toast]);

  const markerHint = useMemo(() => {
    if (extractionMode !== 'ai_assisted') {
      return 'Select a passage in the PDF to cite it for the field you are filling';
    }
    if (!sourceMarkers.length) return null;
    const cited = sourceMarkers.filter(m => m.used).length;
    return cited === 0
      ? 'Click a highlight to cite it for its field'
      : `${cited} of ${sourceMarkers.length} highlights cited`;
  }, [extractionMode, sourceMarkers]);

  const sourcingValue = useMemo<SourcingValue>(() => ({
    activeKey: activeSourceKey,
    setActiveKey: setActiveSourceKey,
    sources,
    aiEvidence,
    unsourced,
    attach: attachSource,
    clear: clearSource,
    reveal: revealSource,
    enabled: true,
  }), [activeSourceKey, sources, aiEvidence, unsourced, attachSource, clearSource, revealSource]);

  const handleSave = useCallback(async () => {
    if (!selectedDoc || !selectedForm) return;

    // Scalar required check
    const scalarFields = flattenScalarFields(selectedForm.fields);
    const emptyScalar = scalarFields.filter(f => isRequiredField(f) && !formData[f.field_name]?.toString().trim());
    if (emptyScalar.length > 0) {
      toast({ title: 'Validation Error', description: `Fill in: ${emptyScalar.map(f => f.field_name.replace(/_/g, ' ')).join(', ')}`, variant: 'error' });
      return;
    }

    // Table required check — collect errors and surface them to TableField for auto-expand + red ring
    const newTableErrors: Record<string, Record<number, Set<string>>> = {};
    for (const field of selectedForm.fields) {
      if (!isTableField(field) || !isRequiredField(field)) continue;
      const rows: Array<Record<string, string>> = Array.isArray(formData[field.field_name]) ? formData[field.field_name] : [];
      if (rows.length === 0) {
        toast({ title: 'Validation Error', description: `${field.field_name.replace(/_/g, ' ')} needs at least one row`, variant: 'error' });
        return;
      }
      const requiredCols = (field.subform_fields ?? []).filter(isRequiredField);
      const rowErrors: Record<number, Set<string>> = {};
      for (let i = 0; i < rows.length; i++) {
        const missing = requiredCols.filter(sf => !rows[i][sf.field_name]?.toString().trim());
        if (missing.length > 0) rowErrors[i] = new Set(missing.map(sf => sf.field_name));
      }
      if (Object.keys(rowErrors).length > 0) newTableErrors[field.field_name] = rowErrors;
    }
    if (Object.keys(newTableErrors).length > 0) {
      setTableErrors(newTableErrors);
      const firstField = Object.keys(newTableErrors)[0];
      const firstRowIdx = Number(Object.keys(newTableErrors[firstField])[0]);
      // A shared value is entered once, so naming a row it happens to sit on
      // sends the reviewer to the wrong place — the box is up in the study or
      // group section, not in the row they are pointed at.
      const fieldDef = selectedForm.fields.find(f => f.field_name === firstField);
      const scopeByCol = new Map(
        (fieldDef?.subform_fields ?? []).map(sf => [sf.field_name, scopeOf(sf)]),
      );
      const missing = [...newTableErrors[firstField][firstRowIdx]];
      const shared = missing.filter(c => (scopeByCol.get(c) ?? SCOPE_ROW) !== SCOPE_ROW);
      const perRow = missing.filter(c => (scopeByCol.get(c) ?? SCOPE_ROW) === SCOPE_ROW);
      const name = (c: string) => c.replace(/_/g, ' ');
      const where = shared.length
        ? `fill in ${shared.map(name).join(', ')}`
        : `row ${firstRowIdx + 1}: fill in ${perRow.map(name).join(', ')}`;
      toast({ title: 'Validation Error', description: `${firstField.replace(/_/g, ' ')} — ${where}`, variant: 'error' });
      return;
    }

    // An empty form is a deliberate clear, and a stray Ctrl+S is not. Ask,
    // rather than either blocking a genuine retraction or performing an
    // accidental one. See isFormBlank.
    if (isFormBlank(formData)) {
      const ok = window.confirm(
        hasServerRow
          ? 'This form is empty. Saving replaces what is stored for this study with nothing. Continue?'
          : 'This form is empty. Save it as your completed answer anyway?',
      );
      if (!ok) return false;
    }

    setSaving(true);
    try {
      // A shared value is cited once but stored on every row of its group, so
      // the citation is spread before pruning — otherwise the export shows
      // evidence for row 1 of a group and none for the identical rows under it.
      // Pruning then drops any quote whose cell no longer exists, so a deleted
      // row cannot ship its evidence against another row's data.
      const pruned = pruneSources(formData, spreadSharedSources(selectedForm.fields, formData, sources));
      const stored = await resultsService.saveManualExtraction({
        document_id: selectedDoc.id,
        form_id: selectedForm.id,
        extracted_data: applySources(formData, pruned),
        extraction_type: 'manual',
        reviewer_role: activeRole,
      });
      // The seat the row actually landed in. The server may have claimed a free
      // reader one for this save, and it is the only party that can see the
      // current assignments — so its answer replaces ours. Without this the
      // toolbar kept showing no role on a paper the reviewer now formally holds,
      // and the queue tick below was filed under the wrong key.
      const storedRole = stored?.reviewer_role ?? null;
      if (storedRole !== activeRole) setActiveRole(storedRole);
      setServerSavedAt(stored?.updated_at ?? new Date().toISOString());
      toast({ title: 'Saved', description: 'Manual extraction saved successfully', variant: 'success' });
      savedSnapshotRef.current = snapshotOf(formData, sources);
      setHasServerRow(true);
      setDoneDocs(prev => new Set(prev).add(selectedDoc.id));
      if (selectedProject) {
        assignmentsService.getMyAssignments({ projectId: selectedProject.id })
          .then(asgs => setMyAssignments(asgs)).catch(() => {});
      }
      setPartialDocs(prev => { const n = new Set(prev); n.delete(selectedDoc.id); return n; });
      setMyFormStatusByDoc(prev => {
        // Same key as the builder and both readers in MyQueueView. These two
        // optimistic writers were left keying on the document alone, so every
        // save filed its tick under a key nothing reads and the queue strip
        // only caught up on a full reload.
        const key = `${formStatusBucket(storedRole)}:${selectedDoc.id}`;
        const next = new Map(prev);
        const inner = new Map(next.get(key) ?? new Map());
        inner.set(selectedForm.id, 'done');
        next.set(key, inner);
        return next;
      });
      setTableErrors({});
      clearDraft();
      setRowComplete(true);
      setDraftState('off');
      return true;
    } catch (err: any) {
      console.error('[ManualExtraction] Save failed:', err);
      toast({ title: 'Save failed', description: err?.message || 'Could not save extraction. Check your connection and try again.', variant: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [selectedDoc, selectedForm, selectedProject, formData, sources, activeRole, hasServerRow, clearDraft, toast]);

  /**
   * Server-side draft autosave — what the "Save partial" button used to be.
   *
   * A reviewer should not have to know that in-progress work needs a *different
   * button* from finished work. The difference is only whether the form is
   * complete, which the server already records as `_partial`, so the draft saves
   * itself and the remaining button means "this is my answer".
   *
   * Three rules it must not break:
   *  1. **Never touch a row that is already complete.** Flipping it back to
   *     `_partial: true` would drop the study out of consensus
   *     (`consensus_summary.py` skips partial rows), and a finished record must
   *     not change without the reviewer pressing Save. Hence `rowComplete`.
   *  2. **Never block the UI** — no `setSaving`, no toast. A background save that
   *     disables the buttons or shouts at the reviewer is worse than none.
   *  3. **Blanks must be harmless.** They are: `provenance.merge_cell` reads an
   *     empty field in a partial save as "not filled in yet" and keeps what is
   *     stored, so autosaving a half-typed form cannot erase anything.
   *  4. **Only the reviewer's own edits count** (`userTouchedRef`). Switching to
   *     AI-assisted mode rewrites every field from the AI row; saving that as
   *     their draft would file the model's answers under their name before they
   *     had read one of them.
   */
  const saveServerDraft = useCallback(async () => {
    if (!selectedDoc || !selectedForm) return;
    const snapshot = snapshotOf(formData, sources);
    setDraftState('saving');
    try {
      const stored = await resultsService.saveManualExtraction({
        document_id: selectedDoc.id,
        form_id: selectedForm.id,
        extracted_data: applySources(
          formData,
          pruneSources(formData, spreadSharedSources(selectedForm.fields, formData, sources)),
        ),
        extraction_type: 'manual',
        reviewer_role: activeRole,
        is_partial: true,
      });
      // Same as the full save: a draft is the first thing that lands, so it is
      // usually the save that claims the seat.
      const storedRole = stored?.reviewer_role ?? null;
      if (storedRole !== activeRole) {
        setActiveRole(storedRole);
        // A seat was taken on our behalf, so the queue's own idea of what this
        // reviewer holds is now out of date.
        if (selectedProject) {
          assignmentsService.getMyAssignments({ projectId: selectedProject.id })
            .then(asgs => setMyAssignments(asgs)).catch(() => {});
        }
      }
      // The work *is* on the server now, so Back must stop claiming otherwise.
      savedSnapshotRef.current = snapshot;
      setDraftState('saved');
      setDraftAt(Date.now());
      setHasServerRow(true);
      setServerSavedAt(stored?.updated_at ?? new Date().toISOString());
      // The server has it now, so the browser copy is stale by definition and
      // must never be offered back later as "recovered" work.
      clearDraft();
      setPartialDocs(prev => new Set(prev).add(selectedDoc.id));
      setMyFormStatusByDoc(prev => {
        const key = `${formStatusBucket(storedRole)}:${selectedDoc.id}`;
        const next = new Map(prev);
        const inner = new Map(next.get(key) ?? new Map());
        inner.set(selectedForm.id, 'partial');
        next.set(key, inner);
        return next;
      });
    } catch (err: any) {
      console.error('[ManualExtraction] Draft autosave failed:', err);
      setDraftState('error');
    }
  }, [selectedDoc, selectedForm, selectedProject, formData, sources, activeRole, clearDraft]);

  // Debounced trigger. `sources` is part of the signature as well as `formData`
  // because attaching a quote changes neither a value nor the field count — the
  // same omission that once shipped an empty source map to the server.
  useEffect(() => {
    if (mode !== 'extract' || !selectedForm || !selectedDoc) return;
    const scope = `${selectedDoc.id}:${selectedForm.id}`;
    const sig = snapshotOf(formData, sources);

    // Opening a study is not a change: record where it started and stop.
    if (draftScopeRef.current !== scope) {
      draftScopeRef.current = scope;
      draftSigRef.current = sig;
      userTouchedRef.current = false;
      setDraftState(rowComplete ? 'off' : 'idle');
      setDraftAt(null);
      return;
    }
    // The page rewrote the form itself (AI prefill on a mode toggle, a reopen).
    // Re-baseline so the reviewer's *next* edit still registers, but save nothing.
    if (!userTouchedRef.current) {
      draftSigRef.current = sig;
      return;
    }
    if (rowComplete || saving || sig === draftSigRef.current) return;

    const timer = setTimeout(() => {
      draftSigRef.current = sig;
      void saveServerDraft();
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [formData, sources, mode, selectedForm, selectedDoc, rowComplete, saving, saveServerDraft]);

  const handleSaveAndNext = useCallback(async () => {
    const saved = await handleSave();
    if (!saved || !selectedForm) return;
    const next = nextUnextractedDoc;
    if (!next) {
      toast({ title: 'All done!', description: 'All documents have been extracted', variant: 'success' });
      setCurrentPage(null);
      setMode('select');
      return;
    }
    try {
      const nextRole = myRoleByDoc.get(next.id) ?? null;
      setActiveRole(nextRole);
      setCurrentPage(null);
      setSelectedDoc(next);
      let init = initFormData(selectedForm);
      if (extractionMode === 'ai_assisted') {
        const { data, keys, tablePrefill } = await loadAiData(selectedForm, next.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
        setAiPrefilledTablePrefill(tablePrefill);
        setAiOriginal(data);
      } else {
        clearAiPrefill();
      }
      const saved = await loadExistingManual(selectedForm, next.id, nextRole);
      init = { ...init, ...(saved?.data ?? {}) };
      applySaved(saved);
      setTableErrors({});
      setFormData(init);
      savedSnapshotRef.current = snapshotOf(init, saved?.sources ?? {});
    } catch {
      toast({ title: 'Error', description: 'Failed to load next document', variant: 'error' });
    }
  }, [handleSave, selectedForm, nextUnextractedDoc, myRoleByDoc, extractionMode, initFormData, loadAiData, loadExistingManual, applySaved, toast]);

  const handleReset = useCallback(() => {
    if (!selectedForm) return;
    setFormData(initFormData(selectedForm));
    clearAiPrefill();
    setTableErrors({});
    // The quotes go with the values they were attached to. A source left behind
    // would be posted as evidence for an empty answer.
    setSources({});
    setSavedEvidence(new Set());
    setActiveSourceKey(null);
    setActiveQuote(null);
    shownQuoteRef.current = '';
    // An empty form is not a draft worth pushing; committing a wipe is a Save.
    userTouchedRef.current = false;
  }, [selectedForm, initFormData]);

  const handleFieldChange = useCallback((fieldName: string, value: any) => {
    userTouchedRef.current = true;
    setFormData(prev => ({ ...prev, [fieldName]: value }));
  }, []);

  /**
   * Save which of a table's columns repeat, from inside extraction.
   *
   * The reviewer is the one who knows, and they find out mid-row — so the setup
   * lives here rather than only in the form builder. It is the same PATCH the
   * builder sends, and it touches forms.fields alone: no prompt changes, no
   * saved row changes, no regeneration. `selectedForm` is patched in place so
   * the table re-renders grouped without a refetch.
   */
  const handleSaveGrouping = useCallback(async (
    formId: string,
    fieldName: string,
    next: { groups: string[]; columnScopes: Record<string, string> },
  ): Promise<boolean> => {
    // The form is named by the caller. Reading it from `selectedForm` was wrong
    // for the queue's grouping nudge, which points at the first ungrouped table
    // in ANY of the project's forms: there `selectedForm` is null (the save was
    // a silent no-op) or a form opened earlier (the tags landed on that one).
    setSavingGrouping(`${formId}:${fieldName}`);
    try {
      await formsService.updateFieldEdits(formId, [{
        field_name: fieldName,
        groups: next.groups,
        column_scopes: next.columnScopes,
      }]);
      // Patch both copies. `selectedForm` is what the panel and the extraction
      // form read; `forms` is what re-picking this form would restore it from,
      // and leaving that stale is how the setting appears to un-save itself.
      const applyTags = (form: Form): Form => ({
        ...form,
        fields: form.fields.map(f => f.field_name === fieldName ? {
          ...f,
          groups: next.groups,
          subform_fields: (f.subform_fields || []).map(sf => ({
            ...sf,
            scope: next.columnScopes[sf.field_name] ?? SCOPE_ROW,
          })),
        } : f),
      });
      setSelectedForm(prev => (prev && prev.id === formId ? applyTags(prev) : prev));
      setForms(prev => prev.map(f => (f.id === formId ? applyTags(f) : f)));
      const shared = Object.values(next.columnScopes).filter(v => v !== SCOPE_ROW).length;
      toast({
        title: 'Grouping saved',
        description: shared === 0
          ? 'Every column is entered per row, so this table stays a flat row list.'
          : `${shared} column${shared === 1 ? '' : 's'} moved out of the rows. Your saved rows are unchanged.`,
      });
      return true;
    } catch (err: any) {
      console.error('[ManualExtraction] Grouping save failed:', err);
      toast({
        title: 'Could not save the grouping',
        description: err?.message || 'The form could not be updated. Your extraction is untouched.',
        variant: 'error',
      });
      return false;
    } finally {
      setSavingGrouping(null);
    }
  }, [toast]);

  /** Ask the model what each column of a table is a property of. Read-only —
   *  the panel fills in with proposals the reviewer confirms by saving. */
  const handleSuggestGrouping = useCallback(async (formId: string, fieldName: string) => {
    try {
      return await formsService.suggestColumnGroups(formId, fieldName);
    } catch (err: any) {
      console.error('[ManualExtraction] Grouping suggestion failed:', err);
      const timedOut = err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '');
      toast({
        title: 'Could not suggest a grouping',
        description: timedOut
          ? 'The model took too long to answer. Try again, or set the grouping by hand — '
            + 'the pickers below work either way.'
          : err?.message || 'The suggestion model is unavailable — set it by hand.',
        variant: 'error',
      });
      return null;
    }
  }, [toast]);

  /**
   * Move every row-keyed side table when a table's rows move.
   *
   * Four maps are keyed by row index — the reviewer's quotes, the evidence
   * already recorded, the AI-prefill marks and the AI baseline — and a delete
   * used to leave all four describing the wrong row, so one row's quote became
   * the evidence for another row's data. Shared by the table editors and by the
   * Blind toggle, which also drops rows.
   */
  const applyRowRemaps = useCallback((remaps: Record<string, RowRemap>) => {
    for (const [field, remap] of Object.entries(remaps)) {
      setSources(prev => remapSources(field, prev, remap));
      setSavedEvidence(prev => remapKeySet(field, prev, remap));
      setAiPrefilledTablePrefill(prev => {
        const cur = prev[field];
        return cur ? { ...prev, [field]: remapAiPrefill(cur, remap) } : prev;
      });
      setAiOriginal(prev => {
        const cur = prev[field];
        return Array.isArray(cur) ? { ...prev, [field]: remapRows(cur, remap) } : prev;
      });
    }
  }, []);

  const handleTableChange = useCallback((
    parentName: string,
    rows: Array<Record<string, string>>,
    /** Set when the edit moved rows — see _lib/rowMoves. */
    remap?: RowRemap,
  ) => {
    userTouchedRef.current = true;
    setFormData(prev => ({ ...prev, [parentName]: rows }));
    if (remap) applyRowRemaps({ [parentName]: remap });
    // Clear errors for this table when user edits it
    setTableErrors(prev => {
      if (!prev[parentName]) return prev;
      const next = { ...prev };
      delete next[parentName];
      return next;
    });
  }, [applyRowRemaps]);

  const handleModeChange = useCallback(async (newMode: ExtractionMode) => {
    setExtractionMode(newMode);
    if (!selectedForm || !selectedDoc || mode !== 'extract') return;
    if (newMode === 'ai_assisted') {
      const { data, keys, tablePrefill } = await loadAiData(selectedForm, selectedDoc.id);
      setFormData(prev => {
        const updated = { ...prev };
        for (const [key, val] of Object.entries(data)) {
          if (Array.isArray(val)) {
            if (!Array.isArray(updated[key]) || updated[key].length === 0) updated[key] = val;
          } else if (!updated[key]?.toString().trim()) {
            updated[key] = val;
          }
        }
        return updated;
      });
      setAiPrefilledKeys(keys);
      setAiPrefilledTablePrefill(tablePrefill);
      setAiOriginal(data);
    } else {
      // Blind must not show the model's answers — but a value the reviewer
      // changed is not the model's answer any more. See stripAiValues.
      const { data, remaps } = stripAiValues(formData, aiOriginal);
      setFormData(data);
      applyRowRemaps(remaps);
      clearAiPrefill();
    }
  }, [selectedForm, selectedDoc, mode, loadAiData, aiOriginal, formData, applyRowRemaps]);

  const handleQueueDocSelect = useCallback(async (doc: Document) => {
    if (!selectedForm || doc.id === selectedDoc?.id) return;
    // Switching studies from the rail used to drop unsaved edits without a
    // word — and on a row already saved as complete the autosave is off, so
    // there was nothing else holding them.
    const dirty = isDirty();
    if (!confirmDiscard()) return;
    if (dirty) clearDraft();
    try {
      const role = myRoleByDoc.get(doc.id) ?? null;
      setActiveRole(role);
      setCurrentPage(null);
      setSelectedDoc(doc);
      let init = initFormData(selectedForm);
      if (extractionMode === 'ai_assisted') {
        const { data, keys, tablePrefill } = await loadAiData(selectedForm, doc.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
        setAiPrefilledTablePrefill(tablePrefill);
        setAiOriginal(data);
      } else {
        clearAiPrefill();
      }
      const saved = await loadExistingManual(selectedForm, doc.id, role);
      init = { ...init, ...(saved?.data ?? {}) };
      applySaved(saved);
      setTableErrors({});
      setFormData(init);
      savedSnapshotRef.current = snapshotOf(init, saved?.sources ?? {});
    } catch {
      toast({ title: 'Error', description: 'Failed to load document', variant: 'error' });
    }
  }, [selectedForm, selectedDoc, myRoleByDoc, extractionMode, initFormData, loadAiData, loadExistingManual, applySaved, confirmDiscard, isDirty, clearDraft, toast]);

  useExtractionKeyboard({
    onSave: handleSave,
    onSaveAndNext: handleSaveAndNext,
    onEscape: handleBack,
    enabled: mode === 'extract',
  });

  // ── Render ────────────────────────────────────────────────────────

  /** Who gets the "Browse all" tab: anyone who runs the project, plus any
   *  reviewer with nothing assigned — they have no queue to browse away from. */
  const canBrowseAll = isOwner || isAdmin || role === 'manager' || can_manage_assignments || myAssignments.length === 0;

  if (!selectedProject) {
    return (
      <DashboardLayout title="Manual Extraction" description="Manually extract data from documents">
        <EmptyState
          icon={FolderOpen}
          title="No project selected"
          description="Create or open a project to manually extract data."
          action={{ label: 'Go to projects', onClick: () => router.push('/projects') }}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Manual Extraction" description="Manually extract data from documents">
      <PermissionGate permission="can_run_manual_extractions">
      {mode === 'extract' && selectedForm && selectedDoc ? (
        <SourcingProvider value={sourcingValue}>
        <ExtractionView
          form={selectedForm}
          doc={selectedDoc}
          documents={documents}
          docLabels={docLabels}
          formData={formData}
          aiPrefilledKeys={aiPrefilledKeys}
          aiPrefilledTablePrefill={aiPrefilledTablePrefill}
          tableErrors={tableErrors}
          extractionMode={extractionMode}
          doneDocs={doneDocs}
          partialDocs={partialDocs}
          saving={saving}
          queueOpen={queueOpen}
          hasNextDoc={!!nextUnextractedDoc}
          showAiToggle={hasAnyAiResults}
          reviewerRole={activeRole}
          onModeChange={handleModeChange}
          onFieldChange={handleFieldChange}
          onTableChange={handleTableChange}
          onSave={handleSave}
          draft={{ state: draftState, at: draftAt, onRetry: saveServerDraft }}
          onSaveAndNext={handleSaveAndNext}
          onReset={handleReset}
          onBack={handleBack}
          onToggleQueue={() => setQueueOpen(p => !p)}
          onSelectDoc={handleQueueDocSelect}
          forms={forms}
          formStates={activeFormStates}
          onSelectForm={handleSwitchForm}
          paperStatus={activeAssignment?.status ?? null}
          onSetPaperStatus={activeAssignment
            ? (next => handleSetAssignmentStatus(activeAssignment, next))
            : undefined}
          settingPaperStatus={!!activeAssignment && statusBusyId === activeAssignment.id}
          currentPage={currentPage}
          onPageChange={handleViewerPage}
          quoteText={activeQuote?.text ?? null}
          quotePage={activeQuote?.page ?? null}
          quoteFigureImage={activeQuote?.figureImage ?? null}
          quoteBoxes={activeQuote?.boxes ?? null}
          regionMode={regionMode}
          onRegionModeChange={setRegionMode}
          onSelectRegion={handleSelectRegion}
          onSelectQuote={handleSelectQuote}
          markers={sourceMarkers}
          onMarkerClick={handleMarkerClick}
          markerHint={markerHint}
          selectionTargetLabel={
            activeSourceKey ? describeKey(activeSourceKey)
            : unsourced.length > 0 ? describeKey(unsourced[0])
            : null
          }
          grouping={can_create_forms ? {
            savingField: savingGrouping,
            onSave: handleSaveGrouping,
            onSuggest: handleSuggestGrouping,
          } : undefined}
        />
        </SourcingProvider>
      ) : (
        <div className="space-y-3">

        {/* One switch for both perspectives. It replaces a "Browse all
            documents" link at the foot of the queue and a "← Back to my queue"
            button above the picker — two one-way doors where a tab pair says
            where you are.

            No sentence of prose beside it: DashboardLayout already prints
            "Manual Extraction — manually extract data from documents" directly
            above, and a second description wrapped in a narrow column with the
            tabs marooned across a full-width gap is what made this row read as
            broken. Left-aligned, so it reads as a tab bar for what follows. */}
        {canBrowseAll && (
          <div className="inline-flex gap-0.5 rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
            {([['queue', 'My queue'], ['browse', 'Browse all']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-semibold transition-all ${
                  view === key
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-[#2a2a2a] dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-zinc-500 dark:hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {view === 'queue' ? (
        <MyQueueView
          assignments={myAssignments}
          documents={documents}
          allDocuments={allDocuments}
          docLabels={docLabels}
          forms={forms}
          perDocFormStatus={myFormStatusByDoc}
          loading={loadingData || loadingAssignments}
          starting={starting}
          startingKey={startingKey}
          onStartForm={handleStartFormForDoc}
          onSetStatus={handleSetAssignmentStatus}
          statusBusyId={statusBusyId}
          onBrowseAll={() => setView('browse')}
          hasBrowseAll={canBrowseAll}
          grouping={can_create_forms ? {
            savingField: savingGrouping,
            onSave: handleSaveGrouping,
            onSuggest: handleSuggestGrouping,
          } : undefined}
        />
        ) : (
          <SelectionView
            forms={forms}
            documents={documents}
            docLabels={docLabels}
            selectedForm={selectedForm}
            selectedDoc={selectedDoc}
            formSearch={formSearch}
            docSearch={docSearch}
            loadingData={loadingData}
            starting={starting}
            doneDocs={doneDocs}
            onSelectForm={setSelectedForm}
            onSelectDoc={setSelectedDoc}
            onFormSearch={setFormSearch}
            onDocSearch={setDocSearch}
            onStart={handleStart}
            grouping={can_create_forms ? {
              savingField: savingGrouping,
              onSave: handleSaveGrouping,
              onSuggest: handleSuggestGrouping,
            } : undefined}
          />
        )}
        </div>
      )}
      </PermissionGate>
    </DashboardLayout>
  );
}

export default function ManualExtractionPage() {
  return (
    <Suspense>
      <ManualExtractionContent />
    </Suspense>
  );
}

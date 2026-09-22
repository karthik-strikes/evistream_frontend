'use client';

/**
 * Risk of bias — the reviewer's workspace and the manager's setup.
 *
 * Five screens live on one route, addressed by `?screen=`: **queue**, the six
 * **trial** questions, the per-result **assess** workspace, and the manager's
 * **setup** and **mapping**. They are URL-backed rather than local state so a
 * reload lands where the reviewer was and a link to a result actually opens it.
 *
 * Three rules run through all of it, and each replaces something the previous
 * version of this page got wrong.
 *
 * **The target is a result, not a paper.** Which results exist is a decision a
 * manager takes on the setup screen and the server stores; this page reads them
 * from `rob_results` rather than re-deriving them from column names on every
 * render.
 *
 * **Six of the 22 questions are about the trial.** They are answered once, on
 * their own screen, before the results — and every result of that trial reads
 * the same stored answer. Nothing is copied between assessments.
 *
 * **The judgement is derived.** `rob2.ts:judgeDomain` computes each domain's
 * label from the signalling answers; the reviewer may override it, but only
 * deliberately and with a reason, and both values are stored.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Download, FolderOpen, Loader2, Sparkles } from 'lucide-react';

import { DashboardLayout } from '@/components/layout';
import { EmptyState, Spinner } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { useToast } from '@/hooks/use-toast';
import {
  assignmentsService, documentsService, formsService, resultsService, robService,
} from '@/services';
import type { RobBuildResponse, RobDraftedAnswer } from '@/services/rob.service';
import { buildLabelMap } from '@/lib/documentLabel';
import { getErrorMessage } from '@/lib/utils';
import type { Document, ExtractionResult, Form } from '@/types/api';

import { ColumnMapper } from './_components/ColumnMapper';
import { DerivedJudgement } from './_components/DerivedJudgement';
import { CopyAnswers } from './_components/CopyAnswers';
import { DomainRail } from './_components/DomainRail';
import { RoutedBlock } from './_components/RoutedBlock';
import { TrialPicker } from './_components/TrialPicker';
import { ExportScreen } from './_components/ExportScreen';
import { HoldResolver } from './_components/HoldResolver';
import { OverallPanel } from './_components/OverallPanel';
import { QuestionCard, type AiSuggestion } from './_components/QuestionCard';
import { ResultHeader } from './_components/ResultHeader';
import { ResultQueue } from './_components/ResultQueue';
import { SetupScreen, type ContrastEdit } from './_components/SetupScreen';
import { StudyComparisons } from './_components/StudyComparisons';
import { TrialQuestions } from './_components/TrialQuestions';
import {
  ROB2_QUESTIONS, ROB2_SIGNALLING, isAsked, judgeDomain, judgeOverall, parseAnswer,
  unansweredIn, type AnswerCode, type Answers, type Severity,
} from './_lib/rob2';
import { bindForm, type BoundForm } from './_lib/robAdapter';
import {
  contrastLabel, isTrialQuestion, mergedAnswers, shortLabel, trialKey,
  trialOutstanding, TRIAL_QUESTIONS, type ResultIdentity,
} from './_lib/robIdentity';
import {
  buildQueue, overallOf, progressOf, severitiesOf, questionState, SEVERITY_SHORT,
} from './_lib/robQueue';
import { matchesFilter, type QueueFilter } from './_components/ResultQueue';
import { bindSignalling, type SignallingBinding } from './_lib/robSignalling';
import {
  EMPTY_TRIAL, emptyAssessment, readResult, readTrial, reopenForChangedTrial,
  rowForResult, writeResult, writeTrial,
  type ResultAssessment, type TrialRecord,
} from './_lib/robStore';
import { presetFormDescription, presetFormFields, presetFormName, ROB2 } from './_lib/robTools';

type Screen = 'queue' | 'trial' | 'trial-picker' | 'assess' | 'setup' | 'mapping'
  | 'comparisons' | 'export';

const SCREENS: Screen[] = [
  'queue', 'trial', 'trial-picker', 'assess', 'setup', 'mapping', 'comparisons', 'export',
];

/** Which extraction a document's assessment should be read from, best first. */
const SOURCE_RANK: Record<string, number> = { consensus: 3, manual: 2, ai: 1 };

/**
 * Why nothing on this screen can be edited.
 *
 * A disabled control with no explanation is the worst state a page can be in:
 * the reviewer cannot tell a permission problem from a broken button. Shown on
 * every screen that can be read-only, not just the assessment one — the trial
 * questions greyed out silently, which is exactly how this was found.
 */
function ReadOnlyNote() {
  return (
    <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-gray-500/5 rounded-xl px-3 py-2.5 text-[12.5px] text-gray-700 dark:text-zinc-300">
      <span>
        <strong>Read-only.</strong> Recording a risk-of-bias assessment needs the
        &ldquo;run manual extractions&rdquo; permission on this project. Ask a project owner to
        grant it from Members &amp; access.
      </span>
    </div>
  );
}

/** Where each of the 22 questions is stored in a form, or null if it cannot hold them. */
function bindingFor(bound: BoundForm): SignallingBinding | null {
  const table = bound.tableField
    ? (bound.form.fields ?? []).find(f => f?.field_name === bound.tableField)
    : null;
  const fields = table ? (table.subform_fields ?? []) : (bound.form.fields ?? []);
  const binding = bindSignalling(fields as any);
  return binding.usable ? binding : null;
}

function RiskOfBiasWorkspace() {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? '';
  const { currentUser, isAdmin } = useAuth();
  const permissions = useProjectPermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── Where we are ───────────────────────────────────────────────────────────

  const screenParam = searchParams.get('screen') ?? '';
  const screen: Screen = (SCREENS as string[]).includes(screenParam)
    ? (screenParam as Screen) : 'queue';
  const activeResultId = searchParams.get('result') ?? '';
  const activeDocId = searchParams.get('study') ?? '';
  const domainIndex = Math.min(5, Math.max(0, Number(searchParams.get('domain') ?? 0) || 0));
  const mappingFormId = searchParams.get('form') ?? '';

  /**
   * Move to another screen, or change something within one.
   *
   * **Changing screen or result is a navigation; everything else is not.** The
   * first version replaced the history entry every time, so Queue → Setup →
   * Queue → Setup all shared one entry and pressing Back left the page
   * altogether, landing on the dashboard. Moving between screens is exactly the
   * kind of step somebody expects Back to undo.
   *
   * Picking a domain tab or a form to map stays a replace: those are positions
   * within a screen, and pushing each one would make Back walk through twenty
   * tiny states before it got anywhere.
   */
  const go = useCallback((next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;

    const movedScreen = 'screen' in next
      && (next.screen || 'queue') !== (searchParams.get('screen') || 'queue');
    const movedResult = 'result' in next && next.result !== searchParams.get('result');

    if (movedScreen || movedResult) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }, [router, pathname, searchParams]);

  /** Which screen sent the reviewer to `comparisons`, so Back returns there. */
  const cameFrom = searchParams.get('from') ?? '';

  // ── Data ───────────────────────────────────────────────────────────────────

  const { data: forms = [], isLoading: formsLoading } = useQuery({
    queryKey: ['rob-forms', projectId],
    queryFn: async () => {
      const all = await formsService.getAll(projectId);
      return (all as Form[]).filter(f => f.status === 'active' || f.status === 'draft');
    },
    enabled: !!projectId,
  });

  /**
   * The form that stores RoB 2 answers, and where each question lives in it.
   *
   * Both may be null, and that is not a state a reviewer is shown. Which
   * results exist comes from the result registry, not from a form, so the queue
   * and the assessment screens work with no RoB 2 form in the project at all —
   * the form is created on the first save (`ensureForm`), from a preset with no
   * choices in it. Making it a precondition put a wall in front of the page
   * explaining a storage detail nobody had asked about.
   *
   * A RoB 2 form that cannot hold the 22 questions is not this form. It is one
   * of the flat ones, and it belongs with the other judgement-only forms below.
   */
  const [robForm, binding] = useMemo<[BoundForm | null, SignallingBinding | null]>(() => {
    for (const form of forms as Form[]) {
      const bound = bindForm(form);
      if (!bound || bound.tool.id !== 'rob2') continue;
      const questions = bindingFor(bound);
      if (questions) return [bound, questions];
    }
    return [null, null];
  }, [forms]);

  const robFormId = robForm?.form.id ?? '';

  const { data: registry, isLoading: registryLoading } = useQuery({
    queryKey: ['rob-registry', projectId],
    queryFn: () => robService.listResults(projectId),
    enabled: !!projectId,
  });

  const { data: build, isFetching: buildLoading } = useQuery<RobBuildResponse>({
    queryKey: ['rob-build', projectId],
    queryFn: () => robService.buildResults(projectId),
    // Derived on demand: it reads every outcome extraction in the project, and
    // a reviewer working through their queue never needs it.
    // Also on `comparisons`: that screen now shows which candidate rows this
    // study is holding, and they only exist in the build.
    enabled: !!projectId
      && (screen === 'setup' || screen === 'mapping' || screen === 'comparisons'),
    staleTime: 60_000,
  });

  const { data: assessments = [], isLoading: assessmentsLoading } = useQuery({
    queryKey: ['rob-assessments', projectId, robFormId],
    queryFn: () => resultsService.getAllForForm(projectId, robFormId),
    enabled: !!projectId && !!robFormId,
  });

  const { data: docs = [] } = useQuery({
    queryKey: ['rob-docs', projectId],
    queryFn: () => documentsService.getAll(projectId),
    enabled: !!projectId,
  });

  /**
   * Which documents have a finished adjudication.
   *
   * Consensus is stored per (document, form) and the risk-of-bias record holds
   * every result of a document in one row, so a completed adjudication covers
   * all of them — the only reason a document-level fact is allowed onto a
   * result-level row. Failures are swallowed: a queue that will not render
   * because a summary endpoint is unhappy is worse than one without a badge.
   */
  const { data: consensusSummary } = useQuery({
    queryKey: ['rob-consensus', projectId, robFormId],
    queryFn: () => resultsService.getConsensusSummary(projectId, robFormId!)
      .catch(() => null),
    enabled: !!projectId && !!robFormId,
    staleTime: 60_000,
  });

  const agreedDocuments = useMemo(() => {
    const out = new Set<string>();
    for (const doc of ((consensusSummary as any)?.documents ?? [])) {
      if (doc?.has_adjudication_completed && doc?.document_id) {
        out.add(String(doc.document_id));
      }
    }
    return out;
  }, [consensusSummary]);

  const { data: myAssignments = [] } = useQuery({
    queryKey: ['rob-assignments', projectId],
    queryFn: () => assignmentsService.getMyAssignments({ projectId }),
    enabled: !!projectId,
  });

  const docLabels = useMemo(() => buildLabelMap(docs as Document[]), [docs]);

  /** document → the seat I hold on it. Without one an assessment is read-only. */
  const seats = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of myAssignments as any[]) {
      if (a.status !== 'skipped' && a.reviewer_role) map.set(a.document_id, a.reviewer_role);
    }
    return map;
  }, [myAssignments]);

  /** My own saved record per document — what a save must build on. */
  const myRecordByDoc = useMemo(() => {
    const map = new Map<string, ExtractionResult>();
    for (const row of assessments as ExtractionResult[]) {
      if (row.extraction_type !== 'manual') continue;
      // Mine is the row I wrote, not the row wearing my seat's label. Keying on
      // the seat dropped every assessment by someone holding none, so each save
      // started from a blank slate and discarded what they had already judged.
      if (currentUser?.id && row.extracted_by !== currentUser.id) continue;
      const current = map.get(row.document_id);
      if (!current || row.created_at > current.created_at) map.set(row.document_id, row);
    }
    return map;
  }, [assessments, currentUser?.id]);

  /** What I am shown: my own work, else the best available. */
  const shownByDoc = useMemo(() => {
    const best = new Map<string, ExtractionResult>();
    for (const row of assessments as ExtractionResult[]) {
      const rank = SOURCE_RANK[row.extraction_type] ?? 0;
      const current = best.get(row.document_id);
      const currentRank = current ? SOURCE_RANK[current.extraction_type] ?? 0 : -1;
      if (rank > currentRank || (rank === currentRank && current && row.created_at > current.created_at)) {
        best.set(row.document_id, row);
      }
    }
    for (const [documentId, mine] of myRecordByDoc) best.set(documentId, mine);
    return best;
  }, [assessments, myRecordByDoc]);

  // ── The registry, as identities ────────────────────────────────────────────

  const results: ResultIdentity[] = useMemo(() => {
    const contrasts = new Map((registry?.contrasts ?? []).map(c => [c.id, c]));
    return (registry?.results ?? []).map(r => ({
      ...r,
      contrast: r.contrast_id ? contrasts.get(r.contrast_id) ?? null : null,
    })) as ResultIdentity[];
  }, [registry]);

  const resultById = useMemo(
    () => new Map(results.map(r => [r.id, r])), [results],
  );

  /** Every contrast declared on a study, for resolving a held result. */
  const contrastsByDocument = useMemo(() => {
    const map = new Map<string, typeof registry extends undefined ? never : NonNullable<typeof registry>['contrasts']>();
    for (const contrast of registry?.contrasts ?? []) {
      const list = map.get(contrast.document_id) ?? [];
      list.push(contrast);
      map.set(contrast.document_id, list);
    }
    return map;
  }, [registry]);

  // ── Stored assessments, read back ──────────────────────────────────────────

  /**
   * `study:contrast` → that comparison's six trial answers.
   *
   * Keyed on the comparison, not the study: 2.1-2.3 ask who knew the assigned
   * intervention, and one arm of a multi-arm trial can be blinded while another
   * is open-label.
   */
  const trialByComparison = useMemo(() => {
    const map = new Map<string, TrialRecord>();
    if (!binding) return map;
    for (const result of results) {
      const record = shownByDoc.get(result.document_id);
      if (!record) continue;
      const key = trialKey(result);
      if (map.has(key)) continue;
      map.set(key, readTrial(record.extracted_data, binding, result.contrast?.id ?? ''));
    }
    return map;
  }, [results, shownByDoc, binding]);

  const assessmentByResult = useMemo(() => {
    const map = new Map<string, ResultAssessment>();
    if (!binding || !robForm) return map;
    const domains = robForm.domains.filter(d => !d.extra);
    for (const result of results) {
      const record = shownByDoc.get(result.document_id);
      if (!record) continue;
      const row = rowForResult(record.extracted_data, result.id, shortLabel(result),
        robForm.tableField ?? undefined);
      if (!row) continue;
      map.set(result.id, readResult(row, binding, domains, robForm.tool));
    }
    return map;
  }, [results, shownByDoc, binding, robForm]);

  // ── The queue ──────────────────────────────────────────────────────────────

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<QueueFilter>('all');

  const groups = useMemo(() => buildQueue({
    results, trialByComparison, assessmentByResult, labels: docLabels, seats,
    agreedDocuments,
  }), [results, trialByComparison, assessmentByResult, docLabels, seats, agreedDocuments]);

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups
      .map(g => ({
        ...g,
        results: g.results.filter(r => {
          if (!matchesFilter(r, filter)) return false;
          if (!needle) return true;
          return g.label.toLowerCase().includes(needle)
            || r.label.toLowerCase().includes(needle);
        }),
      }))
      .filter(g => g.results.length > 0);
  }, [groups, query, filter]);

  /**
   * How many results each filter would show — rendered on the chip itself.
   *
   * A filter whose count a reviewer cannot see before pressing it is a guess:
   * they press "Blocked", get nothing, and cannot tell whether that means all
   * clear or a broken filter.
   */
  const filterCounts = useMemo(() => {
    const rows = groups.flatMap(g => g.results);
    const count = (f: QueueFilter) => rows.filter(r => matchesFilter(r, f)).length;
    return {
      all: rows.length, mine: count('mine'), trial: count('trial'),
      blocked: count('blocked'), complete: count('complete'),
    } as Record<QueueFilter, number>;
  }, [groups]);

  /**
   * Studies with outcome rows but no comparison on record.
   *
   * They have no results yet — a result needs a comparison — so they appear
   * nowhere in the queue's table. Left at that they are invisible work: the
   * reviewer sees a short queue and no reason for it.
   */
  const comparisonNeeded = useMemo(() => {
    const out: Array<{
      documentId: string; label: string; arms: number;
      rows: Array<{ outcome: string; timepoint: string; source: string }>;
    }> = [];
    for (const [documentId, list] of contrastsByDocument) {
      if (list.some(c => c.intervention)) continue;
      const arms = Math.max(...list.map(c => (c.arms ?? []).length), 0);
      if (arms < 2) continue;
      // Which rows are actually waiting, when the build happens to be in
      // cache. The build query stays DISABLED on this screen on purpose — it
      // reads every outcome extraction in the project — so this enriches the
      // section for a manager who has been to setup and leaves it as a count
      // for a reviewer who has not. Never a reason to fetch it.
      const rows = (build?.results ?? [])
        .filter(r => r.document_id === documentId && r.state === 'held')
        .map(r => ({
          outcome: r.outcome_domain ?? '',
          timepoint: r.timepoint ?? '',
          source: String((r as any).source_form_name ?? ''),
        }));
      out.push({ documentId, label: docLabels[documentId] ?? documentId, arms, rows });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [contrastsByDocument, docLabels, build]);

  // ── The assessment being edited ────────────────────────────────────────────

  const activeResult = activeResultId ? resultById.get(activeResultId) ?? null : null;
  const documentId = activeResult?.document_id || activeDocId;
  const studyResults = useMemo(
    () => results.filter(r => r.document_id === documentId),
    [results, documentId],
  );
  const positionInStudy = activeResult
    ? studyResults.findIndex(r => r.id === activeResult.id) + 1 : 0;

  const seat = documentId ? seats.get(documentId) ?? null : null;

  /**
   * Who may record an assessment, and what holding a seat actually decides.
   *
   * The permission, not the seat. This page required a `review_assignments` row
   * on the study and greyed every control out without one — which locked out the
   * project owner, and said nothing about why. That is also not how the rest of
   * the app works: manual extraction gates on `can_run_manual_extractions` and
   * keys each record on the PERSON, so anyone with the permission can record
   * their own work and only the assigned R1/R2 are compared with each other.
   * Risk of bias follows the same rule, for the same reason.
   *
   * The seat still decides how the assessment is labelled — R1, R2, or an
   * additional assessment that is recorded but not part of the comparison.
   */
  const canEdit = isAdmin || permissions.isOwner || !!permissions.can_run_manual_extractions;

  const [trialDraft, setTrialDraft] = useState<TrialRecord>(EMPTY_TRIAL);
  const [assessDraft, setAssessDraft] = useState<ResultAssessment>(emptyAssessment());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * The last save's outcome, shown in the header.
   *
   * A toast is gone in five seconds; a reviewer who looks up mid-assessment has
   * no way to tell whether their last twenty answers are stored. This is the
   * standing answer to that question — and the one state that matters most is
   * the failure, which a dismissed toast hides completely.
   */
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [savedAt, setSavedAt] = useState<string>('');

  // Loading a different study or result replaces the drafts. `loadedKey` keeps
  // that from also firing on every refetch, which would throw away edits made
  // in the seconds after a background query resolved.
  const loadedKey = useRef('');
  useEffect(() => {
    const key = `${documentId}|${activeResultId}`;
    if (!documentId || loadedKey.current === key) return;
    loadedKey.current = key;
    const scope = activeResult
      ? trialKey(activeResult) : `${documentId}:`;
    setTrialDraft(trialByComparison.get(scope) ?? EMPTY_TRIAL);
    setAssessDraft(
      (activeResultId ? assessmentByResult.get(activeResultId) : null) ?? emptyAssessment(),
    );
    setDirty(false);
  }, [documentId, activeResultId, activeResult, trialByComparison, assessmentByResult]);

  const merged = useMemo(
    () => mergedAnswers(trialDraft.answers, assessDraft.answers),
    [trialDraft.answers, assessDraft.answers],
  );

  const derived = useMemo(
    () => ROB2_SIGNALLING.map((_, i) => judgeDomain(i, merged)), [merged],
  );

  const severities = useMemo(
    () => severitiesOf(assessDraft, merged), [assessDraft, merged],
  );

  const overall = useMemo(() => judgeOverall(severities.map(s => (s === 'none' ? null : s))),
    [severities]);

  const unansweredByDomain = useMemo(
    () => ROB2_SIGNALLING.map((_, i) => unansweredIn(i, merged)), [merged],
  );

  /**
   * Where everybody else's assessment of THIS result stands.
   *
   * The rail used to state `Second reviewer · Hidden until you finish` and
   * `Consensus · Not agreed` as literal strings — the same two words on every
   * result of every project, whatever was actually true. A status that cannot
   * change is not a status.
   *
   * Derived from the records already loaded, so it costs nothing and it obeys
   * blinding for free: the server filters `assessments` for the reader's seat,
   * so a reviewer who may not see their counterpart's work simply sees no row
   * for them — rather than a sentence claiming to know how far along they are.
   */
  const othersOnResult = useMemo(() => {
    if (!activeResult || !binding || !robForm) return [];
    const out: Array<[string, string]> = [];
    for (const record of assessments as ExtractionResult[]) {
      if (record.extraction_type !== 'manual') continue;
      if (record.document_id !== activeResult.document_id) continue;
      if (currentUser?.id && record.extracted_by === currentUser.id) continue;
      const row = rowForResult(record.extracted_data, activeResult.id);
      if (!row) continue;
      const theirs = readResult(
        row, binding, robForm.domains.filter(d => !d.extra), robForm.tool);
      if (!Object.keys(theirs.answers).length && !theirs.complete) continue;
      // NOT `reviewer_role`: on a result row that field is not the seat its
      // author holds, and four readers that trusted it lost reviewers' finished
      // work. A name if the payload carries one, and otherwise nothing that
      // claims to know who this is.
      const who = String((record as any).reviewer_name
        || (record as any).extracted_by_name || '').trim() || 'Another reviewer';
      out.push([who, theirs.complete ? '✓ Complete' : 'In progress']);
    }
    return out;
  }, [assessments, activeResult, binding, robForm, currentUser?.id]);

  const domainCounts = useMemo(() => ROB2_SIGNALLING.map(domain => {
    const states = domain.questions.map(q => questionState(q, merged));
    const asked = domain.questions.filter((_, i) => states[i] === 'asked');
    return {
      answered: asked.filter(q => merged[q.id]).length,
      applicable: asked.length,
      mayGrow: states.includes('waiting'),
    };
  }), [merged]);

  const readOnly = !canEdit || assessDraft.complete || activeResult?.state === 'held';

  /**
   * Whether AI suggestions are offered here.
   *
   * The project's "hide AI results" switch exists so the model's answer cannot
   * anchor an independent reader's judgement — so it applies to the people doing
   * that reading, R1 and R2, and to nobody else. `blinding_service._READER_ROLES`
   * is where that rule lives on the server; this had hidden the AI from
   * everyone, including the owner who turned the switch on, and said nothing
   * about why it had vanished.
   */
  const hideAi = !!selectedProject?.review_settings?.hide_ai_results
    && (seat === 'reviewer_1' || seat === 'reviewer_2');
  const showAi = !hideAi;

  /** What the header says about the seat, and why the screen may be read-only. */
  const seatLabel = seat
    ? `${{ reviewer_1: 'R1', reviewer_2: 'R2', adjudicator: 'Adjudicator' }[seat] ?? seat} · you`
    : canEdit
      // Recorded, and visibly not part of the two-reviewer comparison. Silently
      // filing it as a reviewer's would misreport the agreement.
      ? 'No seat · recorded as an additional assessment'
      : 'Read only';

  // ── AI drafts ──────────────────────────────────────────────────────────────

  const [copying, setCopying] = useState(false);

  /**
   * Take another result's answers for this domain, recording that they were
   * copied.
   *
   * Only the questions this domain asks, and only where this result has no
   * answer already — a copy must never overwrite a judgement somebody made
   * looking at this estimate.
   */
  const copyFromSibling = useCallback((fromResultId: string, domainIndex: number) => {
    const from = assessmentByResult.get(fromResultId);
    const fromTrialRecord = (() => {
      const r = resultById.get(fromResultId);
      return r ? trialByComparison.get(trialKey(r)) : undefined;
    })();
    if (!from) return;
    const available = mergedAnswers(fromTrialRecord?.answers ?? {}, from.answers);

    setAssessDraft(prev => {
      const answers = { ...prev.answers };
      const rationale = { ...prev.rationale };
      const sources = { ...prev.sources };
      const origins = { ...prev.origins };
      let taken = 0;

      for (const question of ROB2_SIGNALLING[domainIndex].questions) {
        if (isTrialQuestion(question.id)) continue;   // those are shared already
        if (answers[question.id]) continue;           // never overwrite
        const value = available[question.id];
        if (!value) continue;
        answers[question.id] = value;
        if (from.rationale[question.id]) rationale[question.id] = from.rationale[question.id];
        if (from.sources[question.id]) sources[question.id] = from.sources[question.id];
        origins[question.id] = {
          copiedFrom: fromResultId, copiedAt: new Date().toISOString(), editedSince: false,
        };
        taken += 1;
      }

      if (taken === 0) {
        toast({
          title: 'Nothing to copy',
          description: 'Every question this domain asks already has an answer here, and a copy '
            + 'never overwrites one you made.',
          variant: 'warning',
        });
        return prev;
      }
      toast({
        title: `${taken} answer${taken === 1 ? '' : 's'} copied`,
        description: 'Each is recorded as copied, and stays recorded if you edit it.',
        variant: 'success',
      });
      return { ...prev, answers, rationale, sources, origins };
    });
    setDirty(true);
    setCopying(false);
  }, [assessmentByResult, resultById, trialByComparison, toast]);

  const [drafting, setDrafting] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, AiSuggestion | null>>({});
  const [notFound, setNotFound] = useState<Set<string>>(new Set());

  // A draft belongs to one result. Clearing it on navigation is what stops the
  // model's answer about pain-at-6-hours being offered for nausea-at-24.
  useEffect(() => {
    setSuggestions({});
    setNotFound(new Set());
    setCopying(false);
  }, [activeResultId, documentId]);

  const draftWithAi = useCallback(async () => {
    if (!activeResult || !robFormId) return;
    setDrafting(true);
    try {
      const response = await robService.draft({
        document_id: activeResult.document_id,
        form_id: robFormId,
        result_id: activeResult.id,
        result_version: activeResult.version ?? undefined,
        context: {
          outcome: activeResult.outcome_domain,
          timepoint: activeResult.timepoint,
          measurement: activeResult.measurement,
          comparison: contrastLabel(activeResult.contrast),
          effect: activeResult.estimate,
        },
      });

      const next: Record<string, AiSuggestion | null> = {};
      for (const answer of response.answers as RobDraftedAnswer[]) {
        const parsed = parseAnswer(answer.answer);
        if (!parsed || parsed === 'NA') continue;
        next[answer.question_id] = {
          answer: parsed,
          quote: answer.quote,
          locator: answer.locator,
          rationale: answer.rationale,
        };
      }
      setSuggestions(next);
      setNotFound(new Set(response.not_found ?? []));

      toast({
        title: `${Object.keys(next).length} suggestions ready`,
        // Nothing has been answered. The reviewer presses Use suggestion on each
        // one they accept — which is the only way an answer's author stays
        // knowable after the page reloads.
        description: response.note
          || 'Nothing was answered for you. Each suggestion has a Use suggestion button.',
        variant: response.failed.length ? 'warning' : 'success',
      });
    } catch (e) {
      toast({ title: 'Could not draft', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setDrafting(false);
    }
  }, [activeResult, robFormId, toast]);

  // ── Editing ────────────────────────────────────────────────────────────────

  /**
   * Take one answer back out, and re-route on what is left.
   *
   * Not the same as answering "No information": that is a finding about the
   * paper. This is a reviewer saying they have not decided yet, which has to
   * be reachable because the answers drive the routing — a mis-click decides
   * which questions come next and there was no way to undo it.
   */
  const clearAnswer = useCallback((id: string, onTrial: boolean) => {
    const prune = (answers: Answers): Answers => {
      const next: Answers = { ...answers };
      delete next[id];
      for (const question of ROB2_QUESTIONS) {
        if (!isAsked(question, next)) delete next[question.id];
      }
      return next;
    };
    if (onTrial) {
      setTrialDraft(prev => ({
        ...prev,
        answers: prune({ ...prev.answers, ...assessDraft.answers }) as Answers,
        evidence: { ...prev.evidence, [id]: { state: 'not_found', quote: '', locator: '', rationale: '' } },
      }));
    } else {
      setAssessDraft(prev => {
        const full = prune(mergedAnswers(trialDraft.answers, prev.answers));
        const own: Answers = {};
        for (const key of Object.keys(full)) {
          if (!isTrialQuestion(key)) own[key] = full[key];
        }
        return {
          ...prev,
          answers: own,
          confirmed: prev.confirmed.map((c, i) =>
            (ROB2_QUESTIONS.find(q => q.id === id)?.domain === i ? false : c)),
          evidence: { ...prev.evidence, [id]: { state: 'not_found', quote: '', locator: '', rationale: '' } },
        };
      });
    }
    setDirty(true);
  }, [assessDraft.answers, trialDraft.answers]);

  const answerQuestion = useCallback((
    id: string, code: AnswerCode, origin: 'own' | 'ai', onTrial: boolean,
  ) => {
    const apply = (answers: Answers): Answers => {
      const next: Answers = { ...answers, [id]: code };
      // Routing is recomputed from the new answers and anything it no longer
      // asks is dropped. Keeping a stale answer would feed `judgeDomain` a
      // response nobody stands behind.
      for (const question of ROB2_QUESTIONS) {
        if (!isAsked(question, next)) delete next[question.id];
      }
      return next;
    };

    const suggestion = suggestions[id];
    if (onTrial) {
      setTrialDraft(prev => ({
        ...prev,
        answers: apply({ ...prev.answers, ...assessDraft.answers }) as Answers,
        evidence: {
          ...prev.evidence,
          [id]: origin === 'ai' && suggestion
            ? { state: suggestion.quote ? 'quoted' : 'inferred', quote: suggestion.quote,
                locator: suggestion.locator, rationale: suggestion.rationale }
            : { state: 'not_found', quote: '', locator: '', rationale: '' },
        },
      }));
    } else {
      setAssessDraft(prev => {
        const full = apply(mergedAnswers(trialDraft.answers, prev.answers));
        const own: Answers = {};
        for (const key of Object.keys(full)) {
          if (!isTrialQuestion(key)) own[key] = full[key];
        }
        // A copied answer that has since been edited is a third thing: not
        // typed here, not still what was copied. Consensus needs to know.
        const origins = { ...prev.origins };
        if (origins[id]?.copiedFrom && origin === 'own') {
          origins[id] = { ...origins[id], editedSince: true };
        }
        return {
          ...prev,
          origins,
          answers: own,
          // Changing an answer invalidates the domain's confirmation — the
          // reviewer confirmed a judgement that no longer follows.
          confirmed: prev.confirmed.map((c, i) =>
            (ROB2_QUESTIONS.find(q => q.id === id)?.domain === i ? false : c)),
          evidence: {
            ...prev.evidence,
            [id]: origin === 'ai' && suggestion
              ? { state: suggestion.quote ? 'quoted' : 'inferred', quote: suggestion.quote,
                  locator: suggestion.locator, rationale: suggestion.rationale }
              : { state: 'not_found', quote: '', locator: '', rationale: '' },
          },
        };
      });
    }
    setDirty(true);
  }, [suggestions, trialDraft.answers, assessDraft.answers]);

  const setRationale = useCallback((id: string, text: string, onTrial: boolean) => {
    if (onTrial) setTrialDraft(prev => ({ ...prev, rationale: { ...prev.rationale, [id]: text } }));
    else setAssessDraft(prev => ({ ...prev, rationale: { ...prev.rationale, [id]: text } }));
    setDirty(true);
  }, []);

  // ── Saving ─────────────────────────────────────────────────────────────────

  /**
   * The form these answers go in, creating it if the project has none.
   *
   * RoB 2's storage is a preset with nothing to decide in it — every question
   * gets a column, in the tool's own wording and version — so asking somebody
   * to press a button first was asking them to confirm a fact. It is made here,
   * at the moment there is something to put in it.
   */
  const ensureForm = useCallback(async (): Promise<
    { form: BoundForm; questions: SignallingBinding } | null
  > => {
    if (robForm && binding) return { form: robForm, questions: binding };
    const created = await formsService.create({
      project_id: projectId,
      form_name: presetFormName(ROB2),
      form_description: presetFormDescription(ROB2),
      fields: presetFormFields(ROB2) as any,
      // A data-entry schema for reviewers needs no extraction code generated for
      // it, and generating some would cost a codegen run nobody asked for.
      save_as_draft: true,
    });
    await queryClient.invalidateQueries({ queryKey: ['rob-forms', projectId] });
    const bound = bindForm(created as Form);
    const questions = bound ? bindingFor(bound) : null;
    return bound && questions ? { form: bound, questions } : null;
  }, [robForm, binding, projectId, queryClient]);

  const persist = useCallback(async (
    trial: TrialRecord, assessment: ResultAssessment, note?: string,
    reopenSiblings?: Set<string>,
  ) => {
    if (!documentId) return;
    setSaving(true);
    try {
      const storage = await ensureForm();
      if (!storage) {
        throw new Error(
          'Could not create somewhere to store the answers. You may not have permission to '
          + 'add a form to this project — ask a review manager to open this page once.',
        );
      }
      const { form: activeForm, questions } = storage;
      // Build on MY own previous record, so a save can never overwrite another
      // reviewer's work with a copy of theirs.
      const mine = myRecordByDoc.get(documentId);
      // Into this comparison's zone. A result whose comparison is not settled
      // has none, and falls back to the root — where these used to live.
      let data = writeTrial(mine?.extracted_data, questions, trial,
        activeResult?.contrast?.id ?? '');

      if (activeResult) {
        const view = mergedAnswers(trial.answers, assessment.answers);
        data = writeResult(data, questions,
          activeForm.domains.filter(d => !d.extra), activeForm.tool, {
          resultId: activeResult.id,
          label: shortLabel(activeResult),
          resultVersion: activeResult.version ?? null,
          assessment,
          merged: view,
          severities: severitiesOf(assessment, view),
          tableField: activeForm.tableField ?? undefined,
        });
      }

      // Reviews that stood on shared answers which have just changed reopen —
      // their D1/D2 judgements came out of a derivation that no longer exists.
      let reopened: string[] = [];
      if (reopenSiblings?.size) {
        const out = reopenForChangedTrial(
          data, reopenSiblings, activeForm.tableField ?? undefined);
        data = out.data;
        reopened = out.reopened;
      }

      await resultsService.saveManualExtraction({
        document_id: documentId,
        form_id: activeForm.form.id,
        extracted_data: data,
        extraction_type: 'manual',
        reviewer_role: seat ?? null,
      });
      setDirty(false);
      setSaveState('saved');
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      if (reopened.length) {
        toast({
          title: `${reopened.length} completed review${reopened.length === 1 ? '' : 's'} reopened`,
          description: 'They were judged on the shared answers you just changed, so they need '
            + 'another look. Nothing was deleted.',
          variant: 'warning',
        });
      } else if (note) {
        toast({ title: note, variant: 'success' });
      }
      await queryClient.invalidateQueries({
        queryKey: ['rob-assessments', projectId, activeForm.form.id],
      });
    } catch (e) {
      setSaveState('failed');
      toast({ title: 'Save failed', description: getErrorMessage(e), variant: 'error' });
      throw e;
    } finally {
      setSaving(false);
    }
  }, [ensureForm, documentId, myRecordByDoc, activeResult, seat, toast,
    queryClient, projectId]);

  const saveIfDirty = useCallback(async () => {
    if (!dirty || !canEdit) return;
    try { await persist(trialDraft, assessDraft); } catch { /* reported by persist */ }
  }, [dirty, canEdit, persist, trialDraft, assessDraft]);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const openTrial = useCallback(async (docId: string, contrastId = '') => {
    await saveIfDirty();
    // Trial answers are stored per study AND comparison. With several and none
    // named, which one is a question for the reviewer — answering it by taking
    // whichever sorted first is how the wrong comparison's answers got edited.
    if (!contrastId) {
      const ids = new Set(results
        .filter(r => r.document_id === docId)
        .map(r => r.contrast?.id ?? ''));
      if (ids.size > 1) {
        go({ screen: 'trial-picker', study: docId, result: null, domain: null });
        return;
      }
    }
    // Trial answers belong to a comparison, so opening them means opening one
    // of that study's results that HAS that comparison.
    const first = results.find(r => r.document_id === docId
      && (!contrastId || r.contrast?.id === contrastId))
      ?? results.find(r => r.document_id === docId);
    go({ screen: 'trial', study: docId, result: first?.id ?? null, domain: null });
  }, [saveIfDirty, results, go]);

  const openResult = useCallback(async (resultId: string) => {
    await saveIfDirty();
    const result = resultById.get(resultId);
    if (!result) return;
    const trial = trialByComparison.get(trialKey(result));
    go({
      // The six come first. Dropping a reviewer into D3 of a result whose
      // randomisation questions are blank makes them navigate backwards to start.
      screen: trial?.complete ? 'assess' : 'trial',
      study: result.document_id,
      result: resultId,
      domain: '0',
    });
  }, [saveIfDirty, resultById, trialByComparison, go]);

  const stepResult = useCallback(async (delta: number) => {
    if (!activeResult) return;
    const index = studyResults.findIndex(r => r.id === activeResult.id);
    const next = studyResults[index + delta];
    if (!next) return;
    await saveIfDirty();
    go({ result: next.id, domain: '0' });
  }, [activeResult, studyResults, saveIfDirty, go]);

  // ── Manager actions ────────────────────────────────────────────────────────

  /**
   * Comparison decisions a manager takes before anything is created.
   *
   * Held locally, keyed by study, and applied when the results are created —
   * so the whole setup is one pass: untick a form, settle a comparison, press
   * Create. Committing first and correcting afterwards would mean creating
   * results that are wrong on purpose.
   */
  const [contrastEdits, setContrastEdits] = useState<Record<string, ContrastEdit[]>>({});
  const editContrast = useCallback((documentId: string, edits: ContrastEdit[] | null) => {
    setContrastEdits(prev => {
      const next = { ...prev };
      if (edits && edits.length) next[documentId] = edits;
      else delete next[documentId];
      return next;
    });
  }, []);

  const [committing, setCommitting] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [pendingSources, setPendingSources] = useState<Set<string>>(new Set());
  const canManage = isAdmin || permissions.isOwner || !!permissions.can_create_forms;

  /** How many results point at each comparison — a comparison in use cannot go. */
  const resultsPerContrast = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) {
      if (r.contrast?.id) counts[r.contrast.id] = (counts[r.contrast.id] ?? 0) + 1;
    }
    return counts;
  }, [results]);

  const [savingComparison, setSavingComparison] = useState(false);

  const addComparison = useCallback(async (
    documentId: string, intervention: string, comparator: string,
  ) => {
    setSavingComparison(true);
    try {
      const existing = contrastsByDocument.get(documentId) ?? [];
      // An unresolved placeholder IS this study's empty comparison slot. Naming
      // its arms fills it in; writing a new row beside it would leave a phantom
      // that can never be resolved, because resolving it collides on the pair.
      const placeholder = existing.find(c => !c.intervention);
      if (placeholder) {
        await robService.patchContrast(placeholder.id, {
          intervention, comparator, state: 'auto',
        });
      } else {
        await robService.commitResults(projectId, [], [{
          id: '', project_id: projectId, document_id: documentId,
          intervention, comparator, state: 'auto', source: 'manual',
          canonical_key: null, arms: existing[0]?.arms ?? [],
        } as any]);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rob-registry', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['rob-build', projectId] }),
      ]);
    } catch (e) {
      toast({ title: 'Could not add the comparison',
              description: getErrorMessage(e), variant: 'error' });
    } finally {
      setSavingComparison(false);
    }
  }, [contrastsByDocument, projectId, queryClient, toast]);

  const swapComparison = useCallback(async (contrastId: string) => {
    const contrast = (registry?.contrasts ?? []).find(c => c.id === contrastId);
    if (!contrast) return;
    setSavingComparison(true);
    try {
      await robService.patchContrast(contrastId, {
        intervention: contrast.comparator, comparator: contrast.intervention,
      });
      toast({
        title: 'Direction swapped',
        description: 'Every estimate pointing at this comparison now reads the other way.',
        variant: 'success',
      });
      await queryClient.invalidateQueries({ queryKey: ['rob-registry', projectId] });
    } catch (e) {
      toast({ title: 'Could not swap it', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setSavingComparison(false);
    }
  }, [registry, projectId, queryClient, toast]);

  /**
   * Remove a comparison that should never have been proposed.
   *
   * The server lets the foreign key answer, so a comparison that gained a
   * result while this screen was open comes back 409 with the count in the
   * message rather than taking its results with it. A comparison in the wrong
   * DIRECTION is a swap, not a removal — that is the button beside this one.
   */
  const removeComparison = useCallback(async (contrastId: string) => {
    setSavingComparison(true);
    try {
      await robService.deleteContrast(contrastId);
      toast({ title: 'Comparison removed', variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['rob-registry', projectId] });
    } catch (e) {
      toast({ title: 'Could not remove it', description: getErrorMessage(e),
              variant: 'warning' });
    } finally {
      setSavingComparison(false);
    }
  }, [projectId, queryClient, toast]);

  const [correctingIdentity, setCorrectingIdentity] = useState(false);

  /**
   * Correct what a result IS.
   *
   * The registry, the version trigger and the stale banner have all been here
   * since the rebuild; nothing could reach them. `patchResult` was only ever
   * called with a contrast and a state, so a result committed with the wrong
   * timepoint stayed wrong, and the banner telling a reviewer their answers
   * were made against an older identity could not fire.
   *
   * The refetch is not optional: the database bumps `version` on an identity
   * change, and a client still holding the old number would write the next
   * assessment against a version that no longer exists — which is precisely
   * the staleness this is meant to make visible.
   */
  const correctIdentity = useCallback(async (
    resultId: string, patch: Record<string, string>,
  ) => {
    setCorrectingIdentity(true);
    try {
      await robService.patchResult(resultId, patch as any);
      await queryClient.invalidateQueries({ queryKey: ['rob-registry', projectId] });
      toast({ title: 'Identity corrected', variant: 'success' });
    } catch (e) {
      toast({ title: 'Could not correct it', description: getErrorMessage(e),
              variant: 'error' });
    } finally {
      setCorrectingIdentity(false);
    }
  }, [projectId, queryClient, toast]);

  const [resolvingHold, setResolvingHold] = useState(false);

  /**
   * Attach a contrast to a held result, which is what releases it.
   *
   * A result is held when its study has several contrasts and the extracted row
   * does not say which one it belongs to. That is a real question only a person
   * can answer — but the page stated it and offered nothing, so every control on
   * the screen was dead with no way forward from where the reviewer was
   * standing. The decision belongs here, at the wall they hit.
   */
  const resolveHold = useCallback(async (
    resultId: string, contrastId: string, arms?: { intervention: string; comparator: string },
  ) => {
    setResolvingHold(true);
    try {
      // A multi-arm trial's contrast is stored with its arms and no direction.
      // Naming the two arms is what turns it into a comparison; attaching it is
      // what releases the result. If the study already records those two arms,
      // the server hands back that row — the same comparison — and the result is
      // attached to it rather than to a second copy.
      let attachTo = contrastId;
      if (arms) {
        const saved = await robService.patchContrast(contrastId, { ...arms, state: 'auto' });
        if (saved.contrast?.id) attachTo = saved.contrast.id;
      }
      await robService.patchResult(resultId, { contrast_id: attachTo, state: 'active' } as any);
      toast({
        title: 'Result released',
        description: 'The comparison is recorded on this result and it can be assessed.',
        variant: 'success',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rob-registry', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['rob-build', projectId] }),
      ]);
    } catch (e) {
      toast({ title: 'Could not attach the comparison',
              description: getErrorMessage(e), variant: 'error' });
    } finally {
      setResolvingHold(false);
    }
  }, [toast, queryClient, projectId]);

  const commitResults = useCallback(async () => {
    if (!build || build.results.length === 0) return;
    setCommitting(true);
    try {
      // The manager's decisions replace the proposal they were taken on — and a
      // study may have several, so one proposal can become several comparisons.
      const contrasts = build.contrasts.flatMap(c => {
        const edits = contrastEdits[c.document_id];
        if (!edits?.length) return [c];
        return edits.map(e => ({
          ...c, intervention: e.intervention, comparator: e.comparator,
          state: 'auto' as const,
        }));
      });
      const response = await robService.commitResults(projectId, build.results, contrasts);
      toast({
        title: `${response.results.length} results created`,
        description: `${response.contrasts} comparisons stored. Assessments already made keep pointing `
          + 'at the results they were made against.',
        variant: 'success',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rob-registry', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['rob-build', projectId] }),
      ]);
    } catch (e) {
      toast({ title: 'Could not create results', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setCommitting(false);
    }
  }, [build, projectId, toast, queryClient, contrastEdits]);

  /**
   * Create the results of ONE study, from the comparisons screen.
   *
   * A manager who has just named a study's comparison wants that study's rows
   * off hold; sending them back to setup to press a button that also creates
   * ten other studies' results is a different, larger decision than the one
   * they came to take.
   */
  const commitStudy = useCallback(async (documentId: string) => {
    if (!build) return;
    const mine = build.results.filter(r => r.document_id === documentId);
    if (!mine.length) return;
    setCommitting(true);
    try {
      const contrasts = build.contrasts
        .filter(c => c.document_id === documentId)
        .flatMap(c => {
          const edits = contrastEdits[c.document_id];
          if (!edits?.length) return [c];
          return edits.map(e => ({
            ...c, intervention: e.intervention, comparator: e.comparator,
            state: 'auto' as const,
          }));
        });
      const response = await robService.commitResults(projectId, mine, contrasts);
      toast({
        title: `${response.results.length} results created`,
        description: 'They are in the queue for this study.',
        variant: 'success',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rob-registry', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['rob-build', projectId] }),
      ]);
    } catch (e) {
      toast({ title: 'Could not create results', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setCommitting(false);
    }
  }, [build, projectId, toast, queryClient, contrastEdits]);

  const toggleSource = useCallback(async (formId: string, use: boolean | null) => {
    setPendingSources(prev => new Set(prev).add(formId));
    try {
      await robService.setFormAsSource(formId, use);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rob-forms', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['rob-build', projectId] }),
      ]);
    } catch (e) {
      toast({ title: 'Could not change this', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setPendingSources(prev => {
        const next = new Set(prev);
        next.delete(formId);
        return next;
      });
    }
  }, [projectId, queryClient, toast]);

  const saveMapping = useCallback(async (formId: string, mapping: Record<string, string>) => {
    setSavingMapping(true);
    try {
      await robService.saveMapping(formId, mapping);
      toast({
        title: 'Mapping saved',
        description: 'Every extraction from this form now resolves the same way.',
        variant: 'success',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rob-forms', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['rob-build', projectId] }),
      ]);
    } catch (e) {
      toast({ title: 'Could not save mapping', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setSavingMapping(false);
    }
  }, [projectId, queryClient, toast]);

  const [exporting, setExporting] = useState(false);
  const exportCsv = useCallback(async (format: 'csv' | 'json' = 'csv') => {
    if (!projectId) return;
    setExporting(true);
    try {
      const blob = await robService.exportCsv(projectId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `risk-of-bias-${(selectedProject?.name ?? 'project')
        .replace(/\W+/g, '-').toLowerCase()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: 'Export failed', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setExporting(false);
    }
  }, [projectId, selectedProject?.name, toast]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const loading = formsLoading || registryLoading || assessmentsLoading;
  const assignedCount = groups.reduce((n, g) => n + (g.seat ? g.results.length : 0), 0);
  const completeCount = groups.reduce(
    (n, g) => n + g.results.filter(r => r.progress === 'complete').length, 0);

  const tabs: Array<{ id: Screen; label: string; show: boolean }> = [
    { id: 'queue', label: 'Queue', show: true },
    { id: 'setup', label: 'Setup', show: canManage },
  ];

  const saveIndicator = (
    <span
      className={[
        'inline-flex items-center gap-1.5 text-[11.5px] font-medium',
        saveState === 'failed' ? 'text-red-600 dark:text-red-400'
          : dirty ? 'text-gray-600 dark:text-zinc-400'
            : 'text-gray-500 dark:text-zinc-500',
      ].join(' ')}
      aria-live="polite"
    >
      <span aria-hidden className={[
        'w-1.5 h-1.5 rounded-full',
        saveState === 'failed' ? 'bg-red-500'
          : saving ? 'bg-gray-500' : dirty ? 'bg-gray-400' : 'bg-emerald-500',
      ].join(' ')} />
      {saveState === 'failed' ? 'Not saved — try again'
        : saving ? 'Saving…'
          : dirty ? 'Unsaved changes'
            : savedAt ? `Saved · ${savedAt}` : 'Saved'}
    </span>
  );

  const nav = (
    <div className="flex items-center gap-1.5 flex-wrap">
      {(screen === 'assess' || screen === 'trial') && saveIndicator}
      <button
        type="button"
        onClick={() => go({ screen: 'export' })}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]"
      >
        <Download className="h-3 w-3" />
        Export
      </button>
      {tabs.filter(t => t.show).map(tab => (
        <button
          key={tab.id}
          type="button"
          onClick={() => go({ screen: tab.id })}
          className={[
            'text-[12.5px] font-semibold rounded-lg border px-3 py-1.5',
            screen === tab.id || (tab.id === 'queue' && (screen === 'trial' || screen === 'assess'))
              ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]',
          ].join(' ')}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode;

  if (!selectedProject) {
    body = (
      <EmptyState
        icon={FolderOpen}
        title="No project selected"
        description="Choose a project to assess its results for risk of bias."
      />
    );
  } else if (loading) {
    body = <div className="flex items-center justify-center py-24"><Spinner className="h-6 w-6" /></div>;
  // Setup and mapping come BEFORE the check for a RoB 2 form. A manager agreeing
  // what this project's results are does not need one, and a project that has
  // neither results nor a form would otherwise be a dead end at exactly the
  // screen that exists to get it out of that state.
  } else if (screen === 'setup') {
    body = (
      <SetupScreen
        build={build ?? null}
        loading={buildLoading}
        canManage={canManage}
        committing={committing}
        onCommit={commitResults}
        onOpenMapping={formId => go({ screen: 'mapping', form: formId })}
        onToggleSource={toggleSource}
        pendingSources={pendingSources}
        contrastEdits={contrastEdits}
        onEditContrast={editContrast}
        existingCount={results.length}
        onOpenQueue={() => go({ screen: 'queue' })}
      />
    );
  } else if (screen === 'export') {
    body = (
      <ExportScreen
        resultCount={results.length}
        completeCount={completeCount}
        busy={exporting}
        onExport={exportCsv}
        onBack={() => go({ screen: 'queue' })}
      />
    );
  } else if (screen === 'comparisons' && activeDocId) {
    body = (
      <StudyComparisons
        studyLabel={docLabels[activeDocId] ?? activeDocId}
        contrasts={contrastsByDocument.get(activeDocId) ?? []}
        resultCounts={resultsPerContrast}
        busy={savingComparison}
        canManage={canManage}
        onAdd={(intervention, comparator) =>
          addComparison(activeDocId, intervention, comparator)}
        onSwap={swapComparison}
        onRemove={removeComparison}
        onBack={() => go({
          screen: cameFrom === 'setup' ? 'setup' : 'queue', study: null, from: null,
        })}
        backLabel={cameFrom === 'setup' ? '← Back to setup' : '← Back to queue'}
        candidates={(build?.results ?? []).filter(r => r.document_id === activeDocId)}
        mappingNotReady={(build?.forms ?? [])
          .filter(f => !f.confirmed
            || (f.warnings ?? []).some(w => w.severity === 'blocking'))
          .map(f => f.form_name)}
        creating={committing}
        onCreate={() => commitStudy(activeDocId)}
        onOpenSetup={() => go({ screen: 'setup', study: null, from: null })}
      />
    );
  } else if (screen === 'mapping') {
    body = (
      <ColumnMapper
        forms={build?.forms ?? []}
        activeFormId={mappingFormId}
        onSelectForm={formId => go({ form: formId })}
        onSave={saveMapping}
        onBack={() => go({ screen: 'setup', form: null })}
        saving={savingMapping}
      />
    );
  } else if (screen === 'trial-picker' && activeDocId) {
    const forStudy = results.filter(r => r.document_id === activeDocId);
    const seen = new Map<string, { contrastId: string; label: string; resultCount: number; complete: boolean }>();
    for (const r of forStudy) {
      const id = r.contrast?.id ?? '';
      const found = seen.get(id);
      if (found) { found.resultCount += 1; continue; }
      seen.set(id, {
        contrastId: id,
        label: contrastLabel(r.contrast),
        resultCount: 1,
        complete: !!trialByComparison.get(trialKey(r))?.complete,
      });
    }
    body = (
      <TrialPicker
        studyLabel={docLabels[activeDocId] ?? activeDocId}
        comparisons={[...seen.values()]}
        onOpen={contrastId => openTrial(activeDocId, contrastId)}
        onBack={() => go({ screen: 'queue', study: null })}
      />
    );
  } else if (screen === 'trial' && documentId) {
    body = (
      <>
        {!canEdit && <div className="mb-4"><ReadOnlyNote /></div>}
        <TrialQuestions
          studyLabel={docLabels[documentId] ?? documentId}
          contrastText={contrastLabel(activeResult?.contrast)}
          resultCount={studyResults.filter(
            r => (r.contrast?.id ?? '') === (activeResult?.contrast?.id ?? '')).length}
          answers={trialDraft.answers}
          rationale={trialDraft.rationale}
          evidence={trialDraft.evidence}
          suggestions={suggestions}
          notFound={notFound}
          readOnly={!canEdit}
          showAi={showAi}
          saving={saving}
          onAnswer={(id, code, origin) => answerQuestion(id, code, origin, true)}
          onClear={id => clearAnswer(id, true)}
          onRationale={(id, text) => setRationale(id, text, true)}
          onBack={async () => { await saveIfDirty(); go({ screen: 'queue' }); }}
          onContinue={async () => {
            const next = { ...trialDraft, complete: true };
            setTrialDraft(next);
            try {
              await persist(next, assessDraft, 'Trial questions recorded');
            } catch { return; }
            go({
              screen: 'assess',
              result: activeResultId || studyResults[0]?.id || null,
              domain: '0',
            });
          }}
        />
      </>
    );
  } else if (screen === 'assess' && activeResult) {
    const outstanding = trialOutstanding(trialDraft.answers);
    body = (
      <div className="flex flex-col gap-4">
        <ResultHeader
          result={activeResult}
          studyLabel={docLabels[activeResult.document_id] ?? activeResult.document_id}
          measurementInferred={/inferred|from a .* form/i.test(activeResult.measurement ?? '')}
          position={positionInStudy}
          total={studyResults.length}
          onPrev={() => stepResult(-1)}
          onNext={() => stepResult(1)}
          seatText={seatLabel}
          contrastText={contrastLabel(activeResult.contrast)}
          sourceRef={(activeResult as any).source_ref?.row
            ? `Extraction row ${(activeResult as any).source_ref.row}`
            : undefined}
          onBack={async () => { await saveIfDirty(); go({ screen: 'queue' }); }}
          canCorrect={canManage}
          correcting={correctingIdentity}
          onCorrect={patch => correctIdentity(activeResult.id, patch)}
          progressText={(() => {
            const p = progressOf(merged);
            return `Your review · ${p.answered}/${p.applicable} applicable answered`
              + (p.mayGrow ? ' · more may apply' : '');
          })()}
          stale={assessmentByResult.get(activeResult.id)?.resultVersion != null
            && typeof activeResult.version === 'number'
            && (assessmentByResult.get(activeResult.id)!.resultVersion ?? 0) < activeResult.version}
        />

        {/* The nearest thing we have to the instrument workspace's "resolve a
            blocker" step. Its blocker is that the extraction does not
            establish the population; ours is the same fact, written as the
            default literal "Overall" by `apply_mapping` when no source form
            has a population column. Either answer writes something the default
            is not, so confirming it once is the end of it.

            Not a wall: an assessment of the wrong population is a real risk,
            but so is blocking a reviewer behind a question the paper may not
            answer. It states the fact and offers both answers. */}
        {/^overall$/i.test(activeResult.population || '') && canManage
          && !assessDraft.complete && (
          <div className="flex items-start gap-2.5 flex-wrap border border-gray-200 dark:border-[#242424] bg-gray-50 dark:bg-[#0d0d0d] rounded-xl px-3 py-2.5 text-[12.5px] text-gray-600 dark:text-zinc-400">
            <span className="min-w-0 flex-1">
              <strong className="font-semibold dark:text-zinc-200">
                The population was filled in, not read from the trial.
              </strong>{' '}
              No source form had a population column, so this result is recorded as the overall
              population by default. Question 4.3 and the comparability of two results both turn
              on it — confirm it from the report.
            </span>
            <span className="flex items-center gap-1.5 flex-none">
              <button
                type="button"
                disabled={correctingIdentity}
                onClick={() => correctIdentity(activeResult.id,
                  { population: 'Overall population (confirmed from the report)' })}
                className="text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 hover:bg-white dark:hover:bg-[#1a1a1a] disabled:opacity-40"
              >
                It is the whole trial
              </button>
              <button
                type="button"
                disabled={correctingIdentity}
                onClick={() => correctIdentity(activeResult.id,
                  { population: 'Not reported in the source' })}
                className="text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 hover:bg-white dark:hover:bg-[#1a1a1a] disabled:opacity-40"
              >
                Not reported
              </button>
            </span>
          </div>
        )}

        {/* No seat on this study. Not a wall — editing is gated on the
            permission, not the seat — but the seat decides whether this is
            recorded as R1, R2, or an additional assessment, and there was no
            way to take one from here. */}
        {/* A seat is a fact about the whole STUDY, for every form in the
            project — `UNIQUE(project_id, document_id, reviewer_role)`. Taking
            one from here would quietly make somebody R1 for all of that
            study's extraction work, and there is already a screen that owns
            the table, with the modes and the undo and a view of who holds
            what. So this states the consequence and links there. */}
        {!seat && canEdit && (
          <div className="flex items-start gap-2.5 flex-wrap border border-gray-200 dark:border-[#242424] bg-gray-50 dark:bg-[#0d0d0d] rounded-xl px-3 py-2.5 text-[12.5px] text-gray-600 dark:text-zinc-400">
            <span className="min-w-0 flex-1">
              <strong className="font-semibold dark:text-zinc-200">
                You hold no reviewer seat on this study.
              </strong>{' '}
              Assess it anyway — what you record is saved under your name and compared like any
              other review. A seat only changes whether it is labelled R1 or R2, and it covers
              the whole study, so it is set on Assignments.
            </span>
            <button
              type="button"
              onClick={() => router.push(`/projects/${projectId}?tab=assignments`)}
              className="flex-none text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 hover:bg-white dark:hover:bg-[#1a1a1a]"
            >
              Open Assignments →
            </button>
          </div>
        )}

        {/* A review that reopened on its own says so, and says what to look at.
            The reason has been recorded on the row since the rebuild and read
            by nothing, so the reviewer saw a finished assessment quietly become
            unfinished with no explanation anywhere on the page. */}
        {!!assessDraft.reopenedBecause && !assessDraft.complete && (
          <div className="flex items-start gap-2.5 flex-wrap border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-gray-500/5 rounded-xl px-3 py-2.5 text-[12.5px] text-gray-700 dark:text-zinc-300">
            <span className="min-w-0 flex-1">
              <strong>This review reopened because {assessDraft.reopenedBecause}.</strong>{' '}
              Nothing you answered was deleted, and any override you had on D1 or D2 was dropped —
              it disagreed with a derivation that no longer exists. Check those two domains before
              completing it again.
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => {
                  setAssessDraft(prev => ({ ...prev, reopenedBecause: '' }));
                  setDirty(true);
                }}
                className="flex-none text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 hover:bg-white dark:hover:bg-[#1a1a1a]"
              >
                I reviewed the affected domains
              </button>
            )}
          </div>
        )}

        {assessDraft.complete && (
          <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#161616] rounded-xl px-3 py-2.5 text-[12.5px] text-gray-700 dark:text-zinc-300">
            <span>
              <strong>Assessment complete — read-only.</strong> Reopen it from the Overall page; the
              reopen is recorded.
            </span>
          </div>
        )}

        {!canEdit && <ReadOnlyNote />}

        {activeResult.state === 'held' && (() => {
          const options = contrastsByDocument.get(activeResult.document_id) ?? [];
          // Two different holds. One has an answer this screen can take; the
          // other is a merge decision that belongs on the setup screen.
          const isContrastHold = !activeResult.contrast;
          return (
            <div className="border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-gray-500/5 rounded-xl px-3 py-2.5 text-[12.5px] text-gray-700 dark:text-zinc-300">
              <div className="flex items-start gap-2.5">
                <span>
                  <strong>Held.</strong>{' '}
                  {isContrastHold
                    ? options.length > 1
                      ? <>This study reports {options.length} comparisons and the extracted row does
                        not say which one this result is about. RoB 2 judges an estimate of a
                        specific comparison, so that has to be settled first.</>
                      : <>No comparison has been settled for this study — its arms do not say which
                        was compared against which. RoB 2 judges an estimate of a specific
                        comparison, so that has to be settled first.</>
                    : <>Two outcome forms describe this result, and whether they are one result or
                      two has not been settled. It stays visible rather than disappearing from your
                      queue.</>}
                </span>
              </div>

              {isContrastHold && (canManage
                ? (
                  <HoldResolver
                    contrasts={options}
                    busy={resolvingHold}
                    onResolve={(contrastId, arms) =>
                      resolveHold(activeResult.id, contrastId, arms)}
                  />
                ) : (
                  <div className="mt-1.5 pl-6 text-[11.5px]">
                    A review manager settles this on <strong>Setup</strong>.
                  </div>
                ))}

              {!isContrastHold && (canManage
                ? (
                  <div className="mt-1.5 pl-6 flex items-center gap-2 flex-wrap text-[11.5px]">
                    <span>
                      Nothing here can be merged &mdash; one identity is one row &mdash; so the
                      decision is about the two forms.
                    </span>
                    <button
                      type="button"
                      onClick={() => go({ screen: 'setup' })}
                      className="flex-none font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2 py-0.5 hover:bg-white dark:hover:bg-[#1a1a1a]"
                    >
                      Settle it on Setup
                    </button>
                  </div>
                ) : (
                  <div className="mt-1.5 pl-6 text-[11.5px]">
                    A review manager settles this on <strong>Setup</strong>, under
                    &ldquo;Results that describe the same thing&rdquo;.
                  </div>
                ))}
            </div>
          );
        })()}

        <div className="flex items-start gap-2.5 flex-wrap border rounded-xl px-3 py-2.5 text-[12.5px]
          border-gray-200 dark:border-[#242424] bg-gray-50 dark:bg-[#0d0d0d] text-gray-600 dark:text-zinc-400">
          <span className="min-w-0 flex-1">
            {outstanding.length
              ? <>Questions about the trial itself come first — D1 and D2 cannot be judged until{' '}
                <strong>{outstanding.join(', ')}</strong>{' '}
                {outstanding.length === 1 ? 'is' : 'are'} answered.</>
              : <>Trial questions are answered for this study. 1.1–1.3 and 2.1–2.3 are about the trial,
                so all {studyResults.length} of its results read the same answers — shown below,
                read-only, in the domains they belong to.</>}
          </span>
          <button
            type="button"
            onClick={() => go({ screen: 'trial' })}
            className="flex-none text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 hover:bg-white dark:hover:bg-[#1a1a1a]"
          >
            {outstanding.length ? 'Answer them now' : 'Review them'}
          </button>
        </div>

        {hideAi && (
          <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#242424] bg-gray-50 dark:bg-[#0d0d0d] rounded-xl px-3 py-2.5 text-[12.5px] text-gray-600 dark:text-zinc-400">
            <span>
              AI suggestions are switched off for readers on this project, so your answers stay
              independent of the model&rsquo;s. A project owner can change that in
              Members &amp; access.
            </span>
          </div>
        )}

        {showAi && (
          <div className="flex items-center gap-3 flex-wrap border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-3">
            <div className="min-w-0 text-[12.5px] text-gray-600 dark:text-zinc-400">
              Ask the model to read the paper for this result. It suggests answers with the sentence
              behind each one; nothing is filled in until you accept it.
            </div>
            <span className="flex-1" />
            <button
              type="button"
              onClick={draftWithAi}
              disabled={drafting || readOnly}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              {drafting ? <Spinner className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
              {drafting ? 'Reading the paper…' : 'Get AI suggestions'}
            </button>
          </div>
        )}

        {/* Below xl the rail stacks to six full-width rows, which works but
            costs most of a phone screen before the question. The select says
            the same thing in one line. */}
        <div className="xl:hidden">
          <label htmlFor="rob-domain" className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-1">
            Assessment domain
          </label>
          <select
            id="rob-domain"
            value={String(domainIndex)}
            onChange={e => go({ domain: e.target.value })}
            className="h-9 w-full text-[13px] font-semibold border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none"
          >
            {ROB2_SIGNALLING.map((d, i) => (
              <option key={d.code} value={String(i)}>
                {d.code} · {d.name} — {SEVERITY_SHORT[severities[i] ?? 'none']}
              </option>
            ))}
            <option value="5">Review &amp; complete</option>
          </select>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[230px_minmax(0,1fr)_320px] gap-4 items-start">
          <aside className="hidden xl:block border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] overflow-hidden xl:sticky xl:top-2">
            <DomainRail
              active={domainIndex}
              onSelect={i => go({ domain: String(i) })}
              severities={severities}
              confirmed={assessDraft.confirmed}
              counts={domainCounts}
              overall={overallOf(assessDraft, severities)}
            />
          </aside>

          <section className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f]">
            {domainIndex === 5 ? (
              <OverallPanel
                onSelectDomain={i => go({ domain: String(i) })}
                resultLabel={shortLabel(activeResult)}
                estimate={activeResult.estimate}
                severities={severities}
                derived={derived}
                overrides={assessDraft.overrides}
                overrideWhy={assessDraft.overrideWhy}
                confirmed={assessDraft.confirmed}
                unansweredByDomain={unansweredByDomain}
                direction={assessDraft.direction}
                overall={overall}
                overallOverride={assessDraft.overallOverride}
                overallOverrideWhy={assessDraft.overallOverrideWhy}
                overallDirection={assessDraft.overallDirection}
                complete={assessDraft.complete}
                canEdit={canEdit}
                saving={saving}
                onBack={() => go({ domain: '4' })}
                onComplete={async () => {
                  const next = { ...assessDraft, complete: true };
                  setAssessDraft(next);
                  try {
                    await persist(trialDraft, next, 'Assessment complete');
                  } catch { setAssessDraft(assessDraft); }
                }}
                onReopen={async () => {
                  const next = { ...assessDraft, complete: false };
                  setAssessDraft(next);
                  try {
                    await persist(trialDraft, next, 'Reopened — the reopen is recorded');
                  } catch { setAssessDraft(assessDraft); }
                }}
              />
            ) : (
              <>
                <div className="px-4 py-3.5 border-b border-gray-100 dark:border-[#1a1a1a]">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                    Domain {domainIndex + 1} of 5
                  </div>
                  <h2 className="text-[15px] font-semibold dark:text-white mt-0.5">
                    {ROB2_SIGNALLING[domainIndex].code} · {ROB2_SIGNALLING[domainIndex].name}
                  </h2>
                  <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-0.5">
                    {ROB2_SIGNALLING[domainIndex].about}
                  </p>
                </div>

                <div className="px-4 py-4 flex flex-col gap-3">
                  {(() => {
                    const siblings = studyResults
                      .filter(r => r.id !== activeResult.id)
                      .map(r => {
                        const a = assessmentByResult.get(r.id);
                        const t = trialByComparison.get(trialKey(r));
                        const view = mergedAnswers(t?.answers ?? {}, a?.answers ?? {});
                        const p = progressOf(view);
                        return { result: r, answered: p.answered, applicable: p.applicable };
                      })
                      .filter(c => c.answered > 0);
                    if (siblings.length === 0 || readOnly) return null;
                    return copying ? (
                      <CopyAnswers
                        target={activeResult}
                        candidates={siblings}
                        domainIndex={domainIndex}
                        busy={saving}
                        onCopy={id => copyFromSibling(id, domainIndex)}
                        onClose={() => setCopying(false)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCopying(true)}
                        className="self-start text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                      >
                        Reuse another result&rsquo;s answers…
                      </button>
                    );
                  })()}

                  {ROB2_SIGNALLING[domainIndex].questions
                    .filter(question => questionState(question, merged) === 'asked')
                    .map(question => (
                    <QuestionCard
                      key={question.id}
                      question={question}
                      merged={merged}
                      evidence={assessDraft.evidence[question.id] ?? trialDraft.evidence[question.id]}
                      rationale={
                        isTrialQuestion(question.id)
                          ? trialDraft.rationale[question.id] ?? ''
                          : assessDraft.rationale[question.id] ?? ''
                      }
                      source={assessDraft.sources[question.id]}
                      onSource={next => {
                        setAssessDraft(prev => ({
                          ...prev, sources: { ...prev.sources, [question.id]: next },
                        }));
                        setDirty(true);
                      }}
                      origin={assessDraft.origins[question.id]}
                      originLabel={(() => {
                        const from = assessDraft.origins[question.id]?.copiedFrom;
                        const r = from ? resultById.get(from) : null;
                        return r ? shortLabel(r) : undefined;
                      })()}
                      suggestion={suggestions[question.id] ?? null}
                      notFound={notFound.has(question.id)}
                      fromTrial={isTrialQuestion(question.id)}
                      siblingCount={studyResults.length}
                      readOnly={readOnly}
                      showAi={showAi}
                      analysisPopulation={activeResult.analysis_population}
                      onAnswer={(code, origin) => answerQuestion(question.id, code, origin, false)}
                      onClear={() => clearAnswer(question.id, false)}
                      onRationale={text => setRationale(question.id, text, false)}
                      onEditTrial={() => go({ screen: 'trial' })}
                    />
                  ))}

                  {/* Said once for the domain rather than once per question:
                      on a domain where four of five route out, a card each
                      buries the one question actually being asked. */}
                  <RoutedBlock
                    skipped={ROB2_SIGNALLING[domainIndex].questions
                      .filter(q => questionState(q, merged) === 'skipped')}
                    waiting={ROB2_SIGNALLING[domainIndex].questions
                      .filter(q => questionState(q, merged) === 'waiting')}
                  />
                </div>

                <div className="flex items-center gap-2.5 flex-wrap px-4 py-3 border-t border-gray-100 dark:border-[#1a1a1a] bg-gray-50 dark:bg-[#0d0d0d] rounded-b-xl">
                  <span className="text-[11px] font-mono text-gray-500 dark:text-zinc-500">
                    {unansweredByDomain[domainIndex].length
                      ? `${unansweredByDomain[domainIndex].length} unanswered — ${unansweredByDomain[domainIndex].join(', ')}`
                      : dirty ? 'Unsaved changes' : 'Saved'}
                  </span>
                  <span className="flex-1" />
                  {domainIndex > 0 && (
                    <button
                      type="button"
                      onClick={() => go({ domain: String(domainIndex - 1) })}
                      className="text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                    >
                      ← Previous
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={unansweredByDomain[domainIndex].length > 0 || readOnly || saving}
                    onClick={async () => {
                      const next = {
                        ...assessDraft,
                        confirmed: assessDraft.confirmed.map((c, i) => (i === domainIndex ? true : c)),
                      };
                      setAssessDraft(next);
                      try { await persist(trialDraft, next); } catch { return; }
                      go({ domain: String(domainIndex + 1) });
                    }}
                    className="text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving…' : assessDraft.confirmed[domainIndex]
                      ? 'Next domain →'
                      : `Confirm ${ROB2_SIGNALLING[domainIndex].code} & continue →`}
                  </button>
                </div>
              </>
            )}
          </section>

          <aside className="xl:sticky xl:top-2">
            <DerivedJudgement
              domain={domainIndex}
              derived={domainIndex === 5 ? (overall.severity ?? null) : derived[domainIndex]}
              shown={domainIndex === 5
                ? (assessDraft.overallOverride ?? overall.severity ?? 'none')
                : severities[domainIndex]}
              unanswered={domainIndex === 5
                ? unansweredByDomain.flat()
                : unansweredByDomain[domainIndex]}
              override={domainIndex === 5
                ? assessDraft.overallOverride
                : assessDraft.overrides[domainIndex] ?? null}
              overrideWhy={domainIndex === 5
                ? assessDraft.overallOverrideWhy
                : assessDraft.overrideWhy[domainIndex] ?? ''}
              direction={domainIndex === 5
                ? assessDraft.overallDirection
                : assessDraft.direction[domainIndex] ?? ''}
              overall={overall}
              severities={severities}
              readOnly={readOnly}
              onSelectDomain={i => go({ domain: String(i) })}
              onOverride={(severity, why) => {
                setAssessDraft(prev => {
                  if (domainIndex === 5) {
                    return { ...prev, overallOverride: severity, overallOverrideWhy: why };
                  }
                  const overrides = { ...prev.overrides };
                  const overrideWhy = { ...prev.overrideWhy };
                  // Clearing must REMOVE the entry, not store an empty one —
                  // `?? judgeDomain(...)` only falls through for undefined, so a
                  // blank string would read back as a severity.
                  if (severity) { overrides[domainIndex] = severity; overrideWhy[domainIndex] = why; }
                  else { delete overrides[domainIndex]; delete overrideWhy[domainIndex]; }
                  return { ...prev, overrides, overrideWhy };
                });
                setDirty(true);
              }}
              onDirection={value => {
                setAssessDraft(prev => domainIndex === 5
                  ? { ...prev, overallDirection: value }
                  : { ...prev, direction: { ...prev.direction, [domainIndex]: value } });
                setDirty(true);
              }}
              workflow={[
                ...(showAi ? [['AI suggestions', Object.keys(suggestions).length ? 'Ready' : 'Not run'] as [string, string]] : []),
                [seat ? `${seat.toUpperCase()} · you` : 'You', assessDraft.complete ? '✓ Complete' : 'In progress'],
                ...othersOnResult,
              ]}
            />
          </aside>
        </div>
      </div>
    );
  } else {
    body = (
      <ResultQueue
        groups={filteredGroups}
        activeResultId={activeResultId || null}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        counts={filterCounts}
        onOpenTrial={openTrial}
        onOpenResult={openResult}
        onManageComparisons={documentId =>
          go({ screen: 'comparisons', study: documentId, from: 'queue' })}
        comparisonNeeded={comparisonNeeded}
        onClearFilters={() => { setQuery(''); setFilter('all'); }}
        lede={`${results.length} results · ${assignedCount} assigned to you · ${completeCount} complete`}
      />
    );
  }

  return (
    <DashboardLayout
      title="Risk of Bias"
      description="RoB 2, assessed per result — dual review, adjudicated like any extraction"
      action={selectedProject ? nav : undefined}
    >
      {body}
    </DashboardLayout>
  );
}

/**
 * `useSearchParams` reads a value that only exists in the browser, so Next.js
 * refuses to prerender a page using it unless the page says what to show while
 * that value is unknown. Without this the build fails on this route — the
 * screens are URL-backed on purpose, and this is the cost of that.
 */
export default function RiskOfBiasPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout title="Risk of Bias">
          <div className="flex items-center justify-center py-24"><Spinner className="h-6 w-6" /></div>
        </DashboardLayout>
      }
    >
      <RiskOfBiasWorkspace />
    </Suspense>
  );
}

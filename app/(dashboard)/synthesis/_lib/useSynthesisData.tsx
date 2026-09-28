'use client';

/**
 * Everything the Synthesis screens read and write, loaded once at the top of
 * the page (the `useRob` pattern): the protocol, the groups, the project's
 * forms / documents / members, and — per protocol source form — the extracted
 * rows flattened to one row per document by trust.
 *
 * A group's own objects (decisions, runs, versions) are loaded lazily by
 * `useGroupBundle`, and every write goes through `synthesisWorkspaceService`
 * and then invalidates what it touched. Nothing is kept in localStorage.
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import {
  documentsService, formsService, projectMembersService, resultsService, robService,
} from '@/services';
import {
  synthesisWorkspaceService,
  type DecisionIn, type GroupBundle, type ProtocolPatch, type RunIn, type SynthesisBranch,
  type SynthesisGroup, type SynthesisProtocol, type SynthesisTarget, type AuditRow,
} from '@/services/synthesis.service';
import { buildLabelMap } from '@/lib/documentLabel';
import { classifyFields, transformToLongFormat, type LongFormatRow } from '@/lib/longFormatTransform';
import type { Document, ExtractionResult, Form, FormField, ProjectMember } from '@/types/api';

import { cellValue, rowsOf } from '../../risk-of-bias/_lib/robForm';
import { fieldsForFlattening } from './mapping';

export { fieldsForFlattening };
import { ASSESSMENT_TABLE, META_COLUMN } from '../../risk-of-bias/_lib/robStore';

/** Priority order when a document has several extractions for the same form. */
export const SOURCE_RANK: Record<string, number> = { consensus: 3, manual: 2, ai: 1 };

const NONE: never[] = [];

export const EMPTY_PROTOCOL = (projectId: string): SynthesisProtocol => ({
  project_id: projectId,
  source_forms: [],
  defaults: [],
  planned_analyses: [],
  roles: { finalizer: null, approver: null, second_approval: 'optional' },
  confirmed_at: null,
  confirmed_by: null,
  version: 0,
  history: [],
  can_manage: false,
});

export interface FormData {
  form: Form;
  /** One extraction per document, highest trust first (consensus > manual > AI, newest on tie). */
  chosen: ExtractionResult[];
  rows: LongFormatRow[];
  /** Every column the mapper may point at — table columns plus joined flat fields. */
  columns: string[];
  /** Columns carrying a declared vocabulary — the only ones a subgroup may group by. */
  selectColumns: string[];
  tableField: string | null;
  flatFields: string[];
  tableColumns: string[];
  provenance: { consensus: number; manual: number; aiOnly: number; withData: number };
  loading: boolean;
  /**
   * The extraction fetch failed. `rows` is then empty because nothing was READ,
   * not because nothing was extracted — callers must show this, never zero studies.
   */
  error: unknown | null;
  /** Re-fetch this form's extractions. */
  retry: () => void;
}

export type RobJudgement = 'low' | 'some' | 'high';

/** `pending` and `error` mean RoB is UNKNOWN — never read either as "none missing". */
export type RobStatus = 'pending' | 'error' | 'ready';

export interface RobStudy {
  /** Worst completed overall judgement across the study's assessments (study-level). */
  overall: RobJudgement | null;
  assessments: number;
  completed: number;
  source: 'consensus' | 'reader' | null;
}

export interface SynthesisData {
  projectId: string;
  projectName: string;
  loading: boolean;
  /**
   * A core load (protocol, groups, forms, documents) failed. The provider shows
   * an error with Retry instead of its children, so screens never render the
   * fallback empty protocol as if it were the project's real one.
   */
  error: unknown | null;
  /** Re-fetch every query the page depends on. */
  retry: () => void;

  protocol: SynthesisProtocol;
  protocolConfirmed: boolean;
  canManage: boolean;
  canEdit: boolean;
  updateProtocol: (patch: ProtocolPatch) => Promise<SynthesisProtocol>;

  groups: SynthesisGroup[];
  createGroup: (body: { title: string; branch: SynthesisBranch; target: SynthesisTarget }) => Promise<SynthesisGroup>;
  patchGroup: (groupId: string, patch: Parameters<typeof synthesisWorkspaceService.patchGroup>[1]) => Promise<SynthesisGroup>;

  forms: Form[];
  formById: Map<string, Form>;
  formData: (formId: string | null | undefined) => FormData | null;

  docs: Document[];
  docById: Map<string, Document>;
  labelOf: (documentId: string) => string;

  members: ProjectMember[];
  nameOf: (userId: string | null | undefined) => string;
  currentUserId: string;

  designByDocument: Record<string, string>;
  designSourceLabel: string | null;
  /** The design form's extractions are still loading, or failed (then `designByDocument` is not the truth). */
  designStatus: RobStatus;

  rob: {
    byDoc: Map<string, RobStudy>;
    /** True only once the RoB query SUCCEEDED. */
    loaded: boolean;
    status: RobStatus;
    error: unknown | null;
    high: Set<string>;
    assessed: boolean;
  };

  addDecision: (groupId: string, d: DecisionIn) => Promise<void>;
  revokeDecision: (groupId: string, decisionId: string, reason?: string | null) => Promise<void>;
  createRun: (groupId: string, run: RunIn) => Promise<void>;
  finalize: (groupId: string, body: { run_id: string; current_hash: string; audit: AuditRow[]; bundle: Record<string, unknown> }) => Promise<void>;
  approve: (groupId: string, versionId: string) => Promise<void>;
}

const Ctx = createContext<SynthesisData | null>(null);

export function useSynthesis(): SynthesisData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSynthesis() outside <SynthesisProvider>');
  return v;
}

/** One extraction per document, by SOURCE_RANK then recency. Drafts saved mid-way are skipped. */
export function chooseRows(results: ExtractionResult[]): ExtractionResult[] {
  const best = new Map<string, ExtractionResult>();
  for (const r of results) {
    if ((r.extracted_data as any)?._partial === true) continue;
    const rank = SOURCE_RANK[r.extraction_type] ?? 0;
    const cur = best.get(r.document_id);
    const curRank = cur ? SOURCE_RANK[cur.extraction_type] ?? 0 : -1;
    const at = r.updated_at ?? r.created_at;
    if (rank > curRank) best.set(r.document_id, r);
    else if (rank === curRank && cur && at > (cur.updated_at ?? cur.created_at)) best.set(r.document_id, r);
  }
  return [...best.values()];
}

function buildFormData(
  form: Form, results: ExtractionResult[], docMap: Record<string, Document>, loading: boolean,
  fieldName: string | null | undefined, error: unknown | null, retry: () => void,
): FormData {
  const chosen = chooseRows(results);
  const allFields = (form.fields ?? []).filter((f: any) => f && typeof f === 'object') as FormField[];
  const fields = fieldsForFlattening(allFields, fieldName);
  const long = transformToLongFormat(chosen, fields, docMap);
  const cls = classifyFields(fields);
  const skip = new Set(['Paper', 'Ref ID']);
  const tableColumns = (cls.deepestTableField?.subform_fields ?? []).map(f => f.field_name);
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const c of [...tableColumns, ...long.columns]) {
    if (skip.has(c) || seen.has(c)) continue;
    seen.add(c);
    columns.push(c);
  }
  const selectColumns = [
    ...(cls.deepestTableField?.subform_fields ?? []),
    ...cls.flatFields,
  ].filter(f => Array.isArray(f.options) && f.options.length > 0).map(f => f.field_name).filter(c => seen.has(c));
  let consensus = 0; let manual = 0;
  for (const r of chosen) {
    if (r.extraction_type === 'consensus') consensus++;
    else if (r.extraction_type === 'manual') manual++;
  }
  return {
    form, chosen, rows: long.rows, columns, selectColumns,
    tableField: cls.deepestTableField?.field_name ?? null,
    flatFields: cls.flatFields.map(f => f.field_name),
    tableColumns,
    provenance: { consensus, manual, aiOnly: chosen.length - consensus - manual, withData: chosen.length },
    loading,
    error,
    retry,
  };
}

const RANK: Record<RobJudgement, number> = { low: 0, some: 1, high: 2 };

function parseMeta(row: Record<string, any>): Record<string, any> {
  const raw = row?.[META_COLUMN];
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('value' in raw)) return raw;
  const text = cellValue(row, META_COLUMN);
  if (!text) return {};
  try { const p = JSON.parse(text); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
}

function sevOf(v: unknown): RobJudgement | null {
  const s = String(v ?? '').toLowerCase();
  if (s === 'low') return 'low';
  if (s === 'some' || s.startsWith('some')) return 'some';
  if (s === 'high') return 'high';
  return null;
}

export function SynthesisProvider({ children }: { children: ReactNode }) {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? '';
  const { currentUser, isAdmin } = useAuth();
  const permissions = useProjectPermissions();
  const qc = useQueryClient();
  const currentUserId = currentUser?.id ?? '';

  const protocolQ = useQuery({
    queryKey: ['synthesis-protocol', projectId],
    queryFn: () => synthesisWorkspaceService.getProtocol(projectId),
    enabled: !!projectId,
    retry: false,
  });
  const groupsQ = useQuery({
    queryKey: ['synthesis-groups', projectId],
    queryFn: () => synthesisWorkspaceService.listGroups(projectId),
    enabled: !!projectId,
    retry: false,
  });
  const formsQ = useQuery({
    queryKey: ['synthesis-forms', projectId],
    queryFn: async () => ((await formsService.getAll(projectId)) as Form[]).filter(f => f.status === 'active'),
    enabled: !!projectId,
  });
  const docsQ = useQuery({
    queryKey: ['synthesis-docs', projectId],
    queryFn: () => documentsService.getAll(projectId),
    enabled: !!projectId,
  });
  const membersQ = useQuery({
    queryKey: ['synthesis-members', projectId],
    queryFn: () => projectMembersService.listMembers(projectId).catch(() => [] as ProjectMember[]),
    enabled: !!projectId,
  });
  const robQ = useQuery({
    queryKey: ['synthesis-rob', projectId],
    queryFn: () => robService.listAssessments(projectId),
    enabled: !!projectId,
    retry: false,
  });

  // Core loads: a failure here is shown with Retry, never rendered as an empty
  // (unconfirmed) protocol or a project with no forms / documents / groups.
  const coreQs = [protocolQ, groupsQ, formsQ, docsQ];
  const coreError = coreQs.find(q => q.isError)?.error ?? null;

  const fallback = useMemo(() => EMPTY_PROTOCOL(projectId), [projectId]);
  const protocol = protocolQ.data ?? fallback;
  const forms = (formsQ.data ?? NONE) as Form[];
  const formById = useMemo(() => new Map(forms.map(f => [f.id, f])), [forms]);
  const docs = (docsQ.data ?? NONE) as Document[];
  const docById = useMemo(() => new Map(docs.map(d => [d.id, d])), [docs]);
  const docMap = useMemo(() => Object.fromEntries(docs.map(d => [d.id, d])) as Record<string, Document>, [docs]);
  const labels = useMemo(() => buildLabelMap(docs), [docs]);
  const labelOf = useCallback((d: string) => labels[d] ?? 'Study', [labels]);

  // Design lives on whichever form records it — usually not the outcome form.
  const designSource = useMemo(() => {
    const named = /(^|_)(design|study_type|study_design|trial_design|study_kind)(_|$)/i;
    const cands: Array<{ formId: string; formName: string; field: string; score: number }> = [];
    for (const f of forms) {
      for (const field of (f.fields ?? []) as any[]) {
        if (!field || typeof field !== 'object') continue;
        const name = field.field_name as string | undefined;
        if (!name || !named.test(name)) continue;
        const opts = Array.isArray(field.options) && field.options.length > 0;
        cands.push({ formId: f.id, formName: f.form_name, field: name, score: (opts ? 2 : 0) + 1 });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    return cands[0] ?? null;
  }, [forms]);

  const sourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sf of protocol.source_forms ?? []) if (sf.form_id) ids.add(sf.form_id);
    if (designSource) ids.add(designSource.formId);
    return [...ids];
  }, [protocol.source_forms, designSource]);

  const resultsQs = useQueries({
    queries: sourceIds.map(id => ({
      queryKey: ['synthesis-results', projectId, id],
      queryFn: () => resultsService.getAllForForm(projectId, id),
      enabled: !!projectId && formById.has(id),
      retry: false,
    })),
  });

  const resultsById = useMemo(() => {
    const m = new Map<string, { data: ExtractionResult[]; loading: boolean; error: unknown | null; retry: () => void }>();
    sourceIds.forEach((id, i) => {
      const q = resultsQs[i];
      m.set(id, {
        data: (q?.data ?? NONE) as ExtractionResult[],
        // A query that has not settled is loading, even before it is enabled.
        loading: !q || q.isPending,
        error: q?.isError ? q.error : null,
        retry: () => { void q?.refetch(); },
      });
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIds, ...resultsQs.map(q => q.data), ...resultsQs.map(q => q.status)]);

  /** The table each protocol source form was mapped against (`source_forms[].field_name`). */
  const fieldNameByForm = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const sf of protocol.source_forms ?? []) if (sf.form_id) m.set(sf.form_id, sf.field_name ?? null);
    return m;
  }, [protocol.source_forms]);

  const formDataCache = useMemo(() => {
    const m = new Map<string, FormData>();
    for (const [id, r] of resultsById) {
      const form = formById.get(id);
      if (form) m.set(id, buildFormData(form, r.data, docMap, r.loading, fieldNameByForm.get(id), r.error, r.retry));
    }
    return m;
  }, [resultsById, formById, docMap, fieldNameByForm]);
  const formData = useCallback((id: string | null | undefined) => (id ? formDataCache.get(id) ?? null : null), [formDataCache]);

  // The same one-extraction-per-document rule as the outcome rows (`chooseRows`):
  // drafts (`_partial`) are skipped and the newest wins on equal trust, so a
  // study's design is read from the extraction its numbers come from.
  const designByDocument = useMemo(() => {
    if (!designSource) return {} as Record<string, string>;
    const rows = resultsById.get(designSource.formId)?.data ?? [];
    const out: Record<string, string> = {};
    for (const r of chooseRows(rows)) {
      const cell = (r.extracted_data ?? {})[designSource.field];
      const raw = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
      const value = raw == null ? '' : String(raw).trim();
      if (value) out[r.document_id] = value;
    }
    return out;
  }, [designSource, resultsById]);
  const designEntry = designSource ? resultsById.get(designSource.formId) : undefined;
  const designStatus: RobStatus = !designSource ? 'ready' : designEntry?.error ? 'error' : designEntry?.loading ? 'pending' : 'ready';

  const members = (membersQ.data ?? NONE) as ProjectMember[];
  const nameOf = useCallback((userId: string | null | undefined) => {
    if (!userId) return 'Not assigned';
    if (userId === currentUserId) return currentUser?.full_name || 'You';
    const m = members.find(x => x.user_id === userId);
    return m?.full_name || m?.email || 'Unknown member';
  }, [members, currentUserId, currentUser?.full_name]);

  /**
   * Study-level RoB: the worst COMPLETED overall across a study's assessments,
   * preferring the consensus record. Result-level identity would need the
   * registry, which this page deliberately does not use — hence "study-level".
   */
  const rob = useMemo(() => {
    const byDoc = new Map<string, RobStudy>();
    const records = robQ.data?.records ?? [];
    const tableField = ASSESSMENT_TABLE;
    const acc = new Map<string, { consensus: RobJudgement[]; reader: RobJudgement[]; total: number; done: number }>();
    for (const rec of records) {
      const a = acc.get(rec.document_id) ?? { consensus: [], reader: [], total: 0, done: 0 };
      for (const row of rowsOf(rec.extracted_data, tableField)) {
        const meta = parseMeta(row);
        a.total++;
        const complete = meta.complete === true || meta.complete === 'true';
        const overall = sevOf(meta.overall ?? meta.overall_override);
        if (complete && overall) {
          a.done++;
          (rec.extraction_type === 'consensus' ? a.consensus : a.reader).push(overall);
        }
      }
      acc.set(rec.document_id, a);
    }
    const high = new Set<string>();
    for (const [doc, a] of acc) {
      const pool = a.consensus.length ? a.consensus : a.reader;
      const overall = pool.length ? pool.reduce((w, j) => (RANK[j] > RANK[w] ? j : w), pool[0]) : null;
      if (overall === 'high') high.add(doc);
      byDoc.set(doc, { overall, assessments: a.total, completed: a.done, source: a.consensus.length ? 'consensus' : pool.length ? 'reader' : null });
    }
    const status: RobStatus = robQ.isSuccess ? 'ready' : robQ.isError ? 'error' : 'pending';
    return {
      byDoc, loaded: robQ.isSuccess, status, error: robQ.isError ? robQ.error : null,
      high, assessed: [...byDoc.values()].some(v => v.overall),
    };
  }, [robQ.data, robQ.isSuccess, robQ.isError, robQ.error]);

  const canEdit = isAdmin || permissions.isOwner || !!permissions.can_run_manual_extractions;
  const canManage = !!protocol.can_manage || isAdmin || permissions.isOwner || permissions.isAdmin
    || permissions.role === 'manager' || permissions.role === 'owner';

  const updateProtocol = useCallback(async (patch: ProtocolPatch) => {
    const next = await synthesisWorkspaceService.updateProtocol(projectId, patch);
    qc.setQueryData(['synthesis-protocol', projectId], next);
    return next;
  }, [projectId, qc]);

  const retry = useCallback(() => {
    for (const q of [protocolQ, groupsQ, formsQ, docsQ, membersQ, robQ, ...resultsQs]) {
      if (q.isError) void q.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocolQ.refetch, groupsQ.refetch, formsQ.refetch, docsQ.refetch, membersQ.refetch, robQ.refetch, ...resultsQs.map(q => q.refetch)]);

  const invalidateGroup = useCallback(async (groupId: string) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['synthesis-group', groupId] }),
      qc.invalidateQueries({ queryKey: ['synthesis-history', groupId] }),
      qc.invalidateQueries({ queryKey: ['synthesis-groups', projectId] }),
    ]);
  }, [qc, projectId]);

  const createGroup = useCallback(async (body: { title: string; branch: SynthesisBranch; target: SynthesisTarget }) => {
    const g = await synthesisWorkspaceService.createGroup(projectId, body);
    await qc.invalidateQueries({ queryKey: ['synthesis-groups', projectId] });
    return g;
  }, [projectId, qc]);

  const patchGroup = useCallback(async (groupId: string, patch: Parameters<typeof synthesisWorkspaceService.patchGroup>[1]) => {
    const g = await synthesisWorkspaceService.patchGroup(groupId, patch);
    await invalidateGroup(groupId);
    return g;
  }, [invalidateGroup]);

  const addDecision = useCallback(async (groupId: string, d: DecisionIn) => {
    await synthesisWorkspaceService.addDecision(groupId, d);
    await invalidateGroup(groupId);
  }, [invalidateGroup]);
  const revokeDecision = useCallback(async (groupId: string, id: string, reason?: string | null) => {
    await synthesisWorkspaceService.revokeDecision(groupId, id, reason);
    await invalidateGroup(groupId);
  }, [invalidateGroup]);
  const createRun = useCallback(async (groupId: string, run: RunIn) => {
    await synthesisWorkspaceService.createRun(groupId, run);
    await invalidateGroup(groupId);
  }, [invalidateGroup]);
  const finalize = useCallback(async (groupId: string, body: { run_id: string; current_hash: string; audit: AuditRow[]; bundle: Record<string, unknown> }) => {
    await synthesisWorkspaceService.finalize(groupId, body);
    await invalidateGroup(groupId);
  }, [invalidateGroup]);
  const approve = useCallback(async (groupId: string, versionId: string) => {
    await synthesisWorkspaceService.approve(groupId, versionId);
    await invalidateGroup(groupId);
  }, [invalidateGroup]);

  const loading = !!projectId && (protocolQ.isLoading || groupsQ.isLoading || formsQ.isLoading || docsQ.isLoading);

  const value: SynthesisData = {
    projectId,
    projectName: selectedProject?.name ?? '',
    loading,
    error: coreError,
    retry,
    protocol,
    protocolConfirmed: !!protocol.confirmed_at,
    canManage,
    canEdit,
    updateProtocol,
    groups: (groupsQ.data ?? NONE) as SynthesisGroup[],
    createGroup,
    patchGroup,
    forms,
    formById,
    formData,
    docs,
    docById,
    labelOf,
    members,
    nameOf,
    currentUserId,
    designByDocument,
    designSourceLabel: designSource ? `${designSource.field} on ${designSource.formName}` : null,
    designStatus,
    rob,
    addDecision,
    revokeDecision,
    createRun,
    finalize,
    approve,
  };

  return (
    <Ctx.Provider value={value}>
      {coreError && !loading
        ? <LoadError error={coreError} onRetry={retry} retrying={coreQs.some(q => q.isFetching)} />
        : children}
    </Ctx.Provider>
  );
}

/** A failed load, said out loud — with Retry, never an empty page that looks real. */
export function LoadError({ error, onRetry, retrying = false, what = 'the synthesis data' }: {
  error: unknown; onRetry: () => void; retrying?: boolean; what?: string;
}) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : null;
  return (
    <div role="alert" className="mx-auto my-10 max-w-[560px] rounded-xl border border-red-200 bg-red-50 px-5 py-4 dark:border-red-900/50 dark:bg-red-950/30">
      <div className="text-[14px] font-semibold text-red-800 dark:text-red-300">Could not load {what}</div>
      <div className="mt-1 text-[13px] text-red-700 dark:text-red-400">
        {message ?? 'The request failed.'} Nothing is shown in its place, so no empty result is mistaken for a real one.
      </div>
      <button type="button" onClick={onRetry} disabled={retrying}
        className="mt-3 inline-flex h-8 items-center rounded-lg border border-red-300 disabled:opacity-60 bg-white px-3 text-[13px] font-medium text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-900/40">
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

/** A group's decisions, runs and versions — loaded when its workspace opens. */
/**
 * Keys are `[kind, groupId, projectId]`: the project is part of the key so a
 * bundle fetched under one project is never served under another, and
 * `invalidateQueries({ queryKey: [kind, groupId] })` still matches by prefix.
 */
export function useGroupBundle(groupId: string | null | undefined) {
  const { projectId } = useSynthesis();
  return useQuery<GroupBundle>({
    queryKey: ['synthesis-group', groupId, projectId],
    queryFn: () => synthesisWorkspaceService.getGroup(groupId!),
    enabled: !!groupId && !!projectId,
    retry: false,
  });
}

export function useGroupHistory(groupId: string | null | undefined) {
  const { projectId } = useSynthesis();
  return useQuery({
    queryKey: ['synthesis-history', groupId, projectId],
    queryFn: () => synthesisWorkspaceService.history(groupId!),
    enabled: !!groupId && !!projectId,
    retry: false,
  });
}

/**
 * Rows for a form that is not (yet) a protocol source — the mapping screen's form.
 * `fieldName` is the table the mapping is (or will be) made against; it drives
 * the flattening so the columns shown are that table's (see `fieldsForFlattening`).
 */
export function useFormRows(formId: string | null | undefined, fieldName?: string | null) {
  const { projectId, formById, docs } = useSynthesis();
  const q = useQuery({
    queryKey: ['synthesis-results', projectId, formId],
    queryFn: () => resultsService.getAllForForm(projectId, formId!),
    enabled: !!projectId && !!formId,
    retry: false,
  });
  const docMap = useMemo(() => Object.fromEntries(docs.map(d => [d.id, d])) as Record<string, Document>, [docs]);
  return useMemo(() => {
    const form = formId ? formById.get(formId) : undefined;
    if (!form) return null;
    return buildFormData(
      form, (q.data ?? NONE) as ExtractionResult[], docMap, q.isPending,
      fieldName, q.isError ? q.error : null, () => { void q.refetch(); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, formById, q.data, q.status, q.error, docMap, fieldName]);
}

'use client';

/**
 * Everything the Risk of Bias screens read and write, loaded once.
 *
 * One provider at the top of the page, so switching screens never refetches and
 * every screen agrees on what the protocol, the registry and the stored
 * assessments say. Screens call `useRob()`; none of them talks to a service for
 * data another screen also needs.
 */

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import {
  documentsService, formsService, projectMembersService, resultsService, robService,
} from '@/services';
import type {
  RobAssessmentRecord, RobAssessmentStatus, RobAssessmentsResponse, RobContrast, RobProtocol, RobProtocolPatch,
} from '@/services/rob.service';
import { buildLabelMap } from '@/lib/documentLabel';
import type { Document, Form, ProjectMember } from '@/types/api';

import { bindForm, type BoundForm } from './robAdapter';
import type { ResultIdentity } from './robIdentity';
import {
  outcomesOf, readRecord, removeAssessment, writeAssessment, writeRecord, type Assessment, type AssessmentStatus,
  type DeviationType, type EffectOfInterest, type OutcomeTarget, type RecordView,
  type Seat, type StudyD1, type StudyDesign,
} from './robModel';
import { bindSignalling, type SignallingBinding } from './robSignalling';
import { presetFormDescription, presetFormFields, presetFormName, ROB2 } from './robTools';

export const DEFAULT_PROTOCOL = (projectId: string): RobProtocol => ({
  project_id: projectId,
  form_id: null,
  scope: null,
  effect: null,
  deviation_types: ['nonprotocol', 'implementation', 'nonadherence'],
  reviewers: { reviewer_1: null, reviewer_2: null, adjudicator: null },
  study_designs: {},
  tool_version: '2019-08-22',
  anticipated_deviations: '',
  confirmed_at: null,
  history: [],
  assessment_count: 0,
});

function bindingFor(bound: BoundForm): SignallingBinding | null {
  const table = bound.tableField
    ? (bound.form.fields ?? []).find(f => f?.field_name === bound.tableField) : null;
  const fields = table ? (table.subform_fields ?? []) : (bound.form.fields ?? []);
  const binding = bindSignalling(fields as any);
  return binding.usable ? binding : null;
}

export interface SaveInput {
  documentId: string;
  study: StudyD1;
  assessment: Assessment;
  /** The adjudicator's consensus record rather than a reviewer's own. */
  asConsensus?: boolean;
  /**
   * Other entries of the SAME record to rewrite in this save — e.g. sibling
   * assessments reopened because the study's shared D1 answers changed.
   */
  alsoAssessments?: Assessment[];
}

export interface RobData {
  projectId: string;
  projectName: string;
  loading: boolean;

  protocol: RobProtocol;
  /** The protocol has been set up (the welcome screen is done). */
  protocolSet: boolean;
  /** The effect an assessment defaults to (`both` → assignment until chosen). */
  defaultEffect: EffectOfInterest;
  updateProtocol: (patch: RobProtocolPatch) => Promise<RobProtocol>;

  forms: Form[];
  robForm: BoundForm | null;
  binding: SignallingBinding | null;

  /** Every registry result, active and held. */
  results: ResultIdentity[];
  contrasts: RobContrast[];
  resultById: Map<string, ResultIdentity>;
  /** Active results per document, in registry order. */
  resultsOf: (documentId: string) => ResultIdentity[];
  outcomesOfDoc: (documentId: string) => OutcomeTarget[];

  docs: Document[];
  /** Documents with at least one result — the studies to assess. */
  studies: Document[];
  labelOf: (documentId: string) => string;
  docById: Map<string, Document>;
  designOf: (documentId: string) => { design: StudyDesign | null; confirmed: boolean };

  members: ProjectMember[];
  nameOf: (userId: string | null | undefined) => string;

  currentUserId: string;
  mySeat: Seat | null;
  seatOf: (userId: string | null | undefined) => Seat | null;
  canEdit: boolean;
  canManage: boolean;

  records: RobAssessmentRecord[];
  statuses: RobAssessmentStatus[];
  /** A person's (or the consensus) record for a study, read into the model. */
  viewOf: (documentId: string, who: string | 'consensus') => RecordView | null;
  myView: (documentId: string) => RecordView | null;
  /** Whoever holds a seat: their status on a target, blinding-safe. */
  statusOf: (documentId: string, targetId: string, seat: Seat) => AssessmentStatus;

  save: (input: SaveInput) => Promise<void>;
  /** Delete MY OWN entry for one target (owners/managers only in the UI). */
  removeMine: (documentId: string, targetId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const RobContext = createContext<RobData | null>(null);

// Stable fallbacks: a fresh `[]` per render would re-run every memo below it.
const NONE: never[] = [];

export function useRob(): RobData {
  const value = useContext(RobContext);
  if (!value) throw new Error('useRob() outside <RobProvider>');
  return value;
}

export function RobProvider({ children }: { children: ReactNode }) {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? '';
  const { currentUser, isAdmin } = useAuth();
  const permissions = useProjectPermissions();
  const queryClient = useQueryClient();
  const currentUserId = currentUser?.id ?? '';

  const protocolQ = useQuery({
    queryKey: ['rob-protocol', projectId],
    queryFn: () => robService.getProtocol(projectId),
    enabled: !!projectId,
  });
  const formsQ = useQuery({
    queryKey: ['rob-forms', projectId],
    queryFn: async () => ((await formsService.getAll(projectId)) as Form[])
      .filter(f => f.status === 'active' || f.status === 'draft'),
    enabled: !!projectId,
  });
  const registryQ = useQuery({
    queryKey: ['rob-registry', projectId],
    queryFn: () => robService.listResults(projectId),
    enabled: !!projectId,
  });
  const assessmentsQ = useQuery({
    queryKey: ['rob-assessments', projectId],
    queryFn: () => robService.listAssessments(projectId),
    enabled: !!projectId,
  });
  const docsQ = useQuery({
    queryKey: ['rob-docs', projectId],
    queryFn: () => documentsService.getAll(projectId),
    enabled: !!projectId,
  });
  const membersQ = useQuery({
    queryKey: ['rob-members', projectId],
    queryFn: () => projectMembersService.listMembers(projectId).catch(() => [] as ProjectMember[]),
    enabled: !!projectId,
  });

  const fallbackProtocol = useMemo(() => DEFAULT_PROTOCOL(projectId), [projectId]);
  const protocol = protocolQ.data ?? fallbackProtocol;
  const forms = (formsQ.data ?? NONE) as Form[];

  const [robForm, binding] = useMemo<[BoundForm | null, SignallingBinding | null]>(() => {
    // The protocol names its form; fall back to the first form that can hold RoB 2.
    const ordered = protocol.form_id
      ? [...forms].sort((a, b) => Number(b.id === protocol.form_id) - Number(a.id === protocol.form_id))
      : forms;
    for (const form of ordered) {
      const bound = bindForm(form);
      if (!bound || bound.tool.id !== 'rob2') continue;
      const questions = bindingFor(bound);
      if (questions) return [bound, questions];
    }
    return [null, null];
  }, [forms, protocol.form_id]);

  const contrasts = registryQ.data?.contrasts ?? NONE;
  const results: ResultIdentity[] = useMemo(() => {
    const byId = new Map(contrasts.map(c => [c.id, c]));
    return (registryQ.data?.results ?? []).map(r => ({
      ...r, contrast: r.contrast_id ? byId.get(r.contrast_id) ?? null : null,
    })) as ResultIdentity[];
  }, [registryQ.data, contrasts]);
  const resultById = useMemo(() => new Map(results.map(r => [r.id, r])), [results]);

  const resultsByDoc = useMemo(() => {
    const map = new Map<string, ResultIdentity[]>();
    for (const r of results) {
      if (r.state === 'merged') continue;
      const list = map.get(r.document_id) ?? [];
      list.push(r);
      map.set(r.document_id, list);
    }
    return map;
  }, [results]);
  const resultsOf = useCallback((d: string) => resultsByDoc.get(d) ?? [], [resultsByDoc]);
  const outcomesOfDoc = useCallback((d: string) => outcomesOf(resultsByDoc.get(d) ?? []), [resultsByDoc]);

  const docs = (docsQ.data ?? NONE) as Document[];
  const docById = useMemo(() => new Map(docs.map(d => [d.id, d])), [docs]);
  const labels = useMemo(() => buildLabelMap(docs), [docs]);
  const labelOf = useCallback((d: string) => labels[d] ?? docById.get(d)?.filename ?? 'Study', [labels, docById]);
  const studies = useMemo(
    () => docs.filter(d => resultsByDoc.has(d.id)).sort((a, b) => labelOf(a.id).localeCompare(labelOf(b.id))),
    [docs, resultsByDoc, labelOf]);

  const designOf = useCallback((d: string) => {
    const entry = protocol.study_designs?.[d];
    return { design: (entry?.design ?? null) as StudyDesign | null, confirmed: !!entry?.confirmed };
  }, [protocol.study_designs]);

  const members = (membersQ.data ?? NONE) as ProjectMember[];
  const nameOf = useCallback((userId: string | null | undefined) => {
    if (!userId) return 'Unassigned';
    if (userId === currentUserId) return currentUser?.full_name || 'You';
    const m = members.find(x => x.user_id === userId);
    return m?.full_name || m?.email || 'Unknown member';
  }, [members, currentUserId, currentUser?.full_name]);

  const seatOf = useCallback((userId: string | null | undefined): Seat | null => {
    if (!userId) return null;
    const r = protocol.reviewers ?? {};
    if (r.reviewer_1 === userId) return 'reviewer_1';
    if (r.reviewer_2 === userId) return 'reviewer_2';
    if (r.adjudicator === userId) return 'adjudicator';
    return null;
  }, [protocol.reviewers]);
  const mySeat = seatOf(currentUserId);

  const canEdit = isAdmin || permissions.isOwner || !!permissions.can_run_manual_extractions;
  const canManage = isAdmin || permissions.isOwner || permissions.isAdmin
    || permissions.role === 'manager' || permissions.role === 'owner';

  const defaultEffect: EffectOfInterest = protocol.effect === 'adherence' ? 'adherence' : 'assignment';
  const deviations = (protocol.deviation_types ?? NONE) as DeviationType[];

  const records = assessmentsQ.data?.records ?? NONE;
  const statuses = assessmentsQ.data?.statuses ?? NONE;

  const views = useMemo(() => {
    const map = new Map<string, RecordView>();
    if (!binding) return map;
    const ctx = {
      binding, effect: defaultEffect, deviations,
      contrastIdOf: (id: string) => resultById.get(id)?.contrast?.id ?? '',
    };
    const table = robForm?.tableField ?? undefined;
    // Newest record per (document, person) — or per document for consensus.
    const latest = new Map<string, RobAssessmentRecord>();
    for (const rec of records) {
      const who = rec.extraction_type === 'consensus' ? 'consensus' : rec.extracted_by ?? '';
      if (!who) continue;
      const key = `${rec.document_id}|${who}`;
      const cur = latest.get(key);
      if (!cur || (rec.updated_at ?? rec.created_at) > (cur.updated_at ?? cur.created_at)) latest.set(key, rec);
    }
    for (const [key, rec] of latest) map.set(key, readRecord(rec.extracted_data, ctx, table));
    return map;
  }, [records, binding, defaultEffect, deviations, resultById, robForm?.tableField]);

  const viewOf = useCallback((d: string, who: string) => views.get(`${d}|${who}`) ?? null, [views]);
  const myView = useCallback((d: string) => viewOf(d, currentUserId), [viewOf, currentUserId]);

  const statusOf = useCallback((d: string, targetId: string, seat: Seat): AssessmentStatus => {
    const holder = protocol.reviewers?.[seat];
    if (!holder) return 'none';
    const hit = statuses.find(s => s.document_id === d && s.target_id === targetId
      && s.extraction_type === 'manual' && s.extracted_by === holder);
    return hit ? hit.status : 'none';
  }, [statuses, protocol.reviewers]);

  const updateProtocol = useCallback(async (patch: RobProtocolPatch) => {
    const next = await robService.updateProtocol(projectId, patch);
    queryClient.setQueryData(['rob-protocol', projectId], next);
    // An effect change can reset stored assessments server-side.
    if (patch.effect || patch.deviation_types) {
      await queryClient.invalidateQueries({ queryKey: ['rob-assessments', projectId] });
    }
    return next;
  }, [projectId, queryClient]);

  /**
   * The RoB 2 form, created from the preset on first save. It is a DRAFT on
   * purpose (see CLAUDE.md): there is no codegen to run for a data-entry form.
   */
  const ensureForm = useCallback(async (): Promise<{ form: BoundForm; binding: SignallingBinding }> => {
    if (robForm && binding) {
      if (protocol.form_id !== robForm.form.id) {
        await updateProtocol({ form_id: robForm.form.id }).catch(() => undefined);
      }
      return { form: robForm, binding };
    }
    const created = await formsService.create({
      project_id: projectId,
      form_name: presetFormName(ROB2),
      form_description: presetFormDescription(ROB2),
      fields: presetFormFields(ROB2) as any,
      save_as_draft: true,
    });
    await queryClient.invalidateQueries({ queryKey: ['rob-forms', projectId] });
    const bound = bindForm(created as Form);
    const questions = bound ? bindingFor(bound) : null;
    if (!bound || !questions) throw new Error('Could not create the RoB 2 form for this project.');
    await updateProtocol({ form_id: bound.form.id }).catch(() => undefined);
    return { form: bound, binding: questions };
  }, [robForm, binding, protocol.form_id, projectId, queryClient, updateProtocol]);

  /**
   * Saves run ONE AT A TIME, each built on the newest copy of the record.
   *
   * A save rewrites the whole record, so two overlapping autosaves — or one
   * built on a query cache that has not refetched since the last save — can
   * put back what the previous save just changed. The chain serialises them,
   * and the server's response replaces the cached record before the next save
   * reads it.
   */
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const save = useCallback((input: SaveInput) => {
    const run = saveChain.current.catch(() => undefined).then(async () => {
      const { documentId, study, assessment, asConsensus, alsoAssessments } = input;
      const { form, binding: b } = await ensureForm();
      const key = ['rob-assessments', projectId];
      const cached = queryClient.getQueryData<RobAssessmentsResponse>(key);
      const pool = cached?.records ?? records;
      const mine = pool
        .filter(r => r.document_id === documentId && (asConsensus
          ? r.extraction_type === 'consensus'
          : r.extraction_type === 'manual' && r.extracted_by === currentUserId))
        .sort((x, y) => (y.updated_at ?? y.created_at).localeCompare(x.updated_at ?? x.created_at))[0];
      const common = {
        study,
        domains: form.domains.filter(d => !d.extra),
        tool: form.tool,
        tableField: form.tableField ?? undefined,
      };
      let data = writeRecord(mine?.extracted_data, b, { ...common, assessment });
      for (const other of alsoAssessments ?? []) {
        if (other.targetId === assessment.targetId) continue;
        data = writeAssessment(data, b, { ...common, assessment: other });
      }
      const saved = await resultsService.saveManualExtraction({
        document_id: documentId,
        form_id: form.form.id,
        extracted_data: data,
        extraction_type: asConsensus ? 'consensus' : 'manual',
        reviewer_role: asConsensus ? 'adjudicator' : mySeat,
      } as any);
      // Put the stored row in the cache now, so the next save builds on it.
      const row = saved as any;
      if (row?.id && row?.extracted_data) {
        queryClient.setQueryData<RobAssessmentsResponse>(key, prev => {
          if (!prev) return prev;
          const record: RobAssessmentRecord = {
            id: row.id, document_id: row.document_id ?? documentId, form_id: row.form_id ?? form.form.id,
            extracted_by: row.extracted_by ?? currentUserId, extraction_type: asConsensus ? 'consensus' : 'manual',
            seat: asConsensus ? 'adjudicator' : mySeat, extracted_data: row.extracted_data,
            created_at: row.created_at ?? new Date().toISOString(),
            updated_at: row.updated_at ?? new Date().toISOString(),
          };
          const others = prev.records.filter(r => r.id !== record.id);
          return { ...prev, records: [...others, record] };
        });
      }
      await queryClient.invalidateQueries({ queryKey: key });
    });
    saveChain.current = run;
    return run as Promise<void>;
  }, [ensureForm, records, currentUserId, mySeat, queryClient, projectId]);

  const removeMine = useCallback((documentId: string, targetId: string) => {
    const run = saveChain.current.catch(() => undefined).then(async () => {
      const key = ['rob-assessments', projectId];
      const cached = queryClient.getQueryData<RobAssessmentsResponse>(key);
      const mine = (cached?.records ?? records)
        .filter(r => r.document_id === documentId && r.extraction_type === 'manual' && r.extracted_by === currentUserId)
        .sort((x, y) => (y.updated_at ?? y.created_at).localeCompare(x.updated_at ?? x.created_at))[0];
      if (!mine || !robForm) return;
      const data = removeAssessment(mine.extracted_data, targetId, robForm.tableField ?? undefined);
      await resultsService.saveManualExtraction({
        document_id: documentId, form_id: mine.form_id, extracted_data: data,
        extraction_type: 'manual', reviewer_role: mySeat,
      } as any);
      await queryClient.invalidateQueries({ queryKey: key });
    });
    saveChain.current = run;
    return run as Promise<void>;
  }, [projectId, queryClient, records, currentUserId, robForm, mySeat]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['rob-protocol', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['rob-registry', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['rob-assessments', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['rob-forms', projectId] }),
    ]);
  }, [queryClient, projectId]);

  const loading = protocolQ.isLoading || formsQ.isLoading || registryQ.isLoading
    || assessmentsQ.isLoading || docsQ.isLoading;

  const value: RobData = {
    projectId, projectName: selectedProject?.name ?? '', loading,
    protocol, protocolSet: !!protocol.confirmed_at, defaultEffect, updateProtocol,
    forms, robForm, binding,
    results, contrasts, resultById, resultsOf, outcomesOfDoc,
    docs, studies, labelOf, docById, designOf,
    members, nameOf,
    currentUserId, mySeat, seatOf, canEdit, canManage,
    records, statuses, viewOf, myView, statusOf,
    save, removeMine, refresh,
  };
  return <RobContext.Provider value={value}>{children}</RobContext.Provider>;
}

'use client';

/**
 * One synthesis group, fully derived: the model, the dataset and its hash,
 * the latest run and whether it is stale, the planned-analysis statuses, the
 * live audit and the derived status. The dashboard uses the same pure
 * `computeWorkspace` over every group, so a pill on the list and the header of
 * the workspace can never disagree.
 */

import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import {
  synthesisWorkspaceService,
  type AuditRow, type GroupBundle, type SynthesisGroup, type SynthesisRun, type SynthesisSourceForm,
} from '@/services/synthesis.service';
import { datasetHash } from './datasetHash';
import { useSynthesisNav } from './nav';
import {
  analysesOf, analysisStatuses, auditPasses, auditRows, deriveModel, deriveStatus, runConfigOf, staleDiff,
  type AnalysisSpec, type AnalysisStatus, type DatasetRow, type DerivedStatus, type RunConfig,
  type StaleDiff, type SynthesisModelResult,
} from './synthesisModel';
import { useGroupBundle, useSynthesis, type FormData, type SynthesisData } from './useSynthesisData';

export interface WorkspaceState {
  group: SynthesisGroup;
  bundle: GroupBundle | null;
  sourceForm: SynthesisSourceForm | null;
  formData: FormData | null;
  model: SynthesisModelResult;
  /** The dataset as it is posted and hashed (JSON-clean). */
  dataset: DatasetRow[];
  hash: string;
  runs: SynthesisRun[];
  latestRun: SynthesisRun | null;
  config: RunConfig;
  diff: StaleDiff;
  analyses: AnalysisSpec[];
  statuses: AnalysisStatus[];
  audit: AuditRow[];
  auditPass: boolean;
  status: DerivedStatus;
  robMissing: string[];
  /**
   * RoB could not be read (still loading, or the request failed). `robMissing`
   * is then empty because nothing is KNOWN, and the audit's RoB row is failed
   * as "unknown" rather than passing as "present for every study".
   */
  robUnknown: boolean;
  /**
   * The source form's extractions (or the design form's) are still loading, or
   * failed. The model, dataset and hash are then computed from rows that were
   * never read — a caller must show this state, not the numbers.
   */
  dataLoading: boolean;
  dataError: unknown | null;
  subgroupColumns: string[];
}

export function sourceFormOf(syn: Pick<SynthesisData, 'protocol'>, group: SynthesisGroup): SynthesisSourceForm | null {
  const list = syn.protocol.source_forms ?? [];
  return list.find(sf => sf.form_id === group.target?.source_form_id) ?? null;
}

export function computeWorkspace(syn: SynthesisData, group: SynthesisGroup, bundle: GroupBundle | null): WorkspaceState {
  const sourceForm = sourceFormOf(syn, group);
  const formData = syn.formData(sourceForm?.form_id);
  const decisions = bundle?.decisions ?? [];
  const mappedCols = new Set(Object.values(sourceForm?.mapping ?? {}));
  const subgroupColumns = (formData?.selectColumns ?? []).filter(c => !mappedCols.has(c));
  const model = deriveModel({
    group: bundle?.group ?? group,
    decisions,
    sourceForm,
    rows: formData?.rows ?? [],
    columns: formData?.columns ?? [],
    defaults: syn.protocol.defaults ?? [],
    designByDocument: syn.designByDocument,
    subgroupColumns,
  });
  const dataset = JSON.parse(JSON.stringify(model.dataset)) as DatasetRow[];
  const hash = datasetHash(dataset);
  const runs = [...(bundle?.runs ?? [])].sort((a, b) => a.n - b.n);
  const latestRun = runs[runs.length - 1] ?? null;
  const target = (bundle?.group ?? group).target;
  const analyses = analysesOf(syn.protocol.planned_analyses ?? [], decisions);
  const config = runConfigOf(model, target, {
    decisions, analyses,
    // RoB inputs are only recorded once the assessments have actually loaded.
    ...(syn.rob.loaded ? { robHigh: syn.rob.high, robAssessed: syn.rob.assessed } : {}),
  });
  const diff = staleDiff(latestRun, dataset, hash, config);
  const statuses = analysisStatuses(analyses, latestRun, decisions);
  const inRun = ((latestRun?.dataset ?? dataset) as DatasetRow[]);
  const robUnknown = !syn.rob.loaded;
  const robMissing = robUnknown
    ? []
    : inRun.filter(r => !syn.rob.byDoc.get(r.document_id)?.overall).map(r => r.label);
  const branch = (bundle?.group ?? group).branch;
  const audit = auditRows({
    model, currentHash: hash, latestRun, diff, branch, decisions, analyses: statuses, robMissing,
  }).map(row => (row.id === 'rob' && robUnknown
    // An empty `robMissing` from an unread RoB list is not "none missing".
    ? {
      ...row, ok: false,
      text: syn.rob.status === 'error'
        ? 'Risk of bias unknown — the assessments could not be loaded (retry before finalizing)'
        : 'Risk of bias unknown — the assessments are still loading',
    }
    : row));
  const auditPass = auditPasses(audit);
  const status = deriveStatus({
    targetConfirmed: model.targetConfirmed,
    blockingCount: model.blocking.length,
    runs: runs.length,
    versions: bundle?.versions ?? [],
    currentHash: bundle ? hash : null,
    branch,
  });
  const dataError = formData?.error ?? (syn.designStatus === 'error' ? new Error('The study-design form\'s extractions could not be loaded.') : null);
  const dataLoading = !dataError && (!!formData?.loading || syn.designStatus === 'pending');
  return {
    group: bundle?.group ?? group, bundle, sourceForm, formData, model, dataset, hash, runs, latestRun,
    config, diff, analyses, statuses, audit, auditPass, status, robMissing, robUnknown,
    dataLoading, dataError, subgroupColumns,
  };
}

/** A group belongs to the selected project, or it is not shown under it. */
function inProject(group: SynthesisGroup | null | undefined, projectId: string): boolean {
  return !!group && !!projectId && (!group.project_id || group.project_id === projectId);
}

/**
 * `state` is null while the group, or the rows it is computed from, are loading
 * or failed — a workspace computed from unread rows would show zero studies and
 * a hash of the empty dataset as if they were real. `error` then says why and
 * `retry` re-fetches.
 *
 * A group from another project (the project selector keeps `?id=` when it
 * switches) is rejected: the id is dropped and the dashboard shown, and the
 * bundle query is keyed on the project so a cached one never crosses over.
 */
export function useWorkspace(groupId: string): {
  state: WorkspaceState | null; loading: boolean; error: unknown; retry: () => void; wrongProject: boolean;
} {
  const syn = useSynthesis();
  const { go } = useSynthesisNav();
  const q = useGroupBundle(groupId);
  const fetched = q.data?.group ?? null;
  const listed = syn.groups.find(g => g.id === groupId) ?? null;
  const candidate = fetched ?? listed;
  const wrongProject = !!candidate && !inProject(candidate, syn.projectId);
  const group = wrongProject ? null : candidate;
  const bundle = wrongProject ? null : q.data ?? null;

  useEffect(() => {
    if (wrongProject) go({ screen: 'dashboard', id: null, tab: null, run: null }, { replace: true });
  }, [wrongProject, go]);

  const state = useMemo(
    () => (group ? computeWorkspace(syn, group, bundle) : null),
    // syn changes identity on every render of the provider; its parts are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group, bundle, syn.protocol, syn.formData, syn.designByDocument, syn.designStatus, syn.rob],
  );
  const retry = () => {
    if (q.isError) void q.refetch();
    state?.formData?.retry();
    syn.retry();
  };
  if (wrongProject) {
    return { state: null, loading: false, error: new Error('This synthesis belongs to another project.'), retry, wrongProject };
  }
  if (state && state.dataError) return { state: null, loading: false, error: state.dataError, retry, wrongProject };
  if (state && state.dataLoading) return { state: null, loading: true, error: null, retry, wrongProject };
  return { state, loading: q.isLoading, error: q.error, retry, wrongProject };
}

/** Every group's bundle, for the dashboard's derived statuses. */
export function useAllWorkspaces(): WorkspaceState[] {
  const syn = useSynthesis();
  const qs = useQueries({
    queries: syn.groups.map(g => ({
      queryKey: ['synthesis-group', g.id, syn.projectId],
      queryFn: () => synthesisWorkspaceService.getGroup(g.id),
      enabled: !!syn.projectId,
      retry: false,
    })),
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Each state carries `dataLoading` / `dataError` / `robUnknown`, so a pill can
  // say "loading" or "could not load" instead of a status derived from no rows.
  return useMemo(() => syn.groups
    .filter(g => inProject(g, syn.projectId))
    .map(g => computeWorkspace(syn, g, (qs[syn.groups.indexOf(g)]?.data as GroupBundle | undefined) ?? null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syn.groups, syn.projectId, syn.protocol, syn.formData, syn.designByDocument, syn.designStatus, syn.rob, ...qs.map(q => q.data)]);
}

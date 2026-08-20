'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, FileCheck, FolderOpen } from 'lucide-react';

import { DashboardLayout } from '@/components/layout';
import { EmptyState, Spinner } from '@/components/ui';
import { useProject } from '@/contexts/ProjectContext';
import { documentsService, formsService, resultsService, synthesisService } from '@/services';
import { transformToLongFormat, classifyFields } from '@/lib/longFormatTransform';
import {
  isRatioMeasure, isSingleGroupMeasure, poolingMethodsFor, runMetaAnalysis,
  type EffectMeasure, type PoolingModel, type StudyEffect,
} from '@/lib/metaAnalysis';
import type { ProportionMethod } from '@/lib/singleGroupMeta';
import { designGuards } from './_lib/designGuards';
import type { Document, ExtractionResult, Form } from '@/types/api';

import { StepNav, type Step } from './_components/StepNav';
import { MappingStep } from './_components/MappingStep';
import { UnitsCard, type MeasureTally } from './_components/UnitsCard';
import { ComparisonStep } from './_components/ComparisonStep';
import { ForestPlot } from './_components/ForestPlot';
import { EvidenceDrawer } from './_components/EvidenceDrawer';
import { NotPoolableExplainer } from './_components/NotPoolableExplainer';
import { CorpusBar } from './_components/CorpusBar';
import { AbsoluteEffectCard } from './_components/AbsoluteEffectCard';
import { MethodsPanel } from './_components/MethodsPanel';
import { DesignGuardCard } from './_components/DesignGuardCard';
import { DiagnosticsStep } from './_components/DiagnosticsStep';
import { HarmonizeCard, DirectionCard } from './_components/ReconcileCards';
import {
  allConfirmed, columnCoverage, effectOptions, loadMapping, saveMapping,
  type EffectScale, type Mapping, type OutcomeKind, type SlotKey, type TableLayout,
} from './_lib/mapping';
import {
  ALL_COMPARISONS, buildPairings, buildStudies,
  detectArmLabelColumns, detectCentralTendencyMeasureColumn,
  detectComparisonColumn, detectVariabilityMeasureColumn, facetsOf, isMedian,
  reasonFromNotEstimable,
  type CentralTendencyAction, type VariabilityAction,
} from './_lib/buildStudies';
import {
  KEEP, harmonizationIsActive, suggestDirections, suggestHarmonization, tallyScales, tallyValues,
  type Confirmations, type Directions, type Harmonization,
} from './_lib/reconcile';

/** Priority order when a document has several extractions for the same form. */
const SOURCE_RANK: Record<string, number> = { consensus: 3, manual: 2, ai: 1 };

export default function SynthesisPage() {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? '';

  const [step, setStep] = useState<Step>(1);
  const [furthest, setFurthest] = useState<Step>(1);
  const [formId, setFormId] = useState('');
  const [kind, setKind] = useState<OutcomeKind>('dichotomous');
  const [layout, setLayout] = useState<TableLayout>('wide');
  /** Only read when kind is 'effect' — which scale the reported effect column is on. */
  const [effectScale, setEffectScale] = useState<EffectScale>('natural');
  /** Minimal important difference, as typed, on the natural scale. '' means none. */
  const [mid, setMid] = useState('');
  /** Assumed comparator risk for the absolute effect, as typed (percent). '' = use the corpus. */
  const [assumedRisk, setAssumedRisk] = useState('');
  /** How a proportion corpus is pooled. Only read when the measure is PROP. */
  const [proportionMethod, setProportionMethod] = useState<ProportionMethod>('glmm');
  const [mapping, setMapping] = useState<Mapping>({});
  const [comparatorValue, setComparatorValue] = useState('');
  const [variabilityActions, setVariabilityActions] = useState<Record<string, VariabilityAction>>({});
  const [centralActions, setCentralActions] = useState<Record<string, CentralTendencyAction>>({});
  const [outcome, setOutcome] = useState('');
  const [comparison, setComparison] = useState('');
  const [timepoint, setTimepoint] = useState('');
  const [measure, setMeasure] = useState<EffectMeasure>('RR');
  const [model, setModel] = useState<PoolingModel>('random');
  const [drawer, setDrawer] = useState<StudyEffect | null>(null);
  const [suggestNonce, setSuggestNonce] = useState(0);
  const [harmonizeChoices, setHarmonizeChoices] = useState<Harmonization>({});
  const [harmonizeConfirmed, setHarmonizeConfirmed] = useState<Confirmations>({});
  const [directionChoices, setDirectionChoices] = useState<Directions>({});
  const [directionConfirmed, setDirectionConfirmed] = useState<Confirmations>({});
  const [subgroupColumn, setSubgroupColumn] = useState('');

  // ── Data ───────────────────────────────────────────────────────────────────

  const { data: forms = [], isLoading: formsLoading } = useQuery({
    queryKey: ['synthesis-forms', projectId],
    queryFn: async () => {
      const all = await formsService.getAll(projectId);
      return all.filter((f: Form) => f.status === 'active');
    },
    enabled: !!projectId,
  });

  const activeFormId = formId || forms[0]?.id || '';
  const form = forms.find((f: Form) => f.id === activeFormId);

  const { data: results = [], isLoading: resultsLoading } = useQuery({
    queryKey: ['synthesis-results', projectId, activeFormId],
    queryFn: () => resultsService.getAllForForm(projectId, activeFormId),
    enabled: !!projectId && !!activeFormId,
  });

  const { data: docs = [] } = useQuery({
    queryKey: ['synthesis-docs', projectId],
    queryFn: () => documentsService.getAll(projectId),
    enabled: !!projectId,
  });

  const { data: consensusSummary } = useQuery({
    queryKey: ['synthesis-consensus', projectId, activeFormId],
    queryFn: () => resultsService.getConsensusSummary(projectId, activeFormId),
    enabled: !!projectId && !!activeFormId,
    retry: false,
  });

  const { data: suggestion, isFetching: suggesting } = useQuery({
    queryKey: ['synthesis-suggest', activeFormId, suggestNonce],
    queryFn: () => synthesisService.suggestMapping(activeFormId, { force: suggestNonce > 0 }),
    enabled: !!activeFormId,
    retry: false,
    staleTime: Infinity,
  });

  // ── Rows ───────────────────────────────────────────────────────────────────

  const docMap = useMemo(() => {
    const m: Record<string, Document> = {};
    for (const d of docs) m[d.id] = d;
    return m;
  }, [docs]);

  /**
   * One extraction per document, highest-trust first. A document with an
   * adjudicated consensus row contributes that; otherwise its manual review;
   * otherwise the AI pass. The banner below says how the corpus actually splits,
   * because pooling adjudicated and unreviewed values without saying so is the
   * one thing this screen must never do.
   */
  const chosen = useMemo(() => {
    const best = new Map<string, ExtractionResult>();
    for (const r of results as ExtractionResult[]) {
      const rank = SOURCE_RANK[r.extraction_type] ?? 0;
      const current = best.get(r.document_id);
      const currentRank = current ? SOURCE_RANK[current.extraction_type] ?? 0 : -1;
      if (rank > currentRank) best.set(r.document_id, r);
      else if (rank === currentRank && current && r.created_at > current.created_at) {
        best.set(r.document_id, r);
      }
    }
    return [...best.values()];
  }, [results]);

  /**
   * How the plotted corpus actually splits.
   *
   * The denominator is the project's document count, not the number that
   * happens to have results — a form extracted on 12 of 40 documents is 12 of
   * 40, and reporting it as 12 of 12 would flatter the coverage. `reviewed`
   * counts documents whose contributing row is a human one.
   */
  const provenance = useMemo(() => {
    let consensus = 0;
    let manual = 0;
    for (const r of chosen) {
      if (r.extraction_type === 'consensus') consensus++;
      else if ((SOURCE_RANK[r.extraction_type] ?? 0) >= 2) manual++;
    }
    const reviewed = consensus + manual;
    const total = consensusSummary?.summary.total_docs ?? chosen.length;
    return {
      consensus,
      manual,
      reviewed,
      aiOnly: chosen.length - reviewed,
      withData: chosen.length,
      total,
      missing: Math.max(0, total - chosen.length),
    };
  }, [chosen, consensusSummary]);

  const long = useMemo(
    () => transformToLongFormat(chosen, form?.fields ?? [], docMap),
    [chosen, form, docMap],
  );

  const classification = useMemo(
    () => classifyFields(form?.fields ?? []),
    [form],
  );

  const sourceField = suggestion?.field_name ?? classification.deepestTableField?.field_name ?? null;

  const tableColumnNames = useMemo(
    () => (suggestion?.columns ?? []).map(c => c.name),
    [suggestion],
  );

  /** Every column the mapper may point at — table columns plus joined flat fields. */
  const selectableColumns = useMemo(() => {
    const skip = new Set(['Paper', 'Ref ID']);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...tableColumnNames, ...long.columns]) {
      if (skip.has(c) || seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  }, [tableColumnNames, long.columns]);

  const totalDocuments = chosen.length;

  const scalarCoverage = useMemo(
    () => columnCoverage(
      long.rows,
      classification.flatFields.map(f => f.field_name).filter(n => long.columns.includes(n)),
      totalDocuments,
    ),
    [long, classification, totalDocuments],
  );

  const tableCoverage = useMemo(
    () => columnCoverage(long.rows, tableColumnNames.filter(n => long.columns.includes(n)), totalDocuments),
    [long, tableColumnNames, totalDocuments],
  );

  // ── Apply a suggestion, or a saved mapping ─────────────────────────────────

  useEffect(() => {
    if (!activeFormId) return;
    const stored = loadMapping(activeFormId);
    if (stored) {
      setKind(stored.kind);
      setLayout(stored.layout);
      if (stored.effectScale) setEffectScale(stored.effectScale);
      if (stored.mid != null) setMid(stored.mid);
      if (stored.proportionMethod) setProportionMethod(stored.proportionMethod);
      setMapping(stored.mapping);
      setComparatorValue(stored.comparatorValue ?? '');
      setVariabilityActions((stored.unitActions ?? {}) as Record<string, VariabilityAction>);
      setCentralActions((stored.centralTendencyActions ?? {}) as Record<string, CentralTendencyAction>);
      setHarmonizeChoices(stored.harmonizeChoices ?? {});
      setHarmonizeConfirmed(stored.harmonizeConfirmed ?? {});
      setDirectionChoices(stored.directionChoices ?? {});
      setDirectionConfirmed(stored.directionConfirmed ?? {});
    } else {
      setMapping({});
      setComparatorValue('');
      setVariabilityActions({});
      setCentralActions({});
      setHarmonizeChoices({});
      setHarmonizeConfirmed({});
      setDirectionChoices({});
      setDirectionConfirmed({});
    }
    setStep(1);
    setFurthest(1);
  }, [activeFormId]);

  useEffect(() => {
    if (!suggestion || !activeFormId) return;
    const mappable = ['dichotomous', 'continuous', 'effect', 'proportion', 'correlation'];
    if (!mappable.includes(suggestion.verdict)) return;
    // A saved mapping is the reviewer's own work and outranks a fresh suggestion,
    // unless they explicitly asked for a new one.
    if (loadMapping(activeFormId) && suggestNonce === 0) return;

    const next: Mapping = {};
    for (const [role, col] of Object.entries(suggestion.slots)) {
      next[role as SlotKey] = {
        col,
        status: 'suggested',
        why: suggestion.per_slot_reasoning[role],
      };
    }
    setKind(suggestion.verdict as OutcomeKind);
    setLayout(suggestion.verdict === 'dichotomous' || suggestion.verdict === 'continuous'
      ? suggestion.layout ?? 'wide'
      : 'wide');
    setMapping(next);
    if (suggestion.comparator_value) setComparatorValue(suggestion.comparator_value);
    setMeasure(effectOptions(suggestion.verdict as OutcomeKind)[0]);
  }, [suggestion, activeFormId, suggestNonce]);

  useEffect(() => {
    if (!activeFormId || Object.keys(mapping).length === 0) return;
    saveMapping(activeFormId, {
      kind, layout, mapping, comparatorValue, effectScale, mid, proportionMethod,
      unitActions: variabilityActions,
      centralTendencyActions: centralActions,
      harmonizeChoices, harmonizeConfirmed, directionChoices, directionConfirmed,
    });
  }, [activeFormId, kind, layout, mapping, comparatorValue, effectScale, mid, proportionMethod,
    variabilityActions, centralActions, harmonizeChoices, harmonizeConfirmed, directionChoices,
    directionConfirmed]);

  // ── Derived columns ────────────────────────────────────────────────────────

  const comparisonColumn = useMemo(
    () => detectComparisonColumn(selectableColumns),
    [selectableColumns],
  );
  const armLabelColumns = useMemo(
    () => detectArmLabelColumns(selectableColumns),
    [selectableColumns],
  );
  const variabilityMeasureColumn =
    suggestion?.variability_measure_column ?? detectVariabilityMeasureColumn(selectableColumns);
  const centralMeasureColumn = detectCentralTendencyMeasureColumn(selectableColumns);

  const armOptions = useMemo(() => {
    const col = mapping.arm?.col;
    if (!col) return [];
    const set = new Set<string>();
    for (const r of long.rows) {
      const v = String(r[col] ?? '').trim();
      if (v) set.add(v);
    }
    return [...set].sort();
  }, [mapping.arm?.col, long.rows]);

  // ── Value reconciliation ───────────────────────────────────────────────────

  /** The column whose distinct values the Harmonize card reconciles. */
  const timepointColumn = mapping.timepoint?.col ?? null;

  const timepointValues = useMemo(
    () => tallyValues(long.rows, timepointColumn),
    [long.rows, timepointColumn],
  );

  /** The column naming the measurement scale, for effect direction. */
  const scaleColumn = useMemo(() => {
    const named = selectableColumns.find(c => /scale.*name|^scale$|instrument/i.test(c));
    return named ?? mapping.outcome?.col ?? null;
  }, [selectableColumns, mapping.outcome?.col]);

  const scaleTallies = useMemo(
    () => (kind === 'continuous' ? tallyScales(tallyValues(long.rows, scaleColumn)) : []),
    [kind, long.rows, scaleColumn],
  );

  // Suggestions are recomputed from the data, then merged UNDER any choice the
  // reviewer has already made, so re-deriving them can never overwrite a
  // deliberate override.
  const harmonizeSuggestion = useMemo(
    () => suggestHarmonization(timepointValues),
    [timepointValues],
  );
  const directionSuggestion = useMemo(
    () => suggestDirections(scaleTallies),
    [scaleTallies],
  );

  const effectiveHarmonize = useMemo(
    () => ({ ...harmonizeSuggestion.choices, ...harmonizeChoices }),
    [harmonizeSuggestion.choices, harmonizeChoices],
  );
  const effectiveDirections = useMemo(
    () => ({ ...directionSuggestion.choices, ...directionChoices }),
    [directionSuggestion.choices, directionChoices],
  );

  const pendingMerges = useMemo(
    () => Object.entries(effectiveHarmonize)
      .filter(([raw, c]) => c !== KEEP && !harmonizeConfirmed[raw]).length,
    [effectiveHarmonize, harmonizeConfirmed],
  );

  // ── Pairing, facets, studies ───────────────────────────────────────────────

  const ready = allConfirmed(mapping, kind, layout) && (layout === 'wide' || !!comparatorValue);

  const { pairings, structuralExclusions, multiArm } = useMemo(() => {
    if (!ready) return { pairings: [], structuralExclusions: [], multiArm: [] };
    const r = buildPairings(
      long.rows, mapping, layout, comparatorValue, comparisonColumn, armLabelColumns,
      { choices: effectiveHarmonize, confirmed: harmonizeConfirmed },
    );
    return { pairings: r.pairings, structuralExclusions: r.excluded, multiArm: r.multiArm };
  }, [ready, long.rows, mapping, layout, comparatorValue, comparisonColumn, armLabelColumns,
    effectiveHarmonize, harmonizeConfirmed]);

  const facets = useMemo(() => facetsOf(pairings), [pairings]);

  useEffect(() => {
    if (facets.outcomes.length && !facets.outcomes.some(o => o.value === outcome)) {
      setOutcome(facets.outcomes[0].value);
    }
    if (facets.comparisons.length && !facets.comparisons.some(c => c.value === comparison)) {
      setComparison(facets.comparisons[0].value);
    }
  }, [facets, outcome, comparison]);

  const effectiveTimepoint = facets.timepointFollowsOutcome
    ? facets.timepointByOutcome[outcome] ?? ''
    : timepoint;

  const selected = useMemo(
    () => pairings.filter(p =>
      (!outcome || p.outcome === outcome) &&
      (!comparison || comparison === ALL_COMPARISONS || p.comparison === comparison) &&
      (!effectiveTimepoint || p.timepoint === effectiveTimepoint)
    ),
    [pairings, outcome, comparison, effectiveTimepoint],
  );

  const built = useMemo(
    () => buildStudies(selected, {
      kind, layout, mapping,
      measure,
      effectScale,
      variabilityMeasureColumn,
      centralTendencyMeasureColumn: centralMeasureColumn,
      variabilityActions,
      centralTendencyActions: centralActions,
      scaleColumn,
      directions: effectiveDirections,
      directionsConfirmed: directionConfirmed,
    }),
    [selected, kind, layout, mapping, measure, effectScale, variabilityMeasureColumn,
      centralMeasureColumn, variabilityActions, centralActions, scaleColumn, effectiveDirections,
      directionConfirmed],
  );

  /** Typed as a percent, used as a proportion. Blank leaves the corpus's own rate. */
  const assumedRiskValue = useMemo(() => {
    const n = Number(assumedRisk.replace('%', '').trim());
    return assumedRisk.trim() !== '' && Number.isFinite(n) && n > 0 && n < 100 ? n / 100 : null;
  }, [assumedRisk]);

  /**
   * Where a study design is recorded.
   *
   * Almost never the form being synthesised: in this corpus the outcome tables and
   * the study-characteristics tables are separate forms, so a guard that only read
   * the mapped table would never fire on real data. This looks across the
   * project's forms for a design-ish field, preferring one with declared options
   * (a select carries a controlled vocabulary; free text does not) and preferring
   * the current form if it happens to have one.
   */
  const designSource = useMemo(() => {
    const named = /(^|_)(design|study_type|study_design|trial_design|study_kind)(_|$)/i;
    const candidates: Array<{ formId: string; formName: string; field: string; score: number }> = [];
    for (const f of forms as Form[]) {
      for (const field of (f.fields ?? [])) {
        if (!field || typeof field !== 'object') continue;
        const name = (field as any).field_name as string | undefined;
        if (!name || !named.test(name)) continue;
        const hasOptions = Array.isArray((field as any).options) && (field as any).options.length > 0;
        candidates.push({
          formId: f.id,
          formName: f.form_name,
          field: name,
          score: (f.id === activeFormId ? 4 : 0) + (hasOptions ? 2 : 0) + 1,
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] ?? null;
  }, [forms, activeFormId]);

  const { data: designResults = [] } = useQuery({
    queryKey: ['synthesis-design', projectId, designSource?.formId],
    queryFn: () => resultsService.getAllForForm(projectId, designSource!.formId),
    enabled: !!projectId && !!designSource && designSource.formId !== activeFormId,
    retry: false,
  });

  /**
   * Document id -> design string, taking the highest-trust extraction per document
   * exactly as the plotted values do (adjudicated over manual over AI), so the
   * design a guard reasons about is the one a reviewer would have signed off.
   */
  const designByDocument = useMemo(() => {
    if (!designSource) return {};
    const rows = designSource.formId === activeFormId ? results : designResults;
    const best = new Map<string, { rank: number; value: string }>();
    for (const r of rows as ExtractionResult[]) {
      const rank = SOURCE_RANK[r.extraction_type] ?? 0;
      const data = (r.extracted_data ?? {}) as Record<string, any>;
      const cell = data[designSource.field];
      const raw = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
      const value = raw == null ? '' : String(raw).trim();
      if (!value) continue;
      const current = best.get(r.document_id);
      if (!current || rank > current.rank) best.set(r.document_id, { rank, value });
    }
    return Object.fromEntries([...best.entries()].map(([doc, v]) => [doc, v.value]));
  }, [designSource, activeFormId, results, designResults]);

  const meta = useMemo(
    () => runMetaAnalysis(built.studies, measure, model, {
      comparatorRisk: assumedRiskValue,
      proportionMethod,
    }),
    [built.studies, measure, model, assumedRiskValue, proportionMethod],
  );

  /**
   * The MID on the analysis scale, or null. Entered on the natural scale because
   * that is how a clinical threshold is discussed ("an RR of 1.25"), and logged
   * here for the ratio measures — the one place that conversion happens.
   */
  const midValue = useMemo(() => {
    const raw = Number(mid.trim());
    if (mid.trim() === '' || !Number.isFinite(raw)) return null;
    if (isRatioMeasure(measure)) return raw > 0 ? raw : null;
    return raw !== 0 ? Math.abs(raw) : null;
  }, [mid, measure]);

  /**
   * A pooling method the reviewer selected but which cannot run keeps the old
   * selection out of the way rather than leaving a dropdown pointing at nothing:
   * the refusal is shown, and the plot shows no pooled estimate.
   */
  const designChecks = useMemo(
    () => designGuards(meta.studies, designByDocument, measure),
    [meta.studies, designByDocument, measure],
  );

  const modelOptions = useMemo(
    () => poolingMethodsFor(measure, built.studies.every(st => !st.precomputed)),
    [measure, built.studies],
  );

  useEffect(() => {
    if (!modelOptions.includes(model)) setModel('random');
  }, [modelOptions, model]);

  // Studies the statistics could not use are exclusions too — merge them in so
  // the ledger total always reconciles with what the plot shows.
  const allExclusions = useMemo(() => [
    ...built.excluded,
    ...meta.notEstimable.map(n => ({
      key: n.study.key,
      documentId: n.study.documentId,
      label: n.study.label,
      reason: reasonFromNotEstimable(n.reason),
    })),
  ], [built.excluded, meta.notEstimable]);

  // ── Units card tallies ─────────────────────────────────────────────────────

  const variabilityTallies: MeasureTally[] = useMemo(() => {
    if (kind !== 'continuous' || layout !== 'long' || !variabilityMeasureColumn) return [];
    const map = new Map<string, Set<string>>();
    for (const p of selected) {
      for (const row of [p.treatmentRow, p.comparatorRow]) {
        const v = String(row[variabilityMeasureColumn] ?? '').trim();
        if (!v) continue;
        if (!map.has(v)) map.set(v, new Set());
        map.get(v)!.add(row._documentId);
      }
    }
    return [...map.entries()]
      .map(([measureText, d]) => ({ measure: measureText, documents: d.size }))
      .sort((a, b) => b.documents - a.documents);
  }, [kind, layout, variabilityMeasureColumn, selected]);

  const centralTallies: MeasureTally[] = useMemo(() => {
    if (kind !== 'continuous' || layout !== 'long' || !centralMeasureColumn) return [];
    const map = new Map<string, Set<string>>();
    for (const p of selected) {
      for (const row of [p.treatmentRow, p.comparatorRow]) {
        const v = String(row[centralMeasureColumn] ?? '').trim();
        if (!v) continue;
        if (!map.has(v)) map.set(v, new Set());
        map.get(v)!.add(row._documentId);
      }
    }
    return [...map.entries()]
      .map(([measureText, d]) => ({ measure: measureText, documents: d.size }))
      .filter(m => isMedian(m.measure) || /mean/i.test(m.measure))
      .sort((a, b) => b.documents - a.documents);
  }, [kind, layout, centralMeasureColumn, selected]);

  const unitExcluded = built.excluded.filter(
    e => e.reason === 'variability_excluded' || e.reason === 'median_excluded'
      || e.reason === 'variability_unusable',
  );

  /** Columns that can group a subgroup analysis — declared vocabularies only. */
  const subgroupColumns = useMemo(() => {
    const selects = (suggestion?.columns ?? [])
      .filter(c => c.type === 'select' && (c.options?.length ?? 0) > 0)
      .map(c => c.name)
      .filter(c => long.columns.includes(c));
    // The mapped roles are already the analysis axes; grouping by them again
    // would just reproduce the current selection.
    const used = new Set(Object.values(mapping).map(v => v?.col));
    return selects.filter(c => !used.has(c));
  }, [suggestion, long.columns, mapping]);

  useEffect(() => {
    if (subgroupColumns.length === 0) { setSubgroupColumn(''); return; }
    if (!subgroupColumns.includes(subgroupColumn)) setSubgroupColumn(subgroupColumns[0]);
  }, [subgroupColumns, subgroupColumn]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const setSlot = useCallback((key: SlotKey, col: string) => {
    setMapping(m => {
      const next = { ...m };
      // Choosing a column by hand IS the confirmation — the reviewer just made
      // the decision the tick is asking for.
      if (col) next[key] = { col, status: 'confirmed' };
      else delete next[key];
      return next;
    });
  }, []);

  const confirmSlot = useCallback((key: SlotKey) => {
    setMapping(m => (m[key] ? { ...m, [key]: { ...m[key]!, status: 'confirmed' } } : m));
  }, []);

  const confirmAll = useCallback(() => {
    setMapping(m => Object.fromEntries(
      Object.entries(m).map(([k, v]) => [k, { ...v!, status: 'confirmed' as const }]),
    ) as Mapping);
  }, []);

  const go = useCallback((s: Step) => {
    setStep(s);
    setFurthest(f => (s > f ? s : f));
  }, []);

  const exportCsv = useCallback(() => {
    const binary = kind === 'dichotomous';
    const precomputed = kind === 'effect';
    const header = precomputed
      ? ['Study', 'Reported estimate', 'Reported CI / SE', `${measure} (analysis scale)`, 'SE (analysis scale)',
         measure, 'CI lower', 'CI upper', 'Weight %']
      : binary
      ? ['Study', 'Events (treatment)', 'Total (treatment)', 'Events (comparator)', 'Total (comparator)',
         measure, 'CI lower', 'CI upper', 'Weight %']
      : ['Study', 'Mean (treatment)', 'SD (treatment)', 'N (treatment)',
         'Mean (comparator)', 'SD (comparator)', 'N (comparator)',
         measure, 'CI lower', 'CI upper', 'Weight %'];

    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [header.map(esc).join(',')];
    for (const s of meta.studies) {
      const t = s.treatment as any;
      const c = s.comparator as any;
      const pc = s.precomputed;
      const cells = precomputed && pc
        ? [s.label, pc.reported.est,
           pc.reported.lo != null && pc.reported.hi != null
             ? `${pc.reported.lo} to ${pc.reported.hi}`
             : pc.reported.se != null ? `SE ${pc.reported.se}` : '',
           +pc.y.toFixed(6), +pc.se.toFixed(6)]
        : binary
        ? [s.label, t.events, t.total, c.events, c.total]
        : [s.label, t.mean, t.sd, t.n, c.mean, c.sd, c.n];
      lines.push([...cells, s.est.toFixed(4), s.lo.toFixed(4), s.hi.toFixed(4),
        s.weightPct.toFixed(2)].map(esc).join(','));
    }
    if (meta.pooled) {
      const blanks = precomputed ? 4 : binary ? 4 : 6;
      lines.push(['Total', ...Array(blanks).fill(''),
        meta.pooled.est.toFixed(4), meta.pooled.lo.toFixed(4), meta.pooled.hi.toFixed(4), '100.00',
      ].map(esc).join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(form?.form_name ?? 'synthesis').replace(/\W+/g, '_')}_${measure}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [kind, measure, meta, form]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const loading = formsLoading || resultsLoading;
  // The model classifies for arm data, so a table holding only a published effect
  // comes back not_poolable. `kind === 'effect'` is the reviewer having said
  // otherwise on the explainer's own escape hatch, and it outranks the verdict —
  // the classifier is advice, not a gate.
  const poolable = suggestion?.verdict === 'dichotomous'
    || suggestion?.verdict === 'continuous'
    || suggestion?.verdict === 'effect'
    || suggestion?.verdict === 'proportion'
    || suggestion?.verdict === 'correlation'
    || kind === 'effect' || kind === 'proportion' || kind === 'correlation';

  // A pre-computed effect has no arms, so those two columns carry what the source
  // reported and how precise it said that was (see studyDataCells).
  const treatmentHeading = kind === 'effect' ? 'As reported'
    : kind === 'proportion' ? 'Events / n'
    : kind === 'correlation' ? 'r'
    : kind === 'dichotomous' ? 'Treatment n/N' : 'Treatment N';
  const comparatorHeading = kind === 'effect' ? 'Precision'
    : kind === 'proportion' ? 'Observed'
    : kind === 'correlation' ? 'Sample'
    : kind === 'dichotomous' ? 'Comparator n/N' : 'Comparator N';

  let body: React.ReactNode;

  if (!selectedProject) {
    body = (
      <EmptyState
        icon={FolderOpen}
        title="No project selected"
        description="Choose a project to pool its agreed values into a meta-analysis."
      />
    );
  } else if (loading) {
    body = <div className="flex items-center justify-center py-24"><Spinner className="h-6 w-6" /></div>;
  } else if (forms.length === 0) {
    body = (
      <EmptyState
        icon={FileCheck}
        title="No active forms"
        description="Synthesis pools values that have already been extracted. Build and activate a form first."
      />
    );
  } else if (suggestion && !poolable && step === 1) {
    body = (
      <>
        <div className="mb-4 max-w-[640px]">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 block mb-2">
            Source form
          </label>
          <select
            value={activeFormId}
            onChange={e => setFormId(e.target.value)}
            className="w-full h-9 border border-gray-200 rounded-lg bg-white text-[13px] px-2 text-gray-900 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white focus:outline-none"
          >
            {forms.map((f: Form) => (
              <option key={f.id} value={f.id}>{f.form_name}</option>
            ))}
          </select>
        </div>
        <NotPoolableExplainer
          suggestion={suggestion}
          formName={form?.form_name ?? 'This form'}
          onUseReportedEffect={() => {
            setKind('effect');
            setLayout('wide');
            setMeasure('OR');
            setStep(1);
          }}
        />
      </>
    );
  } else {
    body = (
      <>
        <StepNav step={step} furthest={furthest} onGo={go} />

        {provenance.withData > 0 && (
          <CorpusBar
            consensus={provenance.consensus}
            manual={provenance.manual}
            aiOnly={provenance.aiOnly}
            missing={provenance.missing}
            total={provenance.total}
            href={`/consensus?form=${encodeURIComponent(activeFormId)}`}
          />
        )}

        {step === 1 && (
          <div className="flex items-center gap-2.5 border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#0d0d0d] rounded-lg px-3.5 py-2.5 mb-4">
            <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800 whitespace-nowrap dark:bg-amber-500/15 dark:text-amber-300">
              Suggested
            </span>
            <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 leading-relaxed">
              Everything the AI can infer arrives as a suggestion — amber until you confirm (✓) or
              change it. Nothing enters the analysis on an unconfirmed guess.
            </span>
          </div>
        )}

        {step === 1 && (
          <MappingStep
            forms={forms}
            formId={activeFormId}
            onFormChange={setFormId}
            sourceField={sourceField}
            scalarCoverage={scalarCoverage}
            columnCoverage={tableCoverage}
            columnNames={selectableColumns}
            kind={kind}
            layout={layout}
            onKind={k => {
              setKind(k);
              setMeasure(effectOptions(k)[0]);
              // An effect, a prevalence and a correlation are each already one row
              // per study — there is no second row to pair against, so the long
              // layout cannot apply to any of them.
              if (k !== 'dichotomous' && k !== 'continuous') setLayout('wide');
            }}
            onLayout={setLayout}
            effectScale={effectScale}
            onEffectScale={setEffectScale}
            mapping={mapping}
            onSelect={setSlot}
            onConfirm={confirmSlot}
            onConfirmAll={confirmAll}
            onSuggest={() => setSuggestNonce(n => n + 1)}
            suggesting={suggesting}
            suggestionSource={suggestion?.source ?? null}
            suggestionWarnings={suggestion?.warnings ?? []}
            armOptions={armOptions}
            comparatorValue={comparatorValue}
            onComparatorValue={setComparatorValue}
            armColumn={mapping.arm?.col ?? null}
          >
            {timepointColumn && (
              <HarmonizeCard
                column={timepointColumn}
                values={timepointValues}
                choices={effectiveHarmonize}
                reasons={harmonizeSuggestion.reasons}
                confirmed={harmonizeConfirmed}
                onChoice={(raw, choice) => {
                  // Choosing by hand IS the confirmation — an override is the
                  // strongest form of review.
                  setHarmonizeChoices(c => ({ ...c, [raw]: choice }));
                  setHarmonizeConfirmed(c => ({ ...c, [raw]: choice !== KEEP }));
                }}
                onConfirm={raw => setHarmonizeConfirmed(c => ({ ...c, [raw]: true }))}
                mergedCount={pendingMerges}
              />
            )}

            {kind === 'continuous' && scaleTallies.length > 1 && (
              <DirectionCard
                scales={scaleTallies}
                choices={effectiveDirections}
                reasons={directionSuggestion.reasons}
                confirmed={directionConfirmed}
                onChoice={(scale, choice) => {
                  setDirectionChoices(c => ({ ...c, [scale]: choice }));
                  setDirectionConfirmed(c => ({ ...c, [scale]: choice === 'reverse' }));
                }}
                onConfirm={scale => setDirectionConfirmed(c => ({ ...c, [scale]: true }))}
              />
            )}

            {kind === 'continuous' && layout === 'long' && variabilityTallies.length > 0 && (
              <UnitsCard
                measures={variabilityTallies}
                actions={variabilityActions}
                onAction={(m, a) => setVariabilityActions(prev => ({ ...prev, [m]: a }))}
                centralTendencies={centralTallies}
                centralActions={centralActions}
                onCentralAction={(m, a) => setCentralActions(prev => ({ ...prev, [m]: a }))}
                variabilityColumn={mapping.variability?.col ?? null}
                excludedCount={unitExcluded.length}
                excludedStudies={[...new Set(unitExcluded.map(e => e.label))]}
              />
            )}

            <div className="flex justify-end items-center gap-3">
              {!ready && (
                <span className="text-[12.5px] text-gray-400 dark:text-zinc-600">
                  {layout === 'long' && !comparatorValue && allConfirmed(mapping, kind, layout)
                    ? 'Choose which arm is the comparator to continue'
                    : 'Confirm every slot to continue'}
                </span>
              )}
              <button
                type="button"
                onClick={() => ready && go(2)}
                disabled={!ready}
                className="cursor-pointer text-[13px] font-semibold bg-[#0a0a0a] text-white rounded-md px-5 py-2.5 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-white dark:text-black dark:hover:bg-zinc-100"
              >
                Continue to comparison →
              </button>
            </div>
          </MappingStep>
        )}

        {step === 2 && (
          <ComparisonStep
            facets={facets}
            outcome={outcome} onOutcome={setOutcome}
            comparison={comparison} onComparison={setComparison}
            timepoint={effectiveTimepoint} onTimepoint={setTimepoint}
            timepointLocked={facets.timepointFollowsOutcome}
            timepointSourceColumn={mapping.timepoint?.col ?? null}
            outcomeColumn={mapping.outcome?.col ?? null}
            comparisonSourceColumn={
              layout === 'wide'
                ? comparisonColumn ?? armLabelColumns.treatment
                : mapping.arm?.col ?? null
            }
            measure={measure} onMeasure={setMeasure} measureOptions={effectOptions(kind)}
            model={model} onModel={setModel} modelOptions={modelOptions}
            mid={mid} onMid={setMid}
            proportionMethod={proportionMethod} onProportionMethod={setProportionMethod}
            sparseDataWarning={meta.sparseDataWarning}
            poolingMethodRefusal={meta.poolingMethodRefusal}
            ledger={{
              matched: selected.length,
              included: meta.studies.length,
              corrected: meta.correctedCount,
              // Filter by GROUP, not document: a paper reporting several outcomes has
              // a separate shared-control situation per outcome, and only the one in
              // the current selection belongs in this ledger.
              multiArm: multiArm.filter(m => selected.some(p => p.groupKey === m.groupKey)),
              excluded: allExclusions,
            }}
            onNext={() => go(3)}
          />
        )}

        {step === 3 && (
          meta.studies.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="Nothing to plot for this comparison"
              description="Every matching study was excluded. Step back to the ledger to see why."
            />
          ) : (
            <>
              <ForestPlot
                result={meta}
                outcomeLabel={outcome || 'All outcomes'}
                comparisonLabel={comparison || ALL_COMPARISONS}
                treatmentHeading={treatmentHeading}
                comparatorHeading={comparatorHeading}
                onOpenStudy={setDrawer}
                onExport={exportCsv}
                onDiagnostics={() => go(4)}
                fileBase={`${form?.form_name ?? 'synthesis'}-${measure}`}
                mid={midValue}
              />
              {/*
                The reading comes first: it is the one thing here a reviewer will
                quote. The absolute effect and the design check fold to a single
                line each, so four stacked essays became a plot plus three
                conclusions.
              */}
              <MethodsPanel
                result={meta}
                outcomeLabel={outcome || 'All outcomes'}
                comparisonLabel={comparison || ALL_COMPARISONS}
              />
              {/*
                A single-group measure has no comparator risk to translate
                against, so the card would have nothing to say — and a card whose
                only content is "not applicable" is noise, not information.
              */}
              {meta.pooled && !isSingleGroupMeasure(meta.measure) && (
                <AbsoluteEffectCard
                  result={meta}
                  assumedRisk={assumedRisk}
                  onAssumedRisk={setAssumedRisk}
                />
              )}
              <DesignGuardCard
                checks={designChecks}
                sourceLabel={designSource
                  ? `${designSource.field} on ${designSource.formName}`
                  : null}
              />
            </>
          )
        )}

        {step === 4 && (
          meta.studies.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="Nothing to diagnose"
              description="Diagnostics interrogate a pooled result, and this comparison has no studies in it."
            />
          ) : (
            <DiagnosticsStep
              studies={built.studies}
              result={meta}
              measure={measure}
              model={model}
              subgroupColumns={subgroupColumns}
              subgroupColumn={subgroupColumn}
              onSubgroupColumn={setSubgroupColumn}
            />
          )
        )}

        {structuralExclusions.length > 0 && step === 1 && (
          <div className="text-xs text-gray-500 dark:text-zinc-500 mt-3">
            {structuralExclusions.length}{' '}
            {structuralExclusions.length === 1 ? 'study has' : 'studies have'} no row matching the
            chosen comparator arm — they appear in the ledger on the next step.
          </div>
        )}
      </>
    );
  }

  return (
    <DashboardLayout title="Synthesis" description="Pool agreed values into a meta-analysis">
      {body}
      <EvidenceDrawer
        study={drawer}
        formId={activeFormId}
        treatmentLabel={treatmentHeading.replace(/\s*n?\/?N$/i, '') || 'Treatment'}
        comparatorLabel={comparatorHeading.replace(/\s*n?\/?N$/i, '') || 'Comparator'}
        onClose={() => setDrawer(null)}
      />
    </DashboardLayout>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Info, Plus, ShieldCheck } from 'lucide-react';

import { DashboardLayout } from '@/components/layout';
import { EmptyState, Spinner } from '@/components/ui';
import { useProject } from '@/contexts/ProjectContext';
import { useToast } from '@/hooks/use-toast';
import { assignmentsService, documentsService, formsService, resultsService } from '@/services';
import { getErrorMessage } from '@/lib/utils';
import type { Document, ExtractionResult, Form } from '@/types/api';

import { StudyGrid, type GridRow } from './_components/StudyGrid';
import { DomainPanel } from './_components/DomainPanel';
import {
  assessmentStatus, overallSeverity, rowsOf, STATUS_LABEL,
} from './_lib/robForm';
import {
  assessmentRecord, bindForm, outcomeValueOf, readDomain, severityOfCanonical, writeAssessment,
  type BoundForm, type DomainWrite,
} from './_lib/robAdapter';
import {
  presetFormDescription, presetFormFields, presetFormName, TOOLS, type RobTool,
} from './_lib/robTools';

/** Which extraction a document's judgments should be read from, best first. */
const SOURCE_RANK: Record<string, number> = { consensus: 3, manual: 2, ai: 1 };

export default function RiskOfBiasPage() {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? '';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formId, setFormId] = useState('');
  const [outcome, setOutcome] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [writes, setWrites] = useState<Record<string, DomainWrite>>({});
  const [rawValues, setRawValues] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState<RobTool | null>(null);

  // ── Data ───────────────────────────────────────────────────────────────────

  const { data: forms = [], isLoading: formsLoading } = useQuery({
    queryKey: ['rob-forms', projectId],
    queryFn: async () => {
      const all = await formsService.getAll(projectId);
      return all.filter((f: Form) => f.status === 'active' || f.status === 'draft');
    },
    enabled: !!projectId,
  });

  /** Forms that carry risk-of-bias judgments, whatever shape they are in. */
  const robForms = useMemo(() => {
    const out: BoundForm[] = [];
    for (const form of forms as Form[]) {
      const bound = bindForm(form);
      if (bound) out.push(bound);
    }
    return out;
  }, [forms]);

  const bound = robForms.find(r => r.form.id === formId) ?? robForms[0] ?? null;
  const activeFormId = bound?.form.id ?? '';
  const tool = bound?.tool ?? null;

  const { data: results = [], isLoading: resultsLoading } = useQuery({
    queryKey: ['rob-results', projectId, activeFormId],
    queryFn: () => resultsService.getAllForForm(projectId, activeFormId),
    enabled: !!projectId && !!activeFormId,
  });

  const { data: docs = [] } = useQuery({
    queryKey: ['rob-docs', projectId],
    queryFn: () => documentsService.getAll(projectId),
    enabled: !!projectId,
  });

  const { data: summary } = useQuery({
    queryKey: ['rob-summary', projectId, activeFormId],
    queryFn: () => resultsService.getConsensusSummary(projectId, activeFormId),
    enabled: !!projectId && !!activeFormId,
    retry: false,
  });

  const { data: myAssignments = [] } = useQuery({
    queryKey: ['rob-assignments', projectId],
    queryFn: () => assignmentsService.getMyAssignments({ projectId }),
    enabled: !!projectId,
  });

  /** document → the role I hold on it. Without one, judgments are read-only. */
  const myRole = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of myAssignments as any[]) {
      if (a.status !== 'skipped' && a.reviewer_role) m.set(a.document_id, a.reviewer_role);
    }
    return m;
  }, [myAssignments]);

  // ── Per-document records ───────────────────────────────────────────────────

  /** My own saved result, which is what a save must build on. */
  const myResultByDoc = useMemo(() => {
    const m = new Map<string, ExtractionResult>();
    for (const r of results as ExtractionResult[]) {
      if (r.extraction_type !== 'manual') continue;
      const role = myRole.get(r.document_id);
      if (!role || (r.reviewer_role ?? null) !== role) continue;
      const current = m.get(r.document_id);
      if (!current || r.created_at > current.created_at) m.set(r.document_id, r);
    }
    return m;
  }, [results, myRole]);

  const displayByDoc = useMemo(() => {
    const best = new Map<string, ExtractionResult>();
    for (const r of results as ExtractionResult[]) {
      const rank = SOURCE_RANK[r.extraction_type] ?? 0;
      const current = best.get(r.document_id);
      const currentRank = current ? SOURCE_RANK[current.extraction_type] ?? 0 : -1;
      if (rank > currentRank || (rank === currentRank && current && r.created_at > current.created_at)) {
        best.set(r.document_id, r);
      }
    }
    // My own work always outranks anyone else's for what I am shown.
    for (const [docId, mine] of myResultByDoc) best.set(docId, mine);
    return best;
  }, [results, myResultByDoc]);

  const docMap = useMemo(() => {
    const m: Record<string, Document> = {};
    for (const d of docs as Document[]) m[d.id] = d;
    return m;
  }, [docs]);

  const statusByDoc = useMemo(() => {
    const m = new Map<string, ReturnType<typeof assessmentStatus>>();
    for (const d of summary?.documents ?? []) {
      m.set(d.document_id, assessmentStatus({
        hasAi: d.has_ai, hasR1: d.has_r1, hasR2: d.has_r2,
        hasAdjudication: d.has_adjudication, agreementPct: d.r1_r2_agreement_pct,
      }));
    }
    return m;
  }, [summary]);

  // ── Outcomes ───────────────────────────────────────────────────────────────

  /**
   * Risk of bias is judged per outcome, so the page works one at a time. A flat
   * form has no outcome dimension at all — it stores a single assessment per
   * document — and the selector is hidden rather than faked.
   */
  const outcomes = useMemo(() => {
    if (!bound || bound.outcomeColumns.length === 0) return [];
    const found = new Set<string>();
    for (const result of displayByDoc.values()) {
      for (const row of rowsOf(result.extracted_data, bound.tableField!)) {
        const v = outcomeValueOf(row, bound.outcomeColumns);
        if (v) found.add(v);
      }
    }
    const table = (bound.form.fields ?? []).find(f => f.field_name === bound.tableField);
    for (const col of bound.outcomeColumns) {
      const sub = (table?.subform_fields ?? []).find(s => s.field_name === col);
      for (const opt of sub?.options ?? []) {
        if (opt && opt.toUpperCase() !== 'NA') found.add(opt);
      }
    }
    return [...found].sort();
  }, [bound, displayByDoc]);

  const outcomeColumnFor = useCallback((value: string): string => {
    if (!bound || bound.outcomeColumns.length === 0) return '';
    const table = (bound.form.fields ?? []).find(f => f.field_name === bound.tableField);
    for (const col of bound.outcomeColumns) {
      const sub = (table?.subform_fields ?? []).find(s => s.field_name === col);
      if ((sub?.options ?? []).includes(value)) return col;
    }
    return bound.outcomeColumns[0] ?? '';
  }, [bound]);

  useEffect(() => {
    if (outcomes.length && !outcomes.includes(outcome)) setOutcome(outcomes[0]);
    if (outcomes.length === 0 && outcome) setOutcome('');
  }, [outcomes, outcome]);

  // ── The grid ───────────────────────────────────────────────────────────────

  const gridRows: GridRow[] = useMemo(() => {
    if (!bound || !tool) return [];
    const ids = new Set<string>([...displayByDoc.keys()]);
    for (const d of summary?.documents ?? []) ids.add(d.document_id);

    return [...ids].map(documentId => {
      const result = displayByDoc.get(documentId);
      const record = assessmentRecord(result?.extracted_data, bound, outcome);
      const severities = bound.domains
        .filter(d => !d.extra)
        .map(d => severityOfCanonical(readDomain(record, d, tool).canonical, tool));
      const status = statusByDoc.get(documentId) ?? (result ? 'draft' : 'none');
      return {
        documentId,
        label: (docMap[documentId]?.filename ?? documentId).replace(/\.pdf$/i, ''),
        severities,
        overall: overallSeverity(severities),
        status,
        isDraft: status === 'draft',
      };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [bound, tool, displayByDoc, summary, statusByDoc, docMap, outcome]);

  const progressText = useMemo(() => {
    const counts = { agreed: 0, awaiting: 0, conflict: 0, draft: 0, none: 0 };
    for (const r of gridRows) counts[r.status] += 1;
    return [
      `${counts.agreed} of ${gridRows.length} agreed`,
      counts.draft ? `${counts.draft} AI draft` : '',
      counts.awaiting ? `${counts.awaiting} awaiting R2` : '',
      counts.conflict ? `${counts.conflict} conflict` : '',
      counts.none ? `${counts.none} unassessed` : '',
    ].filter(Boolean).join(' · ');
  }, [gridRows]);

  useEffect(() => {
    if (gridRows.length && (!selectedDoc || !gridRows.some(r => r.documentId === selectedDoc))) {
      setSelectedDoc(gridRows[0].documentId);
    }
  }, [gridRows, selectedDoc]);

  // ── Load the selected assessment ───────────────────────────────────────────

  useEffect(() => {
    if (!bound || !tool || !selectedDoc) return;
    const result = displayByDoc.get(selectedDoc);
    const record = assessmentRecord(result?.extracted_data, bound, outcome);

    const nextWrites: Record<string, DomainWrite> = {};
    const nextRaw: Record<string, string> = {};
    for (const d of bound.domains) {
      if (!d.column) continue;
      const reading = readDomain(record, d, tool);
      nextWrites[d.column] = { canonical: reading.canonical ?? '', rationale: reading.rationale };
      nextRaw[d.column] = reading.raw;
    }
    setWrites(nextWrites);
    setRawValues(nextRaw);

    // Anything I saved myself is already my judgment; an AI draft is not.
    const mine = myResultByDoc.has(selectedDoc)
      && displayByDoc.get(selectedDoc) === myResultByDoc.get(selectedDoc);
    const marks: Record<string, boolean> = {};
    for (const d of bound.domains) {
      if (d.column) marks[d.column] = mine && !!nextWrites[d.column].canonical;
    }
    setConfirmed(marks);
    setDirty(false);
  }, [bound, tool, selectedDoc, outcome, displayByDoc, myResultByDoc]);

  // ── Editing ────────────────────────────────────────────────────────────────

  const setJudgment = useCallback((column: string, canonical: string) => {
    // Choosing a judgment by hand IS the confirmation.
    setWrites(w => ({ ...w, [column]: { ...(w[column] ?? { rationale: '' }), canonical } }));
    setConfirmed(c => ({ ...c, [column]: true }));
    setDirty(true);
  }, []);

  const setRationale = useCallback((column: string, rationale: string) => {
    setWrites(w => ({ ...w, [column]: { ...(w[column] ?? { canonical: '' }), rationale } }));
    setDirty(true);
  }, []);

  const confirmDomain = useCallback((column: string) => {
    setConfirmed(c => ({ ...c, [column]: true }));
    setDirty(true);
  }, []);

  const canEdit = !!selectedDoc && myRole.has(selectedDoc);

  const save = useCallback(async () => {
    if (!bound || !selectedDoc || !activeFormId) return;
    setSaving(true);
    try {
      // Build on my OWN previous record so a save can never overwrite another
      // reviewer's work with a copy of theirs.
      const mine = myResultByDoc.get(selectedDoc);
      const merged = writeAssessment(
        mine?.extracted_data, bound, outcome, outcomeColumnFor(outcome), writes,
      );
      await resultsService.saveManualExtraction({
        document_id: selectedDoc,
        form_id: activeFormId,
        extracted_data: merged,
        extraction_type: 'manual',
        reviewer_role: myRole.get(selectedDoc) ?? null,
      });
      toast({ title: 'Saved', description: 'Risk-of-bias assessment recorded', variant: 'success' });
      setDirty(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rob-results', projectId, activeFormId] }),
        queryClient.invalidateQueries({ queryKey: ['rob-summary', projectId, activeFormId] }),
      ]);
    } catch (e) {
      toast({ title: 'Save failed', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setSaving(false);
    }
  }, [bound, selectedDoc, activeFormId, myResultByDoc, outcome, outcomeColumnFor, writes,
    myRole, toast, queryClient, projectId]);

  /**
   * Create a form that stores this instrument exactly.
   *
   * Saved as a draft: this is a data-entry schema for reviewers, so it needs no
   * extraction code generated for it, and generating some would cost a codegen
   * run nobody asked for.
   */
  const createFromPreset = useCallback(async (preset: RobTool) => {
    if (!projectId) return;
    setCreating(preset);
    try {
      const created = await formsService.create({
        project_id: projectId,
        form_name: presetFormName(preset),
        form_description: presetFormDescription(preset),
        fields: presetFormFields(preset) as any,
        save_as_draft: true,
      });
      toast({
        title: 'Form created',
        description: `${presetFormName(preset)} — domains and judgments match the published tool.`,
        variant: 'success',
      });
      await queryClient.invalidateQueries({ queryKey: ['rob-forms', projectId] });
      setFormId(created.id);
    } catch (e) {
      toast({ title: 'Could not create form', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setCreating(null);
    }
  }, [projectId, toast, queryClient]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const loading = formsLoading || resultsLoading;
  const selectedRow = gridRows.find(r => r.documentId === selectedDoc) ?? null;

  const presetButtons = (
    <div className="flex gap-2 flex-wrap">
      {TOOLS.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => createFromPreset(t)}
          disabled={!!creating}
          className="flex items-center gap-1.5 cursor-pointer text-[12.5px] font-semibold border border-gray-200 dark:border-[#2a2a2a] rounded-md px-3 py-1.5 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
        >
          {creating?.id === t.id ? <Spinner className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {t.name.split('—')[0].trim()}
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
        description="Choose a project to assess its studies for risk of bias."
      />
    );
  } else if (loading) {
    body = <div className="flex items-center justify-center py-24"><Spinner className="h-6 w-6" /></div>;
  } else if (!bound || !tool) {
    body = (
      <div className="border border-border rounded-lg bg-white dark:bg-[#111111] dark:border-[#1f1f1f] p-8 max-w-[640px]">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 dark:bg-[#1a1a1a] mb-4">
          <ShieldCheck className="h-5 w-5 text-gray-500 dark:text-zinc-400" />
        </div>
        <div className="text-base font-semibold dark:text-white">
          No risk-of-bias form in this project yet
        </div>
        <p className="text-[13px] text-gray-600 dark:text-zinc-400 mt-2 leading-relaxed">
          Start from a published instrument and the form will match it exactly — same domains, same
          wording, same judgments — so assessments stay comparable across projects and export
          cleanly. Judgments then run through the normal pipeline: AI draft → two reviewers →
          consensus.
        </p>
        <div className="mt-5">{presetButtons}</div>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <div className="border border-border rounded-lg bg-white p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
          <div className="flex items-start gap-6 flex-wrap">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 mb-2">
                Assessment tool
              </div>
              <select
                value={activeFormId}
                onChange={e => setFormId(e.target.value)}
                className="h-9 min-w-[300px] max-w-full border border-gray-200 rounded-lg bg-white text-[13px] px-2 text-gray-900 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white focus:outline-none"
              >
                {robForms.map(r => (
                  <option key={r.form.id} value={r.form.id}>
                    {r.tool.name.split('—')[0].trim()} · {r.form.form_name}
                  </option>
                ))}
              </select>
            </div>

            {bound.outcomeColumns.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 mb-2">
                  Outcome assessed
                </div>
                <select
                  value={outcome}
                  onChange={e => setOutcome(e.target.value)}
                  className="h-9 min-w-[260px] max-w-full border border-gray-200 rounded-lg bg-white text-[13px] px-2 text-gray-900 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white focus:outline-none"
                >
                  {outcomes.length === 0 && <option value="">No outcomes recorded yet</option>}
                  {outcomes.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            )}

            <div className="flex-1 min-w-[280px] text-[12.5px] text-gray-500 dark:text-zinc-400 leading-relaxed pt-6">
              {tool.note}
            </div>
          </div>

          <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#0d0d0d] rounded-lg px-3 py-2.5 mt-3.5">
            <Info className="h-3.5 w-3.5 text-gray-500 dark:text-zinc-500 flex-shrink-0 mt-0.5" />
            <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 leading-relaxed">
              {bound.outcomeColumns.length > 0
                ? 'Risk of bias is judged per outcome, so pick one above. '
                : 'This form stores one assessment per study rather than one per outcome. '}
              Judgments run through the normal pipeline — AI draft → two reviewers → consensus — and
              Synthesis reads only the agreed values.
            </span>
          </div>

          {!bound.conforming && (
            <div className="flex items-start gap-2.5 border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-500/5 rounded-lg px-3 py-2.5 mt-2">
              <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-[12.5px] text-amber-900 dark:text-amber-200 leading-relaxed">
                This form doesn&rsquo;t use {tool.name.split('—')[0].trim()}&rsquo;s own judgments, so
                they&rsquo;re translated for display and some can&rsquo;t be saved back into it. Its
                existing assessments are read correctly either way.
                <div className="mt-2">{presetButtons}</div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4 items-start">
          <StudyGrid
            domains={bound.domains}
            rows={gridRows}
            selectedDocumentId={selectedDoc}
            onSelect={setSelectedDoc}
            progressText={progressText}
          />

          {selectedRow && (
            <DomainPanel
              studyLabel={selectedRow.label}
              statusNote={STATUS_LABEL[selectedRow.status]}
              outcome={outcome}
              tool={tool}
              domains={bound.domains}
              writes={writes}
              rawValues={rawValues}
              confirmed={confirmed}
              onJudgment={setJudgment}
              onRationale={setRationale}
              onConfirm={confirmDomain}
              onSave={save}
              saving={saving}
              dirty={dirty}
              canEdit={canEdit}
              documentId={selectedRow.documentId}
              formId={activeFormId}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout
      title="Risk of Bias"
      description="Assess internal validity per study — dual review, adjudicated like any extraction"
    >
      {body}
    </DashboardLayout>
  );
}

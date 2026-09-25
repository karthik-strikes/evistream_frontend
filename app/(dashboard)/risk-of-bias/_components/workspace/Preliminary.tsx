'use client';

/**
 * Part 1 · Preliminary considerations.
 *
 * Two facts here belong to the STUDY, not the assessment, and are settled once:
 * the design (which selects the instrument) and — for a result — which arms are
 * compared. Both are editable at the study's first assessment and locked after.
 * The rest (location of the result, the aim, sources) is per assessment.
 */

import { useState, type ReactNode } from 'react';
import { ArrowRight, Lock } from 'lucide-react';

import { cn, getErrorMessage } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { robService } from '@/services';
import { DEVIATION_LABEL } from '../../_lib/rob2';
import {
  DESIGN_LABEL, DESIGN_ORDER, EFFECT_LABEL, SOURCE_OPTIONS, TOOL_FOR_DESIGN, comparisonText,
  designAssessable, type EffectOfInterest, type StudyDesign, type Target,
} from '../../_lib/robModel';
import type { ResultIdentity } from '../../_lib/robIdentity';
import { useRob } from '../../_lib/useRobData';
import { Banner, Eyebrow, OutlineButton, Pill, PrimaryButton, Segmented } from '../robUi';
import type { Draft } from './useWorkspaceDraft';

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 border-t border-gray-100 px-5 py-4 first:border-t-0 md:grid-cols-[190px_minmax(0,1fr)] dark:border-[#1a1a1a]">
      <div>
        <div className="text-[13px] font-semibold text-gray-900 dark:text-zinc-100">{label}</div>
        {help && <div className="mt-0.5 text-[11px] leading-[15px] text-gray-400 dark:text-zinc-500">{help}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const inputCls = (attention: boolean) => cn(
  'h-9 w-full rounded-lg border bg-white px-3 text-[13px] text-gray-900 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500 dark:bg-[#0d0d0d] dark:text-zinc-100 dark:disabled:bg-[#141414]',
  attention ? 'border-[#cbd5e1] focus:border-[#64748b] dark:border-slate-700' : 'border-gray-200 focus:border-gray-400 dark:border-[#2a2a2a]',
);

export function Preliminary({
  draft, update, target, readOnly, studyLabel, onContinue, onBackToDashboard,
}: {
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  target: Target;
  readOnly: boolean;
  studyLabel: string;
  onContinue: () => void;
  onBackToDashboard: () => void;
}) {
  const rob = useRob();
  const { toast } = useToast();
  const a = draft.assessment;
  const result: ResultIdentity | null = target.result;
  const { design: storedDesign, confirmed: designConfirmed } = rob.designOf(target.documentId);
  const [design, setDesign] = useState<StudyDesign | ''>(storedDesign ?? '');
  const [busy, setBusy] = useState(false);

  const contrast = result?.contrast ?? null;
  const contrastEditable = target.kind === 'result' && (!contrast || !contrast.intervention || contrast.state !== 'confirmed');
  const experimental = a.experimental || contrast?.intervention || '';
  const comparator = a.comparator || contrast?.comparator || '';

  const blocked = !!design && !designAssessable(design);
  const firstForStudy = !designConfirmed;
  const needsConfirm = firstForStudy || contrastEditable;
  const canContinue = !!design && !blocked
    && (target.kind === 'outcome' || (!!experimental.trim() && !!comparator.trim()));

  const setA = (patch: Partial<typeof a>) => update(d => ({ ...d, assessment: { ...d.assessment, ...patch } }));

  const effectEditable = rob.protocol.effect === 'both' && !readOnly;
  const setEffect = (effect: EffectOfInterest) => {
    if (effect === a.effect) return;
    const hadD2 = Object.keys(a.answers).some(id => id.startsWith('2.'));
    update(d => {
      const answers = { ...d.assessment.answers };
      const support = { ...d.assessment.support };
      const quotes = { ...d.assessment.quotes };
      for (const id of Object.keys(answers)) if (id.startsWith('2.')) delete answers[id];
      for (const id of Object.keys(support)) if (id.startsWith('2.')) delete support[id];
      for (const id of Object.keys(quotes)) if (id.startsWith('2.')) delete quotes[id];
      const judgement = [...d.assessment.judgement]; judgement[1] = null;
      const rationale = [...d.assessment.rationale]; rationale[1] = '';
      return {
        ...d,
        assessment: {
          ...d.assessment, effect, answers, support, quotes, judgement, rationale, overall: null,
          deviations: effect === 'adherence' && !d.assessment.deviations.length
            ? [...rob.protocol.deviation_types] : d.assessment.deviations,
        },
      };
    });
    if (hadD2) {
      toast({ title: 'Domain 2 answers cleared', description: 'Domain 2 asks different questions for this effect.', variant: 'warning' });
    }
  };

  /** Name the arms of this result's comparison, creating or re-pointing as needed. */
  const confirmComparison = async (res: ResultIdentity, exp: string, comp: string) => {
    const c = res.contrast;
    if (c && c.intervention) {
      const out = await robService.patchContrast(c.id, { intervention: exp, comparator: comp, state: 'confirmed' });
      const id = out.contrast?.id ?? c.id;
      if (id !== c.id) await robService.patchResult(res.id, { contrast_id: id } as any);
      return;
    }
    // No comparison yet (a held result). Attach an existing one for this pair,
    // or create it — never rename a placeholder other results may share.
    const inStudy = rob.contrasts.filter(x => x.document_id === res.document_id);
    let id = inStudy.find(x => x.intervention === exp && x.comparator === comp)?.id ?? null;
    if (!id) {
      await robService.commitResults(rob.projectId, [], [{
        id: '', project_id: rob.projectId, document_id: res.document_id,
        intervention: exp, comparator: comp, state: 'confirmed', source: 'manual',
        canonical_key: null, arms: inStudy[0]?.arms ?? [],
      } as any]);
      const registry = await robService.listResults(rob.projectId);
      id = registry.contrasts.find(x => x.document_id === res.document_id
        && x.intervention === exp && x.comparator === comp)?.id ?? null;
    }
    if (!id) throw new Error('The comparison could not be recorded.');
    await robService.patchResult(res.id, { contrast_id: id, state: 'active' } as any);
  };

  const onConfirm = async () => {
    if (readOnly) { onContinue(); return; }
    setBusy(true);
    try {
      if (firstForStudy && design) {
        await rob.updateProtocol({ study_designs: { [target.documentId]: design } });
      }
      if (contrastEditable && result) {
        await confirmComparison(result, experimental.trim(), comparator.trim());
        await rob.refresh();
      }
      setA({ prelimConfirmed: true, experimental: experimental.trim(), comparator: comparator.trim() });
      onContinue();
    } catch (e) {
      toast({ title: 'Could not confirm study details', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const recordBlockedDesign = async () => {
    if (!design) return;
    setBusy(true);
    try {
      await rob.updateProtocol({ study_designs: { [target.documentId]: design } });
      toast({ title: 'Study design recorded', description: `${TOOL_FOR_DESIGN[design]} is not available yet.`, variant: 'success' });
      onBackToDashboard();
    } catch (e) {
      toast({ title: 'Could not record the design', description: getErrorMessage(e), variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const outcome = target.outcomeTarget;
  const measurement = result?.measurement || (outcome?.measurements.join(', ') ?? '');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Eyebrow>Part 1</Eyebrow>
        <h2 className="mt-1 text-[20px] font-bold tracking-[-.01em] text-gray-900 dark:text-zinc-100">Preliminary considerations</h2>
        <p className="mt-1 text-[13px] text-gray-500 dark:text-zinc-400">
          Document what is being assessed and from which sources, before answering signalling questions.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
        <Row label="Study design" help="Confirmed once per study; selects the RoB 2 template">
          {designConfirmed && storedDesign ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-gray-200 bg-gray-50 px-2.5 py-1 text-[13px] text-gray-800 dark:border-[#2a2a2a] dark:bg-[#161616] dark:text-zinc-200">
                  <Lock className="h-3 w-3 text-gray-400" />{DESIGN_LABEL[storedDesign]}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-300" />
                <span className="text-[13px] font-semibold text-gray-900 dark:text-zinc-100">{TOOL_FOR_DESIGN[storedDesign]}</span>
              </div>
              <p className="mt-1.5 text-[12px] text-gray-500 dark:text-zinc-400">
                Confirmed for {studyLabel}. It applies to every assessment of this study.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={design} disabled={readOnly}
                  onChange={e => setDesign(e.target.value as StudyDesign)}
                  className={cn(inputCls(true), 'max-w-[340px]')}>
                  <option value="">— choose the study design —</option>
                  {DESIGN_ORDER.map(d => <option key={d} value={d}>{DESIGN_LABEL[d]}</option>)}
                </select>
                {design && <>
                  <ArrowRight className="h-3.5 w-3.5 text-gray-300" />
                  <span className="text-[13px] font-semibold text-gray-900 dark:text-zinc-100">{TOOL_FOR_DESIGN[design]}</span>
                </>}
              </div>
              <p className="mt-1.5 text-[12px] leading-[17px] text-[#475569] dark:text-slate-400">
                This is the first assessment for {studyLabel}. Choose the design from the paper before answering
                signalling questions; it applies to every assessment of this study.
              </p>
            </div>
          )}
          {blocked && design && (
            <Banner tone="slate" className="mt-3" action={!readOnly && !designConfirmed ? (
              <OutlineButton small onClick={recordBlockedDesign} disabled={busy}>Record design &amp; return</OutlineButton>
            ) : undefined}>
              <strong>{TOOL_FOR_DESIGN[design]} is not available yet.</strong> Only the parallel-group RoB 2
              template is built. This study can’t be assessed until its instrument is added; judging it with the
              parallel-group questions would miss what the design requires.
            </Banner>
          )}
        </Row>

        {target.kind === 'result' && (
          <Row label="Interventions compared"
            help="Set once per study with the design; defines “experimental” and “comparator” for every assessment of this comparison">
            {contrastEditable ? (
              <div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-gray-500 dark:text-zinc-400">Experimental</span>
                    <input value={experimental} disabled={readOnly} onChange={e => setA({ experimental: e.target.value })}
                      className={inputCls(true)} placeholder="Experimental arm" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-gray-500 dark:text-zinc-400">Comparator</span>
                    <input value={comparator} disabled={readOnly} onChange={e => setA({ comparator: e.target.value })}
                      className={inputCls(true)} placeholder="Comparator arm" />
                  </label>
                </div>
                <p className="mt-1.5 text-[12px] leading-[17px] text-gray-500 dark:text-zinc-400">
                  {contrast?.intervention ? 'Prefilled from the extracted comparison. ' : 'No comparison was extracted for this result. '}
                  Correct if the paper labels arms differently. Multi-arm trials: each comparison is its own result.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="rounded-[6px] border border-gray-200 bg-gray-50 px-2.5 py-1 dark:border-[#2a2a2a] dark:bg-[#161616]">
                  <span className="text-gray-400">Experimental </span>{contrast?.intervention}
                </span>
                <span className="rounded-[6px] border border-gray-200 bg-gray-50 px-2.5 py-1 dark:border-[#2a2a2a] dark:bg-[#161616]">
                  <span className="text-gray-400">Comparator </span>{contrast?.comparator}
                </span>
                <Lock className="h-3 w-3 text-gray-400" />
              </div>
            )}
          </Row>
        )}

        <Row label="Outcome">
          <div className="text-[13px] text-gray-900 dark:text-zinc-100">
            {[target.outcome, measurement, result?.timepoint].filter(Boolean).join(' · ')}
          </div>
        </Row>

        {target.kind === 'result' && (
        <Row label="Result being assessed" help="Papers often report the same outcome more than one way (ITT and per-protocol, adjusted and unadjusted). Say which number this is, so every reviewer judges the same one.">
          <div className="text-[13px] text-gray-900 dark:text-zinc-100">
            {result?.estimate || <span className="italic text-gray-400">Estimate not recorded</span>}
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] text-gray-500 dark:text-zinc-400">Where in the paper is this number? <span className="text-gray-400 dark:text-zinc-500">· optional</span></span>
            <input value={a.resultLocation} disabled={readOnly} onChange={e => setA({ resultLocation: e.target.value })}
              className={cn(inputCls(false), 'max-w-[360px]')} placeholder="e.g. Table 2, ITT analysis" />
          </label>
        </Row>
        )}

        <Row label={target.kind === 'result' ? 'Aim for this result' : 'Aim for this assessment'}
          help={rob.protocol.effect === 'both' ? 'The protocol allows either; choose for this assessment.' : 'Fixed by the review protocol.'}>
          <Segmented<EffectOfInterest> value={a.effect} disabled={!effectEditable}
            onChange={setEffect}
            options={[
              { value: 'assignment', label: EFFECT_LABEL.assignment, disabled: !effectEditable && a.effect !== 'assignment' },
              { value: 'adherence', label: EFFECT_LABEL.adherence, disabled: !effectEditable && a.effect !== 'adherence' },
            ]} />
          {a.effect === 'adherence' && (
            <div className="mt-2 text-[12px] text-gray-500 dark:text-zinc-400">
              Deviations addressed (from the protocol):
              <ul className="mt-1 list-disc pl-5">
                {a.deviations.map(dv => <li key={dv}>{DEVIATION_LABEL[dv]}</li>)}
              </ul>
            </div>
          )}
        </Row>

        <Row label="Sources obtained" help="Tick all used. Use as many as possible.">
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_OPTIONS.map(([key, label]) => {
              const on = a.sourcesObtained.includes(key);
              return (
                <Pill key={key} on={on} disabled={readOnly} className="px-3 py-1 text-[12px] font-medium"
                  onClick={() => setA({ sourcesObtained: on ? a.sourcesObtained.filter(s => s !== key) : [...a.sourcesObtained, key] })}>
                  {label}
                </Pill>
              );
            })}
          </div>
        </Row>
      </div>

      <div className="flex justify-end">
        <PrimaryButton onClick={onConfirm} disabled={busy || (!readOnly && !canContinue)}>
          {busy ? 'Saving…' : !readOnly && needsConfirm ? 'Confirm study details & continue →' : 'Continue to Domain 1 →'}
        </PrimaryButton>
      </div>
    </div>
  );
}

'use client';

/**
 * Harmonization — every transformation the engine proposes, confirmed one by
 * one. The raw extracted values are never overwritten: a confirmation is a
 * decision that makes the engine apply its own formula, and the record keeps
 * inputs, formula, assumptions and method.
 */

import { useMemo, useState } from 'react';

import { EFFECT_LABEL } from '@/lib/metaAnalysis';
import { classifyVariability, DEFAULT_VARIABILITY_ACTION, VARIABILITY_LABEL } from '../../_lib/buildStudies';
import { shortHash } from '../../_lib/datasetHash';
import { ENGINE_VERSION, runMeta, unitsOf, type TransformationView } from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import type { WorkspaceState } from '../../_lib/useWorkspace';
import {
  Banner, Collapsible, EmptyPanel, Mono, OutlineButton, PrimaryButton, StateText, TableFrame, TextInput, Th,
} from '../ui';

function stateText(t: TransformationView) {
  if (t.state === 'confirmed') return <StateText tone="green">Confirmed</StateText>;
  if (t.state === 'engine') return <StateText tone="muted">Engine</StateText>;
  if (t.state === 'blocked') return <StateText tone="gray">Blocked</StateText>;
  return <StateText tone="amber">Open</StateText>;
}

export function HarmonizationTab({ ws, openStudy }: { ws: WorkspaceState; openStudy: (d: string) => void }) {
  const syn = useSynthesis();
  const m = ws.model;
  const list = m.transformations;
  const [selected, setSelected] = useState<string | null>(null);
  const [icc, setIcc] = useState<Record<string, { icc: string; m: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [datasetOpen, setDatasetOpen] = useState(true);

  const open = list.filter(t => t.state === 'open' || t.state === 'blocked');
  const current = list.find(t => t.ref === selected) ?? open[0] ?? list[0] ?? null;
  const study = current ? m.studies.find(s => s.documentId === current.documentId) : null;

  const perStudy = useMemo(() => {
    const r = runMeta(m.datasetStudies, ws.config);
    return new Map(r.studies.map(s => [s.documentId, s]));
  }, [m.datasetStudies, ws.config]);

  if (!m.targetConfirmed || !m.mappingReady) {
    return <EmptyPanel title="Nothing to harmonize yet">Confirm the target on Target; transformations are proposed for the candidate results it derives.</EmptyPanel>;
  }

  const confirm = async (t: TransformationView) => {
    const extra: Record<string, unknown> = {};
    if (t.needsInput === 'icc') {
      const v = icc[t.ref];
      const iccN = Number(v?.icc); const mN = Number(v?.m);
      if (!(iccN >= 0 && iccN <= 1) || !(mN >= 1)) { setError('Enter an ICC between 0 and 1 and a mean cluster size of at least 1.'); return; }
      extra.icc = iccN; extra.m = mN;
    }
    setBusy(true); setError(null);
    try {
      await syn.addDecision(ws.group.id, {
        kind: 'transformation', target_ref: t.ref,
        value: { kind: t.kind, confirmed: true, formula: t.formula, inputs: t.inputs, assumptions: t.assumptions, method_ref: t.methodRef, factor: t.factor ?? null, fingerprint: t.fingerprint, ...extra },
        provenance: { proposed_by: 'engine', engine_version: ENGINE_VERSION },
      });
    } catch (e: any) { setError(e?.message ?? 'Could not confirm.'); } finally { setBusy(false); }
  };
  const undo = async (t: TransformationView) => {
    if (!t.decision) return;
    setBusy(true); setError(null);
    try { await syn.revokeDecision(ws.group.id, t.decision.id, null); } catch (e: any) { setError(e?.message ?? 'Could not undo.'); } finally { setBusy(false); }
  };

  const units = unitsOf(ws.sourceForm);
  const measures = Object.keys(units.variabilityActions);
  const pendingCount = list.filter(t => t.state === 'open').length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="text-[17px] font-semibold text-[#0a0a0a] dark:text-white">
          {pendingCount} transformation{pendingCount === 1 ? '' : 's'} awaiting confirmation
        </div>
        <div className="mt-1 text-[13px] text-gray-500 dark:text-zinc-400">
          The engine proposes, you confirm, the engine applies. Studies whose source row is unreviewed are offered nothing until it is reviewed.
        </div>
      </div>
      {error && <Banner tone="red">{error}</Banner>}

      {list.length === 0 ? (
        <EmptyPanel title="No transformations needed">Every candidate study reports its values in the form the analysis uses.</EmptyPanel>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <TableFrame>
            <div className="min-w-[520px]">
              <div className="grid grid-cols-[120px_1fr_190px] gap-3 bg-[#fafafa] px-3 py-2 dark:bg-[#141414]">
                <Th>Study</Th><Th>Transformation</Th><Th>Confirm</Th>
              </div>
              {list.map(t => (
                <div key={t.ref} className={`grid grid-cols-[120px_1fr_190px] items-start gap-3 border-t border-[#ececea] px-3 py-3 dark:border-[#1f1f1f] ${current?.ref === t.ref ? 'bg-[#fafafa] dark:bg-[#141414]' : ''}`}>
                  <button type="button" onClick={() => openStudy(t.documentId)} className="truncate text-left text-[13px] font-medium text-[#0a0a0a] hover:underline dark:text-zinc-100" title={t.label}>{t.label}</button>
                  <button type="button" onClick={() => setSelected(t.ref)} className="min-w-0 text-left">
                    <div className="text-[13px] text-[#0a0a0a] dark:text-zinc-100">{t.name}</div>
                    {t.formula && <div className="mt-0.5 break-words font-mono text-[12px] text-gray-600 dark:text-zinc-400">{t.formula}</div>}
                    {(t.detail || t.blockedBy) && <div className="mt-0.5 text-[12px] text-gray-500">{t.blockedBy ?? t.detail}</div>}
                    {t.methodRef && <div className="mt-0.5 text-[11.5px] text-gray-400">{t.methodRef}</div>}
                  </button>
                  <div className="flex flex-col items-start gap-1.5">
                    {t.needsInput === 'icc' && t.state === 'open' && syn.canEdit && (
                      <div className="flex gap-1.5">
                        <TextInput className="h-8 w-[70px]" placeholder="ICC" ariaLabel="ICC" value={icc[t.ref]?.icc ?? ''} onChange={v => setIcc(x => ({ ...x, [t.ref]: { icc: v, m: x[t.ref]?.m ?? '' } }))} />
                        <TextInput className="h-8 w-[80px]" placeholder="mean m" ariaLabel="Mean cluster size" value={icc[t.ref]?.m ?? ''} onChange={v => setIcc(x => ({ ...x, [t.ref]: { icc: x[t.ref]?.icc ?? '', m: v } }))} />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {t.state === 'open' && syn.canEdit && <OutlineButton small disabled={busy} onClick={() => confirm(t)}>Confirm</OutlineButton>}
                      {stateText(t)}
                      {t.state === 'confirmed' && syn.canEdit && <button type="button" onClick={() => undo(t)} disabled={busy} className="text-[12px] text-gray-500 underline hover:text-red-600">Undo</button>}
                    </div>
                    {t.state === 'confirmed' && t.decision && <div className="text-[11.5px] text-gray-500">{t.decision.by_name ?? syn.nameOf(t.decision.by)}{t.decision.value?.icc !== undefined ? ` · ICC ${t.decision.value.icc}, m ${t.decision.value.m}` : ''}</div>}
                  </div>
                </div>
              ))}
            </div>
          </TableFrame>

          {current && (
            <aside className="flex flex-col gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#9ca3af]">{current.label} · raw → analysis-ready</div>
              <Box title="Raw (as extracted)">
                {study?.built ? <StudyNumbers s={study.built} /> : '—'}
              </Box>
              <div className="text-center text-gray-400">↓</div>
              <Box title={current.name}>
                <div className="font-mono text-[12px]">{current.formula || '—'}</div>
                {current.assumptions.length > 0 && <div className="mt-1 text-[12px] text-gray-500">Assumes {current.assumptions.join('; ')}</div>}
              </Box>
              <div className="text-center text-gray-400">↓</div>
              <Box title="Analysis-ready">
                {study?.analysis ? <StudyNumbers s={study.analysis} /> : <span className="text-gray-500">{current.state === 'blocked' ? current.blockedBy : 'Available once every transformation for this study is confirmed'}</span>}
              </Box>
              {syn.canEdit && current.state === 'open' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <PrimaryButton disabled={busy} onClick={() => confirm(current)}>Confirm</PrimaryButton>
                  {current.derived && ws.sourceForm && (
                    <a href={`/manual-extraction?form=${encodeURIComponent(ws.sourceForm.form_id)}&doc=${encodeURIComponent(current.documentId)}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex h-[38px] items-center rounded-[7px] border border-[#e5e7eb] px-4 text-[13px] font-medium text-[#0a0a0a] hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-100">
                      Enter SD manually
                    </a>
                  )}
                </div>
              )}
            </aside>
          )}
        </div>
      )}

      <Collapsible title="Conversion rules in use" open={rulesOpen} onToggle={() => setRulesOpen(o => !o)}>
        <div className="flex flex-col gap-1.5 text-[12.5px] text-[#374151] dark:text-zinc-300">
          {measures.length === 0 && <div className="text-gray-500">Form-level defaults: SE and CI convert to SD; IQR and range approximate (Wan 2014 when quartiles or range are mapped); unrecognised measures are excluded.</div>}
          {measures.map(ms => {
            const k = classifyVariability(ms);
            return <div key={ms}><Mono>{ms}</Mono> — {VARIABILITY_LABEL[k]} · {units.variabilityActions[ms] ?? DEFAULT_VARIABILITY_ACTION[k]}</div>;
          })}
          <div className="text-gray-500">CI → SD uses t on n − 1 below n = 60, z above; single-arm means only. Direction reversals are blocked until the construct is accepted. Timepoints are normalised to weeks by the engine.</div>
        </div>
      </Collapsible>

      <Collapsible title="Analysis-ready dataset" open={datasetOpen} onToggle={() => setDatasetOpen(o => !o)}
        right={<Mono>revision {shortHash(ws.hash)}</Mono>}>
        {m.dataset.length === 0 ? (
          <div className="text-[12.5px] text-gray-500">No study is ready yet.</div>
        ) : (
          <TableFrame>
            <div className="min-w-[600px]">
              <div className="grid grid-cols-[1.2fr_150px_90px_130px_1.2fr] gap-3 bg-[#fafafa] px-3 py-2 dark:bg-[#141414]">
                <Th>Study</Th><Th>{m.measure} (display)</Th><Th>SE</Th><Th>n (effective)</Th><Th>Provenance</Th>
              </div>
              {m.dataset.map(r => {
                const e = perStudy.get(r.document_id);
                const s = m.studies.find(x => x.documentId === r.document_id);
                const conf = (s?.transformations ?? []).filter(t => t.state === 'confirmed').map(t => t.name);
                return (
                  <div key={r.ref} className="grid min-h-[40px] grid-cols-[1.2fr_150px_90px_130px_1.2fr] items-center gap-3 border-t border-[#ececea] px-3 py-1.5 dark:border-[#1f1f1f]">
                    <span className="truncate text-[13px] text-[#0a0a0a] dark:text-zinc-100">{r.label}{r.derived ? ' †' : ''}</span>
                    <Mono>{e ? `${e.est.toFixed(2)} (${e.lo.toFixed(2)}, ${e.hi.toFixed(2)})` : 'not estimable'}</Mono>
                    <Mono>{e ? Math.sqrt(e.v).toFixed(3) : '—'}</Mono>
                    <Mono>{r.n_effective !== null && r.n_effective !== undefined ? `${+Number(r.n_effective).toFixed(1)}${r.n_randomised && r.n_randomised !== r.n_effective ? ` of ${r.n_randomised}` : ''}` : '—'}</Mono>
                    <span className="truncate text-[12px] text-gray-500" title={conf.join(' · ')}>{s?.trust === 'ai' ? 'AI · accepted' : s?.trust === 'manual' ? 'Manual' : 'Consensus'}{conf.length ? ` · ${conf.join(' · ')}` : ''}</span>
                  </div>
                );
              })}
            </div>
          </TableFrame>
        )}
        <div className="mt-2 text-[11.5px] text-gray-500">† SD derived rather than reported. {EFFECT_LABEL[m.measure]} and SE on the analysis scale, from the engine.</div>
      </Collapsible>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] bg-[#fafafa] px-3.5 py-3 dark:bg-[#141414]">
      <div className="mb-1 text-[11px] font-semibold text-gray-500">{title}</div>
      <div className="text-[12.5px] text-[#0a0a0a] dark:text-zinc-100">{children}</div>
    </div>
  );
}

function StudyNumbers({ s }: { s: import('@/lib/metaAnalysis').MetaStudy }) {
  const arm = (a: any) => ('events' in a ? `${+a.events.toFixed(2)}/${+a.total.toFixed(2)}` : `${+a.mean.toFixed(2)} (SD ${+a.sd.toFixed(2)}), n ${+a.n.toFixed(1)}`);
  if (s.treatment && s.comparator) return <div className="font-mono text-[12px]">I: {arm(s.treatment)}<br />C: {arm(s.comparator)}{s.flipSign ? <><br />sign reversed</> : null}</div>;
  if (s.precomputed) return <div className="font-mono text-[12px]">{s.precomputed.reported.est} → y {s.precomputed.y.toFixed(3)}, SE {s.precomputed.se.toFixed(3)}</div>;
  if (s.proportion) return <div className="font-mono text-[12px]">{s.proportion.events}/{s.proportion.total}</div>;
  if (s.correlation) return <div className="font-mono text-[12px]">r {s.correlation.r}, n {s.correlation.n}</div>;
  return <>—</>;
}

'use client';

/**
 * Source evidence for one study — the old EvidenceDrawer, extended with the
 * source-review gate: an AI-only row cannot enter a finalizable dataset until
 * a person accepts it as-is, corrects the extraction, or rejects it.
 *
 * "Correct extraction" does not edit anything here: it records that a
 * correction was requested and opens the document in manual extraction. The
 * study resolves itself when the corrected (human) row arrives, because trust
 * is read from the row, not from this decision.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { isBinaryArm, type Arm, type MetaStudy } from '@/lib/metaAnalysis';
import { SLOT_LABEL, type SlotKey } from '../../_lib/mapping';
import { studyRef, type StudyView } from '../../_lib/synthesisModel';
import { useSynthesis } from '../../_lib/useSynthesisData';
import type { WorkspaceState } from '../../_lib/useWorkspace';
import { OutlineButton, PrimaryButton, ReasonInput, StateText } from '../ui';

function armText(a: Arm | undefined): string {
  if (!a) return '—';
  if (isBinaryArm(a)) return `${+a.events.toFixed(2)} / ${+a.total.toFixed(2)}`;
  return `${+a.mean.toFixed(3)} (SD ${+a.sd.toFixed(3)}) n = ${+a.n.toFixed(1)}`;
}

function studyLine(s: MetaStudy | null): { t: string; c: string } {
  if (!s) return { t: '—', c: '—' };
  if (s.treatment && s.comparator) return { t: armText(s.treatment), c: armText(s.comparator) };
  if (s.precomputed) {
    const r = s.precomputed.reported;
    return { t: `${r.est}${r.lo !== null && r.hi !== null ? ` (${r.lo} to ${r.hi})` : ''}`, c: r.se !== null ? `SE ${r.se}` : `y ${s.precomputed.y.toFixed(3)} · SE ${s.precomputed.se.toFixed(3)}` };
  }
  if (s.proportion) return { t: `${s.proportion.events} / ${s.proportion.total}`, c: '—' };
  if (s.correlation) return { t: `r = ${s.correlation.r}`, c: `n = ${s.correlation.n}` };
  return { t: '—', c: '—' };
}

const ROB_TEXT = { low: ['Low', 'text-[#047857]'], some: ['Some concerns', 'text-[#92400e]'], high: ['High', 'text-[#b91c1c]'] } as const;

export function SourceDrawer({ ws, documentId, onClose }: { ws: WorkspaceState; documentId: string | null; onClose: () => void }) {
  const syn = useSynthesis();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setReason(''); setError(null);
    if (documentId) { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }
    setShown(false);
  }, [documentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!documentId) return null;
  const s: StudyView | undefined = ws.model.studies.find(x => x.documentId === documentId);
  const formId = ws.sourceForm?.form_id ?? '';
  const c = s?.selected ?? s?.pendingCandidate ?? s?.candidates[0] ?? null;
  const tRow = c?.pairing.treatmentRow;
  const cRow = c?.pairing.comparatorRow;
  const mapping = ws.sourceForm?.mapping ?? {};
  const sameRow = tRow === cRow;

  const quotes = Object.entries((tRow?._rawCells ?? {}) as Record<string, any>)
    .map(([col, cell]) => ({ col, text: cell?.source_text as string | undefined }))
    .filter(q => typeof q.text === 'string' && q.text.trim() !== '' && q.text !== 'NR');
  if (!sameRow) {
    for (const [col, cell] of Object.entries((cRow?._rawCells ?? {}) as Record<string, any>)) {
      const text = cell?.source_text as string | undefined;
      if (text && text.trim() && text !== 'NR' && !quotes.some(q => q.text === text)) quotes.push({ col: `${col} (comparator)`, text });
    }
  }
  // Deterministic mismatch flag: the quote says "median" but the value enters as a mean.
  const valueCols = new Set(['value', 'mean_treatment', 'mean_comparator'].map(k => mapping[k]).filter(Boolean));
  const mismatch = quotes.some(q => valueCols.has(q.col.replace(/ \(comparator\)$/, '')) && /\bmedian\b/i.test(q.text ?? ''))
    && !(s?.transformations ?? []).some(t => t.kind === 'median_as_mean' || t.kind.startsWith('median_'));

  const raw = studyLine(s?.built ?? null);
  const ready = studyLine(s?.analysis ?? null);
  const rob = syn.rob.byDoc.get(documentId);
  const needsReview = s?.readiness === 'source_unreviewed' || s?.sourceReview === 'unreviewed';

  const record = async (state: 'accepted' | 'rejected' | 'correction_requested') => {
    if (!s) return;
    if (state === 'rejected' && !reason.trim()) { setError('Rejecting a row excludes the study — type the reason first.'); return; }
    setBusy(true); setError(null);
    try {
      await syn.addDecision(ws.group.id, {
        kind: 'source_review', target_ref: studyRef(s.documentId),
        value: { state, result_id: s.resultId, trust: s.trust, row_fingerprint: s.sourceFingerprint }, reason: reason.trim() || null,
      });
      setReason('');
      if (state === 'correction_requested' && formId) window.open(`/manual-extraction?form=${encodeURIComponent(formId)}&doc=${encodeURIComponent(documentId)}`, '_blank', 'noopener');
    } catch (e: any) { setError(e?.message ?? 'Could not record the review.'); } finally { setBusy(false); }
  };

  const mappedCells = (row: typeof tRow, which: 'treatment' | 'comparator') => Object.entries(mapping)
    .filter(([slot]) => sameRow ? (which === 'treatment' ? !slot.endsWith('_comparator') : slot.endsWith('_comparator')) : !['arm', 'outcome', 'timepoint'].includes(slot))
    .filter(([slot]) => !['outcome', 'timepoint', 'arm'].includes(slot))
    .map(([slot, col]) => ({ slot: slot as SlotKey, col, v: String(row?.[col] ?? '').trim() }));

  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-black/[.18] dark:bg-black/40" />
      <div className={`absolute bottom-0 right-0 top-0 flex w-full max-w-[460px] flex-col border-l border-transparent bg-white shadow-2xl transition-transform duration-300 ease-out dark:border-[#1f1f1f] dark:bg-[#0f0f0f] ${shown ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-start gap-3 border-b border-[#ececea] px-5 py-4 dark:border-[#1f1f1f]">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">Source evidence</div>
            <div className="mt-0.5 truncate text-[18px] font-semibold text-[#0a0a0a] dark:text-white">{s?.label ?? syn.labelOf(documentId)}</div>
            {c && <div className="mt-0.5 text-[12.5px] text-gray-500 dark:text-zinc-400">{[c.outcome, c.timepoint, c.comparison].filter(Boolean).join(' · ')}</div>}
            {s && <div className="mt-0.5 text-[12px] text-gray-500">Trust: {s.trust === 'ai' ? 'AI only' : s.trust === 'manual' ? 'Manual review' : 'Consensus'}{s.sourceReview !== 'reviewed' ? ` · ${s.sourceReview.replace('_', ' ')}` : ''}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {needsReview && (
            <div className="mb-4 rounded-[12px] border border-[#fde68a] bg-[#fffdf5] px-4 py-3 dark:border-amber-900/60 dark:bg-amber-500/[0.04]">
              <div className="text-[13.5px] font-semibold text-[#92400e] dark:text-amber-300">
                {s?.sourceReview === 'correction_requested' ? 'Correction requested — waiting for the corrected extraction' : 'AI-extracted and unreviewed'}
              </div>
              <div className="mt-1 text-[12.5px] leading-[19px] text-gray-700 dark:text-zinc-300">
                {mismatch ? 'Mismatch flagged: the quoted source mentions a median, but the value enters as a mean. ' : ''}
                Check the values against the quotes below. No transformation is offered until the row is reviewed.
              </div>
              {syn.canEdit && (
                <>
                  <div className="mt-2.5"><ReasonInput value={reason} onChange={setReason} placeholder="Reason — required to reject, optional otherwise" /></div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <PrimaryButton disabled={busy} onClick={() => record('correction_requested')}>Correct extraction</PrimaryButton>
                    <OutlineButton disabled={busy || !reason.trim()} onClick={() => record('rejected')}>Reject row</OutlineButton>
                    <OutlineButton disabled={busy} onClick={() => record('accepted')}>Accept as-is</OutlineButton>
                  </div>
                </>
              )}
            </div>
          )}
          {error && <div className="mb-3"><StateText tone="red">{error}</StateText></div>}

          <div className="grid grid-cols-2 gap-2.5">
            {(['treatment', 'comparator'] as const).map(which => (
              <div key={which} className="rounded-[10px] bg-[#fafafa] px-3 py-2.5 dark:bg-[#141414]">
                <div className="text-[11px] text-gray-500">{which === 'treatment' ? 'Intervention · raw' : 'Comparator · raw'}</div>
                <div className="mt-1 break-words font-mono text-[12.5px] text-[#0a0a0a] dark:text-zinc-100">{which === 'treatment' ? raw.t : raw.c}</div>
                <div className="mt-1.5 flex flex-col gap-0.5">
                  {mappedCells(which === 'treatment' ? tRow : cRow, which).slice(0, 6).map(x => (
                    <div key={x.slot} className="truncate font-mono text-[10.5px] text-gray-500" title={`${x.col} = ${x.v}`}>{SLOT_LABEL[x.slot] ?? x.slot}: {x.v || '—'}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 text-[12.5px] text-[#374151] dark:text-zinc-300">
            <span className="text-gray-500">Analysis-ready: </span>
            {s?.analysis ? <span className="font-mono text-[12px]">{ready.t} vs {ready.c}</span> : <span className="text-gray-500">{s?.readinessReason || 'not in the dataset'}</span>}
          </div>

          {(s?.transformations ?? []).length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">Transformations</div>
              {s!.transformations.map(t => (
                <div key={t.ref} className="flex items-baseline gap-2 py-0.5 text-[12.5px]">
                  <span className="text-[#374151] dark:text-zinc-300">{t.name}</span>
                  <span className="font-mono text-[11.5px] text-gray-500">{t.formula}</span>
                  <span className="ml-auto"><StateText tone={t.state === 'confirmed' ? 'green' : t.state === 'engine' ? 'muted' : t.state === 'blocked' ? 'gray' : 'amber'}>{t.state === 'confirmed' ? 'Confirmed' : t.state === 'engine' ? 'Engine' : t.state === 'blocked' ? 'Blocked' : 'Open'}</StateText></span>
                </div>
              ))}
            </div>
          )}

          <div className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">Extracted from</div>
          {quotes.length ? (
            <div className="flex flex-col gap-2">
              {quotes.slice(0, 6).map(q => (
                <div key={q.col}>
                  <div className="mb-1 font-mono text-[10.5px] text-gray-400">{q.col}</div>
                  <div className="rounded-r-[8px] border-l-[3px] border-l-[#16a34a] bg-[#fafafa] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#374151] dark:bg-[#141414] dark:text-zinc-300">“{q.text}”</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[10px] border border-dashed border-[#e5e7eb] px-3.5 py-3 text-[12.5px] text-gray-500 dark:border-[#2a2a2a]">
              No quoted source text was stored for these values — open the document to check them.
            </div>
          )}

          <div className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">Risk of bias · study-level</div>
          <div className="text-[13px] text-[#374151] dark:text-zinc-300">
            {rob?.overall ? <span className={ROB_TEXT[rob.overall][1]}>{ROB_TEXT[rob.overall][0]}</span> : <span className="text-[#9ca3af]">Not assessed</span>}
            {rob && rob.assessments > 0 && <span className="text-gray-500"> · {rob.completed} of {rob.assessments} assessment{rob.assessments === 1 ? '' : 's'} complete{rob.source === 'consensus' ? ' · consensus' : ''}</span>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[#ececea] px-5 py-4 dark:border-[#1f1f1f]">
          <Link href={`/consensus?form=${encodeURIComponent(formId)}&doc=${encodeURIComponent(documentId)}`}
            className="inline-flex h-[38px] flex-1 items-center justify-center rounded-[7px] bg-[#0a0a0a] px-4 text-[13px] font-semibold text-white hover:bg-gray-800 dark:bg-zinc-100 dark:text-gray-900">
            Open document review
          </Link>
          <Link href={`/manual-extraction?form=${encodeURIComponent(formId)}&doc=${encodeURIComponent(documentId)}`}
            className="inline-flex h-[38px] items-center justify-center rounded-[7px] border border-[#e5e7eb] px-4 text-[13px] font-medium text-[#0a0a0a] hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-100">
            Open in extraction
          </Link>
        </div>
      </div>
    </div>
  );
}

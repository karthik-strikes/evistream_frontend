'use client';

/**
 * AI suggestion UI, presentational only. Colours follow the repo's slate-only
 * warning rule (AI "differs", Partial evidence, flags are slate #475569).
 * Rendered only when `ROB_AI_ENABLED` and the protocol's visibility is not
 * `off` — see `_lib/robAi.ts`.
 */

import { useEffect, useState, type CSSProperties } from 'react';

import { cn } from '@/lib/utils';
import type { RobAiDomainState } from '@/services/rob.service';
import { ANSWER_LABEL, ANSWER_ORDER, type AnswerCode } from '../../_lib/rob2';
import {
  estimateText, quoteLocator, sameAnswer, type AiDomainSuggestion, type AiQuote, type AiRunPhase,
  type AiSuggestion,
} from '../../_lib/robAi';
import { JUDGEMENT_LABEL, isQuestionLog, type AiLogEntry, type AiLogItem } from '../../_lib/robModel';

function Sparkle({ size, stroke = 'currentColor', second }: { size: number; stroke?: string; second?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      {second && <path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />}
    </svg>
  );
}

const SMALL_BTN = 'cursor-pointer rounded-[6px] border border-[#e5e7eb] bg-white px-2.5 py-[5px] text-[12px] font-semibold text-[#374151] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300';
const DARK_BTN = 'cursor-pointer rounded-[6px] border-none bg-[#0a0a0a] px-2.5 py-[5px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#d4d4d8] dark:bg-zinc-100 dark:text-gray-900 dark:disabled:bg-zinc-700';
const LINK_BTN = 'cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-[#374151] underline dark:text-zinc-300';

// ── Header control ───────────────────────────────────────────────────────────

const STATUS_WORD: Record<RobAiDomainState['status'], string> = {
  missing: 'not run', queued: 'queued', running: 'running', done: 'ready', failed: 'failed',
};


// ── Five moons: one per domain ───────────────────────────────────────────────

/** Where a settled moon rests: evenly round the tilted ring (rx 10, ry 3.5). */
function slot(i: number, n: number): { '--slot': string; opacity: number; zIndex: number } {
  const ang = (2 * Math.PI * i) / n + Math.PI / 2;
  const depth = Math.sin(ang);
  const scale = depth > 0 ? 1 + 0.4 * depth : 1 + 0.38 * depth;
  return {
    '--slot': `translate(${(10 * Math.cos(ang)).toFixed(2)}px, ${(3.5 * depth).toFixed(2)}px) scale(${scale.toFixed(2)})`,
    opacity: depth > 0 ? 1 : 0.9 + 0.45 * depth,
    zIndex: depth > 0.3 ? 3 : depth < -0.3 ? 1 : 2,
  };
}

/**
 * The one AI animation. Moons of running/queued domains orbit together; a
 * finished domain's moon stops at its own place on the ring (green; red if it
 * failed). With nothing running the ring is still.
 */
function Moons({ domains }: { domains: RobAiDomainState[] }) {
  const ds = [...domains].sort((a, b) => a.domain - b.domain);
  const n = ds.length || 5;
  const working = ds.some(d => d.status === 'running' || d.status === 'queued');
  const complete = ds.length > 0 && ds.every(d => d.status === 'done');
  const title = ds.map(d => `D${d.domain + 1} ${STATUS_WORD[d.status]}${d.error ? ` (${d.error})` : ''}`).join(' · ');
  return (
    <span className={cn('rob-ai-ring', working && 'is-working', complete && 'is-complete')} title={title} aria-hidden>
      {ds.map((d, i) => {
        const moving = d.status === 'running' || d.status === 'queued';
        return (
          <span key={d.domain}
            className={moving ? cn('is-orbiting', d.status === 'queued' && 'is-queued') : `is-${d.status}`}
            style={moving ? { animationDelay: `${-(1.5 / n) * i}s` } : slot(i, n) as CSSProperties} />
        );
      })}
    </span>
  );
}

/** Seconds since the run started, beside a shimmering label. */
function Working({ label }: { label: string }) {
  const [start] = useState(() => Date.now());
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [start]);
  return (
    <span className="inline-flex items-center gap-2" aria-live="polite">
      <span className="rob-ai-shimmer-soft">{label}</span>
      <span className="font-normal tabular-nums text-[#8a8983] dark:text-zinc-500">{secs}s</span>
    </span>
  );
}



/**
 * The AI state of one domain, in the left DOMAINS rail beside its name — where
 * the reviewer already looks. Running is the only thing that moves (one small
 * moon on its orbit); a failed domain offers its own one-call Retry.
 */
export function AiRailMark({ state, onRetry, retrying }: {
  state: RobAiDomainState; onRetry?: () => void; retrying?: boolean;
}) {
  const word = state.status === 'done' ? 'AI answers ready'
    : state.status === 'failed' ? `AI failed${state.error ? `: ${state.error}` : ''}`
      : state.status === 'running' ? 'AI is reading the paper'
        : state.status === 'queued' ? 'AI waiting to start' : 'AI not run';
  if (state.status === 'failed' && onRetry) {
    return (
      <button type="button" onClick={onRetry} disabled={retrying} title={`${word} — retry this domain (1 call)`}
        className="flex h-5 cursor-pointer items-center gap-1 rounded-full border border-[#fecaca] bg-white px-1.5 text-[10.5px] font-semibold text-[#dc2626] hover:bg-[#fef2f2] disabled:cursor-wait disabled:opacity-60 dark:border-red-900/60 dark:bg-transparent dark:text-red-400">
        <svg width={9} height={9} viewBox="0 0 12 12" aria-hidden><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" /></svg>
        {retrying ? '…' : 'Retry'}
      </button>
    );
  }
  return (
    <span title={word} className="flex h-5 w-5 items-center justify-center">
      <span className="sr-only">{word}</span>
      {state.status === 'done' && (
        <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[#dcfce7] dark:bg-emerald-900/40">
          <svg width={9} height={9} viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke="#16a34a" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      )}
      {state.status === 'failed' && (
        <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[#fee2e2] dark:bg-red-900/40">
          <svg width={8} height={8} viewBox="0 0 12 12" aria-hidden><path d="M3 3l6 6M9 3l-6 6" stroke="#dc2626" strokeWidth={1.9} strokeLinecap="round" /></svg>
        </span>
      )}
      {state.status === 'running' && (
        <span className="inline-flex scale-[.62]" aria-hidden>
          <span className="rob-ai-ring is-working"><span className="is-orbiting" /></span>
        </span>
      )}
      {state.status === 'queued' && <span className="h-[6px] w-[6px] rounded-full bg-[#a5b4fc] dark:bg-indigo-400/70" aria-hidden />}
      {state.status === 'missing' && <span className="h-[8px] w-[8px] rounded-full border border-[#d4d4d8] dark:border-zinc-600" aria-hidden />}
    </span>
  );
}

/**
 * Supervisors (consensus reviewer / managers) get the run button with the
 * per-domain status and the call estimate; readers get a one-line status.
 */
export function AiHeaderControl({ supervisor, phase, domains, estimate, readerNote, busy, onRun, tally }: {
  supervisor: boolean;
  phase: AiRunPhase;
  domains: RobAiDomainState[];
  estimate: { calls: number; paper_tokens: number } | null;
  /** Readers: why answers are withheld, or null when some are shown. */
  readerNote: string | null;
  busy: boolean;
  onRun: (force: boolean) => void;
  tally: string;
}) {

  if (!supervisor) {
    const text = readerNote ?? (phase === 'working' ? 'AI suggestions · preparing' : phase === 'none' ? 'AI suggestions · not run yet' : 'AI suggestions');
    return (
      <span title={phase === 'ready' || phase === 'partial' ? tally : undefined}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#e5e7eb] px-2.5 text-[11px] font-medium leading-[22px] text-[#4b5563] dark:border-[#2a2a2a] dark:text-zinc-400">
        {domains.length > 0 ? <Moons domains={domains} /> : <Sparkle size={11} />}
        {phase === 'working' ? <Working label="AI is reading the paper" /> : text}
      </span>
    );
  }

  const working = phase === 'working' || busy;
  const rerun = phase === 'ready';
  const est = estimateText(estimate);
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-end">
        <button type="button" onClick={() => onRun(rerun)} disabled={working}
          title={rerun ? 'Run the AI again on this target, replacing the stored drafts' : tally}
          className="flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#374151] hover:bg-[#f9fafb] disabled:cursor-wait dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300 dark:hover:bg-[#1a1a1a]">
          {domains.length > 0 ? <Moons domains={domains} /> : <Sparkle size={13} second />}
          {working
            ? <Working label="Reading the paper" />
            : rerun ? 'Re-run AI' : phase === 'failed' || phase === 'partial' ? 'Retry AI suggestions' : 'Get AI suggestions'}
        </button>
        {est && <span className="mt-0.5 text-[10.5px] leading-[13px] text-[#9ca3af] dark:text-zinc-500">{est}</span>}
      </div>
    </div>
  );
}

// ── Per-question strips ──────────────────────────────────────────────────────

const STRIP = 'ml-[38px] overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] dark:border-[#242424] dark:bg-[#0d0d0d]';

/** Readers under `readers_and_cr`: the answer exists but is withheld until they answer. */
export function AiHiddenStrip({ answered, revealing, onReveal }: {
  answered: boolean; revealing: boolean; onReveal: () => void;
}) {
  return (
    <div className={STRIP} onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Sparkle size={12} stroke="#9ca3af" />
        <span className="flex-1 text-[12px] font-medium text-[#6b7280] dark:text-zinc-400">
          AI suggestion hidden · {answered ? 'your answer is in' : 'reveal after you answer'}
        </span>
        {answered && (
          <button type="button" onClick={onReveal} disabled={revealing} className={cn(LINK_BTN, 'disabled:cursor-wait disabled:opacity-60')}>
            {revealing ? 'Saving…' : 'Reveal'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Retrieved mode: the model did not find it in what it read — NOT "No information". */
export function AiNotFoundStrip() {
  return (
    <div className={STRIP} onClick={e => e.stopPropagation()}
      title="The paper was too long to send whole, so the AI read selected passages. This says nothing about whether the report addresses the question.">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Sparkle size={12} stroke="#9ca3af" />
        <span className="flex-1 text-[12px] font-medium text-[#6b7280] dark:text-zinc-400">AI: not found in the passages it read</span>
      </div>
    </div>
  );
}

const STRENGTH_CLS: Record<AiSuggestion['strength'], string> = {
  Strong: 'text-[#15803d] dark:text-emerald-400',
  Partial: 'text-[#475569] dark:text-slate-300',
  Insufficient: 'text-[#64748b] dark:text-slate-400',
};

const EVIDENCE_WORD: Record<AiSuggestion['evidenceType'], string> = {
  explicit: 'Stated in the report',
  inferred: 'Inferred from other statements',
  absent: 'Not addressed in the report',
};

function Flag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title}
      className="whitespace-nowrap rounded-full border border-[#cbd5e1] bg-[#f8fafc] px-1.5 text-[10.5px] font-medium leading-[16px] text-[#475569] dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
      {children}
    </span>
  );
}

export function AiQuestionStrip({
  questionId, ai, value, open, onToggle, onAccept, onKeep, onModify, onShowQuote, logNote, readOnly,
  allowNoInformation,
}: {
  questionId: string;
  ai: AiSuggestion;
  value: AnswerCode | undefined;
  open: boolean;
  onToggle: () => void;
  onAccept: () => void;
  /** "Keep mine" when the reviewer has an answer; "Dismiss" (rejected) when not. */
  onKeep: () => void;
  onModify: (code: AnswerCode, reason: string) => void;
  onShowQuote: (q: AiQuote) => void;
  logNote: string;
  readOnly: boolean;
  allowNoInformation: boolean;
}) {
  const [modifying, setModifying] = useState(false);
  const [pick, setPick] = useState<AnswerCode | null>(null);
  const [reason, setReason] = useState('');

  const label = ANSWER_LABEL[ai.answer];
  const isNI = ai.answer === 'NI';
  const agree = value ? sameAnswer(value, ai.answer) : null;
  const head = value ? (agree ? 'AI agrees' : 'AI differs') : 'AI';
  const lineCls = value
    ? (agree ? 'text-[#15803d] dark:text-emerald-400' : 'text-[#475569] dark:text-slate-300')
    : 'text-[#374151] dark:text-zinc-300';
  const reasonNeeded = !!pick && !sameAnswer(pick, ai.answer);
  const canSaveModify = !!pick && (!reasonNeeded || !!reason.trim());

  const closeModify = () => { setModifying(false); setPick(null); setReason(''); };

  return (
    <div className={STRIP} onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Sparkle size={12} stroke="#6b7280" />
        <span className={cn('min-w-0 flex-1 truncate text-[12px] font-medium', lineCls)}>
          {head}: {label}
          <span className="text-[#9ca3af] dark:text-zinc-500"> · </span>
          <span className={STRENGTH_CLS[ai.strength]}>{ai.strength}</span>
        </span>
        {ai.conflicting && <Flag title="The report says two different things">Conflicting</Flag>}
        {ai.variesAcross.length > 0 && <Flag title="The answer is not the same for every measurement or time point">Varies</Flag>}
        {logNote && <span className="whitespace-nowrap text-[11px] text-[#9ca3af] dark:text-zinc-500">{logNote}</span>}
        <button type="button" onClick={onToggle} className={LINK_BTN}>
          {open ? 'Hide' : value ? 'Compare' : 'Show'}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t border-[#e5e7eb] bg-white px-3 py-2.5 dark:border-[#242424] dark:bg-[#111111]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500">AI answer</span>
            <span className="text-[13px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{label}</span>
            <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">{EVIDENCE_WORD[ai.evidenceType]}</span>
            <span className={cn('ml-auto text-[11px] font-medium', STRENGTH_CLS[ai.strength])}>Evidence {ai.strength}</span>
          </div>

          {ai.quotes.map((q, i) => (
            <div key={i} className="flex items-start gap-2.5 border-l-2 border-[#e5e7eb] px-2.5 py-0.5 dark:border-zinc-600">
              <span className="min-w-0 flex-1 text-[12px] italic leading-[17px] text-[#374151] dark:text-zinc-300">“{q.text}”</span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                {quoteLocator(q) && <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">{quoteLocator(q)}</span>}
                <button type="button" onClick={() => onShowQuote(q)} className={LINK_BTN}>Show in PDF</button>
              </span>
            </div>
          ))}
          {ai.strippedQuotes > 0 && (
            <span className="text-[11px] text-[#475569] dark:text-slate-400">
              {ai.strippedQuotes} quote{ai.strippedQuotes === 1 ? '' : 's'} could not be found in the paper and {ai.strippedQuotes === 1 ? 'was' : 'were'} removed.
            </span>
          )}
          {ai.rationale && <span className="text-[12px] leading-[17px] text-[#374151] dark:text-zinc-300">{ai.rationale}</span>}
          {isNI && ai.lookedFor && (
            <span className="text-[12px] leading-[17px] text-[#374151] dark:text-zinc-300">
              <span className="font-semibold">Looked for:</span> {ai.lookedFor}
            </span>
          )}
          {ai.variesAcross.length > 0 && (
            <span className="text-[12px] leading-[17px] text-[#475569] dark:text-slate-300">
              <span className="font-semibold">Differs for:</span>{' '}
              {ai.variesAcross.map(v => `${v.label} (${v.answer})`).join(', ')}
            </span>
          )}
          {ai.conflicting && (
            <span className="text-[12px] leading-[17px] text-[#475569] dark:text-slate-300">The report says two different things here. Read both passages before answering.</span>
          )}

          {modifying && !readOnly && (
            <div className="flex flex-col gap-2 rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] px-2.5 py-2 dark:border-[#242424] dark:bg-[#0d0d0d]">
              <div className="flex flex-wrap gap-1">
                {ANSWER_ORDER.filter(c => c !== 'NI' || allowNoInformation).map(c => (
                  <button key={c} type="button" onClick={() => setPick(c)}
                    className={cn('rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium',
                      pick === c ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900'
                        : 'border-[#e5e7eb] bg-white text-[#374151] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300')}>
                    {ANSWER_LABEL[c]}
                  </button>
                ))}
              </div>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                placeholder={reasonNeeded ? `Why ${pick ? ANSWER_LABEL[pick] : ''} rather than the AI's ${label}? (required)` : 'Note (optional)'}
                className={cn('w-full resize-y rounded-[6px] border bg-white px-2 py-1.5 text-[12px] leading-[17px] text-[#111827] outline-none placeholder:text-[#9ca3af] dark:bg-[#111111] dark:text-zinc-100',
                  reasonNeeded && !reason.trim() ? 'border-[#64748b]' : 'border-[#e5e7eb] dark:border-[#2a2a2a]')} />
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={!canSaveModify} className={DARK_BTN}
                  onClick={() => { if (pick) { onModify(pick, reason.trim()); closeModify(); } }}>
                  Save answer
                </button>
                <button type="button" onClick={closeModify} className="cursor-pointer border-none bg-transparent px-1.5 text-[12px] font-medium text-[#6b7280] dark:text-zinc-400">Cancel</button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {!readOnly && !modifying && (
              <>
                <button type="button" onClick={onAccept} className={DARK_BTN}
                  title={ai.quotes.length ? 'Use this answer and link its quote as evidence' : 'Use this answer'}>
                  Accept
                </button>
                <button type="button" onClick={onKeep} className={SMALL_BTN}>{value ? 'Keep mine' : 'Dismiss'}</button>
                <button type="button" onClick={() => { setModifying(true); setPick(value ?? null); }} className={SMALL_BTN}>Modify</button>
              </>
            )}
            <button type="button" onClick={onToggle}
              className="cursor-pointer border-none bg-transparent px-1.5 py-[5px] text-[12px] font-medium text-[#6b7280] dark:text-zinc-400">
              Close
            </button>
            <span className="ml-auto text-[11px] text-[#9ca3af] dark:text-zinc-500">Q{questionId} · logged for audit</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Domain / overall row ─────────────────────────────────────────────────────

const J_TEXT = {
  low: 'text-[#15803d] dark:text-emerald-400',
  some: 'text-[#475569] dark:text-slate-300',
  high: 'text-[#b91c1c] dark:text-red-400',
} as const;

/** "AI answers → engine suggests X". The judgement is the engine's, never the model's. */
export function AiJudgementRow({ suggestion, onInsert, readOnly }: {
  suggestion: AiDomainSuggestion; onInsert: () => void; readOnly: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-3.5 py-2.5 dark:border-[#242424] dark:bg-[#0d0d0d]">
      <span className="mt-0.5"><Sparkle size={13} stroke="#6b7280" /></span>
      <div className="flex flex-1 flex-col gap-[3px]">
        <span className="text-[12px]">
          <span className="font-semibold text-[#6b7280] dark:text-zinc-400">AI answers → engine suggests:</span>{' '}
          <span className={`font-semibold ${J_TEXT[suggestion.judgement]}`}>{JUDGEMENT_LABEL[suggestion.judgement]}</span>
        </span>
        <span className="text-[12px] leading-[17px] text-[#374151] dark:text-zinc-300">{suggestion.text}</span>
      </div>
      {!readOnly && (
        <button type="button" onClick={onInsert}
          className="cursor-pointer whitespace-nowrap rounded-[6px] border border-[#e5e7eb] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#374151] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300">
          Insert as rationale
        </button>
      )}
    </div>
  );
}

// ── Right-rail audit card ────────────────────────────────────────────────────

/** The latest decision per question (reveals excluded), in the order they were decided. */
export function decisions(log: AiLogItem[] | undefined): AiLogEntry[] {
  const latest = new Map<string, AiLogEntry>();
  for (const e of log ?? []) {
    if (!isQuestionLog(e) || e.action === 'revealed') continue;
    latest.delete(e.question);
    latest.set(e.question, e);
  }
  return [...latest.values()];
}

const ACTION_WORD: Record<AiLogEntry['action'], string> = {
  revealed: 'Revealed', accepted: 'Accepted', modified: 'Modified', rejected: 'Rejected', kept: 'Kept own',
};

export function aiTally(log: AiLogItem[] | undefined): string {
  const d = decisions(log);
  const n = (a: AiLogEntry['action']) => d.filter(e => e.action === a).length;
  return `${n('accepted')} accepted · ${n('modified')} modified · ${n('kept')} kept · ${n('rejected')} rejected`;
}

export function AiAuditCard({ log, model }: { log: AiLogItem[] | undefined; model: string }) {
  const rows = decisions(log);
  const revealed = (log ?? []).filter(e => isQuestionLog(e) && e.action === 'revealed').length;
  return (
    <div className="overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <div className="flex items-center justify-between gap-2 border-b border-[#f3f4f6] px-4 py-3 dark:border-[#1a1a1a]">
        <span className="text-[12px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500">AI audit trail</span>
        <span className="truncate text-[11px] text-[#9ca3af] dark:text-zinc-500" title={model}>{model}</span>
      </div>
      <div className="flex flex-col gap-1.5 px-4 py-2.5">
        <span className="text-[12px] text-[#374151] dark:text-zinc-300">{aiTally(log)}</span>
        {revealed > 0 && <span className="text-[11px] text-[#9ca3af] dark:text-zinc-500">{revealed} suggestion{revealed === 1 ? '' : 's'} revealed</span>}
        {rows.map(e => (
          <span key={e.question} className="text-[11px] text-[#6b7280] dark:text-zinc-400" title={e.reason || undefined}>
            <span className="font-semibold text-[#374151] dark:text-zinc-300">{e.question}</span>
            {' · '}{ACTION_WORD[e.action]} · AI {e.ai_answer}
            {e.human_answer_before ? ` · before ${e.human_answer_before}` : ''}
            {e.final_answer && e.final_answer !== e.ai_answer ? ` · final ${e.final_answer}` : ''}
            {e.reason ? ' · reason given' : ''}
          </span>
        ))}
        {rows.length > 0 && (
          <span className="text-[11px] leading-[15px] text-[#9ca3af] dark:text-zinc-500">
            Each entry stores the AI answer, your answer before and after, the evidence, any reason, the time and the draft it came from.
          </span>
        )}
      </div>
    </div>
  );
}

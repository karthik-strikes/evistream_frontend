import type { HomeWork, Seat, Workflow } from '@/types/home';
import { pickNextExtractionTask, sortExtractionQueue } from '@/lib/queuePick';

/** One resumable thing, whatever workflow it belongs to. */
export interface ContinueTask {
  id: string;
  wf: Workflow;
  eyebrow: string;       // "Manual extraction"
  label: string;         // "Lopez 2025"
  workflow: string;      // "Baseline characteristics"
  seat: Seat;
  saved: string;         // "3 of 5 forms saved"
  href: string;
}

const SEAT_ROLE: Record<Seat, string> = { reviewer_1: 'Reviewer 1', reviewer_2: 'Reviewer 2', adjudicator: 'Consensus reviewer' };
export const seatRole = (s: Seat) => SEAT_ROLE[s];

/**
 * Resumable tasks in a FIXED workflow order — extraction, RoB, consensus,
 * synthesis — never ranked against each other (no invented urgency score).
 * Inside extraction, the manual queue's own rule decides (lib/queuePick.ts),
 * so Home's Continue and the queue's Resume always name the same paper.
 */
export function continueTasks(work: HomeWork): ContinueTask[] {
  const formName = new Map(work.forms.map(f => [f.form_id, f.form_name]));

  const ext = work.extraction.map(t => ({
    t,
    ready: t.ready,
    active: Object.values(t.form_states).some(s => s !== 'todo'),
    open: t.status !== 'completed' && t.status !== 'skipped',
    hasNext: !!t.next_form_id,
    label: t.document_label,
  }));
  const first = pickNextExtractionTask(ext);
  const rest = sortExtractionQueue(ext.filter(e => e !== first && e.open && e.ready && e.hasNext));
  const extraction: ContinueTask[] = (first ? [first, ...rest] : rest).map(({ t, active }) => ({
    id: `ext:${t.role}:${t.document_id}`,
    wf: 'forms',
    eyebrow: 'Manual extraction',
    label: t.document_label,
    workflow: formName.get(t.next_form_id!) ?? 'Extraction',
    seat: t.role,
    saved: active ? `${t.forms_saved} of ${t.forms_total} forms saved` : 'Not started',
    href: `/manual-extraction?form=${encodeURIComponent(t.next_form_id!)}&doc=${encodeURIComponent(t.document_id)}`,
  }));

  const rob: ContinueTask[] = work.rob
    .filter(r => r.state !== 'consensus_needed')
    .map(r => ({
      id: `rob:${r.seat}:${r.document_id}:${r.target_id}`,
      wf: 'neutral',
      eyebrow: 'Risk of bias',
      label: r.study_label,
      workflow: r.target_label,
      seat: r.seat,
      saved: r.state === 'not_started' ? 'Not started' : `${r.domains_judged} of ${r.domains_total} domains judged`,
      href: `/risk-of-bias?screen=workspace&study=${encodeURIComponent(r.document_id)}&target=${encodeURIComponent(r.target_id)}`,
    }));

  const consensus: ContinueTask[] = work.consensus
    .filter(c => c.state === 'ready')
    .map(c => ({
      id: `con:${c.document_id}:${c.form_id}`,
      wf: 'consensus',
      eyebrow: 'Extraction consensus',
      label: c.document_label,
      workflow: c.form_name,
      seat: 'adjudicator',
      saved: c.readers,
      href: `/consensus?form=${encodeURIComponent(c.form_id)}&doc=${encodeURIComponent(c.document_id)}`,
    }));

  return [...extraction, ...rob, ...consensus];
}

/**
 * Bind RoB 2's signalling questions onto a form's columns.
 *
 * `robAdapter.ts` binds the *judgement* columns and deliberately excludes
 * anything matching `d1_1_...` — those are the questions, and a judgement-first
 * screen had no use for them. This file is the other half: it claims exactly
 * those columns, so a reviewer answers the tool's own questions and
 * `rob2.ts:judgeDomain` derives the label.
 *
 * Three things worth stating, because each is a decision rather than a detail:
 *
 *  - **A question with no column is not an answer that failed to load.** Forms in
 *    this corpus store five domain judgements and nothing else. Such a form
 *    keeps the judgement-first panel; it does not get a question panel with 22
 *    blanks. `usable` is what decides, and it is deliberately strict.
 *  - **Evidence is a state, not a score.** We have no calibrated per-answer
 *    probability, so a number would be invented precision — the same error as
 *    labelling a chart-read value "Inferred". What we do know is whether the
 *    model found a verbatim sentence, reasoned without one, or found nothing,
 *    and that is what `EvidenceState` carries. "Nothing found" is not a missing
 *    answer either: in RoB 2 it *is* an answer, `No information`.
 *  - **Writing an answer also writes the derived judgement.** The domain
 *    judgement columns stay populated so the grid, the exports, consensus and
 *    Synthesis keep reading what they always read. The questions are the new
 *    source of truth; the judgement column is its cache.
 */

import type { FormField } from '@/types/api';
import { cellEnvelope, cellValue, type Row } from './robForm';
import {
  ANSWER_STORED, columnPatternFor, parseAnswer, ROB2_QUESTIONS,
  type AnswerCode, type Answers, type SignallingQuestion,
} from './rob2';

/** The three spellings the corpus uses, plus `note` for a per-question comment. */
const RATIONALE = /justification|reason|support|rationale|note|comment/i;

// ── Evidence ─────────────────────────────────────────────────────────────────

/**
 * How well grounded an answer is.
 *
 * Ordered by how much a reviewer should slow down: a verbatim quote can be
 * checked in seconds, a reasoned answer needs the paper open, and `not_found`
 * means nobody has answered yet.
 */
export type EvidenceState = 'quoted' | 'inferred' | 'not_found';

export const EVIDENCE_LABEL: Record<EvidenceState, string> = {
  quoted: 'Quoted',
  inferred: 'Inferred',
  not_found: 'No evidence found',
};

export interface QuestionEvidence {
  state: EvidenceState;
  /** The verbatim sentence, when there is one. */
  quote: string;
  /** Where it came from, as text — "Page 4 · Methods". */
  locator: string;
  /** One line on why this answer follows from that evidence. */
  rationale: string;
}

export const NO_EVIDENCE: QuestionEvidence = {
  state: 'not_found', quote: '', locator: '', rationale: '',
};

/**
 * Render whatever `source_location` holds as one line.
 *
 * The shape varies by how the result was produced — a page number, a
 * `{page, section}` object, or a bare string — so this stays defensive rather
 * than asserting one.
 */
export function locatorText(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number') return `Page ${raw}`;
  if (typeof raw === 'object') {
    const o = raw as Record<string, any>;
    const parts = [
      o.page !== undefined && o.page !== null ? `Page ${o.page}` : '',
      String(o.section ?? '').trim(),
      o.paragraph !== undefined && o.paragraph !== null ? `¶${o.paragraph}` : '',
    ].filter(Boolean);
    return parts.join(' · ');
  }
  return '';
}

// ── Binding ──────────────────────────────────────────────────────────────────

export interface BoundQuestion {
  question: SignallingQuestion;
  /** Column holding the answer, or null when this form omits the question. */
  column: string | null;
  /** Optional per-question free text, when the form provides one. */
  rationaleColumn: string | null;
}

export interface SignallingBinding {
  questions: BoundQuestion[];
  /** How many of the 22 questions this form can store. */
  coverage: number;
  /**
   * True when every question RoB 2 always asks has somewhere to live.
   *
   * The conditional ones are allowed to be missing at bind time — most are
   * never routed in — and the panel reports one only if the routing actually
   * reaches it. Requiring all 22 would reject forms that work fine in practice.
   */
  usable: boolean;
  /** Unconditional questions with no column, which is why `usable` is false. */
  missing: string[];
}

/** `d1_1_allocation_sequence_random` → any sibling `d1_1_*_reason`. */
function rationaleFor(id: string, column: string, fields: FormField[]): string | null {
  const pattern = columnPatternFor(id);
  const hit = (fields ?? []).find(
    f => f?.field_name && f.field_name !== column
      && RATIONALE.test(f.field_name) && pattern.test(f.field_name),
  );
  return hit?.field_name ?? null;
}

/**
 * Claim one column per question.
 *
 * Matching is on the `d<domain>_<number>` prefix (`columnPatternFor`), never the
 * descriptive tail, because the tail is whatever the form author typed. A column
 * is claimed once so `2.1` can never also answer `2.7`.
 */
export function bindSignalling(fields: FormField[]): SignallingBinding {
  const candidates = (fields ?? [])
    .filter((f): f is FormField => !!f && !!f.field_name)
    .filter(f => !RATIONALE.test(f.field_name));
  const claimed = new Set<string>();
  const questions: BoundQuestion[] = [];

  for (const question of ROB2_QUESTIONS) {
    const pattern = columnPatternFor(question.id);
    const hit = candidates.find(c => !claimed.has(c.field_name) && pattern.test(c.field_name));
    if (hit) claimed.add(hit.field_name);
    questions.push({
      question,
      column: hit?.field_name ?? null,
      rationaleColumn: hit ? rationaleFor(question.id, hit.field_name, fields) : null,
    });
  }

  const missing = questions
    .filter(b => !b.column && !b.question.askedWhen)
    .map(b => b.question.id);

  return {
    questions,
    coverage: questions.filter(b => b.column).length,
    usable: missing.length === 0,
    missing,
  };
}

export function boundQuestion(
  binding: SignallingBinding, id: string,
): BoundQuestion | undefined {
  return binding.questions.find(b => b.question.id === id);
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** Every answer this record actually holds. Unanswered questions stay absent. */
export function readAnswers(record: Row | null, binding: SignallingBinding): Answers {
  const answers: Answers = {};
  for (const bound of binding.questions) {
    if (!bound.column) continue;
    const parsed = parseAnswer(cellValue(record ?? undefined, bound.column));
    // A stored `NA` is a stale routing artefact, not an answer — `isAsked`
    // recomputes routing every render, so reading it back would resurrect a
    // question the current answers no longer route in.
    if (parsed && parsed !== 'NA') answers[bound.question.id] = parsed;
  }
  return answers;
}

/** The grounding behind each answer, keyed by question id. */
export function readEvidence(
  record: Row | null, binding: SignallingBinding,
): Record<string, QuestionEvidence> {
  const out: Record<string, QuestionEvidence> = {};
  for (const bound of binding.questions) {
    if (!bound.column) continue;
    const envelope = cellEnvelope(record ?? undefined, bound.column);
    const answer = parseAnswer(envelope.value);
    const rationale = bound.rationaleColumn
      ? cellValue(record ?? undefined, bound.rationaleColumn)
      : '';
    const quote = envelope.source_text;

    if (!answer || answer === 'NA') {
      out[bound.question.id] = { ...NO_EVIDENCE, rationale };
      continue;
    }
    out[bound.question.id] = quote
      ? { state: 'quoted', quote, locator: locatorText(envelope.source_location), rationale }
      : { state: 'inferred', quote: '', locator: '', rationale };
  }
  return out;
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Fold answers into a record, preserving the `{value, source_text}` envelope.
 *
 * A reviewer changing an answer must not silently keep the AI's quote as if it
 * supported the new answer, so an edited cell drops the evidence it no longer
 * matches. Answers the reviewer did not touch keep theirs.
 */
export function writeAnswers(
  row: Row,
  binding: SignallingBinding,
  answers: Answers,
  rationales: Record<string, string> = {},
): Row {
  const next: Row = { ...row };

  for (const bound of binding.questions) {
    if (!bound.column) continue;
    const answer = answers[bound.question.id];
    if (!answer) continue;

    const existing = next[bound.column];
    const envelope = cellEnvelope(row, bound.column);
    const unchanged = parseAnswer(envelope.value) === answer;
    const stored = ANSWER_STORED[answer];

    next[bound.column] =
      existing && typeof existing === 'object' && !Array.isArray(existing) && 'value' in existing
        ? {
          ...existing,
          value: stored,
          // Keep the quote only while it still backs this answer.
          source_text: unchanged ? existing.source_text ?? '' : '',
          source_location: unchanged ? existing.source_location ?? null : null,
        }
        : stored;

    const rationale = rationales[bound.question.id];
    if (bound.rationaleColumn && rationale !== undefined) {
      next[bound.rationaleColumn] = rationale;
    }
  }

  return next;
}

/** Answers held by a record but absent from `answers` — i.e. cleared by routing. */
export function clearRoutedOut(
  row: Row, binding: SignallingBinding, asked: Set<string>,
): Row {
  const next: Row = { ...row };
  for (const bound of binding.questions) {
    if (!bound.column || asked.has(bound.question.id)) continue;
    const envelope = cellEnvelope(row, bound.column);
    if (envelope.value === null || envelope.value === undefined || envelope.value === '') continue;
    // Routed-out questions are stored empty rather than "NA": storing a value
    // would make a later change to the question above it leave a stale answer
    // that reads as though someone made it.
    next[bound.column] =
      typeof next[bound.column] === 'object' && next[bound.column] !== null
        && !Array.isArray(next[bound.column]) && 'value' in (next[bound.column] as object)
        ? { ...(next[bound.column] as object), value: '', source_text: '', source_location: null }
        : '';
  }
  return next;
}

export type { AnswerCode, Answers };

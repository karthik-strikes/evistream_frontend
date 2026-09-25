/**
 * RoB 2's signalling questions and the algorithm that turns them into domain
 * judgements.
 *
 * `robTools.ts` holds the *domains* of each instrument, which is all the
 * judgement-first screen ever needed. This file holds the layer underneath: the
 * 22 signalling questions of RoB 2 for a parallel-group trial (version
 * 22 August 2019, effect of assignment to intervention), their routing, and the
 * published mapping from answers to `Low risk of bias / Some concerns / High
 * risk of bias`.
 *
 * Three properties this file exists to guarantee:
 *
 *  - **The AI never picks a domain judgement.** It answers signalling questions;
 *    `judgeDomain` derives the label. A model that says "Low risk" without an
 *    answer trail is making a claim nobody can check, and RoB 2 explicitly does
 *    not work that way.
 *  - **Routing is computed, never stored as an opinion.** Whether 2.4 is asked
 *    depends on the answer to 2.3. Storing "Not applicable" as if it were an
 *    answer means a later change to 2.3 leaves a stale NA behind, so the screen
 *    recomputes what is asked every render and greys out the rest.
 *  - **An unanswered question blocks the judgement.** `judgeDomain` returns null
 *    rather than guessing, because a half-answered domain that displayed as
 *    "Low" would be a claim nobody made.
 *
 * Question wording is the tool's own, matching `zforms/rob2/rob2_parallel_trial.json`.
 */

import type { Severity } from './robForm';

// Re-exported so the screens have ONE place to import the vocabulary of a
// risk-of-bias judgement from, next to the algorithm that produces it.
export type { Severity };

// ── The answer vocabulary ────────────────────────────────────────────────────

/** RoB 2's five responses, plus the routed-out state. */
export type AnswerCode = 'Y' | 'PY' | 'PN' | 'N' | 'NI' | 'NA';

/** Short labels for the answer buttons — the full strings do not fit a chip. */
export const ANSWER_LABEL: Record<AnswerCode, string> = {
  Y: 'Yes',
  PY: 'Probably yes',
  PN: 'Probably no',
  N: 'No',
  NI: 'No information',
  NA: 'Not applicable',
};

/** Exactly how each answer is stored in a form, so a save round-trips. */
export const ANSWER_STORED: Record<AnswerCode, string> = ANSWER_LABEL;

/** The four offered on every question, in the tool's own order. */
export const ANSWER_ORDER: AnswerCode[] = ['Y', 'PY', 'PN', 'N', 'NI'];

/**
 * Read whatever a form stored as one of the five responses.
 *
 * Deliberately strict about the hedges: `probably yes` must not collapse into
 * `Y`, because the whole point of RoB 2's five-point scale is that a hedge is a
 * different answer, and several domains treat `NI` differently again.
 */
export function parseAnswer(raw: unknown): AnswerCode | null {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/^(na|n\/a|not[\s_-]?applicable)$/.test(text)) return 'NA';
  if (/^(ni|no[\s_-]?information|unknown|unclear|nr|not[\s_-]?reported)$/.test(text)) return 'NI';
  if (/^(py|probably[\s_-]?yes|possibly[\s_-]?yes)$/.test(text)) return 'PY';
  if (/^(pn|probably[\s_-]?no|possibly[\s_-]?no)$/.test(text)) return 'PN';
  if (/^(y|yes|true)$/.test(text)) return 'Y';
  if (/^(n|no|false)$/.test(text)) return 'N';
  return null;
}

/** Answers this map to "the thing asked about happened". */
export function isYes(a: AnswerCode | null | undefined): boolean {
  return a === 'Y' || a === 'PY';
}

/** Answers this map to "it did not". `NI` is neither — that is the point. */
export function isNo(a: AnswerCode | null | undefined): boolean {
  return a === 'N' || a === 'PN';
}

// ── The questions ────────────────────────────────────────────────────────────

export type Answers = Partial<Record<string, AnswerCode>>;

export interface SignallingQuestion {
  /** `1.1` … `5.3`, as the tool numbers them. */
  id: string;
  /** 0-based index of the domain this belongs to. */
  domain: number;
  /** The question, in the tool's own wording. */
  text: string;
  /**
   * Which answer points toward *higher* risk. Half of RoB 2's questions are
   * phrased so that "Yes" is the bad answer ("Was the method inappropriate?"),
   * so a screen that colours every Yes green is actively misleading.
   */
  higherRiskWhen: 'yes' | 'no';
  /**
   * Whether this question is asked at all, given the answers before it. Absent
   * on the questions that are always asked.
   */
  askedWhen?: (a: Answers) => boolean;
  /** Plain-English statement of the routing rule, shown when it routes out. */
  routingNote?: string;
  /** 3.2 is the one question RoB 2 gives no "No information" option. */
  noInformationOption?: false;
}

export interface SignallingDomain {
  /** `D1` … `D5`. */
  code: string;
  /** The domain name, as RoB 2 publishes it. */
  name: string;
  /** One-line statement of what the domain is about. */
  about: string;
  questions: SignallingQuestion[];
}

export const ROB2_SIGNALLING: SignallingDomain[] = [
  {
    code: 'D1',
    name: 'Randomization process',
    about: 'Bias arising from the randomization process.',
    questions: [
      {
        id: '1.1', domain: 0, higherRiskWhen: 'no',
        text: 'Was the allocation sequence random?',
      },
      {
        id: '1.2', domain: 0, higherRiskWhen: 'no',
        text: 'Was the allocation sequence concealed until participants were enrolled and '
          + 'assigned to interventions?',
      },
      {
        id: '1.3', domain: 0, higherRiskWhen: 'yes',
        text: 'Did baseline differences between intervention groups suggest a problem with the '
          + 'randomization process?',
      },
    ],
  },
  {
    code: 'D2',
    name: 'Deviations from intended interventions',
    about: 'Bias due to deviations from intended interventions — effect of assignment.',
    questions: [
      {
        id: '2.1', domain: 1, higherRiskWhen: 'yes',
        text: 'Were participants aware of their assigned intervention during the trial?',
      },
      {
        id: '2.2', domain: 1, higherRiskWhen: 'yes',
        text: 'Were carers and people delivering the interventions aware of participants’ '
          + 'assigned intervention during the trial?',
      },
      {
        id: '2.3', domain: 1, higherRiskWhen: 'yes',
        text: 'Were there deviations from the intended intervention that arose because of the '
          + 'trial context?',
        askedWhen: a => notNo(a['2.1']) || notNo(a['2.2']),
        routingNote: 'Asked only when participants or trial personnel were aware of the assigned '
          + 'intervention.',
      },
      {
        id: '2.4', domain: 1, higherRiskWhen: 'yes',
        text: 'Were these deviations likely to have affected the outcome?',
        askedWhen: a => isYes(a['2.3']),
        routingNote: 'Asked only when deviations arose because of the trial context (2.3).',
      },
      {
        id: '2.5', domain: 1, higherRiskWhen: 'no',
        text: 'Were these deviations from intended intervention balanced between groups?',
        askedWhen: a => notNo(a['2.4']),
        routingNote: 'Asked only when deviations were likely to have affected the outcome (2.4).',
      },
      {
        id: '2.6', domain: 1, higherRiskWhen: 'no',
        text: 'Was an appropriate analysis used to estimate the effect of assignment to '
          + 'intervention?',
      },
      {
        id: '2.7', domain: 1, higherRiskWhen: 'yes',
        text: 'Was there potential for a substantial impact (on the result) of the failure to '
          + 'analyse participants in the group to which they were randomized?',
        askedWhen: a => notYes(a['2.6']),
        routingNote: 'Asked only when the analysis was not clearly an appropriate '
          + 'intention-to-treat analysis (2.6).',
      },
    ],
  },
  {
    code: 'D3',
    name: 'Missing outcome data',
    about: 'Bias due to missing outcome data, for this result.',
    questions: [
      {
        id: '3.1', domain: 2, higherRiskWhen: 'no',
        text: 'Were data for this outcome available for all, or nearly all, participants '
          + 'randomized?',
      },
      {
        id: '3.2', domain: 2, higherRiskWhen: 'no', noInformationOption: false,
        text: 'Is there evidence that the result was not biased by missing outcome data?',
        askedWhen: a => notYes(a['3.1']),
        routingNote: 'Asked only when outcome data were not available for nearly all '
          + 'participants (3.1).',
      },
      {
        id: '3.3', domain: 2, higherRiskWhen: 'yes',
        text: 'Could missingness in the outcome depend on its true value?',
        askedWhen: a => isNo(a['3.2']),
        routingNote: 'Asked only when there is no evidence the result is unbiased by '
          + 'missingness (3.2).',
      },
      {
        id: '3.4', domain: 2, higherRiskWhen: 'yes',
        text: 'Is it likely that missingness in the outcome depended on its true value?',
        askedWhen: a => notNo(a['3.3']),
        routingNote: 'Asked only when missingness could depend on the true outcome value (3.3).',
      },
    ],
  },
  {
    code: 'D4',
    name: 'Measurement of the outcome',
    about: 'Bias in measurement of the outcome.',
    questions: [
      {
        id: '4.1', domain: 3, higherRiskWhen: 'yes',
        text: 'Was the method of measuring the outcome inappropriate?',
      },
      {
        id: '4.2', domain: 3, higherRiskWhen: 'yes',
        text: 'Could measurement or ascertainment of the outcome have differed between '
          + 'intervention groups?',
      },
      {
        id: '4.3', domain: 3, higherRiskWhen: 'yes',
        text: 'Were outcome assessors aware of the intervention received by study participants?',
        askedWhen: a => notYes(a['4.1']) && notYes(a['4.2']),
        routingNote: 'Asked only when the measurement method was appropriate and the same in '
          + 'both groups (4.1, 4.2).',
      },
      {
        id: '4.4', domain: 3, higherRiskWhen: 'yes',
        text: 'Could assessment of the outcome have been influenced by knowledge of intervention '
          + 'received?',
        askedWhen: a => notNo(a['4.3']),
        routingNote: 'Asked only when outcome assessors were aware of the assigned '
          + 'intervention (4.3).',
      },
      {
        id: '4.5', domain: 3, higherRiskWhen: 'yes',
        text: 'Is it likely that assessment of the outcome was influenced by knowledge of '
          + 'intervention received?',
        askedWhen: a => notNo(a['4.4']),
        routingNote: 'Asked only when assessment could have been influenced by that '
          + 'knowledge (4.4).',
      },
    ],
  },
  {
    code: 'D5',
    name: 'Selection of the reported result',
    about: 'Bias in selection of the reported result, for this result.',
    questions: [
      {
        id: '5.1', domain: 4, higherRiskWhen: 'no',
        text: 'Were the data that produced this result analysed in accordance with a '
          + 'pre-specified analysis plan that was finalized before unblinded outcome data were '
          + 'available for analysis?',
      },
      {
        id: '5.2', domain: 4, higherRiskWhen: 'yes',
        text: 'Is the numerical result being assessed likely to have been selected, on the basis '
          + 'of the results, from multiple eligible outcome measurements (e.g. scales, '
          + 'definitions, time points) within the outcome domain?',
      },
      {
        id: '5.3', domain: 4, higherRiskWhen: 'yes',
        text: 'Is the numerical result being assessed likely to have been selected, on the basis '
          + 'of the results, from multiple eligible analyses of the data?',
      },
    ],
  },
];

export const ROB2_QUESTIONS: SignallingQuestion[] = ROB2_SIGNALLING.flatMap(d => d.questions);

/** `notNo` and `notYes` are the tool's own routing phrasing — "Y/PY/NI". */
function notNo(a: AnswerCode | undefined): boolean {
  return a === 'Y' || a === 'PY' || a === 'NI';
}
function notYes(a: AnswerCode | undefined): boolean {
  return a === 'N' || a === 'PN' || a === 'NI';
}

/**
 * Whether a question is asked, given the answers before it.
 *
 * A routed-out question is asked again the moment its predecessor changes, so
 * this is evaluated live rather than read from storage.
 */
/**
 * The whole routing map at once: asked / waiting / skipped, per question.
 *
 * Computed together rather than per question, because a child's route depends
 * on whether its PARENT was asked, not just on the parent's stored answer. A
 * per-question predicate cannot see that, and the consequence is real: with
 * 3.1 = Yes the tool never asks 3.2, but a stale "3.2 = No" left in the record
 * made 3.3 route back in and the domain read as unjudgeable. Routed-out answers
 * are cleared on write, so this mostly bit records written by something else —
 * which is exactly the case a shared engine has to survive.
 *
 * `waiting` is the third state: a question BEFORE this one is unanswered, so
 * nothing has ruled this one out yet. It is not "not applicable", and drawing
 * it as such tells a reviewer a question is dismissed when it is about to
 * reappear.
 *
 * Conditions are transcribed from the RoB 2 guidance of 22 August 2019, tables
 * 6, 10 and 12.
 */
export type RouteState = 'asked' | 'waiting' | 'skipped';

export function routeAll(answers: Answers): Record<string, RouteState> {
  const v = (id: string) => answers[id];
  const state: Record<string, RouteState> = {};
  for (const question of ROB2_QUESTIONS) state[question.id] = 'asked';

  const conditional = (id: string, parents: string[], reached: () => boolean) => {
    const pending = parents.some(
      p => state[p] === 'waiting' || (state[p] === 'asked' && !v(p)));
    state[id] = pending ? 'waiting' : reached() ? 'asked' : 'skipped';
  };

  // D2 — Table 6. 2.3 only where somebody was aware; 2.4 only on a deviation;
  // 2.5 only where that deviation could have affected the outcome.
  conditional('2.3', ['2.1', '2.2'], () => notNo(v('2.1')) || notNo(v('2.2')));
  conditional('2.4', ['2.3'], () => state['2.3'] === 'asked' && isYes(v('2.3')));
  conditional('2.5', ['2.4'], () => state['2.4'] === 'asked' && notNo(v('2.4')));
  conditional('2.7', ['2.6'], () => notYes(v('2.6')));

  // D3 — Table 10.
  conditional('3.2', ['3.1'], () => notYes(v('3.1')));
  conditional('3.3', ['3.2'], () => state['3.2'] === 'asked' && isNo(v('3.2')));
  conditional('3.4', ['3.3'], () => state['3.3'] === 'asked' && notNo(v('3.3')));

  // D4 — Table 12.
  conditional('4.3', ['4.1', '4.2'], () => notYes(v('4.1')) && notYes(v('4.2')));
  conditional('4.4', ['4.3'], () => state['4.3'] === 'asked' && notNo(v('4.3')));
  conditional('4.5', ['4.4'], () => state['4.4'] === 'asked' && notNo(v('4.4')));

  return state;
}

export function isAsked(q: SignallingQuestion, answers: Answers): boolean {
  return routeAll(answers)[q.id] === 'asked';
}

/**
 * What this domain still needs from the reviewer, right now.
 *
 * Only questions being ASKED and left blank — not the ones waiting behind them.
 * A reviewer looking at D3 with 3.1 unanswered can act on 3.1 and nothing else;
 * listing "waiting on 3.1, 3.2, 3.3, 3.4" is four times the noise and three
 * items they cannot do anything about.
 *
 * Judging is gated more strictly — see `canJudge` — because a domain with
 * questions still pending is not judgeable even though there is nothing to
 * chase yet.
 */
export function unansweredIn(domainIndex: number, answers: Answers): string[] {
  const route = routeAll(answers);
  return ROB2_SIGNALLING[domainIndex].questions
    .filter(q => route[q.id] === 'asked' && !answers[q.id])
    .map(q => q.id);
}

/** Whether every question this domain will ask has been answered. */
export function canJudge(domainIndex: number, answers: Answers): boolean {
  const route = routeAll(answers);
  return ROB2_SIGNALLING[domainIndex].questions.every(
    q => route[q.id] === 'skipped'
      || (route[q.id] === 'asked' && !!answers[q.id]));
}

// ── The algorithm ────────────────────────────────────────────────────────────

const WORST: Record<Severity, number> = { none: -1, low: 0, some: 1, high: 2 };

function worse(a: Severity, b: Severity): Severity {
  return WORST[a] >= WORST[b] ? a : b;
}

/**
 * The published RoB 2 mapping from signalling answers to a domain judgement.
 *
 * Returns null when a question the routing actually asks is still unanswered.
 * Each branch below is the tool's own narrative rule, in the tool's order, so a
 * reviewer can check the code against the guidance line by line.
 */
/**
 * The published RoB 2 mapping from signalling answers to a domain judgement.
 *
 * Transcribed from the guidance of 22 August 2019 — tables 4, 6, 10, 12 and 14
 * — row by row, because the rules are per-domain and asymmetric and no
 * shorthand reproduces them. An earlier version of this function was written
 * from the *shape* of the rules rather than the tables, and disagreed with the
 * instrument on thousands of answer combinations: it made D1 "high" on baseline
 * imbalance the table calls "some concerns", read 2.4 = No as clearing D2 when
 * the table says some concerns, and treated "no information" on 2.5, 2.7 and
 * 4.5 as milder than the table does. Every rule below now cites its row.
 *
 * Returns `null` when a question the routing actually asks is still unanswered
 * — never a guess. A half-answered domain displaying as "Low" is a claim nobody
 * made.
 */
export function judgeDomain(domainIndex: number, answers: Answers): Severity | null {
  if (!canJudge(domainIndex, answers)) return null;
  const a = (id: string) => answers[id];
  const route = routeAll(answers);

  switch (domainIndex) {
    // ── D1 · Table 4 ──────────────────────────────────────────────────────
    //   any · 1.2 N/PN · any                        → High
    //   any · 1.2 NI   · 1.3 Y/PY                   → High
    //   1.1 Y/PY/NI · 1.2 Y/PY · 1.3 NI/N/PN        → Low
    //   everything else                             → Some concerns
    // Note what is NOT here: 1.3 = Y/PY alongside a concealed sequence is
    // "some concerns", not high. The table says so explicitly, and remarks that
    // it deserves investigation rather than an automatic verdict.
    case 0: {
      if (isNo(a('1.2'))) return 'high';
      if (a('1.2') === 'NI' && isYes(a('1.3'))) return 'high';
      if (notNo(a('1.1')) && isYes(a('1.2')) && notYes(a('1.3'))) return 'low';
      return 'some';
    }

    // ── D2 · Table 6 · the worse of two independent parts ─────────────────
    case 1: {
      // Part 1 — 2.1 to 2.5.
      //   both 2.1 & 2.2 N/PN (so 2.3 unasked)      → Low
      //   2.3 N/PN                                  → Low
      //   2.3 NI                                    → Some concerns
      //   2.3 Y/PY · 2.4 N/PN                       → Some concerns
      //   2.3 Y/PY · 2.4 Y/PY/NI · 2.5 Y/PY         → Some concerns
      //   2.3 Y/PY · 2.4 Y/PY/NI · 2.5 N/PN/NI      → High
      let deviations: Severity = 'low';
      if (route['2.3'] === 'asked') {
        if (a('2.3') === 'NI') deviations = 'some';
        else if (isYes(a('2.3'))) {
          deviations = isNo(a('2.4')) || isYes(a('2.5')) ? 'some' : 'high';
        }
      }

      // Part 2 — 2.6 and 2.7.
      //   2.6 Y/PY                                  → Low
      //   2.6 N/PN/NI · 2.7 N/PN                    → Some concerns
      //   2.6 N/PN/NI · 2.7 Y/PY/NI                 → High
      const analysis: Severity = isYes(a('2.6')) ? 'low'
        : isNo(a('2.7')) ? 'some' : 'high';

      return worse(deviations, analysis);
    }

    // ── D3 · Table 10 ─────────────────────────────────────────────────────
    //   3.1 Y/PY                                    → Low
    //   3.2 Y/PY                                    → Low
    //   3.3 N/PN                                    → Low
    //   3.4 N/PN                                    → Some concerns
    //   3.4 Y/PY/NI                                 → High
    case 2: {
      if (isYes(a('3.1')) || isYes(a('3.2')) || isNo(a('3.3'))) return 'low';
      return isNo(a('3.4')) ? 'some' : 'high';
    }

    // ── D4 · Table 12 ─────────────────────────────────────────────────────
    //   4.1 Y/PY  or  4.2 Y/PY                      → High
    //   4.3 N/PN  or  4.4 N/PN                      → Low, but Some concerns
    //                                                 when 4.2 is NI
    //   4.5 N/PN                                    → Some concerns
    //   4.5 Y/PY/NI                                 → High
    case 3: {
      if (isYes(a('4.1')) || isYes(a('4.2'))) return 'high';
      if (isNo(a('4.3')) || isNo(a('4.4'))) {
        return a('4.2') === 'NI' ? 'some' : 'low';
      }
      return isNo(a('4.5')) ? 'some' : 'high';
    }

    // ── D5 · Table 14 ─────────────────────────────────────────────────────
    //   5.2 Y/PY  or  5.3 Y/PY                      → High
    //   5.1 Y/PY · 5.2 N/PN · 5.3 N/PN              → Low
    //   everything else                             → Some concerns
    case 4: {
      if (isYes(a('5.2')) || isYes(a('5.3'))) return 'high';
      return isYes(a('5.1')) && isNo(a('5.2')) && isNo(a('5.3')) ? 'low' : 'some';
    }

    default:
      return null;
  }
}

export interface OverallJudgement {
  severity: Severity | null;
  /**
   * True when several domains are "some concerns" and none is high. RoB 2 says
   * that *may* warrant an overall "High risk of bias", but only a person can
   * decide whether it "substantially lowers confidence" — so the screen raises
   * the question instead of answering it.
   */
  considerHigh: boolean;
}

/** Overall = the worst domain, with the multiple-concerns clause surfaced. */
export function judgeOverall(domains: (Severity | null)[]): OverallJudgement {
  if (domains.length === 0 || domains.some(d => d === null)) {
    return { severity: null, considerHigh: false };
  }
  const judged = domains as Severity[];
  if (judged.includes('high')) return { severity: 'high', considerHigh: false };
  const concerns = judged.filter(d => d === 'some').length;
  if (concerns === 0) return { severity: 'low', considerHigh: false };
  return { severity: 'some', considerHigh: concerns > 1 };
}

// ── Recognising the questions in a form ──────────────────────────────────────

/**
 * Match a signalling question onto a form column.
 *
 * Keyed on the `d<domain>_<number>` prefix rather than the descriptive tail,
 * because the tail is whatever the form author typed —
 * `d2_6_appropriate_analysis` and `d2_6_itt` are the same question.
 */
export function columnPatternFor(id: string): RegExp {
  const [domain, number] = id.split('.');
  return new RegExp(`^(d|domain)[_\\s]?${domain}[_\\s.]?${number}(?![0-9])`, 'i');
}

/** Where a domain's judgement and its free-text support are stored. */
export function domainColumnPatterns(domainIndex: number): { judgment: RegExp; support: RegExp } {
  const n = domainIndex + 1;
  return {
    judgment: new RegExp(`^(domain|d)[_\\s]?${n}[_\\s]?(risk[_\\s]?of[_\\s]?bias[_\\s]?)?judge?ment`, 'i'),
    support: new RegExp(`^(domain|d)[_\\s]?${n}[_\\s]?(support|justification|reason|rationale)`, 'i'),
  };
}

// ── Effect of adhering to intervention (Box 7 · Table 8) ─────────────────────
//
// Everything above is the effect of ASSIGNMENT — the ITT pathway, and the only
// one the page used to offer. The review protocol can now pre-specify the effect
// of ADHERING instead (or both, chosen per result). Only Domain 2 changes: its
// questions, their routing and its algorithm. D1 and D3–D5 are identical.
//
// The adhering questions reuse the ids 2.1–2.6 and therefore the same storage
// columns. That is safe only because every assessment stamps which effect it
// was made under (`rob_workflow.effect`), and every reader — this file, the
// Python mirror, consensus and export — routes on that stamp. Reading adhering
// answers through the assignment tree would be silently wrong: 2.3 asks a
// different question on each pathway.

export type EffectOfInterest = 'assignment' | 'adherence';

/**
 * The deviation types a review can pre-specify for the adhering pathway. Each
 * enables one "[If applicable]" question: 2.3, 2.4 and 2.5 respectively.
 */
export type DeviationType = 'nonprotocol' | 'implementation' | 'nonadherence';

export const ALL_DEVIATION_TYPES: DeviationType[] = ['nonprotocol', 'implementation', 'nonadherence'];

export const DEVIATION_LABEL: Record<DeviationType, string> = {
  nonprotocol: 'Occurrence of non-protocol interventions',
  implementation: 'Failures in implementing the intervention that could have affected the outcome',
  nonadherence: 'Non-adherence to their assigned intervention by trial participants',
};

export interface PathwayOptions {
  effect?: EffectOfInterest;
  /** Adhering only. Defaults to all three. */
  deviations?: DeviationType[];
}

export const ROB2_D2_ADHERING: SignallingDomain = {
  code: 'D2',
  name: 'Deviations from intended interventions',
  about: 'Bias due to deviations from intended interventions — effect of adhering.',
  questions: [
    {
      id: '2.1', domain: 1, higherRiskWhen: 'yes',
      text: 'Were participants aware of their assigned intervention during the trial?',
    },
    {
      id: '2.2', domain: 1, higherRiskWhen: 'yes',
      text: 'Were carers and people delivering the interventions aware of participants’ '
        + 'assigned intervention during the trial?',
    },
    {
      id: '2.3', domain: 1, higherRiskWhen: 'no',
      text: 'Were important non-protocol interventions balanced across intervention groups?',
      askedWhen: a => notNo(a['2.1']) || notNo(a['2.2']),
      routingNote: 'Asked only when participants or trial personnel were aware of the assigned '
        + 'intervention, and the protocol addresses non-protocol interventions.',
    },
    {
      id: '2.4', domain: 1, higherRiskWhen: 'yes',
      text: 'Were there failures in implementing the intervention that could have affected the '
        + 'outcome?',
      routingNote: 'Asked only when the protocol addresses failures in implementing the '
        + 'intervention.',
    },
    {
      id: '2.5', domain: 1, higherRiskWhen: 'yes',
      text: 'Was there non-adherence to the assigned intervention regimen that could have '
        + 'affected participants’ outcomes?',
      routingNote: 'Asked only when the protocol addresses non-adherence.',
    },
    {
      id: '2.6', domain: 1, higherRiskWhen: 'no',
      text: 'Was an appropriate analysis used to estimate the effect of adhering to '
        + 'intervention?',
      askedWhen: () => true,
      routingNote: 'Asked only when non-protocol interventions were unbalanced or unreported '
        + '(2.3), or there were implementation failures or non-adherence (2.4, 2.5).',
    },
  ],
};

/** The five domains as asked under this effect. D2 swaps; the rest never do. */
export function signallingFor(effect: EffectOfInterest = 'assignment'): SignallingDomain[] {
  if (effect !== 'adherence') return ROB2_SIGNALLING;
  return ROB2_SIGNALLING.map((d, i) => (i === 1 ? ROB2_D2_ADHERING : d));
}

/** Every question asked under this effect, in order. */
export function questionsFor(effect: EffectOfInterest = 'assignment'): SignallingQuestion[] {
  return signallingFor(effect).flatMap(d => d.questions);
}

function deviationsOf(opts?: PathwayOptions): Set<DeviationType> {
  const list = opts?.deviations && opts.deviations.length ? opts.deviations : ALL_DEVIATION_TYPES;
  return new Set(list);
}

/**
 * Routing under either effect. Assignment is exactly `routeAll`; adhering
 * replaces D2's routing per Box 7 — 2.3/2.4/2.5 only where the protocol
 * addresses that deviation type, 2.6 only where a deviation is present.
 */
export function routeAllFor(answers: Answers, opts?: PathwayOptions): Record<string, RouteState> {
  const base = routeAll(answers);
  if (opts?.effect !== 'adherence') return base;

  const v = (id: string) => answers[id];
  const devs = deviationsOf(opts);
  const state: Record<string, RouteState> = { ...base };
  const unresolved = (id: string) =>
    state[id] === 'waiting' || (state[id] === 'asked' && !v(id));

  state['2.1'] = 'asked';
  state['2.2'] = 'asked';
  state['2.7'] = 'skipped';

  if (!devs.has('nonprotocol')) state['2.3'] = 'skipped';
  else if (unresolved('2.1') || unresolved('2.2')) state['2.3'] = 'waiting';
  else state['2.3'] = notNo(v('2.1')) || notNo(v('2.2')) ? 'asked' : 'skipped';

  state['2.4'] = devs.has('implementation') ? 'asked' : 'skipped';
  state['2.5'] = devs.has('nonadherence') ? 'asked' : 'skipped';

  const parents = ['2.3', '2.4', '2.5'];
  if (parents.some(unresolved)) state['2.6'] = 'waiting';
  else state['2.6'] = adheringDeviation(answers, state) ? 'asked' : 'skipped';

  return state;
}

/** Table 8's left-hand side: is there a deviation the analysis must address? */
function adheringDeviation(answers: Answers, route: Record<string, RouteState>): boolean {
  const v = (id: string) => answers[id];
  return (route['2.3'] === 'asked' && notYes(v('2.3')))
    || (route['2.4'] === 'asked' && notNo(v('2.4')))
    || (route['2.5'] === 'asked' && notNo(v('2.5')));
}

export function unansweredInFor(domainIndex: number, answers: Answers, opts?: PathwayOptions): string[] {
  const route = routeAllFor(answers, opts);
  return signallingFor(opts?.effect)[domainIndex].questions
    .filter(q => route[q.id] === 'asked' && !answers[q.id])
    .map(q => q.id);
}

export function canJudgeFor(domainIndex: number, answers: Answers, opts?: PathwayOptions): boolean {
  const route = routeAllFor(answers, opts);
  return signallingFor(opts?.effect)[domainIndex].questions.every(
    q => route[q.id] === 'skipped' || (route[q.id] === 'asked' && !!answers[q.id]));
}

/** `judgeDomain`, under either effect. Only D2 differs. */
export function judgeDomainFor(
  domainIndex: number, answers: Answers, opts?: PathwayOptions,
): Severity | null {
  if (opts?.effect !== 'adherence' || domainIndex !== 1) return judgeDomain(domainIndex, answers);
  if (!canJudgeFor(1, answers, opts)) return null;
  // ── D2 · adhering · Table 8 ──────────────────────────────────────────────
  //   no deviation (2.3 Y/PY or NA, 2.4 & 2.5 N/PN or NA)   → Low
  //   deviation · 2.6 Y/PY                                  → Some concerns
  //   deviation · 2.6 N/PN/NI                               → High
  const route = routeAllFor(answers, opts);
  if (!adheringDeviation(answers, route)) return 'low';
  return isYes(answers['2.6']) ? 'some' : 'high';
}

export interface DomainSuggestion {
  severity: Severity | null;
  /** One sentence naming the questions that decided it. */
  reason: string;
}

/**
 * The suggested judgement plus WHY, in the tool's terms.
 *
 * The severity always comes from `judgeDomainFor`; the sentence only describes
 * which row of the table fired. It never decides anything, so a wording slip
 * here cannot change a judgement.
 */
export function suggestDomain(
  domainIndex: number, answers: Answers, opts?: PathwayOptions,
): DomainSuggestion {
  const missing = unansweredInFor(domainIndex, answers, opts);
  const severity = judgeDomainFor(domainIndex, answers, opts);
  if (severity === null) {
    return {
      severity,
      reason: missing.length
        ? `${missing.length} question${missing.length === 1 ? '' : 's'} unanswered (${missing.join(', ')})`
        : 'Waiting on earlier answers',
    };
  }
  const a = (id: string) => answers[id];
  const route = routeAllFor(answers, opts);
  let reason = '';
  switch (domainIndex) {
    case 0:
      if (isNo(a('1.2'))) reason = 'Allocation sequence not concealed (1.2)';
      else if (a('1.2') === 'NI') {
        reason = isYes(a('1.3'))
          ? 'Concealment not reported and baseline differences suggest a problem (1.2, 1.3)'
          : 'Allocation concealment not reported (1.2)';
      } else if (isYes(a('1.3'))) {
        reason = 'Baseline differences suggest a problem despite concealment (1.3)';
      } else if (isNo(a('1.1'))) reason = 'Sequence not random, though allocation was concealed (1.1)';
      else reason = 'Allocation concealed, no baseline differences suggesting a problem';
      break;
    case 1:
      if (opts?.effect === 'adherence') {
        if (severity === 'low') {
          reason = notNo(a('2.1')) || notNo(a('2.2'))
            ? 'Aware of assignment, but no unbalanced non-protocol interventions, implementation failures or non-adherence'
            : 'Participants and personnel unaware; no implementation failures or non-adherence';
        } else {
          const why = route['2.3'] === 'asked' && notYes(a('2.3'))
            ? 'non-protocol interventions unbalanced or unreported (2.3)'
            : route['2.4'] === 'asked' && notNo(a('2.4'))
              ? 'implementation failures (2.4)' : 'non-adherence (2.5)';
          reason = severity === 'some'
            ? `Deviation present (${why}) but analysis appropriate (2.6)`
            : `Deviation present (${why}) and analysis not appropriate (2.6)`;
        }
      } else {
        let part1 = 'participants and personnel unaware';
        let part1Sev: Severity = 'low';
        if (route['2.3'] === 'asked') {
          if (isNo(a('2.3'))) part1 = 'no deviations arising from the trial context (2.3)';
          else if (a('2.3') === 'NI') { part1 = 'deviations not reported (2.3)'; part1Sev = 'some'; }
          else if (isNo(a('2.4'))) { part1 = 'deviations unlikely to affect the outcome (2.4)'; part1Sev = 'some'; }
          else if (isYes(a('2.5'))) { part1 = 'deviations balanced between groups (2.5)'; part1Sev = 'some'; }
          else { part1 = 'deviations affected the outcome and were not balanced (2.4, 2.5)'; part1Sev = 'high'; }
        }
        const part2Sev: Severity = isYes(a('2.6')) ? 'low' : isNo(a('2.7')) ? 'some' : 'high';
        const part2 = part2Sev === 'low' ? 'appropriate analysis (2.6)'
          : part2Sev === 'some' ? 'analysis not appropriate, little potential impact (2.7)'
            : 'analysis not appropriate, substantial potential impact (2.7)';
        if (severity === 'low') reason = `Both parts low: ${part1}; ${part2}`;
        else reason = `Part ${WORST[part1Sev] >= WORST[part2Sev] ? `1: ${part1}` : `2: ${part2}`}`;
      }
      break;
    case 2:
      if (isYes(a('3.1'))) reason = 'Data available for all or nearly all participants (3.1)';
      else if (isYes(a('3.2'))) reason = 'Evidence the result was not biased by missing data (3.2)';
      else if (isNo(a('3.3'))) reason = 'Missingness could not depend on the true value (3.3)';
      else reason = severity === 'some'
        ? 'Missingness could, but is unlikely to, depend on the true value (3.4)'
        : 'Missingness likely depended on the true value (3.4)';
      break;
    case 3:
      if (isYes(a('4.1'))) reason = 'Inappropriate measurement method (4.1)';
      else if (isYes(a('4.2'))) reason = 'Measurement could have differed between groups (4.2)';
      else if (isNo(a('4.3')) || isNo(a('4.4'))) {
        const what = isNo(a('4.3')) ? 'Outcome assessors unaware of the intervention (4.3)'
          : 'Assessment could not have been influenced by knowledge of the intervention (4.4)';
        reason = a('4.2') === 'NI' ? `${what}, but differences in ascertainment not reported (4.2)` : what;
      } else reason = severity === 'some'
        ? 'Assessment could have been, but unlikely was, influenced (4.5)'
        : 'Assessment likely influenced by knowledge of the intervention (4.5)';
      break;
    case 4:
      if (severity === 'high') {
        reason = `Result likely selected from multiple ${isYes(a('5.2')) ? 'outcome measurements (5.2)' : 'analyses (5.3)'}`;
      } else if (severity === 'low') reason = 'Pre-specified plan followed; no selection of the reported result';
      else if (a('5.2') === 'NI' || a('5.3') === 'NI') reason = 'Insufficient information on multiple measurements or analyses (5.2, 5.3)';
      else reason = 'Not analysed to a pre-specified plan, or no plan available (5.1)';
      break;
  }
  return { severity, reason };
}

/** Table 1's reason for the overall suggestion. */
export function suggestOverall(domains: (Severity | null)[]): DomainSuggestion & { considerHigh: boolean } {
  const out = judgeOverall(domains);
  if (out.severity === null) {
    const n = domains.filter(d => d === null).length;
    return { ...out, reason: `${n} domain${n === 1 ? '' : 's'} not judged yet` };
  }
  const reason = out.severity === 'high'
    ? `High risk of bias in ${domains.map((d, i) => (d === 'high' ? `D${i + 1}` : '')).filter(Boolean).join(', ')}`
    : out.severity === 'low' ? 'Low risk of bias in all five domains'
      : out.considerHigh
        ? 'Some concerns in several domains. RoB 2 allows High if they substantially lower confidence in the result'
        : `Some concerns in ${domains.map((d, i) => (d === 'some' ? `D${i + 1}` : '')).filter(Boolean).join(', ')}`;
  return { ...out, reason };
}

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
          + 'of the results, from multiple eligible outcome measurements within the outcome '
          + 'domain?',
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
export function isAsked(q: SignallingQuestion, answers: Answers): boolean {
  return q.askedWhen ? q.askedWhen(answers) : true;
}

/** The answers a domain still needs before it can be judged. */
export function unansweredIn(domainIndex: number, answers: Answers): string[] {
  return ROB2_SIGNALLING[domainIndex].questions
    .filter(q => isAsked(q, answers) && !answers[q.id])
    .map(q => q.id);
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
export function judgeDomain(domainIndex: number, answers: Answers): Severity | null {
  if (unansweredIn(domainIndex, answers).length > 0) return null;
  const a = (id: string) => answers[id];

  switch (domainIndex) {
    // D1 — high whenever baseline differences suggest a randomization failure,
    // or the sequence was not concealed; low only when all three line up.
    case 0: {
      if (isYes(a('1.3'))) return 'high';
      if (isNo(a('1.2'))) return 'high';
      if (isYes(a('1.1')) && isYes(a('1.2')) && isNo(a('1.3'))) return 'low';
      return 'some';
    }

    // D2 — two independent parts: what happened during the trial (2.1–2.5) and
    // whether the analysis estimated the effect of *assignment* (2.6–2.7). The
    // domain takes the worse of the two.
    case 1: {
      let deviations: Severity;
      if (isNo(a('2.1')) && isNo(a('2.2'))) deviations = 'low';
      else if (isNo(a('2.3'))) deviations = 'low';
      else if (isNo(a('2.4'))) deviations = 'low';
      else if (isNo(a('2.5'))) deviations = 'high';
      else deviations = 'some';

      let analysis: Severity;
      if (isYes(a('2.6'))) analysis = 'low';
      else if (isNo(a('2.7'))) analysis = 'low';
      else if (isYes(a('2.7'))) analysis = 'high';
      else analysis = 'some';

      return worse(deviations, analysis);
    }

    // D3 — three separate ways to reach low risk, and only one route to high:
    // missingness that is *likely* to have depended on the true value.
    case 2: {
      if (isYes(a('3.1'))) return 'low';
      if (isYes(a('3.2'))) return 'low';
      if (isNo(a('3.3'))) return 'low';
      if (isYes(a('3.4'))) return 'high';
      return 'some';
    }

    // D4 — an inappropriate or group-dependent measurement is high on its own,
    // as is assessment that was likely influenced by knowing the assignment.
    case 3: {
      if (isYes(a('4.1')) || isYes(a('4.2'))) return 'high';
      if (isYes(a('4.5'))) return 'high';
      if (isNo(a('4.1')) && isNo(a('4.2')) && (isNo(a('4.3')) || isNo(a('4.4')))) return 'low';
      return 'some';
    }

    // D5 — cherry-picking either the measurement or the analysis is high risk;
    // low needs a pre-specified plan and neither kind of selection.
    case 4: {
      if (isYes(a('5.2')) || isYes(a('5.3'))) return 'high';
      if (isYes(a('5.1')) && isNo(a('5.2')) && isNo(a('5.3'))) return 'low';
      return 'some';
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

/**
 * Self-check for RoB 2's signalling questions, routing, and the published
 * mapping from answers to a domain judgement.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/rob2.check.mts
 *
 * Why this file is worth its length: `judgeDomain` is the one place in the app
 * that turns evidence into a risk label, and it is a *published* algorithm — so
 * unlike most of our logic it can be pinned against an external authority
 * rather than against itself. Each block below states the tool's own rule in
 * words and then checks the code against it.
 *
 * The binding checks run against the REAL `zforms/rob2/rob2_parallel_trial.json`,
 * not a fixture, for the reason `robAdapter.check.mts` already learned: a
 * fixture that agrees with the code proves nothing when the point is whether
 * the code survives the shapes real forms actually have.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ANSWER_ORDER,
  columnPatternFor,
  isAsked,
  judgeDomain,
  judgeOverall,
  parseAnswer,
  ROB2_QUESTIONS,
  ROB2_SIGNALLING,
  unansweredIn,
  type Answers,
} from '../../app/(dashboard)/risk-of-bias/_lib/rob2.ts';
import {
  bindSignalling,
  readAnswers,
  readEvidence,
  writeAnswers,
} from '../../app/(dashboard)/risk-of-bias/_lib/robSignalling.ts';
import {
  contrastLabel, isTrialQuestion, mergedAnswers, shortLabel, splitAnswers,
  trialComplete, trialKey, trialOutstanding, TRIAL_QUESTIONS,
} from '../../app/(dashboard)/risk-of-bias/_lib/robIdentity.ts';
import {
  assessmentRows, emptyAssessment, EMPTY_TRIAL, readResult, readTrial,
  reopenForChangedTrial, rowForResult, writeResult, writeTrial,
} from '../../app/(dashboard)/risk-of-bias/_lib/robStore.ts';
import {
  buildQueue, overallOf, PROGRESS_LABEL, progressOf, questionState, severitiesOf,
} from '../../app/(dashboard)/risk-of-bias/_lib/robQueue.ts';
import { presetFormFields, ROB2 } from '../../app/(dashboard)/risk-of-bias/_lib/robTools.ts';
import { bindForm } from '../../app/(dashboard)/risk-of-bias/_lib/robAdapter.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The answer vocabulary — a hedge is its own answer
// ─────────────────────────────────────────────────────────────────────────────
{
  check('yes parses', parseAnswer('Yes') === 'Y');
  check('no parses', parseAnswer('No') === 'N');
  // The whole reason RoB 2 has five responses rather than three.
  check('probably yes does NOT collapse into yes', parseAnswer('Probably yes') === 'PY');
  check('probably no does NOT collapse into no', parseAnswer('Probably no') === 'PN');
  check('no information parses', parseAnswer('No information') === 'NI');
  check('unclear reads as no information', parseAnswer('unclear') === 'NI');
  check('NR reads as no information', parseAnswer('NR') === 'NI');
  check('not applicable parses', parseAnswer('NA') === 'NA');
  check('empty is not an answer', parseAnswer('') === null);
  check('nonsense is not an answer', parseAnswer('banana') === null);
  check('five answers are offered', ANSWER_ORDER.length === 5);
  check('NA is never offered as an answer', !ANSWER_ORDER.includes('NA' as any));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. The question set
// ─────────────────────────────────────────────────────────────────────────────
{
  check('RoB 2 has five domains', ROB2_SIGNALLING.length === 5);
  check('22 signalling questions', ROB2_QUESTIONS.length === 22);
  check('question ids are unique',
    new Set(ROB2_QUESTIONS.map(q => q.id)).size === ROB2_QUESTIONS.length);
  check('every question declares its risk direction',
    ROB2_QUESTIONS.every(q => q.higherRiskWhen === 'yes' || q.higherRiskWhen === 'no'));
  check('every routed question explains its routing',
    ROB2_QUESTIONS.filter(q => q.askedWhen).every(q => !!q.routingNote));
  check('each question knows its own domain',
    ROB2_SIGNALLING.every((d, i) => d.questions.every(q => q.domain === i)));
  // 3.2 is the single question RoB 2 gives no "No information" option.
  check('only 3.2 lacks a No-information option',
    ROB2_QUESTIONS.filter(q => q.noInformationOption === false).map(q => q.id).join() === '3.2');
  // Both directions are genuinely present, which is why colouring by answer
  // alone would be wrong.
  check('the set mixes both risk directions',
    ROB2_QUESTIONS.some(q => q.higherRiskWhen === 'yes')
    && ROB2_QUESTIONS.some(q => q.higherRiskWhen === 'no'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Routing — computed live, never stored
// ─────────────────────────────────────────────────────────────────────────────
{
  const q = (id: string) => ROB2_QUESTIONS.find(x => x.id === id)!;

  check('1.1 is always asked', isAsked(q('1.1'), {}));
  check('2.6 is always asked', isAsked(q('2.6'), {}));

  // D2: 2.3 only once someone was aware of the assignment.
  check('2.3 is skipped when the trial was fully blinded',
    !isAsked(q('2.3'), { '2.1': 'N', '2.2': 'N' }));
  check('2.3 is asked when participants were aware',
    isAsked(q('2.3'), { '2.1': 'Y', '2.2': 'N' }));
  check('2.3 is asked when only personnel were aware',
    isAsked(q('2.3'), { '2.1': 'N', '2.2': 'PY' }));
  // "No information" is not "no" — it must not close the branch.
  check('2.3 is asked when awareness is unknown',
    isAsked(q('2.3'), { '2.1': 'NI', '2.2': 'N' }));
  check('2.4 waits for deviations to exist', !isAsked(q('2.4'), { '2.3': 'N' }));
  // 2.3's own parents have to be answered too: a routing state where 2.3 has an
  // answer but 2.1/2.2 do not is one the tool can never actually be in.
  check('2.4 is asked once deviations arose',
    isAsked(q('2.4'), { '2.1': 'Y', '2.2': 'N', '2.3': 'Y' }));
  check('and a question behind an unanswered parent is WAITING, not skipped',
    !isAsked(q('2.4'), { '2.3': 'Y' }));
  check('2.7 is skipped after a clean ITT analysis', !isAsked(q('2.7'), { '2.6': 'Y' }));
  check('2.7 is asked when the analysis was not appropriate',
    isAsked(q('2.7'), { '2.6': 'N' }));

  // D3: the chain only opens when data are missing.
  check('3.2 is skipped when data are near-complete', !isAsked(q('3.2'), { '3.1': 'Y' }));
  check('3.2 is asked when data are missing', isAsked(q('3.2'), { '3.1': 'N' }));
  check('3.3 is skipped when missingness is shown harmless',
    !isAsked(q('3.3'), { '3.1': 'N', '3.2': 'Y' }));
  check('3.3 is asked when it is not', isAsked(q('3.3'), { '3.1': 'N', '3.2': 'N' }));

  // D4: assessor blinding only matters once measurement itself is sound.
  check('4.3 is skipped when the method was inappropriate',
    !isAsked(q('4.3'), { '4.1': 'Y', '4.2': 'N' }));
  check('4.3 is asked when measurement was sound',
    isAsked(q('4.3'), { '4.1': 'N', '4.2': 'N' }));
  check('4.5 follows 4.4', isAsked(q('4.5'), { '4.1': 'N', '4.2': 'N', '4.3': 'Y', '4.4': 'Y' }));

  // Changing an upstream answer must close the branch again, which is exactly
  // what storing "NA" as an answer would prevent.
  check('reversing 2.1/2.2 closes 2.3 again',
    isAsked(q('2.3'), { '2.1': 'Y', '2.2': 'N' })
    && !isAsked(q('2.3'), { '2.1': 'N', '2.2': 'N' }));

  // A stale answer to a question the tool no longer asks must not route its
  // child back in. 3.1 = Yes means 3.2 is never asked, so a leftover "3.2 = No"
  // cannot reopen 3.3 — this exact case left the domain permanently unjudgeable.
  check('a skipped question cannot route its child back in',
    !isAsked(q('3.3'), { '3.1': 'Y', '3.2': 'N' }));

  check('unansweredIn lists only what routing asks',
    unansweredIn(2, { '3.1': 'Y' }).length === 0);
  // Only what the reviewer can act on now: 3.3 and 3.4 are waiting behind 3.2,
  // and listing them is three items nobody can do anything about.
  check('unansweredIn reports only what can be answered now',
    unansweredIn(2, { '3.1': 'N' }).join() === '3.2',
    unansweredIn(2, { '3.1': 'N' }).join());
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. The algorithm — one block per domain, stating the tool's own rule
// ─────────────────────────────────────────────────────────────────────────────
{
  // An incomplete domain is never judged. This is the safety property: a label
  // nobody asserted must not appear.
  check('an empty domain is unjudged', judgeDomain(0, {}) === null);
  check('a half-answered domain is unjudged',
    judgeDomain(0, { '1.1': 'Y', '1.2': 'Y' }) === null);
  check('an open routed branch blocks the judgement',
    judgeDomain(2, { '3.1': 'N' }) === null);

  // D1 — low only when the sequence was random, concealed, and baseline
  // differences suggest no problem.
  check('D1 low', judgeDomain(0, { '1.1': 'Y', '1.2': 'Y', '1.3': 'N' }) === 'low');
  check('D1 low tolerates hedges',
    judgeDomain(0, { '1.1': 'PY', '1.2': 'PY', '1.3': 'PN' }) === 'low');
  // Table 4: "1.1 Y/PY · 1.2 Y/PY · 1.3 Y/PY -> Some concerns", with the remark
  // that substantial imbalance despite sound methods should be INVESTIGATED and
  // could land either way. It is a prompt for a reviewer, not a verdict — this
  // check asserted 'high' for months and the code agreed, because both were
  // written from the same misreading of the domain rather than from the table.
  check('D1 some concerns when baseline differs but allocation was concealed',
    judgeDomain(0, { '1.1': 'Y', '1.2': 'Y', '1.3': 'Y' }) === 'some',
    String(judgeDomain(0, { '1.1': 'Y', '1.2': 'Y', '1.3': 'Y' })));
  // Table 4: "Any response · 1.2 NI · 1.3 Y/PY -> High".
  check('D1 high when baseline differs AND concealment is unknown',
    judgeDomain(0, { '1.1': 'Y', '1.2': 'NI', '1.3': 'Y' }) === 'high');
  check('D1 high when allocation was not concealed',
    judgeDomain(0, { '1.1': 'Y', '1.2': 'N', '1.3': 'N' }) === 'high');
  // Table 4's Low row is "1.1 Y/PY/NI", so not knowing how the sequence was
  // generated does not by itself stop a concealed, balanced trial being low.
  check('D1 low even when sequence generation is unreported',
    judgeDomain(0, { '1.1': 'NI', '1.2': 'Y', '1.3': 'N' }) === 'low');
  check('D1 some concerns when the sequence was not random',
    judgeDomain(0, { '1.1': 'N', '1.2': 'Y', '1.3': 'N' }) === 'some');

  // D2 — the worse of "what happened in the trial" and "was the analysis ITT".
  const d2 = (a: Answers) => judgeDomain(1, a);
  check('D2 low when blinded and analysed by assignment',
    d2({ '2.1': 'N', '2.2': 'N', '2.6': 'Y' }) === 'low');
  check('D2 high when a non-ITT analysis could have substantially affected the result',
    d2({ '2.1': 'N', '2.2': 'N', '2.6': 'N', '2.7': 'Y' }) === 'high');
  // Table 6 part 2: "2.6 N/PN/NI · 2.7 N/PN -> Some concerns". A non-ITT
  // analysis is never clean, even where switching could not have mattered.
  check('D2 some concerns when the analysis was not by assignment',
    d2({ '2.1': 'N', '2.2': 'N', '2.6': 'N', '2.7': 'N' }) === 'some',
    String(d2({ '2.1': 'N', '2.2': 'N', '2.6': 'N', '2.7': 'N' })));
  check('D2 takes the worse of its two parts',
    d2({ '2.1': 'Y', '2.2': 'Y', '2.3': 'N', '2.6': 'N', '2.7': 'Y' }) === 'high');
  check('D2 low when awareness led to no deviations',
    d2({ '2.1': 'Y', '2.2': 'Y', '2.3': 'N', '2.6': 'Y' }) === 'low');

  // D3 — three separate routes to low; only one route to high.
  const d3 = (a: Answers) => judgeDomain(2, a);
  check('D3 low when data are near-complete', d3({ '3.1': 'Y' }) === 'low');
  check('D3 low when missingness is shown not to have biased the result',
    d3({ '3.1': 'N', '3.2': 'Y' }) === 'low');
  check('D3 low when missingness cannot depend on the true value',
    d3({ '3.1': 'N', '3.2': 'N', '3.3': 'N' }) === 'low');
  check('D3 high only when missingness LIKELY depended on the true value',
    d3({ '3.1': 'N', '3.2': 'N', '3.3': 'Y', '3.4': 'Y' }) === 'high');
  check('D3 some concerns when it merely could have',
    d3({ '3.1': 'N', '3.2': 'N', '3.3': 'Y', '3.4': 'N' }) === 'some');

  // D4 — an unsound or group-dependent measurement is high on its own.
  const d4 = (a: Answers) => judgeDomain(3, a);
  check('D4 high when the measurement method was inappropriate',
    d4({ '4.1': 'Y', '4.2': 'N' }) === 'high');
  check('D4 high when measurement differed between groups',
    d4({ '4.1': 'N', '4.2': 'Y' }) === 'high');
  check('D4 low when measurement was sound and assessors blinded',
    d4({ '4.1': 'N', '4.2': 'N', '4.3': 'N' }) === 'low');
  check('D4 high when assessment was likely influenced',
    d4({ '4.1': 'N', '4.2': 'N', '4.3': 'Y', '4.4': 'Y', '4.5': 'Y' }) === 'high');
  check('D4 some concerns when it could be but was not likely',
    d4({ '4.1': 'N', '4.2': 'N', '4.3': 'Y', '4.4': 'Y', '4.5': 'N' }) === 'some');

  // D5 — cherry-picking either the measurement or the analysis is high risk.
  const d5 = (a: Answers) => judgeDomain(4, a);
  check('D5 low with a pre-specified plan and no selection',
    d5({ '5.1': 'Y', '5.2': 'N', '5.3': 'N' }) === 'low');
  check('D5 high when the measurement was selected from several',
    d5({ '5.1': 'Y', '5.2': 'Y', '5.3': 'N' }) === 'high');
  check('D5 high when the analysis was selected from several',
    d5({ '5.1': 'Y', '5.2': 'N', '5.3': 'Y' }) === 'high');
  check('D5 some concerns with no pre-specified plan',
    d5({ '5.1': 'NI', '5.2': 'N', '5.3': 'N' }) === 'some');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Overall — worst domain, and the multiple-concerns clause stays a question
// ─────────────────────────────────────────────────────────────────────────────
{
  check('all low is low',
    judgeOverall(['low', 'low', 'low', 'low', 'low']).severity === 'low');
  check('one high is high',
    judgeOverall(['low', 'low', 'high', 'low', 'low']).severity === 'high');
  check('one concern is some concerns',
    judgeOverall(['low', 'some', 'low', 'low', 'low']).severity === 'some');
  check('an unjudged domain blocks the overall',
    judgeOverall(['low', null, 'low', 'low', 'low']).severity === null);
  check('an unjudged domain blocks it even beside a high',
    judgeOverall(['high', null]).severity === null);

  // RoB 2 says multiple concerns MAY warrant High. The code must raise it, not
  // decide it — deciding would be the algorithm making a judgement call.
  check('multiple concerns are flagged, not upgraded',
    judgeOverall(['some', 'some', 'low', 'low', 'low']).severity === 'some');
  check('multiple concerns raise considerHigh',
    judgeOverall(['some', 'some', 'low', 'low', 'low']).considerHigh === true);
  check('a single concern does not',
    judgeOverall(['some', 'low', 'low', 'low', 'low']).considerHigh === false);
  check('a high does not need the clause',
    judgeOverall(['some', 'some', 'high']).considerHigh === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Column matching — the prefix, never the descriptive tail
// ─────────────────────────────────────────────────────────────────────────────
{
  check('1.1 matches its column',
    columnPatternFor('1.1').test('d1_1_allocation_sequence_random'));
  check('the tail is irrelevant',
    columnPatternFor('2.6').test('d2_6_itt')
    && columnPatternFor('2.6').test('d2_6_appropriate_analysis'));
  check('domain-spelled columns match', columnPatternFor('3.1').test('domain3_1_data_available'));
  check('2.1 does not steal 2.7', !columnPatternFor('2.1').test('d2_7_analysis_failure_impact'));
  // The digit guard: without it, 1.1 would claim a hypothetical d1_10.
  check('1.1 does not match d1_10', !columnPatternFor('1.1').test('d1_10_extra'));
  check('a judgement column is not a question',
    !columnPatternFor('1.1').test('domain1_judgment'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Binding against the REAL RoB 2 form
// ─────────────────────────────────────────────────────────────────────────────
{
  const here = dirname(fileURLToPath(import.meta.url));
  const formPath = resolve(here, '../../../zforms/rob2/rob2_parallel_trial.json');
  const form = JSON.parse(readFileSync(formPath, 'utf8'));
  const binding = bindSignalling(form.fields);

  check('the real RoB 2 form binds all 22 questions', binding.coverage === 22,
    `bound ${binding.coverage}`);
  check('the real RoB 2 form is usable', binding.usable === true,
    `missing ${binding.missing.join(', ')}`);
  check('no column is claimed twice', (() => {
    const cols = binding.questions.map(b => b.column).filter(Boolean);
    return new Set(cols).size === cols.length;
  })());
  check('judgement columns were not claimed as questions',
    binding.questions.every(b => !/judgment|judgement/i.test(b.column ?? '')));
  check('support columns were not claimed as questions',
    binding.questions.every(b => !/support|justification/i.test(b.column ?? '')));

  // A form with only domain judgements must NOT present 22 blank questions.
  const flat = bindSignalling([
    { field_name: 'domain1_judgment', field_type: 'select', options: ['Low'] },
    { field_name: 'domain2_judgment', field_type: 'select', options: ['Low'] },
  ] as any);
  check('a judgement-only form is not usable for questions', flat.usable === false);
  check('a judgement-only form binds nothing', flat.coverage === 0);

  // Round-trip: what a reviewer answers is what reads back.
  const written = writeAnswers({}, binding, { '1.1': 'Y', '1.3': 'PN' });
  const back = readAnswers(written, binding);
  check('an answer round-trips', back['1.1'] === 'Y');
  check('a hedge round-trips as a hedge', back['1.3'] === 'PN');
  check('unanswered questions stay absent', back['1.2'] === undefined);

  // Evidence state, which replaced the mockup's invented confidence number.
  const withQuote = writeAnswers({
    d1_1_allocation_sequence_random: {
      value: 'Yes', source_text: 'a computer-generated sequence', source_location: { page: 4 },
    },
  }, binding, {});
  const ev = readEvidence(withQuote, binding);
  check('a quoted answer reads as quoted', ev['1.1'].state === 'quoted');
  check('the quote is carried', ev['1.1'].quote.includes('computer-generated'));
  check('the locator is rendered', ev['1.1'].locator === 'Page 4');
  const evPlain = readEvidence(writeAnswers({}, binding, { '1.2': 'Y' }), binding);
  check('an unquoted answer reads as inferred', evPlain['1.2'].state === 'inferred');
  check('an unanswered question has no evidence', evPlain['1.3'].state === 'not_found');

  // A reviewer changing an answer must not inherit the AI's quote for it.
  const edited = writeAnswers(withQuote, binding, { '1.1': 'N' });
  check('editing an answer drops the quote that backed the old one',
    readEvidence(edited, binding)['1.1'].state === 'inferred');
  const untouched = writeAnswers(withQuote, binding, { '1.1': 'Y' });
  check('re-affirming the same answer keeps its quote',
    readEvidence(untouched, binding)['1.1'].state === 'quoted');
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. What an assessment is ABOUT — the eight-slot result identity
//
// Deriving results from a project's outcome forms now happens on the server
// (`utils/rob_mapping.py`, 47 tests), so what is left to pin here is the
// vocabulary the screens use to talk about one.
// ─────────────────────────────────────────────────────────────────────────────
{
  check('exactly six questions are about the trial rather than the result',
    TRIAL_QUESTIONS.join(',') === '1.1,1.2,1.3,2.1,2.2,2.3');
  check('and nothing from 2.4 onward is',
    !isTrialQuestion('2.4') && !isTrialQuestion('3.1') && !isTrialQuestion('5.1'));

  // A comparison is DIRECTED. Rendering it from two fields rather than storing
  // one "X vs Y" string is what makes swapping them a visible edit instead of a
  // silent inversion of every estimate that points at it.
  check('a contrast reads in the direction it was stored',
    contrastLabel({ id: 'c', intervention: 'Ibuprofen 400 mg', comparator: 'placebo' })
      === 'Ibuprofen 400 mg vs placebo');
  check('an unresolved contrast says so rather than reading as an outcome',
    contrastLabel(null) === '—');

  const identity = {
    id: 'r1', document_id: 'd1', population: 'Overall', outcome_domain: 'Pain relief',
    measurement: 'Proportion', timepoint: '6 hours', analysis_population: 'ITT',
    analysis: '', estimate: 'RR 1.84',
    contrast: { id: 'c1', intervention: 'Ibuprofen 400 mg', comparator: 'placebo' },
  };
  check('a result reads as prose in a queue row',
    shortLabel(identity) === 'Pain relief · Proportion · 6 hours · Ibuprofen 400 mg vs placebo',
    shortLabel(identity));
  // Two results of one trial can share outcome, timepoint and contrast and differ
  // only in how the outcome was measured. Without the measurement in the name
  // their queue rows are identical — and question 4.1 is about exactly that
  // difference.
  check('a proportion and a mean of the same outcome do not read identically',
    shortLabel(identity) !== shortLabel({ ...identity, id: 'r2', measurement: 'Mean' }));
  // "Overall" is what we WRITE when no source form records a population. Saying
  // it on every row would bury the subgroup results that actually differ.
  check('the written default population is not repeated on every row',
    !shortLabel(identity).includes('Overall'));
  check('but a real subgroup is',
    shortLabel({ ...identity, population: 'Third molar extraction' })
      .includes('Third molar extraction'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Two zones — the trial's six answers, and each result's own
//
// One stored answer, read by every result. The alternative — copying the six
// into each result's record — is what produced provenance to chase, several
// records to keep in step, and a reviewer looking at answers they never gave.
// ─────────────────────────────────────────────────────────────────────────────
{
  const preset = presetFormFields(ROB2) as any[];
  const table = preset.find(f => f.field_type === 'array');
  const store = bindSignalling(table.subform_fields);
  const bound = bindForm({
    id: 'f-rob', form_name: 'Risk of Bias 2 (RoB 2)', fields: preset,
  } as any)!;
  const domains = bound.domains.filter(d => !d.extra);

  check('the preset gives all 22 questions a column', store.coverage === 22, String(store.coverage));
  check('and declares the result id the entries are keyed on',
    table.subform_fields.some((f: any) => f.field_name === 'result_id'));
  check('the six trial answers have a home at the top of the record too',
    preset.some(f => f.field_name === 'd1_1') && preset.some(f => f.field_name === 'd2_3'));
  check('and nothing from 2.4 onward does',
    !preset.some(f => /^d2_4/.test(String(f.field_name))));

  const trial = {
    // 2.1 = Yes, so 2.3 is routed IN. With both 2.1 and 2.2 answered No the tool
    // never asks 2.3, and storing an answer to it anyway is how a stale response
    // survives a change to the question above it.
    answers: { '1.1': 'Y', '1.2': 'Y', '1.3': 'N', '2.1': 'Y', '2.2': 'N', '2.3': 'N' } as Answers,
    rationale: { '1.1': 'Computer-generated sequence.' },
    evidence: {},
    complete: true,
  };
  let record = writeTrial(undefined, store, trial);

  check('the trial answers land at the root, not in a result entry',
    !!record.d1_1 && assessmentRows(record).length === 0);
  check('reading them back gives exactly the six',
    Object.keys(readTrial(record, store).answers).sort().join(',') === '1.1,1.2,1.3,2.1,2.2,2.3');
  check('completion is a declaration that survives a round trip',
    readTrial(record, store).complete === true);
  check('and a per-question rationale travels with it',
    readTrial(record, store).rationale['1.1'] === 'Computer-generated sequence.');

  // Routing applies to the trial zone too. Answering 2.1 and 2.2 both "No" means
  // RoB 2 never asks 2.3, so no answer to it is kept.
  const routedOut = writeTrial(undefined, store,
    { ...trial, answers: { ...trial.answers, '2.1': 'N' } as Answers });
  check('a trial question the routing drops keeps no answer',
    readTrial(routedOut, store).answers['2.3'] === undefined);
  // The gate follows the routing. Answering 2.1 and 2.2 "No" is what MAKES RoB 2
  // skip 2.3, so a reviewer who has done that is finished with the trial zone —
  // reporting 2.3 as outstanding gated D1 and D2 behind an answer the instrument
  // will never ask for, and `writeTrial` had already dropped it.
  check('a question the routing drops is not outstanding',
    trialOutstanding(readTrial(routedOut, store).answers).length === 0);
  check('so the trial zone reads complete',
    trialComplete(readTrial(routedOut, store).answers) === true);
  check('and answering all six still reads complete',
    trialComplete(readTrial(record, store).answers) === true);
  // What outstanding SHOULD list: a question that is asked and unanswered, and
  // never one that is merely waiting on an earlier one.
  check('an unanswered trial zone lists the five that are asked, not all six',
    trialOutstanding({} as Answers).join(',') === '1.1,1.2,1.3,2.1,2.2');
  check('2.3 becomes outstanding once 2.1 says somebody was aware',
    trialOutstanding({ '1.1': 'Y', '1.2': 'Y', '1.3': 'Y', '2.1': 'Y', '2.2': 'N' } as Answers)
      .join(',') === '2.3');
  check('splitAnswers puts each answer where it is stored',
    splitAnswers({ '1.1': 'Y', '3.1': 'N' } as Answers).trial['1.1'] === 'Y'
    && splitAnswers({ '1.1': 'Y', '3.1': 'N' } as Answers).result['3.1'] === 'N');

  const first = emptyAssessment();
  first.answers = { '2.4': 'N', '2.5': 'N', '2.6': 'Y', '3.1': 'Y', '4.1': 'N', '5.1': 'Y' } as Answers;
  first.confirmed = [true, true, false, false, false];

  record = writeResult(record, store, domains, ROB2, {
    resultId: 'res-1', label: 'Pain relief · 6 hours', resultVersion: 3,
    assessment: first, merged: mergedAnswers(trial.answers, first.answers),
    severities: severitiesOf(first, mergedAnswers(trial.answers, first.answers)),
  });

  check('one result makes one entry', assessmentRows(record).length === 1);
  check('the entry is keyed on the result id',
    assessmentRows(record)[0].result_id === 'res-1');
  check('and records the identity version it was made against',
    String(assessmentRows(record)[0].result_version) === '3');
  check('the trial answers are NOT copied into the entry',
    assessmentRows(record)[0].d1_1 === undefined,
    JSON.stringify(assessmentRows(record)[0].d1_1));

  const second = emptyAssessment();
  second.answers = { '2.4': 'Y' } as Answers;
  record = writeResult(record, store, domains, ROB2, {
    resultId: 'res-2', label: 'Nausea · 24 hours', resultVersion: 1,
    assessment: second, merged: mergedAnswers(trial.answers, second.answers),
    severities: severitiesOf(second, mergedAnswers(trial.answers, second.answers)),
  });

  // A save rewrites the whole record. A careless merge here destroys the other
  // three assessments a reviewer made on the same trial.
  check('a second result is added beside the first, not over it',
    assessmentRows(record).length === 2
    && assessmentRows(record)[0].result_id === 'res-1');
  check('and the first keeps its answers',
    assessmentRows(record)[0].d3_1 === 'Yes', String(assessmentRows(record)[0].d3_1));

  const back = readResult(
    rowForResult(record, 'res-1', 'Pain relief · 6 hours')!, store, domains, ROB2);
  check('a result reads back only its own answers',
    Object.keys(back.answers).every(id => !isTrialQuestion(id)));
  check('confirmations survive the round trip',
    back.confirmed[0] === true && back.confirmed[2] === false);
  check('so does the version it was made against', back.resultVersion === 3);

  // The grounding behind an accepted suggestion has to survive the save, or a
  // reviewer who pressed "Use suggestion" on a verified quote reloads to find
  // their answer reported as *inferred* with nothing behind it. The quote is in
  // hand when the answer is taken; losing it on the way to storage is silent.
  const quoted = emptyAssessment();
  quoted.answers = { '3.1': 'Y' } as Answers;
  quoted.evidence = {
    '3.1': {
      state: 'quoted',
      quote: 'Outcome data were available for 72 of the 100 randomised participants.',
      locator: 'Page 4 · Results',
      rationale: 'Losses are reported and balanced.',
    },
  };
  const withQuote = writeResult(record, store, domains, ROB2, {
    resultId: 'res-3', label: 'Rescue medication · 24 hours', resultVersion: 1,
    assessment: quoted, merged: mergedAnswers(trial.answers, quoted.answers),
    severities: severitiesOf(quoted, mergedAnswers(trial.answers, quoted.answers)),
  });
  const quotedBack = readResult(rowForResult(withQuote, 'res-3')!, store, domains, ROB2);
  check('an accepted quote survives the save',
    quotedBack.evidence['3.1']?.quote
      === 'Outcome data were available for 72 of the 100 randomised participants.',
    JSON.stringify(quotedBack.evidence['3.1']));
  check('and the answer still reads as grounded, not inferred',
    quotedBack.evidence['3.1']?.state === 'quoted',
    String(quotedBack.evidence['3.1']?.state));
  check('the locator survives with it',
    quotedBack.evidence['3.1']?.locator === 'Page 4 · Results',
    String(quotedBack.evidence['3.1']?.locator));

  // The other half of the rule, which already held: a reviewer who answers by
  // hand must not inherit the model's quote as if it backed their answer.
  const byHand = emptyAssessment();
  byHand.answers = { '3.1': 'N' } as Answers;
  byHand.evidence = { '3.1': { state: 'not_found', quote: '', locator: '', rationale: '' } };
  const handBack = readResult(
    rowForResult(writeResult(withQuote, store, domains, ROB2, {
      resultId: 'res-3', label: 'Rescue medication · 24 hours', resultVersion: 1,
      assessment: byHand, merged: mergedAnswers(trial.answers, byHand.answers),
      severities: severitiesOf(byHand, mergedAnswers(trial.answers, byHand.answers)),
    }), 'res-3')!, store, domains, ROB2);
  check('a hand-changed answer still drops the quote it no longer matches',
    !handBack.evidence['3.1']?.quote, JSON.stringify(handBack.evidence['3.1']));

  // The derived judgement is cached in the domain column so the grid, exports,
  // consensus and Synthesis keep reading what they always read.
  const view = mergedAnswers(trial.answers, first.answers);
  const cached = assessmentRows(record)[0];
  const expected = ROB2.judgments.find(j => ROB2.severity[j] === severitiesOf(first, view)[0]);
  check('the derived domain judgement is written alongside the answers',
    !!expected && Object.values(cached).includes(expected),
    `expected ${expected}`);

  // An override is a recorded decision, not a disagreement inferred by comparing
  // the stored label with what the answers derive — that inference is what made
  // a finished AI assessment read as "your override" and blocked saving.
  const overridden = { ...first, overrides: { 2: 'high' as const }, overrideWhy: { 2: 'Attrition imbalanced.' } };
  const withOverride = writeResult(record, store, domains, ROB2, {
    resultId: 'res-1', label: 'Pain relief · 6 hours', resultVersion: 3,
    assessment: overridden, merged: view, severities: severitiesOf(overridden, view),
  });
  const readBack = readResult(
    rowForResult(withOverride, 'res-1')!, store, domains, ROB2);
  check('an override round-trips with its reason',
    readBack.overrides[2] === 'high' && readBack.overrideWhy[2] === 'Attrition imbalanced.');
  check('and a domain nobody overrode reads as not overridden',
    readBack.overrides[0] === undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. The queue — a study shows a SPREAD, never one label
// ─────────────────────────────────────────────────────────────────────────────
{
  const a = emptyAssessment();
  const severities = severitiesOf(a, {});
  check('an unanswered assessment judges no domain',
    severities.every(s => s === 'none'));
  check('and therefore has no overall judgement — not a provisional low',
    overallOf(a, severities) === 'none');

  const overridden = { ...emptyAssessment(), overrides: { 0: 'high' as const } };
  check('an override is what the queue shows for that domain',
    severitiesOf(overridden, {})[0] === 'high');

  // Progress counts questions RoB 2 will actually ask. Counting all 22 gives a
  // bar that never fills, because most conditional questions route out.
  const partial: Answers = { '1.1': 'Y', '1.2': 'Y', '1.3': 'N' };
  const p = progressOf(partial);
  check('progress is measured against applicable questions, not all 22',
    p.applicable < 22 && p.answered === 3, `${p.answered}/${p.applicable}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. A question is in one of THREE states, not two
//
// "Not applicable" and "not yet asked" look the same on screen and mean
// opposite things: the first says the tool has ruled this out, the second says
// a question before it is unanswered so nothing has ruled it out yet. Drawing
// the second as the first tells a reviewer a question is dismissed when it is
// about to reappear.
// ─────────────────────────────────────────────────────────────────────────────
{
  const q = (id: string) => ROB2_QUESTIONS.find(x => x.id === id)!;

  check('a question the tool always asks is asked',
    questionState(q('1.1'), {}) === 'asked');

  // 3.2 is asked only when 3.1 says data were NOT available for nearly all.
  check('with 3.1 unanswered, 3.2 is WAITING — not ruled out',
    questionState(q('3.2'), {}) === 'waiting',
    questionState(q('3.2'), {}));
  check('3.1 = Yes rules 3.2 out for good',
    questionState(q('3.2'), { '3.1': 'Y' }) === 'skipped');
  check('3.1 = No brings 3.2 in',
    questionState(q('3.2'), { '3.1': 'N' }) === 'asked');

  // The queue's "5/12 applicable answered · more may apply" comes from here.
  const blank = progressOf({});
  check('progress counts only what is asked right now',
    blank.applicable === 12, String(blank.applicable));
  check('and says so when an answer could add more',
    blank.mayGrow === true);

  const everything: Answers = {};
  for (const question of ROB2_QUESTIONS) everything[question.id] = 'Y';
  const full = progressOf(everything);
  check('with every question answered nothing is left waiting',
    full.mayGrow === false);
  check('and the applicable count has grown past the blank one',
    full.applicable > blank.applicable, `${blank.applicable} → ${full.applicable}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Trial answers are scoped to the COMPARISON, not the study
//
// 2.1-2.3 ask who knew the assigned intervention. In a trial running three drugs
// against placebo, one arm can be double-blind and another open-label — one set
// per trial forces a single answer onto two different truths.
// ─────────────────────────────────────────────────────────────────────────────
{
  const base = { document_id: 'doc-1' };
  check('two comparisons of one study are different scopes',
    trialKey({ ...base, contrast: { id: 'c1', intervention: 'A', comparator: 'P' } })
    !== trialKey({ ...base, contrast: { id: 'c2', intervention: 'B', comparator: 'P' } }));
  check('two results of the SAME comparison share one scope',
    trialKey({ ...base, contrast: { id: 'c1', intervention: 'A', comparator: 'P' } })
    === trialKey({ ...base, contrast: { id: 'c1', intervention: 'A', comparator: 'P' } }));
  // A result whose comparison is unsettled has nowhere scoped to put them, and
  // falls back to the study — which is where they lived before scoping existed.
  check('an unsettled comparison falls back to the study',
    trialKey({ ...base, contrast: null }) === 'doc-1:');
  check('and two studies never share a scope',
    trialKey({ ...base, contrast: null }) !== trialKey({ document_id: 'doc-2', contrast: null }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Evidence, copy provenance, and reopening on changed shared answers
// ─────────────────────────────────────────────────────────────────────────────
{
  const preset = presetFormFields(ROB2) as any[];
  const table = preset.find(f => f.field_type === 'array');
  const store = bindSignalling(table.subform_fields);
  const bound = bindForm({ id: 'f', form_name: 'Risk of Bias 2 (RoB 2)', fields: preset } as any)!;
  const domains = bound.domains.filter(d => !d.extra);
  const trial = {
    answers: { '1.1': 'Y', '1.2': 'Y', '1.3': 'N', '2.1': 'Y', '2.2': 'N', '2.3': 'N' } as Answers,
    rationale: {}, evidence: {}, complete: true,
  };

  // Scoped to a comparison: the same record holds a different set per contrast.
  let record = writeTrial(undefined, store, trial, 'c1');
  record = writeTrial(record, store,
    { ...trial, answers: { ...trial.answers, '2.1': 'N' } as Answers }, 'c2');
  check('two comparisons keep separate trial answers in one record',
    readTrial(record, store, 'c1').answers['2.1'] === 'Y'
    && readTrial(record, store, 'c2').answers['2.1'] === 'N');
  check('and a record written before scoping still reads',
    readTrial(writeTrial(undefined, store, trial, ''), store, '').answers['1.1'] === 'Y');

  // Evidence and copy provenance survive a round trip.
  const a = emptyAssessment();
  a.answers = { '3.1': 'Y' } as Answers;
  a.sources = { '3.1': { reference: 'p.6 · Table 2', passage: '108 of 120 analysed' } };
  a.origins = { '3.1': { copiedFrom: 'res-2', editedSince: true } };
  a.confirmed = [true, true, true, false, false];
  a.complete = true;
  const merged = mergedAnswers(trial.answers, a.answers);
  record = writeResult(record, store, domains, ROB2, {
    resultId: 'res-1', label: 'Pain relief', resultVersion: 1,
    assessment: a, merged, severities: severitiesOf(a, merged),
  });
  const back = readResult(rowForResult(record, 'res-1')!, store, domains, ROB2);
  check('a source reference and passage survive the round trip',
    back.sources['3.1']?.reference === 'p.6 · Table 2'
    && back.sources['3.1']?.passage === '108 of 120 analysed');
  // Copied, and edited since, are three states with two flags — a reviewer
  // reading consensus has to be able to tell them apart.
  check('copy provenance survives, including that it was edited after copying',
    back.origins['3.1']?.copiedFrom === 'res-2' && back.origins['3.1']?.editedSince === true);

  // Changing the shared answers reopens what was judged on them.
  const { data: after, reopened } = reopenForChangedTrial(record, new Set(['res-1']));
  check('a completed review resting on changed shared answers reopens',
    reopened.join() === 'res-1');
  const reread = readResult(rowForResult(after, 'res-1')!, store, domains, ROB2);
  check('and it is no longer marked complete', reread.complete === false);
  check('but nothing it holds was deleted', reread.answers['3.1'] === 'Y');
  check('a review that was never complete is left alone',
    reopenForChangedTrial(after, new Set(['res-1'])).reopened.length === 0);

  // WHY it reopened has always been written into the record; nothing read it,
  // so the reviewer saw a finished assessment quietly become unfinished.
  check('and the reopened review can say why it reopened',
    !!reread.reopenedBecause, JSON.stringify(reread.reopenedBecause));
  check('the reason names the shared answers',
    /trial answers/i.test(reread.reopenedBecause), reread.reopenedBecause);

  // It has to survive the next save, or it vanishes the moment the reviewer
  // touches an answer — before they have read it.
  const touched = writeResult(after, store, domains, ROB2, {
    resultId: 'res-1', label: 'Pain relief · 6 hours', resultVersion: 3,
    assessment: reread, merged: reread.answers, severities: severitiesOf(reread, reread.answers),
  });
  check('the reason survives a save', !!readResult(
    rowForResult(touched, 'res-1')!, store, domains, ROB2).reopenedBecause);

  // And clears when acknowledged, rather than nagging forever.
  const acknowledged = writeResult(after, store, domains, ROB2, {
    resultId: 'res-1', label: 'Pain relief · 6 hours', resultVersion: 3,
    assessment: { ...reread, reopenedBecause: '' },
    merged: reread.answers, severities: severitiesOf(reread, reread.answers),
  });
  check('and clears once the reviewer acknowledges it', !readResult(
    rowForResult(acknowledged, 'res-1')!, store, domains, ROB2).reopenedBecause);
  check('and so is a result nobody asked about',
    reopenForChangedTrial(record, new Set(['res-9'])).reopened.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. The queue tells a reviewer WHICH kind of "not done" each row is
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = (id: string) => ({
    id, document_id: 'doc-1', contrast: { id: 'c1', intervention: 'A', comparator: 'B' },
    population: 'Overall', outcome_domain: 'Pain relief', measurement: 'VAS',
    timepoint: '6 hours', analysis_population: '', analysis: '', estimate: '',
    version: 1, state: 'active',
  }) as any;

  const done = { ...EMPTY_TRIAL, complete: true };
  const build = (assessments: Array<[string, any]>, opts: any = {}) => buildQueue({
    results: (opts.results ?? ['r1']).map(result),
    trialByComparison: new Map([['doc-1:c1', opts.trial ?? done]]),
    assessmentByResult: new Map(assessments),
    labels: { 'doc-1': 'Raslan 2021' },
    seats: opts.seats ?? new Map([['doc-1', 'reviewer_1']]),
  } as any);

  const untouched = build([])[0].results[0];
  check('a result nobody has answered reads as Not started, not In progress',
    untouched.progress === 'not_started', untouched.progress);

  const started = emptyAssessment();
  started.answers = { '3.1': 'Y' } as any;
  const partway = build([['r1', started]])[0].results[0];
  check('and one with an answer in it reads as In progress',
    partway.progress === 'in_progress', partway.progress);

  check('the two are worded differently, or the split buys nothing',
    PROGRESS_LABEL.not_started !== PROGRESS_LABEL.in_progress);

  // The regression this block exists for: splitting `not_started` out of
  // `in_progress` made "Next for me" skip every result nobody had touched —
  // which is most of them on a fresh project, i.e. exactly when it is used.
  const nextForMe = (rows: any[]) =>
    rows.find(r => r.progress === 'in_progress')
    ?? rows.find(r => r.progress === 'not_started')
    ?? rows.find(r => r.progress === 'trial_needed')
    ?? null;
  check('"Next for me" still lands on an untouched result',
    nextForMe(build([]).flatMap(g => g.results))?.result.id === 'r1');

  // Blocked and unassigned still win: both are somebody making a decision.
  const held = buildQueue({
    results: [{ ...result('r1'), state: 'held' }],
    trialByComparison: new Map([['doc-1:c1', done]]),
    assessmentByResult: new Map(),
    labels: { 'doc-1': 'Raslan 2021' },
    seats: new Map([['doc-1', 'reviewer_1']]),
  } as any)[0].results[0];
  check('a held result is Blocked, not Not started', held.progress === 'blocked');
  check('and it says what is holding it', !!held.blocker);

  // A seat is `UNIQUE(project_id, document_id, reviewer_role)` — a fact about
  // the whole study, for every form — and it gates nothing here. Ranked as a
  // progress state it masked every real one, so a reviewer holding no seat
  // read "Unassigned" on every row of every study instead of what was left.
  const seatlessGroup = build([], { seats: new Map() })[0];
  check('no seat does not mask what is actually left to do',
    seatlessGroup.results[0].progress === 'not_started',
    seatlessGroup.results[0].progress);
  check('and it says nothing per-row about assignment',
    !/assign/i.test(seatlessGroup.results[0].blocker));
  check('the seat is carried on the STUDY, to be said once',
    seatlessGroup.seat === null);

  const trialOpen = build([], { trial: EMPTY_TRIAL })[0].results[0];
  check('unanswered trial questions still come before the result\'s own',
    trialOpen.progress === 'trial_needed');
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  RoB 2 signalling questions + algorithm — ${passed} checks passed\n`);

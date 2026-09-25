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
  routeAll,
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
// 11. A question is in one of THREE states, not two
//
// "Not applicable" and "not yet asked" look the same on screen and mean
// opposite things: the first says the tool has ruled this out, the second says
// a question before it is unanswered so nothing has ruled it out yet. Drawing
// the second as the first tells a reviewer a question is dismissed when it is
// about to reappear.
// ─────────────────────────────────────────────────────────────────────────────
{
  const route = (a: Answers) => routeAll(a);

  check('a question the tool always asks is asked',
    route({})['1.1'] === 'asked');

  // 3.2 is asked only when 3.1 says data were NOT available for nearly all.
  check('with 3.1 unanswered, 3.2 is WAITING — not ruled out',
    route({})['3.2'] === 'waiting', route({})['3.2']);
  check('3.1 = Yes rules 3.2 out for good',
    route({ '3.1': 'Y' })['3.2'] === 'skipped');
  check('3.1 = No brings 3.2 in',
    route({ '3.1': 'N' })['3.2'] === 'asked');
}




// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  RoB 2 signalling questions + algorithm — ${passed} checks passed\n`);

/**
 * Self-check for the RoB column-mapping problem rules.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/mappingProblems.check.mts
 *
 * The case worth having a check for is a mapped column that the form no longer
 * has. No live form is in that state, so nothing on screen would ever exercise
 * it — and the failure it guards against is silent: substituting the nearest
 * surviving column re-points every result the form produces.
 */

import {
  mappingProblems,
  type MappingField,
} from '../../app/(dashboard)/risk-of-bias/_lib/mappingProblems.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// The four main fields, as the screen declares them.
const FIELDS: MappingField[] = [
  { id: 'outcome_domain', label: 'Outcome', required: true },
  { id: 'timepoint', label: 'Timepoint' },
  { id: 'measurement', label: 'Measurement' },
  { id: 'arm', label: 'Arm', required: true },
  { id: 'population', label: 'Population' },
];

// The real Analgesics dichotomous table.
const COLUMNS = [
  'population_type', 'intervention', 'intervention_detail', 'outcome_type',
  'outcome_other', 'followup_timepoint', 'n_analyzed', 'adverse_effect',
  'events_n', 'events_pct', 'adverse_effect_definition',
];

const GOOD = {
  outcome_domain: 'outcome_type',
  timepoint: 'followup_timepoint',
  measurement: '',
  arm: 'intervention',
  population: 'population_type',
};

{
  const out = mappingProblems(FIELDS, GOOD, COLUMNS);
  check('a complete mapping has nothing to report', out.length === 0,
    out.map(p => p.message).join('; '));
}

{
  // Optional and unmapped is the normal state, not a problem: this form
  // records no measurement.
  const out = mappingProblems(FIELDS, { ...GOOD, measurement: '' }, COLUMNS);
  check('an unmapped optional field is not a problem',
    !out.some(p => p.field === 'measurement'));
}

{
  const out = mappingProblems(FIELDS, { ...GOOD, arm: '' }, COLUMNS);
  check('a required field with no column is reported',
    out.length === 1 && out[0].field === 'arm');
  check('and it is named the way the field is labelled',
    out[0]?.message === 'Arm needs a column.', out[0]?.message);
}

{
  // The rule with teeth: the column was renamed by a regeneration.
  const out = mappingProblems(FIELDS, { ...GOOD, arm: 'intervention_name' }, COLUMNS);
  check('a mapped column the form no longer has is reported',
    out.length === 1 && out[0].field === 'arm', JSON.stringify(out));
  check('the message names the missing column, not a replacement',
    !!out[0]?.message.startsWith('intervention_name is mapped as arm'), out[0]?.message);
  check('no surviving column is substituted for it',
    !out[0]?.message.includes('intervention_detail'));
}

{
  // Both kinds at once, and both are reported.
  const out = mappingProblems(
    FIELDS, { ...GOOD, arm: '', outcome_domain: 'outcome_gone' }, COLUMNS);
  check('both kinds are reported together', out.length === 2,
    out.map(p => p.message).join('; '));
  check('required-missing comes first, because it is what the reviewer does next',
    out[0].field === 'arm' && out[1].field === 'outcome_domain');
}

{
  // An unmapped table: every required field, and nothing else.
  const out = mappingProblems(FIELDS, {}, COLUMNS);
  check('an empty mapping reports exactly the required fields',
    out.length === 2 && out.every(p => p.field === 'outcome_domain' || p.field === 'arm'),
    out.map(p => p.message).join('; '));
}

if (failures.length) {
  console.error(`FAILED ${failures.length} of ${passed + failures.length}`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`mappingProblems: ${passed} checks passed`);

/**
 * Kiersch 1994 — "Acute Dental Pain — Dichotomous Outcomes", R1 / R2 / AI rows
 * as stored in extraction_results on 28 Sep 2026 (values + statuses verbatim;
 * quotes and pages left out). Shared by entities.kiersch.check.mts and the
 * consensus browser probe.
 */

export const c = (v: string, s = 'reported') => ({ value: v, status: s, source_text: '' });
export const NR = () => c('NR', 'not_reported');
export const NA = () => c('NA', 'not_applicable');
const AI_NA = () => c('NA', 'not_reported'); // the AI writes NA with status not_reported
const POP = 'Surgical tooth extraction (third molar / wisdom teeth)';
const NAP = 'Naproxen 400-440 mg';
const ACE = 'Acetaminophen 500-1,000 mg';
export const PLA = 'Placebo / no treatment';
export const LONG = 'most of the events (>90%) were of mild or moderate se- verity. None of the events was consid- ered by the investigator to be probably related to the study drug. In all treat- ment groups, the most frequently re- ported adverse events were headache and nausea. ';
const RESCUE = 'Rescue analgesia at 6 hours';

type Cell = ReturnType<typeof c>;
export const row = (o: Record<string, Cell | string>) => {
  const out: Record<string, Cell> = { population_type: c(POP) };
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'string' ? c(v) : v;
  return out;
};

export const R1 = [
  row({ intervention: NAP, outcome_type: 'Adverse effects', followup_timepoint: NR(), intervention_detail: 'Naproxen 440mg', adverse_effect: LONG, adverse_effect_definition: LONG, outcome_other: NA(), n_analyzed: '92', events_n: NR(), events_pct: '34' }),
  row({ intervention: ACE, outcome_type: 'Adverse effects', followup_timepoint: NR(), intervention_detail: 'Acetaminophen 1000mg ', adverse_effect: LONG, adverse_effect_definition: LONG, outcome_other: NA(), n_analyzed: '89', events_n: NR(), events_pct: '29' }),
  row({ intervention: PLA, outcome_type: 'Adverse effects', followup_timepoint: NR(), intervention_detail: c('', 'not_reported'), adverse_effect: LONG, adverse_effect_definition: LONG, outcome_other: NA(), n_analyzed: '45', events_n: NR(), events_pct: '29' }),
];

const r2Rescue = (arm: string, detail: string, nA: string) =>
  row({ intervention: arm, outcome_type: RESCUE, followup_timepoint: '6 hours', intervention_detail: detail, adverse_effect: NA(), adverse_effect_definition: NA(), outcome_other: NA(), n_analyzed: nA, events_n: NR(), events_pct: NR() });
const r2Ae = (arm: string, detail: string, ae: string, nA: string, en: string, ep: string, early = false) =>
  row({ intervention: arm, outcome_type: 'Adverse effects', followup_timepoint: early ? NR() : NA(), intervention_detail: detail, adverse_effect: ae, adverse_effect_definition: NR(), outcome_other: early ? NA() : NR(), n_analyzed: nA, events_n: en, events_pct: ep });
export const R2 = [
  r2Rescue(NAP, ' Naproxen sodium', '92'), r2Rescue(ACE, 'Acetaminophen', '89'), r2Rescue(PLA, 'Placebo', '45'),
  r2Ae(NAP, ' Naproxen sodium', 'Nausea', '92', '13', '14', true),
  r2Ae(NAP, ' Naproxen sodium', 'vomiting', '92', '6', '7', true),
  r2Ae(NAP, ' Naproxen sodium', 'Headache', '92', '11', '12'),
  r2Ae(NAP, ' Naproxen sodium', 'Dizziness', '92', '4', '4'),
  r2Ae(NAP, ' Naproxen sodium', 'somnolence', '92', '1', '1'),
  r2Ae(ACE, 'Acetaminophen', ' Nausea', '91', '12', '13'),
  r2Ae(ACE, 'Acetaminophen', 'Vomiting', '91', '9', '10'),
  r2Ae(ACE, 'Acetaminophen', 'Headache', '91', '12', '13'),
  r2Ae(ACE, 'Acetaminophen', 'Dizziness', '91', '1', '1'),
  r2Ae(ACE, 'Acetaminophen', 'Somnolence', '91', '1', '1'),
  r2Ae(PLA, 'Placebo', 'Nausea', '45', '4', '9'),
  r2Ae(PLA, 'Placebo', 'Vomiting', '45', '2', '4'),
  r2Ae(PLA, 'Placebo', 'Headache', '45', '9', '20'),
  r2Ae(PLA, 'Placebo', 'Dizziness', '45', '1', '2'),
  r2Ae(PLA, 'Placebo', 'Somnolence', '45', '2', '4'),
];

const aiRescue = (arm: string, detail: Cell | string, nA: string, en: string, ep: string) =>
  row({ intervention: arm, outcome_type: RESCUE, followup_timepoint: '6 hours', intervention_detail: detail, adverse_effect: AI_NA(), adverse_effect_definition: AI_NA(), outcome_other: AI_NA(), n_analyzed: nA, events_n: en, events_pct: ep });
const aiAe = (arm: string, detail: Cell | string, ae: string, def: string, nA: string, en: string, ep: string) =>
  row({ intervention: arm, outcome_type: 'Adverse effects', followup_timepoint: '12 hours', intervention_detail: detail, adverse_effect: ae, adverse_effect_definition: def, outcome_other: AI_NA(), n_analyzed: nA, events_n: en, events_pct: ep });
const D_GI = 'Adverse events reported by patients in diaries during 12-hour study period; digestive system events including Nausea and Vomiting';
const D_H = 'Headache reported by patients in diaries during 12-hour study period (nervous system event)';
const D_D = 'Dizziness reported by patients in diaries during 12-hour study period (nervous system event)';
const D_S = 'Somnolence reported by patients in diaries during 12-hour study period (nervous system event); mapped to Drowsiness';
const arms: Array<[string, Cell | string, string, string[][]]> = [
  [NAP, 'Naproxen sodium 440 mg', '92', [['19', '20.65'], ['11', '12'], ['4', '4'], ['1', '1']]],
  [ACE, 'Acetaminophen 1000 mg', '91', [['21', '23.08'], ['12', '13'], ['1', '1'], ['1', '1']]],
  [PLA, AI_NA(), '45', [['6', '13.33'], ['9', '20'], ['1', '2'], ['2', '4']]],
];
export const AI = [
  aiRescue(NAP, 'Naproxen sodium 440 mg', '92', '41.40', '45'),
  aiRescue(ACE, 'Acetaminophen 1000 mg', '89', '74.76', '84'),
  aiRescue(PLA, AI_NA(), '45', '37.80', '84'),
  ...arms.flatMap(([arm, detail, nA, ev]) => [
    aiAe(arm, detail, 'Nausea/ vomiting', D_GI, nA, ev[0][0], ev[0][1]),
    aiAe(arm, detail, 'Headache', D_H, nA, ev[1][0], ev[1][1]),
    aiAe(arm, detail, 'Dizziness', D_D, nA, ev[2][0], ev[2][1]),
    aiAe(arm, detail, 'Drowsiness', D_S, nA, ev[3][0], ev[3][1]),
  ]),
];


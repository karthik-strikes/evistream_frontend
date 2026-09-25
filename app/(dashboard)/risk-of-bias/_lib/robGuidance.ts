/**
 * One-paragraph guidance per signalling question, shown under the Guidance
 * toggle. Copied VERBATIM from the iteration-2 design handoff (`guide()` in
 * the prototype), which derives it from the RoB 2 guidance (22 Aug 2019) and
 * the Cochrane RoB 2 FAQ. Domain 2 notes differ by effect: keyed `id:effect`.
 * Change the words only together with the handoff.
 */

import type { EffectOfInterest } from './rob2';

const GUIDANCE: Record<string, string> = {
  "1.1": "Random component: computer-generated sequence, random number table, coin toss, minimisation with a random element. Alternation, date of birth, or record number are not random.",
  "1.2": "Judge the concealment method itself (central allocation, sequentially numbered opaque sealed envelopes, pharmacy-controlled). Balanced baseline tables do not rescue poor concealment: unknown prognostic factors can still differ.",
  "1.3": "Count only imbalances that are not compatible with chance. Small trials and long baseline tables produce chance differences. Groups that are implausibly similar can also signal a problem.",
  "2.1": "A “double-blind” label is not enough on its own. Ask whether blinding was plausible here (identical placebo, no tell-tale side effects) and answer Probably yes / Probably no accordingly.",
  "2.2": "As for 2.1, for carers and people delivering the intervention. Open-label delivery of a drug or procedure usually means Yes.",
  "2.3:assignment": "Look for changes in care that happened because participants were in a trial: controls seeking the intervention after learning of it at consent, extra co-interventions, staff managing arms differently. Ordinary non-adherence is not a deviation here. Check the protocol’s anticipated-deviations list.",
  "2.3:adherence": "Balance of important non-protocol interventions across arms. Both trial-context deviations and everyday ones matter for the adhering effect.",
  "2.4:assignment": "Would the deviations in 2.3 plausibly have changed this outcome? Minor or outcome-irrelevant deviations do not.",
  "2.4:adherence": "Exclusions made by the investigators (e.g. dropping non-adherers for a naïve per-protocol analysis) belong here. Outcome data that should exist but are missing (drop-out, missed visits) belong in Domain 3. Do not count the same people twice.",
  "2.5:assignment": "Deviations that affected the outcome similarly in both arms do not bias the comparison.",
  "2.5:adherence": "Why people stopped matters: stopping because of adverse effects is a deviation; drifting away out of boredom generally is not.",
  "2.6:assignment": "About the analysis approach, not missing data (that is Domain 3). Appropriate: ITT, and modified ITT that excludes only participants with missing outcome data. Not appropriate: naïve per-protocol, as-treated, or excluding eligible participants after randomisation. Excluding participants found ineligible after randomisation is acceptable when eligibility could not be influenced by allocation.",
  "2.6:adherence": "A naïve per-protocol analysis is not an appropriate estimate of the effect of adhering: it removes people on prognosis-related grounds and loses the benefit of randomisation. Answer No. Appropriate methods (g-methods, instrumental variables) are rare.",
  "2.7": "How many participants were analysed in the wrong group or excluded, and how large a shift in the estimate could that produce? Small numbers with little potential impact → No.",
  "3.1": "No fixed threshold: 95% is an illustration, not a rule. Judge by the proportion missing, the outcome type and the event rate. Refers to this time point, and to both drop-outs and missed measurements. If numbers analysed are not reported, use the CONSORT diagram; Probably yes / Probably no is fine. Investigator exclusions belong in Domain 2.",
  "3.2": "Focus on the assumptions made about missing participants, not the method name. Look for “we assumed that…”. A sensitivity analysis must span the plausible range of outcomes the missing participants could have had. LOCF and most multiple imputation do not by themselves show absence of bias.",
  "3.3": "Could the reason for missingness relate to the participant’s true outcome (e.g. withdrawing because of lack of benefit or adverse effects)? Reasons given in the report matter more than the raw proportion.",
  "3.4": "Given 3.3, is it likely in this trial? Differential missingness between arms, or reasons tied to health status, point to Yes.",
  "4.1": "Inappropriate instrument for the construct, or an outcome measured only in a subset (e.g. ventilation days among those ventilated), which breaks randomisation and should be treated as exploratory.",
  "4.2": "Different methods, timing, or intensity of ascertainment between arms (e.g. more visits in the intervention arm).",
  "4.3": "If the report only says “double-blind” with nothing on assessors, answer NI or assume they were aware. For self-reported outcomes, the participant is the assessor; use the answer to 2.1.",
  "4.4": "Domain 4 is about how the outcome is portrayed or measured; Domain 2 is about behaviour that changes the true outcome. Do not penalise the same issue twice. Objective outcomes (death, lab values) are rarely influenced.",
  "4.5": "Not automatically Yes when assessors were aware. Judge whether influence is likely: subjective outcomes, or clinicians rating their own intervention, point to Yes.",
  "5.1": "No plan available → NI (or Probably no; both give Some concerns). Knowing an SAP existed but not seeing it does not help. Probably yes is acceptable when the outcome is reported the standard way for the field and there is no sign of selection. Check date stamps: was the plan fixed before unblinded data were available?",
  "5.2": "Judge against what your review protocol asked for. If the trial reports exactly the pre-specified measurement, answer No even if other scales or cut-offs were collected. If it reports a different measurement than you specified, Yes. With individual patient data, this domain is Low.",
  "5.3": "Same logic for analyses (adjusted vs unadjusted, subgroups, time windows). If the exact result you specified is available, what else was reported does not matter; you may override the algorithm to Low with a rationale.",
};

/** The note for a question under this effect; `''` when there is none. */
export function guidanceFor(id: string, effect: EffectOfInterest): string {
  return GUIDANCE[`${id}:${effect}`] || GUIDANCE[id] || '';
}

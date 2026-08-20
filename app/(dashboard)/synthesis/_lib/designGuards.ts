/**
 * Whether these studies should be in the same pool at all.
 *
 * Every other check on this screen asks whether the numbers are right. This one
 * asks whether combining them is legitimate, which no amount of arithmetic will
 * reveal: a split-mouth trial pooled as though its two arms were independent
 * groups double-counts its patients and overstates its precision, a risk ratio
 * from a case-control study is not a risk ratio at all, and an in-vitro result
 * averaged with a clinical one is not a meta-analysis of anything.
 *
 * Two design decisions here:
 *
 *  1. Advice, never enforcement. Nothing in this file changes a number — pooling
 *     across designs is sometimes exactly what a reviewer intends, and a tool that
 *     silently refused would be wrong more often than the reviewer is.
 *  2. The design column usually lives on a DIFFERENT form. In this corpus the
 *     outcome tables and the study-characteristics tables are separate forms, so a
 *     guard that only looked at the mapped table would never fire on real data.
 *     The caller joins by document id and hands the values in here.
 */

import type { EffectMeasure, StudyEffect } from '@/lib/metaAnalysis';

export type DesignCategory =
  | 'randomised'
  | 'quasi_randomised'
  | 'within_person'
  | 'cohort'
  | 'case_control'
  | 'cross_sectional'
  | 'preclinical'
  | 'unclear';

export const DESIGN_LABEL: Record<DesignCategory, string> = {
  randomised: 'Randomised, parallel groups',
  quasi_randomised: 'Quasi-randomised or non-randomised',
  within_person: 'Within-person (split-mouth or crossover)',
  cohort: 'Cohort',
  case_control: 'Case-control',
  cross_sectional: 'Cross-sectional',
  preclinical: 'Preclinical (in vitro / animal)',
  unclear: 'Not stated or unrecognised',
};

/**
 * Read a form's own design wording onto a category.
 *
 * Ordered most-specific first, because the real vocabularies overlap: "quasi-RCT"
 * contains "RCT", and "split mouth" is a randomised trial that must not be pooled
 * as a parallel one. Anything unrecognised is `unclear` rather than assumed —
 * guessing a design is how a guard becomes noise.
 */
export function classifyDesign(raw: string): DesignCategory {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'unclear';
  if (/split.?mouth|cross.?over|within.?(person|patient|subject)|paired/.test(v)) return 'within_person';
  if (/in ?vitro|in ?vivo|in ?silico|ex ?vivo|animal|murine|rat\b|mouse|preclinical|cadaver/.test(v)) {
    return 'preclinical';
  }
  if (/quasi|non.?random|nonrandom|not randomi|single.?arm|before.?after|uncontrolled/.test(v)) {
    return 'quasi_randomised';
  }
  if (/case.?control/.test(v)) return 'case_control';
  if (/cross.?section|prevalence survey|survey/.test(v)) return 'cross_sectional';
  if (/cohort|prospective|retrospective|longitudinal|registry/.test(v)) return 'cohort';
  if (/\brct\b|randomi|parallel|controlled trial|\bcct\b/.test(v)) return 'randomised';
  return 'unclear';
}

export interface DesignTally {
  category: DesignCategory;
  /** The raw values that landed in this category, for the reviewer to recognise. */
  values: string[];
  studies: string[];
}

export type GuardSeverity = 'blocking' | 'caution' | 'note';

export interface DesignGuard {
  severity: GuardSeverity;
  title: string;
  detail: string;
  /** Study labels the guard is about, for naming them rather than counting them. */
  studies: string[];
}

export interface DesignGuardResult {
  /** Null when no design information could be found at all. */
  tallies: DesignTally[] | null;
  guards: DesignGuard[];
  /** Studies with no design value, which is itself worth knowing. */
  unknownStudies: string[];
}

/**
 * `designByDocument` maps a document id to that study's design string. Studies
 * with no entry are counted as unknown rather than dropped: a guard that quietly
 * ignored half the corpus would be worse than no guard.
 */
export function designGuards(
  studies: StudyEffect[],
  designByDocument: Record<string, string>,
  measure: EffectMeasure,
): DesignGuardResult {
  if (studies.length === 0 || Object.keys(designByDocument).length === 0) {
    return { tallies: null, guards: [], unknownStudies: [] };
  }

  const byCategory = new Map<DesignCategory, DesignTally>();
  const unknownStudies: string[] = [];

  for (const s of studies) {
    const raw = designByDocument[s.documentId] ?? '';
    const category = classifyDesign(raw);
    if (category === 'unclear') unknownStudies.push(s.label);
    const entry = byCategory.get(category) ?? { category, values: [], studies: [] };
    if (raw && !entry.values.includes(raw)) entry.values.push(raw);
    entry.studies.push(s.label);
    byCategory.set(category, entry);
  }

  const tallies = [...byCategory.values()].sort((a, b) => b.studies.length - a.studies.length);
  const has = (c: DesignCategory) => byCategory.get(c);
  const guards: DesignGuard[] = [];

  // A risk or a rate cannot come out of a case-control study, whatever the
  // columns look like: the ratio of cases to controls was fixed by the
  // investigator, so neither margin estimates a population risk.
  const caseControl = has('case_control');
  if (caseControl && (measure === 'RR' || measure === 'RD')) {
    guards.push({
      severity: 'blocking',
      title: `A ${measure === 'RR' ? 'risk ratio' : 'risk difference'} cannot be estimated from a case-control study`,
      detail:
        `${caseControl.studies.length} of these studies ${caseControl.studies.length === 1 ? 'is' : 'are'} `
        + `case-control, where the case-to-control ratio was set by the investigator rather than by how `
        + `common the outcome is. Only an odds ratio survives that sampling. Switch the measure to OR, `
        + `or analyse these studies separately.`,
      studies: caseControl.studies,
    });
  }

  // Split-mouth and crossover trials are paired by design. Pooled as parallel
  // groups they contribute their patients twice and an interval that is too
  // narrow — and nothing on the plot shows it.
  const withinPerson = has('within_person');
  if (withinPerson) {
    const alsoParallel = has('randomised') || has('quasi_randomised') || has('cohort');
    guards.push({
      severity: alsoParallel ? 'caution' : 'note',
      title: 'Within-person designs are being treated as parallel groups',
      detail:
        `${withinPerson.studies.length} ${withinPerson.studies.length === 1 ? 'study is' : 'studies are'} `
        + `split-mouth or crossover, where both arms are the same patients. Pooling them from arm totals `
        + `counts each patient twice and ignores the within-patient correlation, so their weight and the `
        + `precision of the pooled estimate are both overstated`
        + (alsoParallel
          ? `. They are being pooled here alongside parallel-group studies, which compounds it — `
            + `consider a subgroup analysis by design, or excluding them.`
          : `. Every study here has that shape, so the pooled estimate is at least internally `
            + `consistent, but its interval is still narrower than the design supports.`),
      studies: withinPerson.studies,
    });
  }

  // Preclinical and clinical evidence answer different questions.
  const preclinical = has('preclinical');
  const clinicalCount = ['randomised', 'quasi_randomised', 'cohort', 'case_control', 'cross_sectional']
    .reduce((n, c) => n + (byCategory.get(c as DesignCategory)?.studies.length ?? 0), 0);
  if (preclinical && clinicalCount > 0) {
    guards.push({
      severity: 'blocking',
      title: 'Preclinical and clinical studies are in the same pool',
      detail:
        `${preclinical.studies.length} ${preclinical.studies.length === 1 ? 'study is' : 'studies are'} `
        + `in vitro or animal work, pooled here with ${clinicalCount} clinical `
        + `${clinicalCount === 1 ? 'study' : 'studies'}. A single average across the two does not estimate `
        + `anything: they measure different things in different subjects. Split them into separate `
        + `analyses.`,
      studies: preclinical.studies,
    });
  }

  // Randomised with non-randomised: poolable, but Cochrane's advice is to keep
  // them apart and compare, because confounding does not average out.
  if (has('randomised') && (has('quasi_randomised') || has('cohort'))) {
    const nonRandom = [
      ...(has('quasi_randomised')?.studies ?? []),
      ...(has('cohort')?.studies ?? []),
    ];
    guards.push({
      severity: 'caution',
      title: 'Randomised and non-randomised studies are being pooled together',
      detail:
        `${nonRandom.length} of these ${nonRandom.length === 1 ? 'study is' : 'studies are'} not `
        + `randomised. Their confounding does not average out against the randomised ones, so the usual `
        + `advice is to pool them separately and compare the two estimates rather than combining them `
        + `into one.`,
      studies: nonRandom,
    });
  }

  // A prevalence ratio and an incidence-based risk ratio are different quantities
  // wearing the same name.
  if ((measure === 'RR' || measure === 'PROP') && has('cross_sectional')
    && (has('cohort') || has('randomised'))) {
    guards.push({
      severity: 'note',
      title: 'Cross-sectional and longitudinal studies measure different quantities',
      detail:
        `A ratio from a cross-sectional study is a prevalence ratio — exposure and outcome observed at `
        + `the same moment — while a cohort or trial gives an incidence-based one. Both are valid; `
        + `pooling them means the average is of two different things, which belongs in the methods `
        + `section if it stays.`,
      studies: has('cross_sectional')!.studies,
    });
  }

  if (unknownStudies.length > 0 && unknownStudies.length < studies.length) {
    guards.push({
      severity: 'note',
      title: 'Some studies have no design recorded',
      detail:
        `${unknownStudies.length} of ${studies.length} studies have no usable design value, so the checks `
        + `above only cover the rest. That is a gap in the extraction rather than a property of the `
        + `studies.`,
      studies: unknownStudies,
    });
  }

  return { tallies, guards, unknownStudies };
}

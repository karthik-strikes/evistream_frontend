/**
 * The risk-of-bias instruments, as published.
 *
 * These are NOT read from a form. RoB 2 has five domains with fixed wording and
 * three judgments; that is decided by Cochrane, not by whoever built a form in
 * this project. Treating it as a user-designed schema is what let six forms in
 * this corpus drift into three different shapes, three different names for the
 * justification column, and a domain-judgment scale
 * (`Low / Probably Low / Probably High / High`) that RoB 2 does not define.
 *
 * A form is only ever the place judgments are *stored* — see `robAdapter.ts`,
 * which binds one of these instruments onto whatever shape a form happens to
 * have. The instrument is what the screen renders and what an export means.
 */

import type { Severity } from './robForm';

export type ToolId = 'rob2' | 'robins_i' | 'rob1';

export interface ToolDomain {
  /** Canonical short code shown in the grid header. */
  code: string;
  /** Canonical name, as the tool publishes it. */
  name: string;
  /**
   * How this domain is recognised in an existing form's column names. Written
   * against the vocabularies actually present in the corpus, including RoB 1
   * wording, because a form built for one tool often names things like another.
   */
  match: RegExp;
}

export interface RobTool {
  id: ToolId;
  name: string;
  note: string;
  domains: ToolDomain[];
  /** Judgments the tool defines, best to worst. */
  judgments: string[];
  /** Where each judgment sits on the shared traffic-light scale. */
  severity: Record<string, Severity>;
}

// ── RoB 2 ────────────────────────────────────────────────────────────────────

const ROB2_JUDGMENTS = ['Low risk of bias', 'Some concerns', 'High risk of bias'];

export const ROB2: RobTool = {
  id: 'rob2',
  name: 'RoB 2 — randomized trials (5 domains)',
  note: 'Current Cochrane standard (2019) for randomized trials. '
    + 'Judgments: Low risk of bias / Some concerns / High risk of bias. Overall = worst domain.',
  domains: [
    { code: 'D1', name: 'Randomization process', match: /randomi[sz]|sequence|allocation.*conceal|domain[_\s]?1|(^|_)d1(_|$)/i },
    { code: 'D2', name: 'Deviations from intended interventions', match: /deviation|blind.*(participant|personnel|clinical|operator)|domain[_\s]?2|(^|_)d2(_|$)/i },
    { code: 'D3', name: 'Missing outcome data', match: /missing|incomplete|attrition|domain[_\s]?3|(^|_)d3(_|$)/i },
    { code: 'D4', name: 'Measurement of the outcome', match: /measurement|blind.*(outcome|assess)|detection|domain[_\s]?4|(^|_)d4(_|$)/i },
    { code: 'D5', name: 'Selection of the reported result', match: /selectiv|reported[_\s]?result|domain[_\s]?5|(^|_)d5(_|$)/i },
  ],
  judgments: ROB2_JUDGMENTS,
  severity: {
    'Low risk of bias': 'low',
    'Some concerns': 'some',
    'High risk of bias': 'high',
  },
};

// ── ROBINS-I ─────────────────────────────────────────────────────────────────

export const ROBINS_I: RobTool = {
  id: 'robins_i',
  name: 'ROBINS-I — non-randomized studies (7 domains)',
  note: 'For non-randomized studies of interventions. '
    + 'Judgments: Low / Moderate / Serious / Critical, plus No information.',
  domains: [
    { code: 'D1', name: 'Confounding', match: /confound|domain[_\s]?1|(^|_)d1(_|$)/i },
    { code: 'D2', name: 'Selection of participants', match: /selection.*participant|participant.*select|domain[_\s]?2|(^|_)d2(_|$)/i },
    { code: 'D3', name: 'Classification of interventions', match: /classif|domain[_\s]?3|(^|_)d3(_|$)/i },
    { code: 'D4', name: 'Deviations from intended interventions', match: /deviation|domain[_\s]?4|(^|_)d4(_|$)/i },
    { code: 'D5', name: 'Missing data', match: /missing|incomplete|attrition|domain[_\s]?5|(^|_)d5(_|$)/i },
    { code: 'D6', name: 'Measurement of outcomes', match: /measurement|outcome.*measur|domain[_\s]?6|(^|_)d6(_|$)/i },
    { code: 'D7', name: 'Selection of the reported result', match: /selectiv|reported[_\s]?result|domain[_\s]?7|(^|_)d7(_|$)/i },
  ],
  judgments: ['Low', 'Moderate', 'Serious', 'Critical', 'No information'],
  severity: {
    Low: 'low',
    Moderate: 'some',
    Serious: 'high',
    Critical: 'high',
    'No information': 'none',
  },
};

// ── Cochrane RoB 1 ───────────────────────────────────────────────────────────

export const ROB1: RobTool = {
  id: 'rob1',
  name: 'Cochrane RoB 1 — legacy reviews (7 items)',
  note: 'The legacy tool, still used by many ongoing reviews. '
    + 'Judgments: Low risk / Unclear risk / High risk per item.',
  domains: [
    { code: 'I1', name: 'Random sequence generation', match: /random.*sequence|sequence.*generat/i },
    { code: 'I2', name: 'Allocation concealment', match: /allocation.*conceal|conceal/i },
    { code: 'I3', name: 'Blinding of participants and personnel', match: /blind.*(participant|personnel)/i },
    { code: 'I4', name: 'Blinding of outcome assessment', match: /blind.*(outcome|assessor|assessment)/i },
    { code: 'I5', name: 'Incomplete outcome data', match: /incomplete|attrition|missing/i },
    { code: 'I6', name: 'Selective reporting', match: /selectiv/i },
    { code: 'I7', name: 'Other bias', match: /other.*bias|other_source/i },
  ],
  judgments: ['Low risk', 'Unclear risk', 'High risk'],
  severity: {
    'Low risk': 'low',
    'Unclear risk': 'some',
    'High risk': 'high',
  },
};

export const TOOLS: RobTool[] = [ROB2, ROBINS_I, ROB1];

export function toolById(id: ToolId): RobTool {
  return TOOLS.find(t => t.id === id) ?? ROB2;
}

// ── Mapping a form's own vocabulary onto a tool's ────────────────────────────

/**
 * Read a judgment written in some other vocabulary as one of this tool's.
 *
 * The rule is deliberately conservative in one direction: anything that is not
 * unambiguously the best option and not unambiguously the worst becomes the
 * middle one. `Probably Low` therefore reads as "Some concerns", not "Low".
 * Over-stating a study's quality is the error that changes a conclusion;
 * under-stating it only costs a reviewer a second look.
 */
export function toCanonicalJudgment(raw: string, tool: RobTool): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  // Already speaking the tool's language.
  const exact = tool.judgments.find(j => j.toLowerCase() === text.toLowerCase());
  if (exact) return exact;

  const lower = text.toLowerCase();
  const best = tool.judgments[0];
  const worst = tool.judgments[tool.judgments.length - 1];
  const middle = tool.judgments[Math.min(1, tool.judgments.length - 1)];

  if (/^no information|^not reported|^nr$|^unknown/.test(lower)) {
    return tool.judgments.find(j => /no information/i.test(j)) ?? middle;
  }
  // "Probably low" must not collapse into "low" — hedged is not clean.
  if (/^probably|^possibly|^unclear|^some|^moderate/.test(lower)) return middle;
  if (/^low\b|^definitely low|^yes\b/.test(lower)) return best;
  if (/^high\b|^critical|^serious|^definitely high|^no\b/.test(lower)) return worst;
  return null;
}

/**
 * Write a tool judgment back into a form that speaks a different vocabulary.
 *
 * Returns null when the form offers **more than one** option meaning the same
 * canonical thing — `Some concerns` could be stored as either `Probably Low` or
 * `Probably High`, and silently picking one would be inventing a judgment the
 * reviewer never made. The caller disables that button and says why.
 */
export function toFormOption(
  canonical: string,
  formOptions: string[],
  tool: RobTool,
): { option: string } | { ambiguous: string[] } | null {
  if (formOptions.length === 0) return { option: canonical };

  const exact = formOptions.find(o => o.toLowerCase() === canonical.toLowerCase());
  if (exact) return { option: exact };

  const candidates = formOptions.filter(o => toCanonicalJudgment(o, tool) === canonical);
  if (candidates.length === 1) return { option: candidates[0] };
  if (candidates.length > 1) return { ambiguous: candidates };
  return null;
}

// ── Generating a conforming form ─────────────────────────────────────────────

const OUTCOME_FIELD = 'outcome_assessed';

/**
 * A form that stores this tool exactly — same domain names, same judgments,
 * one row per outcome.
 *
 * Created through the ordinary form API so everything downstream (dual review,
 * consensus, blinding, export) works with no special cases. The point of the
 * preset is that the storage matches the standard by construction, which is the
 * only way `toFormOption` above never has to refuse a write.
 */
export function presetFormFields(tool: RobTool) {
  const domainColumns = tool.domains.flatMap(d => {
    const slug = `${d.code.toLowerCase()}_${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    return [
      {
        field_name: `${slug}_judgment`,
        field_type: 'select',
        field_description: `${d.code} · ${d.name} — risk-of-bias judgment for this domain.`,
        options: [...tool.judgments],
        required: false,
      },
      {
        field_name: `${slug}_justification`,
        field_type: 'text',
        field_description:
          `Why this judgment for ${d.name.toLowerCase()}? Quote or paraphrase the paper.`,
        required: false,
      },
    ];
  });

  return [
    {
      field_name: 'first_author',
      field_type: 'text',
      field_description: 'First author of the study being assessed.',
    },
    {
      field_name: 'year',
      field_type: 'number',
      field_description: 'Publication year of the study being assessed.',
    },
    {
      field_name: 'risk_of_bias_assessments',
      field_type: 'array',
      field_description:
        'One row per outcome assessed for risk of bias. Risk of bias is judged per outcome, '
        + 'so create a separate row for each outcome this trial reports.',
      subform_fields: [
        {
          field_name: OUTCOME_FIELD,
          field_type: 'text',
          field_description: 'Which outcome this row assesses.',
        },
        ...domainColumns,
        {
          field_name: 'comments',
          field_type: 'text',
          field_description: 'Any further notes on this assessment.',
        },
      ],
    },
  ];
}

export function presetFormName(tool: RobTool): string {
  return tool.id === 'rob2'
    ? 'Risk of Bias 2 (RoB 2)'
    : tool.id === 'robins_i'
      ? 'Risk of Bias (ROBINS-I)'
      : 'Risk of Bias (Cochrane RoB 1)';
}

export function presetFormDescription(tool: RobTool): string {
  return `${tool.note} Generated from the built-in ${tool.id.toUpperCase()} preset, so the domains `
    + 'and judgments match the published instrument exactly.';
}

/**
 * Cochrane-style study identity: "Raslan 2021", "Polat 2005b".
 *
 * Reviewers name a study by first author + year. Every screen used to show
 * `document.filename`, which for an EndNote/RIS/PubMed import is the full
 * article title ("A single-tablet fixed-dose combination of racemic
 * ibuprofen/paracetamol in the management of...").
 *
 * MIRROR of `backend/utils/study_label.py` — the two must stay in sync, or an
 * exported CSV disagrees with the screen it was exported from. Same
 * arrangement as lib/absence.ts <-> utils/absence.py.
 *
 * Precedence (first hit wins):
 *   1. study_label      — a human typed it. Never overridden, never suffixed.
 *   2. filename pattern — "Raslan 2021.pdf" is already a curated study ID and
 *                         carries hand-assigned a/b suffixes no metadata
 *                         source can reproduce.
 *   3. first_author + pub_year  — from Crossref / PubMed / EndNote / RIS.
 *   4. registry id      — NCT number, then PMID.
 *   5. filename stem    — the fallback. Normal, not an error: metadata is
 *                         best-effort and ~19% of documents have none.
 */

/** A publication year we would actually believe. Bounded on purpose: it stops
 *  "Receipt-2456-8583-5984.pdf" from being read as a year. */
const YEAR = String.raw`(?:1[6-9]\d{2}|20\d{2})`;

/** A surname as it appears in a curated filename — multi-word and hyphenated
 *  forms are real names ("Steen Law 2000", "van Dijk 2005", "Al-Waili 2011"),
 *  and the unicode hyphens are ones that genuinely occur in stored filenames
 *  ("Abu‐Ta'a 2008"). */
const NAME = String.raw`[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’\-‐‑–]*(?:\s+[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’\-‐‑–]*){0,2}`;

const FILENAME_LABEL_RE = new RegExp(
  `^(${NAME})[\\s_,\\-]*(${YEAR})([a-z])?(?![0-9])`
);

const SUFFIXES = 'abcdefghijklmnopqrstuvwxyz';

/** The minimum shape this module needs. Deliberately not `Document` — several
 *  callers hold a partial row (a document map value, an export record). */
export interface LabelableDocument {
  id?: string;
  ref_id?: number | null;
  filename?: string | null;
  first_author?: string | null;
  pub_year?: string | null;
  study_label?: string | null;
  pmid?: string | null;
  nct_id?: string | null;
}

export function filenameStem(filename?: string | null): string {
  return (filename || '').trim().replace(/\.pdf$/i, '') || 'Untitled';
}

function labelFromFilename(filename?: string | null): string | null {
  if (!filename) return null;
  const stem = filename.trim().replace(/\.(pdf|txt|md|json|xml)$/i, '').replace(/_/g, ' ').trim();
  const match = FILENAME_LABEL_RE.exec(stem);
  if (!match) return null;
  const name = match[1].replace(/\s+/g, ' ').replace(/^[\s\-,]+|[\s\-,]+$/g, '');
  if (name.length < 2) return null;
  return `${name} ${match[2]}${match[3] || ''}`;
}

/** [label, isFixed] — `isFixed` is true only for a hand-typed study_label and
 *  for registry IDs, the labels that must never receive an automatic suffix. */
function deriveLabel(doc: LabelableDocument): [string | null, boolean] {
  const manual = (doc.study_label || '').trim();
  if (manual) return [manual, true];

  const fromFilename = labelFromFilename(doc.filename);
  if (fromFilename) return [fromFilename, false];

  const author = (doc.first_author || '').trim();
  const year = (doc.pub_year || '').trim();
  if (author && year) return [`${author} ${year}`, false];
  if (author) return [author, false];

  const nct = (doc.nct_id || '').trim();
  if (nct) return [nct, true];
  const pmid = (doc.pmid || '').trim();
  if (pmid) return [`PMID ${pmid}`, true];

  return [null, true];
}

/** `index`-th disambiguated form of `base`. Letters when the base ends in the
 *  year ("Polat 2005" -> "Polat 2005a"); when it already ends in a letter
 *  suffix, stacking another would read as a different plausible study ID
 *  ("Polat 2005ba"), so those get an unmistakable numeric marker. */
function suffixed(base: string, index: number): string {
  if (/\d$/.test(base)) {
    return index < SUFFIXES.length ? `${base}${SUFFIXES[index]}` : `${base}-${index + 1}`;
  }
  return index === 0 ? base : `${base} (${index + 1})`;
}

/**
 * Project-scoped labels keyed by document id, with Cochrane a/b/c suffixes for
 * collisions. Pass the documents of ONE project.
 *
 * Ordering is by `ref_id` so the suffix a document gets is stable across
 * reloads and across exports — a study ID that reshuffles when someone uploads
 * a new paper is worse than no ID. A label held by exactly one document is
 * emitted bare: a lone "Raslan 2021" never becomes "Raslan 2021a".
 */
export function buildLabelMap(documents: LabelableDocument[]): Record<string, string> {
  const docs = [...documents].sort((a, b) => {
    const ra = a.ref_id ?? Number.MAX_SAFE_INTEGER;
    const rb = b.ref_id ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });

  const counts: Record<string, number> = {};
  const manualLabels = new Set<string>();
  const derived = docs.map((d) => {
    const [label, fixed] = deriveLabel(d);
    if (label) {
      // Manual labels count toward the tally — a derived "Raslan 2021" sitting
      // next to a hand-typed one still needs to move — but are never the one
      // that moves.
      counts[label] = (counts[label] || 0) + 1;
      if (fixed) manualLabels.add(label);
    }
    return { id: String(d.id ?? ''), label, fixed, stem: filenameStem(d.filename) };
  });

  const seen: Record<string, number> = {};
  const out: Record<string, string> = {};
  for (const { id, label, fixed, stem } of derived) {
    if (!label) {
      out[id] = stem;
      continue;
    }
    if (fixed || (counts[label] || 0) < 2) {
      out[id] = label;
      continue;
    }
    let index = seen[label] || 0;
    let candidate = suffixed(label, index);
    while (manualLabels.has(candidate)) {   // never shadow a curated ID
      index += 1;
      candidate = suffixed(label, index);
    }
    seen[label] = index + 1;
    out[id] = candidate;
  }
  return out;
}

/**
 * Single-document label with no collision context — for the caller that holds
 * one row and no project list. Prefer buildLabelMap where the list is at hand:
 * this one cannot know that a second "Polat 2005" exists.
 */
export function documentLabel(doc?: LabelableDocument | null): string {
  if (!doc) return 'Untitled';
  const [label] = deriveLabel(doc);
  return label || filenameStem(doc.filename);
}

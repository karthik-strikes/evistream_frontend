/**
 * Matching a source_text quote against the values of a stored record.
 *
 * The old approach searched for the quote as a literal character run inside the
 * stored JSON (`raw.indexOf(q)`). That breaks in practice: sidecars are written
 * with `json.dumps(indent=2)`, so the file has newlines and indentation between
 * keys, while the model emits its quote on one line. Verified against a real
 * sidecar and two real quotes from the live DB — a quote spanning several keys
 * is not found at all, so the reviewer sees a quote with nothing highlighted.
 *
 * Matching against values instead makes formatting irrelevant, and turns those
 * JSON-shaped quotes into something useful: a quote that swept up
 * `"facility": "JBR Clinical Research", "city": "Salt Lake City", …` lights up
 * every field it came from.
 *
 * Kept as pure functions in their own module on purpose — this repo has no
 * frontend test runner, so isolating the logic is the only way to verify it
 * headlessly instead of by eye.
 */

/** Whitespace runs collapse and case is ignored — neither carries meaning here. */
export function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Quotes this short carry no signal worth highlighting. */
const MIN_QUOTE_LENGTH = 3;

/**
 * Minimum length for a value to be marked in the fallback pass. Guards against
 * marking incidental words: without it, "Pain" and "Participants" match any
 * quote that happens to contain them.
 */
const MIN_FRAGMENT_LENGTH = 4;

export type QuoteMatcher = (value: unknown) => boolean;

function collectLeaves(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined) return out;
  if (typeof node !== 'object') {
    const s = normalizeForMatch(String(node));
    if (s) out.push(s);
    return out;
  }
  if (Array.isArray(node)) node.forEach((v) => collectLeaves(v, out));
  else Object.values(node as Record<string, unknown>).forEach((v) => collectLeaves(v, out));
  return out;
}

/**
 * Build a matcher for one quote against one record, or null when there's
 * nothing to highlight (callers read null as "highlighting is off").
 *
 * Two passes, because the two containment directions are not equally
 * trustworthy and must not be mixed:
 *
 *   1. **The quote lives inside a field.** A quote lifted verbatim from one
 *      long value — the normal case. High precision, so if anything matches
 *      this way it is the answer and nothing else is marked.
 *   2. **The field is a piece of the quote.** Only reached when no single
 *      field contains the whole quote, i.e. the model stitched several fields
 *      together (the JSON-fragment case). Necessary, but loose: measured on a
 *      real record, running this pass unconditionally marked 18 fields for a
 *      clean one-sentence quote — "Pain", "RANDOMIZED" and "Participants" all
 *      appear inside it — where exactly one was correct. Hence the fallback.
 */
export function buildQuoteMatcher(record: unknown, quote: string | null | undefined): QuoteMatcher | null {
  const q = normalizeForMatch(String(quote ?? ''));
  if (q.length < MIN_QUOTE_LENGTH || q === 'nr') return null;

  const leaves = collectLeaves(record);

  const containers = new Set(leaves.filter((leaf) => leaf.includes(q)));
  const hits =
    containers.size > 0
      ? containers
      : new Set(leaves.filter((leaf) => leaf.length >= MIN_FRAGMENT_LENGTH && q.includes(leaf)));

  if (hits.size === 0) return null;

  return (value: unknown): boolean => {
    // Only leaves are marked. Marking a container would highlight a whole
    // branch and bury the specific field that actually matched.
    if (value === null || value === undefined || typeof value === 'object') return false;
    const v = normalizeForMatch(String(value));
    return v !== '' && hits.has(v);
  };
}

/**
 * Does anything inside this subtree match? Used to force a collapsed section
 * open — a hit buried in a section that starts closed (CT.gov `results` is
 * 24 KB and collapses by default) would otherwise be invisible.
 */
export function subtreeHasMatch(value: unknown, matches: QuoteMatcher): boolean {
  if (value === null || value === undefined || typeof value !== 'object') return matches(value);
  if (Array.isArray(value)) return value.some((item) => subtreeHasMatch(item, matches));
  return Object.values(value as Record<string, unknown>).some((item) => subtreeHasMatch(item, matches));
}

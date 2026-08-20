/**
 * Document tags — the user vocabulary stored on `documents.labels`.
 *
 * Tags are authored on the Documents screen and read everywhere a paper name
 * appears. These helpers exist so all seven of those screens agree on two
 * questions: what counts as a match when someone types, and what counts as a
 * match when someone clicks a chip.
 *
 * Case handling is deliberately split. Tag EQUALITY is case-sensitive, because
 * dedupe on the Documents screen is case-sensitive too — `COVID-19` and
 * `covid-19` really are two different tags there, and folding them here would
 * make one chip click select rows the Documents screen treats as differently
 * tagged. Free-text SEARCH stays case-insensitive, like every other search box
 * in the app.
 */

/** Tags off anything document-shaped, including rows carrying only a few fields. */
export function labelsOf(doc?: { labels?: string[] | null } | null): string[] {
  return doc?.labels ?? [];
}

/**
 * Free-text match over a paper's name and its tags.
 *
 * The name is passed separately rather than read off the document: half these
 * screens hold a raw filename and half hold an already-formatted study label,
 * and the search box should match whatever the row actually shows.
 */
export function docMatchesQuery(
  name: string | Array<string | null | undefined>,
  labels: string[] | null | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // An array, because rows now DISPLAY a study label ("Raslan 2021") while the
  // filename is only in the tooltip — and a reviewer types either one. Same set
  // the server matches in `list_documents`.
  const names = Array.isArray(name) ? name : [name];
  if (names.some(n => (n || '').toLowerCase().includes(q))) return true;
  return (labels ?? []).some(l => l.toLowerCase().includes(q));
}

/**
 * AND semantics: a row survives only if it carries EVERY active tag.
 *
 * AND, not OR, because the useful question is "the RCTs in adults", and OR
 * makes each extra tag widen the set — which reads as the filter not working.
 */
export function hasAllTags(labels: string[] | null | undefined, activeTags: string[]): boolean {
  if (activeTags.length === 0) return true;
  const owned = labels ?? [];
  return activeTags.every(t => owned.includes(t));
}

/** Every distinct tag across a document set, sorted, for filter bars and counts. */
export function collectTags(docs: Array<{ labels?: string[] | null }>): string[] {
  const seen = new Set<string>();
  for (const d of docs) for (const l of d.labels ?? []) seen.add(l);
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/** Tags as one line, for the dense grids that show them in a tooltip. */
export function tagsAsText(labels: string[] | null | undefined): string {
  return (labels ?? []).join(' · ');
}

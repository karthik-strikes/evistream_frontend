/**
 * Shared multi-tier quote matcher.
 *
 * Used by both the bbox-block matcher (`blockIndex.ts`) and the pdfjs
 * text-layer fallback (`PdfHighlightViewer.tsx` via `textLayerHighlight.ts`).
 *
 * Tiers (confidence in [0,1]):
 *   1.0  — exact substring (lowercase + whitespace-collapsed)
 *   0.7  — strip punctuation, retry
 *   0.6  — Levenshtein-tolerant sliding window over first 100 chars  ← NEW
 *   0.5  — first ≥15 chars of the quote (prefix anchor)
 *   0.3  — longest ≥6-char word from the quote (anchor word)  ← marked weak
 *   null — no overlap found
 *
 * Confidence < 0.5 is treated as low-trust by the UI (dashed outline +
 * "please verify" warning).
 */

export type MatchTier = 'exact' | 'normalized' | 'fuzzy' | 'prefix' | 'anchor';

export interface QuoteMatchResult {
  confidence: number;
  /** Approximate index inside `haystack` where the match begins. */
  index: number;
  /** What matched (the substring of the quote that hit). */
  needle: string;
  /** Which tier fired — useful for differentiated UI treatment. */
  tier: MatchTier;
}

const NORM = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Classic Levenshtein with early-exit when the running min row distance
 * already exceeds `maxDist`. Returns Infinity if exceeded — that lets callers
 * skip windows quickly without computing the full matrix.
 */
function levenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return Infinity;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Two-row DP buffer.
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,         // deletion
        curr[j - 1] + 1,     // insertion
        prev[j - 1] + cost,  // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDist) return Infinity;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

/**
 * Slide a window of `needle.length ± 10%` over `haystack`, return the index
 * of the window with the smallest Levenshtein distance to `needle` *if* that
 * distance ≤ ratio threshold. Otherwise null.
 */
function slidingLevenshtein(
  haystack: string,
  needle: string,
  similarityThreshold = 0.85,
): { index: number; distance: number } | null {
  if (!haystack || !needle) return null;
  const nLen = needle.length;
  if (nLen < 20) return null; // not worth it for short needles
  const maxDist = Math.floor(nLen * (1 - similarityThreshold));
  // Window length spans ±10% around needle length.
  const minWin = Math.max(1, Math.floor(nLen * 0.9));
  const maxWin = Math.ceil(nLen * 1.1);
  // Step in increments of ~maxDist+1 so we don't miss matches but stay fast.
  const step = Math.max(1, Math.floor(maxDist / 2));

  let best: { index: number; distance: number } | null = null;
  for (let i = 0; i + minWin <= haystack.length; i += step) {
    for (let w = minWin; w <= maxWin && i + w <= haystack.length; w += step) {
      const window = haystack.slice(i, i + w);
      const d = levenshtein(window, needle, maxDist);
      if (d <= maxDist && (best === null || d < best.distance)) {
        best = { index: i, distance: d };
        if (d === 0) return best;
      }
    }
  }
  return best;
}

export function matchQuote(haystack: string, quote: string): QuoteMatchResult | null {
  if (!haystack || !quote) return null;
  const q = quote.trim();
  if (!q || q === 'NR') return null;

  const qNorm = NORM(q);
  if (!qNorm) return null;
  const hNorm = NORM(haystack);
  if (!hNorm) return null;

  // Tier 1: exact substring after normalization.
  let idx = hNorm.indexOf(qNorm);
  if (idx >= 0) return { confidence: 1.0, index: idx, needle: qNorm, tier: 'exact' };

  // Tier 2: strip non-alphanum punctuation, retry.
  const stripPunct = (s: string) => s.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const qStripped = stripPunct(qNorm);
  const hStripped = stripPunct(hNorm);
  if (qStripped && hStripped) {
    idx = hStripped.indexOf(qStripped);
    if (idx >= 0) return { confidence: 0.7, index: idx, needle: qStripped, tier: 'normalized' };
  }

  // Tier 2.5 (NEW): Levenshtein-tolerant window over first 100 chars of quote.
  // Handles single-char OCR errors ("Twenty-seven" vs "Two-seven", glyph
  // dropouts, ligature differences, etc.) that survive whitespace + punctuation
  // normalization.
  const fuzzNeedle = qNorm.slice(0, Math.min(100, qNorm.length));
  if (fuzzNeedle.length >= 20) {
    const fz = slidingLevenshtein(hNorm, fuzzNeedle, 0.85);
    if (fz) return { confidence: 0.6, index: fz.index, needle: fuzzNeedle, tier: 'fuzzy' };
  }

  // Tier 3: prefix anchor — first 60 chars of the quote.
  const prefix = qNorm.slice(0, Math.min(60, qNorm.length));
  if (prefix.length >= 15) {
    idx = hNorm.indexOf(prefix);
    if (idx >= 0) return { confidence: 0.5, index: idx, needle: prefix, tier: 'prefix' };
  }

  // Tier 4: longest word — *weak*. UI should warn and use dashed outline.
  const words = qNorm.split(/\s+/).filter((w) => w.length >= 6);
  words.sort((a, b) => b.length - a.length);
  const anchor = words[0];
  if (anchor) {
    idx = hNorm.indexOf(anchor);
    if (idx >= 0) return { confidence: 0.3, index: idx, needle: anchor, tier: 'anchor' };
  }

  return null;
}

/** True when the fragment text overlaps the quote enough to merit highlighting. */
export function fragmentOverlapsQuote(fragment: string, quote: string): boolean {
  if (!fragment || !quote) return false;
  const fNorm = NORM(fragment);
  const qNorm = NORM(quote);
  if (!fNorm || !qNorm) return false;

  if (fNorm.length < 8) {
    if (fNorm.length < 4) return false;
    return qNorm.includes(fNorm);
  }

  return qNorm.includes(fNorm) || fNorm.includes(qNorm.slice(0, Math.min(40, qNorm.length)));
}

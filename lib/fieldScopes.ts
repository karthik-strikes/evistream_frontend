/**
 * What a table column is a property of.
 *
 * A systematic-review table stores one row per combination — arm × scale ×
 * timepoint — so most of a row's columns repeat values that belong to something
 * larger than the row. "Population type" is a property of the *study*. "Scale
 * range" is a property of the *scale*. Only a handful actually vary per row.
 *
 * Each column therefore declares its scope:
 *
 *     'study' | 'group:<any name>' | 'row'          (absent ⇒ 'row')
 *
 * The group names are the form's own — an outcomes form declares `arm` and
 * `scale`, a harms form declares `arm` and `adverse effect`, a form with
 * nothing repeating declares none — and live on the table field as `groups`.
 *
 * This module is only the vocabulary, and it is shared on purpose: the form
 * builder writes these tags and the manual extraction form reads them, and a
 * second definition of what `group:` means is how the two would drift. The
 * projection over stored rows lives with the reviewer form, in
 * `manual-extraction/_lib/linkedGroups.ts`.
 */

import type { FormField } from '@/types/api';

export const SCOPE_STUDY = 'study';
export const SCOPE_ROW = 'row';
export const GROUP_PREFIX = 'group:';

/** Chips for groups. Mid-tone on purpose — each has to carry white text on a
 *  light card and stay legible on a dark one, and group names are user-supplied
 *  so no Tailwind class can be written for them ahead of time. */
export const GROUP_PALETTE = ['#7c3aed', '#b45309', '#0f766e', '#be185d', '#4d7c0f'];
export const STUDY_COLOR = '#0e7490';
export const ROW_COLOR = '#4b5563';

const norm = (v: any): string => (v == null ? '' : String(v)).trim();

export const groupScope = (name: string) => GROUP_PREFIX + norm(name);

/** What one column is a property of. Anything unrecognised — including a column
 *  that predates scopes entirely — is per-row, which is what every column did
 *  before this existed. */
export function scopeOf(col: FormField): string {
  const raw = (col as any).scope;
  if (typeof raw !== 'string') return SCOPE_ROW;
  const s = raw.trim();
  if (s === SCOPE_STUDY) return SCOPE_STUDY;
  if (s.startsWith(GROUP_PREFIX) && norm(s.slice(GROUP_PREFIX.length))) {
    return groupScope(s.slice(GROUP_PREFIX.length));
  }
  return SCOPE_ROW;
}

/** The group names this field declares, plus any a column names that the list
 *  has lost. Honouring the column matters: a group dropped from the list while
 *  its columns still point at it would otherwise silently demote those columns
 *  to per-row, which is exactly the retyping scopes exist to remove. */
export function groupsOf(field: FormField): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: any) => {
    const name = norm(raw);
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  };
  const declared = (field as any).groups;
  if (Array.isArray(declared)) declared.forEach(push);
  for (const col of field.subform_fields ?? []) {
    const raw = (col as any).scope;
    if (typeof raw === 'string' && raw.startsWith(GROUP_PREFIX)) push(raw.slice(GROUP_PREFIX.length));
  }
  return out;
}

/** True when this field has anything shared to lift out of its rows. A field
 *  where everything varies per row is the flat table, untouched. */
export function isLinkedTable(field: FormField): boolean {
  return (field.subform_fields ?? []).some(c => scopeOf(c) !== SCOPE_ROW);
}

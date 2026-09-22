/**
 * What is wrong with the column mapping on screen right now.
 *
 * Two rules, and they live here rather than inside `ColumnMapper` because both
 * are about the DRAFT — they have to stay true while a reviewer edits, which
 * the server's own warnings cannot, having judged a mapping that no longer
 * exists. Everything needing a pass over the extraction rows stays on the
 * server; a count of affected rows for a mapping the reviewer has since
 * changed is worse than no count at all.
 *
 * The second rule is the one with teeth. A regenerated form can drop or rename
 * a column while the confirmed mapping still names the old one, and the
 * tempting repair — quietly map the nearest surviving column — re-points every
 * result the form produces with nothing on screen to say so. Naming the gap and
 * refusing to confirm is the whole behaviour.
 *
 * Mirrors `rob_mapping.mapping_warnings` for these two cases; the server is
 * authoritative and re-checks on confirm.
 */

export interface MappingField {
  id: string;
  label: string;
  required?: boolean;
}

export interface MappingProblem {
  /** Which field the problem is about, for anchoring the message to a row. */
  field: string;
  message: string;
}

/**
 * @param fields  every field the screen offers, main and additional
 * @param draft   the mapping as edited, role id -> column name
 * @param columns the columns the form actually has
 */
export function mappingProblems(
  fields: MappingField[],
  draft: Record<string, string>,
  columns: string[],
): MappingProblem[] {
  const present = new Set(columns);
  const out: MappingProblem[] = [];

  for (const field of fields) {
    const column = (draft[field.id] ?? '').trim();
    if (field.required && !column) {
      out.push({ field: field.id, message: `${field.label} needs a column.` });
    }
  }

  for (const field of fields) {
    const column = (draft[field.id] ?? '').trim();
    if (column && !present.has(column)) {
      out.push({
        field: field.id,
        message: `${column} is mapped as ${field.label.toLowerCase()}, but this form no longer `
          + 'has that column. Choose another.',
      });
    }
  }

  return out;
}

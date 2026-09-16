/**
 * Reviewer-supplied source quotes for manual extraction.
 *
 * A reviewer selects a passage in the PDF and attaches it to the field they are
 * filling. That produces the `reviewer_supplied` evidence state — the strongest
 * provenance the system can hold, because a person pointed at the page.
 *
 * The backend already accepts this: `POST /results/manual` passes each cell
 * through `utils/provenance.merge_cell`, which detects a `{value, source_text,
 * source_location}` payload and stamps `grounding_method: "human_selected"`.
 * Nothing server-side needs to change — this module only has to produce that
 * shape and key it back to the right cell.
 *
 * Why keys are strings, not a nested structure: a table cell is identified by
 * (field, row index, column), and a flat key survives rows being added and
 * removed far more simply than a parallel nested object would. Deletions are
 * reconciled at save time by `pruneSources`.
 */

// Rectangles are read by every evidence screen, not just this one.
export { boxesFromLocation, hasShowableEvidence, type EvidenceBoxes } from '@/lib/sourceBoxes';
import { boxesFromLocation, type EvidenceBoxes } from '@/lib/sourceBoxes';

/** Geometry of a selection, in the coordinate space named by page_width/height. */
export interface SourceBox {
  /** 0-indexed, matching the AI path's `bboxes[].page`. */
  page: number;
  /** [x0, y0, x1, y1], origin top-left — the space `lib/blockIndex.bboxToViewport` expects. */
  bbox: [number, number, number, number];
}

export interface SourceLocation {
  /** 1-indexed page, matching the AI path's `source_location.page`. */
  page: number;
  bboxes: SourceBox[];
  /** The space `bboxes` are expressed in. Recorded so a consumer never has to
   *  guess whether these are PDF points or rendered pixels. */
  page_width: number;
  page_height: number;
  matched_text: string;
  confidence: number;
  /** Never "quote_exact" — a human selection is its own kind of evidence and
   *  must not be dressed up as a model quote. Mirrors the rule the figure
   *  provenance work established for chart readings. */
  grounding_method: 'human_selected';
}

export interface AttachedSource {
  source_text: string;
  source_location: SourceLocation;
}

/** What the PDF viewer hands back when a reviewer confirms a selection. */
export interface SelectedQuote {
  text: string;
  page: number;
  location: SourceLocation;
}

export type SourceMap = Record<string, AttachedSource>;

/** One quote that can be pointed at in the PDF — the reviewer's, or the AI's. */
export interface CellEvidence {
  text: string;
  /** 1-indexed. Null when the row records a quote but no page. */
  page: number | null;
  /** Set when the value was read off a chart: the picture is the only honest
   *  thing to highlight (see project figure-source provenance). */
  figureImage?: string | null;
  /** Stored geometry, when the space it lives in is recorded. */
  boxes?: EvidenceBoxes | null;
}


export type EvidenceMap = Record<string, CellEvidence>;

// ── keys ─────────────────────────────────────────────────────────────────────

export function scalarKey(fieldName: string): string {
  return fieldName;
}

export function tableCellKey(fieldName: string, rowIdx: number, column: string): string {
  return `${fieldName}[${rowIdx}].${column}`;
}

const TABLE_KEY_RE = /^(.+)\[(\d+)\]\.(.+)$/;

export function parseKey(
  key: string,
): { field: string; row: number; column: string } | { field: string } {
  const m = TABLE_KEY_RE.exec(key);
  if (!m) return { field: key };
  return { field: m[1], row: Number(m[2]), column: m[3] };
}

/** Human-readable target for the "attach to…" button in the viewer. */
export function describeKey(key: string): string {
  const p = parseKey(key);
  const pretty = (s: string) => s.replace(/_/g, ' ');
  return 'row' in p ? `${pretty(p.column)} · row ${p.row + 1}` : pretty(p.field);
}

// ── which cells still owe a source ───────────────────────────────────────────

/**
 * A cell needs a source when the reviewer put a value there that the AI did not.
 *
 * Deliberately narrow. A value the reviewer left exactly as the AI extracted it
 * already keeps the AI's quote (the backend records it `inherited`), so asking
 * for a quote there would be busywork — and asking for 30 quotes per paper is
 * how this feature gets switched off. Absence answers (NR/NA) are excluded too:
 * they assert the paper is silent, and there is no passage to point at.
 */
export function needsSource(
  value: unknown,
  aiOriginal: unknown,
  hasSource: boolean,
): boolean {
  if (hasSource) return false;
  const v = value == null ? '' : String(value).trim();
  if (!v) return false;
  const upper = v.toUpperCase();
  if (upper === 'NR' || upper === 'NA' || upper === 'N/A' || upper === 'N/R') return false;
  const original = aiOriginal == null ? '' : String(aiOriginal).trim();
  if (!original) return true;                       // reviewer typed it from scratch
  return v.toLowerCase() !== original.toLowerCase(); // reviewer changed the AI's value
}

/** Every key still owing a source, in form order, for the counter and the jump. */
export function unsourcedKeys(
  formData: Record<string, any>,
  aiOriginal: Record<string, any>,
  sources: SourceMap,
  /** Cells whose saved row already carries evidence (see `evidencedKeys`). */
  alreadyEvidenced?: Set<string>,
  /** Which table cells the reviewer can actually reach. On a grouped table a
   *  shared value is stamped onto every row it describes but rendered once, so
   *  without this the counter asked for the same quote twenty times and could
   *  never reach zero. See `linkedGroups.reachableCellFilter`. */
  reachable?: (field: string, rowIdx: number, column: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const [field, value] of Object.entries(formData)) {
    if (field.startsWith('_')) continue;
    if (Array.isArray(value)) {
      const originalRows: any[] = Array.isArray(aiOriginal[field]) ? aiOriginal[field] : [];
      value.forEach((row, rowIdx) => {
        if (!row || typeof row !== 'object') return;
        for (const [column, cell] of Object.entries(row)) {
          if (reachable && !reachable(field, rowIdx, column)) continue;
          const key = tableCellKey(field, rowIdx, column);
          const original = originalRows[rowIdx]?.[column];
          if (needsSource(cell, original, key in sources || !!alreadyEvidenced?.has(key))) out.push(key);
        }
      });
    } else {
      const key = scalarKey(field);
      if (needsSource(value, aiOriginal[field], key in sources || !!alreadyEvidenced?.has(key))) out.push(key);
    }
  }
  return out;
}

/**
 * Drop sources whose cell no longer exists — a reviewer who deletes a table row
 * would otherwise ship a quote keyed to a row index that now holds different
 * data, silently attributing one row's evidence to another.
 */
export function pruneSources(formData: Record<string, any>, sources: SourceMap): SourceMap {
  const out: SourceMap = {};
  for (const [key, src] of Object.entries(sources)) {
    const p = parseKey(key);
    if ('row' in p) {
      const rows = formData[p.field];
      if (Array.isArray(rows) && rows[p.row] && p.column in rows[p.row]) out[key] = src;
    } else if (p.field in formData) {
      out[key] = src;
    }
  }
  return out;
}

/**
 * Fold attached sources into the save payload.
 *
 * Cells with a source become `{value, source_text, source_location}`; everything
 * else stays exactly as it was, so the payload is unchanged for a reviewer who
 * never uses the feature.
 */
export function applySources(
  formData: Record<string, any>,
  sources: SourceMap,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [field, value] of Object.entries(formData)) {
    if (Array.isArray(value)) {
      out[field] = value.map((row, rowIdx) => {
        if (!row || typeof row !== 'object') return row;
        const merged: Record<string, any> = {};
        for (const [column, cell] of Object.entries(row)) {
          const src = sources[tableCellKey(field, rowIdx, column)];
          merged[column] = src ? { value: cell, ...src } : cell;
        }
        return merged;
      });
    } else {
      const src = sources[scalarKey(field)];
      out[field] = src ? { value: value, ...src } : value;
    }
  }
  return out;
}

// ── reopening a saved extraction ─────────────────────────────────────────────

/**
 * Which cells in a *saved* row already carry evidence, so reopening the form
 * does not nag for a source that is already recorded.
 *
 * Any evidence state except `unverified` counts: `inherited` and `reanchored`
 * were established server-side and are just as real as a quote the reviewer
 * picked, and `none` means the value is an absence answer with nothing to point
 * at. Only `unverified` genuinely still owes evidence.
 */
export function evidencedKeys(extracted: Record<string, any> | null | undefined): Set<string> {
  const out = new Set<string>();
  const state = (cell: any): string | undefined =>
    cell && typeof cell === 'object' ? cell.provenance?.evidence_state : undefined;

  for (const [field, cell] of Object.entries(extracted ?? {})) {
    if (field.startsWith('_')) continue;
    const rows = cell && typeof cell === 'object' ? (cell as any).value : undefined;
    if (Array.isArray(rows)) {
      rows.forEach((row, rowIdx) => {
        if (!row || typeof row !== 'object') return;
        for (const [column, sub] of Object.entries(row)) {
          const s = state(sub);
          if (s && s !== 'unverified') out.add(tableCellKey(field, rowIdx, column));
        }
      });
      continue;
    }
    const s = state(cell);
    if (s && s !== 'unverified') out.add(scalarKey(field));
  }
  return out;
}

/**
 * Re-hydrate the reviewer's own attached quotes from a saved row, so the "p.N"
 * chips come back when they reopen the form.
 *
 * Only `reviewer_supplied` cells: an inherited or re-anchored quote is not the
 * reviewer's assertion, and re-posting it as one would relabel the AI's evidence
 * as human-selected on the next save.
 */
export function sourcesFromSaved(extracted: Record<string, any> | null | undefined): SourceMap {
  const out: SourceMap = {};
  const take = (key: string, cell: any) => {
    if (!cell || typeof cell !== 'object') return;
    if (cell.provenance?.evidence_state !== 'reviewer_supplied') return;
    if (!cell.source_text && !cell.source_location) return;
    out[key] = {
      source_text: String(cell.source_text ?? ''),
      source_location: cell.source_location as SourceLocation,
    };
  };

  for (const [field, cell] of Object.entries(extracted ?? {})) {
    if (field.startsWith('_')) continue;
    const rows = cell && typeof cell === 'object' ? (cell as any).value : undefined;
    if (Array.isArray(rows)) {
      rows.forEach((row, rowIdx) => {
        if (!row || typeof row !== 'object') return;
        for (const [column, sub] of Object.entries(row)) {
          take(tableCellKey(field, rowIdx, column), sub);
        }
      });
      continue;
    }
    take(scalarKey(field), cell);
  }
  return out;
}

// ── the AI's own evidence ────────────────────────────────────────────────────

/**
 * A reviewer in AI-assisted mode is checking values somebody else produced, and
 * the evidence for those values was stored but never shown — the only chips on
 * screen were the reviewer's own. These two functions surface the AI's quote
 * next to the value it produced, so "is this right?" is answerable without
 * hunting through the PDF.
 *
 * Table cells are held per row *with the row's identity* rather than by
 * position: the reviewer can reorder, insert and delete rows, and a positional
 * pointer would then cite the wrong row's quote — worse than showing none.
 */

function cellEvidence(cell: any): CellEvidence | null {
  if (!cell || typeof cell !== 'object') return null;
  const loc = (cell as any).source_location;
  const text = typeof (cell as any).source_text === 'string' ? (cell as any).source_text : '';
  const page = typeof loc?.page === 'number' ? loc.page : null;
  const boxes = boxesFromLocation(loc);
  if (!text && page == null && !boxes) return null;
  return { text, page, figureImage: loc?.figure_image ?? null, boxes };
}

/** Composite key of a table field, either spelling. Mirrors
 *  `utils/table_schema.field_key_columns`: `key_columns` wins, `anchor_columns`
 *  is the legacy name still carried by live forms.
 *
 *  Restricted to the columns the field actually declares. A live form's key
 *  lists `outcome_other`, which the extractor still produces — a sibling
 *  column's description asks for it — but which the form does not render. Rows
 *  on screen are built from `subform_fields`, so they *cannot* carry it, and
 *  leaving it in the key made every on-screen row fail to match the AI's: not
 *  one table cell of that form ever showed the model's citation. */
export function keyColumnsOfField(field: any): string[] {
  const raw = field?.key_columns ?? field?.anchor_columns;
  const named: string[] = Array.isArray(raw) ? raw.filter((c: any) => typeof c === 'string') : [];
  const declared = Array.isArray(field?.subform_fields)
    ? new Set(field.subform_fields.map((sf: any) => sf?.field_name).filter(Boolean))
    : null;
  return declared ? named.filter(c => declared.has(c)) : named;
}

/**
 * Identity of one row under its composite key. Null when the field has no key,
 * or when every key cell is blank — the caller then falls back to position.
 *
 * Mirrors `provenance._row_key`, deliberately: the same row is matched against
 * its baseline server-side, and the two rules disagreed. This one used to bail
 * on the *first* blank key cell, so on a 13-column key a single gap anywhere
 * dropped the row out of every keyed match, while Python happily keyed it. A
 * blank cell now contributes nothing without voiding the identity.
 */
export function rowIdentity(row: any, keyCols: string[]): string | null {
  if (!keyCols.length || !row || typeof row !== 'object') return null;
  const parts: string[] = [];
  let anyValue = false;
  for (const col of keyCols) {
    const cell = (row as any)[col];
    const raw = cell && typeof cell === 'object' && 'value' in cell ? (cell as any).value : cell;
    const s = (raw == null ? '' : String(raw)).trim().toLowerCase();
    if (s) anyValue = true;
    parts.push(s);
  }
  return anyValue ? parts.join('\u00a7') : null;
}

export interface AiTableEvidence {
  keyCols: string[];
  rows: Array<{ identity: string | null; cells: EvidenceMap }>;
}

export interface AiEvidence {
  scalars: EvidenceMap;
  tables: Record<string, AiTableEvidence>;
}

/** Pull every quote out of the AI extraction row, as stored. */
export function aiEvidenceFromRow(
  raw: Record<string, any> | null | undefined,
  tableFields: Array<Record<string, any>>,
): AiEvidence {
  const scalars: EvidenceMap = {};
  const tables: Record<string, AiTableEvidence> = {};
  const defByName = new Map(tableFields.map(f => [f.field_name, f]));

  for (const [field, cell] of Object.entries(raw ?? {})) {
    if (field.startsWith('_')) continue;
    const name = field.endsWith('.value') ? field.slice(0, -6) : field;
    const def = defByName.get(name);
    // Live rows hold either the `{value: [...]}` envelope or, on older saves, a
    // bare list. Both are tables.
    const rows = Array.isArray(cell)
      ? cell
      : cell && typeof cell === 'object' ? (cell as any).value : undefined;

    if (def && Array.isArray(rows)) {
      const keyCols = keyColumnsOfField(def);
      tables[name] = {
        keyCols,
        rows: rows.map((row: any) => {
          const cells: EvidenceMap = {};
          if (row && typeof row === 'object') {
            for (const [col, sub] of Object.entries(row)) {
              const ev = cellEvidence(sub);
              if (ev) cells[col] = ev;
            }
          }
          return { identity: rowIdentity(row, keyCols), cells };
        }),
      };
      continue;
    }

    const ev = cellEvidence(cell);
    if (ev) scalars[scalarKey(name)] = ev;
  }

  return { scalars, tables };
}

/** Map the AI's evidence onto the rows as they currently stand on screen. */
export function resolveAiEvidence(
  ai: AiEvidence,
  formData: Record<string, any> | null | undefined,
): EvidenceMap {
  const out: EvidenceMap = { ...ai.scalars };

  for (const [field, table] of Object.entries(ai.tables)) {
    const current = Array.isArray(formData?.[field]) ? formData![field] : [];
    const used = new Set<number>();

    current.forEach((row: any, idx: number) => {
      const identity = rowIdentity(row, table.keyCols);
      let aiIdx = -1;
      if (identity) {
        aiIdx = table.rows.findIndex((r, i) => r.identity === identity && !used.has(i));
      } else if (!table.keyCols.length && idx < table.rows.length && !used.has(idx)) {
        // No composite key to match on: position is all there is.
        aiIdx = idx;
      }
      // A keyed row that matches nothing the AI reported is the reviewer's own —
      // it has no AI evidence, and inventing one would cite another row.
      if (aiIdx < 0) return;
      used.add(aiIdx);
      for (const [col, ev] of Object.entries(table.rows[aiIdx].cells)) {
        out[tableCellKey(field, idx, col)] = ev;
      }
    });
  }

  return out;
}

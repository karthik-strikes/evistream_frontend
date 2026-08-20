/**
 * Long-format transformation for extraction results.
 *
 * Converts per-paper extraction results into a flat long-format table
 * where each row represents one entry from the deepest table field
 * (e.g., one outcome measurement), with flat fields and parent table
 * fields (e.g., interventions) joined and repeated on every row.
 */

import { displayLabel } from './absence';
import { buildLabelMap, filenameStem } from './documentLabel';
import type { FormField } from '@/types/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldClassification {
  flatFields: FormField[];
  tableFields: FormField[];
  deepestTableField: FormField | null;
  parentTableFields: FormField[];
}

export interface LongFormatRow {
  _paperFilename: string;
  _resultId: string;
  _documentId: string;
  /** Which model produced this row, for the paper cell's badge. Null on manual rows. */
  _modelName?: string | null;
  /** 'ai' | 'manual' | 'consensus' — drives the "Manual" badge. */
  _extractionType?: string | null;
  /** Raw wrapped cell envelopes ({value, source_text, ...}) keyed by column name —
   *  used by the renderer to surface per-cell source evidence. */
  _rawCells?: Record<string, any>;
  [key: string]: any;
}

export interface LongFormatResult {
  columns: string[];
  rows: LongFormatRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatArray(arr: any[]): string {
  if (arr.length === 0) return '';
  if (arr.every(d => typeof d === 'string' || typeof d === 'number' || typeof d === 'boolean')) {
    return arr.join(', ');
  }
  const items = arr.map(item => {
    if (item == null) return '';
    if (typeof item !== 'object') return String(item);
    const flat: Record<string, any> = {};
    for (const [k, v] of Object.entries(item)) {
      const u = (v && typeof v === 'object' && 'value' in v) ? (v as any).value : v;
      if (u != null && typeof u !== 'object') flat[k] = u;
    }
    const nameKey = Object.keys(flat).find(k => /name|title|label/i.test(k));
    if (nameKey) return String(flat[nameKey]);
    return Object.values(flat).slice(0, 3).join(', ');
  });
  return items.filter(s => s && s.trim()).join(' · ');
}

/**
 * Provenance display rule for a value cell, from the shared classifier:
 *   not_reported → 'NR', not_applicable → 'NA', failure → the failure marker.
 * A failure is deliberately NOT blank: a blank cell reads as "the paper does
 * not report this", which is a different claim from "we could not read it".
 * Returns null when status doesn't dictate the display (show the raw value).
 */
function statusDisplay(data: any): string | null {
  return displayLabel(data);
}

/** Unwrap {value, source_text} wrappers to get the display value. */
export function extractScalar(data: any): string {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (Array.isArray(data)) return formatArray(data);
  if (typeof data === 'object') {
    const sd = statusDisplay(data);
    if (sd !== null) return sd;
    // {value, source_text} pattern
    if ('value' in data) {
      const v = data.value;
      if (v == null) return '';
      if (Array.isArray(v)) return formatArray(v);
      return String(v);
    }
    return JSON.stringify(data);
  }
  return String(data);
}

/** Extract scalar from a subfield entry value (may be raw or wrapped). */
function extractSubfieldValue(entry: any, key: string): string {
  if (!entry || entry[key] == null) return '';
  const raw = entry[key];
  if (typeof raw === 'object' && raw !== null) {
    const sd = statusDisplay(raw);
    if (sd !== null) return sd;
    if ('value' in raw) return raw.value == null ? '' : String(raw.value);
  }
  return String(raw);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Classify form fields into flat vs table (array with subform_fields). */
export function classifyFields(formFields: FormField[]): FieldClassification {
  const flatFields: FormField[] = [];
  const tableFields: FormField[] = [];

  for (const f of formFields) {
    if (f.field_type === 'array' && f.subform_fields && f.subform_fields.length > 0) {
      tableFields.push(f);
    } else {
      flatFields.push(f);
    }
  }

  if (tableFields.length === 0) {
    return { flatFields, tableFields, deepestTableField: null, parentTableFields: [] };
  }

  if (tableFields.length === 1) {
    return { flatFields, tableFields, deepestTableField: tableFields[0], parentTableFields: [] };
  }

  // With 2+ table fields, find the deepest one.
  // The deepest is the one that references a subfield from another table (shared key).
  const deepest = findDeepestTable(tableFields);
  const parentTableFields = tableFields.filter(t => t.field_name !== deepest.field_name);

  return { flatFields, tableFields, deepestTableField: deepest, parentTableFields };
}

/** Find the table field that should drive the row count (deepest level). */
function findDeepestTable(tableFields: FormField[]): FormField {
  // For each pair, check if they share a subfield name.
  // The one that references a field from another table is the "child" (deepest).
  for (let i = 0; i < tableFields.length; i++) {
    for (let j = 0; j < tableFields.length; j++) {
      if (i === j) continue;
      const shared = findJoinKey(tableFields[i], tableFields[j]);
      if (shared) {
        // tableFields[i] is the deepest if it has more subfields (it's the detail table)
        // tableFields[j] is the parent (lookup table)
        return tableFields[i].subform_fields!.length >= tableFields[j].subform_fields!.length
          ? tableFields[i]
          : tableFields[j];
      }
    }
  }
  // No shared key found — use the one with the most subfields
  return tableFields.reduce((a, b) =>
    (a.subform_fields?.length ?? 0) >= (b.subform_fields?.length ?? 0) ? a : b
  );
}

/** Find a subfield name present in both table fields' subform_fields. */
export function findJoinKey(a: FormField, b: FormField): string | null {
  const aNames = new Set((a.subform_fields ?? []).map(sf => sf.field_name));
  for (const sf of (b.subform_fields ?? [])) {
    if (aNames.has(sf.field_name)) return sf.field_name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Column building
// ---------------------------------------------------------------------------

/** Build ordered column names for the long-format table. */
export function buildColumns(classification: FieldClassification): string[] {
  const cols: string[] = ['Paper', 'Ref ID'];

  // Flat field columns
  for (const f of classification.flatFields) {
    cols.push(f.field_name);
  }

  // Parent table subfield columns (prefixed if collision with deepest subfields)
  const deepestNames = new Set(
    (classification.deepestTableField?.subform_fields ?? []).map(sf => sf.field_name)
  );

  for (const parent of classification.parentTableFields) {
    for (const sf of (parent.subform_fields ?? [])) {
      // Skip the join key if it's already in the deepest table
      if (deepestNames.has(sf.field_name)) continue;
      cols.push(sf.field_name);
    }
  }

  // Deepest table subfield columns
  for (const sf of (classification.deepestTableField?.subform_fields ?? [])) {
    cols.push(sf.field_name);
  }

  return cols;
}

// ---------------------------------------------------------------------------
// Main transformation
// ---------------------------------------------------------------------------

interface DocInfo {
  id: string;
  filename: string;
  ref_id?: number | null;
  // Study identity. Optional because a few callers build this map from a
  // trimmed row; documentLabel falls back to the filename when they are absent.
  first_author?: string | null;
  pub_year?: string | null;
  study_label?: string | null;
  pmid?: string | null;
  nct_id?: string | null;
}

export function transformToLongFormat(
  results: Array<{
    id: string;
    document_id: string;
    extracted_data: Record<string, any>;
    model_name?: string | null;
    extraction_type?: string | null;
  }>,
  formFields: FormField[],
  documentsMap: Record<string, DocInfo>,
): LongFormatResult {
  // Fallback: no form fields → one row per paper with raw keys
  if (!formFields || formFields.length === 0) {
    return fallbackTransform(results, documentsMap);
  }

  // "Paper" is the study ID ("Raslan 2021"), not the filename — one map for
  // the whole project so the a/b suffixes match the screens this exports from.
  const paperLabels = buildLabelMap(Object.values(documentsMap));

  const classification = classifyFields(formFields);
  const columns = buildColumns(classification);
  const rows: LongFormatRow[] = [];

  for (const result of results) {
    const doc = documentsMap[result.document_id];
    const filename = doc?.filename ?? result.document_id;
    const paper = paperLabels[result.document_id] ?? filenameStem(filename);
    const data = result.extracted_data ?? {};

    // Extract flat field values + capture raw wrapped envelopes for evidence lookup
    const flatValues: Record<string, string> = {};
    const flatRaw: Record<string, any> = {};
    for (const f of classification.flatFields) {
      flatValues[f.field_name] = extractScalar(data[f.field_name]);
      flatRaw[f.field_name] = data[f.field_name];
    }

    const baseRow = {
      _paperFilename: filename,
      _resultId: result.id,
      _documentId: result.document_id,
      _modelName: result.model_name ?? null,
      _extractionType: result.extraction_type ?? null,
      Paper: paper,
      'Ref ID': doc?.ref_id != null ? String(doc.ref_id) : '',
    };

    // No table fields — one row per paper
    if (!classification.deepestTableField) {
      rows.push({ ...baseRow, ...flatValues, _rawCells: { ...flatRaw } });
      continue;
    }

    // Get the deepest array
    const deepestFieldName = classification.deepestTableField.field_name;
    let deepestArray = extractArray(data[deepestFieldName]);

    // Empty array — still emit one row with flat fields (carry their raw
    // envelopes too, or the flat cells silently lose their source evidence
    // whenever the table came back empty).
    if (deepestArray.length === 0) {
      rows.push({ ...baseRow, ...flatValues, _rawCells: { ...flatRaw } });
      continue;
    }

    // Build parent lookup maps (joinKey → parent entry)
    const parentLookups: Array<{
      field: FormField;
      joinKey: string | null;
      entries: any[];
    }> = [];

    for (const parent of classification.parentTableFields) {
      const joinKey = findJoinKey(classification.deepestTableField, parent);
      const entries = extractArray(data[parent.field_name]);
      parentLookups.push({ field: parent, joinKey, entries });
    }

    // Explode deepest array into rows
    for (const entry of deepestArray) {
      const row: LongFormatRow = { ...baseRow, ...flatValues };
      const rawCells: Record<string, any> = { ...flatRaw };

      // Add parent table values (joined by key)
      for (const { field: parent, joinKey, entries } of parentLookups) {
        let matchedParent: any = null;
        if (joinKey && entries.length > 0) {
          const deepVal = extractSubfieldValue(entry, joinKey);
          matchedParent = entries.find(pe => extractSubfieldValue(pe, joinKey) === deepVal) ?? null;
        }
        // Fill parent subfield columns (skip join key if in deepest)
        for (const sf of (parent.subform_fields ?? [])) {
          if ((classification.deepestTableField?.subform_fields ?? []).some(d => d.field_name === sf.field_name)) continue;
          row[sf.field_name] = matchedParent ? extractSubfieldValue(matchedParent, sf.field_name) : '';
          rawCells[sf.field_name] = matchedParent ? matchedParent[sf.field_name] : undefined;
        }
      }

      // Add deepest table subfield values
      for (const sf of (classification.deepestTableField?.subform_fields ?? [])) {
        row[sf.field_name] = extractSubfieldValue(entry, sf.field_name);
        rawCells[sf.field_name] = entry?.[sf.field_name];
      }

      row._rawCells = rawCells;
      rows.push(row);
    }
  }

  return { columns, rows };
}

/** Extract an array from the extracted_data value (handles wrappers). */
function extractArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if ('value' in data && Array.isArray(data.value)) return data.value;
  }
  return [];
}

/** Fallback: no form fields available, one row per paper with raw keys. */
function fallbackTransform(
  results: Array<{ id: string; document_id: string; extracted_data: Record<string, any> }>,
  documentsMap: Record<string, DocInfo>,
): LongFormatResult {
  const allKeys = new Set<string>();
  for (const r of results) {
    for (const k of Object.keys(r.extracted_data ?? {})) {
      allKeys.add(k);
    }
  }
  const columns = ['Paper', 'Ref ID', ...Array.from(allKeys).sort()];
  const paperLabels = buildLabelMap(Object.values(documentsMap));
  const rows: LongFormatRow[] = results.map(r => {
    const doc = documentsMap[r.document_id];
    const rawCells: Record<string, any> = {};
    const row: LongFormatRow = {
      _paperFilename: doc?.filename ?? r.document_id,
      _resultId: r.id,
      _documentId: r.document_id,
      _modelName: (r as any).model_name ?? null,
      _extractionType: (r as any).extraction_type ?? null,
      Paper: paperLabels[r.document_id] ?? filenameStem(doc?.filename ?? r.document_id),
      'Ref ID': doc?.ref_id != null ? String(doc.ref_id) : '',
    };
    for (const k of allKeys) {
      row[k] = extractScalar(r.extracted_data?.[k]);
      rawCells[k] = r.extracted_data?.[k];
    }
    row._rawCells = rawCells;
    return row;
  });
  return { columns, rows };
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

export function toCSV(result: LongFormatResult): string {
  const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = result.columns.map(escape).join(',');
  const dataRows = result.rows.map(row =>
    result.columns.map(c => escape(row[c] ?? '')).join(',')
  );
  return [header, ...dataRows].join('\n');
}

export function toJSON(result: LongFormatResult): string {
  const data = result.rows.map(row => {
    const obj: Record<string, string> = {};
    for (const c of result.columns) {
      obj[c] = row[c] ?? '';
    }
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

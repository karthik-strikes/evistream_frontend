/**
 * Dynamic Data Renderer - Intelligently renders extracted data
 * - Arrays → Tables with auto-detected columns (metadata filtered)
 * - Objects → Nested key-value pairs
 * - Primitives → Simple text
 *
 * Handles wrapped {value, source_text, source_location} objects at any depth.
 */

import React from 'react';
import { MapPin } from 'lucide-react';
import type { SourceLocation } from '@/types/api';

// Keys that are metadata, not data — never show as table columns
const METADATA_KEYS = new Set(['source_text', 'source_location', 'confidence', 'reasoning']);

// Unwrap {value, source_text, source_location} wrappers
function unwrapValue(v: any): any {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) {
    const keys = Object.keys(v);
    if (keys.every(k => k === 'value' || METADATA_KEYS.has(k))) return v.value;
  }
  return v;
}

function hasSourceText(v: any): boolean {
  return v && typeof v === 'object' && typeof v.source_text === 'string' && v.source_text.length > 0;
}

interface DynamicDataRendererProps {
  data: any;
  fieldName: string;
  onSourceClick?: (fieldName: string, location: SourceLocation) => void;
}

export function DynamicDataRenderer({ data, fieldName, onSourceClick }: DynamicDataRendererProps) {
  if (data === null || data === undefined) {
    return <span className="text-gray-400 dark:text-zinc-600 italic">No data</span>;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return <DynamicTable data={data} fieldName={fieldName} />;
  }

  // Handle wrapped values: {value, source_text, source_location}
  if (typeof data === 'object' && 'value' in data) {
    const inner = unwrapValue(data);
    // If unwrapped to an array, render as table
    if (Array.isArray(inner)) {
      return <DynamicTable data={inner} fieldName={fieldName} />;
    }
    return <ValueWithSource data={data} fieldName={fieldName} onSourceClick={onSourceClick} />;
  }

  // Handle generic objects
  if (typeof data === 'object') {
    return <NestedObject data={data} />;
  }

  return <span className="text-gray-900 dark:text-white">{String(data)}</span>;
}

// ── DynamicTable ──────────────────────────────────────────────────────────────
function DynamicTable({ data, fieldName }: { data: any[]; fieldName: string }) {
  if (data.length === 0) {
    return <span className="text-gray-400 dark:text-zinc-600 italic">Empty list</span>;
  }

  // Step 1: Unwrap array items — if items are {value: {...}, source_text}, extract value
  const unwrappedData = data.map(item => {
    if (item && typeof item === 'object' && !Array.isArray(item) && 'value' in item) {
      const keys = Object.keys(item);
      if (keys.every(k => k === 'value' || METADATA_KEYS.has(k))) {
        const inner = item.value;
        // If inner is an object, use it as the row data
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner;
        // If inner is primitive, wrap it back
        return { value: inner };
      }
    }
    return item;
  });

  // Step 2: Track which original items had source evidence
  const hasEvidence = data.map(item => hasSourceText(item));

  // Step 3: Extract keys, filtering out metadata
  const allKeys = Array.from(
    new Set(
      unwrappedData.flatMap((item) =>
        typeof item === 'object' && item !== null
          ? Object.keys(item).filter(k => !METADATA_KEYS.has(k))
          : []
      )
    )
  );

  if (allKeys.length === 0) {
    // Array of primitives
    return (
      <div className="space-y-0.5">
        {unwrappedData.map((item, idx) => (
          <div key={idx} className="text-sm text-gray-700 dark:text-zinc-300">
            {String(item)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-[#1f1f1f] border border-gray-200 dark:border-[#1f1f1f] rounded-lg text-xs">
        <thead className="bg-gray-50 dark:bg-[#0a0a0a]">
          <tr>
            {allKeys.map((key) => (
              <th key={key} className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                {formatHeader(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-[#111111] divide-y divide-gray-100 dark:divide-[#1f1f1f]">
          {unwrappedData.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
              {allKeys.map((key, ki) => (
                <td key={key} className="px-3 py-2 text-sm text-gray-900 dark:text-white">
                  <div className="flex items-start gap-1">
                    {ki === 0 && hasEvidence[rowIdx] && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-400 mt-1.5 shrink-0" title="Has source evidence" />
                    )}
                    <CellRenderer value={row?.[key]} />
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-gray-400 dark:text-zinc-600 mt-1.5">
        {data.length} {data.length === 1 ? 'item' : 'items'}
      </div>
    </div>
  );
}

// ── ValueWithSource ───────────────────────────────────────────────────────────
function ValueWithSource({
  data,
  fieldName,
  onSourceClick,
}: {
  data: any;
  fieldName?: string;
  onSourceClick?: (fieldName: string, location: SourceLocation) => void;
}) {
  const { value, source_text, source_location, ...rest } = data;
  const hasLocation = source_location && typeof source_location === 'object' && source_location.page;

  const displayRest = Object.fromEntries(
    Object.entries(rest).filter(([k]) => !METADATA_KEYS.has(k))
  );

  // If value is an array, render as table
  if (Array.isArray(value)) {
    return <DynamicTable data={value} fieldName={fieldName || ''} />;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="font-medium text-gray-900 dark:text-white flex-1">
          {value !== undefined && value !== null
            ? (typeof value === 'object' ? <NestedObject data={value} /> : String(value))
            : 'N/A'}
        </div>
        {hasLocation && onSourceClick && fieldName && (
          <button
            onClick={(e) => { e.stopPropagation(); onSourceClick(fieldName, source_location); }}
            className="flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors flex-shrink-0 whitespace-nowrap"
            title={`View in PDF — page ${source_location.page}`}
          >
            <MapPin className="w-2.5 h-2.5" />
            p.{source_location.page}
          </button>
        )}
      </div>
      {source_text && source_text !== 'NR' && (
        <details className="cursor-pointer">
          <summary className="text-[10px] text-blue-500 dark:text-blue-400">Source</summary>
          <div className="text-[11px] mt-1 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded text-blue-600 dark:text-blue-400 italic leading-relaxed">
            &quot;{source_text}&quot;
            {hasLocation && (
              <span className="ml-1 text-[10px] text-blue-400 dark:text-blue-500 not-italic">
                (page {source_location.page}, {Math.round(source_location.confidence * 100)}% match)
              </span>
            )}
          </div>
        </details>
      )}
      {Object.keys(displayRest).length > 0 && (
        <div className="text-xs text-gray-500 dark:text-zinc-500 mt-1">
          {Object.entries(displayRest).map(([k, v]) => (
            <div key={k}><span className="font-medium">{formatHeader(k)}:</span> {String(v)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── NestedObject ──────────────────────────────────────────────────────────────
function NestedObject({ data }: { data: any }) {
  const entries = Object.entries(data).filter(([k]) => !METADATA_KEYS.has(k));
  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => {
        const v = unwrapValue(value);
        return (
          <div key={key} className="flex gap-2 text-sm">
            <span className="font-medium text-gray-500 dark:text-zinc-400 min-w-[100px] shrink-0">
              {formatHeader(key)}:
            </span>
            <span className="text-gray-900 dark:text-white">
              {v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── CellRenderer ──────────────────────────────────────────────────────────────
function CellRenderer({ value }: { value: any }) {
  if (value === null || value === undefined) {
    return <span className="text-gray-400 dark:text-zinc-600 italic">—</span>;
  }

  if (typeof value === 'boolean') {
    return <span className={value ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{value ? '✓' : '✗'}</span>;
  }

  // Unwrap {value, source_text} wrappers — show value directly
  if (typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
    const inner = unwrapValue(value);
    if (inner === null || inner === undefined || String(inner).trim() === '') {
      return <span className="text-gray-400 dark:text-zinc-600 italic">—</span>;
    }
    // Recurse with the unwrapped value
    return <CellRenderer value={inner} />;
  }

  // Arrays in cells
  if (Array.isArray(value)) {
    const items = value.map(v => String(unwrapValue(v))).filter(Boolean);
    return <span>{items.join(', ') || '—'}</span>;
  }

  // Objects in cells — show compact key-value
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([k, v]) => !METADATA_KEYS.has(k) && v != null && v !== '')
      .map(([k, v]) => [k, unwrapValue(v)] as const);

    if (entries.length === 0) return <span className="text-gray-400 dark:text-zinc-600 italic">—</span>;

    return (
      <div className="text-xs space-y-0.5">
        {entries.slice(0, 5).map(([k, v]) => (
          <div key={k}>
            <span className="text-gray-400 dark:text-zinc-500">{formatHeader(k)}:</span>{' '}
            {typeof v === 'object' && v !== null ? String(JSON.stringify(v)).slice(0, 50) : String(v)}
          </div>
        ))}
        {entries.length > 5 && <div className="text-gray-400 dark:text-zinc-600">+{entries.length - 5} more</div>}
      </div>
    );
  }

  // Primitives
  const str = String(value);
  if (str.length > 120) {
    return (
      <details className="cursor-pointer">
        <summary className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
          {str.slice(0, 60)}...
        </summary>
        <div className="text-xs mt-1 p-2 bg-gray-50 dark:bg-[#0a0a0a] rounded max-w-lg overflow-auto text-gray-900 dark:text-white">
          {str}
        </div>
      </details>
    );
  }

  return <span>{str}</span>;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function formatHeader(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\./g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

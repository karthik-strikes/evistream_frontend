/**
 * Dynamic Data Renderer - Intelligently renders extracted data
 * - Arrays → Tables with auto-detected columns
 * - Objects → Nested key-value pairs
 * - Primitives → Simple text
 *
 * Supports source linking: when a field has source_location metadata,
 * renders a clickable "View in PDF" button.
 */

import React from 'react';
import { MapPin } from 'lucide-react';
import type { SourceLocation } from '@/types/api';

interface DynamicDataRendererProps {
  data: any;
  fieldName: string;
  /** Called when user clicks "View in PDF" for a field with source_location */
  onSourceClick?: (fieldName: string, location: SourceLocation) => void;
}

export function DynamicDataRenderer({ data, fieldName, onSourceClick }: DynamicDataRendererProps) {
  // Handle null/undefined
  if (data === null || data === undefined) {
    return <span className="text-gray-400 dark:text-zinc-600 italic">No data</span>;
  }

  // Handle arrays - render as dynamic table
  if (Array.isArray(data)) {
    return <DynamicTable data={data} fieldName={fieldName} />;
  }

  // Handle objects with value/source_text structure (common pattern)
  if (typeof data === 'object' && 'value' in data) {
    return <ValueWithSource data={data} fieldName={fieldName} onSourceClick={onSourceClick} />;
  }

  // Handle generic objects
  if (typeof data === 'object') {
    return <NestedObject data={data} />;
  }

  // Handle primitives (string, number, boolean)
  return <span className="text-gray-900 dark:text-white">{String(data)}</span>;
}

// Component: Dynamic Table (auto-adapts to data structure)
function DynamicTable({ data, fieldName }: { data: any[]; fieldName: string }) {
  if (data.length === 0) {
    return <span className="text-gray-400 dark:text-zinc-600 italic">Empty list</span>;
  }

  // Extract all unique keys from all objects in the array
  const allKeys = Array.from(
    new Set(
      data.flatMap((item) =>
        typeof item === 'object' && item !== null ? Object.keys(item) : []
      )
    )
  );

  if (allKeys.length === 0) {
    // Array of primitives (not objects)
    return (
      <div className="space-y-1">
        {data.map((item, idx) => (
          <div key={idx} className="text-sm text-gray-700 dark:text-zinc-300">
            • {String(item)}
          </div>
        ))}
      </div>
    );
  }

  // Render as table
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-[#1f1f1f] border border-gray-200 dark:border-[#1f1f1f] rounded-lg">
        <thead className="bg-gray-50 dark:bg-[#0a0a0a]">
          <tr>
            {allKeys.map((key) => (
              <th
                key={key}
                className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wider"
              >
                {formatHeader(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-[#111111] divide-y divide-gray-100 dark:divide-[#1f1f1f]">
          {data.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
              {allKeys.map((key) => (
                <td key={key} className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                  <CellRenderer value={row[key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs text-gray-500 dark:text-zinc-500 mt-2">
        {data.length} {data.length === 1 ? 'item' : 'items'}
      </div>
    </div>
  );
}

// Component: Value with Source Text (common extraction pattern)
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

  // Filter out internal metadata keys from "rest"
  const displayRest = Object.fromEntries(
    Object.entries(rest).filter(([k]) => !['confidence', 'reasoning'].includes(k))
  );

  return (
    <div className="space-y-2">
      {/* Main value */}
      <div className="flex items-start gap-2">
        <div className="font-medium text-gray-900 dark:text-white flex-1">
          {value !== undefined ? String(value) : 'N/A'}
        </div>

        {/* View in PDF button */}
        {hasLocation && onSourceClick && fieldName && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSourceClick(fieldName, source_location);
            }}
            className="flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors flex-shrink-0 whitespace-nowrap"
            title={`View in PDF — page ${source_location.page} (${Math.round(source_location.confidence * 100)}% match)`}
          >
            <MapPin className="w-2.5 h-2.5" />
            p.{source_location.page}
          </button>
        )}
      </div>

      {/* Source text (if available) */}
      {source_text && source_text !== 'NR' && (
        <div className="text-xs text-gray-600 dark:text-zinc-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded p-2 mt-2">
          <span className="font-semibold">Source: </span>
          <span className="italic text-blue-600 dark:text-blue-400">&quot;{source_text}&quot;</span>
          {hasLocation && (
            <span className="ml-1 text-[10px] text-blue-400 dark:text-blue-500">
              (page {source_location.page}, {Math.round(source_location.confidence * 100)}% match)
            </span>
          )}
        </div>
      )}

      {/* Any other display fields */}
      {Object.keys(displayRest).length > 0 && (
        <div className="text-xs text-gray-500 dark:text-zinc-500 mt-2">
          {Object.entries(displayRest).map(([k, v]) => (
            <div key={k}>
              <span className="font-medium">{formatHeader(k)}:</span> {String(v)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Component: Nested Object
function NestedObject({ data }: { data: any }) {
  return (
    <div className="space-y-2">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <span className="font-medium text-gray-600 dark:text-zinc-400 text-sm min-w-[120px]">
            {formatHeader(key)}:
          </span>
          <span className="text-gray-900 dark:text-white text-sm">
            {typeof value === 'object' && value !== null
              ? JSON.stringify(value)
              : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// Component: Table Cell Renderer
function CellRenderer({ value }: { value: any }) {
  if (value === null || value === undefined) {
    return <span className="text-gray-400 dark:text-zinc-600 italic">—</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
        {value ? '✓' : '✗'}
      </span>
    );
  }

  if (typeof value === 'object') {
    // For nested objects in table cells, show compact JSON
    return (
      <details className="cursor-pointer">
        <summary className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">View</summary>
        <pre className="text-xs mt-1 p-2 bg-gray-50 dark:bg-[#0a0a0a] rounded max-w-xs overflow-auto text-gray-900 dark:text-white">
          {JSON.stringify(value, null, 2)}
        </pre>
      </details>
    );
  }

  // Handle numbers, strings, etc.
  const str = String(value);

  // Truncate long values
  if (str.length > 100) {
    return (
      <details className="cursor-pointer">
        <summary className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
          {str.slice(0, 50)}...
        </summary>
        <div className="text-xs mt-1 p-2 bg-gray-50 dark:bg-[#0a0a0a] rounded max-w-md text-gray-900 dark:text-white">
          {str}
        </div>
      </details>
    );
  }

  return <span>{str}</span>;
}

// Utility: Format header (snake_case → Title Case)
function formatHeader(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\./g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

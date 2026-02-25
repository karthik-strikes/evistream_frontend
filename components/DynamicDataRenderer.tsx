/**
 * Dynamic Data Renderer - Intelligently renders extracted data
 * - Arrays → Tables with auto-detected columns
 * - Objects → Nested key-value pairs
 * - Primitives → Simple text
 */

import React from 'react';

interface DynamicDataRendererProps {
  data: any;
  fieldName: string;
}

export function DynamicDataRenderer({ data, fieldName }: DynamicDataRendererProps) {
  // Handle null/undefined
  if (data === null || data === undefined) {
    return <span className="text-gray-400 italic">No data</span>;
  }

  // Handle arrays - render as dynamic table
  if (Array.isArray(data)) {
    return <DynamicTable data={data} fieldName={fieldName} />;
  }

  // Handle objects with value/source_text structure (common pattern)
  if (typeof data === 'object' && 'value' in data) {
    return <ValueWithSource data={data} />;
  }

  // Handle generic objects
  if (typeof data === 'object') {
    return <NestedObject data={data} />;
  }

  // Handle primitives (string, number, boolean)
  return <span className="text-gray-900">{String(data)}</span>;
}

// Component: Dynamic Table (auto-adapts to data structure)
function DynamicTable({ data, fieldName }: { data: any[]; fieldName: string }) {
  if (data.length === 0) {
    return <span className="text-gray-400 italic">Empty list</span>;
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
          <div key={idx} className="text-sm text-gray-700">
            • {String(item)}
          </div>
        ))}
      </div>
    );
  }

  // Render as table
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 border border-gray-200 rounded-lg">
        <thead className="bg-gray-50">
          <tr>
            {allKeys.map((key) => (
              <th
                key={key}
                className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider"
              >
                {formatHeader(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {data.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-gray-50 transition-colors">
              {allKeys.map((key) => (
                <td key={key} className="px-4 py-3 text-sm text-gray-900">
                  <CellRenderer value={row[key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs text-gray-500 mt-2">
        {data.length} {data.length === 1 ? 'item' : 'items'}
      </div>
    </div>
  );
}

// Component: Value with Source Text (common extraction pattern)
function ValueWithSource({ data }: { data: any }) {
  const { value, source_text, ...rest } = data;

  return (
    <div className="space-y-2">
      {/* Main value */}
      <div className="font-medium text-gray-900">
        {value !== undefined ? String(value) : 'N/A'}
      </div>

      {/* Source text (if available) */}
      {source_text && source_text !== 'NR' && (
        <div className="text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded p-2 mt-2">
          <span className="font-semibold">Source: </span>
          <span className="italic">&quot;{source_text}&quot;</span>
        </div>
      )}

      {/* Any other fields */}
      {Object.keys(rest).length > 0 && (
        <div className="text-xs text-gray-500 mt-2">
          {Object.entries(rest).map(([k, v]) => (
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
          <span className="font-medium text-gray-600 text-sm min-w-[120px]">
            {formatHeader(key)}:
          </span>
          <span className="text-gray-900 text-sm">
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
    return <span className="text-gray-400 italic">—</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-green-600' : 'text-red-600'}>
        {value ? '✓' : '✗'}
      </span>
    );
  }

  if (typeof value === 'object') {
    // For nested objects in table cells, show compact JSON
    return (
      <details className="cursor-pointer">
        <summary className="text-blue-600 hover:text-blue-700">View</summary>
        <pre className="text-xs mt-1 p-2 bg-gray-50 rounded max-w-xs overflow-auto">
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
        <summary className="text-blue-600 hover:text-blue-700">
          {str.slice(0, 50)}...
        </summary>
        <div className="text-xs mt-1 p-2 bg-gray-50 rounded max-w-md">
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

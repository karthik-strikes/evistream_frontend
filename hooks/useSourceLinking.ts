'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resultsService } from '@/services';
import type { SourceLocation, SourceIndexEntry } from '@/types/api';

export interface SourceHighlight {
  page: number;
  fieldName: string;
  matchedText: string;
  startChar: number;
  endChar: number;
}

/**
 * Hook for bidirectional PDF source linking.
 *
 * Forward:  scrollToField(fieldName) → highlights source in PDF
 * Backward: getFieldsAtPage(page) → fields extracted from that page
 */
export function useSourceLinking(resultId: string | undefined) {
  const [activeField, setActiveField] = useState<string | null>(null);

  // Fetch source index (inverted page→fields map)
  const { data: sourceIndex } = useQuery({
    queryKey: ['source-index', resultId],
    queryFn: () => resultsService.getSourceIndex(resultId!),
    enabled: !!resultId,
    staleTime: Infinity,
  });

  // Build highlights from source index
  const highlights = useMemo<SourceHighlight[]>(() => {
    if (!sourceIndex?.page_index) return [];
    const result: SourceHighlight[] = [];
    for (const [page, entries] of Object.entries(sourceIndex.page_index)) {
      for (const entry of entries) {
        result.push({
          page: parseInt(page, 10),
          fieldName: entry.field,
          matchedText: entry.matched_text || '',
          startChar: entry.start_char,
          endChar: entry.end_char,
        });
      }
    }
    return result;
  }, [sourceIndex]);

  // Forward: click a field → get its source location for PDF navigation
  const scrollToField = useCallback((fieldName: string) => {
    setActiveField(fieldName);
  }, []);

  // Get the highlight for the active field
  const activeHighlight = useMemo(() => {
    if (!activeField) return null;
    return highlights.find(h => h.fieldName === activeField) || null;
  }, [activeField, highlights]);

  // Backward: get all fields extracted from a given page
  const getFieldsAtPage = useCallback((page: number): SourceIndexEntry[] => {
    if (!sourceIndex?.page_index) return [];
    return sourceIndex.page_index[String(page)] || [];
  }, [sourceIndex]);

  // Check if a field has source location data
  const hasSourceLocation = useCallback((fieldName: string): boolean => {
    return highlights.some(h => h.fieldName === fieldName);
  }, [highlights]);

  // Get source location for a specific field
  const getFieldLocation = useCallback((fieldName: string): SourceHighlight | null => {
    return highlights.find(h => h.fieldName === fieldName) || null;
  }, [highlights]);

  return {
    activeField,
    activeHighlight,
    highlights,
    scrollToField,
    clearActive: () => setActiveField(null),
    getFieldsAtPage,
    hasSourceLocation,
    getFieldLocation,
    isLoaded: !!sourceIndex,
  };
}

/**
 * Extract source_location from extracted data (nested or flat format).
 */
export function getSourceLocationFromData(
  data: any,
  fieldName: string
): SourceLocation | null {
  if (!data || typeof data !== 'object') return null;

  // Nested format: data[fieldName] = { value, source_text, source_location }
  const fieldData = data[fieldName];
  if (fieldData?.source_location) {
    return fieldData.source_location as SourceLocation;
  }

  // Flat format: data["fieldName.source_location"] = { page, ... }
  const locKey = `${fieldName}.source_location`;
  if (data[locKey] && typeof data[locKey] === 'object') {
    return data[locKey] as SourceLocation;
  }

  return null;
}

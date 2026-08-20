'use client';

import { useCallback, useState } from 'react';
import { hasAllTags } from '@/lib/documentTags';

/**
 * Tag-filter state for one screen's document list.
 *
 * Local, not global: the tags you are filtering the run-extraction picker by
 * are not the tags you want carried into the consensus dashboard, and a shared
 * store would make a filter set in one screen silently hide papers in another.
 */
export function useTagFilter() {
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const toggleTag = useCallback((tag: string) => {
    setActiveTags(prev => (prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]));
  }, []);

  const clearTags = useCallback(() => setActiveTags([]), []);

  const matchesTags = useCallback(
    (labels?: string[] | null) => hasAllTags(labels, activeTags),
    [activeTags],
  );

  return { activeTags, toggleTag, clearTags, matchesTags };
}

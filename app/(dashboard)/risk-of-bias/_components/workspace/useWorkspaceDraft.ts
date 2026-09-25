'use client';

/**
 * The workspace's local draft — the study's shared D1 plus one assessment —
 * and its autosave.
 *
 * Loaded ONCE per key (study · target · mode). A background refetch after a
 * save must never replace what the reviewer typed in the second since, so the
 * server copy is read only when the key changes, the same rule the previous
 * page kept with its `loadedKey`.
 *
 * Every edit bumps a version; a debounced effect saves the newest draft. Refs
 * hold the newest values so the timer never saves a stale closure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Assessment, StudyD1 } from '../../_lib/robModel';
import type { SaveInput } from '../../_lib/useRobData';

export interface Draft {
  study: StudyD1;
  assessment: Assessment;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const DEBOUNCE_MS = 1200;

export function useWorkspaceDraft(opts: {
  /** Changes when a different assessment is opened. Empty = not ready yet. */
  loadKey: string;
  /** Builds the initial draft from the server copy; called once per key. */
  initial: () => Draft | null;
  save: (input: SaveInput) => Promise<void>;
  documentId: string;
  /** Called after a save that carried reopened sibling assessments. */
  onReopened?: (count: number) => void;
}) {
  const { loadKey, initial, save, documentId, onReopened } = opts;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState('');
  const [version, setVersion] = useState(0);

  const loaded = useRef('');
  const versionRef = useRef(0);
  const latest = useRef<Draft | null>(null);
  const savedVersion = useRef(0);
  const pendingAlso = useRef<Map<string, Assessment>>(new Map());
  const inFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!loadKey || loaded.current === loadKey) return;
    const next = initial();
    if (!next) return;
    loaded.current = loadKey;
    latest.current = next;
    pendingAlso.current = new Map();
    savedVersion.current = 0;
    versionRef.current = 0;
    setVersion(0);
    setDraft(next);
    setSaveState('idle');
    setSavedAt('');
  }, [loadKey, initial]);

  const update = useCallback((fn: (d: Draft) => Draft, extra?: { alsoAssessments?: Assessment[] }) => {
    const current = latest.current;
    if (!current) return;
    const next = fn(current);
    latest.current = next;
    for (const other of extra?.alsoAssessments ?? []) pendingAlso.current.set(other.targetId, other);
    setDraft(next);
    versionRef.current += 1;
    setVersion(versionRef.current);
  }, []);

  const doSave = useCallback(async (): Promise<void> => {
    const current = latest.current;
    if (!current || !documentId) return;
    const target = versionRef.current;
    const also = [...pendingAlso.current.values()];
    setSaveState('saving');
    const run = (async () => {
      try {
        await save({
          documentId, study: current.study, assessment: current.assessment,
          alsoAssessments: also.length ? also : undefined,
        });
        savedVersion.current = Math.max(savedVersion.current, target);
        for (const a of also) pendingAlso.current.delete(a.targetId);
        setSaveState('saved');
        setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
        if (also.length) onReopened?.(also.length);
      } catch {
        setSaveState('failed');
        throw new Error('save failed');
      }
    })();
    inFlight.current = run;
    try { await run; } finally { if (inFlight.current === run) inFlight.current = null; }
  }, [documentId, save, onReopened]);

  // Debounced autosave on every edit.
  useEffect(() => {
    if (version === 0 || version <= savedVersion.current) return;
    const timer = setTimeout(() => { doSave().catch(() => undefined); }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [version, doSave]);

  /** Save now if anything is unsaved. Rejects when the save fails. */
  const flush = useCallback(async () => {
    if (inFlight.current) await inFlight.current.catch(() => undefined);
    if (versionRef.current > savedVersion.current) await doSave();
  }, [doSave]);

  const dirty = version > savedVersion.current;

  return { draft, update, flush, saveState, savedAt, dirty };
}

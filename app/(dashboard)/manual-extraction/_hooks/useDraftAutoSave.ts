import { useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { SourceMap } from '../_lib/sourcing';

const DRAFT_PREFIX = 'evistream:draft:v2:';
const DEBOUNCE_MS = 1000;
const MAX_AGE_DAYS = 7;

interface DraftData {
  formData: Record<string, any>;
  /** The quotes attached in the same sitting.
   *
   *  Absent from drafts written before this, hence optional. Leaving them out
   *  was not merely incomplete — restoring values without them re-paired the
   *  recovered answers with whatever quotes the *stored* row had, so a cell
   *  came back citing a passage that supports the value it replaced. Evidence
   *  has to travel with the values it belongs to. */
  sources?: SourceMap;
  updatedAt: string;
}

function getDraftKey(formId: string, documentId: string) {
  return `${DRAFT_PREFIX}${formId}:${documentId}`;
}

export function getDraftStatus(formId: string, documentId: string): boolean {
  try {
    return localStorage.getItem(getDraftKey(formId, documentId)) !== null;
  } catch {
    return false;
  }
}

/**
 * Crash recovery in the browser, subordinate to the server.
 *
 * Since the draft autosave in `page.tsx` pushes in-progress work to the server,
 * this local copy is only the offline/crash fallback — so it must never win
 * against a stored row. It used to: the restore ran on every doc change, into
 * whatever `formData` held *after* the saved server row had been merged in, with
 * no timestamp comparison, and for completed rows too. A week-old local draft
 * could therefore overwrite answers the reviewer had already saved, announced
 * only as "Draft restored".
 *
 * `canRestore` is the caller's answer to "is this slot free of a server row?".
 * When it is false the server holds the truth, so the local copy is never
 * applied silently — but it is not thrown away either: `extraction_results` has
 * no `updated_at`, so "which is newer" is genuinely unanswerable, and a browser
 * copy can be real work that a crash stopped from reaching the server. The
 * reviewer is asked, once, and a decline deletes it so it cannot nag again.
 */
export function useDraftAutoSave(
  formId: string | undefined,
  documentId: string | undefined,
  formData: Record<string, any>,
  // Really a setState: the restore below merges into the previous value, and
  // typing it as a plain setter was a lie that would let a caller pass a
  // non-function and break silently.
  setFormData: Dispatch<SetStateAction<Record<string, any>>>,
  enabled: boolean,
  canRestore: boolean = true,
  /** When the server last wrote the stored row, if there is one. With it, the
   *  two copies can be *compared* instead of the reviewer being asked; without
   *  it (an older row, or a response that predates the column) the question
   *  stands. */
  serverSavedAt: string | null = null,
  /** Reviewer-attached quotes, saved and restored alongside the values. */
  sources: SourceMap = {},
  setSources?: Dispatch<SetStateAction<SourceMap>>,
) {
  const { toast } = useToast();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  /** Slot (`formId:documentId`) whose restore decision has already been made. */
  const handledSlotRef = useRef<string | null>(null);

  // Prune old drafts on mount
  useEffect(() => {
    try {
      const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key?.startsWith(DRAFT_PREFIX)) continue;
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed: DraftData = JSON.parse(raw);
          if (new Date(parsed.updatedAt).getTime() < cutoff) {
            localStorage.removeItem(key);
          }
        } catch {
          localStorage.removeItem(key!);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Check for existing draft on mount / doc change — auto-restore
  useEffect(() => {
    if (!formId || !documentId || !enabled) return;
    const key = getDraftKey(formId, documentId);
    // One decision per slot.
    if (handledSlotRef.current === key) return;
    handledSlotRef.current = key;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed: DraftData = JSON.parse(raw);
      const ago = new Date(parsed.updatedAt);
      const timeStr = ago.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
      if (!canRestore) {
        // There is a stored row. Two copies, and now a way to tell which is
        // older: `extraction_results.updated_at` finally exists.
        const localMs = new Date(parsed.updatedAt).getTime();
        const serverMs = serverSavedAt ? new Date(serverSavedAt).getTime() : NaN;
        if (Number.isFinite(serverMs) && Number.isFinite(localMs) && localMs <= serverMs) {
          // The server has everything this copy had and more. Drop it quietly —
          // asking about work that is already saved is just a scary dialog with
          // one right answer.
          localStorage.removeItem(key);
          return;
        }
        // Either the browser copy is genuinely newer, or the row predates the
        // timestamp column and we cannot tell. Restoring silently would
        // overwrite saved answers and binning it silently would lose the
        // reviewer's last minutes, so: ask.
        const take = window.confirm(
          `There is unsaved work on this computer from ${timeStr} that never reached the server.\n\n`
          + 'OK — put it back on the form (it will replace what was loaded).\n'
          + 'Cancel — discard it and keep the saved version.',
        );
        if (!take) {
          localStorage.removeItem(key);
          return;
        }
      }
      // Merge into current formData so only keys matching the current form are restored.
      // This prevents stale drafts with old flat keys from overwriting composite keys.
      setFormData((prev: Record<string, any>) => {
        const merged = { ...prev };
        let anyRestored = false;
        for (const [key, val] of Object.entries(parsed.formData)) {
          if (key in merged) {
            merged[key] = val;
            anyRestored = true;
          }
        }
        return anyRestored ? merged : prev;
      });
      // The quotes go back with the values. Only when the draft actually
      // carries them: an older draft has none, and blanking the stored row's
      // evidence on its behalf would destroy citations to recover values.
      if (parsed.sources && setSources) setSources(parsed.sources);
      toast({
        title: 'Draft restored',
        description: `Recovered work saved on this computer at ${timeStr} — it never reached the server.`,
        variant: 'default',
      });
    } catch { /* ignore */ }
  }, [formId, documentId, enabled, canRestore, serverSavedAt]); // eslint-disable-line react-hooks/exhaustive-deps


  // Debounced auto-save
  useEffect(() => {
    if (!formId || !documentId || !enabled) return;
    // Skip first render (initial empty form)
    if (!mountedRef.current) { mountedRef.current = true; return; }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        // A quote attached to a field left blank is still work worth keeping.
        const hasContent = Object.values(formData).some(v => v?.toString().trim())
          || Object.keys(sources).length > 0;
        if (!hasContent) return;
        const draft: DraftData = { formData, sources, updatedAt: new Date().toISOString() };
        localStorage.setItem(getDraftKey(formId, documentId), JSON.stringify(draft));
      } catch { /* quota exceeded, ignore */ }
    }, DEBOUNCE_MS);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [formData, sources, formId, documentId, enabled]);

  // Reset the mounted flag when the SLOT changes — the form as well as the
  // document. It watched the document alone, so switching form on the same
  // paper skipped the guard: the effect above fired on the freshly *loaded*
  // form and wrote it straight to localStorage as a recovered draft. The
  // reviewer had typed nothing, and the queue rail then badged that paper
  // "Draft — saved on this computer only". Now that the toolbar switches forms
  // in place, that is the common path rather than a rare one.
  useEffect(() => {
    mountedRef.current = false;
  }, [documentId, formId]);

  const clearDraft = useCallback(() => {
    if (!formId || !documentId) return;
    try {
      localStorage.removeItem(getDraftKey(formId, documentId));
    } catch { /* ignore */ }
  }, [formId, documentId]);

  return { clearDraft };
}

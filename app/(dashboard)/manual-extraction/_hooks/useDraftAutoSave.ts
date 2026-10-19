import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

const DRAFT_PREFIX = 'evistream:draft:v2:';
const DEBOUNCE_MS = 1000;
const MAX_AGE_DAYS = 7;

interface DraftData {
  formData: Record<string, any>;
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

export function useDraftAutoSave(
  formId: string | undefined,
  documentId: string | undefined,
  formData: Record<string, any>,
  setFormData: (data: Record<string, any>) => void,
  enabled: boolean,
) {
  const { toast } = useToast();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const restoredRef = useRef(false);

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
    restoredRef.current = false;
    const key = getDraftKey(formId, documentId);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed: DraftData = JSON.parse(raw);
      const ago = new Date(parsed.updatedAt);
      const timeStr = ago.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
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
      restoredRef.current = true;
      toast({
        title: 'Draft restored',
        description: `Restored unsaved draft from ${timeStr}`,
        variant: 'default',
      });
    } catch { /* ignore */ }
  }, [formId, documentId, enabled]);

  // Debounced auto-save
  useEffect(() => {
    if (!formId || !documentId || !enabled) return;
    // Skip first render (initial empty form)
    if (!mountedRef.current) { mountedRef.current = true; return; }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        const hasContent = Object.values(formData).some(v => v?.toString().trim());
        if (!hasContent) return;
        const draft: DraftData = { formData, updatedAt: new Date().toISOString() };
        localStorage.setItem(getDraftKey(formId, documentId), JSON.stringify(draft));
      } catch { /* quota exceeded, ignore */ }
    }, DEBOUNCE_MS);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [formData, formId, documentId, enabled]);

  // Reset mounted flag when doc changes
  useEffect(() => {
    mountedRef.current = false;
  }, [documentId]);

  const clearDraft = useCallback(() => {
    if (!formId || !documentId) return;
    try {
      localStorage.removeItem(getDraftKey(formId, documentId));
    } catch { /* ignore */ }
  }, [formId, documentId]);

  return { clearDraft };
}

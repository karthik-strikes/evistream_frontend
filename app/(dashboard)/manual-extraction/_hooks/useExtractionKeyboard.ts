import { useEffect } from 'react';

interface KeyboardActions {
  onSave: () => void;
  onSaveAndNext: () => void;
  onEscape: () => void;
  enabled: boolean;
}

export function useExtractionKeyboard({ onSave, onSaveAndNext, onEscape, enabled }: KeyboardActions) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 's') {
        e.preventDefault();
        onSave();
        return;
      }

      if (mod && e.key === 'Enter') {
        e.preventDefault();
        onSaveAndNext();
        return;
      }

      if (e.key === 'Escape') {
        onEscape();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSave, onSaveAndNext, onEscape, enabled]);
}

/** Platform-aware modifier key symbol */
export function modKey(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
}

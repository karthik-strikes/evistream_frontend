import { useEffect } from 'react';

interface KeyboardActions {
  onSave: () => void;
  onSaveAndNext: () => void;
  onEscape: () => void;
  enabled: boolean;
}

/** Is the keystroke going into something the reviewer is typing in? */
function isEditable(node: EventTarget | null): boolean {
  const el = node as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

export function useExtractionKeyboard({ onSave, onSaveAndNext, onEscape, enabled }: KeyboardActions) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
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
        // Escape is claimed by whatever is in front of the form: a dialog owns
        // it while open, and inside a field it means "leave this field", not
        // "leave the study". This listener is on `window`, so without these two
        // checks a reviewer pressing Escape to close a select landed on a
        // "Discard changes?" prompt for the whole paper.
        if (document.querySelector('[role="dialog"]')) return;
        if (isEditable(document.activeElement)) {
          (document.activeElement as HTMLElement).blur();
          return;
        }
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

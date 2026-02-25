/** Centralized color constants - single source of truth for status & accent colors */

export const C = {
  green: '#16a34a',
  amber: '#f59e0b',
  blue: '#3b82f6',
  red: '#ef4444',
  purple: '#8b5cf6',
  pink: '#ec4899',
} as const;

export const statusColor: Record<string, string> = {
  Active: C.green, active: C.green, Completed: C.green, done: C.green, completed: C.green,
  Generating: C.blue, generating: C.blue, running: C.blue, regenerating: C.blue,
  Review: C.amber, awaiting_review: C.amber, warn: C.amber, pending: C.amber, draft: C.amber,
  Failed: C.purple, failed: C.purple, error: C.purple,
};

export const statusBg: Record<string, string> = {
  Active: '#f0fdf4', active: '#f0fdf4', Completed: '#f0fdf4', done: '#f0fdf4', completed: '#f0fdf4',
  Generating: '#eff6ff', generating: '#eff6ff', running: '#eff6ff', regenerating: '#eff6ff',
  Review: '#fffbeb', awaiting_review: '#fffbeb', pending: '#fffbeb', draft: '#fffbeb',
  Failed: '#faf5ff', failed: '#faf5ff', error: '#faf5ff',
};

export const statusColors: Record<string, string> = {
  draft: '#999',
  generating: C.blue,
  awaiting_review: C.purple,
  active: '#16a34a',
  completed: '#16a34a',
  failed: C.purple,
};

export const statusBgs: Record<string, string> = {
  draft: '#f5f5f5',
  generating: '#eff6ff',
  awaiting_review: '#f3f4ff',
  active: '#f0fdf4',
  completed: '#f0fdf4',
  failed: '#faf5ff',
};

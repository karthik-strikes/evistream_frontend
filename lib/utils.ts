import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format date for display
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 'Invalid date';
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diffInSeconds < 0) return 'just now';
  if (diffInSeconds < 60) return 'just now';

  const minutes = Math.floor(diffInSeconds / 60);
  if (diffInSeconds < 3600) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;

  const hours = Math.floor(diffInSeconds / 3600);
  if (diffInSeconds < 86400) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.floor(diffInSeconds / 86400);
  if (diffInSeconds < 604800) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  return formatDate(d);
}

/**
 * Extract a safe string message from a FastAPI error response.
 * Handles both string details (FastAPI's default error shape) and Pydantic
 * validation error arrays. Also handles slowapi's rate-limit responses,
 * which use `{ error: "..." }` instead of `{ detail: "..." }`.
 */
export function getErrorMessage(err: any, fallback = 'Something went wrong'): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((e: any) => e?.msg ?? String(e)).join(', ');
  const error = err?.response?.data?.error;
  if (typeof error === 'string') return error;
  return fallback;
}

/**
 * Sleep helper for async operations
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Format an LLM model id into a friendly display label.
 * "anthropic/claude-sonnet-5" → "Claude Sonnet 5"; unknown ids fall back
 * to the provider-stripped id (e.g. "claude-haiku-4-5").
 */
export function formatModelName(model: string): string {
  const id = model.includes('/') ? model.split('/', 2)[1] : model;
  const known: Record<string, string> = {
    'claude-sonnet-5': 'Claude Sonnet 5',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
    'claude-opus-4-8': 'Claude Opus 4.8',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o mini',
    'gemini-2.0-flash-exp': 'Gemini 2.0 Flash',
    'openai.gpt-oss-20b-1:0': 'GPT-OSS 20B',
  };
  if (known[id]) return known[id];
  // Fallback: prettify an unknown id into Title Case, merging version
  // segments with dots — "claude-haiku-4-5" → "Claude Haiku 4.5".
  const words: string[] = [];
  for (const tok of id.split('-')) {
    if (/^\d+$/.test(tok) && words.length && /^[\d.]+$/.test(words[words.length - 1])) {
      words[words.length - 1] += `.${tok}`;
    } else if (tok === 'gpt') {
      words.push('GPT');
    } else if (/^\d/.test(tok)) {
      words.push(tok);
    } else {
      words.push(tok.charAt(0).toUpperCase() + tok.slice(1));
    }
  }
  return words.join(' ');
}

/**
 * Provider-themed style for a model tag: orange for Claude/Anthropic,
 * green for OpenAI/GPT, blue for Gemini, neutral zinc otherwise.
 * Soft gradient + ring for an airy, premium pill.
 */
export function modelTagTheme(model: string): string {
  const id = (model || '').toLowerCase();
  if (id.includes('claude') || id.includes('anthropic')) {
    return 'bg-gradient-to-r from-orange-50 to-amber-50 text-orange-700 ring-1 ring-orange-200/80 dark:from-orange-500/10 dark:to-amber-500/[0.07] dark:text-orange-300 dark:ring-orange-400/20';
  }
  if (id.includes('gpt') || id.includes('openai')) {
    return 'bg-gradient-to-r from-emerald-50 to-green-50 text-emerald-700 ring-1 ring-emerald-200/80 dark:from-emerald-500/10 dark:to-green-500/[0.07] dark:text-emerald-300 dark:ring-emerald-400/20';
  }
  if (id.includes('gemini') || id.includes('google')) {
    return 'bg-gradient-to-r from-blue-50 to-sky-50 text-blue-700 ring-1 ring-blue-200/80 dark:from-blue-500/10 dark:to-sky-500/[0.07] dark:text-blue-300 dark:ring-blue-400/20';
  }
  return 'bg-gradient-to-r from-zinc-100 to-zinc-50 text-zinc-600 ring-1 ring-zinc-200/80 dark:from-zinc-800 dark:to-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700/40';
}

/**
 * Format bytes to human readable file size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  if (bytes < 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

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
 * Handles both string details and Pydantic validation error arrays.
 */
export function getErrorMessage(err: any, fallback = 'Something went wrong'): string {
  const detail = err?.response?.data?.detail;
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((e: any) => e?.msg ?? String(e)).join(', ');
  return fallback;
}

/**
 * Sleep helper for async operations
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

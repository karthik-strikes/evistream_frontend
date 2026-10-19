/**
 * Client-side logger — forwards errors/warnings to the backend
 * so they appear in CloudWatch alongside server logs.
 */

type LogLevel = 'error' | 'warn' | 'info';

async function send(level: LogLevel, message: string, context?: Record<string, any>) {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/v1/logs/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, context }),
      keepalive: true,
    });
  } catch {
    // Never throw — logging must not break the app
  }
}

export const clientLogger = {
  error: (message: string, context?: Record<string, any>) => send('error', message, context),
  warn: (message: string, context?: Record<string, any>) => send('warn', message, context),
  info: (message: string, context?: Record<string, any>) => send('info', message, context),
};

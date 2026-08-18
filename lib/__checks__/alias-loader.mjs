/**
 * Minimal module resolver so the `__checks__` scripts can run under plain Node.
 *
 * The app compiles through Next.js, which understands the `@/*` path alias from
 * tsconfig.json and extensionless imports. Node does neither, and these checks
 * deliberately run outside the bundler so they can be executed before (and
 * independently of) a build. This hook teaches Node the two rules it is missing:
 *
 *   1. `@/x` resolves from the frontend root,
 *   2. an extensionless specifier tries `.ts`, `.tsx`, then `/index.ts`.
 *
 * It is only ever loaded by the check scripts — nothing in the app depends on it.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** frontend/lib/__checks__/ -> frontend/ */
const ROOT = new URL('../../', import.meta.url);

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '/index.ts', '/index.tsx'];

function withExtension(url) {
  if (existsSync(fileURLToPath(url))) return url;
  for (const ext of EXTENSIONS) {
    const candidate = new URL(url.href + ext);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return url;
}

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    return next(withExtension(new URL(specifier.slice(2), ROOT)).href, context);
  }
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const resolved = withExtension(new URL(specifier, context.parentURL));
    if (resolved.href !== new URL(specifier, context.parentURL).href) {
      return next(resolved.href, context);
    }
  }
  return next(specifier, context);
}

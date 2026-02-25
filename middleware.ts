import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that do not require authentication
const PUBLIC_PATHS = ['/', '/login', '/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths, Next.js internals, and static assets
  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon');

  if (isPublic) return NextResponse.next();

  // Check the lightweight presence cookie set by setToken() in lib/api.ts
  // This cookie is NOT HttpOnly so the browser JS manages it; middleware reads it
  // to decide whether to redirect — the actual JWT stays in sessionStorage.
  const isLoggedIn = request.cookies.get('is_logged_in')?.value === '1';

  if (!isLoggedIn) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except static files and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

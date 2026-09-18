/**
 * Routing guard for the admin dashboard.
 *
 * This only checks whether a session cookie is present, because middleware runs
 * on the Edge runtime where the Node crypto used to sign the cookie is not
 * available. The real gate is server-side: app/dashboard/layout.tsx verifies the
 * signature, and every API route calls assertAdmin(). Middleware exists purely
 * so an unauthenticated visitor lands on /login instead of a flash of dashboard.
 */

import { NextResponse, type NextRequest } from 'next/server';

const ADMIN_COOKIE = 'jk_admin_session';

export function middleware(request: NextRequest) {
  // Admin auth is optional so the app deploys before credentials exist.
  const authEnabled = Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET);
  if (!authEnabled) return NextResponse.next();

  if (request.cookies.has(ADMIN_COOKIE)) return NextResponse.next();

  const url = new URL('/login', request.url);
  url.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/dashboard/:path*'],
};

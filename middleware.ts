/**
 * Edge gate for the dashboard.
 *
 * Three jobs, in order:
 *
 *  1. Fail closed. If this is a production deployment without ADMIN_PASSWORD /
 *     SESSION_SECRET, no dashboard route is served at all — the visitor is sent
 *     to /config-error. There is no unauthenticated fallback in production.
 *  2. Redirect visitors without a session cookie to /login, so they never see a
 *     flash of dashboard chrome.
 *  3. Issue the double-submit CSRF cookie when the browser does not have one.
 *
 * Middleware runs on the Edge runtime, where the Node crypto that signs the
 * session cookie is unavailable — so it checks only that a cookie is *present*.
 * Signature and expiry are verified server-side in app/dashboard/layout.tsx and
 * again in every API route via assertAdmin(). This layer is defence in depth
 * and UX, never the sole gate.
 */

import { NextResponse, type NextRequest } from 'next/server';

const ADMIN_COOKIE = 'jk_admin_session';
const CSRF_COOKIE = 'jk_csrf';

function isProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

function adminAuthConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET);
}

/** Adds the CSRF cookie to a response when the browser is missing one. */
function withCsrfCookie(request: NextRequest, response: NextResponse): NextResponse {
  if (request.cookies.has(CSRF_COOKIE)) return response;
  response.cookies.set(CSRF_COOKIE, crypto.randomUUID().replaceAll('-', ''), {
    httpOnly: false, // must be readable by the browser to be echoed in a header
    sameSite: 'lax',
    secure: isProductionRuntime(),
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export function middleware(request: NextRequest) {
  const configured = adminAuthConfigured();

  // 1. Production without credentials: refuse, do not degrade to open access.
  if (!configured && isProductionRuntime()) {
    if (request.nextUrl.pathname === '/config-error') return NextResponse.next();
    return NextResponse.redirect(new URL('/config-error', request.url));
  }

  // Credentials exist, so /config-error is stale — send people to the app.
  if (configured && request.nextUrl.pathname === '/config-error') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // 2. Local development without credentials: convenience mode, still CSRF-cookied.
  if (!configured) return withCsrfCookie(request, NextResponse.next());

  if (request.nextUrl.pathname.startsWith('/dashboard') && !request.cookies.has(ADMIN_COOKIE)) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return withCsrfCookie(request, NextResponse.next());
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/config-error'],
};

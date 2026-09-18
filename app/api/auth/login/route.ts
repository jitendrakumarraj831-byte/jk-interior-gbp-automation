/**
 * Admin sign-in.
 *
 * Compares the submitted password against ADMIN_PASSWORD in constant time and,
 * on success, sets a signed httpOnly session cookie. The password is never
 * echoed back and never logged.
 */

import { z } from 'zod';

import { isAdminAuthConfigured, isAdminAuthMisconfigured, env } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/logger';
import {
  ADMIN_COOKIE,
  adminAuthMisconfiguredError,
  assertSameOrigin,
  createSessionToken,
  CSRF_COOKIE,
  csrfCookieOptions,
  handleRoute,
  ok,
  parseJson,
  randomToken,
  safeEqual,
  sessionCookieOptions,
} from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ password: z.string().min(1).max(512) });

export async function POST(request: Request) {
  return handleRoute('auth/login', async () => {
    // A login form posted from another origin is never legitimate. Checked
    // before anything else so a cross-site page cannot probe the password.
    assertSameOrigin(request);

    if (isAdminAuthMisconfigured()) throw adminAuthMisconfiguredError();

    if (!isAdminAuthConfigured()) {
      throw new AppError(
        'UNAUTHORIZED',
        'Admin sign-in is not configured. Set ADMIN_PASSWORD and SESSION_SECRET to enable it.',
        503,
      );
    }

    const { password } = await parseJson(request, bodySchema);
    if (!safeEqual(password, env().ADMIN_PASSWORD)) {
      log.warn('auth', 'Failed admin sign-in attempt.');
      throw new AppError('UNAUTHORIZED', 'Incorrect password.', 401);
    }

    const response = ok({ signedIn: true }, 'Signed in.');
    response.cookies.set(ADMIN_COOKIE, createSessionToken(), sessionCookieOptions());
    // Issue a fresh CSRF token alongside the new session so the very first
    // mutating request after sign-in already has a matching pair.
    response.cookies.set(CSRF_COOKIE, randomToken(), csrfCookieOptions());
    return response;
  });
}

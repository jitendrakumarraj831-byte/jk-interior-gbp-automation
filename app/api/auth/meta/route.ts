/**
 * Starts the Meta (Facebook Login for Business) OAuth consent flow.
 *
 * Mirrors app/api/auth/google/route.ts: a CSRF state value is generated,
 * stored in an httpOnly cookie and echoed to Meta; the callback refuses to
 * proceed unless both sides match.
 */

import { NextResponse } from 'next/server';

import { AppError } from '@/lib/errors';
import { buildAuthUrl } from '@/lib/meta/auth';
import {
  assertAdmin,
  createOAuthState,
  failure,
  handleRoute,
  META_OAUTH_STATE_COOKIE,
  sessionCookieOptions,
} from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleRoute('auth/meta', async () => {
    try {
      assertAdmin(request);
    } catch (error) {
      const destination =
        error instanceof AppError && error.code === 'ADMIN_AUTH_NOT_CONFIGURED'
          ? '/config-error'
          : '/login?next=/dashboard/social';
      return NextResponse.redirect(new URL(destination, request.url));
    }

    try {
      const state = createOAuthState();
      const authUrl = buildAuthUrl(state);

      const response = NextResponse.redirect(authUrl);
      response.cookies.set(META_OAUTH_STATE_COOKIE, state, {
        ...sessionCookieOptions(),
        maxAge: 600,
      });
      return response;
    } catch (error) {
      if (error instanceof AppError) return failure(error);
      throw error;
    }
  });
}

/**
 * Starts the Google OAuth consent flow.
 *
 * A CSRF state value is generated, stored in an httpOnly cookie and echoed to
 * Google; the callback refuses to proceed unless both sides match.
 */

import { NextResponse } from 'next/server';

import { buildAuthUrl } from '@/lib/google-auth';
import {
  assertAdmin,
  createOAuthState,
  failure,
  handleRoute,
  OAUTH_STATE_COOKIE,
  sessionCookieOptions,
} from '@/lib/security';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleRoute('auth/google', async () => {
    // Starting the OAuth flow is an admin action. A production deployment with
    // no admin credentials cannot authorise anyone, so it is sent to the
    // configuration error page rather than a sign-in form it cannot satisfy.
    try {
      assertAdmin(request);
    } catch (error) {
      const destination =
        error instanceof AppError && error.code === 'ADMIN_AUTH_NOT_CONFIGURED'
          ? '/config-error'
          : '/login?next=/dashboard/connection';
      return NextResponse.redirect(new URL(destination, request.url));
    }

    let authUrl: string;
    try {
      const state = createOAuthState();
      authUrl = buildAuthUrl(state);

      const response = NextResponse.redirect(authUrl);
      response.cookies.set(OAUTH_STATE_COOKIE, state, {
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

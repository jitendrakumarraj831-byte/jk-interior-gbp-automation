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
    try {
      assertAdmin(request);
    } catch {
      return NextResponse.redirect(new URL('/login?next=/dashboard/connection', request.url));
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

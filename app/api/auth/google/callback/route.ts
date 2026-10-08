/**
 * Google OAuth callback.
 *
 * Verifies the CSRF state, exchanges the code for tokens and stores the refresh
 * token server-side. The refresh token is never rendered, logged or returned to
 * the browser.
 */

import { NextResponse } from 'next/server';

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { exchangeCodeForTokens } from '@/lib/google-auth';
import { log } from '@/lib/logger';
import { AppError } from '@/lib/errors';
import {
  assertAdminSession,
  handleRoute,
  OAUTH_STATE_COOKIE,
  readCookie,
  verifyOAuthState,
} from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function redirectToConnection(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL('/dashboard/connection', request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: Request) {
  return handleRoute('auth/google/callback', async () => {
    // The browser must still be signed in as the admin. Without this, an expired
    // or foreign session that somehow held a valid state cookie could still
    // store a refresh token.
    try {
      assertAdminSession(request);
    } catch (error) {
      const destination =
        error instanceof AppError && error.code === 'ADMIN_AUTH_NOT_CONFIGURED'
          ? '/config-error'
          : '/login?next=/dashboard/connection';
      return NextResponse.redirect(new URL(destination, request.url));
    }

    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const googleError = url.searchParams.get('error');

    if (googleError) {
      log.warn('auth', 'Google returned an OAuth error.', { error: googleError });
      return redirectToConnection(request, {
        connect: 'error',
        reason:
          googleError === 'access_denied'
            ? 'Consent was declined on the Google screen.'
            : 'Google rejected the authorization request.',
      });
    }

    if (!verifyOAuthState(state, readCookie(request, OAUTH_STATE_COOKIE))) {
      log.warn('auth', 'OAuth state mismatch — possible CSRF or an expired attempt.');
      return redirectToConnection(request, {
        connect: 'error',
        reason: 'Security check failed or the request expired. Start the connection again.',
      });
    }

    if (!code) {
      return redirectToConnection(request, {
        connect: 'error',
        reason: 'Google did not return an authorization code.',
      });
    }

    try {
      const meta = await exchangeCodeForTokens(code);
      await recordAudit({
        actor: actorFromRequest(request),
        action: 'google_connected',
        resource: 'google-account',
        status: 'success',
        source: 'dashboard',
      });
      return redirectToConnection(request, {
        connect: 'success',
        ...(meta.googleAccountEmail ? { account: meta.googleAccountEmail } : {}),
      });
    } catch (error) {
      // Only our own, already-sanitised messages are shown. Anything else could
      // carry internals, so it is logged and replaced with a generic line.
      if (!(error instanceof AppError)) {
        log.error('auth', 'Unexpected failure completing the Google connection.', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return redirectToConnection(request, {
        connect: 'error',
        reason:
          error instanceof AppError ? error.message : 'Could not complete the Google connection.',
      });
    }
  });
}

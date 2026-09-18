/**
 * Google OAuth callback.
 *
 * Verifies the CSRF state, exchanges the code for tokens and stores the refresh
 * token server-side. The refresh token is never rendered, logged or returned to
 * the browser.
 */

import { NextResponse } from 'next/server';

import { exchangeCodeForTokens } from '@/lib/google-auth';
import { log } from '@/lib/logger';
import { handleRoute, OAUTH_STATE_COOKIE, readCookie, verifyOAuthState } from '@/lib/security';

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
      return redirectToConnection(request, {
        connect: 'success',
        ...(meta.googleAccountEmail ? { account: meta.googleAccountEmail } : {}),
      });
    } catch (error) {
      return redirectToConnection(request, {
        connect: 'error',
        reason:
          error instanceof Error ? error.message : 'Could not complete the Google connection.',
      });
    }
  });
}

/**
 * Meta OAuth callback.
 *
 * Verifies the CSRF state, exchanges the code for a Page connection and
 * persists the Page access token encrypted. The token is never rendered,
 * logged or returned to the browser. Mirrors
 * app/api/auth/google/callback/route.ts.
 */

import { NextResponse } from 'next/server';

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { exchangeCodeForConnection } from '@/lib/meta/auth';
import { log } from '@/lib/logger';
import { notify } from '@/lib/notifications';
import { handleRoute, META_OAUTH_STATE_COOKIE, readCookie, verifyOAuthState } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function redirectToSocial(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL('/dashboard/social', request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete(META_OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: Request) {
  return handleRoute('auth/meta/callback', async () => {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const metaError = url.searchParams.get('error');

    if (metaError) {
      log.warn('auth', 'Meta returned an OAuth error.', { error: metaError });
      return redirectToSocial(request, {
        connect: 'error',
        reason:
          metaError === 'access_denied'
            ? 'Consent was declined on the Meta screen.'
            : 'Meta rejected the authorization request.',
      });
    }

    if (!verifyOAuthState(state, readCookie(request, META_OAUTH_STATE_COOKIE))) {
      log.warn('auth', 'Meta OAuth state mismatch — possible CSRF or an expired attempt.');
      return redirectToSocial(request, {
        connect: 'error',
        reason: 'Security check failed or the request expired. Start the connection again.',
      });
    }

    if (!code) {
      return redirectToSocial(request, {
        connect: 'error',
        reason: 'Meta did not return an authorization code.',
      });
    }

    try {
      const connection = await exchangeCodeForConnection(code);
      await recordAudit({
        actor: actorFromRequest(request),
        action: 'meta_connected',
        resource: 'meta-account',
        status: 'success',
        source: 'dashboard',
        detail: connection.facebook.pageName,
      });
      await notify({
        category: 'meta_connected',
        title: 'Meta connected',
        message: connection.instagram.connected
          ? `Facebook Page "${connection.facebook.pageName}" and its linked Instagram account are connected.`
          : `Facebook Page "${connection.facebook.pageName}" is connected. No Instagram Professional account is linked to it yet.`,
        href: '/dashboard/social',
        dedupeKey: `meta-connected:${connection.connectedAt}`,
      });
      return redirectToSocial(request, {
        connect: 'success',
        ...(connection.facebook.pageName ? { page: connection.facebook.pageName } : {}),
      });
    } catch (error) {
      return redirectToSocial(request, {
        connect: 'error',
        reason: error instanceof Error ? error.message : 'Could not complete the Meta connection.',
      });
    }
  });
}

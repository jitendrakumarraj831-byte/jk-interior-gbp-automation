/**
 * Google OAuth 2.0 for the Business Profile APIs.
 *
 * The only scope Google accepts for these APIs is
 * https://www.googleapis.com/auth/business.manage.
 *
 * Refresh-token handling: a token supplied through GOOGLE_REFRESH_TOKEN always
 * wins (that is the deploy-time configuration), and a token captured by the
 * in-app OAuth callback is persisted in the store as a fallback so the flow is
 * usable before the environment variable is set.
 *
 * Server-only module.
 */

import { OAuth2Client } from 'google-auth-library';

import { env, GBP_SCOPE, isOAuthConfigured } from './config';
import { AppError } from './errors';
import { log } from './logger';
import { getStore, nsKey } from './store';

const REFRESH_TOKEN_KEY = nsKey('auth', 'refresh_token');
const CONNECTION_META_KEY = nsKey('auth', 'connection_meta');

export type ConnectionMeta = {
  connectedAt: string;
  googleAccountEmail?: string;
  scope?: string;
};

export function createOAuthClient(): OAuth2Client {
  const e = env();
  if (!isOAuthConfigured()) {
    throw new AppError(
      'OAUTH_NOT_CONFIGURED',
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.',
      503,
    );
  }
  return new OAuth2Client({
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    redirectUri: e.GOOGLE_REDIRECT_URI,
  });
}

/** Builds the consent URL. `prompt=consent` is required to get a refresh token. */
export function buildAuthUrl(state: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: [GBP_SCOPE, 'openid', 'email'],
    state,
  });
}

/** Exchanges the callback code for tokens and persists the refresh token. */
export async function exchangeCodeForTokens(code: string): Promise<ConnectionMeta> {
  const client = createOAuthClient();

  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch (error) {
    log.error('google-auth', 'Authorization code exchange failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(
      'GOOGLE_AUTH_FAILED',
      'Google rejected the authorization code. Check that GOOGLE_REDIRECT_URI matches the OAuth client exactly.',
      400,
    );
  }

  if (!tokens.refresh_token) {
    throw new AppError(
      'GOOGLE_AUTH_FAILED',
      'Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and connect again.',
      400,
    );
  }

  let googleAccountEmail: string | undefined;
  if (tokens.id_token) {
    try {
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: env().GOOGLE_CLIENT_ID,
      });
      googleAccountEmail = ticket.getPayload()?.email;
    } catch {
      // Identifying the account is a nicety; never fail the connect over it.
      log.warn('google-auth', 'Could not verify the returned id_token.');
    }
  }

  const meta: ConnectionMeta = {
    connectedAt: new Date().toISOString(),
    googleAccountEmail,
    scope: tokens.scope ?? undefined,
  };

  const store = getStore();
  await store.set(REFRESH_TOKEN_KEY, tokens.refresh_token);
  await store.set(CONNECTION_META_KEY, meta);

  log.info('google-auth', 'Google account connected.', { email: googleAccountEmail });
  return meta;
}

/** The refresh token in use, if any. Environment first, store second. */
export async function getRefreshToken(): Promise<string | null> {
  const fromEnv = env().GOOGLE_REFRESH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return await getStore().get<string>(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getConnectionMeta(): Promise<ConnectionMeta | null> {
  try {
    return await getStore().get<ConnectionMeta>(CONNECTION_META_KEY);
  } catch {
    return null;
  }
}

/** Forgets the stored connection. The env var, if set, still takes over. */
export async function disconnect(): Promise<void> {
  const store = getStore();
  await store.del(REFRESH_TOKEN_KEY);
  await store.del(CONNECTION_META_KEY);
  log.info('google-auth', 'Stored Google connection cleared.');
}

/**
 * Returns a short-lived access token for calling the Business Profile APIs.
 * Throws NOT_CONNECTED (not a crash) while no refresh token exists, which is
 * the normal state before Google approval.
 */
export async function getAccessToken(): Promise<string> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    throw new AppError(
      'NOT_CONNECTED',
      'No Google account is connected yet. Connect one from the Google Connection page.',
      503,
    );
  }

  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });

  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('empty access token');
    return token;
  } catch (error) {
    log.error('google-auth', 'Failed to refresh the Google access token', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(
      'GOOGLE_AUTH_FAILED',
      'Could not refresh the Google access token. The refresh token may be revoked or expired — reconnect the account.',
      401,
    );
  }
}

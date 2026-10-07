/**
 * Google OAuth 2.0 for the Business Profile APIs.
 *
 * The only scope Google accepts for these APIs is
 * https://www.googleapis.com/auth/business.manage.
 *
 * Which refresh token is used — one deterministic rule
 * ----------------------------------------------------
 *  1. A token captured by the in-app "Connect Google" flow (stored in the
 *     durable store) ALWAYS wins. It is the most recent deliberate action by
 *     the operator, so a newer connect can never be silently overridden by an
 *     old GOOGLE_REFRESH_TOKEN left in the environment.
 *  2. GOOGLE_REFRESH_TOKEN is the fallback when nothing is stored — and also a
 *     one-shot fallback when the stored token is rejected as revoked
 *     (invalid_grant) while the environment still holds a different one.
 *  3. Disconnect removes the stored token and revokes it at Google. If an
 *     environment token exists it is then IGNORED until the operator
 *     reconnects (or changes that variable), so "Disconnect" really disconnects
 *     instead of quietly reverting to a token nobody remembers.
 *
 * Tokens never leave this module except as the short-lived access token handed
 * to the Google client. Server-only.
 */

import { createHash } from 'node:crypto';

import { OAuth2Client } from 'google-auth-library';

import { env, GBP_SCOPE, isOAuthConfigured } from './config';
import { AppError } from './errors';
import { clearAccessState } from './gbp-access';
import { log } from './logger';
import { getStore, nsKey } from './store';

const REFRESH_TOKEN_KEY = nsKey('auth', 'refresh_token');
const CONNECTION_META_KEY = nsKey('auth', 'connection_meta');
/** Fingerprint of the env token that a Disconnect told us to ignore. */
const ENV_SUPPRESSED_KEY = nsKey('auth', 'env_token_suppressed');

export type ConnectionMeta = {
  connectedAt: string;
  googleAccountEmail?: string;
  scope?: string;
};

export type CredentialSource = 'stored' | 'environment';

export type Credential = { token: string; source: CredentialSource };

/** Non-sensitive description of the credential in use. */
export type CredentialState = {
  connected: boolean;
  source: CredentialSource | null;
  /** True when GOOGLE_REFRESH_TOKEN is set but is being ignored after a Disconnect. */
  environmentTokenIgnored: boolean;
  /** True when a stored AND an environment token both exist (stored is used). */
  environmentTokenShadowed: boolean;
};

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 24);
}

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

  // Google's consent screen lets the user untick individual permissions. Without
  // business.manage every Business Profile call would fail later, so catch it now.
  if (tokens.scope && !tokens.scope.split(/\s+/).includes(GBP_SCOPE)) {
    throw new AppError(
      'GOOGLE_AUTH_FAILED',
      'The Business Profile permission was not granted. Connect again and keep every permission box ticked.',
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
  // A fresh connect lifts any earlier "ignore the env token" decision and any
  // stale failure recorded against the previous credential.
  await store.del(ENV_SUPPRESSED_KEY);
  await clearAccessState();
  clearAccessTokenCache();

  log.info('google-auth', 'Google account connected.');
  return meta;
}

/* ------------------------------ credential choice ------------------------ */

async function readStoredToken(): Promise<string | null> {
  try {
    return await getStore().get<string>(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function isEnvTokenSuppressed(envToken: string): Promise<boolean> {
  try {
    const suppressed = await getStore().get<string>(ENV_SUPPRESSED_KEY);
    return suppressed !== null && suppressed === fingerprint(envToken);
  } catch {
    return false;
  }
}

/** The credential in use, or null. Stored token first, environment second. */
export async function resolveCredential(): Promise<Credential | null> {
  const stored = await readStoredToken();
  if (stored) return { token: stored, source: 'stored' };

  const fromEnv = env().GOOGLE_REFRESH_TOKEN;
  if (fromEnv && !(await isEnvTokenSuppressed(fromEnv))) {
    return { token: fromEnv, source: 'environment' };
  }
  return null;
}

/** The refresh token in use, if any. Server-side only — never return it from an API. */
export async function getRefreshToken(): Promise<string | null> {
  return (await resolveCredential())?.token ?? null;
}

/** Non-sensitive facts about the credential, safe to show in the dashboard. */
export async function getCredentialState(): Promise<CredentialState> {
  const stored = await readStoredToken();
  const fromEnv = env().GOOGLE_REFRESH_TOKEN;
  const ignored = Boolean(fromEnv) && !stored && (await isEnvTokenSuppressed(fromEnv));
  const credential = await resolveCredential();
  return {
    connected: credential !== null,
    source: credential?.source ?? null,
    environmentTokenIgnored: ignored,
    environmentTokenShadowed: Boolean(stored) && Boolean(fromEnv) && stored !== fromEnv,
  };
}

export async function getConnectionMeta(): Promise<ConnectionMeta | null> {
  try {
    return await getStore().get<ConnectionMeta>(CONNECTION_META_KEY);
  } catch {
    return null;
  }
}

/**
 * Disconnects the Google account.
 *
 * Removes the stored token, revokes it at Google (best effort) and forgets the
 * cached access state. An environment token, if any, is then ignored until the
 * operator reconnects — reported back so the dashboard can say so.
 */
export async function disconnect(): Promise<{ environmentTokenIgnored: boolean }> {
  const store = getStore();
  const stored = await readStoredToken();

  if (stored) {
    try {
      await createOAuthClient().revokeToken(stored);
    } catch (error) {
      // Already revoked, or Google is unreachable. The token is removed locally
      // either way, so this must never block the disconnect.
      log.warn('google-auth', 'Could not revoke the token at Google.', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  await store.del(REFRESH_TOKEN_KEY);
  await store.del(CONNECTION_META_KEY);

  const fromEnv = env().GOOGLE_REFRESH_TOKEN;
  if (fromEnv) await store.set(ENV_SUPPRESSED_KEY, fingerprint(fromEnv));

  await clearAccessState();
  clearAccessTokenCache();
  log.info('google-auth', 'Google account disconnected.');
  return { environmentTokenIgnored: Boolean(fromEnv) };
}

/* ------------------------------- access token ---------------------------- */

type CachedAccessToken = { token: string; expiresAt: number; credentialFingerprint: string };

let accessTokenCache: CachedAccessToken | null = null;
let inFlight: { fingerprint: string; promise: Promise<string> } | null = null;

/** Refresh slightly early so a token never expires mid-request. */
const EXPIRY_SKEW_MS = 60_000;

function clearAccessTokenCache(): void {
  accessTokenCache = null;
  inFlight = null;
}

/** Test seam. */
export const resetAccessTokenCache = clearAccessTokenCache;

type TokenFailure = 'revoked' | 'client' | 'transient';

/**
 * Tells a rejected credential apart from a network blip. Only the first two are
 * "the operator must act"; a timeout or a Google 5xx must never read as
 * "reconnect needed", or one bad packet would knock a healthy connection offline.
 */
function classifyTokenFailure(error: unknown): TokenFailure {
  const e = error as {
    code?: string | number;
    message?: string;
    response?: { status?: number; data?: { error?: string } };
  } | null;
  const reason = e?.response?.data?.error;
  const message = e?.message ?? String(error);

  if (reason === 'invalid_grant' || message.includes('invalid_grant')) return 'revoked';
  if (reason === 'invalid_client' || reason === 'unauthorized_client' || message.includes('invalid_client')) {
    return 'client';
  }
  const status = e?.response?.status;
  if (status === 400 || status === 401) return 'revoked';
  return 'transient';
}

const isInvalidGrant = (error: unknown): boolean => classifyTokenFailure(error) === 'revoked';

async function refreshWith(token: string): Promise<{ token: string; expiresAt: number }> {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: token });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) throw new Error('empty access token');
  return {
    token: credentials.access_token,
    expiresAt: credentials.expiry_date ?? Date.now() + 50 * 60_000,
  };
}

/**
 * Returns a short-lived access token for calling the Business Profile APIs.
 *
 * Cached per instance until shortly before expiry (so one dashboard load makes
 * one token request, not one per Google call) and de-duplicated while a refresh
 * is in flight. Throws NOT_CONNECTED while no refresh token exists, and
 * GOOGLE_AUTH_FAILED when Google rejects the token (revoked / expired).
 */
export async function getAccessToken(): Promise<string> {
  const credential = await resolveCredential();
  if (!credential) {
    throw new AppError(
      'NOT_CONNECTED',
      'No Google account is connected yet. Connect one from the Google Connection page.',
      503,
    );
  }

  const key = fingerprint(credential.token);
  if (
    accessTokenCache &&
    accessTokenCache.credentialFingerprint === key &&
    accessTokenCache.expiresAt - EXPIRY_SKEW_MS > Date.now()
  ) {
    return accessTokenCache.token;
  }
  if (inFlight && inFlight.fingerprint === key) return inFlight.promise;

  const promise = (async () => {
    try {
      let result;
      try {
        result = await refreshWith(credential.token);
      } catch (error) {
        // The stored token was revoked but the environment still holds a
        // different one: use it rather than leave a working setup broken.
        const fromEnv = env().GOOGLE_REFRESH_TOKEN;
        const canFallBack =
          credential.source === 'stored' &&
          isInvalidGrant(error) &&
          Boolean(fromEnv) &&
          fromEnv !== credential.token &&
          !(await isEnvTokenSuppressed(fromEnv));
        if (!canFallBack) throw error;
        log.warn(
          'google-auth',
          'Stored refresh token was rejected; using GOOGLE_REFRESH_TOKEN instead. Reconnect to replace the stored token.',
        );
        result = await refreshWith(fromEnv);
      }
      accessTokenCache = {
        token: result.token,
        expiresAt: result.expiresAt,
        credentialFingerprint: key,
      };
      return result.token;
    } catch (error) {
      accessTokenCache = null;
      const failure = classifyTokenFailure(error);
      log.error('google-auth', 'Failed to refresh the Google access token', {
        failure,
        error: error instanceof Error ? error.message : String(error),
      });
      if (failure === 'transient') {
        throw new AppError(
          'GOOGLE_API_ERROR',
          'Could not reach Google to refresh the sign-in. This is usually temporary — try again in a minute.',
          502,
        );
      }
      throw new AppError(
        'GOOGLE_AUTH_FAILED',
        failure === 'client'
          ? 'Google rejected the OAuth client credentials. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
          : 'Google says the saved sign-in was revoked or has expired. Reconnect the Google account.',
        401,
      );
    } finally {
      inFlight = null;
    }
  })();

  inFlight = { fingerprint: key, promise };
  return promise;
}

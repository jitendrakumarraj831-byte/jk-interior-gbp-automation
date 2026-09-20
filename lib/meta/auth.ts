/**
 * Meta OAuth (Facebook Login for Business) for Facebook Page + Instagram
 * Professional publishing.
 *
 * Mirrors the shape of lib/google-auth.ts (buildAuthUrl / exchange / getters /
 * disconnect) but differs where Meta's flow differs:
 *
 *  1. Exchange the callback `code` for a short-lived user access token.
 *  2. Exchange that for a long-lived user access token (~60 days).
 *  3. Call /me/accounts with the long-lived user token to discover the
 *     Facebook Page(s) the user manages and each Page's own access token —
 *     Page tokens derived this way do not expire on their own (Meta's stated
 *     behaviour, not guaranteed forever: they die if the user token is
 *     revoked, the password changes, or the Page role is removed).
 *  4. Read `instagram_business_account` off the Page to discover the linked
 *     Instagram Professional account, if any.
 *
 * This app manages one business (JK Interior) with one Facebook Page, so the
 * first Page returned by /me/accounts is the one connected — consistent with
 * the rest of this codebase, which has no multi-tenant concept.
 *
 * The Page access token is the only secret persisted, and only encrypted
 * (lib/meta/crypto.ts) — unlike the Google refresh token, which this phase
 * does not touch.
 *
 * Server-only module.
 */

import { env, isMetaOAuthConfigured, META_OAUTH_SCOPES, metaGraphVersion } from '../config';
import { AppError } from '../errors';
import { log } from '../logger';
import { getStore, nsKey } from '../store';
import type { FacebookConnection, InstagramConnection, MetaConnectionState } from '../social/types';
import { graphRequest } from './client';
import { decryptToken, encryptToken } from './crypto';

const PAGE_TOKEN_KEY = nsKey('meta', 'page_token');
const CONNECTION_STATE_KEY = nsKey('meta', 'connection');

const EMPTY_STATE: MetaConnectionState = {
  connected: false,
  facebook: { connected: false },
  instagram: { connected: false },
};

function assertConfigured(): void {
  if (!isMetaOAuthConfigured()) {
    throw new AppError(
      'META_NOT_CONFIGURED',
      'Meta is not configured. Set META_APP_ID, META_APP_SECRET and META_REDIRECT_URI.',
      503,
    );
  }
}

/** Builds the Facebook Login for Business consent URL. */
export function buildAuthUrl(state: string): string {
  assertConfigured();
  const e = env();
  const url = new URL(`https://www.facebook.com/${metaGraphVersion()}/dialog/oauth`);
  url.searchParams.set('client_id', e.META_APP_ID);
  url.searchParams.set('redirect_uri', e.META_REDIRECT_URI);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', META_OAUTH_SCOPES.join(','));
  return url.toString();
}

type PageAccountsResponse = {
  data: {
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: { id: string; username?: string; name?: string };
  }[];
};

/** Exchanges the callback code for tokens, discovers the Page + IG account, and persists them. */
export async function exchangeCodeForConnection(code: string): Promise<MetaConnectionState> {
  assertConfigured();
  const e = env();

  const shortLived = await graphRequest<{ access_token: string }>('GET', 'oauth/access_token', {
    params: {
      client_id: e.META_APP_ID,
      client_secret: e.META_APP_SECRET,
      redirect_uri: e.META_REDIRECT_URI,
      code,
    },
  }).catch(() => {
    throw new AppError(
      'META_AUTH_FAILED',
      'Meta rejected the authorization code. Check that META_REDIRECT_URI matches the app configuration exactly.',
      400,
    );
  });

  const longLived = await graphRequest<{ access_token: string }>('GET', 'oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: e.META_APP_ID,
      client_secret: e.META_APP_SECRET,
      fb_exchange_token: shortLived.access_token,
    },
  }).catch(() => {
    throw new AppError('META_AUTH_FAILED', 'Could not exchange for a long-lived Meta access token.', 400);
  });

  const accounts = await graphRequest<PageAccountsResponse>('GET', 'me/accounts', {
    accessToken: longLived.access_token,
    params: { fields: 'id,name,access_token,instagram_business_account{id,username,name}' },
  });

  const page = accounts.data[0];
  if (!page) {
    throw new AppError(
      'META_AUTH_FAILED',
      'No Facebook Page was found for this account. Make sure the JK Interior Page has been added as an admin/tester on the Meta app, and that the signed-in user manages it.',
      400,
    );
  }
  if (accounts.data.length > 1) {
    log.warn('meta/auth', 'Multiple Facebook Pages returned by /me/accounts; connecting the first.', {
      count: accounts.data.length,
    });
  }

  const store = getStore();
  await store.set(PAGE_TOKEN_KEY, encryptToken(page.access_token));

  const state: MetaConnectionState = {
    connected: true,
    facebook: { connected: true, pageId: page.id, pageName: page.name },
    instagram: page.instagram_business_account
      ? {
          connected: true,
          igUserId: page.instagram_business_account.id,
          username: page.instagram_business_account.username,
          name: page.instagram_business_account.name,
        }
      : { connected: false },
    connectedAt: new Date().toISOString(),
  };
  await store.set(CONNECTION_STATE_KEY, state);

  log.info('meta/auth', 'Meta connected.', {
    pageId: page.id,
    instagramConnected: state.instagram.connected,
  });
  return state;
}

export async function getConnectionState(): Promise<MetaConnectionState> {
  try {
    return (await getStore().get<MetaConnectionState>(CONNECTION_STATE_KEY)) ?? EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

async function recordConnectionError(message: string): Promise<void> {
  const current = await getConnectionState();
  await getStore()
    .set(CONNECTION_STATE_KEY, { ...current, lastError: message })
    .catch(() => {
      /* best effort */
    });
}

/** The Page access token, decrypted. Throws META_NOT_CONNECTED if none is stored. */
export async function getPageAccessToken(): Promise<string> {
  let encrypted: string | null;
  try {
    encrypted = await getStore().get<string>(PAGE_TOKEN_KEY);
  } catch {
    encrypted = null;
  }
  if (!encrypted) {
    throw new AppError(
      'META_NOT_CONNECTED',
      'No Meta account is connected yet. Connect one from the Social Connection page.',
      503,
    );
  }
  try {
    return decryptToken(encrypted);
  } catch (error) {
    if (error instanceof AppError) {
      await recordConnectionError(error.message);
      throw error;
    }
    throw error;
  }
}

/** Facebook Page identity for the connected Page, or null if not connected. */
export async function getFacebookConnection(): Promise<FacebookConnection> {
  return (await getConnectionState()).facebook;
}

/** Linked Instagram Professional account, or null if none is linked to the connected Page. */
export async function getInstagramConnection(): Promise<InstagramConnection> {
  return (await getConnectionState()).instagram;
}

/** Marks the connection as failed with a safe, human-readable reason — never a raw payload. */
export async function noteConnectionError(message: string): Promise<void> {
  await recordConnectionError(message);
}

/** Marks a successful sync, clearing any prior error. */
export async function noteConnectionSync(): Promise<void> {
  const current = await getConnectionState();
  await getStore()
    .set(CONNECTION_STATE_KEY, { ...current, lastSyncAt: new Date().toISOString(), lastError: undefined })
    .catch(() => {
      /* best effort */
    });
}

/** Forgets the stored connection and Page token entirely. */
export async function disconnect(): Promise<void> {
  const store = getStore();
  await store.del(PAGE_TOKEN_KEY);
  await store.del(CONNECTION_STATE_KEY);
  log.info('meta/auth', 'Stored Meta connection cleared.');
}

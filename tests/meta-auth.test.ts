/**
 * Meta OAuth connect/disconnect, token encryption at rest, and Graph API
 * error classification. All Meta network calls are mocked via `fetch` — no
 * real Facebook/Instagram publishing or auth call is ever made in tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_KEY = Buffer.from('0'.repeat(32)).toString('base64'); // exactly 32 bytes

const BASE_ENV = {
  META_APP_ID: 'test-app-id',
  META_APP_SECRET: 'test-app-secret',
  META_REDIRECT_URI: 'https://example.com/api/auth/meta/callback',
  META_ENCRYPTION_KEY: TEST_KEY,
  META_SOCIAL_ENABLED: 'true',
  META_FACEBOOK_ENABLED: 'true',
  META_INSTAGRAM_ENABLED: 'true',
};

const realFetch = globalThis.fetch;

async function loadAuth(env: Record<string, string | undefined> = BASE_ENV) {
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  for (const key of [
    'META_APP_ID',
    'META_APP_SECRET',
    'META_REDIRECT_URI',
    'META_ENCRYPTION_KEY',
    'META_SOCIAL_ENABLED',
    'META_FACEBOOK_ENABLED',
    'META_INSTAGRAM_ENABLED',
  ]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  return import('@/lib/meta/auth');
}

function mockGraphSequence(responses: { url: RegExp; body: unknown; status?: number }[]) {
  globalThis.fetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0]);
    const match = responses.find((r) => r.url.test(url));
    if (!match) throw new Error(`Unexpected fetch call in test: ${url}`);
    return new Response(JSON.stringify(match.body), { status: match.status ?? 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('buildAuthUrl', () => {
  it('throws META_NOT_CONFIGURED when Meta env vars are missing', async () => {
    const auth = await loadAuth({});
    expect(() => auth.buildAuthUrl('state123')).toThrow('Meta is not configured');
  });

  it('builds a Facebook Login for Business dialog URL with least-privilege scopes', async () => {
    const auth = await loadAuth();
    const url = new URL(auth.buildAuthUrl('state123'));
    expect(url.hostname).toBe('www.facebook.com');
    expect(url.searchParams.get('client_id')).toBe('test-app-id');
    expect(url.searchParams.get('redirect_uri')).toBe(BASE_ENV.META_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('state123');
    const scope = url.searchParams.get('scope');
    expect(scope).toContain('pages_show_list');
    expect(scope).toContain('pages_manage_posts');
    expect(scope).toContain('instagram_business_basic');
    expect(scope).toContain('instagram_business_content_publish');
    // Deprecated scope names must never be requested.
    expect(scope).not.toContain('instagram_basic');
    expect(scope?.split(',')).not.toContain('instagram_content_publish');
  });
});

describe('exchangeCodeForConnection', () => {
  it('discovers the Page + linked Instagram account and persists an encrypted token', async () => {
    const auth = await loadAuth();
    mockGraphSequence([
      { url: /oauth\/access_token.*fb_exchange_token/, body: { access_token: 'LONG_LIVED_USER_TOKEN' } },
      { url: /oauth\/access_token/, body: { access_token: 'SHORT_LIVED_USER_TOKEN' } },
      {
        url: /me\/accounts/,
        body: {
          data: [
            {
              id: 'page-123',
              name: 'JK Interior',
              access_token: 'PAGE_ACCESS_TOKEN',
              instagram_business_account: { id: 'ig-456', username: 'jkinterior', name: 'JK Interior' },
            },
          ],
        },
      },
    ]);

    const state = await auth.exchangeCodeForConnection('auth-code');
    expect(state.connected).toBe(true);
    expect(state.facebook).toEqual({ connected: true, pageId: 'page-123', pageName: 'JK Interior' });
    expect(state.instagram).toEqual({
      connected: true,
      igUserId: 'ig-456',
      username: 'jkinterior',
      name: 'JK Interior',
    });

    // The token round-trips through encryption and is never the raw stored string.
    const token = await auth.getPageAccessToken();
    expect(token).toBe('PAGE_ACCESS_TOKEN');
  });

  it('connects Facebook with instagram.connected=false when no Instagram account is linked', async () => {
    const auth = await loadAuth();
    mockGraphSequence([
      { url: /oauth\/access_token.*fb_exchange_token/, body: { access_token: 'LONG' } },
      { url: /oauth\/access_token/, body: { access_token: 'SHORT' } },
      { url: /me\/accounts/, body: { data: [{ id: 'page-1', name: 'JK Interior', access_token: 'TOK' }] } },
    ]);

    const state = await auth.exchangeCodeForConnection('auth-code');
    expect(state.facebook.connected).toBe(true);
    expect(state.instagram).toEqual({ connected: false });
  });

  it('throws META_AUTH_FAILED when the user manages no Facebook Page', async () => {
    const auth = await loadAuth();
    mockGraphSequence([
      { url: /oauth\/access_token.*fb_exchange_token/, body: { access_token: 'LONG' } },
      { url: /oauth\/access_token/, body: { access_token: 'SHORT' } },
      { url: /me\/accounts/, body: { data: [] } },
    ]);

    await expect(auth.exchangeCodeForConnection('auth-code')).rejects.toThrow(
      'No Facebook Page was found',
    );
  });
});

describe('getPageAccessToken', () => {
  it('throws META_NOT_CONNECTED when nothing is connected', async () => {
    const auth = await loadAuth();
    await expect(auth.getPageAccessToken()).rejects.toThrow('No Meta account is connected');
  });
});

describe('disconnect', () => {
  it('clears the stored connection and token', async () => {
    const auth = await loadAuth();
    mockGraphSequence([
      { url: /oauth\/access_token.*fb_exchange_token/, body: { access_token: 'LONG' } },
      { url: /oauth\/access_token/, body: { access_token: 'SHORT' } },
      { url: /me\/accounts/, body: { data: [{ id: 'page-1', name: 'JK Interior', access_token: 'TOK' }] } },
    ]);
    await auth.exchangeCodeForConnection('auth-code');
    expect((await auth.getConnectionState()).connected).toBe(true);

    await auth.disconnect();

    expect((await auth.getConnectionState()).connected).toBe(false);
    await expect(auth.getPageAccessToken()).rejects.toThrow('No Meta account is connected');
  });
});

describe('token encryption at rest', () => {
  it('round-trips a token through AES-256-GCM', async () => {
    vi.resetModules();
    process.env.META_ENCRYPTION_KEY = TEST_KEY;
    const crypto = await import('@/lib/meta/crypto');
    const encrypted = crypto.encryptToken('super-secret-page-token');
    expect(encrypted).not.toContain('super-secret-page-token');
    expect(crypto.decryptToken(encrypted)).toBe('super-secret-page-token');
  });

  it('throws when the key is missing', async () => {
    vi.resetModules();
    delete process.env.META_ENCRYPTION_KEY;
    const crypto = await import('@/lib/meta/crypto');
    expect(() => crypto.encryptToken('x')).toThrow('META_ENCRYPTION_KEY');
  });

  it('fails to decrypt after the key changes', async () => {
    vi.resetModules();
    process.env.META_ENCRYPTION_KEY = TEST_KEY;
    const crypto = await import('@/lib/meta/crypto');
    const encrypted = crypto.encryptToken('token-a');

    vi.resetModules();
    process.env.META_ENCRYPTION_KEY = Buffer.from('1'.repeat(32)).toString('base64');
    const crypto2 = await import('@/lib/meta/crypto');
    expect(() => crypto2.decryptToken(encrypted)).toThrow('Could not decrypt');
  });
});

describe('classifyMetaError', () => {
  it('classifies an expired token (code 190, subcode 463) as META_TOKEN_EXPIRED', async () => {
    const { classifyMetaError } = await import('@/lib/meta/errors');
    const error = classifyMetaError(401, { error: { code: 190, error_subcode: 463, message: 'Expired' } });
    expect(error.code).toBe('META_TOKEN_EXPIRED');
  });

  it('classifies a permission error (code 200) as META_PERMISSION_ERROR', async () => {
    const { classifyMetaError } = await import('@/lib/meta/errors');
    const error = classifyMetaError(403, { error: { code: 200, message: 'Permissions error' } });
    expect(error.code).toBe('META_PERMISSION_ERROR');
  });

  it('classifies application rate limiting (code 4) as META_RATE_LIMITED', async () => {
    const { classifyMetaError } = await import('@/lib/meta/errors');
    const error = classifyMetaError(400, { error: { code: 4, message: 'Too many calls' } });
    expect(error.code).toBe('META_RATE_LIMITED');
  });

  it('classifies the Instagram daily publishing cap (code 9) as META_RATE_LIMITED', async () => {
    const { classifyMetaError, isMetaTransient } = await import('@/lib/meta/errors');
    const error = classifyMetaError(400, { error: { code: 9, message: 'Publishing limit reached' } });
    expect(error.code).toBe('META_RATE_LIMITED');
    expect(isMetaTransient(error.code)).toBe(true);
  });

  it('falls back to META_API_ERROR for unrecognised failures', async () => {
    const { classifyMetaError } = await import('@/lib/meta/errors');
    const error = classifyMetaError(500, { error: { code: 1, message: 'Unknown error' } });
    expect(error.code).toBe('META_API_ERROR');
  });
});

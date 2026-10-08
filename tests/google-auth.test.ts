/**
 * Google OAuth lifecycle: which refresh token is used, what Disconnect really
 * does, how a revoked or flaky token is told apart, and that no secret leaks.
 * The OAuth client library is replaced by a scriptable fake.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mutableEnv = process.env as Record<string, string | undefined>;

type Behaviour = {
  getToken: () => Promise<{ tokens: Record<string, unknown> }>;
  refresh: (token: string) => Promise<{ credentials: Record<string, unknown> }>;
  revoke: (token: string) => Promise<unknown>;
};

let behaviour: Behaviour;
const refreshCalls: string[] = [];
const revokeCalls: string[] = [];

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    private refreshToken = '';
    generateAuthUrl(options: { scope: string[]; state: string; access_type: string; prompt: string }) {
      return `https://accounts.google.test/o/oauth2/v2/auth?${new URLSearchParams({
        scope: options.scope.join(' '),
        state: options.state,
        access_type: options.access_type,
        prompt: options.prompt,
      })}`;
    }
    getToken() {
      return behaviour.getToken();
    }
    verifyIdToken() {
      return Promise.resolve({ getPayload: () => ({ email: 'owner@example.com' }) });
    }
    setCredentials(credentials: { refresh_token?: string }) {
      this.refreshToken = credentials.refresh_token ?? '';
    }
    refreshAccessToken() {
      refreshCalls.push(this.refreshToken);
      return behaviour.refresh(this.refreshToken);
    }
    revokeToken(token: string) {
      revokeCalls.push(token);
      return behaviour.revoke(token);
    }
  },
}));

const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

const grantError = (data: { error: string }, status = 400) =>
  Object.assign(new Error(data.error), { response: { status, data } });

async function load() {
  vi.resetModules();
  const auth = await import('@/lib/google-auth');
  const store = await import('@/lib/store');
  const access = await import('@/lib/gbp-access');
  return { auth, store, access };
}

beforeEach(() => {
  mutableEnv.GOOGLE_CLIENT_ID = 'client-id';
  mutableEnv.GOOGLE_CLIENT_SECRET = 'client-secret';
  mutableEnv.GOOGLE_REDIRECT_URI = 'https://example.test/api/auth/google/callback';
  delete mutableEnv.GOOGLE_REFRESH_TOKEN;
  delete mutableEnv.UPSTASH_REDIS_REST_URL;
  delete mutableEnv.UPSTASH_REDIS_REST_TOKEN;
  refreshCalls.length = 0;
  revokeCalls.length = 0;
  behaviour = {
    getToken: async () => ({
      tokens: { refresh_token: 'stored-refresh', scope: `${GBP_SCOPE} openid email`, id_token: 'id' },
    }),
    refresh: async () => ({
      credentials: { access_token: 'ya29.access', expiry_date: Date.now() + 3600_000 },
    }),
    revoke: async () => ({}),
  };
});

afterEach(() => {
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_REFRESH_TOKEN']) {
    delete mutableEnv[key];
  }
});

/* ------------------------------ authorization URL ------------------------- */

describe('consent URL', () => {
  it('asks for offline access, always re-consents, and requests the Business Profile scope', async () => {
    const { auth } = await load();
    const url = new URL(auth.buildAuthUrl('state-123'));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent'); // guarantees a fresh refresh token
    expect(url.searchParams.get('scope')).toContain(GBP_SCOPE);
    expect(url.searchParams.get('state')).toBe('state-123');
  });
});

/* ------------------------------- code exchange ---------------------------- */

describe('authorization code exchange', () => {
  it('persists the refresh token and metadata, and returns neither token nor secret', async () => {
    const { auth } = await load();
    const meta = await auth.exchangeCodeForTokens('code');
    expect(meta.googleAccountEmail).toBe('owner@example.com');
    expect(JSON.stringify(meta)).not.toContain('stored-refresh');
    expect((await auth.resolveCredential())?.token).toBe('stored-refresh');
    expect((await auth.getConnectionMeta())?.googleAccountEmail).toBe('owner@example.com');
  });

  it('survives a cold start: a fresh module graph reads the same token from the store', async () => {
    const first = await load();
    await first.auth.exchangeCodeForTokens('code');
    // Same backing store, new "serverless instance" (module state reset, data kept).
    const { memorySnapshot } = await (async () => {
      const keys = await first.store.getStore().keys('jk:gbp:auth');
      const values = await first.store.getStore().getMany(keys);
      return { memorySnapshot: Object.fromEntries(keys.map((k, i) => [k, values[i]])) };
    })();
    const second = await load();
    for (const [key, value] of Object.entries(memorySnapshot)) await second.store.getStore().set(key, value);
    expect((await second.auth.resolveCredential())?.token).toBe('stored-refresh');
  });

  it('rejects an exchange that returns no refresh token, with guidance', async () => {
    behaviour.getToken = async () => ({ tokens: { scope: GBP_SCOPE } });
    const { auth } = await load();
    await expect(auth.exchangeCodeForTokens('code')).rejects.toMatchObject({
      code: 'GOOGLE_AUTH_FAILED',
      message: expect.stringContaining('refresh token'),
    });
  });

  it('rejects a consent where the Business Profile box was unticked', async () => {
    behaviour.getToken = async () => ({ tokens: { refresh_token: 'r', scope: 'openid email' } });
    const { auth } = await load();
    await expect(auth.exchangeCodeForTokens('code')).rejects.toMatchObject({
      code: 'GOOGLE_AUTH_FAILED',
      message: expect.stringContaining('permission'),
    });
    expect(await auth.resolveCredential()).toBeNull(); // nothing was stored
  });

  it('a failed exchange gives a safe message and stores nothing', async () => {
    behaviour.getToken = async () => {
      throw new Error('redirect_uri_mismatch: secret-ish internals');
    };
    const { auth } = await load();
    const error = await auth.exchangeCodeForTokens('bad').catch((e) => e);
    expect(error.code).toBe('GOOGLE_AUTH_FAILED');
    expect(error.message).not.toContain('secret-ish');
    expect(await auth.resolveCredential()).toBeNull();
  });
});

/* --------------------------- which token is used -------------------------- */

describe('refresh token precedence', () => {
  it('with only GOOGLE_REFRESH_TOKEN set, the environment token is used', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    const { auth } = await load();
    expect(await auth.resolveCredential()).toEqual({ token: 'env-refresh', source: 'environment' });
  });

  it('a token stored by Connect Google ALWAYS wins over a stale environment token', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'old-env-refresh';
    const { auth } = await load();
    await auth.exchangeCodeForTokens('code');
    const credential = await auth.resolveCredential();
    expect(credential).toEqual({ token: 'stored-refresh', source: 'stored' });
    expect((await auth.getCredentialState()).environmentTokenShadowed).toBe(true);

    await auth.getAccessToken();
    expect(refreshCalls).toEqual(['stored-refresh']); // the env token was never used
  });

  it('reports the credential source without exposing a token', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    const { auth } = await load();
    const state = await auth.getCredentialState();
    expect(state).toEqual({
      connected: true,
      source: 'environment',
      environmentTokenIgnored: false,
      environmentTokenShadowed: false,
    });
    expect(JSON.stringify(state)).not.toContain('env-refresh');
  });
});

/* ------------------------------- disconnect ------------------------------- */

describe('disconnect and reconnect', () => {
  it('removes the stored credential, revokes it at Google, and clears cached access state', async () => {
    const { auth, access } = await load();
    await auth.exchangeCodeForTokens('code');
    await access.recordServiceSuccess('reviews');

    const result = await auth.disconnect();
    expect(result.environmentTokenIgnored).toBe(false);
    expect(await auth.resolveCredential()).toBeNull();
    expect(await auth.getConnectionMeta()).toBeNull();
    expect(revokeCalls).toEqual(['stored-refresh']);
    expect((await access.readAccess()).status).toBe('unknown');
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('a failed revoke at Google never blocks the local disconnect', async () => {
    behaviour.revoke = async () => {
      throw new Error('already revoked');
    };
    const { auth } = await load();
    await auth.exchangeCodeForTokens('code');
    await expect(auth.disconnect()).resolves.toBeDefined();
    expect(await auth.resolveCredential()).toBeNull();
  });

  it('with GOOGLE_REFRESH_TOKEN set, Disconnect really disconnects (the env token is ignored)', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    const { auth } = await load();
    await auth.exchangeCodeForTokens('code');
    const result = await auth.disconnect();
    expect(result.environmentTokenIgnored).toBe(true);
    expect(await auth.resolveCredential()).toBeNull();
    expect((await auth.getCredentialState()).environmentTokenIgnored).toBe(true);
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('reconnecting after a disconnect works, and lifts the env-token suppression', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    const { auth } = await load();
    await auth.disconnect();
    expect(await auth.resolveCredential()).toBeNull();

    await auth.exchangeCodeForTokens('code');
    expect((await auth.resolveCredential())?.token).toBe('stored-refresh');
    expect((await auth.getCredentialState()).environmentTokenIgnored).toBe(false);
  });

  it('replacing GOOGLE_REFRESH_TOKEN with a NEW value after a disconnect re-enables it', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh-1';
    const first = await load();
    await first.auth.disconnect();
    const snapshot = await first.store.getStore().get('jk:gbp:auth:env_token_suppressed');

    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh-2'; // operator pasted a fresh token
    const second = await load();
    await second.store.getStore().set('jk:gbp:auth:env_token_suppressed', snapshot);
    expect((await second.auth.resolveCredential())?.token).toBe('env-refresh-2');
  });
});

/* ------------------------------- access token ----------------------------- */

describe('access token handling', () => {
  it('is cached until shortly before expiry — one refresh serves many Google calls', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    const { auth } = await load();
    await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
    await auth.getAccessToken();
    expect(refreshCalls).toHaveLength(1);
  });

  it('is refreshed again once it is about to expire', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    behaviour.refresh = async () => ({
      credentials: { access_token: 'ya29.short', expiry_date: Date.now() + 30_000 }, // < the 60s skew
    });
    const { auth } = await load();
    await auth.getAccessToken();
    await auth.getAccessToken();
    expect(refreshCalls).toHaveLength(2);
  });

  it('a revoked token (invalid_grant) is a clear "reconnect" auth error', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    behaviour.refresh = async () => {
      throw grantError({ error: 'invalid_grant' });
    };
    const { auth } = await load();
    const error = await auth.getAccessToken().catch((e) => e);
    expect(error.code).toBe('GOOGLE_AUTH_FAILED');
    expect(error.httpStatus).toBe(401);
    expect(error.message).toMatch(/reconnect/i);
  });

  it('wrong client credentials are reported as such, not as a revoked token', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    behaviour.refresh = async () => {
      throw grantError({ error: 'invalid_client' }, 401);
    };
    const { auth } = await load();
    const error = await auth.getAccessToken().catch((e) => e);
    expect(error.code).toBe('GOOGLE_AUTH_FAILED');
    expect(error.message).toContain('GOOGLE_CLIENT_SECRET');
  });

  it('a network blip is NOT "reconnect needed"', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    behaviour.refresh = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com'), { code: 'ENOTFOUND' });
    };
    const { auth } = await load();
    const error = await auth.getAccessToken().catch((e) => e);
    expect(error.code).toBe('GOOGLE_API_ERROR');
    expect(error.httpStatus).toBe(502);
    expect(error.message).not.toMatch(/reconnect/i);
  });

  it('a Google 5xx while refreshing is transient too', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    behaviour.refresh = async () => {
      throw Object.assign(new Error('Service Unavailable'), { response: { status: 503, data: {} } });
    };
    const { auth } = await load();
    expect(await auth.getAccessToken().catch((e) => e.code)).toBe('GOOGLE_API_ERROR');
  });

  it('a revoked STORED token falls back to a different environment token, once', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = 'env-refresh';
    const { auth } = await load();
    await auth.exchangeCodeForTokens('code'); // stored-refresh
    behaviour.refresh = async (token) => {
      if (token === 'stored-refresh') throw grantError({ error: 'invalid_grant' });
      return { credentials: { access_token: 'ya29.from-env', expiry_date: Date.now() + 3600_000 } };
    };
    expect(await auth.getAccessToken()).toBe('ya29.from-env');
    expect(refreshCalls).toEqual(['stored-refresh', 'env-refresh']);
  });

  it('with no usable fallback, a revoked stored token surfaces as an auth error', async () => {
    const { auth } = await load();
    await auth.exchangeCodeForTokens('code');
    behaviour.refresh = async () => {
      throw grantError({ error: 'invalid_grant' });
    };
    expect(await auth.getAccessToken().catch((e) => e.code)).toBe('GOOGLE_AUTH_FAILED');
  });

  it('never logs a token or secret while failing', async () => {
    mutableEnv.GOOGLE_REFRESH_TOKEN = '1//0g-super-secret-refresh-token-value-1234567890';
    behaviour.refresh = async () => {
      throw Object.assign(new Error('boom 1//0g-super-secret-refresh-token-value-1234567890 GOCSPX-abc123'), {
        response: { status: 400, data: { error: 'invalid_grant' } },
      });
    };
    const logged: string[] = [];
    for (const method of ['error', 'warn', 'info'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    const { auth } = await load();
    await auth.getAccessToken().catch(() => undefined);
    const output = logged.join('\n');
    expect(output.length).toBeGreaterThan(0);
    expect(output).not.toContain('super-secret-refresh-token');
    expect(output).not.toContain('GOCSPX-abc123');
  });
});

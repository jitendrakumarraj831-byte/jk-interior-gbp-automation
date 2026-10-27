/**
 * The headline regression, end to end.
 *
 * Production symptom: Google OAuth connected and the Performance API returning
 * LIVE numbers, yet the dashboard, Settings and Connection page all said
 * "Approval pending". Root cause: the access state was only ever written as
 * `available` by one particular probe (list accounts + locations), a successful
 * Performance call never recorded anything, and a six-hour cooldown then stopped
 * that probe from running at all — so a stale "pending" outlived the approval.
 *
 * These tests run the REAL googleFetch → access state → connection state chain.
 * Only the network (global fetch) and the OAuth token layer are faked, so what
 * is verified is the actual recording and derivation logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mutableEnv = process.env as Record<string, string | undefined>;

const getAccessToken = vi.fn();
let credential = { connected: true, source: 'stored' as const, environmentTokenIgnored: false, environmentTokenShadowed: false };

vi.mock('@/lib/google-auth', () => ({
  getAccessToken: () => getAccessToken(),
  getCredentialState: async () => credential,
  getConnectionMeta: async () => ({
    connectedAt: '2026-09-01T00:00:00.000Z',
    googleAccountEmail: 'owner@example.com',
  }),
}));

type Handler = () => { status: number; body: unknown };

const handlers: Record<'accounts' | 'locations' | 'reviews' | 'posts' | 'performance', Handler> = {
  accounts: () => ok({ accounts: [{ name: 'accounts/1', accountName: 'JK Interior' }] }),
  locations: () => ok({ locations: [{ name: 'locations/2', title: 'JK Interior Forbesganj' }] }),
  reviews: () => ok({ reviews: [], totalReviewCount: 0 }),
  posts: () => ok({ localPosts: [] }),
  performance: () =>
    ok({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            {
              dailyMetric: 'CALL_CLICKS',
              timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 1 }, value: '3' }] },
            },
          ],
        },
      ],
    }),
};

const ok = (body: unknown) => ({ status: 200, body });
const fail = (status: number, body: unknown = {}) => ({ status, body });

/** What an unapproved project really gets: 429, with a quota limit of zero. */
const zeroQuota = () =>
  fail(429, {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: "Quota exceeded for quota metric 'Requests'",
      details: [{ reason: 'RATE_LIMIT_EXCEEDED', metadata: { quota_limit_value: '0' } }],
    },
  });

const calls: string[] = [];

function installFetch() {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const key = url.includes('mybusinessaccountmanagement')
        ? 'accounts'
        : url.includes('mybusinessbusinessinformation')
          ? 'locations'
          : url.includes('/localPosts')
            ? 'posts'
            : url.includes('/reviews')
              ? 'reviews'
              : url.includes('businessprofileperformance')
                ? 'performance'
                : null;
      if (!key) throw new Error(`unexpected request: ${url}`);
      const { status, body } = handlers[key]();
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

async function load() {
  vi.resetModules();
  const errors = await import('@/lib/errors');
  const connection = await import('@/lib/connection');
  const access = await import('@/lib/gbp-access');
  const business = await import('@/lib/google-business');
  return { ...connection, access, business, errors };
}

beforeEach(() => {
  mutableEnv.GOOGLE_CLIENT_ID = 'test-client-id';
  mutableEnv.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  mutableEnv.GOOGLE_REDIRECT_URI = 'https://example.test/api/auth/google/callback';
  // Pinned target: discovery is not needed to reach the location-scoped APIs.
  mutableEnv.GBP_ACCOUNT_NAME = 'accounts/1';
  mutableEnv.GBP_LOCATION_NAME = 'locations/2';
  delete mutableEnv.GBP_MOCK_MODE;
  delete mutableEnv.UPSTASH_REDIS_REST_URL;
  delete mutableEnv.UPSTASH_REDIS_REST_TOKEN;

  credential = { connected: true, source: 'stored', environmentTokenIgnored: false, environmentTokenShadowed: false };
  getAccessToken.mockReset().mockResolvedValue('ya29.fake-access-token');
  handlers.accounts = () => ok({ accounts: [{ name: 'accounts/1', accountName: 'JK Interior' }] });
  handlers.locations = () => ok({ locations: [{ name: 'locations/2', title: 'JK Interior Forbesganj' }] });
  handlers.reviews = () => ok({ reviews: [], totalReviewCount: 0 });
  handlers.posts = () => ok({ localPosts: [] });
  handlers.performance = () =>
    ok({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            {
              dailyMetric: 'CALL_CLICKS',
              timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 1 }, value: '3' }] },
            },
          ],
        },
      ],
    });
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'GBP_ACCOUNT_NAME',
    'GBP_LOCATION_NAME',
  ]) {
    delete mutableEnv[key];
  }
});

/* ---------------------------------------------------------------------------
 * THE REGRESSION
 * ------------------------------------------------------------------------- */

describe('pending is overridden by proof that Google is working', () => {
  it('accounts API still 0-quota, Performance API live → AVAILABLE, not "pending"', async () => {
    handlers.accounts = zeroQuota;
    handlers.reviews = zeroQuota;
    handlers.posts = zeroQuota;
    // handlers.performance still succeeds — exactly the production situation.
    const { getConnectionState } = await load();

    const state = await getConnectionState({ refresh: true });

    expect(state.oauthConnected).toBe(true);
    expect(state.apiAccess).toBe('available');
    expect(state.connected).toBe(true);
    expect(state.apiAccessMessage).not.toMatch(/pending/i);
    // Honest about what is NOT working yet, without calling the whole thing pending.
    expect(state.access.degraded.map((s) => s.service).sort()).toEqual(['accounts', 'posts', 'reviews']);
    expect(state.access.lastSuccessAt).not.toBeNull();
  });

  it('a stale recorded "pending" flips to available when ANY real call succeeds', async () => {
    const { access, errors, business } = await load();
    for (const service of ['accounts', 'reviews', 'performance'] as const) {
      await access.recordServiceFailure(service, new errors.AppError('GBP_QUOTA_EXCEEDED', 'q', 503));
    }
    expect((await access.readAccess()).status).toBe('pending');

    // Nothing but an ordinary Performance fetch — no special probe, no manual check.
    await business.fetchPerformance('locations/2', { days: 7 });

    expect((await access.readAccess()).status).toBe('available');
  });

  it('the dashboard path self-heals: a stale "pending" is re-verified without any button press', async () => {
    const { access, errors, ensureAccessChecked } = await load();
    // Pending was recorded long ago (older than the cooldown) — approval has since landed.
    const { getStore, nsKey } = await import('@/lib/store');
    const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await getStore().set(nsKey('gbp', 'access', 'svc', 'reviews'), {
      service: 'reviews',
      status: 'pending',
      checkedAt: longAgo,
      lastCode: 'GBP_QUOTA_EXCEEDED',
    });
    void errors;

    const snapshot = await ensureAccessChecked();

    expect(snapshot.status).toBe('available');
    expect((await access.readAccess()).status).toBe('available');
  });

  it('inside the cooldown a pending state is NOT re-asked on every page load', async () => {
    handlers.accounts = zeroQuota;
    handlers.reviews = zeroQuota;
    handlers.posts = zeroQuota;
    handlers.performance = zeroQuota;
    const { ensureAccessChecked } = await load();

    const first = await ensureAccessChecked();
    expect(first.status).toBe('pending');
    const callsAfterFirst = calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await ensureAccessChecked();
    await ensureAccessChecked();
    expect(calls.length).toBe(callsAfterFirst);
  });

  it('an explicit check bypasses the cooldown (and is itself throttled)', async () => {
    handlers.accounts = zeroQuota;
    handlers.reviews = zeroQuota;
    handlers.posts = zeroQuota;
    handlers.performance = zeroQuota;
    const { ensureAccessChecked, checkGbpAccess } = await load();

    await ensureAccessChecked();
    expect((await ensureAccessChecked()).status).toBe('pending');

    // Google approves the project.
    handlers.reviews = () => ok({ reviews: [], totalReviewCount: 0 });
    const result = await checkGbpAccess({ manual: true });
    expect(result.status).toBe('available');

    // Pressing the button again straight away is refused rather than hammering Google.
    await expect(checkGbpAccess({ manual: true })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

/* ---------------------------------------------------------------------------
 * The states stay distinct
 * ------------------------------------------------------------------------- */

describe('OAuth connected + GBP API genuinely pending', () => {
  it('reports the account as CONNECTED and the API as PENDING when every API is closed', async () => {
    for (const key of Object.keys(handlers) as (keyof typeof handlers)[]) handlers[key] = zeroQuota;
    const { getConnectionState } = await load();
    const state = await getConnectionState();

    expect(state.oauthConnected).toBe(true);
    expect(state.apiAccess).toBe('pending');
    expect(state.connected).toBe(false);
    expect(state.apiAccessMessage).toContain('connected');
    expect(state.apiAccessMessage).toContain('pending approval');
    // Waiting is not an error the operator can act on.
    expect(state.lastError).toBeUndefined();
    expect(state.hasRefreshToken).toBe(true);
    expect(state.googleAccountEmail).toBe('owner@example.com');
  });
});

describe('the other connection states stay distinct', () => {
  it('a revoked refresh token is an auth error, not "pending"', async () => {
    const { getConnectionState, errors } = await load();
    getAccessToken.mockRejectedValue(new errors.AppError('GOOGLE_AUTH_FAILED', 'revoked', 401));
    const state = await getConnectionState();
    expect(state.oauthConnected).toBe(false);
    expect(state.apiAccess).toBe('auth_error');
    expect(state.lastError).toBeDefined();
  });

  it('a network blip while refreshing the token does NOT read as "reconnect needed"', async () => {
    const { getConnectionState, errors, access } = await load();
    getAccessToken.mockRejectedValue(new errors.AppError('GOOGLE_API_ERROR', 'timeout', 502));
    const state = await getConnectionState();
    expect(state.oauthConnected).toBe(true);
    expect(state.apiAccess).not.toBe('auth_error');
    expect((await access.readAccess()).status).not.toBe('auth_error');
  });

  it('after a successful Google call, an old auth error is gone', async () => {
    const { getConnectionState, errors } = await load();
    getAccessToken.mockRejectedValueOnce(new errors.AppError('GOOGLE_AUTH_FAILED', 'revoked', 401));
    expect((await getConnectionState()).apiAccess).toBe('auth_error');

    // The operator reconnected; the next call works.
    const state = await getConnectionState({ refresh: true });
    expect(state.apiAccess).toBe('available');
    expect(state.lastError).toBeUndefined();
  });

  it('a temporary rate limit is not mistaken for pending approval', async () => {
    const throttled = () =>
      fail(429, { error: { status: 'RESOURCE_EXHAUSTED', details: [{ metadata: { quota_limit_value: '300' } }] } });
    for (const key of Object.keys(handlers) as (keyof typeof handlers)[]) handlers[key] = throttled;
    const { getConnectionState } = await load();
    const state = await getConnectionState({ refresh: true });
    expect(state.oauthConnected).toBe(true);
    expect(state.apiAccess).toBe('rate_limited');
  });

  it('a plain 403 is a permission problem, not approval pending', async () => {
    const forbidden = () => fail(403, { error: { message: 'The caller does not have permission' } });
    for (const key of Object.keys(handlers) as (keyof typeof handlers)[]) handlers[key] = forbidden;
    const { getConnectionState } = await load();
    const state = await getConnectionState({ refresh: true });
    expect(state.apiAccess).toBe('permission_error');
    expect(state.apiAccessMessage).not.toMatch(/pending/i);
  });

  it('a disabled API tells the owner to enable it', async () => {
    const disabled = () =>
      fail(403, { error: { status: 'PERMISSION_DENIED', message: 'API has not been used in project 1 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } });
    for (const key of Object.keys(handlers) as (keyof typeof handlers)[]) handlers[key] = disabled;
    const { getConnectionState } = await load();
    const state = await getConnectionState({ refresh: true });
    expect(state.apiAccess).toBe('permission_error');
    expect(state.apiAccessMessage).toMatch(/enable/i);
  });

  it('one disabled API is reported as partly working, not hidden behind a green status', async () => {
    handlers.reviews = () =>
      fail(403, {
        error: {
          status: 'PERMISSION_DENIED',
          message: 'Google My Business API has not been used in project 123456789 before or it is disabled.',
          details: [
            {
              reason: 'SERVICE_DISABLED',
              metadata: { service: 'mybusiness.googleapis.com', consumer: 'projects/123456789' },
            },
          ],
        },
      });
    const { getConnectionState } = await load();
    const state = await getConnectionState({ refresh: true });
    // Accounts, locations, posts and performance answered, so access is proven…
    expect(state.apiAccess).toBe('available');
    // …but the page must still say Reviews is not working, and why.
    expect(state.access.degraded.map((s) => s.service)).toEqual(['reviews']);
    expect(state.apiAccessMessage).toMatch(/Reviews is not working/);
    expect(state.apiAccessMessage).toMatch(/switched off/i);
    // The state keeps which API and which project Google named, for the hint.
    expect(state.access.degraded[0]).toMatchObject({
      service: 'reviews',
      lastCode: 'GBP_API_NOT_ENABLED',
      apiService: 'mybusiness.googleapis.com',
      project: '123456789',
    });
  });

  it('a 404 for the location does not mark access broken', async () => {
    handlers.reviews = () => fail(404);
    const { getConnectionState } = await load();
    const state = await getConnectionState({ refresh: true });
    // Accounts, locations, posts and performance all answered.
    expect(state.apiAccess).toBe('available');
  });
});

/* ---------------------------------------------------------------------------
 * Accounts, locations and selection
 * ------------------------------------------------------------------------- */

describe('locations and selection', () => {
  it('a working API reports available and lists accounts and locations', async () => {
    const { getConnectionState } = await load();
    const state = await getConnectionState({ refresh: true });
    expect(state.apiAccess).toBe('available');
    expect(state.connected).toBe(true);
    expect(state.accounts).toHaveLength(1);
    expect(state.locations).toHaveLength(1);
    expect(state.selectedLocation).toBe('locations/2');
    expect(state.selectionSource).toBe('pinned');
    expect(state.selectedLocationTitle).toBe('JK Interior Forbesganj');
  });

  it('account/location lists are cached so ordinary page loads cost no discovery quota', async () => {
    const { getConnectionState } = await load();
    await getConnectionState({ refresh: true });
    const accountCalls = () => calls.filter((u) => u.includes('mybusinessaccountmanagement')).length;
    const before = accountCalls();
    await getConnectionState();
    await getConnectionState();
    expect(accountCalls()).toBe(before);
  });

  it('with nothing pinned or chosen, the first account and location are used and remembered', async () => {
    delete mutableEnv.GBP_ACCOUNT_NAME;
    delete mutableEnv.GBP_LOCATION_NAME;
    const { resolveTarget } = await load();

    const target = await resolveTarget();
    expect(target.locationPath).toBe('accounts/1/locations/2');
    expect(target.source).toBe('discovered');

    const before = calls.length;
    await resolveTarget();
    await resolveTarget();
    expect(calls.length).toBe(before); // served from the discovery cache
  });

  it('a location pinned without an account still resolves (account is discovered)', async () => {
    delete mutableEnv.GBP_ACCOUNT_NAME;
    const { resolveTarget } = await load();
    const target = await resolveTarget();
    expect(target.accountName).toBe('accounts/1');
    expect(target.locationPath).toBe('accounts/1/locations/2');
  });

  it('a full path in GBP_LOCATION_NAME is normalised, not doubled', async () => {
    mutableEnv.GBP_LOCATION_NAME = 'accounts/1/locations/2';
    const { resolveTarget } = await load();
    expect((await resolveTarget()).locationPath).toBe('accounts/1/locations/2');
  });

  it('when no account manages a profile, the error says so', async () => {
    delete mutableEnv.GBP_ACCOUNT_NAME;
    delete mutableEnv.GBP_LOCATION_NAME;
    handlers.accounts = () => ok({});
    const { resolveTarget } = await load();
    await expect(resolveTarget()).rejects.toMatchObject({ code: 'GBP_NOT_FOUND' });
  });

  it('listing follows pagination for accounts and locations', async () => {
    let page = 0;
    handlers.locations = () => {
      page += 1;
      return page === 1
        ? ok({ locations: [{ name: 'locations/1', title: 'A' }], nextPageToken: 'next' })
        : ok({ locations: [{ name: 'locations/2', title: 'B' }] });
    };
    const { business } = await load();
    const locations = await business.listLocations('accounts/1');
    expect(locations.map((l) => l.name)).toEqual(['locations/1', 'locations/2']);
  });
});

describe('no credential', () => {
  it('reports not connected without calling Google at all', async () => {
    credential = { connected: false, source: null as never, environmentTokenIgnored: false, environmentTokenShadowed: false };
    const { getConnectionState } = await load();
    const state = await getConnectionState();
    expect(state.hasRefreshToken).toBe(false);
    expect(state.oauthConnected).toBe(false);
    expect(state.connected).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

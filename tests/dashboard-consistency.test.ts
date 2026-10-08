/**
 * ONE source of truth.
 *
 * Whatever Google last said, the Dashboard, Settings, Connection page, System
 * Health, /api/health and the setup checklist must all say the same thing.
 * These tests run all of them against the same stubbed Google and compare.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mutableEnv = process.env as Record<string, string | undefined>;

/** Parsed JSON bodies are inspected loosely in these tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const getAccessToken = vi.fn();
let credential = { connected: true, source: 'stored', environmentTokenIgnored: false, environmentTokenShadowed: false };

vi.mock('@/lib/google-auth', () => ({
  getAccessToken: () => getAccessToken(),
  getCredentialState: async () => credential,
  getConnectionMeta: async () => ({ connectedAt: '2026-09-01T00:00:00.000Z', googleAccountEmail: 'owner@example.com' }),
}));

type Reply = { status: number; body: unknown };
const ok = (body: unknown): Reply => ({ status: 200, body });
const zeroQuota = (): Reply => ({
  status: 429,
  body: { error: { status: 'RESOURCE_EXHAUSTED', details: [{ reason: 'RATE_LIMIT_EXCEEDED', metadata: { quota_limit_value: '0' } }] } },
});

const PERFORMANCE_BODY = {
  multiDailyMetricTimeSeries: [
    {
      dailyMetricTimeSeries: [
        { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 1 }, value: '15' }] } },
        { dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 1 }, value: '300' }] } },
        { dailyMetric: 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 1 }, value: '160' }] } },
      ],
    },
  ],
};

const REVIEWS_BODY = {
  averageRating: 4.5,
  totalReviewCount: 2,
  reviews: [
    { reviewId: 'a', starRating: 'FIVE', comment: 'Great', createTime: new Date().toISOString(), updateTime: new Date().toISOString(), reviewer: { displayName: 'A' } },
    { reviewId: 'b', starRating: 'FOUR', comment: 'Good', createTime: '2026-01-01T00:00:00Z', updateTime: '2026-01-01T00:00:00Z', reviewer: { displayName: 'B' }, reviewReply: { comment: 'Thanks' } },
  ],
};

const google: Record<'accounts' | 'locations' | 'reviews' | 'posts' | 'performance', () => Reply> = {
  accounts: () => ok({ accounts: [{ name: 'accounts/1', accountName: 'JK Interior' }] }),
  locations: () => ok({ locations: [{ name: 'locations/2', title: 'JK Interior Forbesganj' }] }),
  reviews: () => ok(REVIEWS_BODY),
  posts: () => ok({}),
  performance: () => ok(PERFORMANCE_BODY),
};

const ORIGIN = 'https://example.test';

async function loadAll() {
  vi.resetModules();
  const security = await import('@/lib/security');
  const token = security.createSessionToken();
  const route = async (path: string) => (await import(path)) as Record<string, (r: Request) => Promise<Response>>;
  const get = async (modulePath: string, url: string) => {
    const mod = await route(modulePath);
    const response = await mod.GET!(
      new Request(`${ORIGIN}${url}`, {
        headers: { cookie: `jk_admin_session=${token}; jk_csrf=c`, origin: ORIGIN, 'x-forwarded-host': 'example.test', 'x-forwarded-proto': 'https' },
      }),
    );
    return { status: response.status, json: (await response.json()) as Json };
  };
  return {
    status: () => get('../app/api/status/route', '/api/status'),
    settings: () => get('../app/api/settings/route', '/api/settings'),
    accounts: () => get('../app/api/accounts/route', '/api/accounts'),
    performance: (days = 30) => get('../app/api/performance/route', `/api/performance?days=${days}`),
    reviews: () => get('../app/api/reviews/route', '/api/reviews'),
    health: async () => {
      const mod = (await import('../app/api/health/route')) as { GET: () => Promise<Response> };
      return (await mod.GET()).json() as Promise<Json>;
    },
    systemHealth: async () => (await import('@/lib/system-health')).buildSystemHealthReport(),
    checklist: async () => import('@/components/setup-checklist'),
    repository: await import('@/lib/repository'),
    access: await import('@/lib/gbp-access'),
    errors: await import('@/lib/errors'),
    store: await import('@/lib/store'),
  };
}

beforeEach(() => {
  mutableEnv.ADMIN_PASSWORD = 'admin-password-123';
  mutableEnv.SESSION_SECRET = 'session-secret-session-secret-session-secret';
  mutableEnv.CRON_SECRET = 'cron-secret';
  mutableEnv.GROQ_API_KEY = 'gsk_test_key_value_1234567890';
  mutableEnv.GOOGLE_CLIENT_ID = 'client-id';
  mutableEnv.GOOGLE_CLIENT_SECRET = 'client-secret';
  mutableEnv.GOOGLE_REDIRECT_URI = 'https://example.test/api/auth/google/callback';
  mutableEnv.GBP_ACCOUNT_NAME = 'accounts/1';
  mutableEnv.GBP_LOCATION_NAME = 'locations/2';
  mutableEnv.NODE_ENV = 'test';
  delete mutableEnv.GBP_MOCK_MODE;
  delete mutableEnv.UPSTASH_REDIS_REST_URL;
  delete mutableEnv.UPSTASH_REDIS_REST_TOKEN;

  credential = { connected: true, source: 'stored', environmentTokenIgnored: false, environmentTokenShadowed: false };
  getAccessToken.mockReset().mockResolvedValue('ya29.fake');
  google.accounts = () => ok({ accounts: [{ name: 'accounts/1', accountName: 'JK Interior' }] });
  google.locations = () => ok({ locations: [{ name: 'locations/2', title: 'JK Interior Forbesganj' }] });
  google.reviews = () => ok(REVIEWS_BODY);
  google.posts = () => ok({});
  google.performance = () => ok(PERFORMANCE_BODY);

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const key = url.includes('mybusinessaccountmanagement') ? 'accounts'
        : url.includes('mybusinessbusinessinformation') ? 'locations'
          : url.includes('/localPosts') ? 'posts'
            : url.includes('/reviews') ? 'reviews'
              : url.includes('businessprofileperformance') ? 'performance' : null;
      if (!key) throw new Error(`unexpected ${url}`);
      const { status, body } = google[key]();
      return new Response(JSON.stringify(body), { status });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ['ADMIN_PASSWORD', 'SESSION_SECRET', 'CRON_SECRET', 'GROQ_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GBP_ACCOUNT_NAME', 'GBP_LOCATION_NAME']) {
    delete mutableEnv[key];
  }
});

/** The status every surface reports, side by side. */
async function everySurface(app: Awaited<ReturnType<typeof loadAll>>) {
  // Pages that re-verify Google load first (as they do for a real visitor); the
  // read-only surfaces — /api/health and System Health, which never call
  // Google — are read afterwards, from the state those pages just recorded.
  const status = await app.status();
  const settings = await app.settings();
  const accounts = await app.accounts();
  const [health, systemHealth] = await Promise.all([app.health(), app.systemHealth()]);
  return {
    dashboard: status.json.data.connection.status as string,
    dashboardAccess: status.json.data.access.status as string,
    settings: settings.json.data.gbpAccess.status as string,
    connection: accounts.json.data.apiAccess as string,
    health: health.gbpApiAccess as string,
    systemHealth: systemHealth.checks.find((c) => c.id === 'gbp_api')!.status,
    summary: status.json.data,
    settingsData: settings.json.data,
  };
}

/* ---------------------------------------------------------------------------
 * The production scenario from the bug report
 * ------------------------------------------------------------------------- */

describe('OAuth connected, Performance API live, an older "pending" still stored', () => {
  async function stalePending(app: Awaited<ReturnType<typeof loadAll>>) {
    for (const service of ['accounts', 'locations', 'reviews', 'posts', 'performance'] as const) {
      await app.access.recordServiceFailure(service, new app.errors.AppError('GBP_QUOTA_EXCEEDED', 'q', 503));
    }
    // Pending was recorded a while ago — longer than the cooldown.
    const old = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    for (const service of ['accounts', 'locations', 'reviews', 'posts', 'performance'] as const) {
      await app.store.getStore().set(app.store.nsKey('gbp', 'access', 'svc', service), {
        service, status: 'pending', checkedAt: old, lastCode: 'GBP_QUOTA_EXCEEDED',
      });
    }
  }

  it('every screen reads AVAILABLE — nothing says "Approval pending"', async () => {
    const app = await loadAll();
    await stalePending(app);
    google.accounts = zeroQuota; // Account Management API not open yet
    google.locations = zeroQuota;

    const all = await everySurface(app);

    expect(all.dashboard).toBe('available');
    expect(all.dashboardAccess).toBe('available');
    expect(all.settings).toBe('available');
    expect(all.connection).toBe('available');
    expect(all.health).toBe('available');
    expect(all.systemHealth).toBe('healthy');

    // Access is proven, so the dashboard is connected and never says "pending"…
    expect(all.summary.connection.connected).toBe(true);
    expect(JSON.stringify(all.summary.connection)).not.toMatch(/pending/i);
    // …but two APIs genuinely are not open, so it must not read plain green
    // either: the part that is not working is named, not hidden.
    expect(all.summary.connection.label).toBe('Partly working');
    expect(all.summary.access.degraded.map((s: { service: string }) => s.service)).toEqual(
      expect.arrayContaining(['accounts', 'locations']),
    );
    expect(all.summary.connection.detail).toMatch(/Accounts and Locations/);
  });

  it('with every API answering, every screen is plain "Connected & Active" and setup is complete', async () => {
    const app = await loadAll();
    await stalePending(app); // an old pending must not matter once Google answers
    const all = await everySurface(app);

    expect(all.summary.access.degraded).toEqual([]);
    expect(all.summary.connection.label).toBe('Connected & Active');
    expect(all.summary.connection.detail).toBe('Connected and active — Google is answering Business Profile requests.');

    const { buildSteps } = await app.checklist();
    const steps = buildSteps({
      ...all.settingsData.config,
      gbpAccess: all.summary.access.status,
      gbpDegraded: all.summary.access.degraded.map((s: { service: string }) => s.service),
      storeReachable: true,
      durableStore: true,
      lastCronRunAt: new Date().toISOString(),
      cronFailed: false,
    });
    expect(steps.find((s) => s.key === 'google')).toMatchObject({ done: true, status: 'Connected & Active' });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('the state is durable: a brand-new instance (cold start) still reads AVAILABLE', async () => {
    const app = await loadAll();
    await stalePending(app);
    await everySurface(app);

    // Same Redis, new serverless instance: module state gone, stored state kept.
    const kept = await app.store.getStore().keys('jk:gbp:');
    const values = await app.store.getStore().getMany(kept);
    const fresh = await loadAll();
    await Promise.all(kept.map((k, i) => fresh.store.getStore().set(k, values[i])));

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect((await fresh.settings()).json.data.gbpAccess.status).toBe('available');
    expect((await fresh.health()).gbpApiAccess).toBe('available');
    // Reading state made no extra Google calls.
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });

  it('the setup checklist is NOT complete while an API is failing, even though access is proven', async () => {
    const app = await loadAll();
    await stalePending(app);
    google.accounts = zeroQuota;
    google.locations = zeroQuota;
    const all = await everySurface(app);
    const { buildSteps } = await app.checklist();

    const config = {
      ...all.settingsData.config,
      gbpAccess: all.summary.access.status,
      gbpDegraded: all.summary.access.degraded.map((s: { service: string }) => s.service),
      storeReachable: true, // (memory store in tests)
      durableStore: true,
      lastCronRunAt: new Date().toISOString(),
      cronFailed: false,
    };
    const steps = buildSteps(config);
    expect(steps.find((s) => s.key === 'google')).toMatchObject({ done: false, status: 'Partly working' });
    expect(steps.filter((s) => s.done)).toHaveLength(3);
  });

  it('live reviews and performance are labelled live (google), with real numbers', async () => {
    const app = await loadAll();
    await stalePending(app);
    const perf = await app.performance(30);
    expect(perf.json.data.source).toBe('google');
    const total = (metric: string) =>
      perf.json.data.snapshot.series.find((s: { metric: string }) => s.metric === metric)?.total;
    expect(total('CALL_CLICKS')).toBe(15);
    expect(total('BUSINESS_IMPRESSIONS_MOBILE_SEARCH') + total('BUSINESS_IMPRESSIONS_DESKTOP_MAPS')).toBe(460);

    const reviews = await app.reviews();
    expect(reviews.json.data.source).toBe('google');
    expect(reviews.json.data.reviews).toHaveLength(2);
  });
});

/* ---------------------------------------------------------------------------
 * Genuinely pending / broken: every screen agrees, and setup is NOT complete
 * ------------------------------------------------------------------------- */

describe('when Google really has not opened access', () => {
  beforeEach(() => {
    for (const key of Object.keys(google) as (keyof typeof google)[]) google[key] = zeroQuota;
  });

  it('every screen says pending — and none says connected/active', async () => {
    const app = await loadAll();
    const all = await everySurface(app);
    expect(new Set([all.dashboard, all.settings, all.connection, all.health])).toEqual(new Set(['pending']));
    expect(all.systemHealth).toBe('pending');
    expect(all.summary.connection.connected).toBe(false);
    expect(all.summary.connection.label).toBe('Approval pending');
  });

  it('"Setup complete" can NEVER appear while Google is pending', async () => {
    const app = await loadAll();
    const all = await everySurface(app);
    const { buildSteps, isGoogleStepDone } = await app.checklist();

    // Everything else is perfectly configured…
    const config = {
      oauthConfigured: true, googleConfigured: true, aiConfigured: true, cronConfigured: true,
      durableStore: true, storeReachable: true, lastCronRunAt: new Date().toISOString(), cronFailed: false,
      gbpAccess: all.summary.access.status,
    };
    const steps = buildSteps(config);
    // …and still only 3 of 4 are done, because Google is not.
    expect(isGoogleStepDone(config)).toBe(false);
    expect(steps.filter((s) => s.done)).toHaveLength(3);
    expect(steps.find((s) => s.key === 'google')).toMatchObject({ done: false, status: 'Awaiting approval' });
  });

  it('cached reviews are labelled as cached, never presented as live', async () => {
    const app = await loadAll();
    await app.repository.setCachedReviews({
      reviews: JSON.parse(JSON.stringify(REVIEWS_BODY.reviews.map((r) => ({
        name: `accounts/1/locations/2/reviews/${r.reviewId}`, reviewId: r.reviewId, reviewerName: 'A', starRating: 5,
        comment: 'c', createTime: r.createTime, updateTime: r.updateTime, existingReply: null, replyStatus: 'no_reply',
      })))),
      averageRating: 4.5, totalReviewCount: 2, fetchedAt: '2026-09-30T00:00:00.000Z', locationPath: 'accounts/1/locations/2',
    });
    const reviews = await app.reviews();
    expect(reviews.json.data.source).toBe('cache');
    expect(reviews.json.data.fetchedAt).toBe('2026-09-30T00:00:00.000Z');
    expect(reviews.json.data.cacheReason).toBeTruthy();

    const status = await app.status();
    expect(status.json.data.reviewsSource).toBe('cache');
  });

  it('cached performance is labelled cached, and only for the SAME range and location', async () => {
    const app = await loadAll();
    google.performance = () => ok(PERFORMANCE_BODY);
    await app.performance(30); // live → cached for 30 days
    google.performance = zeroQuota;
    const again = await app.performance(30);
    expect(again.json.data.source).toBe('cache');
    expect(again.json.data.cacheReason).toBeTruthy();

    // A 90-day request must NOT be answered with the 30-day snapshot.
    const other = await app.performance(90);
    expect(other.status).not.toBe(200);
    expect(other.json.data).toBeNull();
  });
});

describe('when the Google sign-in was revoked', () => {
  it('every screen says reconnect, and nothing claims connected or complete', async () => {
    const app = await loadAll();
    getAccessToken.mockRejectedValue(new app.errors.AppError('GOOGLE_AUTH_FAILED', 'revoked', 401));
    const all = await everySurface(app);
    expect(all.settings).toBe('auth_error');
    expect(all.connection).toBe('auth_error');
    expect(all.health).toBe('auth_error');
    expect(all.dashboard).toBe('auth_error');
    expect(all.summary.connection.connected).toBe(false);

    const health = await app.health();
    expect(health.status).toBe('degraded');
    expect(health.degradedReasons.join(' ')).toMatch(/reconnect/i);

    const { buildSteps } = await app.checklist();
    const steps = buildSteps({
      oauthConfigured: true, googleConfigured: true, aiConfigured: true, cronConfigured: true, durableStore: true,
      gbpAccess: all.summary.access.status,
    });
    expect(steps.find((s) => s.key === 'google')).toMatchObject({ done: false, status: 'Reconnect needed' });
  });

  it('after reconnecting (a successful call), the error is gone everywhere', async () => {
    const app = await loadAll();
    getAccessToken.mockRejectedValue(new app.errors.AppError('GOOGLE_AUTH_FAILED', 'revoked', 401));
    expect((await everySurface(app)).settings).toBe('auth_error');

    getAccessToken.mockResolvedValue('ya29.new'); // reconnected
    // Reconnect clears the recorded failure (see exchangeCodeForTokens).
    await app.access.clearAccessState();
    const all = await everySurface(app);
    expect(all.settings).toBe('available');
    expect(all.dashboard).toBe('available');
    expect(all.summary.connection.detail).not.toMatch(/reconnect/i);
  });
});

describe('not connected at all', () => {
  it('says so everywhere, makes no Google call, and /api/health reports not_connected', async () => {
    credential = { connected: false, source: null as never, environmentTokenIgnored: false, environmentTokenShadowed: false };
    const app = await loadAll();
    const all = await everySurface(app);
    expect(all.summary.connection.label).toBe('Not connected');
    expect(all.summary.connection.linked).toBe(false);
    expect(all.health).toBe('not_connected');
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------------
 * Dashboard cards
 * ------------------------------------------------------------------------- */

describe('dashboard figures', () => {
  it('counts reviews, rating, new reviews and unanswered from live Google data', async () => {
    const app = await loadAll();
    const { json } = await app.status();
    const data = json.data;
    expect(data.reviewsSource).toBe('google');
    expect(data.totalReviews).toBe(2);
    expect(data.averageRating).toBe(4.5);
    expect(data.newReviews).toBe(1); // only the one created now is within 7 days
    expect(data.unansweredReviews).toBe(1); // the other already has a reply on Google
    expect(data.recentReviews[0].reviewId).toBe('a');
  });

  it('counts posts and drafts from stored data', async () => {
    const app = await loadAll();
    const now = new Date().toISOString();
    const post = (id: string, status: string) => ({ id, type: 'general', title: id, description: id, cta: { type: 'NONE' }, status, createdAt: now, updatedAt: now });
    for (const [id, status] of [['p1', 'published'], ['p2', 'published'], ['p3', 'scheduled'], ['p4', 'draft'], ['p5', 'failed']]) {
      await app.repository.savePost(post(id!, status!) as import('@/lib/types').GbpPost);
    }
    const { json } = await app.status();
    expect(json.data.publishedPosts).toBe(2);
    expect(json.data.scheduledPosts).toBe(1);
  });

  it('automation shows the most recent run of EACH task, so one never hides another', async () => {
    const app = await loadAll();
    const base = { startedAt: '2026-10-01T02:30:00.000Z', finishedAt: '2026-10-01T02:30:05.000Z', summary: 's' };
    await app.repository.recordRun({ ...base, task: 'sync-reviews', ok: false, summary: 'failed' });
    await app.repository.recordRun({ ...base, startedAt: '2026-10-01T02:31:00.000Z', task: 'publish-replies', ok: true });
    const { json } = await app.status();
    const byTask = Object.fromEntries(json.data.automation.latestByTask.map((r: { task: string; ok: boolean }) => [r.task, r.ok]));
    expect(byTask).toEqual({ 'sync-reviews': false, 'publish-replies': true });
  });
});

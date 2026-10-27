/**
 * Business Profile access state, cron skipping and mock-mode safety.
 *
 * These cover the behaviour that matters while Google's access request is under
 * review: a connected account must not read as disconnected, a closed endpoint
 * must not be re-asked on every run, and a mock must never reach Google.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative: string) => readFileSync(root + relative, 'utf8');

const ENV_KEYS = ['GBP_MOCK_MODE', 'NODE_ENV', 'VERCEL_ENV'] as const;

/**
 * Next types NODE_ENV as read-only, which is right for application code but
 * blocks a test from simulating environments. A widened alias keeps the
 * assignment honest without loosening the compiler for the whole project.
 */
const mutableEnv = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = mutableEnv[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = saved[key];
  }
});

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of ENV_KEYS) delete mutableEnv[key];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) mutableEnv[key] = value;
  }
  return {
    access: await import('@/lib/gbp-access'),
    status: await import('@/lib/gbp-status'),
    errors: await import('@/lib/errors'),
    store: await import('@/lib/store'),
    config: await import('@/lib/config'),
    mock: await import('@/lib/gbp-mock'),
  };
}

async function loadErrors() {
  return load({});
}

/* ----------------------- 1-4. access classification ---------------------- */

describe('access state classification', () => {
  it('1. only a closed quota ("limit 0") means approval is pending', async () => {
    const { access } = await load({});
    expect(access.statusFromErrorCode('GBP_QUOTA_EXCEEDED')).toBe('pending');
    expect(access.describeAccess('pending')).toContain('connected');
    expect(access.describeAccess('pending')).toContain('pending approval');
  });

  it('2. a disabled API is NOT "approval pending" — it is something the owner can fix', async () => {
    const { access } = await load({});
    expect(access.statusFromErrorCode('GBP_API_NOT_ENABLED')).toBe('permission_error');
    const text = access.describeAccess('permission_error', 'GBP_API_NOT_ENABLED');
    expect(text).toMatch(/enable/i);
    expect(text).not.toMatch(/pending approval/i);
  });

  it('3. a genuine 429 is a temporary rate limit, not pending approval', async () => {
    const { access } = await load({});
    expect(access.statusFromErrorCode('GBP_RATE_LIMITED')).toBe('rate_limited');
    expect(access.describeAccess('rate_limited')).toContain('temporary');
  });

  it('4. an auth failure is distinct from pending, and from a permission error', async () => {
    const { access } = await load({});
    expect(access.statusFromErrorCode('GOOGLE_AUTH_FAILED')).toBe('auth_error');
    expect(access.statusFromErrorCode('GBP_FORBIDDEN')).toBe('permission_error');
  });

  it('no Google error is ever classified as "not connected"', async () => {
    const { access } = await load({});
    const codes = [
      'GBP_QUOTA_EXCEEDED',
      'GBP_API_NOT_ENABLED',
      'GBP_RATE_LIMITED',
      'GOOGLE_AUTH_FAILED',
      'GBP_FORBIDDEN',
      'GOOGLE_API_ERROR',
    ] as const;
    for (const code of codes) {
      expect(access.describeAccess(access.statusFromErrorCode(code))).not.toMatch(/disconnected/i);
    }
  });
});

/* -------------------------- Google error classifier ----------------------- */

describe('classifyGoogleError', () => {
  const quotaBody = (limit: string) => ({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute'",
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'RATE_LIMIT_EXCEEDED',
          metadata: { quota_limit_value: limit },
        },
      ],
    },
  });

  it('429 with a zero quota is approval pending', async () => {
    const { errors } = await loadErrors();
    expect(errors.classifyGoogleError(429, quotaBody('0')).code).toBe('GBP_QUOTA_EXCEEDED');
  });

  it('429 with a real quota is a temporary rate limit', async () => {
    const { errors } = await loadErrors();
    expect(errors.classifyGoogleError(429, quotaBody('300')).code).toBe('GBP_RATE_LIMITED');
  });

  it('403 SERVICE_DISABLED is "API not enabled", never pending approval', async () => {
    const { errors } = await loadErrors();
    const error = errors.classifyGoogleError(403, {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        message: 'My Business API has not been used in project 123 before or it is disabled.',
        details: [{ reason: 'SERVICE_DISABLED' }],
      },
    });
    expect(error.code).toBe('GBP_API_NOT_ENABLED');
    expect(errors.isApprovalPending(error.code)).toBe(false);
  });

  it('403 SERVICE_DISABLED names the exact API Google says is switched off', async () => {
    const { errors } = await loadErrors();
    const error = errors.classifyGoogleError(403, {
      error: {
        status: 'PERMISSION_DENIED',
        message: 'Google My Business API has not been used in project 123456 before or it is disabled.',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'SERVICE_DISABLED',
            metadata: { service: 'mybusiness.googleapis.com', consumer: 'projects/123456' },
          },
        ],
      },
    });
    expect(error.code).toBe('GBP_API_NOT_ENABLED');
    expect(error.message).toContain('Google My Business API');
    expect(error.message).toContain('mybusiness.googleapis.com');
    // The project number is what exposes "enabled in the wrong project", the
    // commonest reason an API stays off after the owner switched it on.
    expect(error.message).toContain('Google Cloud project 123456');
    expect(error.message).toMatch(/that same project/);
    expect(error.disabledApi).toEqual({ service: 'mybusiness.googleapis.com', project: '123456' });
  });

  it('reads the disabled API from the activation URL when the details carry none', async () => {
    const { errors } = await loadErrors();
    const error = errors.classifyGoogleError(403, {
      error: {
        status: 'PERMISSION_DENIED',
        message:
          'API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/mybusinessaccountmanagement.googleapis.com/overview?project=123456 then retry.',
        details: [{ reason: 'SERVICE_DISABLED' }],
      },
    });
    expect(error.code).toBe('GBP_API_NOT_ENABLED');
    expect(error.message).toContain('My Business Account Management API');
    expect(error.disabledApi?.project).toBe('123456');
  });

  it('never echoes a malformed service value from the payload', async () => {
    const { errors } = await loadErrors();
    const error = errors.classifyGoogleError(403, {
      error: {
        status: 'PERMISSION_DENIED',
        message: 'API has not been used in project 1 before or it is disabled.',
        details: [
          {
            reason: 'SERVICE_DISABLED',
            metadata: { service: 'evil <b>x</b>.example.com', consumer: 'projects/12 <i>x</i>' },
          },
        ],
      },
    });
    expect(error.code).toBe('GBP_API_NOT_ENABLED');
    expect(error.message).not.toMatch(/evil|<b>|<i>/);
    expect(error.message).toMatch(/switched off for this Google Cloud project/);
    expect(error.disabledApi).toEqual({ service: undefined, project: undefined });
  });

  it('403 insufficient scope asks the owner to reconnect', async () => {
    const { errors } = await loadErrors();
    const error = errors.classifyGoogleError(403, {
      error: { status: 'PERMISSION_DENIED', message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] },
    });
    expect(error.code).toBe('GOOGLE_AUTH_FAILED');
  });

  it('a plain 403 means the account cannot manage this profile', async () => {
    const { errors } = await loadErrors();
    const error = errors.classifyGoogleError(403, { error: { message: 'The caller does not have permission' } });
    expect(error.code).toBe('GBP_FORBIDDEN');
  });

  it('401, 404, 409 and 5xx each get their own code', async () => {
    const { errors } = await loadErrors();
    expect(errors.classifyGoogleError(401, {}).code).toBe('GOOGLE_AUTH_FAILED');
    expect(errors.classifyGoogleError(404, {}).code).toBe('GBP_NOT_FOUND');
    expect(errors.classifyGoogleError(409, {}).code).toBe('CONFLICT');
    for (const status of [500, 502, 503, 504]) {
      const error = errors.classifyGoogleError(status, {});
      expect(error.code).toBe('GOOGLE_API_ERROR');
      expect(error.httpStatus).toBe(502);
    }
  });

  it('never echoes the raw Google payload into the user-facing message', async () => {
    const { errors } = await loadErrors();
    const error = errors.classifyGoogleError(400, {
      error: { message: 'SECRET-LOOKING internal detail ya29.abcdef' },
    });
    expect(error.message).not.toContain('SECRET-LOOKING');
    expect(error.message).not.toContain('ya29');
  });
});

/* ------------- success overrides pending (the headline regression) -------- */

describe('a successful Google call always wins over an older "pending"', () => {
  it('pending → available the moment ANY API answers, and the state persists', async () => {
    const { access, errors } = await load({});
    const pending = new errors.AppError('GBP_QUOTA_EXCEEDED', 'quota', 503);

    await access.recordServiceFailure('accounts', pending);
    await access.recordServiceFailure('reviews', pending);
    expect((await access.readAccess()).status).toBe('pending');

    // Performance works (a different API with its own approval).
    await access.recordServiceSuccess('performance');
    const snapshot = await access.readAccess();
    expect(snapshot.status).toBe('available');
    expect(snapshot.lastSuccessAt).not.toBeNull();
    // The APIs that still fail are reported, not hidden.
    expect(snapshot.degraded.map((s) => s.service).sort()).toEqual(['accounts', 'reviews']);

    // …and it is durable: a fresh read (a new serverless instance) agrees.
    expect((await access.readAccess()).status).toBe('available');
  });

  it('a stale legacy "pending" record can no longer outrank a success', async () => {
    const { access, store } = await load({});
    await store.getStore().set(store.nsKey('gbp', 'access'), {
      status: 'pending',
      checkedAt: new Date().toISOString(),
      lastCode: 'GBP_QUOTA_EXCEEDED',
    });
    expect((await access.readAccess()).status).toBe('unknown');
    await access.recordServiceSuccess('reviews');
    expect((await access.readAccess()).status).toBe('available');
  });

  it('a later credential failure outranks an older success; a newer success clears it at once', async () => {
    const { access, errors } = await load({});
    await access.recordServiceSuccess('reviews');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await access.recordServiceFailure('reviews', new errors.AppError('GOOGLE_AUTH_FAILED', 'revoked', 401));
    expect((await access.readAccess()).status).toBe('auth_error');

    // No waiting for any debounce window: a success proves the credential works.
    await access.recordServiceSuccess('reviews');
    expect((await access.readAccess()).status).toBe('available');
  });

  it('a transient failure of one API does not erase another API\'s success', async () => {
    const { access, errors } = await load({});
    await access.recordServiceSuccess('performance');
    await access.recordServiceFailure('reviews', new errors.AppError('GBP_RATE_LIMITED', 'slow down', 503));
    const snapshot = await access.readAccess();
    expect(snapshot.status).toBe('available');
    expect(snapshot.degraded.map((s) => s.service)).toEqual(['reviews']);
  });

  it('404 / 409 / 400 say nothing about access and change nothing', async () => {
    const { access, errors } = await load({});
    await access.recordServiceSuccess('reviews');
    for (const error of [
      new errors.AppError('GBP_NOT_FOUND', 'x', 404),
      new errors.AppError('CONFLICT', 'x', 409),
      new errors.AppError('GOOGLE_API_ERROR', 'x', 400),
    ]) {
      await access.recordServiceFailure('reviews', error);
    }
    expect((await access.readAccess()).status).toBe('available');
  });

  it('with nothing available the most actionable failure is reported', async () => {
    const { status } = await load({});
    const failing = (service: 'accounts' | 'reviews', st: 'pending' | 'permission_error') => ({
      service,
      status: st,
      checkedAt: new Date().toISOString(),
    });
    const snapshot = status.deriveSnapshot(
      [failing('accounts', 'pending'), failing('reviews', 'permission_error')],
      null,
    );
    expect(snapshot.status).toBe('permission_error');
  });
});

/* ------------------------- 5. cooldown / no retries ---------------------- */

describe('retry protection', () => {
  const closed = async () => {
    const loaded = await load({});
    const pending = new loaded.errors.AppError('GBP_QUOTA_EXCEEDED', 'quota', 503);
    return { ...loaded, pending };
  };

  it('5. a recent pending result suppresses calls to THAT api inside the cooldown', async () => {
    const { access, pending } = await closed();
    await access.recordServiceFailure('reviews', pending);
    expect(await access.shouldSkipGoogleCalls({ service: 'reviews' })).toBe(true);
    // Other APIs were never found closed, so they are not gated.
    expect(await access.shouldSkipGoogleCalls({ service: 'performance' })).toBe(false);
  });

  it('5b. the cooldown is short (15 minutes) so approval is picked up quickly', async () => {
    const { access, pending } = await closed();
    expect(access.ACCESS_COOLDOWN_MS).toBeLessThanOrEqual(15 * 60 * 1000);
    await access.recordServiceFailure('reviews', pending);
    const later = Date.now() + access.ACCESS_COOLDOWN_MS + 1000;
    expect(await access.shouldSkipGoogleCalls({ service: 'reviews', now: later })).toBe(false);
  });

  it('5c. a transient rate limit is never cached into a skip', async () => {
    const { access, errors } = await closed();
    await access.recordServiceFailure('reviews', new errors.AppError('GBP_RATE_LIMITED', 'x', 503));
    expect(await access.shouldSkipGoogleCalls({ service: 'reviews' })).toBe(false);
  });

  it('5d. a success on ANY api lifts the gate immediately', async () => {
    const { access, pending } = await closed();
    await access.recordServiceFailure('reviews', pending);
    expect(await access.shouldSkipGoogleCalls({ service: 'reviews' })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await access.recordServiceSuccess('performance');
    expect(await access.shouldSkipGoogleCalls({ service: 'reviews' })).toBe(false);
    expect(await access.shouldSkipGoogleCalls()).toBe(false);
  });

  it('5e. the whole-snapshot gate needs EVERY known api to be closed', async () => {
    const { access, pending } = await closed();
    await access.recordServiceFailure('accounts', pending);
    expect(await access.shouldSkipGoogleCalls()).toBe(true);
    await access.recordServiceSuccess('performance');
    expect(await access.shouldSkipGoogleCalls()).toBe(false);
  });

  it('5f. an auth failure never gates — it must stay visible', async () => {
    const { access, errors } = await closed();
    await access.recordServiceFailure('reviews', new errors.AppError('GOOGLE_AUTH_FAILED', 'x', 401));
    expect(await access.shouldSkipGoogleCalls()).toBe(false);
  });

  it('5g. an automatic re-check is due only for a non-available state, once per cooldown', async () => {
    const { access, pending } = await closed();
    expect(access.isCheckDue(await access.readAccess())).toBe(true); // never checked
    await access.recordServiceFailure('reviews', pending);
    expect(access.isCheckDue(await access.readAccess())).toBe(false); // just checked
    expect(access.isCheckDue(await access.readAccess(), Date.now() + access.ACCESS_COOLDOWN_MS + 1)).toBe(true);
    await access.recordServiceSuccess('reviews');
    expect(access.isCheckDue(await access.readAccess(), Date.now() + 24 * 3600 * 1000)).toBe(false);
  });

  it('5h. a proven state with a still-failing api is re-checked once per cooldown, so a late approval shows up', async () => {
    const { access, pending } = await closed();
    await access.recordServiceSuccess('performance');
    await access.recordServiceFailure('accounts', pending);
    const snapshot = await access.readAccess();
    expect(snapshot.status).toBe('available');
    expect(access.isCheckDue(snapshot)).toBe(false); // just checked
    expect(access.isCheckDue(snapshot, Date.now() + access.ACCESS_COOLDOWN_MS + 1)).toBe(true);
  });
});

/* --------------------------- 6-7. mock mode safety ----------------------- */

describe('mock mode gating', () => {
  it('6. is off by default', async () => {
    const { config } = await load({ NODE_ENV: 'development' });
    expect(config.isMockModeActive()).toBe(false);
  });

  it('6b. can be enabled in development', async () => {
    const { config } = await load({ GBP_MOCK_MODE: 'true', NODE_ENV: 'development' });
    expect(config.isMockModeActive()).toBe(true);
  });

  it('7. CANNOT be enabled on the production deployment', async () => {
    const { config } = await load({
      GBP_MOCK_MODE: 'true',
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
    });
    expect(config.isMockModeActive()).toBe(false);
    expect(config.isMockModeBlocked()).toBe(true);
  });

  it('7b. works on a Vercel preview, where NODE_ENV is also "production"', async () => {
    const { config } = await load({
      GBP_MOCK_MODE: 'true',
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
    });
    expect(config.isMockModeActive()).toBe(true);
  });
});

/* ---------------------------- 8. mock review data ------------------------ */

describe('mock data', () => {
  it('8. every mock review is clearly marked and uses a mock resource name', async () => {
    const { mock } = await load({});
    const reviews = mock.mockReviews();
    expect(reviews).toHaveLength(3);
    for (const review of reviews) {
      expect(review.source).toBe('mock');
      expect(review.reviewId.startsWith('mock-')).toBe(true);
      expect(mock.isMockResourceName(review.name)).toBe(true);
    }
  });

  it('8b. covers Hinglish, English positive and English negative', async () => {
    const { mock } = await load({});
    const [hinglish, positive, negative] = mock.mockReviews();
    expect(hinglish!.comment).toContain('bahut accha');
    expect(hinglish!.starRating).toBe(5);
    expect(positive!.starRating).toBe(4);
    expect(negative!.starRating).toBe(2);
  });

  it('8c. a real Google resource name is never treated as mock', async () => {
    const { mock } = await load({});
    expect(mock.isMockResourceName('accounts/123/locations/456/reviews/789')).toBe(false);
  });

  it('8d. simulating a publish performs no network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { mock } = await load({});
    expect(mock.simulatePublish('mock/x').simulated).toBe(true);
    expect(mock.simulatePostPublish('abc')).toContain('mock/');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

/* -------------------- 9-13. structural safety guarantees ----------------- */

describe('publish safety under mock mode', () => {
  const publishRoute = read('app/api/reviews/reply/publish/route.ts');
  const postsPublish = read('app/api/posts/[id]/publish/route.ts');
  const tasks = read('lib/tasks.ts');

  it('9. a mock draft is refused when mock mode is off', () => {
    expect(publishRoute).toContain('isMockResourceName(draft.reviewName)');
    expect(publishRoute).toContain('cannot be published to Google');
  });

  it('10. mock publishing is simulated, never sent to Google', () => {
    expect(publishRoute).toContain('simulatePublish(draft.reviewName)');
    // Posts: every publish path (manual, create+publish, cron) shares one publisher.
    const publisher = read('lib/post-publisher.ts');
    expect(publisher).toContain('simulatePostPublish');
    expect(postsPublish).toContain('publishPostOnce');
    expect(tasks).toContain('publishPostOnce');
  });

  it('11. approval is still required, with no force/bypass field', () => {
    expect(publishRoute).toContain("draft.status !== 'approved'");
    expect(publishRoute).toContain('assertAdmin(request)');
    expect(publishRoute).not.toMatch(/force\s*:\s*z\./);
    expect(publishRoute).not.toMatch(/&&\s*!force/);
  });

  it('12. cron records a skip rather than failing when access is pending or rate limited', () => {
    expect(tasks).toContain("status: 'skipped'");
    expect(tasks).toContain("'gbp_access_pending'");
    expect(tasks).toContain("'gbp_rate_limited'");
    // ok:true — a skipped job is correct behaviour, not a broken system.
    expect(tasks).toContain('skippedForAccessStatus');
    // A rate-limited failure must be classified the same way, not re-thrown as a genuine error.
    expect(tasks).toContain('isExpectedWait');
  });

  it('13. pending access never deletes the refresh token or disconnects', () => {
    const connection = read('lib/connection.ts');
    const gbpAccess = read('lib/gbp-access.ts');
    for (const file of [connection, gbpAccess, tasks]) {
      expect(file).not.toContain('disconnect(');
      expect(file).not.toContain('REFRESH_TOKEN_KEY');
    }
    // A pending API result must not clear the account link.
    expect(connection).toContain('oauthConnected = true');
  });
});

/* --------------------------- 14. mock reaches real AI -------------------- */

describe('mock reviews use the real AI router', () => {
  it('14. no mocked AI response exists anywhere', () => {
    const mockModule = read('lib/gbp-mock.ts');
    expect(mockModule).not.toContain('generateReplyDraft');
    expect(mockModule).not.toMatch(/mockReply|fakeReply|cannedReply/i);
    // Drafting still flows through the real router.
    expect(read('lib/ai-reply.ts')).toContain("from './ai/router'");
  });
});

/* ------------- 15. every Google-touching task classifies failures --------- */

describe('cron failure classification', () => {
  const tasks = read('lib/tasks.ts');

  it('15. resolveTarget sits inside the classified try in every task', () => {
    // resolveTarget() itself calls Google, so a pending 403 raised there must be
    // recorded — otherwise the cooldown never engages from cron.
    const blocks = tasks.split('await resolveTarget()');
    // First element is the prelude; every later one must be preceded by a try.
    expect(blocks.length).toBeGreaterThan(1);
    for (const before of blocks.slice(0, -1)) {
      const tail = before.slice(-400);
      expect(tail).toMatch(/try\s*\{/);
    }
    // And each task routes its failure through the classifier.
    expect(tasks.match(/noteGoogleFailure\(error\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('15b. every GBP-dependent task checks the skip gate first', () => {
    const gated = tasks.match(/shouldSkipGbpWork\('/g)?.length ?? 0;
    // sync-reviews, generate-drafts, publish-posts, sync-performance
    expect(gated).toBeGreaterThanOrEqual(4);
  });
});


/* ---------------------------------------------------------------------------
 * Access proven, but one API is failing
 * ------------------------------------------------------------------------- */

describe('partly working access', () => {
  const at = '2026-10-08T01:00:00.000Z';
  const ok = (service: 'accounts' | 'locations' | 'performance') => ({
    service,
    status: 'available' as const,
    checkedAt: at,
    lastSuccessAt: at,
  });
  const reviewsOff = {
    service: 'reviews' as const,
    status: 'permission_error' as const,
    checkedAt: at,
    lastCode: 'GBP_API_NOT_ENABLED' as const,
  };

  it('stays available, but the message says which API is not working and why', async () => {
    const status = await import('@/lib/gbp-status');
    const snapshot = status.deriveSnapshot([ok('accounts'), ok('performance'), reviewsOff], null);
    expect(snapshot.status).toBe('available');
    expect(snapshot.degraded.map((s) => s.service)).toEqual(['reviews']);
    expect(snapshot.message).toMatch(/Reviews is not working/);
    expect(snapshot.message).toMatch(/switched off/);
  });

  it('is never plain green while an API is failing, and never amber when nothing is', async () => {
    const status = await import('@/lib/gbp-status');
    const partly = status.deriveSnapshot([ok('accounts'), reviewsOff], null);
    expect(status.accessLabel(partly)).toEqual({ label: 'Partly working', tone: 'warning' });

    const healthy = status.deriveSnapshot([ok('accounts'), ok('performance')], null);
    expect(healthy.degraded).toEqual([]);
    expect(status.accessLabel(healthy)).toEqual({ label: 'Connected & Active', tone: 'success' });
    expect(healthy.message).toBe(status.describeAccess('available'));
  });

  it('tells the owner exactly which Google Cloud API to enable', async () => {
    const { serviceHint } = await import('@/components/gbp-access-panel');
    expect(serviceHint(reviewsOff)).toMatch(/Google My Business API.*mybusiness\.googleapis\.com/);
    expect(serviceHint(ok('accounts'))).toBeNull();
  });

  it('names the project Google reported, and prefers the API Google named over our guess', async () => {
    const { serviceHint } = await import('@/components/gbp-access-panel');
    const hint = serviceHint({ ...reviewsOff, apiService: 'mybusiness.googleapis.com', project: '123456789' });
    expect(hint).toMatch(/Cloud project 123456789/);
    expect(hint).toMatch(/that same project/);

    // Google named a different API than the one we would have guessed for Reviews.
    const other = serviceHint({ ...reviewsOff, apiService: 'mybusinessbusinessinformation.googleapis.com' });
    expect(other).toMatch(/My Business Business Information API/);
    expect(other).not.toMatch(/Google My Business API/);
  });
});

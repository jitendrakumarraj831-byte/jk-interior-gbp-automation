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
    config: await import('@/lib/config'),
    mock: await import('@/lib/gbp-mock'),
  };
}

/* ----------------------- 1-4. access classification ---------------------- */

describe('access state classification', () => {
  it('1+2. 0 QPM / API-not-enabled is "pending", not a disconnect', async () => {
    const { access } = await load({});
    expect(access.statusFromErrorCode('GBP_QUOTA_EXCEEDED')).toBe('pending');
    expect(access.statusFromErrorCode('GBP_API_NOT_ENABLED')).toBe('pending');
    expect(access.describeAccess('pending')).toContain('connected');
    expect(access.describeAccess('pending')).toContain('pending approval');
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

/* ------------------------- 5. cooldown / no retries ---------------------- */

describe('retry protection', () => {
  it('5. a pending result suppresses further calls inside the cooldown', async () => {
    const { access } = await load({});
    await access.recordAccessFailure('GBP_QUOTA_EXCEEDED');
    expect(await access.shouldSkipGoogleCalls()).toBe(true);
  });

  it('5b. the cooldown expires so approval is picked up automatically', async () => {
    const { access } = await load({});
    await access.recordAccessFailure('GBP_QUOTA_EXCEEDED');
    const later = Date.now() + access.ACCESS_COOLDOWN_MS + 1000;
    expect(await access.shouldSkipGoogleCalls(later)).toBe(false);
  });

  it('5c. a transient rate limit is never cached into a skip', async () => {
    const { access } = await load({});
    await access.recordAccessFailure('GBP_RATE_LIMITED');
    expect(await access.shouldSkipGoogleCalls()).toBe(false);
  });

  it('5d. availability clears the skip immediately', async () => {
    const { access } = await load({});
    await access.recordAccessFailure('GBP_QUOTA_EXCEEDED');
    await access.recordAccessAvailable();
    expect(await access.shouldSkipGoogleCalls()).toBe(false);
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
    expect(postsPublish).toContain('simulatePostPublish');
    expect(tasks).toContain('simulatePostPublish(post.id)');
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
    const gated = tasks.match(/shouldSkipGbpWork\(\)/g)?.length ?? 0;
    // sync-reviews, generate-drafts, publish-posts, sync-performance
    expect(gated).toBeGreaterThanOrEqual(4);
  });
});

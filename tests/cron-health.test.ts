/**
 * Regression coverage for the production bug: "Automation / Cron = ERROR" in
 * System Health while the Business Profile API is merely rate limited or
 * pending approval — an expected wait, not a fault.
 *
 * Root cause: `shouldSkipGoogleCalls()` only pre-emptively skips calls while
 * access is 'pending'; a 'rate_limited' response was never pre-empted, so the
 * task actually attempted the Google call, got a classified GBP_RATE_LIMITED
 * error back, and unconditionally re-threw it. `runTask()` then marked the
 * run `ok:false`, and `system-health.ts`'s `cronCheck()` read that as a real
 * failure. Separately, `publishApprovedReplies()` recorded itself under the
 * SAME task name as `syncReviews()` ('sync-reviews'), so whichever of the two
 * ran later in /api/cron/sync silently overwrote the other's slot in the run
 * log — meaning the 'sync-reviews' health signal was not reliably the actual
 * review-sync outcome.
 *
 * The fix (lib/tasks.ts): a Google call that fails with a classified 'pending'
 * or 'rate_limited' status now returns a skipped (`ok:true`) result instead of
 * re-throwing; only a genuine fault (auth/permission/unclassified error)
 * still propagates and marks the run failed. `publishApprovedReplies()` now
 * records under its own task name, 'publish-replies'.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppErrorCode } from '@/lib/errors';

const mutableEnv = process.env as Record<string, string | undefined>;

const resolveTarget = vi.fn();
const listReviews = vi.fn();
const fetchPerformance = vi.fn();
const createLocalPost = vi.fn();
const publishReviewReply = vi.fn();

vi.mock('@/lib/connection', () => ({
  resolveTarget: () => resolveTarget(),
}));

vi.mock('@/lib/google-business', () => ({
  listReviews: (...args: unknown[]) => listReviews(...args),
  fetchPerformance: (...args: unknown[]) => fetchPerformance(...args),
  createLocalPost: (...args: unknown[]) => createLocalPost(...args),
  publishReviewReply: (...args: unknown[]) => publishReviewReply(...args),
}));

const DEFAULT_TARGET = {
  accountName: 'accounts/1',
  locationName: 'locations/2',
  locationPath: 'accounts/1/locations/2',
};

const EMPTY_REVIEWS = { reviews: [], averageRating: null, totalReviewCount: 0 };

async function loadTasks() {
  vi.resetModules();
  const errors = await import('@/lib/errors');
  const tasks = await import('@/lib/tasks');
  const access = await import('@/lib/gbp-access');
  const repository = await import('@/lib/repository');
  const security = await import('@/lib/security');
  const systemHealth = await import('@/lib/system-health');
  const appError = (code: AppErrorCode, message: string, status = 503) =>
    new errors.AppError(code, message, status);
  return { tasks, access, repository, security, systemHealth, appError };
}

beforeEach(() => {
  mutableEnv.GOOGLE_CLIENT_ID = 'test-client-id';
  mutableEnv.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  mutableEnv.GOOGLE_REDIRECT_URI = 'https://example.test/api/auth/google/callback';
  mutableEnv.GROQ_API_KEY = 'test-groq-key';
  mutableEnv.CRON_SECRET = 'test-cron-secret';
  delete mutableEnv.GBP_MOCK_MODE;
  delete mutableEnv.UPSTASH_REDIS_REST_URL;
  delete mutableEnv.UPSTASH_REDIS_REST_TOKEN;

  resolveTarget.mockReset().mockResolvedValue(DEFAULT_TARGET);
  listReviews.mockReset().mockResolvedValue(EMPTY_REVIEWS);
  fetchPerformance.mockReset();
  createLocalPost.mockReset();
  publishReviewReply.mockReset();
});

afterEach(() => {
  for (const key of [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'GROQ_API_KEY',
    'CRON_SECRET',
  ]) {
    delete mutableEnv[key];
  }
});

/* --------------------------- 1. pending → skipped -------------------------- */

describe('1. GBP API access pending', () => {
  it('is skipped before any Google call, and is reported ok:true / skipped', async () => {
    const { tasks, access } = await loadTasks();
    await access.recordAccessFailure('GBP_QUOTA_EXCEEDED'); // -> status 'pending'

    const run = await tasks.syncReviews();

    expect(run.ok).toBe(true);
    expect(run.details).toMatchObject({ status: 'skipped', reason: 'gbp_access_pending' });
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(listReviews).not.toHaveBeenCalled();
  });
});

/* -------------------------- 2. rate limit → skipped ------------------------ */

describe('2. GBP rate limit', () => {
  it('a 429 encountered mid-call is classified as skipped, not a failure', async () => {
    const { tasks, appError, access } = await loadTasks();
    listReviews.mockRejectedValue(
      appError('GBP_RATE_LIMITED', 'Google is rate limiting requests right now. This is temporary.'),
    );

    const run = await tasks.syncReviews();

    expect(run.ok).toBe(true);
    expect(run.details).toMatchObject({ status: 'skipped', reason: 'gbp_rate_limited' });
    // The call was actually attempted (rate limits are not pre-emptively cached
    // into a skip) — only the RESULT is reclassified, not whether Google is called.
    expect(resolveTarget).toHaveBeenCalledTimes(1);
    expect(listReviews).toHaveBeenCalledTimes(1);
    expect((await access.readAccess()).status).toBe('rate_limited');
  });

  it('the same classification applies to generateDrafts, publishScheduledPosts and syncPerformance', async () => {
    const { tasks, appError, repository } = await loadTasks();
    const rateLimited = () => appError('GBP_RATE_LIMITED', 'rate limited');

    listReviews.mockRejectedValue(rateLimited());
    const drafts = await tasks.generateDrafts();
    expect(drafts.ok).toBe(true);
    expect(drafts.details).toMatchObject({ status: 'skipped', reason: 'gbp_rate_limited' });

    // publishScheduledPosts only reaches Google once a post is actually due.
    await repository.savePost({
      id: 'post-1',
      type: 'general',
      title: 'Due post',
      description: 'A post whose scheduled time has passed.',
      cta: { type: 'NONE' },
      scheduledFor: '2020-01-01T00:00:00.000Z',
      status: 'scheduled',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    });
    resolveTarget.mockRejectedValueOnce(rateLimited());
    const posts = await tasks.publishScheduledPosts();
    expect(posts.ok).toBe(true);
    expect(posts.details).toMatchObject({ status: 'skipped', reason: 'gbp_rate_limited' });

    resolveTarget.mockRejectedValueOnce(rateLimited());
    const performance = await tasks.syncPerformance();
    expect(performance.ok).toBe(true);
    expect(performance.details).toMatchObject({ status: 'skipped', reason: 'gbp_rate_limited' });
  });
});

/* ----------------------- 3. skipped never turns Cron red -------------------- */

describe('3. a skipped run never turns Automation / Cron red', () => {
  it('pending-skip reports healthy', async () => {
    const { tasks, access, systemHealth } = await loadTasks();
    await access.recordAccessFailure('GBP_QUOTA_EXCEEDED');
    await tasks.syncReviews();

    const cron = (await systemHealth.buildSystemHealthReport()).checks.find((c) => c.id === 'cron');
    expect(cron?.status).not.toBe('error');
    expect(cron?.status).toBe('healthy');
  });

  it('rate-limit-skip reports healthy', async () => {
    const { tasks, appError, systemHealth } = await loadTasks();
    listReviews.mockRejectedValue(appError('GBP_RATE_LIMITED', 'rate limited'));
    await tasks.syncReviews();

    const cron = (await systemHealth.buildSystemHealthReport()).checks.find((c) => c.id === 'cron');
    expect(cron?.status).not.toBe('error');
    expect(cron?.status).toBe('healthy');
  });
});

/* ------------------------ 4. genuine failure stays red ---------------------- */

describe('4. a genuine internal failure still turns Cron health error', () => {
  it('a non-GBP failure (AI not configured) is reported as error, naming the task', async () => {
    const { tasks, systemHealth } = await loadTasks();
    delete mutableEnv.GROQ_API_KEY; // no AI provider configured -> genuine internal fault

    const run = await tasks.generateDrafts();
    expect(run.ok).toBe(false);

    const cron = (await systemHealth.buildSystemHealthReport()).checks.find((c) => c.id === 'cron');
    expect(cron?.status).toBe('error');
    expect(cron?.detail).toContain('generate-drafts');
  });

  it('a genuine GBP fault (not pending/rate-limited) is still reported as error', async () => {
    const { tasks, systemHealth, appError } = await loadTasks();
    listReviews.mockRejectedValue(
      appError('GBP_FORBIDDEN', 'Google denied this request.', 403),
    );

    const run = await tasks.syncReviews();
    expect(run.ok).toBe(false);

    const cron = (await systemHealth.buildSystemHealthReport()).checks.find((c) => c.id === 'cron');
    expect(cron?.status).toBe('error');
  });
});

/* ---------------------------- 5. success → healthy -------------------------- */

describe('5. a successful job reports Cron health healthy', () => {
  it('a clean run reports healthy', async () => {
    const { tasks, systemHealth } = await loadTasks();
    const run = await tasks.syncReviews();
    expect(run.ok).toBe(true);

    const cron = (await systemHealth.buildSystemHealthReport()).checks.find((c) => c.id === 'cron');
    expect(cron?.status).toBe('healthy');
  });
});

/* --------------------- 6. an old failure never outlives a fix --------------- */

describe('6. an old historical failure does not mask the current healthy state', () => {
  it('lastRunOf and Cron health reflect only the most recent run for a task', async () => {
    const { tasks, repository, systemHealth } = await loadTasks();

    // An old, genuinely failed run recorded first.
    await repository.recordRun({
      task: 'sync-reviews',
      startedAt: '2020-01-01T00:00:00.000Z',
      finishedAt: '2020-01-01T00:00:05.000Z',
      ok: false,
      summary: 'an old, unrelated failure',
    });

    // A fresh, successful run for the same task, recorded after.
    const run = await tasks.syncReviews();
    expect(run.ok).toBe(true);

    const last = await repository.lastRunOf('sync-reviews');
    expect(last?.ok).toBe(true);
    expect(last?.startedAt).not.toBe('2020-01-01T00:00:00.000Z');

    const cron = (await systemHealth.buildSystemHealthReport()).checks.find((c) => c.id === 'cron');
    expect(cron?.status).toBe('healthy');
  });

  it('publishApprovedReplies no longer overwrites syncReviews’ run-log slot', async () => {
    const { tasks, repository } = await loadTasks();

    const syncRun = await tasks.syncReviews();
    const publishRun = await tasks.publishApprovedReplies(); // auto-publish off by default

    expect(syncRun.task).toBe('sync-reviews');
    expect(publishRun.task).toBe('publish-replies');

    const lastSyncReviews = await repository.lastRunOf('sync-reviews');
    expect(lastSyncReviews?.startedAt).toBe(syncRun.startedAt);

    const lastPublishReplies = await repository.lastRunOf('publish-replies');
    expect(lastPublishReplies?.startedAt).toBe(publishRun.startedAt);
  });
});

/* ----------------------- 7. cron authentication protected ------------------- */

describe('7. cron authentication remains protected', () => {
  it('rejects a request with no credentials', async () => {
    const { security } = await loadTasks();
    const request = new Request('https://example.test/api/cron/sync');
    expect(() => security.assertCronAuthorized(request)).toThrow();
  });

  it('accepts the correct bearer token', async () => {
    const { security } = await loadTasks();
    const request = new Request('https://example.test/api/cron/sync', {
      headers: { authorization: `Bearer ${mutableEnv.CRON_SECRET}` },
    });
    expect(() => security.assertCronAuthorized(request)).not.toThrow();
  });

  it('is disabled (never open) when CRON_SECRET is unset', async () => {
    delete mutableEnv.CRON_SECRET;
    const { security } = await loadTasks();
    const request = new Request('https://example.test/api/cron/sync', {
      headers: { authorization: 'Bearer anything' },
    });
    expect(() => security.assertCronAuthorized(request)).toThrow();
  });
});

/* ------------------------------- 8. no retry loop --------------------------- */

describe('8. no retry loop', () => {
  it('a task makes exactly one Google call attempt per invocation, even on failure', async () => {
    const { tasks, appError } = await loadTasks();
    listReviews.mockRejectedValue(appError('GBP_RATE_LIMITED', 'rate limited'));

    await tasks.syncReviews();

    expect(resolveTarget).toHaveBeenCalledTimes(1);
    expect(listReviews).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------ 9. no unnecessary GBP API calls ------------------- */

describe('9. no unnecessary GBP API calls', () => {
  it('every GBP-dependent task skips before calling Google while access is pending', async () => {
    const { tasks, access } = await loadTasks();
    await access.recordAccessFailure('GBP_API_NOT_ENABLED');

    await tasks.syncReviews();
    await tasks.generateDrafts();
    await tasks.publishScheduledPosts();
    await tasks.syncPerformance();

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(listReviews).not.toHaveBeenCalled();
    expect(fetchPerformance).not.toHaveBeenCalled();
    expect(createLocalPost).not.toHaveBeenCalled();
  });
});

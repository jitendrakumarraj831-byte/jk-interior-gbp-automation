/**
 * lib/social/tasks.ts — the cron publisher's rate-limit/retry and Auto
 * Publish gating logic. lib/social/publish.ts (the actual Meta-calling
 * function) is mocked, so no adapter or network call happens here — this
 * file only tests the orchestration around it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SocialPost } from '@/lib/social/types';

const publishMock = vi.fn();

vi.mock('@/lib/social/publish', () => ({
  publishSocialPostNow: (...args: unknown[]) => publishMock(...args),
}));

const BASE_ENV = {
  META_APP_ID: 'app-id',
  META_APP_SECRET: 'app-secret',
  META_REDIRECT_URI: 'https://example.com/callback',
  META_ENCRYPTION_KEY: Buffer.from('0'.repeat(32)).toString('base64'),
  META_SOCIAL_ENABLED: 'true',
  META_FACEBOOK_ENABLED: 'true',
  META_INSTAGRAM_ENABLED: 'true',
};

async function loadTasks(env: Record<string, string | undefined> = BASE_ENV) {
  vi.resetModules();
  publishMock.mockReset();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  for (const key of Object.keys(BASE_ENV)) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  const tasks = await import('@/lib/social/tasks');
  const repository = await import('@/lib/social/repository');
  const settings = await import('@/lib/social/settings');
  // Imported after resetModules() so it is the exact class instance
  // lib/social/tasks.ts's `error instanceof AppError` checks against —
  // importing it once at file scope would be a stale, pre-reset instance.
  const { AppError } = await import('@/lib/errors');
  return { tasks, repository, settings, AppError };
}

function duePost(overrides: Partial<SocialPost> = {}): SocialPost {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'post-1',
    title: 'Due post',
    contentType: 'gypsum_false_ceiling',
    platforms: 'facebook',
    language: 'en',
    content: '',
    facebookContent: { caption: 'caption', hashtags: [] },
    instagramContent: null,
    mediaIds: [],
    status: 'scheduled',
    approvalStatus: 'approved',
    scheduledAt: new Date(Date.now() - 60_000).toISOString(),
    createdAt: now,
    updatedAt: now,
    createdBy: 'admin:test',
    retryCount: 0,
    externalPostIds: {},
    contentHash: overrides.id ?? 'hash-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('publishScheduledSocialPosts — Meta not configured', () => {
  it('skips cleanly without calling publish', async () => {
    const { tasks } = await loadTasks({});
    const run = await tasks.publishScheduledSocialPosts();
    expect(run.ok).toBe(true);
    expect(publishMock).not.toHaveBeenCalled();
  });
});

describe('publishScheduledSocialPosts — Auto Publish gating', () => {
  it('leaves a due post scheduled (never calls Meta) while Facebook Auto Publish is off', async () => {
    const { tasks, repository } = await loadTasks();
    await repository.saveSocialPost(duePost());

    const run = await tasks.publishScheduledSocialPosts();

    expect(publishMock).not.toHaveBeenCalled();
    expect(run.ok).toBe(true);
    const post = await repository.getSocialPost('post-1');
    expect(post?.status).toBe('scheduled');
  });

  it('publishes once Facebook Auto Publish is switched on', async () => {
    const { tasks, repository, settings } = await loadTasks();
    await settings.saveSocialSettings({ facebookAutoPublish: true });
    await repository.saveSocialPost(duePost());
    publishMock.mockImplementation(async (post: SocialPost) => ({ ...post, status: 'published' }));

    const run = await tasks.publishScheduledSocialPosts();

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(run.details?.published).toBe(1);
  });
});

describe('publishScheduledSocialPosts — rate limit handling', () => {
  it('reverts the post to scheduled and stops the loop on META_RATE_LIMITED, without hammering the rest', async () => {
    const { tasks, repository, settings, AppError } = await loadTasks();
    await settings.saveSocialSettings({ facebookAutoPublish: true });
    await repository.saveSocialPost(duePost({ id: 'post-a', contentHash: 'hash-a' }));
    await repository.saveSocialPost(duePost({ id: 'post-b', contentHash: 'hash-b' }));
    publishMock.mockRejectedValue(new AppError('META_RATE_LIMITED', 'Meta is rate limiting requests.', 503));

    const run = await tasks.publishScheduledSocialPosts();

    // Only the first due post is attempted — the loop stops rather than
    // retrying every other post against a rate limit we already know about.
    expect(publishMock).toHaveBeenCalledTimes(1);
    const a = await repository.getSocialPost('post-a');
    const b = await repository.getSocialPost('post-b');
    expect(a?.status).toBe('scheduled');
    expect(b?.status).toBe('scheduled');
    expect(run.ok).toBe(true); // a retryable wait is not a failure
  });

  it('reverts to scheduled (not failed) on META_TOKEN_EXPIRED too', async () => {
    const { tasks, repository, settings, AppError } = await loadTasks();
    await settings.saveSocialSettings({ facebookAutoPublish: true });
    await repository.saveSocialPost(duePost());
    publishMock.mockRejectedValue(new AppError('META_TOKEN_EXPIRED', 'Token expired.', 401));

    await tasks.publishScheduledSocialPosts();

    const post = await repository.getSocialPost('post-1');
    expect(post?.status).toBe('scheduled');
  });
});

describe('publishScheduledSocialPosts — genuine failures', () => {
  it('marks the post failed and increments retryCount on a non-retryable error, and keeps processing the rest', async () => {
    const { tasks, repository, settings, AppError } = await loadTasks();
    await settings.saveSocialSettings({ facebookAutoPublish: true });
    await repository.saveSocialPost(duePost({ id: 'post-a', contentHash: 'hash-a' }));
    await repository.saveSocialPost(duePost({ id: 'post-b', contentHash: 'hash-b' }));
    publishMock.mockRejectedValue(new AppError('META_MEDIA_INVALID', 'Bad media.', 400));

    const run = await tasks.publishScheduledSocialPosts();

    expect(publishMock).toHaveBeenCalledTimes(2);
    const a = await repository.getSocialPost('post-a');
    expect(a?.status).toBe('failed');
    expect(a?.retryCount).toBe(1);
    expect(a?.lastError).toContain('Bad media');
    expect(run.ok).toBe(false);
  });
});

describe('publishScheduledSocialPosts — duplicate protection', () => {
  it('skips a due post whose content hash matches an already-published post, without calling Meta', async () => {
    const { tasks, repository, settings } = await loadTasks();
    await settings.saveSocialSettings({ facebookAutoPublish: true });
    await repository.saveSocialPost(
      duePost({
        id: 'already-live',
        status: 'published',
        scheduledAt: undefined,
        contentHash: 'shared-hash',
      }),
    );
    await repository.saveSocialPost(duePost({ id: 'post-1', contentHash: 'shared-hash' }));

    const run = await tasks.publishScheduledSocialPosts();

    expect(publishMock).not.toHaveBeenCalled();
    const post = await repository.getSocialPost('post-1');
    expect(post?.status).toBe('skipped');
    expect(run.details?.skipped).toBeGreaterThanOrEqual(1);
  });
});

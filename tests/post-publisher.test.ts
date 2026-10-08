/**
 * Publishing a Business Profile post: one request creates one Google post,
 * however many clicks, retries or overlapping cron runs there are.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppErrorCode } from '@/lib/errors';

const mutableEnv = process.env as Record<string, string | undefined>;

const createLocalPost = vi.fn();
vi.mock('@/lib/google-business', () => ({
  createLocalPost: (...args: unknown[]) => createLocalPost(...args),
}));

async function load() {
  vi.resetModules();
  const publisher = await import('@/lib/post-publisher');
  const repository = await import('@/lib/repository');
  const errors = await import('@/lib/errors');
  return { publisher, repository, errors };
}

function post(id: string, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id,
    type: 'general' as const,
    title: `Title ${id}`,
    description: `Body ${id}`,
    cta: { type: 'NONE' as const },
    status: 'draft' as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  delete mutableEnv.UPSTASH_REDIS_REST_URL;
  delete mutableEnv.UPSTASH_REDIS_REST_TOKEN;
  delete mutableEnv.GBP_MOCK_MODE;
  createLocalPost.mockReset().mockResolvedValue('accounts/1/locations/2/localPosts/abc');
});

afterEach(() => {
  delete mutableEnv.GBP_MOCK_MODE;
});

describe('publishPostOnce', () => {
  it('publishes, and marks published only after Google returns a name', async () => {
    const { publisher, repository } = await load();
    const saved = await repository.savePost(post('p1'));
    const outcome = await publisher.publishPostOnce(saved, async () => 'accounts/1/locations/2');
    expect(outcome.kind).toBe('published');
    const stored = await repository.getPost('p1');
    expect(stored?.status).toBe('published');
    expect(stored?.googlePostName).toBe('accounts/1/locations/2/localPosts/abc');
    expect(createLocalPost).toHaveBeenCalledTimes(1);
  });

  it('ten simultaneous publishes of the same post create exactly one Google post', async () => {
    const { publisher, repository } = await load();
    const saved = await repository.savePost(post('p2'));
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => publisher.publishPostOnce(saved, async () => 'accounts/1/locations/2')),
    );
    expect(createLocalPost).toHaveBeenCalledTimes(1);
    expect(outcomes.filter((o) => o.kind === 'published')).toHaveLength(1);
    // The rest were told "busy" or "already published" — none published or failed.
    expect(outcomes.filter((o) => o.kind === 'failed')).toHaveLength(0);
  });

  it('a post that is already published is left alone', async () => {
    const { publisher, repository } = await load();
    const saved = await repository.savePost(post('p3', { status: 'published' }));
    const outcome = await publisher.publishPostOnce(saved, async () => 'x');
    expect(outcome.kind).toBe('skipped');
    expect(createLocalPost).not.toHaveBeenCalled();
  });

  it('a post cancelled after the list was read is not published', async () => {
    const { publisher, repository } = await load();
    const stale = await repository.savePost(post('p4', { status: 'scheduled' }));
    await repository.savePost({ ...stale, status: 'cancelled' }); // changed meanwhile
    const outcome = await publisher.publishPostOnce(stale, async () => 'x');
    expect(outcome.kind).toBe('skipped');
    expect(createLocalPost).not.toHaveBeenCalled();
  });

  it('identical content already live in the last day is refused, not posted twice', async () => {
    const { publisher, repository } = await load();
    await repository.savePost(
      post('orig', { title: 'Same', description: 'Same text', status: 'published', publishedAt: new Date().toISOString() }),
    );
    const copy = await repository.savePost(post('copy', { title: 'same', description: 'Same   text' }));
    const outcome = await publisher.publishPostOnce(copy, async () => 'x');
    expect(outcome.kind).toBe('duplicate');
    expect(createLocalPost).not.toHaveBeenCalled();
  });

  it('identical content from over a day ago is allowed again', async () => {
    const { publisher, repository } = await load();
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    await repository.savePost(
      post('old', { title: 'Same', description: 'Same text', status: 'published', publishedAt: old, updatedAt: old }),
    );
    const again = await repository.savePost(post('again', { title: 'Same', description: 'Same text' }));
    // savePost stamps updatedAt=now on the old one; rewrite via the store to keep it old.
    const { getStore, nsKey } = await import('@/lib/store');
    await getStore().set(nsKey('post', 'old'), post('old', { title: 'Same', description: 'Same text', status: 'published', publishedAt: old, updatedAt: old }));
    const outcome = await publisher.publishPostOnce(again, async () => 'accounts/1/locations/2');
    expect(outcome.kind).toBe('published');
  });

  it('a Google failure is reported, never recorded as published, and releases the claim', async () => {
    const { publisher, repository, errors } = await load();
    createLocalPost.mockRejectedValueOnce(new errors.AppError('GBP_FORBIDDEN', 'denied', 403));
    const saved = await repository.savePost(post('p5'));
    const outcome = await publisher.publishPostOnce(saved, async () => 'accounts/1/locations/2');
    expect(outcome.kind).toBe('failed');
    expect((await repository.getPost('p5'))?.status).toBe('publishing'); // caller records the failure
    expect((await repository.getPost('p5'))?.googlePostName).toBeUndefined();

    // The claim is released, so a retry is possible.
    createLocalPost.mockResolvedValueOnce('accounts/1/locations/2/localPosts/zzz');
    const retry = await publisher.publishPostOnce(await repository.savePost(post('p5')), async () => 'accounts/1/locations/2');
    expect(retry.kind).toBe('published');
  });

  it('mock mode never reaches Google and produces a mock/ name', async () => {
    mutableEnv.GBP_MOCK_MODE = 'true';
    const { publisher, repository } = await load();
    const saved = await repository.savePost(post('p6'));
    const outcome = await publisher.publishPostOnce(saved, async () => {
      throw new Error('target must not be resolved in mock mode');
    });
    expect(outcome.kind).toBe('published');
    expect(createLocalPost).not.toHaveBeenCalled();
    expect((await repository.getPost('p6'))?.googlePostName).toMatch(/^mock\//);
  });

  it('transient Google faults are told apart from permanent ones', async () => {
    const { publisher, errors } = await load();
    const e = (code: AppErrorCode, status: number) => new errors.AppError(code, 'x', status);
    expect(publisher.isTransientFailure(e('GBP_RATE_LIMITED', 503))).toBe(true);
    expect(publisher.isTransientFailure(e('GOOGLE_API_ERROR', 502))).toBe(true);
    expect(publisher.isTransientFailure(e('GBP_FORBIDDEN', 403))).toBe(false);
    expect(publisher.isTransientFailure(e('VALIDATION_FAILED', 400))).toBe(false);
  });
});

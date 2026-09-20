/**
 * Social post + media repository — CRUD, due-post filtering, and the
 * usedInPostIds bookkeeping the Media Manager's "used" badge relies on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MediaAsset, SocialPost } from '@/lib/social/types';

async function loadRepo() {
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  return import('@/lib/social/repository');
}

function makePost(overrides: Partial<SocialPost> = {}): SocialPost {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'post-1',
    title: 'Test post',
    contentType: 'gypsum_false_ceiling',
    platforms: 'both',
    language: 'en',
    content: 'topic',
    facebookContent: { caption: 'fb caption', hashtags: [] },
    instagramContent: { caption: 'ig caption', hashtags: ['interior'] },
    mediaIds: [],
    status: 'draft',
    approvalStatus: 'pending',
    createdAt: now,
    updatedAt: now,
    createdBy: 'admin:test',
    retryCount: 0,
    externalPostIds: {},
    contentHash: 'hash-1',
    ...overrides,
  };
}

function makeMedia(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: overrides.id ?? 'media-1',
    url: 'https://blob.example/media-1.jpg',
    filename: 'media-1.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    usedInPostIds: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('social post CRUD', () => {
  it('saves, retrieves and lists posts newest-first', async () => {
    const repo = await loadRepo();
    const older = makePost({ id: 'post-old', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = makePost({ id: 'post-new', createdAt: '2026-06-01T00:00:00.000Z' });
    await repo.saveSocialPost(older);
    await repo.saveSocialPost(newer);

    const list = await repo.listSocialPosts();
    expect(list.map((p) => p.id)).toEqual(['post-new', 'post-old']);
    expect(await repo.getSocialPost('post-new')).toMatchObject({ id: 'post-new' });
  });

  it('deletes a post', async () => {
    const repo = await loadRepo();
    await repo.saveSocialPost(makePost({ id: 'to-delete' }));
    await repo.deleteSocialPost('to-delete');
    expect(await repo.getSocialPost('to-delete')).toBeNull();
  });
});

describe('listDueSocialPosts', () => {
  it('only returns scheduled + approved posts whose time has come', async () => {
    const repo = await loadRepo();
    const now = new Date('2026-06-15T12:00:00.000Z');

    await repo.saveSocialPost(
      makePost({ id: 'due-approved', status: 'scheduled', approvalStatus: 'approved', scheduledAt: '2026-06-15T11:00:00.000Z' }),
    );
    await repo.saveSocialPost(
      makePost({ id: 'not-yet', status: 'scheduled', approvalStatus: 'approved', scheduledAt: '2026-06-16T00:00:00.000Z' }),
    );
    await repo.saveSocialPost(
      makePost({ id: 'unapproved', status: 'scheduled', approvalStatus: 'pending', scheduledAt: '2026-06-15T11:00:00.000Z' }),
    );
    await repo.saveSocialPost(makePost({ id: 'draft-only', status: 'draft', approvalStatus: 'pending' }));

    const due = await repo.listDueSocialPosts(now);
    expect(due.map((p) => p.id)).toEqual(['due-approved']);
  });
});

describe('media usage bookkeeping', () => {
  it('marks and unmarks a media asset as used by a post', async () => {
    const repo = await loadRepo();
    await repo.saveMediaAsset(makeMedia({ id: 'm1' }));

    await repo.markMediaUsed('m1', 'post-a');
    expect((await repo.getMediaAsset('m1'))?.usedInPostIds).toEqual(['post-a']);

    // Marking the same post twice must not duplicate the reference.
    await repo.markMediaUsed('m1', 'post-a');
    expect((await repo.getMediaAsset('m1'))?.usedInPostIds).toEqual(['post-a']);

    await repo.markMediaUsed('m1', 'post-b');
    expect((await repo.getMediaAsset('m1'))?.usedInPostIds).toEqual(['post-a', 'post-b']);

    await repo.unmarkMediaUsed('m1', 'post-a');
    expect((await repo.getMediaAsset('m1'))?.usedInPostIds).toEqual(['post-b']);
  });

  it('deletes a media asset', async () => {
    const repo = await loadRepo();
    await repo.saveMediaAsset(makeMedia({ id: 'm-del' }));
    await repo.deleteMediaAsset('m-del');
    expect(await repo.getMediaAsset('m-del')).toBeNull();
  });
});

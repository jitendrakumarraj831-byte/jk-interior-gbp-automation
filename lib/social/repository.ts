/**
 * Persistence for the Social Automation feature: social posts and media
 * assets. Same lib/store.ts backing as lib/repository.ts (durable with
 * Upstash, in-memory otherwise) — a second, parallel collection, not a
 * second storage system.
 */

import { randomUUID } from 'node:crypto';

import { getStore, nsKey, readCollection } from '../store';
import type { MediaAsset, SocialPost } from './types';

const POST_PREFIX = nsKey('social-post', '');
const MEDIA_PREFIX = nsKey('social-media', '');

export function newSocialId(): string {
  return randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------- social posts ------------------------------ */

function postKey(id: string): string {
  return `${POST_PREFIX}${id}`;
}

export async function listSocialPosts(): Promise<SocialPost[]> {
  const posts = await readCollection<SocialPost>(POST_PREFIX);
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSocialPost(id: string): Promise<SocialPost | null> {
  return getStore().get<SocialPost>(postKey(id));
}

export async function saveSocialPost(post: SocialPost): Promise<SocialPost> {
  const updated: SocialPost = { ...post, updatedAt: nowIso() };
  await getStore().set(postKey(post.id), updated);
  return updated;
}

export async function deleteSocialPost(id: string): Promise<void> {
  await getStore().del(postKey(id));
}

/** Approved, scheduled posts whose time has come and that have not been published. */
export async function listDueSocialPosts(at: Date = new Date()): Promise<SocialPost[]> {
  const posts = await listSocialPosts();
  return posts.filter(
    (p) =>
      p.status === 'scheduled' &&
      p.approvalStatus === 'approved' &&
      p.scheduledAt != null &&
      new Date(p.scheduledAt) <= at,
  );
}

/**
 * Recent posts to compare a new content hash against for duplicate detection.
 * Bounded to the last N days so the comparison set never grows unbounded.
 */
export async function listRecentSocialPosts(sinceDays = 30): Promise<SocialPost[]> {
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const posts = await listSocialPosts();
  return posts.filter((p) => new Date(p.createdAt).getTime() >= cutoff);
}

/* --------------------------------- media ----------------------------------- */

function mediaKey(id: string): string {
  return `${MEDIA_PREFIX}${id}`;
}

export async function listMediaAssets(): Promise<MediaAsset[]> {
  const assets = await readCollection<MediaAsset>(MEDIA_PREFIX);
  return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  return getStore().get<MediaAsset>(mediaKey(id));
}

export async function saveMediaAsset(asset: MediaAsset): Promise<MediaAsset> {
  await getStore().set(mediaKey(asset.id), asset);
  return asset;
}

export async function deleteMediaAsset(id: string): Promise<void> {
  await getStore().del(mediaKey(id));
}

/** Marks a media asset as referenced by a post — drives the "used" filter. */
export async function markMediaUsed(mediaId: string, postId: string): Promise<void> {
  const asset = await getMediaAsset(mediaId);
  if (!asset || asset.usedInPostIds.includes(postId)) return;
  await saveMediaAsset({ ...asset, usedInPostIds: [...asset.usedInPostIds, postId] });
}

/** Removes a post's reference from every media asset it used — called on delete/unschedule. */
export async function unmarkMediaUsed(mediaId: string, postId: string): Promise<void> {
  const asset = await getMediaAsset(mediaId);
  if (!asset) return;
  await saveMediaAsset({ ...asset, usedInPostIds: asset.usedInPostIds.filter((id) => id !== postId) });
}

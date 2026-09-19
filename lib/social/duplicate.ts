/**
 * Duplicate-content protection.
 *
 * A stable hash of a post's actual platform copy, compared against recent
 * posts before scheduling or publishing — never against title/topic alone,
 * since two posts about the same content type can legitimately say different
 * things.
 */

import { createHash } from 'node:crypto';

import { listRecentSocialPosts } from './repository';
import type { PlatformContent, SocialContentType, SocialPlatformTarget, SocialPost } from './types';

function normalize(content: PlatformContent | null): string {
  if (!content) return '';
  return content.caption.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeContentHash(input: {
  contentType: SocialContentType;
  platforms: SocialPlatformTarget;
  facebookContent: PlatformContent | null;
  instagramContent: PlatformContent | null;
}): string {
  const normalized = [
    input.contentType,
    input.platforms,
    normalize(input.facebookContent),
    normalize(input.instagramContent),
  ].join('|');
  return createHash('sha256').update(normalized).digest('hex');
}

/** States a duplicate check should ignore — a failed/cancelled post is not "already posted". */
const IGNORED_STATUSES = new Set(['failed', 'cancelled']);

/**
 * The most recent post (within 30 days) sharing this exact content hash, if
 * any — excluding the post being checked itself and posts that never went out.
 */
export async function findDuplicate(hash: string, excludePostId?: string): Promise<SocialPost | null> {
  const recent = await listRecentSocialPosts(30);
  return (
    recent.find(
      (post) => post.contentHash === hash && post.id !== excludePostId && !IGNORED_STATUSES.has(post.status),
    ) ?? null
  );
}

/**
 * The final publish-time gate — only checks against posts already LIVE.
 * A same-hash *scheduled* post is a double-schedule, already prevented at
 * schedule time (see app/api/social/posts/[id]/schedule); re-flagging it
 * here would just make the cron skip both of two intentionally-identical
 * approved posts.
 */
export async function findPublishedDuplicate(hash: string, excludePostId?: string): Promise<SocialPost | null> {
  const recent = await listRecentSocialPosts(30);
  return (
    recent.find((post) => post.contentHash === hash && post.id !== excludePostId && post.status === 'published') ??
    null
  );
}

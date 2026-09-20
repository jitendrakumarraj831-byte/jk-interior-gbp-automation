/**
 * The single place that actually calls Meta to publish a post. Both the
 * cron publisher (lib/social/tasks.ts) and the manual "Publish now" route
 * (app/api/social/posts/[id]/publish) call this — one code path, one set of
 * rules, never two ways to publish the same thing.
 */

import { AppError } from '../errors';
import { getConnectionState, getPageAccessToken } from '../meta/auth';
import { publishToFacebook } from '../meta/facebook-adapter';
import { publishToInstagram } from '../meta/instagram-adapter';
import { getMediaAsset, saveSocialPost } from './repository';
import type { MediaAsset, PlatformContent, SocialPost } from './types';

function captionWithHashtags(content: PlatformContent): string {
  const tags = content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
  return tags ? `${content.caption}\n\n${tags}` : content.caption;
}

async function resolveMedia(post: SocialPost): Promise<MediaAsset[]> {
  const assets = await Promise.all(post.mediaIds.map((id) => getMediaAsset(id)));
  return assets.filter((a): a is MediaAsset => a !== null);
}

/**
 * Publishes `post` to every platform it targets, right now. Throws on the
 * first platform's failure — the caller (cron or the manual route) decides
 * what that means for the post's status. Never invoked for a post whose
 * approvalStatus is not 'approved' — callers are expected to have already
 * checked that.
 */
export async function publishSocialPostNow(post: SocialPost): Promise<SocialPost> {
  const connection = await getConnectionState();
  const pageToken = await getPageAccessToken();
  const media = await resolveMedia(post);

  const wantsFacebook = post.platforms === 'facebook' || post.platforms === 'both';
  const wantsInstagram = post.platforms === 'instagram' || post.platforms === 'both';

  const externalPostIds = { ...post.externalPostIds };

  if (wantsFacebook) {
    if (!connection.facebook.connected || !connection.facebook.pageId) {
      throw new AppError('META_NOT_CONNECTED', 'Facebook Page is not connected.', 503);
    }
    if (!post.facebookContent) {
      throw new AppError('VALIDATION_FAILED', 'This post has no Facebook content.', 400);
    }
    const result = await publishToFacebook({
      pageId: connection.facebook.pageId,
      accessToken: pageToken,
      caption: captionWithHashtags(post.facebookContent),
      mediaUrls: media.map((m) => m.url),
    });
    externalPostIds.facebook = result.externalId;
  }

  if (wantsInstagram) {
    if (!connection.instagram.connected || !connection.instagram.igUserId) {
      throw new AppError('META_NOT_CONNECTED', 'No Instagram Professional account is linked to the connected Facebook Page.', 503);
    }
    if (!post.instagramContent) {
      throw new AppError('VALIDATION_FAILED', 'This post has no Instagram content.', 400);
    }
    const result = await publishToInstagram({
      igUserId: connection.instagram.igUserId,
      accessToken: pageToken,
      caption: captionWithHashtags(post.instagramContent),
      media: media.map((m) => ({ url: m.url, contentType: m.contentType })),
    });
    externalPostIds.instagram = result.externalId;
  }

  const updated: SocialPost = {
    ...post,
    status: 'published',
    publishedAt: new Date().toISOString(),
    externalPostIds,
    lastError: undefined,
  };
  await saveSocialPost(updated);
  return updated;
}

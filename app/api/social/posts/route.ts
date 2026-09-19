/**
 * Content Calendar: list + create draft social posts.
 *
 * Creating a post never schedules or publishes it — every post starts as
 * `draft` / `approvalStatus: 'pending'`. The client decides platforms/status,
 * but the server, not the client, computes contentHash and enforces every
 * state transition (see the approve/schedule/unschedule/duplicate routes).
 */

import { z } from 'zod';

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { notify } from '@/lib/notifications';
import { assertAdmin, handleRoute, ok, parseJson, sanitizeText } from '@/lib/security';
import { computeContentHash } from '@/lib/social/duplicate';
import { markMediaUsed, newSocialId, saveSocialPost, listSocialPosts, getMediaAsset } from '@/lib/social/repository';
import type { SocialPost } from '@/lib/social/types';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTENT_TYPES = [
  'gypsum_false_ceiling',
  'pvc_ceiling',
  'wpc_louvers',
  'wpc_fluted_panel',
  'uv_marble_sheet',
  'tv_unit',
  'wall_paneling',
  'partition',
  'interior_project',
  'before_after',
  'customer_project',
  'interior_tip',
  'offer',
  'festival',
  'faq',
  'local_business_promotion',
] as const;

const platformContentSchema = z.object({
  caption: z.string().trim().min(1).max(2200),
  hashtags: z.array(z.string().trim().max(60)).max(30).default([]),
});

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    contentType: z.enum(CONTENT_TYPES),
    platforms: z.enum(['facebook', 'instagram', 'both']),
    language: z.enum(['en', 'hi', 'hinglish']),
    content: z.string().trim().max(500).default(''),
    facebookContent: platformContentSchema.nullable().default(null),
    instagramContent: platformContentSchema.nullable().default(null),
    mediaIds: z.array(z.string()).max(10).default([]),
    campaign: z.string().trim().max(100).optional(),
  })
  .refine(
    (v) =>
      (v.platforms !== 'facebook' && v.platforms !== 'both') || v.facebookContent !== null,
    { message: 'facebookContent is required when platforms includes Facebook', path: ['facebookContent'] },
  )
  .refine(
    (v) =>
      (v.platforms !== 'instagram' && v.platforms !== 'both') || v.instagramContent !== null,
    { message: 'instagramContent is required when platforms includes Instagram', path: ['instagramContent'] },
  );

export async function GET(request: Request) {
  return handleRoute('social/posts', async () => {
    assertAdmin(request);
    const url = new URL(request.url);
    const platform = url.searchParams.get('platform');
    const status = url.searchParams.get('status');

    let posts = await listSocialPosts();
    if (platform && platform !== 'all') posts = posts.filter((p) => p.platforms === platform);
    if (status && status !== 'all') posts = posts.filter((p) => p.status === status);

    return ok({ posts });
  });
}

export async function POST(request: Request) {
  return handleRoute('social/posts', async () => {
    assertAdmin(request);
    const input = await parseJson(request, createSchema);

    for (const mediaId of input.mediaIds) {
      if (!(await getMediaAsset(mediaId))) {
        throw new AppError('VALIDATION_FAILED', `Media asset "${mediaId}" does not exist.`, 400);
      }
    }

    const now = new Date().toISOString();
    const post: SocialPost = {
      id: newSocialId(),
      title: sanitizeText(input.title, 150),
      contentType: input.contentType,
      platforms: input.platforms,
      language: input.language,
      content: sanitizeText(input.content, 500),
      facebookContent: input.facebookContent,
      instagramContent: input.instagramContent,
      mediaIds: input.mediaIds,
      status: 'draft',
      approvalStatus: 'pending',
      createdAt: now,
      updatedAt: now,
      createdBy: actorFromRequest(request),
      retryCount: 0,
      externalPostIds: {},
      contentHash: computeContentHash(input),
      campaign: input.campaign,
    };

    await saveSocialPost(post);
    await Promise.all(input.mediaIds.map((id) => markMediaUsed(id, post.id)));

    await recordAudit({
      actor: actorFromRequest(request),
      action: 'social_draft_created',
      resource: post.id,
      status: 'success',
      source: 'dashboard',
      detail: post.title,
    });
    await notify({
      category: 'social_draft_created',
      title: 'Social draft created',
      message: `"${post.title}" is ready for review.`,
      href: '/dashboard/content-calendar',
      dedupeKey: `social-draft-created:${post.id}`,
    });

    return ok({ post }, 'Draft created.');
  });
}

/**
 * Business Profile posts.
 *
 *   GET  list every post held locally
 *   POST create a post as draft, scheduled, or publish-now
 *
 * A post is only marked `published` after Google returns a resource name. If
 * Google is unavailable (approval pending included) the post is saved as
 * `failed` with the reason, and never reported as live.
 */

import { z } from 'zod';

import { isMockModeActive } from '@/lib/config';
import { simulatePostPublish } from '@/lib/gbp-mock';
import { resolveTarget } from '@/lib/connection';
import { AppError } from '@/lib/errors';
import { createLocalPost } from '@/lib/google-business';
import { listPosts, newId, savePost } from '@/lib/repository';
import { assertAdmin, handleRoute, httpUrlSchema, ok, parseJson, sanitizeText } from '@/lib/security';
import type { GbpPost } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 1500; // Google's local post summary limit.

const ctaSchema = z
  .object({
    type: z
      .enum(['NONE', 'BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'])
      .default('NONE'),
    url: httpUrlSchema.optional(),
  })
  .default({ type: 'NONE' })
  .refine(
    (cta) => cta.type === 'NONE' || cta.type === 'CALL' || Boolean(cta.url),
    'This call-to-action needs a URL.',
  );

const createSchema = z.object({
  type: z
    .enum(['service_promotion', 'project_update', 'offer', 'festival_greeting', 'general'])
    .default('general'),
  title: z.string().trim().min(1).max(MAX_TITLE),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION),
  cta: ctaSchema,
  imageUrl: httpUrlSchema.optional(),
  /** ISO timestamp. Required when action === 'schedule'. */
  scheduledFor: z.string().datetime().optional(),
  action: z.enum(['draft', 'schedule', 'publish_now']).default('draft'),
});

export async function GET(request: Request) {
  return handleRoute('posts', async () => {
    assertAdmin(request);
    const posts = await listPosts();
    return ok({ posts }, `${posts.length} post(s).`);
  });
}

export async function POST(request: Request) {
  return handleRoute('posts', async () => {
    assertAdmin(request);
    const body = await parseJson(request, createSchema);

    if (body.action === 'schedule') {
      if (!body.scheduledFor) {
        throw new AppError('VALIDATION_FAILED', 'A scheduled post needs scheduledFor.', 400);
      }
      if (new Date(body.scheduledFor).getTime() <= Date.now()) {
        throw new AppError('VALIDATION_FAILED', 'scheduledFor must be in the future.', 400);
      }
    }

    const now = new Date().toISOString();
    const post: GbpPost = {
      id: newId(),
      type: body.type,
      title: sanitizeText(body.title, MAX_TITLE),
      description: body.description.trim().slice(0, MAX_DESCRIPTION),
      cta: { type: body.cta.type, url: body.cta.url },
      imageUrl: body.imageUrl,
      scheduledFor: body.action === 'schedule' ? body.scheduledFor : undefined,
      status: body.action === 'schedule' ? 'scheduled' : 'draft',
      createdAt: now,
      updatedAt: now,
    };

    if (body.action !== 'publish_now') {
      const saved = await savePost(post);
      return ok(
        { post: saved },
        body.action === 'schedule'
          ? 'Post scheduled. Cron will publish it at the chosen time.'
          : 'Post saved as a draft.',
      );
    }

    // Publish now: only Google's acceptance flips this to `published`.
    try {
      // Mock mode simulates the publish; no Google call is made at all.
      const googlePostName = isMockModeActive()
        ? simulatePostPublish(post.id)
        : await createLocalPost((await resolveTarget()).locationPath, post);
      const saved = await savePost({
        ...post,
        status: 'published',
        googlePostName,
        publishedAt: new Date().toISOString(),
      });
      return ok({ post: saved }, 'Post published to Google Business Profile.');
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Publishing failed.';
      await savePost({ ...post, status: 'failed', error: message });
      throw error;
    }
  });
}

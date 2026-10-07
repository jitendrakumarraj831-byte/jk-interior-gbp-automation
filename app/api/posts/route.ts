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

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { resolveTarget } from '@/lib/connection';
import { AppError } from '@/lib/errors';
import { notify } from '@/lib/notifications';
import { failureMessage, publishPostOnce } from '@/lib/post-publisher';
import { CTA_NEEDS_URL, MAX_POST_TITLE, postContentProblem, POST_SUMMARY_LIMIT } from '@/lib/post-rules';
import { deletePost, findDuplicatePost, listPosts, newId, savePost } from '@/lib/repository';
import { assertAdmin, handleRoute, httpUrlSchema, ok, parseJson, sanitizeText } from '@/lib/security';
import type { GbpPost } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ctaSchema = z
  .object({
    type: z
      .enum(['NONE', 'BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'])
      .default('NONE'),
    url: httpUrlSchema.optional(),
  })
  .default({ type: 'NONE' })
  .refine((cta) => !CTA_NEEDS_URL[cta.type] || Boolean(cta.url), 'This call-to-action needs a URL.');

/** A scheduled post further out than this is almost certainly a typo in the year. */
const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

const createSchema = z
  .object({
    type: z
      .enum(['service_promotion', 'project_update', 'offer', 'festival_greeting', 'general'])
      .default('general'),
    title: z.string().trim().min(1).max(MAX_POST_TITLE),
    description: z.string().trim().min(1).max(POST_SUMMARY_LIMIT),
    cta: ctaSchema,
    imageUrl: httpUrlSchema.optional(),
    /** ISO timestamp. Required when action === 'schedule'. */
    scheduledFor: z.string().datetime().optional(),
    action: z.enum(['draft', 'schedule', 'publish_now']).default('draft'),
  })
  .superRefine((value, ctx) => {
    const problem = postContentProblem({
      type: value.type,
      title: sanitizeText(value.title, MAX_POST_TITLE),
      description: value.description.trim(),
      cta: value.cta,
    });
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['description'] });
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
      const when = new Date(body.scheduledFor).getTime();
      if (when <= Date.now()) {
        throw new AppError('VALIDATION_FAILED', 'scheduledFor must be in the future.', 400);
      }
      if (when - Date.now() > MAX_SCHEDULE_AHEAD_MS) {
        throw new AppError('VALIDATION_FAILED', 'scheduledFor is more than a year away.', 400);
      }
    }

    const now = new Date().toISOString();
    const post: GbpPost = {
      id: newId(),
      type: body.type,
      title: sanitizeText(body.title, MAX_POST_TITLE),
      description: body.description.trim().slice(0, POST_SUMMARY_LIMIT),
      cta: { type: body.cta.type, url: body.cta.url },
      imageUrl: body.imageUrl,
      scheduledFor: body.action === 'schedule' ? body.scheduledFor : undefined,
      status: body.action === 'schedule' ? 'scheduled' : 'draft',
      createdAt: now,
      updatedAt: now,
    };

    // Drafts may repeat; anything that will go live must not duplicate a post
    // that is already live or queued.
    if (body.action !== 'draft') {
      const duplicate = await findDuplicatePost(post);
      if (duplicate) {
        throw new AppError(
          'CONFLICT',
          'An identical post was already published or scheduled in the last 24 hours. Change the wording, or delete the other one first.',
          409,
        );
      }
    }

    if (body.action !== 'publish_now') {
      const saved = await savePost(post);
      await recordAudit({
        actor: actorFromRequest(request),
        action: body.action === 'schedule' ? 'post_scheduled' : 'post_created',
        resource: saved.id,
        status: 'success',
        source: 'dashboard',
      });
      if (body.action === 'schedule') {
        await notify({
          category: 'post_scheduled',
          title: 'Post scheduled',
          message: `"${saved.title}" is scheduled to publish.`,
          href: '/dashboard/scheduled',
          dedupeKey: `post-scheduled:${saved.id}`,
        });
      }
      return ok(
        { post: saved },
        body.action === 'schedule'
          ? 'Post scheduled. The daily publishing job sends it on or after the chosen time.'
          : 'Post saved as a draft.',
      );
    }

    // Publish now. The post is stored first so the publisher can claim and
    // re-read it; only Google's acceptance flips it to `published`.
    await savePost(post);
    const outcome = await publishPostOnce(post, async () => (await resolveTarget()).locationPath);

    if (outcome.kind === 'published') {
      await recordAudit({
        actor: actorFromRequest(request),
        action: 'post_published',
        resource: outcome.post.id,
        status: 'success',
        source: 'dashboard',
      });
      return ok({ post: outcome.post }, 'Post published to Google Business Profile.');
    }

    if (outcome.kind === 'failed') {
      await savePost({ ...outcome.post, status: 'failed', error: failureMessage(outcome.error) });
      await recordAudit({
        actor: actorFromRequest(request),
        action: 'post_published',
        resource: post.id,
        status: 'failure',
        source: 'dashboard',
      });
      throw outcome.error;
    }

    // Busy, skipped or duplicate: nothing reached Google, and this new post
    // never became real — remove the record rather than leave a ghost.
    await deletePost(post.id);
    throw new AppError('CONFLICT', 'This post could not be published right now. Try again in a moment.', 409);
  });
}

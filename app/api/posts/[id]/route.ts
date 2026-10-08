/** Update or delete a single Business Profile post held locally. */

import { z } from 'zod';

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { CTA_NEEDS_URL, MAX_POST_TITLE, postContentProblem, POST_SUMMARY_LIMIT } from '@/lib/post-rules';
import { deletePost, getPost, savePost } from '@/lib/repository';
import { assertAdmin, handleRoute, httpUrlSchema, ok, parseJson, sanitizeText } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(MAX_POST_TITLE).optional(),
  description: z.string().trim().min(1).max(POST_SUMMARY_LIMIT).optional(),
  imageUrl: httpUrlSchema.nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  status: z.enum(['draft', 'scheduled', 'cancelled']).optional(),
  cta: z
    .object({
      type: z.enum(['NONE', 'BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL']),
      url: httpUrlSchema.optional(),
    })
    .optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return handleRoute('posts/[id]', async () => {
    assertAdmin(request);
    const { id } = await context.params;

    const post = await getPost(id);
    if (!post) throw new AppError('NOT_FOUND', 'Post not found.', 404);
    if (post.status === 'published') {
      throw new AppError(
        'CONFLICT',
        'This post is already live on Google and cannot be edited from here.',
        409,
      );
    }
    if (post.status === 'publishing') {
      throw new AppError('CONFLICT', 'This post is being published right now. Try again in a moment.', 409);
    }

    const body = await parseJson(request, patchSchema);

    if (body.status === 'scheduled') {
      const when = body.scheduledFor ?? post.scheduledFor;
      if (!when) {
        throw new AppError('VALIDATION_FAILED', 'A scheduled post needs scheduledFor.', 400);
      }
      if (new Date(when).getTime() <= Date.now()) {
        throw new AppError('VALIDATION_FAILED', 'scheduledFor must be in the future.', 400);
      }
    }

    const next = {
      ...post,
      title: body.title ? sanitizeText(body.title, MAX_POST_TITLE) : post.title,
      description: body.description
        ? body.description.trim().slice(0, POST_SUMMARY_LIMIT)
        : post.description,
      imageUrl: body.imageUrl === null ? undefined : (body.imageUrl ?? post.imageUrl),
      scheduledFor:
        body.scheduledFor === null ? undefined : (body.scheduledFor ?? post.scheduledFor),
      cta: body.cta ?? post.cta,
      status: body.status ?? post.status,
      error: undefined,
    };

    // The edited post as a whole must still be something Google accepts.
    if (body.cta && CTA_NEEDS_URL[body.cta.type] && !body.cta.url) {
      throw new AppError('VALIDATION_FAILED', 'This call-to-action button needs a link.', 400);
    }
    const problem = postContentProblem(next);
    if (problem) throw new AppError('VALIDATION_FAILED', problem, 400);

    const saved = await savePost({ ...next, attempts: undefined });
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'post_updated',
      resource: saved.id,
      status: 'success',
      source: 'dashboard',
    });

    return ok({ post: saved }, 'Post updated.');
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleRoute('posts/[id]', async () => {
    assertAdmin(request);
    const { id } = await context.params;

    const post = await getPost(id);
    if (!post) throw new AppError('NOT_FOUND', 'Post not found.', 404);
    if (post.status === 'publishing') {
      throw new AppError('CONFLICT', 'This post is being published right now. Try again in a moment.', 409);
    }

    await deletePost(id);
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'post_deleted',
      resource: id,
      status: 'success',
      source: 'dashboard',
    });
    return ok(
      { deleted: id, wasPublished: post.status === 'published' },
      post.status === 'published'
        ? 'Removed from this dashboard. The post is still live on Google — delete it there too if needed.'
        : 'Post deleted.',
    );
  });
}

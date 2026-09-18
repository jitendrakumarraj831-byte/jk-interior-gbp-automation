/** Update or delete a single Business Profile post held locally. */

import { z } from 'zod';

import { AppError } from '@/lib/errors';
import { deletePost, getPost, savePost } from '@/lib/repository';
import { assertAdmin, handleRoute, httpUrlSchema, ok, parseJson, sanitizeText } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(1500).optional(),
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

    const saved = await savePost({
      ...post,
      title: body.title ? sanitizeText(body.title, 120) : post.title,
      description: body.description ? body.description.trim().slice(0, 1500) : post.description,
      imageUrl: body.imageUrl === null ? undefined : (body.imageUrl ?? post.imageUrl),
      scheduledFor:
        body.scheduledFor === null ? undefined : (body.scheduledFor ?? post.scheduledFor),
      cta: body.cta ?? post.cta,
      status: body.status ?? post.status,
      error: undefined,
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

    await deletePost(id);
    return ok(
      { deleted: id, wasPublished: post.status === 'published' },
      post.status === 'published'
        ? 'Removed from this dashboard. The post is still live on Google — delete it there too if needed.'
        : 'Post deleted.',
    );
  });
}

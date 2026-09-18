/**
 * Publishes a stored post to Google immediately.
 *
 * Only Google's acceptance marks it published; a failure records the reason and
 * leaves the post in `failed`.
 */

import { resolveTarget } from '@/lib/connection';
import { AppError } from '@/lib/errors';
import { createLocalPost } from '@/lib/google-business';
import { getPost, savePost } from '@/lib/repository';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handleRoute('posts/[id]/publish', async () => {
    assertAdmin(request);
    const { id } = await context.params;

    const post = await getPost(id);
    if (!post) throw new AppError('NOT_FOUND', 'Post not found.', 404);
    if (post.status === 'published') {
      throw new AppError('CONFLICT', 'This post is already published.', 409);
    }

    await savePost({ ...post, status: 'publishing' });

    try {
      const target = await resolveTarget();
      const googlePostName = await createLocalPost(target.locationPath, post);
      const saved = await savePost({
        ...post,
        status: 'published',
        googlePostName,
        publishedAt: new Date().toISOString(),
        error: undefined,
      });
      return ok({ post: saved }, 'Post published to Google Business Profile.');
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Publishing failed.';
      await savePost({ ...post, status: 'failed', error: message });
      throw error;
    }
  });
}

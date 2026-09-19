/**
 * Publishes a stored post to Google immediately.
 *
 * Only Google's acceptance marks it published; a failure records the reason and
 * leaves the post in `failed`.
 */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { isMockModeActive } from '@/lib/config';
import { simulatePostPublish } from '@/lib/gbp-mock';
import { resolveTarget } from '@/lib/connection';
import { AppError } from '@/lib/errors';
import { createLocalPost } from '@/lib/google-business';
import { notify } from '@/lib/notifications';
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
      // Mock mode simulates the publish; no Google call is made at all.
      const googlePostName = isMockModeActive()
        ? simulatePostPublish(post.id)
        : await createLocalPost((await resolveTarget()).locationPath, post);
      const saved = await savePost({
        ...post,
        status: 'published',
        googlePostName,
        publishedAt: new Date().toISOString(),
        error: undefined,
      });
      await notify({
        category: 'post_published',
        title: 'Post published',
        message: `"${saved.title}" is now live on Google Business Profile.`,
        href: '/dashboard/posts',
        dedupeKey: `post-published:${saved.id}`,
      });
      await recordAudit({
        actor: actorFromRequest(request),
        action: 'post_published',
        resource: saved.id,
        status: 'success',
        source: 'dashboard',
      });
      return ok({ post: saved }, 'Post published to Google Business Profile.');
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Publishing failed.';
      await savePost({ ...post, status: 'failed', error: message });
      await recordAudit({
        actor: actorFromRequest(request),
        action: 'post_published',
        resource: post.id,
        status: 'failure',
        source: 'dashboard',
      });
      throw error;
    }
  });
}

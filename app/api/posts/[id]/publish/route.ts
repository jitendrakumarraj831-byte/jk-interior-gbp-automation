/**
 * Publishes a stored post to Google immediately.
 *
 * Only Google's acceptance marks it published; a failure records the reason and
 * leaves the post in `failed`.
 */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { resolveTarget } from '@/lib/connection';
import { AppError } from '@/lib/errors';
import { notify } from '@/lib/notifications';
import { failureMessage, publishPostOnce } from '@/lib/post-publisher';
import { getPost, savePost } from '@/lib/repository';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

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
    if (post.status === 'publishing') {
      throw new AppError('CONFLICT', 'This post is already being published.', 409);
    }

    // Claim, re-read, de-duplicate and publish — see lib/post-publisher.ts.
    // Mock mode simulates the publish; no Google call is made at all.
    const outcome = await publishPostOnce(post, async () => (await resolveTarget()).locationPath);

    switch (outcome.kind) {
      case 'published': {
        await notify({
          category: 'post_published',
          title: 'Post published',
          message: `"${outcome.post.title}" is now live on Google Business Profile.`,
          href: '/dashboard/posts',
          dedupeKey: `post-published:${outcome.post.id}`,
        });
        await recordAudit({
          actor: actorFromRequest(request),
          action: 'post_published',
          resource: outcome.post.id,
          status: 'success',
          source: 'dashboard',
        });
        return ok({ post: outcome.post }, 'Post published to Google Business Profile.');
      }

      case 'failed': {
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

      case 'duplicate':
        throw new AppError(
          'CONFLICT',
          'An identical post was already published or scheduled in the last 24 hours, so this one was not sent. Change the wording first.',
          409,
        );

      case 'busy':
        throw new AppError('CONFLICT', 'This post is already being published.', 409);

      case 'skipped':
        throw new AppError('CONFLICT', outcome.reason, 409);
    }
  });
}

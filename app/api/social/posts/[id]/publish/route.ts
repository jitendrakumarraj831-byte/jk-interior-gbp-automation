/**
 * Manual "Publish now" — the only way a post reaches Meta while both
 * Auto Publish settings are off (the default). Shares publishSocialPostNow()
 * with the cron publisher; this route is what makes the call synchronous so
 * the admin sees success/failure immediately instead of waiting for cron.
 */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { notify } from '@/lib/notifications';
import { assertAdmin, handleRoute, ok } from '@/lib/security';
import { findPublishedDuplicate } from '@/lib/social/duplicate';
import { publishSocialPostNow } from '@/lib/social/publish';
import { getSocialPost, saveSocialPost } from '@/lib/social/repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const PUBLISHABLE_STATUSES = new Set(['approved', 'scheduled']);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute('social/posts/[id]/publish', async () => {
    assertAdmin(request);
    const { id } = await params;
    const post = await getSocialPost(id);
    if (!post) throw new AppError('NOT_FOUND', 'Social post not found.', 404);

    if (post.approvalStatus !== 'approved' || !PUBLISHABLE_STATUSES.has(post.status)) {
      throw new AppError('CONFLICT', `This post is not ready to publish (status: ${post.status}).`, 409);
    }

    const duplicate = await findPublishedDuplicate(post.contentHash, post.id);
    if (duplicate) {
      throw new AppError(
        'META_DUPLICATE_CONTENT',
        `This looks identical to "${duplicate.title}", already published. Edit the content or delete this post.`,
        409,
      );
    }

    await saveSocialPost({ ...post, status: 'publishing' });
    try {
      const published = await publishSocialPostNow(post);
      await recordAudit({
        actor: actorFromRequest(request),
        action: 'social_post_published_manual',
        resource: id,
        status: 'success',
        source: 'dashboard',
        detail: post.title,
      });
      await notify({
        category: 'social_post_published',
        title: 'Social post published',
        message: `"${post.title}" is now live.`,
        href: '/dashboard/content-calendar',
        dedupeKey: `social-published:${id}`,
      });
      return ok({ post: published }, 'Published.');
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Publishing failed.';
      await saveSocialPost({ ...post, status: 'failed', lastError: message, retryCount: post.retryCount + 1 });
      await recordAudit({
        actor: actorFromRequest(request),
        action: 'social_post_failed',
        resource: id,
        status: 'failure',
        source: 'dashboard',
        detail: message,
      });
      throw error;
    }
  });
}

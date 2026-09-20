/** Pulls a scheduled post back to approved, clearing its scheduled time. */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { assertAdmin, handleRoute, ok } from '@/lib/security';
import { getSocialPost, saveSocialPost } from '@/lib/social/repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute('social/posts/[id]/unschedule', async () => {
    assertAdmin(request);
    const { id } = await params;
    const post = await getSocialPost(id);
    if (!post) throw new AppError('NOT_FOUND', 'Social post not found.', 404);

    if (post.status !== 'scheduled') {
      throw new AppError('CONFLICT', `Only a scheduled post can be unscheduled (this post is ${post.status}).`, 409);
    }

    const updated = { ...post, status: 'approved' as const, scheduledAt: undefined };
    await saveSocialPost(updated);
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'social_post_unscheduled',
      resource: id,
      status: 'success',
      source: 'dashboard',
      detail: post.title,
    });

    return ok({ post: updated }, 'Unscheduled.');
  });
}

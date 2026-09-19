/** Approves a draft. Approval is required before a post can be scheduled. */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { notify } from '@/lib/notifications';
import { assertAdmin, handleRoute, ok } from '@/lib/security';
import { getSocialPost, saveSocialPost } from '@/lib/social/repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute('social/posts/[id]/approve', async () => {
    assertAdmin(request);
    const { id } = await params;
    const post = await getSocialPost(id);
    if (!post) throw new AppError('NOT_FOUND', 'Social post not found.', 404);

    if (post.status !== 'draft') {
      throw new AppError('CONFLICT', `Only a draft can be approved (this post is ${post.status}).`, 409);
    }

    const updated = { ...post, status: 'approved' as const, approvalStatus: 'approved' as const };
    await saveSocialPost(updated);
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'social_post_approved',
      resource: id,
      status: 'success',
      source: 'dashboard',
      detail: post.title,
    });
    await notify({
      category: 'social_post_approved',
      title: 'Social post approved',
      message: `"${post.title}" is approved and ready to schedule.`,
      href: '/dashboard/content-calendar',
      dedupeKey: `social-approved:${id}:${updated.updatedAt}`,
    });

    return ok({ post: updated }, 'Approved.');
  });
}

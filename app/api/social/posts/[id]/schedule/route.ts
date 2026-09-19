/**
 * Schedules an approved post. Rejects duplicate content outright here — a
 * manual dashboard action gets a clear error, not a silent skip (silent skip
 * is the cron's behaviour in Phase D, where no one is watching in real time).
 */

import { z } from 'zod';

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { notify } from '@/lib/notifications';
import { assertAdmin, handleRoute, ok, parseJson } from '@/lib/security';
import { findDuplicate } from '@/lib/social/duplicate';
import { getSocialPost, saveSocialPost } from '@/lib/social/repository';
import { getSocialSettings } from '@/lib/social/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const scheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute('social/posts/[id]/schedule', async () => {
    assertAdmin(request);
    const { id } = await params;
    const post = await getSocialPost(id);
    if (!post) throw new AppError('NOT_FOUND', 'Social post not found.', 404);

    if (post.approvalStatus !== 'approved') {
      throw new AppError('CONFLICT', 'Approve this post before scheduling it.', 409);
    }
    if (post.status !== 'approved') {
      throw new AppError('CONFLICT', `Only an approved post can be scheduled (this post is ${post.status}).`, 409);
    }

    const { scheduledAt } = await parseJson(request, scheduleSchema);
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      throw new AppError('VALIDATION_FAILED', 'Scheduled time must be in the future.', 400);
    }

    const settings = await getSocialSettings();
    if (settings.duplicateProtectionEnabled) {
      const duplicate = await findDuplicate(post.contentHash, post.id);
      if (duplicate) {
        throw new AppError(
          'META_DUPLICATE_CONTENT',
          `This looks identical to "${duplicate.title}" (${duplicate.status}, ${duplicate.createdAt.slice(0, 10)}). Edit the content or confirm this is intentional before scheduling.`,
          409,
        );
      }
    }

    const updated = { ...post, status: 'scheduled' as const, scheduledAt };
    await saveSocialPost(updated);
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'social_post_scheduled',
      resource: id,
      status: 'success',
      source: 'dashboard',
      detail: `${post.title} → ${scheduledAt}`,
    });
    await notify({
      category: 'social_post_scheduled',
      title: 'Social post scheduled',
      message: `"${post.title}" is scheduled for ${new Date(scheduledAt).toLocaleString('en-IN')}.`,
      href: '/dashboard/content-calendar',
      dedupeKey: `social-scheduled:${id}:${scheduledAt}`,
    });

    return ok({ post: updated }, 'Scheduled.');
  });
}

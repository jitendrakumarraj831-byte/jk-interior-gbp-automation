/** Duplicates a post into a new draft — same content, fresh lifecycle. */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { assertAdmin, handleRoute, ok } from '@/lib/security';
import { getSocialPost, markMediaUsed, newSocialId, saveSocialPost } from '@/lib/social/repository';
import type { SocialPost } from '@/lib/social/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute('social/posts/[id]/duplicate', async () => {
    assertAdmin(request);
    const { id } = await params;
    const source = await getSocialPost(id);
    if (!source) throw new AppError('NOT_FOUND', 'Social post not found.', 404);

    const now = new Date().toISOString();
    const copy: SocialPost = {
      ...source,
      id: newSocialId(),
      title: `${source.title} (copy)`,
      status: 'draft',
      approvalStatus: 'pending',
      scheduledAt: undefined,
      publishedAt: undefined,
      lastError: undefined,
      retryCount: 0,
      externalPostIds: {},
      createdAt: now,
      updatedAt: now,
      createdBy: actorFromRequest(request),
    };

    await saveSocialPost(copy);
    await Promise.all(copy.mediaIds.map((mediaId) => markMediaUsed(mediaId, copy.id)));
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'social_post_duplicated',
      resource: copy.id,
      status: 'success',
      source: 'dashboard',
      detail: `Duplicated from ${source.id}`,
    });

    return ok({ post: copy }, 'Duplicated.');
  });
}

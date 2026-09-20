/**
 * A single social post: read, edit, delete.
 *
 * Editing is only allowed before a post has gone out (draft/approved) —
 * never mid-flight or after. Editing content after approval drops the post
 * back to draft/pending: the content an admin approved is not necessarily
 * the content that would now go out.
 */

import { z } from 'zod';

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { assertAdmin, handleRoute, ok, parseJson, sanitizeText } from '@/lib/security';
import { computeContentHash } from '@/lib/social/duplicate';
import {
  getMediaAsset,
  getSocialPost,
  deleteSocialPost,
  markMediaUsed,
  saveSocialPost,
  unmarkMediaUsed,
} from '@/lib/social/repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NOT_EDITABLE_STATUSES = new Set(['scheduled', 'publishing', 'published']);
const NOT_DELETABLE_STATUSES = new Set(['publishing', 'published']);

const platformContentSchema = z.object({
  caption: z.string().trim().min(1).max(2200),
  hashtags: z.array(z.string().trim().max(60)).max(30).default([]),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  content: z.string().trim().max(500).optional(),
  facebookContent: platformContentSchema.nullable().optional(),
  instagramContent: platformContentSchema.nullable().optional(),
  mediaIds: z.array(z.string()).max(10).optional(),
  campaign: z.string().trim().max(100).optional(),
});

async function loadPost(id: string) {
  const post = await getSocialPost(id);
  if (!post) throw new AppError('NOT_FOUND', 'Social post not found.', 404);
  return post;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute('social/posts/[id]', async () => {
    assertAdmin(request);
    const { id } = await params;
    return ok({ post: await loadPost(id) });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute('social/posts/[id]', async () => {
    assertAdmin(request);
    const { id } = await params;
    const post = await loadPost(id);

    if (NOT_EDITABLE_STATUSES.has(post.status)) {
      throw new AppError('CONFLICT', `A ${post.status} post cannot be edited. Unschedule it first.`, 409);
    }

    const patch = await parseJson(request, patchSchema);

    if (patch.mediaIds) {
      for (const mediaId of patch.mediaIds) {
        if (!(await getMediaAsset(mediaId))) {
          throw new AppError('VALIDATION_FAILED', `Media asset "${mediaId}" does not exist.`, 400);
        }
      }
    }

    const facebookContent =
      patch.facebookContent !== undefined ? patch.facebookContent : post.facebookContent;
    const instagramContent =
      patch.instagramContent !== undefined ? patch.instagramContent : post.instagramContent;
    const contentChanged =
      patch.facebookContent !== undefined || patch.instagramContent !== undefined;

    const updated = {
      ...post,
      title: patch.title !== undefined ? sanitizeText(patch.title, 150) : post.title,
      content: patch.content !== undefined ? sanitizeText(patch.content, 500) : post.content,
      facebookContent,
      instagramContent,
      mediaIds: patch.mediaIds ?? post.mediaIds,
      campaign: patch.campaign !== undefined ? patch.campaign : post.campaign,
      contentHash: computeContentHash({
        contentType: post.contentType,
        platforms: post.platforms,
        facebookContent,
        instagramContent,
      }),
      // Re-approval is required after the content actually changes.
      ...(contentChanged && post.approvalStatus === 'approved'
        ? { approvalStatus: 'pending' as const, status: 'draft' as const }
        : {}),
    };

    if (patch.mediaIds) {
      const removed = post.mediaIds.filter((id) => !patch.mediaIds!.includes(id));
      const added = patch.mediaIds.filter((id) => !post.mediaIds.includes(id));
      await Promise.all(removed.map((mediaId) => unmarkMediaUsed(mediaId, post.id)));
      await Promise.all(added.map((mediaId) => markMediaUsed(mediaId, post.id)));
    }

    await saveSocialPost(updated);
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'social_content_edited',
      resource: post.id,
      status: 'success',
      source: 'dashboard',
    });

    return ok({ post: updated }, 'Saved.');
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute('social/posts/[id]', async () => {
    assertAdmin(request);
    const { id } = await params;
    const post = await loadPost(id);

    if (NOT_DELETABLE_STATUSES.has(post.status)) {
      throw new AppError('CONFLICT', `A ${post.status} post cannot be deleted.`, 409);
    }

    await Promise.all(post.mediaIds.map((mediaId) => unmarkMediaUsed(mediaId, post.id)));
    await deleteSocialPost(id);
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'social_post_deleted',
      resource: id,
      status: 'success',
      source: 'dashboard',
      detail: post.title,
    });

    return ok({ deleted: true }, 'Post deleted.');
  });
}

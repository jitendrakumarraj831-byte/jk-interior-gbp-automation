/**
 * AI reply drafts.
 *
 *   GET    list every draft
 *   POST   generate a draft for a review        (never publishes)
 *   PATCH  edit the text / approve / unapprove  (never publishes)
 *   DELETE discard a draft
 *
 * Publishing to Google is a separate, explicit endpoint:
 * POST /api/reviews/reply/publish.
 */

import { z } from 'zod';

import { MAX_REPLY_CHARS } from '@/lib/ai-reply';
import { actorFromRequest, recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import {
  deleteDraft,
  findDraftByReviewId,
  getDraft,
  listDrafts,
  saveDraft,
} from '@/lib/repository';
import { assertAdmin, handleRoute, ok, parseJson, sanitizeText } from '@/lib/security';
import { createDraftForReview } from '@/lib/tasks';
import type { StarRating } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const starSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const generateSchema = z.object({
  reviewId: z.string().trim().min(1).max(200),
  reviewName: z.string().trim().min(1).max(400),
  reviewerName: z.string().trim().min(1).max(200),
  starRating: starSchema,
  comment: z.string().max(5000).default(''),
  /** Replace an existing draft for this review instead of refusing. */
  regenerate: z.boolean().default(false),
});

const patchSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    text: z.string().trim().min(1).max(MAX_REPLY_CHARS).optional(),
    action: z.enum(['approve', 'unapprove']).optional(),
  })
  .refine((v) => v.text !== undefined || v.action !== undefined, {
    message: 'Provide text, action, or both',
  });

export async function GET(request: Request) {
  return handleRoute('reviews/reply', async () => {
    assertAdmin(request);
    const drafts = await listDrafts();
    return ok({ drafts }, `${drafts.length} draft(s).`);
  });
}

export async function POST(request: Request) {
  return handleRoute('reviews/reply', async () => {
    assertAdmin(request);
    const body = await parseJson(request, generateSchema);

    const existing = await findDraftByReviewId(body.reviewId);
    if (existing && !body.regenerate) {
      throw new AppError(
        'CONFLICT',
        'A draft already exists for this review. Use regenerate to replace it.',
        409,
      );
    }
    if (existing?.status === 'published') {
      throw new AppError(
        'CONFLICT',
        'This reply is already published on Google. Edit it from the review instead.',
        409,
      );
    }

    const draft = await createDraftForReview({
      name: body.reviewName,
      reviewId: body.reviewId,
      reviewerName: body.reviewerName,
      starRating: body.starRating as StarRating,
      comment: body.comment,
      createTime: new Date().toISOString(),
      updateTime: new Date().toISOString(),
      existingReply: null,
      replyStatus: 'no_reply',
    });

    // Reuse the existing id so regeneration replaces rather than duplicates.
    const saved = await saveDraft(existing ? { ...draft, id: existing.id } : draft);
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'review_draft_generated',
      resource: saved.id,
      status: 'success',
      source: 'dashboard',
      detail: body.regenerate ? 'Regenerated' : undefined,
    });
    return ok({ draft: saved }, 'Draft generated. Review it before publishing.');
  });
}

export async function PATCH(request: Request) {
  return handleRoute('reviews/reply', async () => {
    assertAdmin(request);
    const body = await parseJson(request, patchSchema);

    const draft = await getDraft(body.id);
    if (!draft) throw new AppError('NOT_FOUND', 'Draft not found.', 404);
    if (draft.status === 'published') {
      throw new AppError('CONFLICT', 'This draft has already been published.', 409);
    }

    const text = body.text ? sanitizeText(body.text, MAX_REPLY_CHARS) : draft.text;
    const status =
      body.action === 'approve'
        ? ('approved' as const)
        : body.action === 'unapprove'
          ? ('draft_pending' as const)
          : draft.status;

    const saved = await saveDraft({
      ...draft,
      text,
      status,
      approvedAt: status === 'approved' ? new Date().toISOString() : undefined,
      error: undefined,
    });

    if (body.action === 'approve' || body.action === 'unapprove') {
      await recordAudit({
        actor: actorFromRequest(request),
        action: body.action === 'approve' ? 'review_draft_approved' : 'review_draft_unapproved',
        resource: saved.id,
        status: 'success',
        source: 'dashboard',
      });
    }

    return ok(
      { draft: saved },
      status === 'approved'
        ? 'Draft approved. It is not on Google yet — press Publish to send it.'
        : 'Draft saved.',
    );
  });
}

export async function DELETE(request: Request) {
  return handleRoute('reviews/reply', async () => {
    assertAdmin(request);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw new AppError('VALIDATION_FAILED', 'Query parameter "id" is required.', 400);

    const draft = await getDraft(id);
    if (!draft) throw new AppError('NOT_FOUND', 'Draft not found.', 404);

    await deleteDraft(id);
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'review_draft_discarded',
      resource: id,
      status: 'success',
      source: 'dashboard',
    });
    return ok({ deleted: id }, 'Draft discarded.');
  });
}

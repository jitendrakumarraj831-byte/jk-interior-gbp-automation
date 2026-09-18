/**
 * Publishes an approved reply to Google.
 *
 * This is the ONLY code path that writes a review reply, and it requires:
 *   1. an authenticated admin,
 *   2. a draft the admin has explicitly approved.
 *
 * When Google rejects the call the draft is marked publish_failed with the real
 * reason. We never record a reply as published unless Google accepted it.
 */

import { z } from 'zod';

import { AppError } from '@/lib/errors';
import { publishReviewReply } from '@/lib/google-business';
import { getDraft, saveDraft } from '@/lib/repository';
import { assertAdmin, handleRoute, ok, parseJson } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  id: z.string().trim().min(1).max(100),
  /** Guard rail: publishing an unapproved draft must be opted into explicitly. */
  force: z.boolean().default(false),
});

export async function POST(request: Request) {
  return handleRoute('reviews/reply/publish', async () => {
    assertAdmin(request);
    const { id, force } = await parseJson(request, bodySchema);

    const draft = await getDraft(id);
    if (!draft) throw new AppError('NOT_FOUND', 'Draft not found.', 404);
    if (draft.status === 'published') {
      throw new AppError('CONFLICT', 'This reply has already been published.', 409);
    }
    if (draft.status !== 'approved' && !force) {
      throw new AppError(
        'CONFLICT',
        'Approve the draft before publishing it to Google.',
        409,
      );
    }

    try {
      await publishReviewReply(draft.reviewName, draft.text);
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Publishing failed.';
      await saveDraft({ ...draft, status: 'publish_failed', error: message });
      throw error;
    }

    const saved = await saveDraft({
      ...draft,
      status: 'published',
      publishedAt: new Date().toISOString(),
      error: undefined,
    });

    return ok({ draft: saved }, 'Reply published to Google.');
  });
}

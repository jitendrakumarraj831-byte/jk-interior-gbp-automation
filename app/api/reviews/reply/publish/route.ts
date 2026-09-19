/**
 * Publishes an approved reply to Google.
 *
 * This is the ONLY code path that writes a review reply, and it requires:
 *   1. an authenticated admin,
 *   2. a draft the admin has explicitly approved — with no override.
 *
 * When Google rejects the call the draft is marked publish_failed with the real
 * reason. We never record a reply as published unless Google accepted it.
 */

import { z } from 'zod';

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { isMockModeActive } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { isMockResourceName, simulatePublish } from '@/lib/gbp-mock';
import { publishReviewReply } from '@/lib/google-business';
import { getDraft, saveDraft } from '@/lib/repository';
import { assertAdmin, handleRoute, ok, parseJson } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/*
 * Only a draft id. There is deliberately no `force` / override field: approval
 * is the one and only route to publishing, and an unapproved draft is refused
 * no matter what the request body says.
 */
const bodySchema = z.object({
  id: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  return handleRoute('reviews/reply/publish', async () => {
    assertAdmin(request);
    const { id } = await parseJson(request, bodySchema);

    const draft = await getDraft(id);
    if (!draft) throw new AppError('NOT_FOUND', 'Draft not found.', 404);
    if (draft.status === 'published') {
      throw new AppError('CONFLICT', 'This reply has already been published.', 409);
    }
    if (draft.status !== 'approved') {
      throw new AppError('CONFLICT', 'Approve the draft before publishing it to Google.', 409);
    }

    /*
     * A mock draft is simulated and never leaves the server; a real draft goes
     * to Google. The resource name decides, so the two paths cannot cross — and
     * a mock draft is refused outright when mock mode is not active.
     */
    const simulated = isMockResourceName(draft.reviewName);
    if (simulated && !isMockModeActive()) {
      throw new AppError(
        'CONFLICT',
        'This draft belongs to a mock review and cannot be published to Google.',
        409,
      );
    }

    try {
      if (simulated) {
        simulatePublish(draft.reviewName);
      } else {
        await publishReviewReply(draft.reviewName, draft.text);
      }
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Publishing failed.';
      await saveDraft({ ...draft, status: 'publish_failed', error: message });
      await recordAudit({
        actor: actorFromRequest(request),
        action: 'review_reply_published',
        resource: draft.id,
        status: 'failure',
        source: 'dashboard',
      });
      throw error;
    }

    const saved = await saveDraft({
      ...draft,
      status: 'published',
      publishedAt: new Date().toISOString(),
      error: undefined,
    });
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'review_reply_published',
      resource: draft.id,
      status: 'success',
      source: 'dashboard',
      detail: simulated ? 'mock' : undefined,
    });

    return ok(
      { draft: saved },
      simulated ? 'Mock reply published (simulated — nothing sent to Google).' : 'Reply published to Google.',
    );
  });
}

/**
 * Reviews.
 *
 * GET returns live reviews from Google, merged with local draft state. When
 * Google is unreachable — including while API approval is pending — the
 * response carries the real error status. Cached reviews from an earlier
 * successful sync are returned only when they exist, and are labelled as such.
 */

import { AppError, isApprovalPending } from '@/lib/errors';
import { isMockModeActive } from '@/lib/config';
import { mockReviewsResult } from '@/lib/gbp-mock';
import { resolveTarget } from '@/lib/connection';
import { listReviews } from '@/lib/google-business';
import { getCachedReviews, listDrafts, setCachedReviews } from '@/lib/repository';
import { assertAdmin, failure, handleRoute, ok } from '@/lib/security';
import { applyDraftStatus } from '@/lib/tasks';
import type { Review } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export type ReviewsPayload = {
  reviews: Review[];
  averageRating: number | null;
  totalReviewCount: number;
  source: 'google' | 'cache';
  fetchedAt: string;
};

export async function GET(request: Request) {
  return handleRoute('reviews', async () => {
    assertAdmin(request);

    const drafts = await listDrafts();

    // Mock mode replaces the review source entirely — the real branch below is
    // not reachable, so simulated and real records can never appear together.
    if (isMockModeActive()) {
      const mock = mockReviewsResult();
      const payload: ReviewsPayload = {
        reviews: applyDraftStatus(mock.reviews, drafts),
        averageRating: mock.averageRating,
        totalReviewCount: mock.totalReviewCount,
        source: 'google',
        fetchedAt: new Date().toISOString(),
      };
      return ok(payload, `Mock mode — showing ${mock.reviews.length} simulated reviews.`);
    }

    try {
      const target = await resolveTarget();
      const result = await listReviews(target.locationPath);
      const reviews = applyDraftStatus(result.reviews, drafts);
      const fetchedAt = new Date().toISOString();

      await setCachedReviews({
        reviews,
        averageRating: result.averageRating,
        totalReviewCount: result.totalReviewCount,
        fetchedAt,
        locationPath: target.locationPath,
      });

      const payload: ReviewsPayload = {
        reviews,
        averageRating: result.averageRating,
        totalReviewCount: result.totalReviewCount,
        source: 'google',
        fetchedAt,
      };
      return ok(payload, `Loaded ${reviews.length} review(s) from Google.`);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;

      // Fall back to the last successful sync, clearly marked as cached, so the
      // dashboard stays usable during an outage. Nothing is invented.
      const cached = await getCachedReviews();
      if (cached && cached.reviews.length > 0) {
        const payload: ReviewsPayload = {
          reviews: applyDraftStatus(cached.reviews, drafts),
          averageRating: cached.averageRating,
          totalReviewCount: cached.totalReviewCount,
          source: 'cache',
          fetchedAt: cached.fetchedAt,
        };
        return ok(
          payload,
          isApprovalPending(error.code)
            ? `Google Business Profile API approval pending — showing the last synced copy from ${cached.fetchedAt}.`
            : `Live fetch failed (${error.message}) — showing the last synced copy.`,
        );
      }
      return failure(error);
    }
  });
}

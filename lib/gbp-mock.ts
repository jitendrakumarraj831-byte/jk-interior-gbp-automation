/**
 * Safe mock Business Profile.
 *
 * Exists so the full workflow — review → AI draft → approval → publish — can be
 * exercised while Google's API access request is under review. Two rules make
 * it safe:
 *
 *  1. It is only ever reachable when isMockModeActive() is true, which cannot
 *     happen on the production deployment (see lib/config.ts).
 *  2. Mock records carry `source: 'mock'` and resource names under `mock/`, and
 *     the publish path refuses to send anything named `mock/` to Google. Mock
 *     and real data are served by mutually exclusive branches and never mix.
 *
 * The AI drafts produced from these reviews are NOT mocked — they go through
 * the real router and the real configured provider.
 */

import type { Review } from './types';

/** Resource-name prefix that marks a record as simulated. */
export const MOCK_PREFIX = 'mock/';

export const MOCK_LOCATION_PATH = 'mock/accounts/jk-interior/locations/forbesganj';

export function isMockResourceName(name: string): boolean {
  return name.startsWith(MOCK_PREFIX);
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Three reviews covering the cases worth testing: a Hinglish five-star, an
 * English four-star, and an English two-star complaint that the reply must
 * handle without arguing.
 */
export function mockReviews(): Review[] {
  return [
    {
      name: `${MOCK_LOCATION_PATH}/reviews/mock-review-1`,
      reviewId: 'mock-review-1',
      reviewerName: 'Ramesh Kumar',
      starRating: 5,
      comment:
        'JK Interior ne hamare ghar me bahut accha gypsum false ceiling ka kaam kiya. Design bahut sundar hai.',
      createTime: hoursAgo(20),
      updateTime: hoursAgo(20),
      existingReply: null,
      replyStatus: 'no_reply',
      source: 'mock',
    },
    {
      name: `${MOCK_LOCATION_PATH}/reviews/mock-review-2`,
      reviewId: 'mock-review-2',
      reviewerName: 'Anita Sharma',
      starRating: 4,
      comment: 'Good false ceiling work and nice finishing.',
      createTime: hoursAgo(50),
      updateTime: hoursAgo(50),
      existingReply: null,
      replyStatus: 'no_reply',
      source: 'mock',
    },
    {
      name: `${MOCK_LOCATION_PATH}/reviews/mock-review-3`,
      reviewId: 'mock-review-3',
      reviewerName: 'Sunil Verma',
      starRating: 2,
      comment: 'Work was delayed and I had some communication issues.',
      createTime: hoursAgo(90),
      updateTime: hoursAgo(90),
      existingReply: null,
      replyStatus: 'no_reply',
      source: 'mock',
    },
  ];
}

export function mockReviewsResult() {
  const reviews = mockReviews();
  const average =
    reviews.reduce((sum, review) => sum + review.starRating, 0) / (reviews.length || 1);
  return {
    reviews,
    averageRating: Number(average.toFixed(1)),
    totalReviewCount: reviews.length,
  };
}

/**
 * Simulates publishing a reply. Performs no network call of any kind — it
 * exists precisely so that nothing reaches Google during a mock run.
 */
export function simulatePublish(reviewName: string): { simulated: true; reviewName: string } {
  return { simulated: true, reviewName };
}

/**
 * Simulated resource name for a published post. The `mock/` prefix makes it
 * obvious in storage and in the UI that this never went to Google.
 */
export function simulatePostPublish(postId: string): string {
  return `${MOCK_LOCATION_PATH}/localPosts/mock-${postId}`;
}

/**
 * The one place a Business Profile post is sent to Google.
 *
 * The dashboard's "Publish now", a scheduled post's "Publish" button and the
 * daily cron all land here, so they share the same guarantees:
 *
 *  - Claimed first. A short-lived claim in the shared store means two requests
 *    (a double-click, cron overlapping a manual publish, a retried cron) cannot
 *    both create the post on Google.
 *  - Re-read after the claim. The post is loaded again once the claim is held,
 *    so a post cancelled, deleted or already published a moment ago is left alone.
 *  - No duplicates. Identical content published or queued in the last day is
 *    refused rather than posted twice.
 *  - Honest status. A post becomes `published` only after Google returns its
 *    resource name. Mock mode never reaches Google (its names carry `mock/`).
 */

import { isMockModeActive } from './config';
import { AppError } from './errors';
import { simulatePostPublish } from './gbp-mock';
import { createLocalPost } from './google-business';
import { findDuplicatePost, getPost, savePost } from './repository';
import { getStore, nsKey } from './store';
import type { GbpPost } from './types';

/** Longer than any single publish can take; short enough to self-heal after a crash. */
const CLAIM_TTL_SECONDS = 10 * 60;

/** A post stuck in `publishing` this long was interrupted mid-flight. */
export const STALE_PUBLISHING_MS = 15 * 60 * 1000;

export const claimKey = (postId: string) => nsKey('claim', 'post', postId);

export type PublishOutcome =
  /** Google accepted the post (or mock mode simulated it). */
  | { kind: 'published'; post: GbpPost }
  /** Another request holds this post right now. Nothing was done. */
  | { kind: 'busy' }
  /** The post vanished, was cancelled or was already published. Nothing was done. */
  | { kind: 'skipped'; post: GbpPost | null; reason: string }
  /** Identical content is already live or queued. Nothing was sent. */
  | { kind: 'duplicate'; post: GbpPost }
  /** The attempt failed. `post` is the claimed copy (status `publishing`); the caller decides what to record. */
  | { kind: 'failed'; post: GbpPost; error: unknown };

export async function publishPostOnce(
  post: GbpPost,
  resolveLocationPath: () => Promise<string>,
): Promise<PublishOutcome> {
  const store = getStore();
  const claim = claimKey(post.id);

  let claimed = true;
  try {
    claimed = await store.setIfAbsent(claim, new Date().toISOString(), {
      ttlSeconds: CLAIM_TTL_SECONDS,
    });
  } catch {
    // A store outage must not stop publishing; the status check below still applies.
    claimed = true;
  }
  if (!claimed) return { kind: 'busy' };

  try {
    const fresh = await getPost(post.id);
    if (!fresh) return { kind: 'skipped', post: null, reason: 'The post no longer exists.' };
    if (fresh.status === 'published') {
      return { kind: 'skipped', post: fresh, reason: 'The post is already published.' };
    }
    if (fresh.status === 'cancelled') {
      return { kind: 'skipped', post: fresh, reason: 'The post was cancelled.' };
    }

    const duplicate = await findDuplicatePost(fresh);
    if (duplicate) return { kind: 'duplicate', post: duplicate };

    const publishing = await savePost({ ...fresh, status: 'publishing' });
    try {
      const googlePostName = isMockModeActive()
        ? simulatePostPublish(publishing.id)
        : await createLocalPost(await resolveLocationPath(), publishing);
      const saved = await savePost({
        ...publishing,
        status: 'published',
        googlePostName,
        publishedAt: new Date().toISOString(),
        error: undefined,
        attempts: undefined,
      });
      return { kind: 'published', post: saved };
    } catch (error) {
      return { kind: 'failed', post: publishing, error };
    }
  } finally {
    await store.del(claim).catch(() => undefined);
  }
}

/** The message recorded on a post whose publish failed. Never a Google payload. */
export function failureMessage(error: unknown): string {
  return error instanceof AppError ? error.message : 'Publishing failed.';
}

/** A Google-side fault worth retrying on the next scheduled run. */
export function isTransientFailure(error: unknown): boolean {
  return (
    error instanceof AppError &&
    (error.code === 'GBP_RATE_LIMITED' ||
      error.code === 'GBP_QUOTA_EXCEEDED' ||
      (error.code === 'GOOGLE_API_ERROR' && error.httpStatus >= 500))
  );
}

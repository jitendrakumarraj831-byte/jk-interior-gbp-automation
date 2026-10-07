/**
 * Automation tasks.
 *
 * These are the units of work the cron endpoints run. They are plain functions
 * so they can also be triggered manually from the dashboard, and every one of
 * them records an AutomationRun for the Automation Status page.
 *
 * Safety: publishReplies() only ever touches drafts an admin has explicitly
 * approved, and only when auto-publish is switched on. Generating a draft never
 * publishes anything.
 */

import { generateReplyDraft } from './ai-reply';
import { recordAudit } from './audit';
import { env, isAiConfigured, isMockModeActive } from './config';
import { shouldSkipGoogleCalls } from './gbp-access';
import {
  isMockResourceName,
  mockReviewsResult,
  simulatePublish,
} from './gbp-mock';
import { statusFromErrorCode, type GbpAccessStatus, type GbpService } from './gbp-status';
import { resolveTarget } from './connection';
import { AppError } from './errors';
import { fetchPerformance, listReviews, publishReviewReply } from './google-business';
import { log } from './logger';
import { notify } from './notifications';
import {
  failureMessage,
  isTransientFailure,
  publishPostOnce,
  STALE_PUBLISHING_MS,
} from './post-publisher';
import {
  getCachedReviews,
  getSettings,
  listDrafts,
  listDuePosts,
  listPosts,
  markCachedReviewReplied,
  newId,
  recordRun,
  saveDraft,
  savePost,
  setCachedPerformance,
  setCachedReviews,
  type ReviewCache,
} from './repository';
import { withLock } from './store';
import type { AutomationRun, AutomationRunName, ReplyDraft, Review } from './types';

type TaskResult = Omit<AutomationRun, 'task' | 'startedAt' | 'finishedAt'>;

/**
 * Result used when Business Profile API access is pending approval, or
 * Google is temporarily rate limiting requests.
 *
 * Reported as ok:true deliberately for both — a skipped job is the system
 * behaving correctly while it waits for Google, not a failure. Marking either
 * as failed would turn "Automation / Cron" red for a condition System Health
 * already reports correctly on its own line ("Approval pending" /
 * "Rate limited"), and would make the whole automation page look broken for
 * as long as the wait lasts.
 */
function skippedForAccessStatus(status: Extract<GbpAccessStatus, 'pending' | 'rate_limited'>): TaskResult {
  return {
    ok: true,
    summary:
      status === 'rate_limited'
        ? 'Skipped — Google is rate limiting Business Profile API requests right now.'
        : 'Skipped — Google Business Profile API access is pending approval.',
    details: {
      status: 'skipped',
      reason: status === 'rate_limited' ? 'gbp_rate_limited' : 'gbp_access_pending',
    },
  };
}

/**
 * True when this task should not call Google at all right now: the API it needs
 * recently answered "closed" (approval pending / API not enabled) and nothing
 * has succeeded since. The gate is short and lifts the moment any Google call
 * succeeds — see lib/gbp-access.ts.
 * Mock mode never skips: it makes no Google calls in the first place.
 */
async function shouldSkipGbpWork(service: GbpService): Promise<boolean> {
  if (isMockModeActive()) return false;
  return shouldSkipGoogleCalls({ service });
}

/**
 * Classifies a Google failure for a cron task and — for a genuine fault rather
 * than the expected pending/rate-limited states — raises a "Google API Issue"
 * notification, deduped to once per code per day so a job failing repeatedly
 * does not flood the notification list.
 *
 * The access state itself is NOT written here: every Google call records its
 * own outcome in lib/google-business.ts, so there is nothing to duplicate.
 *
 * Returns the classified status (or null when `error` wasn't a recognised
 * AppError) so the caller can decide whether this was an expected wait
 * (pending / rate limited — the run should be reported as skipped, not
 * failed) or a genuine fault that should propagate and mark the run failed.
 */
async function noteGoogleFailure(error: unknown): Promise<GbpAccessStatus | null> {
  if (!(error instanceof AppError)) return null;
  const status = statusFromErrorCode(error.code);
  if (status !== 'auth_error' && status !== 'permission_error' && status !== 'error') return status;

  const day = new Date().toISOString().slice(0, 10);
  await notify({
    category: 'google_api_issue',
    title: 'Google Business Profile API issue',
    message: error.message,
    href: '/dashboard/health',
    dedupeKey: `gbp-issue:${error.code}:${day}`,
  });
  return status;
}

/**
 * True, with the run already returned, when a caught error is an expected
 * wait (pending approval or a temporary rate limit) rather than a genuine
 * fault. Callers pass the status `noteGoogleFailure` already classified.
 */
function isExpectedWait(status: GbpAccessStatus | null): status is 'pending' | 'rate_limited' {
  return status === 'pending' || status === 'rate_limited';
}

/** Longer than any cron run (maxDuration is 60s); frees itself if a run crashes. */
const TASK_LOCK_SECONDS = 5 * 60;

/**
 * Runs a task, records the outcome + an audit entry, and never lets it throw
 * past the caller.
 *
 * Each task holds a lock while it runs. A cron retry, a slow run overlapping
 * the next trigger or a manual call made at the same moment therefore cannot
 * run the same job twice (double drafts, double posts). The overlapping call
 * returns a "skipped" run WITHOUT recording it, so it can never overwrite the
 * real run's result in the history.
 */
async function runTask(task: AutomationRunName, fn: () => Promise<TaskResult>): Promise<AutomationRun> {
  const startedAt = new Date().toISOString();
  let result: TaskResult;

  const locked = await withLock(`task:${task}`, TASK_LOCK_SECONDS, async () => {
    try {
      return await fn();
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  });

  if (!locked.ran) {
    return {
      task,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: true,
      summary: 'Skipped — this job is already running.',
      details: { status: 'skipped', reason: 'already_running' },
    };
  }

  const outcome = locked.value;
  if (outcome instanceof Error) {
    const error = outcome;
    const message =
      error instanceof AppError ? error.message : 'Unexpected failure while running the task.';
    if (!(error instanceof AppError)) {
      log.error('tasks', `Task ${task} crashed`, { error: error.message });
    }
    result = {
      ok: false,
      summary: message,
      details: { code: error instanceof AppError ? error.code : 'INTERNAL' },
    };
  } else {
    result = outcome;
  }

  const run: AutomationRun = { task, startedAt, finishedAt: new Date().toISOString(), ...result };
  await recordRun(run).catch(() => {
    /* the run log is best-effort; never fail a task because of it */
  });
  await recordAudit({
    actor: 'cron',
    action: 'automation_executed',
    resource: task,
    status: result.ok ? 'success' : 'failure',
    source: 'cron',
    detail: result.summary,
  });
  return run;
}

const NEW_REVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Notifies about reviews that were not present the last time we synced.
 * Skipped entirely on the very first sync (no `previousCache` yet) — with no
 * baseline, every review would look "new" and flood the notification list.
 */
async function notifyNewReviews(reviews: Review[], previousCache: ReviewCache | null): Promise<void> {
  if (!previousCache) return;
  const previousIds = new Set(previousCache.reviews.map((r) => r.reviewId));
  // The synced window is only the newest reviews, so an old one edited on Google
  // can enter it. Only a review actually written recently counts as "new".
  const cutoff = Date.now() - NEW_REVIEW_WINDOW_MS;
  const fresh = reviews.filter(
    (r) => !previousIds.has(r.reviewId) && Date.parse(r.createTime) >= cutoff,
  );

  for (const review of fresh) {
    await notify({
      category: 'new_review',
      title: 'New Google review',
      message: `${review.reviewerName} left a ${review.starRating}★ review.`,
      href: '/dashboard/reviews',
      dedupeKey: `review:${review.reviewId}`,
    });
  }
}

/* ------------------------------ sync reviews ----------------------------- */

/**
 * Merges the live Google reviews with our local draft state so the dashboard
 * can show one coherent reply status per review.
 */
export function applyDraftStatus(reviews: Review[], drafts: ReplyDraft[]): Review[] {
  const byReviewId = new Map(drafts.map((d) => [d.reviewId, d]));
  return reviews.map((review) => {
    if (review.existingReply) return review;
    const draft = byReviewId.get(review.reviewId);
    if (!draft) return review;
    return { ...review, replyStatus: draft.status };
  });
}

export async function syncReviews(): Promise<AutomationRun> {
  return runTask('sync-reviews', async (): Promise<TaskResult> => {
    if (await shouldSkipGbpWork('reviews')) return skippedForAccessStatus('pending');

    const drafts = await listDrafts();
    const previousCache = await getCachedReviews();

    // Mock mode serves simulated reviews and never touches Google.
    if (isMockModeActive()) {
      const mock = mockReviewsResult();
      await setCachedReviews({
        reviews: applyDraftStatus(mock.reviews, drafts),
        averageRating: mock.averageRating,
        totalReviewCount: mock.totalReviewCount,
        fetchedAt: new Date().toISOString(),
        locationPath: 'mock',
      });
      await notifyNewReviews(mock.reviews, previousCache);
      return {
        ok: true,
        summary: `Synced ${mock.reviews.length} mock reviews (no Google call).`,
        details: { fetched: mock.reviews.length, source: 'mock' },
      };
    }

    let target;
    let result;
    try {
      target = await resolveTarget();
      result = await listReviews(target.locationPath);
    } catch (error) {
      const status = await noteGoogleFailure(error);
      if (isExpectedWait(status)) return skippedForAccessStatus(status);
      throw error;
    }

    await setCachedReviews({
      reviews: applyDraftStatus(result.reviews, drafts),
      averageRating: result.averageRating,
      totalReviewCount: result.totalReviewCount,
      fetchedAt: new Date().toISOString(),
      locationPath: target.locationPath,
    });
    await notifyNewReviews(result.reviews, previousCache);

    const unanswered = result.reviews.filter((r) => !r.existingReply).length;
    return {
      ok: true,
      summary: `Synced ${result.reviews.length} reviews (${unanswered} without a reply on Google).`,
      details: { fetched: result.reviews.length, unanswered },
    };
  });
}

/* ---------------------------- generate drafts ---------------------------- */

/** How many drafts one cron invocation may generate, to bound cost and time. */
const MAX_DRAFTS_PER_RUN = 10;

export async function generateDrafts(): Promise<AutomationRun> {
  return runTask('generate-drafts', async (): Promise<TaskResult> => {
    if (!isAiConfigured()) {
      throw new AppError(
        'AI_NOT_CONFIGURED',
        'GROQ_API_KEY is not set, so no reply drafts can be generated.',
        503,
      );
    }

    const settings = await getSettings();
    if (!settings.autoGenerateDrafts) {
      return { ok: true, summary: 'Automatic draft generation is turned off in Settings.' };
    }

    if (await shouldSkipGbpWork('reviews')) return skippedForAccessStatus('pending');

    let reviews;
    if (isMockModeActive()) {
      reviews = mockReviewsResult().reviews;
    } else {
      try {
        const target = await resolveTarget();
        ({ reviews } = await listReviews(target.locationPath, { maxPages: 2 }));
      } catch (error) {
        const status = await noteGoogleFailure(error);
        if (isExpectedWait(status)) return skippedForAccessStatus(status);
        throw error;
      }
    }

    const candidates = reviews.filter(
      (review) => !review.existingReply && review.starRating >= settings.autoDraftMinStars,
    );

    let created = 0;
    let skipped = 0;
    let failed = 0;

    // One read of the existing drafts, not one full scan per review.
    const existingDrafts = await listDrafts();
    const draftedReviewIds = new Set(existingDrafts.map((d) => d.reviewId));
    const existingReplies = new Set(existingDrafts.map((d) => normalizeReply(d.text)));

    for (const review of candidates) {
      if (created >= MAX_DRAFTS_PER_RUN) break;
      if (draftedReviewIds.has(review.reviewId)) {
        skipped += 1;
        continue;
      }
      try {
        const draft = await createDraftForReview(review, existingReplies);
        await saveDraft(draft);
        draftedReviewIds.add(review.reviewId);
        existingReplies.add(normalizeReply(draft.text));
        created += 1;
        await notify({
          category: 'ai_draft_ready',
          title: 'AI reply draft ready',
          message: `A draft reply is ready for ${review.reviewerName}'s review.`,
          href: '/dashboard/drafts',
          dedupeKey: `draft-ready:${draft.id}`,
        });
      } catch (error) {
        failed += 1;
        log.warn('tasks', 'Could not draft a reply for a review', {
          reviewId: review.reviewId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: failed === 0,
      summary: `Created ${created} reply draft(s); ${skipped} already had one; ${failed} failed.`,
      details: { created, skipped, failed, candidates: candidates.length },
    };
  });
}

const normalizeReply = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Builds (but does not persist) a draft for a review. `existingReplies` is the
 * wording of replies already drafted or published; an identical one is flagged,
 * because the same sentence under many reviews reads as automated.
 */
export async function createDraftForReview(
  review: Review,
  existingReplies?: Set<string>,
): Promise<ReplyDraft> {
  const generated = await generateReplyDraft(review);
  const now = new Date().toISOString();
  const flags = [...generated.flags];
  if (existingReplies?.has(normalizeReply(generated.text))) {
    flags.push('Identical to another reply you already have');
  }
  return {
    id: newId(),
    reviewId: review.reviewId,
    reviewName: review.name,
    reviewerName: review.reviewerName,
    starRating: review.starRating,
    reviewComment: review.comment,
    generatedText: generated.text,
    text: generated.text,
    language: generated.language,
    status: 'draft_pending',
    model: generated.model,
    ...(flags.length > 0 ? { flags } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/* ---------------------------- publish replies ---------------------------- */

/**
 * Publishes replies that an admin has already approved.
 *
 * This is deliberately gated twice: the draft must be in `approved` state AND
 * auto-publishing must be enabled. With auto-publish off (the default) approved
 * drafts wait for the admin to press Publish in the dashboard.
 */
export async function publishApprovedReplies(): Promise<AutomationRun> {
  // A distinct task name from syncReviews(): both used to record under
  // 'sync-reviews', so whichever of the two ran last (this one always runs
  // right after syncReviews() in /api/cron/sync) silently overwrote the run
  // log's "most recent sync-reviews" slot — masking the real review sync
  // outcome. System Health reads exactly that slot, so a genuine syncReviews
  // failure could be hidden behind this task's unrelated (usually no-op) result.
  return runTask('publish-replies', async (): Promise<TaskResult> => {
    // AUTO_PUBLISH_REPLIES is the master switch: with it off (the default) no
    // dashboard toggle can start automatic publishing. With it on, the
    // dashboard toggle is the deliberate second step that actually enables it.
    const settings = await getSettings();
    const autoPublish = env().AUTO_PUBLISH_REPLIES && settings.autoPublishReplies;
    if (!autoPublish) {
      return {
        ok: true,
        summary: 'Auto-publishing is off — approved replies are waiting for manual publish.',
        details: { autoPublish: false },
      };
    }

    // Only drafts a human explicitly approved, and only real Google replies in
    // production. Anything without an approval timestamp is never touched.
    const drafts = (await listDrafts()).filter((d) => d.status === 'approved' && d.approvedAt);
    let published = 0;
    let failed = 0;

    for (const draft of drafts) {
      try {
        // A mock review is simulated; a real one goes to Google. The two can
        // never cross: the name decides, and mock names are never real.
        if (isMockResourceName(draft.reviewName)) {
          if (!isMockModeActive()) {
            throw new AppError(
              'CONFLICT',
              'This draft belongs to a mock review and cannot be published to Google.',
              409,
            );
          }
          simulatePublish(draft.reviewName);
        } else {
          await publishReviewReply(draft.reviewName, draft.text);
          await markCachedReviewReplied(draft.reviewName, draft.text);
        }
        await saveDraft({
          ...draft,
          status: 'published',
          publishedAt: new Date().toISOString(),
          error: undefined,
        });
        published += 1;
        await recordAudit({
          actor: 'cron',
          action: 'review_reply_published',
          resource: draft.id,
          status: 'success',
          source: 'cron',
          detail: 'Auto-published (AUTO_PUBLISH_REPLIES / settings toggle is on).',
        });
      } catch (error) {
        failed += 1;
        await saveDraft({
          ...draft,
          status: 'publish_failed',
          error: error instanceof AppError ? error.message : 'Publishing failed.',
        });
        await recordAudit({
          actor: 'cron',
          action: 'review_reply_published',
          resource: draft.id,
          status: 'failure',
          source: 'cron',
        });
      }
    }

    return {
      ok: failed === 0,
      summary: `Auto-published ${published} approved repl${published === 1 ? 'y' : 'ies'}; ${failed} failed.`,
      details: { published, failed },
    };
  });
}

/* --------------------------- publish due posts --------------------------- */

/**
 * A post left in `publishing` this long was interrupted mid-flight (the
 * function crashed or timed out). It may or may not have reached Google, so it
 * is NOT retried automatically — that could post it twice. It is marked failed
 * with an instruction instead, and the owner decides.
 */
async function recoverInterruptedPosts(): Promise<number> {
  const cutoff = Date.now() - STALE_PUBLISHING_MS;
  const stuck = (await listPosts()).filter(
    (p) => p.status === 'publishing' && Date.parse(p.updatedAt) < cutoff,
  );
  for (const post of stuck) {
    await savePost({
      ...post,
      status: 'failed',
      error:
        'Publishing was interrupted. Check your Google profile for this post before retrying, so it is not posted twice.',
    });
  }
  return stuck.length;
}

/** Automatic attempts at a scheduled post that keeps hitting temporary Google faults. */
const MAX_AUTO_ATTEMPTS = 3;

export async function publishScheduledPosts(): Promise<AutomationRun> {
  return runTask('publish-posts', async (): Promise<TaskResult> => {
    if (await shouldSkipGbpWork('posts')) return skippedForAccessStatus('pending');

    const recovered = await recoverInterruptedPosts();

    const due = await listDuePosts();
    if (due.length === 0) {
      return {
        ok: true,
        summary: 'No scheduled posts were due.',
        details: { due: 0, recovered },
      };
    }

    // The target is resolved once, and only for a real run — mock mode never
    // touches it, so no Google call can occur.
    const mock = isMockModeActive();
    let locationPath: string | null = null;
    if (!mock) {
      try {
        locationPath = (await resolveTarget()).locationPath;
      } catch (error) {
        const status = await noteGoogleFailure(error);
        if (isExpectedWait(status)) return skippedForAccessStatus(status);
        throw error;
      }
    }

    let published = 0;
    let skipped = 0;
    let failed = 0;

    for (const post of due) {
      // Claim, re-read, de-duplicate and publish — see lib/post-publisher.ts.
      const outcome = await publishPostOnce(post, async () => locationPath!);

      if (outcome.kind === 'busy' || outcome.kind === 'skipped') {
        skipped += 1;
        continue;
      }

      if (outcome.kind === 'duplicate') {
        failed += 1;
        await savePost({
          ...post,
          status: 'failed',
          error: 'Not published: an identical post was published or queued within the last day.',
        });
        continue;
      }

      if (outcome.kind === 'published') {
        published += 1;
        await notify({
          category: 'post_published',
          title: 'Post published',
          message: `"${post.title}" is now live on Google Business Profile.`,
          href: '/dashboard/posts',
          dedupeKey: `post-published:${post.id}`,
        });
        await recordAudit({
          actor: 'cron',
          action: 'post_published',
          resource: post.id,
          status: 'success',
          source: 'cron',
        });
        continue;
      }

      // outcome.kind === 'failed'
      const status = mock ? null : await noteGoogleFailure(outcome.error);
      if (isExpectedWait(status)) {
        // Leave it scheduled — cron picks it up again once Google answers.
        // Stop this run's loop rather than hammering a known rate limit with
        // every other due post.
        await savePost({ ...post, status: 'scheduled', error: undefined });
        skipped += 1;
        break;
      }

      const attempts = (post.attempts ?? 0) + 1;
      if (isTransientFailure(outcome.error) && attempts < MAX_AUTO_ATTEMPTS) {
        // A Google hiccup should not permanently fail a post that is due.
        await savePost({
          ...post,
          status: 'scheduled',
          attempts,
          error: 'Google had a temporary problem. It will be retried on the next run.',
        });
        skipped += 1;
        continue;
      }

      failed += 1;
      // Stays 'failed', never 'published' — we do not claim a post went live.
      await savePost({
        ...post,
        status: 'failed',
        attempts,
        error: failureMessage(outcome.error),
      });
      await recordAudit({
        actor: 'cron',
        action: 'post_published',
        resource: post.id,
        status: 'failure',
        source: 'cron',
      });
    }

    return {
      ok: failed === 0,
      summary:
        skipped > 0
          ? `Published ${published} of ${due.length} due post(s); ${skipped} left for the next run, ${failed} failed.`
          : `Published ${published} of ${due.length} due post(s); ${failed} failed.`,
      details: { due: due.length, published, skipped, failed, recovered },
    };
  });
}

/* --------------------------- sync performance ---------------------------- */

export async function syncPerformance(days = 30): Promise<AutomationRun> {
  return runTask('sync-performance', async (): Promise<TaskResult> => {
    if (await shouldSkipGbpWork('performance')) return skippedForAccessStatus('pending');
    if (isMockModeActive()) {
      return {
        ok: true,
        summary: 'Skipped — performance data is not simulated in mock mode.',
        details: { status: 'skipped', reason: 'mock_mode' },
      };
    }

    let snapshot;
    try {
      const target = await resolveTarget();
      snapshot = await fetchPerformance(target.locationName, { days });
    } catch (error) {
      const status = await noteGoogleFailure(error);
      if (isExpectedWait(status)) return skippedForAccessStatus(status);
      throw error;
    }
    await setCachedPerformance(snapshot, days);
    await notify({
      category: 'performance_report_ready',
      title: 'Performance data updated',
      message: `Performance synced through ${snapshot.rangeEnd}.`,
      href: '/dashboard/performance',
      dedupeKey: `performance:${snapshot.rangeEnd}`,
    });

    const interactions = snapshot.series
      .filter((s) =>
        ['CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_CONVERSATIONS'].includes(
          s.metric,
        ),
      )
      .reduce((sum, s) => sum + s.total, 0);

    return {
      ok: true,
      summary: `Updated performance for ${snapshot.rangeStart} → ${snapshot.rangeEnd} (${interactions} interactions).`,
      details: { metrics: snapshot.series.length, interactions },
    };
  });
}

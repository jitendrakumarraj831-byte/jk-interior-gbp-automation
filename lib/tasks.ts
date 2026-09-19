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
import { recordAccessFailure, shouldSkipGoogleCalls } from './gbp-access';
import {
  isMockResourceName,
  mockReviewsResult,
  simulatePostPublish,
  simulatePublish,
} from './gbp-mock';
import { resolveTarget } from './connection';
import { AppError } from './errors';
import { createLocalPost, fetchPerformance, listReviews, publishReviewReply } from './google-business';
import { log } from './logger';
import { notify } from './notifications';
import {
  findDraftByReviewId,
  getCachedReviews,
  getSettings,
  listDrafts,
  listDuePosts,
  newId,
  recordRun,
  saveDraft,
  savePost,
  setCachedPerformance,
  setCachedReviews,
  type ReviewCache,
} from './repository';
import type { AutomationRun, AutomationRunName, ReplyDraft, Review } from './types';

type TaskResult = Omit<AutomationRun, 'task' | 'startedAt' | 'finishedAt'>;

/**
 * Result used when Business Profile API access is still pending.
 *
 * Reported as ok:true deliberately — a skipped job is the system behaving
 * correctly while it waits for Google, not a failure. Marking it failed would
 * make the whole automation page look broken for weeks.
 */
function skippedForPendingAccess(): TaskResult {
  return {
    ok: true,
    summary: 'Skipped — Google Business Profile API access is pending approval.',
    details: { status: 'skipped', reason: 'gbp_access_pending' },
  };
}

/**
 * True when this task should not call Google at all right now.
 * Mock mode never skips: it makes no Google calls in the first place.
 */
async function shouldSkipGbpWork(): Promise<boolean> {
  if (isMockModeActive()) return false;
  return shouldSkipGoogleCalls();
}

/**
 * Caches a classified failure so the next cron run can skip early, and — for
 * a genuine fault rather than the expected pending/rate-limited states —
 * raises a "Google API Issue" notification. Deduped to once per code per day
 * so a run failing every few minutes does not flood the notification list.
 */
async function noteGoogleFailure(error: unknown): Promise<void> {
  if (!(error instanceof AppError)) return;
  const status = await recordAccessFailure(error.code);
  if (status !== 'auth_error' && status !== 'permission_error' && status !== 'error') return;

  const day = new Date().toISOString().slice(0, 10);
  await notify({
    category: 'google_api_issue',
    title: 'Google Business Profile API issue',
    message: error.message,
    href: '/dashboard/health',
    dedupeKey: `gbp-issue:${error.code}:${day}`,
  });
}

/** Runs a task, records the outcome + an audit entry, and never lets it throw past the caller. */
async function runTask(task: AutomationRunName, fn: () => Promise<TaskResult>): Promise<AutomationRun> {
  const startedAt = new Date().toISOString();
  let result: TaskResult;

  try {
    result = await fn();
  } catch (error) {
    const message =
      error instanceof AppError ? error.message : 'Unexpected failure while running the task.';
    if (!(error instanceof AppError)) {
      log.error('tasks', `Task ${task} crashed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    result = {
      ok: false,
      summary: message,
      details: { code: error instanceof AppError ? error.code : 'INTERNAL' },
    };
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

/**
 * Notifies about reviews that were not present the last time we synced.
 * Skipped entirely on the very first sync (no `previousCache` yet) — with no
 * baseline, every review would look "new" and flood the notification list.
 */
async function notifyNewReviews(reviews: Review[], previousCache: ReviewCache | null): Promise<void> {
  if (!previousCache) return;
  const previousIds = new Set(previousCache.reviews.map((r) => r.reviewId));
  const fresh = reviews.filter((r) => !previousIds.has(r.reviewId));

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
    if (await shouldSkipGbpWork()) return skippedForPendingAccess();

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
      await noteGoogleFailure(error);
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

    if (await shouldSkipGbpWork()) return skippedForPendingAccess();

    let reviews;
    if (isMockModeActive()) {
      reviews = mockReviewsResult().reviews;
    } else {
      try {
        const target = await resolveTarget();
        ({ reviews } = await listReviews(target.locationPath, { maxPages: 2 }));
      } catch (error) {
        await noteGoogleFailure(error);
        throw error;
      }
    }

    const candidates = reviews.filter(
      (review) => !review.existingReply && review.starRating >= settings.autoDraftMinStars,
    );

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const review of candidates) {
      if (created >= MAX_DRAFTS_PER_RUN) break;
      if (await findDraftByReviewId(review.reviewId)) {
        skipped += 1;
        continue;
      }
      try {
        const draft = await createDraftForReview(review);
        await saveDraft(draft);
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

/** Builds (but does not persist) a draft for a review. */
export async function createDraftForReview(review: Review): Promise<ReplyDraft> {
  const generated = await generateReplyDraft(review);
  const now = new Date().toISOString();
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
  return runTask('sync-reviews', async (): Promise<TaskResult> => {
    const settings = await getSettings();
    const autoPublish = settings.autoPublishReplies || env().AUTO_PUBLISH_REPLIES;
    if (!autoPublish) {
      return {
        ok: true,
        summary: 'Auto-publishing is off — approved replies are waiting for manual publish.',
        details: { autoPublish: false },
      };
    }

    const drafts = (await listDrafts()).filter((d) => d.status === 'approved');
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

export async function publishScheduledPosts(): Promise<AutomationRun> {
  return runTask('publish-posts', async (): Promise<TaskResult> => {
    if (await shouldSkipGbpWork()) return skippedForPendingAccess();

    const due = await listDuePosts();
    if (due.length === 0) {
      return { ok: true, summary: 'No scheduled posts were due.', details: { due: 0 } };
    }

    const mock = isMockModeActive();
    // In mock mode the target is never resolved, so no Google call can occur.
    let target = null;
    if (!mock) {
      try {
        target = await resolveTarget();
      } catch (error) {
        await noteGoogleFailure(error);
        throw error;
      }
    }
    let published = 0;
    let failed = 0;

    for (const post of due) {
      await savePost({ ...post, status: 'publishing' });
      try {
        const googlePostName = mock
          ? simulatePostPublish(post.id)
          : await createLocalPost(target!.locationPath, post);
        await savePost({
          ...post,
          status: 'published',
          googlePostName,
          publishedAt: new Date().toISOString(),
          error: undefined,
        });
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
      } catch (error) {
        failed += 1;
        // Stays 'failed', never 'published' — we do not claim a post went live.
        await savePost({
          ...post,
          status: 'failed',
          error: error instanceof AppError ? error.message : 'Publishing failed.',
        });
        await recordAudit({
          actor: 'cron',
          action: 'post_published',
          resource: post.id,
          status: 'failure',
          source: 'cron',
        });
      }
    }

    return {
      ok: failed === 0,
      summary: `Published ${published} of ${due.length} due post(s); ${failed} failed.`,
      details: { due: due.length, published, failed },
    };
  });
}

/* --------------------------- sync performance ---------------------------- */

export async function syncPerformance(days = 30): Promise<AutomationRun> {
  return runTask('sync-performance', async (): Promise<TaskResult> => {
    if (await shouldSkipGbpWork()) return skippedForPendingAccess();
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
      await noteGoogleFailure(error);
      throw error;
    }
    await setCachedPerformance(snapshot);
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

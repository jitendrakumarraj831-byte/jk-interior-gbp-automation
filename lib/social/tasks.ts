/**
 * Social automation cron tasks — publishing due posts and drafting the daily
 * AI suggestion. Mirrors lib/tasks.ts's shape (runTask wrapper, AutomationRun
 * recording, AppError-aware classification) but is its own file: Meta stays
 * independent from Google, and this never touches lib/tasks.ts.
 */

import { AppError } from '../errors';
import { isAiConfigured, isMetaConfigured } from '../config';
import { log } from '../logger';
import { notify } from '../notifications';
import { recordAudit } from '../audit';
import { recordRun } from '../repository';
import { generateSocialContent } from './content-studio';
import { computeContentHash, findDuplicate, findPublishedDuplicate } from './duplicate';
import { publishSocialPostNow } from './publish';
import {
  listDueSocialPosts,
  listSocialPosts,
  newSocialId,
  saveSocialPost,
} from './repository';
import { getSocialSettings } from './settings';
import { contentTypeForDay } from './weekly-plan';
import type { AutomationRun, AutomationRunName } from '../types';
import type { SocialPost } from './types';

type TaskResult = Omit<AutomationRun, 'task' | 'startedAt' | 'finishedAt'>;

async function runSocialTask(task: AutomationRunName, fn: () => Promise<TaskResult>): Promise<AutomationRun> {
  const startedAt = new Date().toISOString();
  let result: TaskResult;

  try {
    result = await fn();
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Unexpected failure while running the task.';
    if (!(error instanceof AppError)) {
      log.error('social/tasks', `Task ${task} crashed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    result = { ok: false, summary: message, details: { code: error instanceof AppError ? error.code : 'INTERNAL' } };
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

/** Notifies once per error code per day — a run failing every few minutes must not flood the list. */
async function notifyMetaFailure(code: string, message: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const category =
    code === 'META_RATE_LIMITED' ? 'meta_rate_limited' : code === 'META_TOKEN_EXPIRED' ? 'meta_token_expired' : 'meta_permission_error';
  await notify({
    category,
    title:
      category === 'meta_rate_limited'
        ? 'Meta rate limited'
        : category === 'meta_token_expired'
          ? 'Meta token expired'
          : 'Meta permission error',
    message,
    href: '/dashboard/social',
    dedupeKey: `${category}:${day}`,
  });
}

/** States that mean "Meta itself isn't ready right now" — retryable, not this post's fault. */
const RETRYABLE_CODES = new Set(['META_RATE_LIMITED', 'META_TOKEN_EXPIRED', 'META_NOT_CONNECTED', 'META_NOT_CONFIGURED']);

/* --------------------------------- publish --------------------------------- */

export async function publishScheduledSocialPosts(): Promise<AutomationRun> {
  return runSocialTask('publish-social', async (): Promise<TaskResult> => {
    if (!isMetaConfigured()) {
      return { ok: true, summary: 'Meta is not configured — nothing to publish.', details: { status: 'skipped' } };
    }

    const due = await listDueSocialPosts();
    if (due.length === 0) {
      return { ok: true, summary: 'No scheduled social posts were due.', details: { due: 0 } };
    }

    const settings = await getSocialSettings();
    let published = 0;
    let skipped = 0;
    let failed = 0;

    for (const post of due) {
      const wantsFacebook = post.platforms === 'facebook' || post.platforms === 'both';
      const wantsInstagram = post.platforms === 'instagram' || post.platforms === 'both';
      const facebookAllowed = !wantsFacebook || settings.facebookAutoPublish;
      const instagramAllowed = !wantsInstagram || settings.instagramAutoPublish;

      // Auto Publish is OFF by default — a due post just waits for a manual
      // "Publish now" click. This is expected, not an error: no notification,
      // no status change, and no Meta call is made.
      if (!facebookAllowed || !instagramAllowed) {
        skipped += 1;
        continue;
      }

      const duplicate = await findPublishedDuplicate(post.contentHash, post.id);
      if (duplicate) {
        await saveSocialPost({
          ...post,
          status: 'skipped',
          lastError: `Duplicate of "${duplicate.title}", already published ${duplicate.publishedAt ?? duplicate.createdAt}.`,
        });
        await notify({
          category: 'social_post_skipped',
          title: 'Social post skipped — duplicate content',
          message: `"${post.title}" was skipped: identical to an already-published post.`,
          href: '/dashboard/content-calendar',
          dedupeKey: `social-skipped-dup:${post.id}`,
        });
        skipped += 1;
        continue;
      }

      await saveSocialPost({ ...post, status: 'publishing' });
      try {
        await publishSocialPostNow(post);
        published += 1;
        await notify({
          category: 'social_post_published',
          title: 'Social post published',
          message: `"${post.title}" is now live.`,
          href: '/dashboard/content-calendar',
          dedupeKey: `social-published:${post.id}`,
        });
        await recordAudit({
          actor: 'cron',
          action: 'social_post_published_auto',
          resource: post.id,
          status: 'success',
          source: 'cron',
        });
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'INTERNAL';
        const message = error instanceof AppError ? error.message : 'Publishing failed.';

        if (typeof code === 'string' && RETRYABLE_CODES.has(code)) {
          // Leave it scheduled — cron retries next run. Stop hammering Meta
          // with every other due post once we know it's rate limited/expired.
          await saveSocialPost({ ...post, status: 'scheduled', lastError: undefined });
          if (code === 'META_RATE_LIMITED' || code === 'META_TOKEN_EXPIRED') {
            await notifyMetaFailure(code, message);
          }
          skipped += 1;
          await recordAudit({
            actor: 'cron',
            action: 'social_post_skipped',
            resource: post.id,
            status: 'success',
            source: 'cron',
            detail: message,
          });
          break;
        }

        failed += 1;
        await saveSocialPost({ ...post, status: 'failed', lastError: message, retryCount: post.retryCount + 1 });
        await notify({
          category: 'social_post_failed',
          title: 'Social post failed',
          message: `"${post.title}" failed to publish: ${message}`,
          href: '/dashboard/content-calendar',
          dedupeKey: `social-failed:${post.id}:${post.retryCount + 1}`,
        });
        if (code === 'META_PERMISSION_ERROR') await notifyMetaFailure(code, message);
        await recordAudit({
          actor: 'cron',
          action: 'social_post_failed',
          resource: post.id,
          status: 'failure',
          source: 'cron',
          detail: message,
        });
      }
    }

    return {
      ok: failed === 0,
      summary: `Published ${published} of ${due.length} due social post(s); ${skipped} skipped, ${failed} failed.`,
      details: { due: due.length, published, skipped, failed },
    };
  });
}

/* --------------------------- daily AI content draft ------------------------- */

/** How many drafts one cron invocation may create — always exactly one per day by design, bounded defensively anyway. */
const MAX_DRAFTS_PER_RUN = 1;

/**
 * Drafts one post from today's weekly-plan content type. Never publishes,
 * never auto-approves — the draft waits on the Content Calendar like any
 * other, same as a human-authored one.
 */
export async function generateDailySocialContent(): Promise<AutomationRun> {
  return runSocialTask('generate-social-content', async (): Promise<TaskResult> => {
    if (!isMetaConfigured()) {
      return { ok: true, summary: 'Meta is not configured — no draft generated.', details: { status: 'skipped' } };
    }
    if (!isAiConfigured()) {
      return { ok: true, summary: 'No AI provider is configured — no draft generated.', details: { status: 'skipped' } };
    }

    const contentType = contentTypeForDay();
    const alreadyToday = (await listSocialPosts()).some(
      (p) => p.contentType === contentType && p.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10),
    );
    if (alreadyToday) {
      return { ok: true, summary: `A ${contentType} draft already exists for today.`, details: { status: 'skipped' } };
    }

    let created = 0;
    for (let i = 0; i < MAX_DRAFTS_PER_RUN; i += 1) {
      const generated = await generateSocialContent({ contentType, platforms: 'both', language: 'en' });
      const hash = computeContentHash({
        contentType,
        platforms: 'both',
        facebookContent: generated.facebookContent,
        instagramContent: generated.instagramContent,
      });

      if (await findDuplicate(hash)) {
        continue; // try nothing further this run — the plan runs again tomorrow.
      }

      const now = new Date().toISOString();
      const post: SocialPost = {
        id: newSocialId(),
        title: generated.title,
        contentType,
        platforms: 'both',
        language: 'en',
        content: '',
        facebookContent: generated.facebookContent,
        instagramContent: generated.instagramContent,
        mediaIds: [],
        status: 'draft',
        approvalStatus: 'pending',
        createdAt: now,
        updatedAt: now,
        createdBy: 'cron',
        retryCount: 0,
        externalPostIds: {},
        contentHash: hash,
      };
      await saveSocialPost(post);
      created += 1;
      await notify({
        category: 'social_draft_created',
        title: 'Daily social draft ready',
        message: `"${post.title}" is ready for review.`,
        href: '/dashboard/content-calendar',
        dedupeKey: `social-draft-created:${post.id}`,
      });
    }

    return {
      ok: true,
      summary: created > 0 ? `Drafted ${created} social post.` : 'No draft created (duplicate content).',
      details: { created },
    };
  });
}

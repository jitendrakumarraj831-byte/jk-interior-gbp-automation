/**
 * Dashboard summary.
 *
 * Aggregates connection state, review counts, draft counts and the automation
 * run log into the cards on the overview page. Designed never to fail: a
 * Google outage degrades individual numbers rather than breaking the page.
 *
 * The connection card is NOT computed here from this route's own reviews call.
 * It is read from the shared access snapshot (lib/gbp-access.ts) — the same
 * source Settings, the Connection page, System Health and /api/health use — so
 * the dashboard can never disagree with them about whether Google is working.
 */

import { configWarnings, isMockModeActive } from '@/lib/config';
import { ensureAccessChecked, getLocationTitle, resolveTarget } from '@/lib/connection';
import { AppError } from '@/lib/errors';
import { readAccess, shouldSkipGoogleCalls } from '@/lib/gbp-access';
import { mockReviewsResult } from '@/lib/gbp-mock';
import { accessLabel, type GbpAccessSnapshot } from '@/lib/gbp-status';
import { getCredentialState } from '@/lib/google-auth';
import { listReviews } from '@/lib/google-business';
import { getCachedReviews, getSettings, latestRuns, listDrafts, listPosts, listRuns } from '@/lib/repository';
import { assertAdmin, handleRoute, ok } from '@/lib/security';
import { applyDraftStatus } from '@/lib/tasks';
import type { DashboardSummary, Review } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Reviews created in the last 7 days. */
function countRecent(reviews: Review[]): number {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return reviews.filter((r) => new Date(r.createTime).getTime() >= cutoff).length;
}

/** Warnings that come from what Google actually said, not from configuration. */
function accessWarnings(access: GbpAccessSnapshot): string[] {
  switch (access.status) {
    case 'pending':
      return ['Google has not opened Business Profile API access for this project yet. Nothing to do but wait.'];
    case 'auth_error':
      return ['Google rejected the saved sign-in. Reconnect your Google account.'];
    case 'permission_error':
      return [access.message];
    case 'rate_limited':
      return ['Google is rate limiting requests right now. This is temporary.'];
    case 'error':
      return ['Google returned an unexpected error. This is usually temporary.'];
    case 'available':
      // Proven access, but some API is failing: say so instead of a green card.
      return access.degraded.length > 0 ? [access.message] : [];
    default:
      return [];
  }
}

export async function GET(request: Request) {
  return handleRoute('status', async () => {
    assertAdmin(request);

    const mock = isMockModeActive();
    const [drafts, posts, runs, lastRuns, settings, credential] = await Promise.all([
      listDrafts(),
      listPosts(),
      listRuns(),
      latestRuns(),
      getSettings(),
      getCredentialState(),
    ]);

    let reviews: Review[] = [];
    let averageRating: number | null = null;
    let totalReviews = 0;
    let reviewsSource: DashboardSummary['reviewsSource'] = 'none';
    let reviewsFetchedAt: string | undefined;
    let reviewsNote: string | undefined;
    let locationPath: string | undefined;
    let access: GbpAccessSnapshot;

    if (mock) {
      const result = mockReviewsResult();
      reviews = applyDraftStatus(result.reviews, drafts);
      averageRating = result.averageRating;
      totalReviews = result.totalReviewCount;
      reviewsSource = 'mock';
      reviewsFetchedAt = new Date().toISOString();
      const now = new Date().toISOString();
      access = {
        status: 'available',
        message: 'Mock Business Profile — simulated data, nothing reaches Google.',
        checkedAt: now,
        lastSuccessAt: now,
        services: [],
        degraded: [],
      };
    } else if (!credential.connected) {
      access = await readAccess();
    } else {
      // Self-heals a stale "pending": if access is not proven and a check is
      // due, Google is asked once (shared across concurrent loads) before
      // anything below is decided.
      access = await ensureAccessChecked();

      const cached = await getCachedReviews();
      const fromCache = () => {
        if (!cached) return;
        reviews = applyDraftStatus(cached.reviews, drafts);
        averageRating = cached.averageRating;
        totalReviews = cached.totalReviewCount;
        reviewsSource = 'cache';
        reviewsFetchedAt = cached.fetchedAt;
      };

      if (await shouldSkipGoogleCalls({ service: 'reviews' })) {
        fromCache();
        reviewsNote = 'Google has not opened review access yet, so these are the last synced reviews.';
      } else {
        try {
          const target = await resolveTarget();
          locationPath = target.locationPath;
          const result = await listReviews(target.locationPath, { maxPages: 2 });
          reviews = applyDraftStatus(result.reviews, drafts);
          averageRating = result.averageRating;
          totalReviews = result.totalReviewCount;
          reviewsSource = 'google';
          reviewsFetchedAt = new Date().toISOString();
        } catch (error) {
          fromCache();
          reviewsNote =
            error instanceof AppError
              ? error.message
              : 'Unexpected error contacting Google.';
        }
      }

      // Re-read AFTER the calls above: each one just recorded its own outcome,
      // so this is the freshest possible truth, and a success here has already
      // overridden any older "pending".
      access = await readAccess();
    }

    const label = accessLabel(access).label;
    const locationTitle = locationPath ? await getLocationTitle(locationPath, settings) : undefined;

    const summary: DashboardSummary = {
      connection: {
        linked: credential.connected || mock,
        connected: access.status === 'available',
        status: access.status,
        label: credential.connected || mock ? label : 'Not connected',
        detail: credential.connected || mock ? access.message : 'No Google account is linked yet.',
        lastSuccessAt: access.lastSuccessAt,
        locationTitle,
        locationPath,
      },
      access,
      reviewsSource,
      reviewsFetchedAt,
      reviewsNote,
      newReviews: countRecent(reviews),
      unansweredReviews: reviews.filter((r) => !r.existingReply).length,
      pendingDrafts: drafts.filter((d) => d.status === 'draft_pending').length,
      approvedDrafts: drafts.filter((d) => d.status === 'approved').length,
      scheduledPosts: posts.filter((p) => p.status === 'scheduled').length,
      publishedPosts: posts.filter((p) => p.status === 'published').length,
      averageRating,
      totalReviews: totalReviews || reviews.length,
      automation: {
        enabled: settings.autoGenerateDrafts,
        lastRuns: runs.slice(0, 8),
        latestByTask: lastRuns,
      },
      warnings: [...configWarnings(credential.connected), ...(credential.connected ? accessWarnings(access) : [])],
      // Already fetched above — no additional Google request.
      recentReviews: [...reviews]
        .sort((a, b) => b.createTime.localeCompare(a.createTime))
        .slice(0, 3),
    };

    return ok(summary);
  });
}

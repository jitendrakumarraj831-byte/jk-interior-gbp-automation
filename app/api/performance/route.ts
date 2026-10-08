/**
 * Business Profile Performance API.
 *
 * Only the metrics Google's DailyMetric enum actually defines are requested and
 * returned — nothing is derived or invented. A successful Google response is
 * labelled `source: 'google'` (live). When Google cannot answer, the last good
 * snapshot FOR THE SAME RANGE AND LOCATION is returned, labelled `source:
 * 'cache'` together with when it was fetched and why — it is never presented as
 * live — or the real error status is surfaced when there is nothing to show.
 */

import { resolveTarget, type ResolvedTarget } from '@/lib/connection';
import { AppError } from '@/lib/errors';
import { DEFAULT_METRICS, fetchPerformance } from '@/lib/google-business';
import { getCachedPerformance, setCachedPerformance } from '@/lib/repository';
import { assertAdmin, failure, handleRoute, ok } from '@/lib/security';
import type { PerformanceSnapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export type PerformancePayload = {
  snapshot: PerformanceSnapshot;
  /** 'google' = fetched from Google just now. 'cache' = an earlier snapshot. */
  source: 'google' | 'cache';
  /** When the snapshot was fetched from Google. */
  fetchedAt: string;
  /** Why live data was unavailable. Present only when source is 'cache'. */
  cacheReason?: string;
};

/** The ranges the dashboard offers, plus anything Google supports up to ~18 months. */
const MIN_DAYS = 1;
const MAX_DAYS = 540;

export async function GET(request: Request) {
  return handleRoute('performance', async () => {
    assertAdmin(request);

    const raw = Number(new URL(request.url).searchParams.get('days') ?? '30');
    const days = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), MIN_DAYS), MAX_DAYS) : 30;

    let target: ResolvedTarget | null = null;
    try {
      target = await resolveTarget();
      const snapshot = await fetchPerformance(target.locationName, {
        days,
        metrics: DEFAULT_METRICS,
      });
      await setCachedPerformance(snapshot, days);
      const payload: PerformancePayload = { snapshot, source: 'google', fetchedAt: snapshot.fetchedAt };
      return ok(payload, `Live from Google — the last ${days} days.`);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;

      const cached = await getCachedPerformance(days, target?.locationName);
      if (cached) {
        const payload: PerformancePayload = {
          snapshot: cached,
          source: 'cache',
          fetchedAt: cached.fetchedAt,
          cacheReason: error.message,
        };
        return ok(
          payload,
          `Google could not be reached for fresh data, so this is the snapshot from ${cached.fetchedAt}. ${error.message}`,
        );
      }
      return failure(error);
    }
  });
}

/**
 * Business Profile Performance API.
 *
 * Only the metrics Google's DailyMetric enum actually defines are requested and
 * returned — nothing is derived or invented. When the API is unavailable the
 * last successful snapshot is returned, labelled as cached, or the real error
 * status is surfaced.
 */

import { resolveTarget } from '@/lib/connection';
import { AppError, isApprovalPending } from '@/lib/errors';
import { DEFAULT_METRICS, fetchPerformance } from '@/lib/google-business';
import { getCachedPerformance, setCachedPerformance } from '@/lib/repository';
import { assertAdmin, failure, handleRoute, ok } from '@/lib/security';
import type { PerformanceSnapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export type PerformancePayload = {
  snapshot: PerformanceSnapshot;
  source: 'google' | 'cache';
};

export async function GET(request: Request) {
  return handleRoute('performance', async () => {
    assertAdmin(request);

    const daysParam = Number(new URL(request.url).searchParams.get('days') ?? '30');
    const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 7), 540) : 30;

    try {
      const target = await resolveTarget();
      const snapshot = await fetchPerformance(target.locationName, {
        days,
        metrics: DEFAULT_METRICS,
      });
      await setCachedPerformance(snapshot);
      const payload: PerformancePayload = { snapshot, source: 'google' };
      return ok(payload, `Performance for the last ${days} days.`);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;

      const cached = await getCachedPerformance();
      if (cached) {
        const payload: PerformancePayload = { snapshot: cached, source: 'cache' };
        return ok(
          payload,
          isApprovalPending(error.code)
            ? 'Google Business Profile API approval pending — showing the last synced snapshot.'
            : `Live fetch failed (${error.message}) — showing the last synced snapshot.`,
        );
      }
      return failure(error);
    }
  });
}

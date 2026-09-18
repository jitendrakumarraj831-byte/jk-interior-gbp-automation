/**
 * Shared plumbing for cron endpoints.
 *
 * Every cron route goes through `cronRoute`, which authenticates before doing
 * any work. An unauthenticated caller gets 401 and no side effects.
 */

import { NextResponse } from 'next/server';

import { log } from './logger';
import { assertCronAuthorized, handleRoute, ok } from './security';
import type { AutomationRun } from './types';

export function cronRoute(
  scope: string,
  tasks: () => Promise<AutomationRun[]>,
): (request: Request) => Promise<NextResponse> {
  return async (request: Request) =>
    handleRoute(scope, async () => {
      assertCronAuthorized(request);

      const started = Date.now();
      const runs = await tasks();
      const failures = runs.filter((r) => !r.ok);

      log.info(scope, `Cron finished in ${Date.now() - started}ms`, {
        tasks: runs.map((r) => r.task),
        failures: failures.length,
      });

      return ok(
        { runs, ok: failures.length === 0, durationMs: Date.now() - started },
        failures.length === 0
          ? 'All cron tasks completed.'
          : `${failures.length} of ${runs.length} cron task(s) reported a problem.`,
      );
    });
}

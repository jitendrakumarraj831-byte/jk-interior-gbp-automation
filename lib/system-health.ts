/**
 * System Health Center.
 *
 * Aggregates the status this app already tracks elsewhere — OAuth, GBP API
 * access, each AI provider, durable storage, cron, notifications — into one
 * read-only report. Nothing here makes a new Google call: it reads the same
 * cached state the rest of the dashboard uses, so opening this page never
 * costs quota.
 */

import { PROVIDER_NAMES } from './ai/types';
import { readHealth } from './ai/health';
import {
  aiProviderOrder,
  env,
  isAiConfigured,
  isCronConfigured,
  isDurableStoreConfigured,
  isOAuthConfigured,
} from './config';
import { describeAccess, readAccess, statusFromErrorCode } from './gbp-access';
import { getRefreshToken } from './google-auth';
import { lastRunOf } from './repository';
import type { AppErrorCode } from './errors';
import type { AutomationRun, AutomationRunName, HealthCheck, HealthStatus, SystemHealthReport } from './types';

const PROVIDER_LABEL: Record<string, string> = { groq: 'Groq', gemini: 'Gemini', openai: 'OpenAI' };

function check(id: string, label: string, status: HealthStatus, detail: string): HealthCheck {
  return { id, label, status, detail, checkedAt: new Date().toISOString() };
}

async function oauthCheck(): Promise<HealthCheck> {
  if (!isOAuthConfigured()) {
    return check(
      'google_oauth',
      'Google OAuth',
      'not_configured',
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or GOOGLE_REDIRECT_URI is missing.',
    );
  }
  const refreshToken = await getRefreshToken().catch(() => null);
  if (!refreshToken) {
    return check(
      'google_oauth',
      'Google OAuth',
      'pending',
      'OAuth client is configured but no Google account has connected yet.',
    );
  }
  return check('google_oauth', 'Google OAuth', 'healthy', 'A Google account is connected.');
}

async function gbpApiCheck(): Promise<HealthCheck> {
  const record = await readAccess();
  const statusMap: Record<string, HealthStatus> = {
    unknown: 'pending',
    available: 'healthy',
    pending: 'pending',
    rate_limited: 'rate_limited',
    auth_error: 'error',
    permission_error: 'error',
    error: 'error',
  };
  return check(
    'gbp_api',
    'Business Profile API',
    statusMap[record.status] ?? 'error',
    describeAccess(record.status),
  );
}

async function aiProviderChecks(): Promise<HealthCheck[]> {
  const health = await readHealth();
  const order = aiProviderOrder();
  const e = env();
  const keyFor: Record<string, string> = { groq: e.GROQ_API_KEY, gemini: e.GEMINI_API_KEY, openai: e.OPENAI_API_KEY };

  return PROVIDER_NAMES.map((name) => {
    const configured = Boolean(keyFor[name]);
    const providerHealth = health[name];
    let status: HealthStatus = 'not_configured';
    let detail = 'No API key configured.';
    if (configured) {
      if (providerHealth?.status === 'failing') {
        status = 'error';
        detail = `Last request failed (${providerHealth.failureReason ?? 'unknown reason'}).`;
      } else {
        status = 'configured';
        detail = order.includes(name)
          ? `In the routing order${order[0] === name ? ' as primary' : ' as a fallback'}.`
          : 'Configured but not in AI_PROVIDER_ORDER.';
      }
    }
    return check(`ai_${name}`, PROVIDER_LABEL[name] ?? name, status, detail);
  });
}

function aiRouterCheck(): HealthCheck {
  if (!isAiConfigured()) {
    return check('ai_router', 'AI Router', 'not_configured', 'No provider has an API key set.');
  }
  return check(
    'ai_router',
    'AI Router',
    'healthy',
    `Ready — tries ${aiProviderOrder().map((n) => PROVIDER_LABEL[n] ?? n).join(' → ')}.`,
  );
}

function storageCheck(): HealthCheck {
  return isDurableStoreConfigured()
    ? check('storage', 'Upstash Storage', 'healthy', 'Durable storage is connected.')
    : check(
        'storage',
        'Upstash Storage',
        'not_configured',
        'UPSTASH_REDIS_REST_URL/TOKEN not set — data lives in memory only and is lost on cold start.',
      );
}

/**
 * True only for a genuine fault — never for Google's expected pending/
 * rate-limited response.
 *
 * `run.ok` should already be enough (lib/tasks.ts now reports pending/
 * rate-limited responses as `ok:true`), but this re-derives the answer from
 * the run's own classified error code as a second, independent check. That
 * matters for a run recorded by an older build (before that classification
 * existed) that is still the most recent entry for its task: without this,
 * such a stale `ok:false` record would keep reporting "Automation / Cron =
 * error" for a condition that was never a real failure, until the next
 * cron firing happens to overwrite it — which, on a job that runs once or
 * twice a day, can be many hours away. Re-deriving from `details.code`
 * fixes the *calculation* so it is correct immediately, rather than waiting
 * for stale data to age out.
 */
function isGenuineFailure(run: AutomationRun): boolean {
  if (run.ok) return false;
  const code = run.details?.code;
  if (typeof code !== 'string') return true;
  const status = statusFromErrorCode(code as AppErrorCode);
  return status !== 'pending' && status !== 'rate_limited';
}

async function cronCheck(): Promise<HealthCheck> {
  if (!isCronConfigured()) {
    return check('cron', 'Automation / Cron', 'not_configured', 'CRON_SECRET is not set.');
  }
  const tasks: AutomationRunName[] = [
    'sync-reviews',
    'generate-drafts',
    'publish-posts',
    'publish-replies',
    'sync-performance',
  ];
  const runs = await Promise.all(tasks.map((t) => lastRunOf(t)));
  const recent = runs.filter((r): r is NonNullable<typeof r> => r != null);
  if (recent.length === 0) {
    return check('cron', 'Automation / Cron', 'configured', 'Authenticated, but no job has run yet.');
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const stale = recent.every((r) => Date.now() - new Date(r.startedAt).getTime() > 2 * dayMs);
  // lastRunOf() already returns each task's most recent run, so an old
  // failure followed by a newer healthy/skipped run never counts here.
  const failed = recent.filter((r) => isGenuineFailure(r));
  if (stale) {
    return check('cron', 'Automation / Cron', 'error', 'No job has run in over 48 hours.');
  }
  return check(
    'cron',
    'Automation / Cron',
    failed.length > 0 ? 'error' : 'healthy',
    failed.length > 0
      ? failed.map((r) => `${r.task}: ${r.summary}`).join(' | ')
      : 'Jobs are running on schedule.',
  );
}

function notificationsCheck(): HealthCheck {
  // Part 16 of the upgrade brief: real-time GBP push notifications need Google
  // Cloud Pub/Sub, which is not wired up. Say so plainly rather than pretend.
  return check(
    'notifications',
    'Real-time Notifications',
    'not_configured',
    'Notifications not configured — Google Business Profile Pub/Sub push has not been set up. In-app notifications (reviews, drafts, posts) still work from scheduled sync.',
  );
}

export async function buildSystemHealthReport(): Promise<SystemHealthReport> {
  const [oauth, gbpApi, aiProviders, cron] = await Promise.all([
    oauthCheck(),
    gbpApiCheck(),
    aiProviderChecks(),
    cronCheck(),
  ]);

  const checks: HealthCheck[] = [
    oauth,
    gbpApi,
    aiRouterCheck(),
    ...aiProviders,
    storageCheck(),
    cron,
    notificationsCheck(),
  ];

  return { checks, generatedAt: new Date().toISOString() };
}

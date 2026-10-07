/**
 * Business Profile access status — pure types, labels and derivation.
 *
 * No server imports on purpose: the dashboard (client) and the API routes
 * (server) must describe the same state with the same words. Persistence lives
 * in lib/gbp-access.ts; this file only knows how to read a set of per-service
 * results and say what they add up to.
 *
 * The one rule everything here exists to protect:
 *
 *   A successful authenticated Google response is proof that access works, and
 *   no older "pending" result may ever outweigh it.
 */

import type { AppErrorCode } from './errors';

export type GbpAccessStatus =
  | 'unknown' // never probed
  | 'available' // Google answered — access is live
  | 'pending' // quota limit 0 / not approved — approval still under review
  | 'rate_limited' // temporary throttle, not an access problem
  | 'auth_error' // credentials rejected or revoked — reconnect
  | 'permission_error' // account cannot manage the profile, or the API is switched off
  | 'error'; // anything else (Google outage, network)

/**
 * Google exposes Business Profile as several separate APIs, each with its own
 * quota and its own approval/enablement state, so each is tracked on its own.
 */
export type GbpService = 'accounts' | 'locations' | 'reviews' | 'posts' | 'performance';

export const GBP_SERVICES: readonly GbpService[] = [
  'accounts',
  'locations',
  'reviews',
  'posts',
  'performance',
];

export const GBP_SERVICE_LABEL: Record<GbpService, string> = {
  accounts: 'Accounts',
  locations: 'Locations',
  reviews: 'Reviews',
  posts: 'Posts',
  performance: 'Performance',
};

/** What one API last did. */
export type ServiceAccess = {
  service: GbpService;
  status: GbpAccessStatus;
  /** When this API was last exercised, success or failure. */
  checkedAt: string;
  /** When this API last answered successfully. Survives later failures. */
  lastSuccessAt?: string;
  /** Machine-readable reason for a non-available status. Never a Google payload. */
  lastCode?: AppErrorCode;
};

/** A credential-level failure, shared by every API. */
export type AuthFailure = { checkedAt: string; code: AppErrorCode };

/** The single, consistent answer every screen reads. */
export type GbpAccessSnapshot = {
  /** Overall status. 'available' as soon as ANY API has answered successfully. */
  status: GbpAccessStatus;
  /** Plain-language explanation. Contains no secret and no raw Google text. */
  message: string;
  /** Last time any API was exercised. */
  checkedAt: string | null;
  /** Last time Google answered a request successfully. */
  lastSuccessAt: string | null;
  /** The code behind a non-available overall status. */
  lastCode?: AppErrorCode;
  /** Every API that has been exercised at least once. */
  services: ServiceAccess[];
  /** APIs that are not available while the overall status is — shown as a note. */
  degraded: ServiceAccess[];
};

export const ACCESS_LABEL: Record<
  GbpAccessStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  available: { label: 'Connected & Active', tone: 'success' },
  pending: { label: 'Approval pending', tone: 'warning' },
  rate_limited: { label: 'Rate limited', tone: 'warning' },
  auth_error: { label: 'Reconnect needed', tone: 'danger' },
  permission_error: { label: 'Needs attention', tone: 'danger' },
  error: { label: 'Connection problem', tone: 'danger' },
  unknown: { label: 'Not checked yet', tone: 'neutral' },
};

/** Human-readable summary for the UI. Contains no secret and no raw error. */
export function describeAccess(status: GbpAccessStatus, code?: AppErrorCode): string {
  switch (status) {
    case 'available':
      return 'Connected and active — Google is answering Business Profile requests.';
    case 'pending':
      return 'Google account is connected. Google Business Profile API access is still pending approval.';
    case 'rate_limited':
      return 'Google is rate limiting requests right now. This is temporary — no action needed.';
    case 'auth_error':
      return 'Google rejected the saved sign-in. Reconnect the Google account.';
    case 'permission_error':
      return code === 'GBP_API_NOT_ENABLED'
        ? 'The Business Profile APIs are switched off for this Google Cloud project. Enable them in Google Cloud Console, then check access again.'
        : 'The connected Google account does not manage this Business Profile.';
    case 'error':
      return 'Google returned an unexpected error. This is usually temporary.';
    default:
      return 'Business Profile API access has not been checked yet.';
  }
}

/** Maps an application error code onto an access status. */
export function statusFromErrorCode(code: AppErrorCode): GbpAccessStatus {
  switch (code) {
    case 'GBP_QUOTA_EXCEEDED':
      return 'pending';
    case 'GBP_RATE_LIMITED':
      return 'rate_limited';
    case 'GOOGLE_AUTH_FAILED':
      return 'auth_error';
    case 'GBP_FORBIDDEN':
    case 'GBP_API_NOT_ENABLED':
      return 'permission_error';
    default:
      return 'error';
  }
}

/**
 * Order used to pick ONE status when no API is available. Actionable problems
 * outrank waiting states, which outrank temporary ones.
 */
const SEVERITY: GbpAccessStatus[] = [
  'permission_error',
  'pending',
  'rate_limited',
  'error',
  'unknown',
];

/**
 * Collapses per-API results (and any credential failure) into one snapshot.
 *
 *  1. A credential failure that is newer than every success wins: nothing can
 *     work until the account is reconnected.
 *  2. Otherwise ANY available API means access is proven → 'available'. An old
 *     or sibling "pending" never overrides it.
 *  3. Otherwise the most actionable failure is reported.
 */
export function deriveSnapshot(
  services: ServiceAccess[],
  authFailure: AuthFailure | null,
): GbpAccessSnapshot {
  const checkedAt = latest([
    ...services.map((s) => s.checkedAt),
    ...(authFailure ? [authFailure.checkedAt] : []),
  ]);
  const lastSuccessAt = latest(services.map((s) => s.lastSuccessAt));

  let status: GbpAccessStatus;
  let lastCode: AppErrorCode | undefined;

  const authIsCurrent =
    authFailure !== null &&
    (lastSuccessAt === null || Date.parse(authFailure.checkedAt) > Date.parse(lastSuccessAt));

  if (authIsCurrent && authFailure) {
    status = 'auth_error';
    lastCode = authFailure.code;
  } else if (services.some((s) => s.status === 'available')) {
    status = 'available';
  } else if (services.length === 0) {
    status = 'unknown';
  } else {
    const worst = [...services].sort(
      (a, b) => SEVERITY.indexOf(a.status) - SEVERITY.indexOf(b.status),
    )[0]!;
    status = worst.status;
    lastCode = worst.lastCode;
  }

  return {
    status,
    message: describeAccess(status, lastCode),
    checkedAt,
    lastSuccessAt,
    lastCode,
    services,
    degraded: status === 'available' ? services.filter((s) => s.status !== 'available') : [],
  };
}

function latest(values: (string | undefined | null)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}

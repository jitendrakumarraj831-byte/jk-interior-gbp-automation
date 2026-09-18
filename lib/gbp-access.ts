/**
 * Google Business Profile API access state.
 *
 * While the access request is under review the project sits at 0 requests per
 * minute, so every GBP call fails with 403 — even though OAuth itself is
 * perfectly healthy. Conflating the two is what makes a connected account look
 * disconnected, so this module tracks API access as its own thing.
 *
 * The state is cached through the existing store (durable with Upstash,
 * in-memory otherwise — no second database) with a cooldown, so cron does not
 * hammer an endpoint that is known to be closed.
 */

import type { AppErrorCode } from './errors';
import { log } from './logger';
import { getStore, nsKey } from './store';

export type GbpAccessStatus =
  | 'unknown' // never probed
  | 'available' // Google answered — access is live
  | 'pending' // 403 / 0 QPM — approval still under review
  | 'rate_limited' // 429 — temporary throttle, not an access problem
  | 'auth_error' // credentials rejected or revoked
  | 'permission_error' // account cannot manage this profile
  | 'error'; // anything else

export type GbpAccessRecord = {
  status: GbpAccessStatus;
  checkedAt: string;
  /** Machine-readable last error code. Never a raw Google payload. */
  lastCode?: AppErrorCode;
};

const ACCESS_KEY = nsKey('gbp', 'access');

/**
 * How long a known-pending result is trusted before Google is asked again.
 * Six hours keeps the twice-daily crons from retrying a closed endpoint while
 * still noticing approval on the same day it lands.
 */
export const ACCESS_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Maps an application error code onto an access status. */
export function statusFromErrorCode(code: AppErrorCode): GbpAccessStatus {
  switch (code) {
    case 'GBP_API_NOT_ENABLED':
    case 'GBP_QUOTA_EXCEEDED':
      return 'pending';
    case 'GBP_RATE_LIMITED':
      return 'rate_limited';
    case 'GOOGLE_AUTH_FAILED':
      return 'auth_error';
    case 'GBP_FORBIDDEN':
      return 'permission_error';
    default:
      return 'error';
  }
}

export async function readAccess(): Promise<GbpAccessRecord> {
  try {
    const stored = await getStore().get<GbpAccessRecord>(ACCESS_KEY);
    if (stored) return stored;
  } catch {
    /* diagnostic only — never fail a request because the store is down */
  }
  return { status: 'unknown', checkedAt: new Date(0).toISOString() };
}

async function write(record: GbpAccessRecord): Promise<void> {
  try {
    await getStore().set(ACCESS_KEY, record);
  } catch {
    /* best effort */
  }
}

/** Records that Google answered normally. */
export async function recordAccessAvailable(): Promise<void> {
  const previous = await readAccess();
  if (previous.status !== 'available') {
    log.info('gbp-access', 'Business Profile API access is now available.');
  }
  await write({ status: 'available', checkedAt: new Date().toISOString() });
}

/** Records a failure, classified. Never stores a Google payload. */
export async function recordAccessFailure(code: AppErrorCode): Promise<GbpAccessStatus> {
  const status = statusFromErrorCode(code);
  await write({ status, checkedAt: new Date().toISOString(), lastCode: code });
  return status;
}

/**
 * True when GBP calls should be skipped for now.
 *
 * Only a *pending* result suppresses calls, and only inside the cooldown. A
 * transient rate limit or a one-off error is never cached into a skip, and the
 * cooldown always expires so approval is picked up automatically.
 */
export async function shouldSkipGoogleCalls(now = Date.now()): Promise<boolean> {
  const record = await readAccess();
  if (record.status !== 'pending') return false;
  const age = now - new Date(record.checkedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < ACCESS_COOLDOWN_MS;
}

/** Human-readable summary for the UI. Contains no secret and no raw error. */
export function describeAccess(status: GbpAccessStatus): string {
  switch (status) {
    case 'available':
      return 'Business Profile API access is active.';
    case 'pending':
      return 'Google account is connected. Google Business Profile API access is still pending approval.';
    case 'rate_limited':
      return 'Google is rate limiting requests right now. This is temporary — no action needed.';
    case 'auth_error':
      return 'Google rejected the stored credentials. Reconnect the Google account.';
    case 'permission_error':
      return 'The connected Google account does not manage this Business Profile.';
    case 'error':
      return 'Google returned an unexpected error. This is usually temporary.';
    default:
      return 'Business Profile API access has not been checked yet.';
  }
}

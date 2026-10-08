/**
 * Google Business Profile API access state — persistence and recording.
 *
 * Google splits Business Profile into several APIs (accounts, locations,
 * reviews/posts, performance), each with its own quota and approval state. A
 * project can therefore be approved for one before another, and OAuth itself
 * can be perfectly healthy while any of them answers 403/429. This module keeps
 * the last result of EACH API plus any credential failure, in the shared store
 * (durable with Upstash, in-memory otherwise), and derives one snapshot from
 * them (see lib/gbp-status.ts).
 *
 * Where results come from: every Google call goes through googleFetch in
 * lib/google-business.ts, which records success or failure here. That is the
 * single place state is written, so a call made by ANY route, page or cron job
 * keeps the state honest — nothing depends on one particular probe having run.
 *
 * Two guarantees:
 *  - A success is written immediately and outweighs every older failure.
 *  - A cached "pending" can only suppress calls for a short cooldown, and only
 *    while no other API has succeeded since. It can never hide proof of access.
 */

import { AppError, type AppErrorCode } from './errors';
import {
  deriveSnapshot,
  GBP_SERVICES,
  statusFromErrorCode,
  type AuthFailure,
  type GbpAccessSnapshot,
  type GbpService,
  type ServiceAccess,
} from './gbp-status';
import { log } from './logger';
import { getStore, nsKey } from './store';

export {
  describeAccess,
  deriveSnapshot,
  statusFromErrorCode,
  type GbpAccessSnapshot,
  type GbpAccessStatus,
  type GbpService,
  type ServiceAccess,
} from './gbp-status';

const SERVICE_PREFIX = nsKey('gbp', 'access', 'svc');
const AUTH_KEY = nsKey('gbp', 'access', 'auth');
/** Pre-1.1 single-record key. Its stale "pending" is what used to stick forever. */
const LEGACY_KEY = nsKey('gbp', 'access');

const serviceKey = (service: GbpService) => `${SERVICE_PREFIX}:${service}`;

/**
 * How long a known "pending" result suppresses background calls to that API.
 *
 * Short on purpose. The old six-hour window is what kept a dashboard on
 * "Approval pending" long after Google had approved the project. Fifteen
 * minutes still stops page loads from hammering a closed endpoint, approval is
 * noticed within a quarter of an hour, and the explicit "Check access now"
 * action bypasses it entirely.
 */
export const ACCESS_COOLDOWN_MS = 15 * 60 * 1000;

/** A success is not re-written more often than this — keeps Redis traffic sane. */
const SUCCESS_WRITE_DEBOUNCE_MS = 30 * 1000;

/* --------------------------------- reading ------------------------------- */

/**
 * The current snapshot. Never throws: this is diagnostic state, and a store
 * outage must not fail the request that only wanted to display it.
 */
export async function readAccess(): Promise<GbpAccessSnapshot> {
  try {
    const keys = [AUTH_KEY, ...GBP_SERVICES.map(serviceKey)];
    const [auth, ...records] = await getStore().getMany<AuthFailure | ServiceAccess>(keys);
    const services = records.filter((r): r is ServiceAccess => r !== null && 'service' in r);
    return deriveSnapshot(services, (auth as AuthFailure | null) ?? null);
  } catch {
    return deriveSnapshot([], null);
  }
}

async function readService(service: GbpService): Promise<ServiceAccess | null> {
  try {
    return await getStore().get<ServiceAccess>(serviceKey(service));
  } catch {
    return null;
  }
}

/* --------------------------------- writing ------------------------------- */

/**
 * Records that an API answered normally. Immediate, and wins over any older
 * failure — including a credential failure, which a success proves is over.
 */
export async function recordServiceSuccess(service: GbpService): Promise<void> {
  try {
    const store = getStore();
    const [previous, authFailure] = await store.getMany<ServiceAccess | AuthFailure>([
      serviceKey(service),
      AUTH_KEY,
    ]);
    const record = previous && 'service' in previous ? previous : null;
    const now = new Date().toISOString();

    // A success proves the credential works, so any recorded auth failure is stale.
    if (authFailure) await store.del(AUTH_KEY);

    const recentlyConfirmed =
      !authFailure &&
      record?.status === 'available' &&
      Date.now() - Date.parse(record.checkedAt) < SUCCESS_WRITE_DEBOUNCE_MS;
    if (recentlyConfirmed) return;

    if (record?.status !== 'available') {
      log.info('gbp-access', `${service} API is now available.`, {
        was: record?.status ?? 'unknown',
      });
    }
    await store.set<ServiceAccess>(serviceKey(service), {
      service,
      status: 'available',
      checkedAt: now,
      lastSuccessAt: now,
    });
    // The legacy record is superseded; remove it so nothing can read it again.
    await store.del(LEGACY_KEY);
  } catch {
    /* best effort — never fail a Google call because the state could not be saved */
  }
}

/**
 * True for outcomes that say nothing about whether access works: a bad
 * location id (404), a conflict (409), a malformed request (400), or a failure
 * raised before Google was contacted at all. Google only reaches the former
 * checks once a call is authorised, so they must neither mark access broken nor
 * mask a real failure.
 */
export function isAccessNeutral(error: AppError): boolean {
  if (error.code === 'GBP_NOT_FOUND' || error.code === 'CONFLICT') return true;
  if (error.code === 'VALIDATION_FAILED') return true;
  // Raised before Google is ever contacted — says nothing about Google's state.
  if (error.code === 'NOT_CONNECTED' || error.code === 'OAUTH_NOT_CONFIGURED') return true;
  return error.code === 'GOOGLE_API_ERROR' && error.httpStatus === 400;
}

/** Records a classified failure. Never stores a Google payload. */
export async function recordServiceFailure(
  service: GbpService,
  error: AppError,
): Promise<void> {
  if (isAccessNeutral(error)) return;

  try {
    const now = new Date().toISOString();

    // A rejected credential is global: no API can work until it is fixed.
    if (error.code === 'GOOGLE_AUTH_FAILED') {
      await getStore().set<AuthFailure>(AUTH_KEY, { checkedAt: now, code: error.code });
      return;
    }

    const previous = await readService(service);
    await getStore().set<ServiceAccess>(serviceKey(service), {
      service,
      status: statusFromErrorCode(error.code),
      checkedAt: now,
      lastSuccessAt: previous?.lastSuccessAt,
      lastCode: error.code,
    });
  } catch {
    /* best effort */
  }
}

/** Records a credential-level failure that happened before any API was reached. */
export async function recordAuthFailure(code: AppErrorCode = 'GOOGLE_AUTH_FAILED'): Promise<void> {
  try {
    await getStore().set<AuthFailure>(AUTH_KEY, { checkedAt: new Date().toISOString(), code });
  } catch {
    /* best effort */
  }
}

/** Forgets every recorded result — used when the Google account is disconnected. */
export async function clearAccessState(): Promise<void> {
  try {
    const store = getStore();
    await Promise.all([
      store.del(AUTH_KEY),
      store.del(LEGACY_KEY),
      ...GBP_SERVICES.map((service) => store.del(serviceKey(service))),
    ]);
  } catch {
    /* best effort */
  }
}

/* -------------------------------- cooldown ------------------------------- */

/** Codes that mean "closed for now, and nothing we do will open it". */
const CLOSED_CODES: AppErrorCode[] = ['GBP_QUOTA_EXCEEDED', 'GBP_API_NOT_ENABLED'];

function isClosed(record: ServiceAccess, now: number): boolean {
  if (record.status === 'available') return false;
  if (!record.lastCode || !CLOSED_CODES.includes(record.lastCode)) return false;
  const age = now - Date.parse(record.checkedAt);
  return Number.isFinite(age) && age >= 0 && age < ACCESS_COOLDOWN_MS;
}

/**
 * True when background work should skip Google for now.
 *
 * Skips only when the relevant API(s) recently answered "closed" AND no other
 * API has succeeded since — a success anywhere is proof access is open, so the
 * gate lifts at once. Transient failures (rate limits, outages, auth) never
 * gate: skipping would hide them rather than surface them.
 *
 * Pass `service` to gate one API; omit it to gate on the whole snapshot.
 * Explicit admin actions (publish, "Check access now") never consult this.
 */
export async function shouldSkipGoogleCalls(
  options: { service?: GbpService; now?: number } = {},
): Promise<boolean> {
  const now = options.now ?? Date.now();
  const snapshot = await readAccess();

  if (snapshot.status === 'auth_error') return false;

  const succeededAfter = (checkedAt: string) =>
    snapshot.services.some(
      (s) => s.lastSuccessAt && Date.parse(s.lastSuccessAt) > Date.parse(checkedAt),
    );

  if (options.service) {
    const record = snapshot.services.find((s) => s.service === options.service);
    if (!record || !isClosed(record, now)) return false;
    return !succeededAfter(record.checkedAt);
  }

  // Whole-snapshot gate: only when nothing is available and every API that has
  // been tried is closed and still inside its cooldown.
  if (snapshot.status === 'available' || snapshot.services.length === 0) return false;
  return snapshot.services.every((s) => isClosed(s, now) && !succeededAfter(s.checkedAt));
}

/**
 * True when it is time for an automatic re-check.
 *
 * That is the case when access is not proven (once per cooldown) AND when it is
 * proven but some API is still failing: that API's last result may be hours
 * old, and an approval that lands later would otherwise leave it showing
 * "pending" until something happened to call it. Both are bounded to one check
 * per cooldown, and a fully healthy state is never re-checked.
 */
export function isCheckDue(snapshot: GbpAccessSnapshot, now = Date.now()): boolean {
  const stale = (checkedAt: string | null) =>
    !checkedAt || now - Date.parse(checkedAt) >= ACCESS_COOLDOWN_MS;

  if (snapshot.status === 'available') {
    return snapshot.degraded.length > 0 && snapshot.degraded.every((s) => stale(s.checkedAt));
  }
  return stale(snapshot.checkedAt);
}

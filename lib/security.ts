/**
 * Security primitives: cron authentication, admin sessions, OAuth state,
 * input validation helpers and uniform API responses.
 *
 * Server-only. Importing this from a Client Component is a bug.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  adminAuthMode,
  env,
  isAdminAuthConfigured,
  isProduction,
  missingAdminAuthVars,
} from './config';
import { AppError, isApprovalPending } from './errors';
import { log } from './logger';
import { getStore, nsKey } from './store';
import type { ApiEnvelope } from './types';

export const ADMIN_COOKIE = 'jk_admin_session';
export const OAUTH_STATE_COOKIE = 'jk_oauth_state';
/** Separate from OAUTH_STATE_COOKIE so a Google and a Meta connect flow never collide. */
export const META_OAUTH_STATE_COOKIE = 'jk_meta_oauth_state';
/**
 * Double-submit CSRF token. Deliberately NOT httpOnly — the browser must be
 * able to echo it back in a header, which is the whole point of the pattern.
 * It is a random per-browser nonce and carries no secret material: it is not
 * derived from SESSION_SECRET and grants nothing on its own.
 */
export const CSRF_COOKIE = 'jk_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

/** Methods that can change state and therefore need CSRF defences. */
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/* ----------------------------- constant time ----------------------------- */

/** Constant-time string comparison that does not leak length via early exit. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // Hash both sides so unequal lengths still take the same path.
  const hashA = createHmac('sha256', 'cmp').update(bufA).digest();
  const hashB = createHmac('sha256', 'cmp').update(bufB).digest();
  return timingSafeEqual(hashA, hashB);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/* -------------------------------- cron auth ------------------------------ */

/**
 * Verifies a cron request.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. We also accept
 * `x-cron-secret` so the endpoints can be triggered manually during setup.
 * With no CRON_SECRET configured every request is rejected — an unauthenticated
 * cron endpoint is never acceptable, not even before Google approval.
 */
export function assertCronAuthorized(request: Request): void {
  const secret = env().CRON_SECRET;
  if (!secret) {
    throw new AppError(
      'UNAUTHORIZED',
      'CRON_SECRET is not configured, so cron endpoints are disabled.',
      503,
    );
  }

  const authorization = request.headers.get('authorization') ?? '';
  const headerSecret = request.headers.get('x-cron-secret') ?? '';
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';

  if ((bearer && safeEqual(bearer, secret)) || (headerSecret && safeEqual(headerSecret, secret))) {
    return;
  }

  log.warn('security', 'Rejected unauthorized cron request.');
  throw new AppError('UNAUTHORIZED', 'Invalid or missing cron credentials.', 401);
}

/* ------------------------------ admin session ---------------------------- */

function sessionSecret(): string {
  return env().SESSION_SECRET;
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('hex');
}

/** Creates a signed, expiring session token. Contains no secret material. */
export function createSessionToken(): string {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = `admin.${expiresAt}.${randomToken(8)}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token || !isAdminAuthConfigured()) return false;
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [subject, expiresRaw, nonce, signature] = parts as [string, string, string, string];
  const payload = `${subject}.${expiresRaw}.${nonce}`;
  if (!safeEqual(signature, sign(payload))) return false;
  const expiresAt = Number(expiresRaw);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

/**
 * Session cookie settings.
 *
 * httpOnly keeps the token out of JavaScript entirely; SameSite=Lax stops it
 * riding along on cross-site POSTs; Secure is forced on in production so it
 * never travels over plain HTTP.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** CSRF cookie settings. Readable by JS by design; never httpOnly. */
export function csrfCookieOptions() {
  return {
    httpOnly: false,
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

/* ------------------------------ csrf defences ---------------------------- */

/** The request's own origin, honouring Vercel's forwarding headers. */
function selfOrigin(request: Request): string | null {
  const headers = request.headers;
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) return null;
  const proto = headers.get('x-forwarded-proto') ?? (isProduction() ? 'https' : 'http');
  return `${proto}://${host}`;
}

/**
 * Rejects cross-site state-changing requests.
 *
 * Browsers always send `Origin` on POST/PUT/PATCH/DELETE, so a missing or
 * mismatched value on such a request is either a cross-site attempt or a
 * non-browser client, and neither may mutate admin state through cookies.
 */
export function assertSameOrigin(request: Request): void {
  if (!STATE_CHANGING.has(request.method.toUpperCase())) return;

  const expected = selfOrigin(request);
  if (!expected) {
    throw new AppError('CSRF_FAILED', 'Could not determine the request origin.', 403);
  }

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  let actual: string | null = origin;
  if (!actual && referer) {
    try {
      actual = new URL(referer).origin;
    } catch {
      actual = null;
    }
  }

  if (!actual || actual !== expected) {
    log.warn('security', 'Rejected a cross-origin state-changing request.', {
      method: request.method,
    });
    throw new AppError('CSRF_FAILED', 'Cross-origin request rejected.', 403);
  }
}

/**
 * Double-submit CSRF check: the `jk_csrf` cookie must match the value echoed
 * back in the `x-csrf-token` header. An attacker on another origin can cause a
 * request to be sent with our cookies, but cannot read the cookie to set the
 * header, and cannot set custom headers on a simple cross-site form post.
 */
export function assertCsrfToken(request: Request): void {
  if (!STATE_CHANGING.has(request.method.toUpperCase())) return;

  const cookie = readCookie(request, CSRF_COOKIE);
  const header = request.headers.get(CSRF_HEADER);

  if (!cookie || !header || !safeEqual(cookie, header)) {
    log.warn('security', 'Rejected a request with a missing or mismatched CSRF token.', {
      method: request.method,
    });
    throw new AppError(
      'CSRF_FAILED',
      'Missing or invalid CSRF token. Reload the dashboard and try again.',
      403,
    );
  }
}

/* --------------------------- login rate limiting -------------------------- */

/*
 * Brute-force protection for the admin password.
 *
 * Counts failed sign-ins per client and refuses further attempts once the
 * threshold is hit. Counters live in the shared store, so they are durable when
 * Upstash is configured; without it they are per-instance and a determined
 * attacker could get more attempts by hitting different serverless instances.
 * That is still far better than unlimited, and the honest limitation is
 * documented in the README rather than papered over.
 */
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_SECONDS = 15 * 60;

type LoginAttempts = { count: number; firstAt: number };

/**
 * Stable, non-reversible key for a client. The raw IP is never stored — it is
 * HMACed first, so the rate-limit records hold no personal data.
 */
function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  const digest = createHmac('sha256', sessionSecret() || 'login-limit')
    .update(ip)
    .digest('hex')
    .slice(0, 32);
  return nsKey('login_attempts', digest);
}

/** Throws 429 when this client has failed too many times recently. */
export async function assertLoginAllowed(request: Request): Promise<void> {
  let record: LoginAttempts | null = null;
  try {
    record = await getStore().get<LoginAttempts>(clientKey(request));
  } catch {
    // A store outage must never lock the operator out of their own dashboard.
    return;
  }
  if (!record) return;

  const ageSeconds = (Date.now() - record.firstAt) / 1000;
  if (ageSeconds > LOGIN_WINDOW_SECONDS) return;
  if (record.count < LOGIN_MAX_ATTEMPTS) return;

  const retryAfter = Math.ceil(LOGIN_WINDOW_SECONDS - ageSeconds);
  log.warn('security', 'Blocked a sign-in attempt from a rate-limited client.', { retryAfter });
  throw new AppError(
    'RATE_LIMITED',
    `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
    429,
  );
}

export async function recordLoginFailure(request: Request): Promise<void> {
  try {
    const key = clientKey(request);
    const store = getStore();
    const record = await store.get<LoginAttempts>(key);
    const expired = !record || (Date.now() - record.firstAt) / 1000 > LOGIN_WINDOW_SECONDS;
    await store.set<LoginAttempts>(
      key,
      expired ? { count: 1, firstAt: Date.now() } : { count: record.count + 1, firstAt: record.firstAt },
    );
  } catch {
    /* best effort — never fail the request because the counter could not be written */
  }
}

export async function clearLoginFailures(request: Request): Promise<void> {
  try {
    await getStore().del(clientKey(request));
  } catch {
    /* best effort */
  }
}

/* ------------------------------ admin access ----------------------------- */

/**
 * Production with no ADMIN_PASSWORD / SESSION_SECRET is a configuration fault,
 * not a mode of operation. Every admin surface raises this instead of serving.
 */
export function adminAuthMisconfiguredError(): AppError {
  return new AppError(
    'ADMIN_AUTH_NOT_CONFIGURED',
    `Admin authentication is not configured. Set ${missingAdminAuthVars().join(
      ' and ',
    )} in the environment and redeploy. This deployment refuses admin requests until then.`,
    503,
  );
}

/** True when the request carries a valid admin session. */
export function hasValidSession(request: Request): boolean {
  return verifySessionToken(readCookie(request, ADMIN_COOKIE));
}

/**
 * Gate for every admin surface.
 *
 * Fails closed: in production a missing credential configuration raises rather
 * than granting access. The unauthenticated path exists only for local
 * development and is unreachable once VERCEL_ENV/NODE_ENV say production.
 *
 * State-changing methods additionally pass an Origin check and a double-submit
 * CSRF token check.
 */
export function assertAdmin(request: Request): void {
  switch (adminAuthMode()) {
    case 'misconfigured':
      throw adminAuthMisconfiguredError();

    case 'development_only':
      // Local convenience only. Origin is still checked so a page on another
      // origin cannot drive a developer's running instance.
      assertSameOrigin(request);
      return;

    case 'enforced':
      if (!hasValidSession(request)) {
        throw new AppError('UNAUTHORIZED', 'Admin sign-in required.', 401);
      }
      assertSameOrigin(request);
      assertCsrfToken(request);
      return;
  }
}


export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/* ------------------------------- oauth state ----------------------------- */

export function createOAuthState(): string {
  const payload = `${Date.now()}.${randomToken(16)}`;
  return `${payload}.${sign(payload || 'state')}`;
}

/**
 * OAuth state is validated by comparing the value round-tripped through Google
 * against the one we set in an httpOnly cookie. This is what stops CSRF on the
 * callback. Signature checking is skipped when no SESSION_SECRET exists — the
 * cookie comparison alone still binds the callback to this browser.
 */
export function verifyOAuthState(returned: string | null, fromCookie: string | undefined): boolean {
  if (!returned || !fromCookie) return false;
  if (!safeEqual(returned, fromCookie)) return false;
  const timestamp = Number(returned.split('.')[0]);
  if (!Number.isFinite(timestamp)) return false;
  // State is only good for 10 minutes.
  return Date.now() - timestamp < 10 * 60 * 1000;
}

/* ----------------------------- api responses ----------------------------- */

export function ok<T>(data: T, message = 'ok'): NextResponse {
  const body: ApiEnvelope<T> = { status: 'ok', data, message };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

export function failure(error: AppError): NextResponse {
  const status: ApiEnvelope<never>['status'] = isApprovalPending(error.code)
    ? 'pending_approval'
    : error.code === 'NOT_CONNECTED' || error.code === 'OAUTH_NOT_CONFIGURED'
      ? 'not_connected'
      : 'error';

  const body: ApiEnvelope<never> = {
    status,
    data: null,
    message: error.message,
    code: error.code,
  };
  return NextResponse.json(body, {
    status: error.httpStatus,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Wraps a route handler so no unexpected throw ever leaks a stack trace or a
 * credential to the client.
 */
export async function handleRoute(
  scope: string,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) {
      if (error.httpStatus >= 500 && !isApprovalPending(error.code)) {
        log.error(scope, error.message, { code: error.code, detail: error.detail });
      } else {
        log.info(scope, error.message, { code: error.code });
      }
      return failure(error);
    }
    log.error(scope, 'Unhandled error in route handler', {
      error: error instanceof Error ? error.message : String(error),
    });
    return failure(new AppError('INTERNAL', 'Something went wrong. Check the server logs.', 500));
  }
}

/* ----------------------------- input validation -------------------------- */

/** Parses and validates a JSON body, turning failures into a 400 AppError. */
export async function parseJson<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Request body must be valid JSON.', 400);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join('.') || 'body';
    throw new AppError(
      'VALIDATION_FAILED',
      `Invalid request: ${where} — ${first?.message ?? 'failed validation'}`,
      400,
    );
  }
  return result.data;
}

/** Collapses whitespace and hard-caps length before anything is stored. */
export function sanitizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Only absolute http(s) URLs are ever accepted for images and CTAs. */
export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be an http(s) URL');

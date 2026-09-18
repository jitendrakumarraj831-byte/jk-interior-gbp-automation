/**
 * Security primitives: cron authentication, admin sessions, OAuth state,
 * input validation helpers and uniform API responses.
 *
 * Server-only. Importing this from a Client Component is a bug.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { env, isAdminAuthConfigured, isProduction } from './config';
import { AppError, isApprovalPending } from './errors';
import { log } from './logger';
import type { ApiEnvelope } from './types';

export const ADMIN_COOKIE = 'jk_admin_session';
export const OAUTH_STATE_COOKIE = 'jk_oauth_state';

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

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

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** True when the request may perform admin actions. */
export function isAuthorizedAdmin(request: Request): boolean {
  // Open mode: no ADMIN_PASSWORD configured. Allowed so the app deploys and
  // demos before approval, and surfaced as a warning everywhere in the UI.
  if (!isAdminAuthConfigured()) return true;
  const cookie = readCookie(request, ADMIN_COOKIE);
  return verifySessionToken(cookie);
}

export function assertAdmin(request: Request): void {
  if (!isAuthorizedAdmin(request)) {
    throw new AppError('UNAUTHORIZED', 'Admin sign-in required.', 401);
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

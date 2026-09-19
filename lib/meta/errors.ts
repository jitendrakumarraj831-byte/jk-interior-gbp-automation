/**
 * Classifies Meta Graph API error responses into our AppError taxonomy.
 *
 * Graph API errors share one shape: `{ error: { message, type, code,
 * error_subcode, fbtrace_id } }`. The numeric `code`/`error_subcode` are the
 * only stable thing to switch on — `message` text changes across API versions
 * and locales.
 *
 * References (see docs/META_SOCIAL_AUTOMATION.md for the full citation list):
 *  - code 190           OAuthException — token invalid/expired/revoked
 *  - code 200 / 10       permission denied — the granted scope does not cover this call
 *  - code 4 / 17 / 32 / 613   application/user rate limiting
 *  - code 9              Instagram content-publishing daily limit reached
 */

import { AppError, type AppErrorCode } from '../errors';

export type MetaGraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

const TOKEN_EXPIRED_SUBCODES = new Set([458, 459, 460, 463, 467]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 9]);

export function classifyMetaError(httpStatus: number, body: unknown): AppError {
  const parsed = (typeof body === 'object' && body !== null ? body : {}) as MetaGraphErrorBody;
  const err = parsed.error;
  const code = err?.code;
  const subcode = err?.error_subcode;
  const message = err?.message ?? `Meta Graph API request failed (HTTP ${httpStatus}).`;

  if (code === 190 || httpStatus === 401) {
    const isExpired = subcode !== undefined && TOKEN_EXPIRED_SUBCODES.has(subcode);
    return new AppError(
      'META_TOKEN_EXPIRED',
      isExpired
        ? 'The Meta access token has expired or was revoked. Reconnect Facebook/Instagram.'
        : `Meta rejected the stored credentials: ${message}`,
      401,
      err?.fbtrace_id,
    );
  }

  if (code === 200 || code === 10 || httpStatus === 403) {
    return new AppError(
      'META_PERMISSION_ERROR',
      `Meta denied this request — a required permission may be missing or not yet approved: ${message}`,
      403,
      err?.fbtrace_id,
    );
  }

  if ((code !== undefined && RATE_LIMIT_CODES.has(code)) || httpStatus === 429) {
    return new AppError(
      'META_RATE_LIMITED',
      code === 9
        ? 'Instagram publishing limit reached for the current 24-hour window. This is temporary.'
        : 'Meta is rate limiting requests right now. This is temporary.',
      503,
      err?.fbtrace_id,
    );
  }

  return new AppError(
    'META_API_ERROR',
    `Meta Graph API request failed: ${message}`,
    httpStatus >= 500 ? 502 : 400,
    err?.fbtrace_id,
  );
}

/** True when the failure is an expected, temporary condition rather than a genuine fault. */
export function isMetaTransient(code: AppErrorCode): boolean {
  return code === 'META_RATE_LIMITED';
}

/** Error taxonomy shared by the Google client, the API routes and the UI. */

import { GOOGLE_API_TITLES } from './gbp-status';

export type AppErrorCode =
  | 'OAUTH_NOT_CONFIGURED'
  | 'NOT_CONNECTED'
  | 'GBP_API_NOT_ENABLED'
  | 'GBP_QUOTA_EXCEEDED'
  | 'GBP_RATE_LIMITED'
  | 'GBP_FORBIDDEN'
  | 'GBP_NOT_FOUND'
  | 'GOOGLE_AUTH_FAILED'
  | 'GOOGLE_API_ERROR'
  | 'AI_NOT_CONFIGURED'
  | 'AI_FAILED'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'ADMIN_AUTH_NOT_CONFIGURED'
  | 'CSRF_FAILED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STORE_ERROR'
  | 'INTERNAL'
  // --- Meta (Facebook/Instagram) social automation ---
  | 'META_NOT_CONFIGURED'
  | 'META_ENCRYPTION_NOT_CONFIGURED'
  | 'META_NOT_CONNECTED'
  | 'META_AUTH_FAILED'
  | 'META_TOKEN_DECRYPT_FAILED'
  | 'META_TOKEN_EXPIRED'
  | 'META_PERMISSION_ERROR'
  | 'META_RATE_LIMITED'
  | 'META_API_ERROR'
  | 'META_DUPLICATE_CONTENT'
  | 'META_MEDIA_INVALID'
  | 'MEDIA_STORAGE_NOT_CONFIGURED';

/** Structured facts about a disabled Google API. Identifiers only — never a credential. */
export type DisabledApiInfo = { service?: string; project?: string };

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  /** Extra context that is safe to show — never raw credentials. */
  readonly detail?: string;
  /** Which API Google says is switched off, and for which Cloud project. */
  readonly disabledApi?: DisabledApiInfo;

  constructor(
    code: AppErrorCode,
    message: string,
    httpStatus = 500,
    detail?: string,
    disabledApi?: DisabledApiInfo,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail;
    this.disabledApi = disabledApi;
  }
}

/** What we can read out of a Google error body without ever echoing it. */
type GoogleErrorInfo = {
  /** Lower-cased machine reasons, e.g. "service_disabled", "rate_limit_exceeded". */
  reasons: string[];
  /** Lower-cased human message. Used for matching only — never shown to a user. */
  message: string;
  /** Google's quota_limit_value, when the body carries one. "0" means no access yet. */
  quotaLimitValue?: string;
  /** For a disabled API: its service id, e.g. "mybusiness.googleapis.com". Validated. */
  service?: string;
  /** For a disabled API: the Cloud project NUMBER Google refers to. Digits only. */
  project?: string;
};

/** Only a bare Google API host is ever kept — never free text from the payload. */
const GOOGLE_SERVICE_ID = /^[a-z][a-z0-9-]*\.googleapis\.com$/;

/** The service id Google names in a disabled-API error, when it is a well-formed one. */
function disabledServiceOf(
  details: { metadata?: Record<string, unknown> }[],
  message: string,
): string | undefined {
  for (const detail of details) {
    const candidate = detail?.metadata?.service;
    if (typeof candidate === 'string' && GOOGLE_SERVICE_ID.test(candidate.toLowerCase())) {
      return candidate.toLowerCase();
    }
  }
  // The human message carries the activation URL, which contains the same id.
  const fromMessage = /\/apis\/api\/([a-z][a-z0-9-]*\.googleapis\.com)\b/.exec(message);
  return fromMessage?.[1];
}

/**
 * The Cloud project number Google says the API is disabled for. This is what
 * lets the owner see that the API was enabled in a DIFFERENT project from the
 * one the OAuth client belongs to — the commonest reason it "stays" disabled.
 * A project number is an identifier (it is in every Console URL), not a secret.
 */
function disabledProjectOf(
  details: { metadata?: Record<string, unknown> }[],
  message: string,
): string | undefined {
  for (const detail of details) {
    const consumer = detail?.metadata?.consumer;
    const fromConsumer = typeof consumer === 'string' ? /^projects\/(\d{4,20})$/.exec(consumer) : null;
    if (fromConsumer) return fromConsumer[1];
    const container = detail?.metadata?.containerInfo;
    if (typeof container === 'string' && /^\d{4,20}$/.test(container)) return container;
  }
  return (/in project (\d{4,20})\b/.exec(message) ?? /[?&]project=(\d{4,20})\b/.exec(message))?.[1];
}

/** "Google My Business API (mybusiness.googleapis.com)" — what to search for in the Library. */
function describeService(service: string): string {
  const title = GOOGLE_API_TITLES[service];
  return title ? `${title} (${service})` : service;
}

function inspectGoogleError(body: unknown): GoogleErrorInfo {
  if (typeof body === 'string') return { reasons: [], message: body.toLowerCase() };
  const root = (body as { error?: unknown } | null)?.error;
  if (typeof root === 'string') return { reasons: [], message: root.toLowerCase() };
  if (typeof root !== 'object' || root === null) return { reasons: [], message: '' };

  const error = root as {
    message?: unknown;
    status?: unknown;
    errors?: { reason?: unknown }[];
    details?: { reason?: unknown; metadata?: Record<string, unknown> }[];
  };

  const reasons: string[] = [];
  let quotaLimitValue: string | undefined;
  if (typeof error.status === 'string') reasons.push(error.status.toLowerCase());
  for (const entry of error.errors ?? []) {
    if (typeof entry?.reason === 'string') reasons.push(entry.reason.toLowerCase());
  }
  for (const detail of error.details ?? []) {
    if (typeof detail?.reason === 'string') reasons.push(detail.reason.toLowerCase());
    const limit = detail?.metadata?.quota_limit_value;
    if (typeof limit === 'string' || typeof limit === 'number') quotaLimitValue = String(limit);
  }

  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return {
    reasons,
    message,
    quotaLimitValue,
    service: disabledServiceOf(error.details ?? [], message),
    project: disabledProjectOf(error.details ?? [], message),
  };
}

const hasReason = (info: GoogleErrorInfo, ...wanted: string[]) =>
  info.reasons.some((reason) => wanted.includes(reason));

const mentions = (info: GoogleErrorInfo, ...fragments: string[]) =>
  fragments.some((fragment) => info.message.includes(fragment));

/**
 * Quota failures come in two very different flavours that must never be
 * confused: a limit of ZERO means Google has not opened Business Profile API
 * access for the project yet (approval pending), while any other limit is an
 * ordinary, temporary throttle.
 */
function quotaError(info: GoogleErrorInfo): AppError {
  if (info.quotaLimitValue === '0' || mentions(info, 'limit: 0', 'limit 0', "limit of '0'")) {
    return new AppError(
      'GBP_QUOTA_EXCEEDED',
      'Your Google account is connected, but Google has not opened this part of the Business Profile API for your project yet. It switches on by itself once Google approves the access request.',
      503,
    );
  }
  return new AppError(
    'GBP_RATE_LIMITED',
    'Google is limiting how fast data can be requested right now. This is temporary and retries automatically.',
    503,
  );
}

/**
 * Maps a Google HTTP failure onto our taxonomy. Precision matters: each code
 * drives a different message and a different next step for the business owner,
 * so a 403 is NOT automatically "approval pending".
 *
 *  401                                   → GOOGLE_AUTH_FAILED  (reconnect)
 *  403 insufficient scope                → GOOGLE_AUTH_FAILED  (reconnect, tick the box)
 *  403 API disabled on the Cloud project → GBP_API_NOT_ENABLED (enable the API)
 *  403/429 quota limit 0 / not allowlisted → GBP_QUOTA_EXCEEDED (approval pending)
 *  403/429 any other quota               → GBP_RATE_LIMITED    (temporary)
 *  403 anything else                     → GBP_FORBIDDEN       (account cannot manage it)
 *  404                                   → GBP_NOT_FOUND       (bad account/location)
 *  409                                   → CONFLICT
 *  5xx                                   → GOOGLE_API_ERROR    (Google outage)
 *
 * The raw Google payload is never put in the message; a short matched excerpt is
 * kept in `detail` for server logs only.
 */
export function classifyGoogleError(httpStatus: number, body: unknown): AppError {
  const info = inspectGoogleError(body);

  if (httpStatus === 401) {
    return new AppError(
      'GOOGLE_AUTH_FAILED',
      'Google no longer accepts the saved sign-in. Reconnect your Google account.',
      401,
    );
  }

  if (httpStatus === 403) {
    if (
      hasReason(info, 'access_token_scope_insufficient') ||
      mentions(info, 'insufficient authentication scopes', 'insufficient scope')
    ) {
      return new AppError(
        'GOOGLE_AUTH_FAILED',
        'The Google sign-in does not include Business Profile permission. Reconnect and keep the Business Profile box ticked.',
        401,
      );
    }

    if (
      hasReason(info, 'service_disabled', 'accessnotconfigured') ||
      mentions(
        info,
        'has not been used in project',
        'api has not been enabled',
        'is disabled',
        'it is disabled',
      )
    ) {
      const where = info.project ? `Google Cloud project ${info.project}` : 'this Google Cloud project';
      const what = info.service ? `The ${describeService(info.service)}` : 'A Business Profile API';
      return new AppError(
        'GBP_API_NOT_ENABLED',
        `${what} is switched off for ${where}. Enable it in ${
          info.project ? 'that same project' : 'Google Cloud Console'
        } (APIs & Services → Library), wait a few minutes, then check access again.`,
        503,
        info.service,
        { service: info.service, project: info.project },
      );
    }

    if (mentions(info, 'not allowlisted', 'not allow-listed', 'not been approved')) {
      return new AppError(
        'GBP_QUOTA_EXCEEDED',
        'Your Google account is connected, but Google has not approved this part of the Business Profile API for your project yet.',
        503,
      );
    }

    if (
      hasReason(info, 'rate_limit_exceeded', 'ratelimitexceeded', 'quota_exceeded', 'resource_exhausted') ||
      mentions(info, 'quota', 'rate limit')
    ) {
      return quotaError(info);
    }

    return new AppError(
      'GBP_FORBIDDEN',
      'Google says the connected account is not allowed to manage this Business Profile. Sign in with the account that owns or manages it.',
      403,
    );
  }

  if (httpStatus === 404) {
    return new AppError(
      'GBP_NOT_FOUND',
      'Google could not find that Business Profile account or location. Choose a location on the Google Connection page.',
      404,
    );
  }

  if (httpStatus === 409) {
    return new AppError(
      'CONFLICT',
      'Google reports this conflicts with something that already exists, such as a reply or post that was already published.',
      409,
    );
  }

  if (httpStatus === 429) return quotaError(info);

  if (httpStatus >= 500) {
    return new AppError(
      'GOOGLE_API_ERROR',
      `Google had a temporary problem (HTTP ${httpStatus}). Try again in a few minutes.`,
      502,
      info.message.slice(0, 200) || undefined,
    );
  }

  return new AppError(
    'GOOGLE_API_ERROR',
    'Google rejected the request as invalid.',
    400,
    info.message.slice(0, 200) || undefined,
  );
}

/**
 * True when the failure means "Google has not opened API access yet" — an
 * expected waiting state the owner cannot hurry. A disabled API is NOT this: it
 * is something the owner can fix, so it must read as an action, not a wait.
 */
export function isApprovalPending(code: AppErrorCode): boolean {
  return code === 'GBP_QUOTA_EXCEEDED';
}

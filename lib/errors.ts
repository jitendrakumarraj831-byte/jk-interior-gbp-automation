/** Error taxonomy shared by the Google client, the API routes and the UI. */

export type AppErrorCode =
  | 'OAUTH_NOT_CONFIGURED'
  | 'NOT_CONNECTED'
  | 'GBP_API_NOT_ENABLED'
  | 'GBP_QUOTA_EXCEEDED'
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
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  /** Extra context that is safe to show — never raw credentials. */
  readonly detail?: string;

  constructor(code: AppErrorCode, message: string, httpStatus = 500, detail?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail;
  }
}

/**
 * Google returns 403 with a handful of distinguishable reasons while an API is
 * still awaiting approval / not enabled on the project. We map those to a
 * dedicated code so the UI can say "approval pending" instead of "error".
 */
export function classifyGoogleError(httpStatus: number, body: unknown): AppError {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const lowered = text.toLowerCase();

  if (httpStatus === 401) {
    return new AppError(
      'GOOGLE_AUTH_FAILED',
      'Google rejected the stored credentials. Reconnect the Google account.',
      401,
    );
  }

  if (httpStatus === 403) {
    const pendingMarkers = [
      'has not been used in project',
      'is disabled',
      'accessnotconfigured',
      'api has not been enabled',
      'service_disabled',
      'it is disabled',
      'project is not allowlisted',
      'not allowlisted',
      'does not have access to the api',
    ];
    if (pendingMarkers.some((m) => lowered.includes(m))) {
      return new AppError(
        'GBP_API_NOT_ENABLED',
        'Google Business Profile API approval pending — the API is not enabled for this Google Cloud project yet.',
        503,
      );
    }
    if (lowered.includes('quota') || lowered.includes('rate limit')) {
      return new AppError(
        'GBP_QUOTA_EXCEEDED',
        'Google Business Profile API quota exhausted. Google grants 0 QPM until your access request is approved.',
        503,
      );
    }
    return new AppError(
      'GBP_FORBIDDEN',
      'Google denied this request. The connected account may not manage this Business Profile.',
      403,
    );
  }

  if (httpStatus === 404) {
    return new AppError('GBP_NOT_FOUND', 'Google returned 404 for this resource.', 404);
  }

  if (httpStatus === 429) {
    return new AppError('GBP_QUOTA_EXCEEDED', 'Google Business Profile API rate limit hit.', 503);
  }

  return new AppError(
    'GOOGLE_API_ERROR',
    `Google Business Profile API request failed (HTTP ${httpStatus}).`,
    httpStatus >= 500 ? 502 : 400,
  );
}

/** True when the failure means "waiting on Google", not "our bug". */
export function isApprovalPending(code: AppErrorCode): boolean {
  return code === 'GBP_API_NOT_ENABLED' || code === 'GBP_QUOTA_EXCEEDED';
}

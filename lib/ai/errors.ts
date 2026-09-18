/**
 * Error classification for the AI router.
 *
 * The router's fallback decision is driven entirely by these kinds, so the
 * mapping from a provider's raw rejection to a kind is the important part —
 * not the message, which is never shown to a customer.
 */

export type AiErrorKind =
  | 'missing_key' // A. no credential configured for this provider
  | 'auth' // B. provider rejected the credential
  | 'rate_limit' // C. throttled
  | 'timeout' // D. exceeded the router's per-provider budget
  | 'temporary' // E. 5xx / network blip
  | 'invalid_request' // F. our payload is wrong — every provider would reject it
  | 'unknown'; // G. anything unclassified

export class ProviderError extends Error {
  readonly kind: AiErrorKind;
  readonly provider: string;
  readonly status?: number;

  constructor(provider: string, kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Whether the router should try the next provider.
 *
 * Falls through for anything provider-specific: throttling, outages, timeouts,
 * a missing or rejected credential. Does NOT fall through on invalid_request —
 * a malformed payload would be rejected identically everywhere, so retrying it
 * across providers is a pointless loop that burns quota.
 */
export function shouldFallBack(kind: AiErrorKind): boolean {
  return kind !== 'invalid_request';
}

/** True when the failure means "this provider is not usable at all". */
export function isConfigurationFault(kind: AiErrorKind): boolean {
  return kind === 'missing_key' || kind === 'auth';
}

/** Reads an HTTP status off an unknown rejection, if it carries one. */
export function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/** Maps an HTTP status plus the raw rejection onto a kind. */
export function classify(error: unknown, status = statusOf(error)): AiErrorKind {
  // An aborted request is our timeout budget firing, not a provider fault.
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'timeout';
  }
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status !== undefined && status >= 500) return 'temporary';
  if (status === 400 || status === 404 || status === 422) return 'invalid_request';
  // No status at all is almost always a socket/DNS problem — worth another provider.
  if (status === undefined) return 'temporary';
  return 'unknown';
}

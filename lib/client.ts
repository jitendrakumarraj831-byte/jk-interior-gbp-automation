/**
 * Browser-side fetch helper.
 *
 * Client Components must never import from lib/config, lib/security or any
 * other server module — this file is the whole client surface, and it only ever
 * talks to our own /api routes.
 */

import type { ApiEnvelope } from './types';

export class ApiError extends Error {
  readonly status: ApiEnvelope<never>['status'];
  readonly code?: string;

  constructor(message: string, status: ApiEnvelope<never>['status'], code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  get isApprovalPending(): boolean {
    return this.status === 'pending_approval';
  }

  get isNotConnected(): boolean {
    return this.status === 'not_connected';
  }
}

/** Methods the server guards with a double-submit CSRF token. */
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Reads the CSRF cookie the middleware issued. It is intentionally not
 * httpOnly: echoing it back in a header is what proves the request came from a
 * page on our own origin, which a cross-site attacker cannot do.
 */
function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === 'jk_csrf') return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function request<T>(url: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (STATE_CHANGING.has(method)) headers['x-csrf-token'] = csrfToken();

  const response = await fetch(url, {
    ...init,
    headers,
    // Same-origin only: never let these credentials ride to another host.
    credentials: 'same-origin',
    cache: 'no-store',
  });

  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(`Unexpected response from the server (HTTP ${response.status}).`, 'error');
  }

  if (!response.ok || body.status !== 'ok') {
    throw new ApiError(body.message || 'Request failed.', body.status ?? 'error', body.code);
  }
  return body;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, data?: unknown) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  patch: <T>(url: string, data: unknown) =>
    request<T>(url, { method: 'PATCH', body: JSON.stringify(data) }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
};

export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function relativeTime(iso: string | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

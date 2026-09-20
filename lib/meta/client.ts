/**
 * Low-level Meta Graph API HTTP client.
 *
 * Every call goes through here so the API version is pinned in one place
 * (META_API_VERSION, default lib/config.ts#DEFAULT_META_API_VERSION) and every
 * error response is classified the same way. No caller constructs a Graph URL
 * by hand.
 *
 * Server-only module.
 */

import { metaGraphVersion } from '../config';
import { log } from '../logger';
import { classifyMetaError } from './errors';

const GRAPH_HOST = 'https://graph.facebook.com';

export type GraphMethod = 'GET' | 'POST' | 'DELETE';

/**
 * Calls `{path}` under the pinned Graph API version.
 * `path` starts without a leading slash, e.g. `me/accounts` or `{id}/media`.
 */
export async function graphRequest<T>(
  method: GraphMethod,
  path: string,
  options: {
    accessToken?: string;
    params?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const url = new URL(`${GRAPH_HOST}/${metaGraphVersion()}/${path}`);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  if (options.accessToken) url.searchParams.set('access_token', options.accessToken);

  const init: RequestInit = { method, cache: 'no-store' };
  if (method === 'POST' && options.body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    log.error('meta/client', 'Network error calling the Meta Graph API', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    throw classifyMetaError(502, {});
  }

  const json = await res.json().catch(() => ({}) as unknown);
  if (!res.ok) {
    log.warn('meta/client', 'Meta Graph API returned an error', { path, status: res.status });
    throw classifyMetaError(res.status, json);
  }
  return json as T;
}

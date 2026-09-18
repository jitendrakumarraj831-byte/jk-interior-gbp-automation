/**
 * Pluggable key/value store.
 *
 * Vercel serverless functions are stateless, so anything the automation needs
 * to remember between invocations (reply drafts, scheduled posts, the refresh
 * token captured during OAuth) has to live outside the function.
 *
 *  - Upstash Redis REST when UPSTASH_REDIS_REST_URL/TOKEN are set (durable).
 *  - An in-process Map otherwise, so the app still builds, deploys and demos
 *    without any database. The dashboard says loudly when this is the case.
 *
 * Only the REST protocol is used, so there is no extra runtime dependency.
 */

import { env, isDurableStoreConfigured } from './config';
import { AppError } from './errors';
import { log } from './logger';

export interface KeyValueStore {
  readonly kind: 'upstash' | 'memory';
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

const NAMESPACE = 'jk:gbp';

export function nsKey(...parts: string[]): string {
  return [NAMESPACE, ...parts].join(':');
}

/* ------------------------------ memory store ----------------------------- */

const memoryMap = new Map<string, string>();

const memoryStore: KeyValueStore = {
  kind: 'memory',
  async get<T>(key: string): Promise<T | null> {
    const raw = memoryMap.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  },
  async set<T>(key: string, value: T): Promise<void> {
    memoryMap.set(key, JSON.stringify(value));
  },
  async del(key: string): Promise<void> {
    memoryMap.delete(key);
  },
  async keys(prefix: string): Promise<string[]> {
    return [...memoryMap.keys()].filter((k) => k.startsWith(prefix));
  },
};

/* ------------------------------ upstash store ---------------------------- */

async function upstashCommand<T>(command: (string | number)[]): Promise<T> {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = env();
  const res = await fetch(UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.error('store', `Upstash command failed with HTTP ${res.status}`, {
      command: command[0],
      body,
    });
    throw new AppError('STORE_ERROR', 'Durable store request failed.', 502);
  }

  const json = (await res.json()) as { result?: T; error?: string };
  if (json.error) {
    log.error('store', 'Upstash returned an error', { error: json.error });
    throw new AppError('STORE_ERROR', 'Durable store rejected the request.', 502);
  }
  return json.result as T;
}

const upstashStore: KeyValueStore = {
  kind: 'upstash',
  async get<T>(key: string): Promise<T | null> {
    const raw = await upstashCommand<string | null>(['GET', key]);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      log.warn('store', 'Stored value was not valid JSON; discarding.', { key });
      return null;
    }
  },
  async set<T>(key: string, value: T): Promise<void> {
    await upstashCommand(['SET', key, JSON.stringify(value)]);
  },
  async del(key: string): Promise<void> {
    await upstashCommand(['DEL', key]);
  },
  async keys(prefix: string): Promise<string[]> {
    // SCAN rather than KEYS so a growing dataset never blocks Redis.
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await upstashCommand<[string, string[]]>([
        'SCAN',
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        250,
      ]);
      found.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    return found;
  },
};

/* --------------------------------- facade -------------------------------- */

export function getStore(): KeyValueStore {
  return isDurableStoreConfigured() ? upstashStore : memoryStore;
}

/** Read every value under a prefix, skipping entries that fail to parse. */
export async function readCollection<T>(prefix: string): Promise<T[]> {
  const store = getStore();
  const keys = await store.keys(prefix);
  const values = await Promise.all(keys.map((key) => store.get<T>(key)));

  const found: T[] = [];
  for (const value of values) {
    if (value !== null) found.push(value as T);
  }
  return found;
}

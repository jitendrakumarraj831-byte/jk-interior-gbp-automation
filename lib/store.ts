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
 *
 * Besides plain get/set the store offers three atomic primitives that make the
 * app safe across concurrent serverless instances:
 *
 *  - `setIfAbsent`  SET NX EX — the building block for locks and claims.
 *  - `incr`         INCR (+ EXPIRE on first hit) — race-free counters.
 *  - `getMany`      MGET — one round trip for several keys.
 */

import { env, isDurableStoreConfigured } from './config';
import { AppError } from './errors';
import { log } from './logger';

export interface KeyValueStore {
  readonly kind: 'upstash' | 'memory';
  get<T>(key: string): Promise<T | null>;
  /** Reads several keys in one round trip. Missing keys come back as null. */
  getMany<T>(keys: string[]): Promise<(T | null)[]>;
  /** `ttlSeconds` makes the value expire on its own. */
  set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void>;
  /**
   * Writes only when the key does not exist. Returns true when this call
   * created it — i.e. the caller won the race.
   */
  setIfAbsent<T>(key: string, value: T, options: { ttlSeconds: number }): Promise<boolean>;
  /** Atomically increments a counter, starting its expiry on the first hit. */
  incr(key: string, options: { ttlSeconds: number }): Promise<number>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

const NAMESPACE = 'jk:gbp';

export function nsKey(...parts: string[]): string {
  return [NAMESPACE, ...parts].join(':');
}

/* ------------------------------ memory store ----------------------------- */

type MemoryEntry = { value: string; expiresAt: number | null };

const memoryMap = new Map<string, MemoryEntry>();

function liveEntry(key: string): MemoryEntry | undefined {
  const entry = memoryMap.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    memoryMap.delete(key);
    return undefined;
  }
  return entry;
}

function expiryFrom(ttlSeconds?: number): number | null {
  return ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
}

const memoryStore: KeyValueStore = {
  kind: 'memory',
  async get<T>(key: string): Promise<T | null> {
    const entry = liveEntry(key);
    return entry === undefined ? null : (JSON.parse(entry.value) as T);
  },
  async getMany<T>(keys: string[]): Promise<(T | null)[]> {
    return keys.map((key) => {
      const entry = liveEntry(key);
      return entry === undefined ? null : (JSON.parse(entry.value) as T);
    });
  },
  async set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void> {
    memoryMap.set(key, { value: JSON.stringify(value), expiresAt: expiryFrom(options?.ttlSeconds) });
  },
  async setIfAbsent<T>(key: string, value: T, options: { ttlSeconds: number }): Promise<boolean> {
    if (liveEntry(key) !== undefined) return false;
    memoryMap.set(key, { value: JSON.stringify(value), expiresAt: expiryFrom(options.ttlSeconds) });
    return true;
  },
  async incr(key: string, options: { ttlSeconds: number }): Promise<number> {
    const entry = liveEntry(key);
    const next = (entry ? Number(JSON.parse(entry.value)) : 0) + 1;
    memoryMap.set(key, {
      value: JSON.stringify(next),
      // Expiry starts on the first hit and is not extended by later ones.
      expiresAt: entry ? entry.expiresAt : expiryFrom(options.ttlSeconds),
    });
    return next;
  },
  async del(key: string): Promise<void> {
    memoryMap.delete(key);
  },
  async keys(prefix: string): Promise<string[]> {
    return [...memoryMap.keys()].filter((k) => k.startsWith(prefix) && liveEntry(k) !== undefined);
  },
};

/* ------------------------------ upstash store ---------------------------- */

async function upstashCommand<T>(command: (string | number)[]): Promise<T> {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = env();

  let res: Response;
  try {
    res = await fetch(UPSTASH_REDIS_REST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      cache: 'no-store',
      // Never let a stalled Redis hang a serverless function until it times out.
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    log.error('store', 'Could not reach the durable store', {
      command: command[0],
      error: error instanceof Error ? error.name : 'unknown',
    });
    throw new AppError('STORE_ERROR', 'Durable store is unreachable.', 502);
  }

  if (!res.ok) {
    // The body is deliberately not logged: it is provider text we do not control.
    log.error('store', `Upstash command failed with HTTP ${res.status}`, { command: command[0] });
    throw new AppError('STORE_ERROR', 'Durable store request failed.', 502);
  }

  const json = (await res.json()) as { result?: T; error?: string };
  if (json.error) {
    log.error('store', 'Upstash returned an error', { command: command[0] });
    throw new AppError('STORE_ERROR', 'Durable store rejected the request.', 502);
  }
  return json.result as T;
}

function parseStored<T>(key: string, raw: string | null | undefined): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    log.warn('store', 'Stored value was not valid JSON; discarding.', { key });
    return null;
  }
}

const upstashStore: KeyValueStore = {
  kind: 'upstash',
  async get<T>(key: string): Promise<T | null> {
    return parseStored<T>(key, await upstashCommand<string | null>(['GET', key]));
  },
  async getMany<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    const raw = await upstashCommand<(string | null)[]>(['MGET', ...keys]);
    return keys.map((key, index) => parseStored<T>(key, raw[index]));
  },
  async set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void> {
    const command: (string | number)[] = ['SET', key, JSON.stringify(value)];
    if (options?.ttlSeconds && options.ttlSeconds > 0) {
      command.push('EX', Math.ceil(options.ttlSeconds));
    }
    await upstashCommand(command);
  },
  async setIfAbsent<T>(key: string, value: T, options: { ttlSeconds: number }): Promise<boolean> {
    const result = await upstashCommand<string | null>([
      'SET',
      key,
      JSON.stringify(value),
      'NX',
      'EX',
      Math.max(1, Math.ceil(options.ttlSeconds)),
    ]);
    // Redis answers "OK" when the key was created and null when it already existed.
    return result === 'OK';
  },
  async incr(key: string, options: { ttlSeconds: number }): Promise<number> {
    const count = await upstashCommand<number>(['INCR', key]);
    // First hit starts the window. If EXPIRE fails the counter would be
    // immortal, so the failure is allowed to surface to the caller.
    if (count === 1) await upstashCommand(['EXPIRE', key, Math.max(1, Math.ceil(options.ttlSeconds))]);
    return count;
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
  const values = await store.getMany<T>(keys);

  const found: T[] = [];
  for (const value of values) {
    if (value !== null) found.push(value as T);
  }
  return found;
}

/* ---------------------------------- locks -------------------------------- */

/**
 * Runs `fn` while holding a short-lived distributed lock.
 *
 * Returns `{ ran: false }` when another invocation already holds it, so cron
 * retries and overlapping manual triggers cannot double-publish. The lock
 * expires on its own after `ttlSeconds`, so a crashed function never wedges the
 * job forever. A store outage fails *open* — it is better to run a job twice
 * than never; callers that publish also claim each item individually.
 */
export async function withLock<T>(
  name: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const key = nsKey('lock', name);
  const store = getStore();

  let acquired = true;
  try {
    acquired = await store.setIfAbsent(key, new Date().toISOString(), { ttlSeconds });
  } catch {
    acquired = true;
  }
  if (!acquired) return { ran: false };

  try {
    return { ran: true, value: await fn() };
  } finally {
    await store.del(key).catch(() => undefined);
  }
}

/* --------------------------------- health -------------------------------- */

let lastPing: { at: number; ok: boolean } | null = null;
const PING_CACHE_MS = 30_000;

/**
 * Real round trip to the store (write, then read it back), so "reachable" means
 * "data written now can be read back" rather than "variables are set".
 *
 * Cached for a few seconds per instance because public and polling callers
 * (/api/health, the dashboard) must not turn every request into Redis traffic.
 */
export async function pingStore(): Promise<boolean> {
  if (lastPing && Date.now() - lastPing.at < PING_CACHE_MS) return lastPing.ok;
  let ok = false;
  try {
    const store = getStore();
    const key = nsKey('health', 'ping');
    const stamp = String(Date.now());
    await store.set(key, stamp, { ttlSeconds: 60 });
    ok = (await store.get<string>(key)) === stamp;
  } catch {
    ok = false;
  }
  lastPing = { at: Date.now(), ok };
  return ok;
}

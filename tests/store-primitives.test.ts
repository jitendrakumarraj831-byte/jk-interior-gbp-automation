/**
 * The atomic building blocks every concurrency guarantee in the app rests on:
 * claims, locks and counters must behave the same way on the in-memory store
 * (local/preview) as they do against Upstash.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadStore() {
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  return import('@/lib/store');
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('setIfAbsent', () => {
  it('only the first of several concurrent claimants wins', async () => {
    const { getStore } = await loadStore();
    const store = getStore();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.setIfAbsent('claim:x', i, { ttlSeconds: 60 })),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('the claim expires on its own, so a crashed worker never wedges a job', async () => {
    vi.useFakeTimers();
    const { getStore } = await loadStore();
    const store = getStore();
    expect(await store.setIfAbsent('claim:y', 1, { ttlSeconds: 5 })).toBe(true);
    expect(await store.setIfAbsent('claim:y', 2, { ttlSeconds: 5 })).toBe(false);
    vi.advanceTimersByTime(6_000);
    expect(await store.setIfAbsent('claim:y', 3, { ttlSeconds: 5 })).toBe(true);
  });
});

describe('incr', () => {
  it('counts every increment, however they interleave', async () => {
    const { getStore } = await loadStore();
    const store = getStore();
    const counts = await Promise.all(
      Array.from({ length: 20 }, () => store.incr('counter', { ttlSeconds: 60 })),
    );
    expect(Math.max(...counts)).toBe(20);
    expect(new Set(counts).size).toBe(20);
  });

  it('the window starts on the first hit and is not extended by later ones', async () => {
    vi.useFakeTimers();
    const { getStore } = await loadStore();
    const store = getStore();
    await store.incr('window', { ttlSeconds: 10 });
    vi.advanceTimersByTime(6_000);
    await store.incr('window', { ttlSeconds: 10 });
    vi.advanceTimersByTime(5_000); // 11s after the first hit
    expect(await store.incr('window', { ttlSeconds: 10 })).toBe(1);
  });
});

describe('get / getMany / set ttl', () => {
  it('getMany returns null for missing keys and keeps order', async () => {
    const { getStore } = await loadStore();
    const store = getStore();
    await store.set('a', { n: 1 });
    await store.set('c', { n: 3 });
    expect(await store.getMany(['a', 'b', 'c'])).toEqual([{ n: 1 }, null, { n: 3 }]);
  });

  it('a value written with a ttl disappears', async () => {
    vi.useFakeTimers();
    const { getStore } = await loadStore();
    const store = getStore();
    await store.set('temp', 'v', { ttlSeconds: 2 });
    expect(await store.get('temp')).toBe('v');
    vi.advanceTimersByTime(3_000);
    expect(await store.get('temp')).toBeNull();
    expect(await store.keys('temp')).toEqual([]);
  });
});

describe('withLock', () => {
  it('a second caller is refused while the first is running, and may run afterwards', async () => {
    const { withLock } = await loadStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = withLock('job', 60, async () => {
      await gate;
      return 'done';
    });
    // Let the first acquire the lock.
    await Promise.resolve();
    const second = await withLock('job', 60, async () => 'should not run');
    expect(second).toEqual({ ran: false });

    release();
    expect(await first).toEqual({ ran: true, value: 'done' });
    expect(await withLock('job', 60, async () => 'again')).toEqual({ ran: true, value: 'again' });
  });

  it('releases the lock even when the work throws', async () => {
    const { withLock } = await loadStore();
    await expect(
      withLock('boom', 60, async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(await withLock('boom', 60, async () => 'ok')).toEqual({ ran: true, value: 'ok' });
  });
});

describe('Upstash adapter', () => {
  it('speaks the REST protocol for NX/EX claims, INCR+EXPIRE and MGET', async () => {
    vi.resetModules();
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-token';
    const sent: unknown[][] = [];
    const answers: Record<string, unknown> = { SET: 'OK', INCR: 1, EXPIRE: 1, MGET: ['"x"', null] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const command = JSON.parse(String(init.body)) as unknown[];
        sent.push(command);
        return new Response(JSON.stringify({ result: answers[String(command[0])] }), { status: 200 });
      }),
    );
    const { getStore } = await import('@/lib/store');
    const store = getStore();

    expect(await store.setIfAbsent('k', 'v', { ttlSeconds: 30 })).toBe(true);
    expect(sent[0]).toEqual(['SET', 'k', '"v"', 'NX', 'EX', 30]);

    expect(await store.incr('c', { ttlSeconds: 60 })).toBe(1);
    expect(sent.slice(1).map((c) => c[0])).toEqual(['INCR', 'EXPIRE']);

    expect(await store.getMany(['a', 'b'])).toEqual(['x', null]);
    expect(sent.at(-1)).toEqual(['MGET', 'a', 'b']);

    // A rejected NX (key exists) comes back as null → the claim is lost.
    answers.SET = null;
    expect(await store.setIfAbsent('k', 'v', { ttlSeconds: 30 })).toBe(false);

    vi.unstubAllGlobals();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('a network failure surfaces as STORE_ERROR without leaking the response body', async () => {
    vi.resetModules();
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-token';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
    const { getStore } = await import('@/lib/store');
    await expect(getStore().get('x')).rejects.toMatchObject({ code: 'STORE_ERROR' });
    vi.unstubAllGlobals();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });
});

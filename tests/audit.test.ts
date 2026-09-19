/**
 * Audit log: the actor identifier must never be — or contain — the raw
 * session token (Part 25 explicitly forbids logging secrets), yet must stay
 * stable for the same session so entries from one sign-in can be correlated.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAudit() {
  vi.resetModules();
  return import('@/lib/audit');
}

function requestWithCookie(cookie: string | null): Request {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new Request('https://example.test/api/whatever', { headers });
}

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.SESSION_SECRET = 'test-session-secret';
});

describe('actorFromRequest', () => {
  it('falls back to a fixed label when there is no session cookie', async () => {
    const { actorFromRequest } = await loadAudit();
    expect(actorFromRequest(requestWithCookie(null))).toBe('admin');
  });

  it('never contains the raw session token', async () => {
    const { actorFromRequest } = await loadAudit();
    const token = 'admin.9999999999999.deadbeefcafebabe.somesignature';
    const actor = actorFromRequest(requestWithCookie(`jk_admin_session=${token}`));
    expect(actor).not.toContain(token);
    expect(actor.startsWith('admin:')).toBe(true);
  });

  it('is stable for the same session', async () => {
    const { actorFromRequest } = await loadAudit();
    const cookie = 'jk_admin_session=same-token-value';
    expect(actorFromRequest(requestWithCookie(cookie))).toBe(
      actorFromRequest(requestWithCookie(cookie)),
    );
  });

  it('differs between two different sessions', async () => {
    const { actorFromRequest } = await loadAudit();
    const a = actorFromRequest(requestWithCookie('jk_admin_session=token-a'));
    const b = actorFromRequest(requestWithCookie('jk_admin_session=token-b'));
    expect(a).not.toBe(b);
  });
});

describe('recordAudit / listAudit', () => {
  it('round-trips an entry and orders newest first', async () => {
    const { recordAudit, listAudit } = await loadAudit();
    await recordAudit({
      actor: 'admin:aaaa',
      action: 'post_created',
      resource: 'post-1',
      status: 'success',
      source: 'dashboard',
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await recordAudit({
      actor: 'cron',
      action: 'automation_executed',
      resource: 'sync-reviews',
      status: 'success',
      source: 'cron',
      detail: 'Synced 3 reviews.',
    });

    const entries = await listAudit();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.action).toBe('automation_executed');
    expect(entries[0]?.detail).toBe('Synced 3 reviews.');
    expect(entries[1]?.action).toBe('post_created');
  });

  it('never fails the caller when the store is unavailable', async () => {
    const { recordAudit } = await loadAudit();
    // An Upstash URL with no working endpoint behind it — every store call rejects.
    process.env.UPSTASH_REDIS_REST_URL = 'https://unreachable.invalid';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(
      recordAudit({
        actor: 'admin:aaaa',
        action: 'settings_updated',
        resource: 'app-settings',
        status: 'success',
        source: 'dashboard',
      }),
    ).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });
});

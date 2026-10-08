/**
 * The onboarding checklist must never claim "done" for something that is not
 * working — in particular never while Google reports anything but available.
 */

import { describe, expect, it } from 'vitest';

import { buildSteps, isGoogleStepDone, type SetupConfig } from '@/components/setup-checklist';

const READY: SetupConfig = {
  oauthConfigured: true,
  googleConfigured: true,
  aiConfigured: true,
  cronConfigured: true,
  durableStore: true,
  storeReachable: true,
  lastCronRunAt: '2026-10-07T02:30:00.000Z',
  cronFailed: false,
  gbpAccess: 'available',
};

const done = (config: SetupConfig) => buildSteps(config).filter((s) => s.done).length;
const step = (config: SetupConfig, key: string) => buildSteps(config).find((s) => s.key === key)!;

describe('Google step', () => {
  it('is done only when Google is available', () => {
    expect(isGoogleStepDone(READY)).toBe(true);
    for (const gbpAccess of ['pending', 'rate_limited', 'auth_error', 'permission_error', 'error', 'unknown', undefined]) {
      expect(isGoogleStepDone({ ...READY, gbpAccess })).toBe(false);
    }
  });

  it('reads Connected & Active when available, and never "Pending" next to it', () => {
    expect(step(READY, 'google')).toMatchObject({ done: true, status: 'Connected & Active' });
  });

  it.each([
    ['pending', 'Awaiting approval'],
    ['rate_limited', 'Rate limited'],
    ['auth_error', 'Reconnect needed'],
    ['permission_error', 'Needs attention'],
    ['error', 'Connection problem'],
    ['unknown', 'Not checked yet'],
  ])('%s → "%s" and not done', (gbpAccess, label) => {
    expect(step({ ...READY, gbpAccess }, 'google')).toMatchObject({ done: false, status: label });
  });

  it('not connected / not configured are their own states', () => {
    expect(step({ ...READY, googleConfigured: false }, 'google').status).toBe('Not connected');
    expect(step({ ...READY, oauthConfigured: false, googleConfigured: false }, 'google').status).toBe('Not configured');
  });

  it('mock mode is labelled as such and never mistaken for real Google', () => {
    const mock = { ...READY, mockMode: true, gbpAccess: 'unknown' };
    expect(step(mock, 'google')).toMatchObject({ done: true, status: 'Mock mode' });
  });
});

describe('"Setup complete" (4 / 4)', () => {
  it('requires every step, Google included', () => {
    expect(done(READY)).toBe(4);
    expect(done({ ...READY, gbpAccess: 'pending' })).toBe(3);
    expect(done({ ...READY, gbpAccess: 'auth_error' })).toBe(3);
  });

  it('a configured but unreachable store is not done', () => {
    expect(step({ ...READY, storeReachable: false }, 'storage')).toMatchObject({ done: false, status: 'Not responding' });
  });

  it('a configured cron whose last run failed is not done; one that has not run yet says so', () => {
    expect(step({ ...READY, cronFailed: true }, 'cron')).toMatchObject({ done: false, status: 'Last run failed' });
    expect(step({ ...READY, lastCronRunAt: null }, 'cron')).toMatchObject({ done: true, status: 'Waiting for first run' });
    expect(step(READY, 'cron')).toMatchObject({ done: true, status: 'Running' });
  });

  it('missing configuration is never done', () => {
    expect(step({ ...READY, aiConfigured: false }, 'ai').done).toBe(false);
    expect(step({ ...READY, cronConfigured: false }, 'cron').done).toBe(false);
    expect(step({ ...READY, durableStore: false }, 'storage').done).toBe(false);
  });
});

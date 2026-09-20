/** lib/social/settings.ts — defaults and partial-merge behavior, including the weeklyPlan sub-object. */

import { describe, expect, it, vi } from 'vitest';

async function loadSettings() {
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  return import('@/lib/social/settings');
}

describe('getSocialSettings', () => {
  it('returns safe defaults with no stored value', async () => {
    const settingsModule = await loadSettings();
    const settings = await settingsModule.getSocialSettings();
    expect(settings.facebookAutoPublish).toBe(false);
    expect(settings.instagramAutoPublish).toBe(false);
    expect(settings.duplicateProtectionEnabled).toBe(true);
    expect(settings.timezone).toBe('Asia/Kolkata');
    expect(settings.weeklyPlan[1]).toBe('gypsum_false_ceiling'); // Monday
  });
});

describe('saveSocialSettings', () => {
  it('merges a partial patch without discarding other fields', async () => {
    const settingsModule = await loadSettings();
    await settingsModule.saveSocialSettings({ facebookAutoPublish: true });
    const settings = await settingsModule.getSocialSettings();
    expect(settings.facebookAutoPublish).toBe(true);
    expect(settings.instagramAutoPublish).toBe(false); // untouched
  });

  it('merges a partial weeklyPlan update, keeping the other days', async () => {
    const settingsModule = await loadSettings();
    await settingsModule.saveSocialSettings({ weeklyPlan: { 1: 'offer' } });
    const settings = await settingsModule.getSocialSettings();
    expect(settings.weeklyPlan[1]).toBe('offer'); // Monday changed
    expect(settings.weeklyPlan[2]).toBe('before_after'); // Tuesday untouched
  });

  it('never lets timezone be overridden', async () => {
    const settingsModule = await loadSettings();
    // @ts-expect-error - intentionally passing an invalid value to prove it's ignored
    await settingsModule.saveSocialSettings({ timezone: 'UTC' });
    const settings = await settingsModule.getSocialSettings();
    expect(settings.timezone).toBe('Asia/Kolkata');
  });
});

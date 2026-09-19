/**
 * Social Automation settings.
 *
 * Minimal for now — just the two auto-publish gates the cron publisher needs
 * to default safely OFF. Phase E extends this with the rest (default
 * approval mode, posting time, weekly plan, duplicate protection, retry
 * policy) and the dashboard settings UI; this shape is additive, not
 * something later phases replace.
 */

import { getStore, nsKey } from '../store';

export type SocialSettings = {
  facebookEnabled: boolean;
  instagramEnabled: boolean;
  /** Both default OFF — a due scheduled post waits for a manual publish until this is on. */
  facebookAutoPublish: boolean;
  instagramAutoPublish: boolean;
  updatedAt: string;
};

const KEY = nsKey('social-settings', 'app');

export const DEFAULT_SOCIAL_SETTINGS: SocialSettings = {
  facebookEnabled: true,
  instagramEnabled: true,
  facebookAutoPublish: false,
  instagramAutoPublish: false,
  updatedAt: new Date(0).toISOString(),
};

export async function getSocialSettings(): Promise<SocialSettings> {
  const stored = await getStore().get<SocialSettings>(KEY);
  return { ...DEFAULT_SOCIAL_SETTINGS, ...(stored ?? {}) };
}

export async function saveSocialSettings(patch: Partial<SocialSettings>): Promise<SocialSettings> {
  const current = await getSocialSettings();
  const next: SocialSettings = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await getStore().set(KEY, next);
  return next;
}

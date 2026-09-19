/**
 * Social Automation settings.
 *
 * facebookAutoPublish/instagramAutoPublish are the only two fields with a
 * live safety effect — both default OFF, gating whether the cron publisher
 * may act on a due scheduled post at all (lib/social/tasks.ts). The rest are
 * genuinely wired where noted; `defaultApprovalMode` is stored but NOT yet
 * consulted anywhere — the AI daily draft always requires manual approval
 * regardless of this setting, documented honestly rather than left silently
 * inert-but-implied-functional.
 */

import type { SocialContentType } from './types';
import { getStore, nsKey } from '../store';
import { DEFAULT_WEEKLY_PLAN } from './weekly-plan';

export type SocialSettings = {
  facebookEnabled: boolean;
  instagramEnabled: boolean;
  /** Both default OFF — a due scheduled post waits for a manual publish until this is on. */
  facebookAutoPublish: boolean;
  instagramAutoPublish: boolean;
  /** Stored only — not yet enforced. AI drafts always require manual approval regardless. */
  defaultApprovalMode: 'manual' | 'auto';
  /** HH:mm, 24-hour. Pre-fills the Content Calendar's schedule time picker. */
  defaultPostingTime: string;
  /** Fixed — JK Interior operates in this timezone. Not user-editable. */
  timezone: 'Asia/Kolkata';
  /** One content type per day-of-week (0=Sunday..6=Saturday). Drives the daily AI draft. */
  weeklyPlan: Record<number, SocialContentType>;
  /** Enforced at schedule time (app/api/social/posts/[id]/schedule). The final publish-time check is never toggle-able — it is always on. */
  duplicateProtectionEnabled: boolean;
  /** Consecutive rate-limit/token-expiry retries before a stuck post is marked failed instead of retried forever. */
  maxRetries: number;
  updatedAt: string;
};

const KEY = nsKey('social-settings', 'app');

export const DEFAULT_SOCIAL_SETTINGS: SocialSettings = {
  facebookEnabled: true,
  instagramEnabled: true,
  facebookAutoPublish: false,
  instagramAutoPublish: false,
  defaultApprovalMode: 'manual',
  defaultPostingTime: '10:00',
  timezone: 'Asia/Kolkata',
  weeklyPlan: DEFAULT_WEEKLY_PLAN,
  duplicateProtectionEnabled: true,
  maxRetries: 5,
  updatedAt: new Date(0).toISOString(),
};

export async function getSocialSettings(): Promise<SocialSettings> {
  const stored = await getStore().get<SocialSettings>(KEY);
  return {
    ...DEFAULT_SOCIAL_SETTINGS,
    ...(stored ?? {}),
    weeklyPlan: { ...DEFAULT_WEEKLY_PLAN, ...(stored?.weeklyPlan ?? {}) },
  };
}

export async function saveSocialSettings(patch: Partial<SocialSettings>): Promise<SocialSettings> {
  const current = await getSocialSettings();
  const next: SocialSettings = {
    ...current,
    ...patch,
    weeklyPlan: patch.weeklyPlan ? { ...current.weeklyPlan, ...patch.weeklyPlan } : current.weeklyPlan,
    timezone: 'Asia/Kolkata',
    updatedAt: new Date().toISOString(),
  };
  await getStore().set(KEY, next);
  return next;
}

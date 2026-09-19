/**
 * Default weekly content plan — one content type suggested per day. Used by
 * the (draft-only) AI daily content cron. Editable in a future settings
 * increment; this constant is the shipped default.
 */

import type { SocialContentType } from './types';

export const DEFAULT_WEEKLY_PLAN: Record<number, SocialContentType> = {
  1: 'gypsum_false_ceiling', // Monday
  2: 'before_after', // Tuesday
  3: 'pvc_ceiling', // Wednesday
  4: 'wpc_louvers', // Thursday
  5: 'interior_project', // Friday — project showcase
  6: 'interior_tip', // Saturday
  0: 'local_business_promotion', // Sunday
};

/** Content type suggested for `date`'s day of week (local server time). */
export function contentTypeForDay(
  date: Date = new Date(),
  plan: Record<number, SocialContentType> = DEFAULT_WEEKLY_PLAN,
): SocialContentType {
  return plan[date.getDay()] ?? DEFAULT_WEEKLY_PLAN[date.getDay()] ?? 'interior_project';
}

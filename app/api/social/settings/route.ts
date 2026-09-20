/** Social Automation settings. Mirrors app/api/settings's GET/PATCH shape. */

import { z } from 'zod';

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { configSummary } from '@/lib/config';
import { getRefreshToken } from '@/lib/google-auth';
import { getConnectionState } from '@/lib/meta/auth';
import { assertAdmin, handleRoute, ok, parseJson } from '@/lib/security';
import { getSocialSettings, saveSocialSettings } from '@/lib/social/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTENT_TYPES = [
  'gypsum_false_ceiling',
  'pvc_ceiling',
  'wpc_louvers',
  'wpc_fluted_panel',
  'uv_marble_sheet',
  'tv_unit',
  'wall_paneling',
  'partition',
  'interior_project',
  'before_after',
  'customer_project',
  'interior_tip',
  'offer',
  'festival',
  'faq',
  'local_business_promotion',
] as const;

const patchSchema = z.object({
  facebookEnabled: z.boolean().optional(),
  instagramEnabled: z.boolean().optional(),
  facebookAutoPublish: z.boolean().optional(),
  instagramAutoPublish: z.boolean().optional(),
  defaultApprovalMode: z.enum(['manual', 'auto']).optional(),
  defaultPostingTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm')
    .optional(),
  // Keys are JS day-of-week numbers (0=Sunday..6=Saturday) — constrained so an
  // arbitrary string can never accumulate in stored settings.
  weeklyPlan: z.record(z.enum(['0', '1', '2', '3', '4', '5', '6']), z.enum(CONTENT_TYPES)).optional(),
  duplicateProtectionEnabled: z.boolean().optional(),
  maxRetries: z.number().int().min(1).max(20).optional(),
});

export async function GET(request: Request) {
  return handleRoute('social/settings', async () => {
    assertAdmin(request);
    const refreshToken = await getRefreshToken().catch(() => null);
    return ok({
      settings: await getSocialSettings(),
      connection: await getConnectionState(),
      config: configSummary(refreshToken).meta,
    });
  });
}

export async function PATCH(request: Request) {
  return handleRoute('social/settings', async () => {
    assertAdmin(request);
    const patch = await parseJson(request, patchSchema);
    const settings = await saveSocialSettings(patch);
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'social_settings_updated',
      resource: 'social-settings',
      status: 'success',
      source: 'dashboard',
      detail: Object.keys(patch).join(', '),
    });
    return ok(
      { settings },
      patch.facebookAutoPublish === true || patch.instagramAutoPublish === true
        ? 'Saved. Auto Publish is now ON for at least one platform — due scheduled posts will publish automatically.'
        : 'Settings saved.',
    );
  });
}

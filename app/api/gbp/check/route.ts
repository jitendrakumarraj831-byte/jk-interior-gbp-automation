/**
 * "Check API access now".
 *
 * Re-verifies Business Profile access on demand by exercising each API once,
 * bypassing any pending cooldown. Safe to expose to the admin because it is
 * throttled (one check per few seconds) and makes at most five small read-only
 * Google calls. Returns the resulting snapshot — the same shape every other
 * screen reads — never a token or a raw Google payload.
 */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { checkGbpAccess } from '@/lib/connection';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleRoute('gbp/check', async () => {
    assertAdmin(request);
    const access = await checkGbpAccess({ manual: true });
    // "Active" only when every API answered. One working API proves the account
    // is connected, but it must not paper over a Reviews or Posts API that is not.
    const healthy = access.status === 'available' && access.degraded.length === 0;
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'google_access_checked',
      resource: 'gbp-access',
      status: healthy ? 'success' : 'failure',
      source: 'dashboard',
      detail: access.degraded.length > 0
        ? `${access.status}; not working: ${access.degraded.map((s) => s.service).join(', ')}`
        : access.status,
    });
    return ok({ access }, healthy ? 'Business Profile API access is active.' : access.message);
  });
}

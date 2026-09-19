/** Clears the stored Google connection. */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { disconnect } from '@/lib/google-auth';
import { assertAdmin, handleRoute, ok } from '@/lib/security';
import { env } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handleRoute('auth/google/disconnect', async () => {
    assertAdmin(request);
    await disconnect();
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'google_disconnected',
      resource: 'google-account',
      status: 'success',
      source: 'dashboard',
    });
    // A refresh token pinned in the environment survives a disconnect by design.
    const envPinned = Boolean(env().GOOGLE_REFRESH_TOKEN);
    return ok(
      { disconnected: true, environmentTokenStillSet: envPinned },
      envPinned
        ? 'Stored connection cleared. GOOGLE_REFRESH_TOKEN is still set in the environment, so the app remains connected.'
        : 'Google account disconnected.',
    );
  });
}

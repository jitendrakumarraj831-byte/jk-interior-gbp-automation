/**
 * Disconnects the Google account.
 *
 * Removes the stored refresh token, revokes it at Google and forgets the cached
 * access state. If GOOGLE_REFRESH_TOKEN is set in the environment it is ignored
 * from now on (until the account is reconnected), so Disconnect really does
 * disconnect — see lib/google-auth.ts for the full rule.
 */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { disconnect } from '@/lib/google-auth';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handleRoute('auth/google/disconnect', async () => {
    assertAdmin(request);
    const { environmentTokenIgnored } = await disconnect();
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'google_disconnected',
      resource: 'google-account',
      status: 'success',
      source: 'dashboard',
    });
    return ok(
      { disconnected: true, environmentTokenIgnored },
      environmentTokenIgnored
        ? 'Google account disconnected. GOOGLE_REFRESH_TOKEN is still set in the environment but is ignored until you reconnect — remove it in Vercel to tidy up.'
        : 'Google account disconnected.',
    );
  });
}

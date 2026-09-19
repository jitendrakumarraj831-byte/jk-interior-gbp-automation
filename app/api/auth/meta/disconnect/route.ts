/** Clears the stored Meta connection. */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { disconnect, getConnectionState } from '@/lib/meta/auth';
import { notify } from '@/lib/notifications';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handleRoute('auth/meta/disconnect', async () => {
    assertAdmin(request);
    const before = await getConnectionState();
    await disconnect();
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'meta_disconnected',
      resource: 'meta-account',
      status: 'success',
      source: 'dashboard',
      detail: before.facebook.pageName,
    });
    await notify({
      category: 'meta_disconnected',
      title: 'Meta disconnected',
      message: 'The Facebook/Instagram connection was disconnected.',
      href: '/dashboard/social',
      dedupeKey: `meta-disconnected:${new Date().toISOString().slice(0, 10)}`,
    });
    return ok({ disconnected: true }, 'Meta account disconnected.');
  });
}

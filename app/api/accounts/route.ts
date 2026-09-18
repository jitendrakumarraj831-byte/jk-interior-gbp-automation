/**
 * Business Profile connection state: which Google account is linked, and which
 * GBP accounts/locations it can manage.
 */

import { getConnectionState } from '@/lib/connection';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleRoute('accounts', async () => {
    assertAdmin(request);
    const state = await getConnectionState();
    return ok(state, state.connected ? 'Connected to Google Business Profile.' : 'Not connected.');
  });
}

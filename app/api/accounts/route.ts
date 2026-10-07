/**
 * Business Profile connection state: which Google account is linked, and which
 * GBP accounts/locations it can manage.
 *
 * GET           cached account/location lists, access state self-healed if due.
 * GET ?refresh=1  forces a live re-check of every API (throttled).
 */

import { getConnectionState } from '@/lib/connection';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleRoute('accounts', async () => {
    assertAdmin(request);
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    const state = await getConnectionState({ refresh });
    return ok(
      state,
      state.connected ? 'Connected to Google Business Profile.' : state.apiAccessMessage || 'Not connected.',
    );
  });
}

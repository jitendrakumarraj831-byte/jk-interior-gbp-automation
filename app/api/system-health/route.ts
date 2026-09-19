/** System Health Center — aggregates status this app already tracks. No new Google calls. */

import { buildSystemHealthReport } from '@/lib/system-health';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleRoute('system-health', async () => {
    assertAdmin(request);
    return ok(await buildSystemHealthReport());
  });
}

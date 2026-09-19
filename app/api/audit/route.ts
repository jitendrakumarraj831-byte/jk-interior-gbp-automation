/** Audit log — read-only. Entries are written by the actions themselves. */

import { listAudit } from '@/lib/audit';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleRoute('audit', async () => {
    assertAdmin(request);
    const entries = await listAudit();
    return ok({ entries }, `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
  });
}

/**
 * Meta connection status for the dashboard.
 *
 * Returns booleans and resource names only — never a token. Mirrors the shape
 * of GET /api/settings's gbpAccess block, but for the independent Meta
 * connection.
 */

import { isMetaOAuthConfigured, isMetaEncryptionConfigured, isMetaConfigured } from '@/lib/config';
import { getConnectionState } from '@/lib/meta/auth';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleRoute('meta/status', async () => {
    assertAdmin(request);
    const connection = await getConnectionState();
    return ok({
      connection,
      config: {
        oauthConfigured: isMetaOAuthConfigured(),
        encryptionConfigured: isMetaEncryptionConfigured(),
        metaConfigured: isMetaConfigured(),
      },
    });
  });
}

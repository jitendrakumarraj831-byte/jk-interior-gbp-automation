/** Ends the admin session. */

import { ADMIN_COOKIE, assertSameOrigin, CSRF_COOKIE, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handleRoute('auth/logout', async () => {
    // No session check: signing out an already-invalid session is harmless and
    // should always succeed. The origin check still blocks cross-site logout.
    assertSameOrigin(request);

    const response = ok({ signedOut: true }, 'Signed out.');
    response.cookies.delete(ADMIN_COOKIE);
    response.cookies.delete(CSRF_COOKIE);
    return response;
  });
}

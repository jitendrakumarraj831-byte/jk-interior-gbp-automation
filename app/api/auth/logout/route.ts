/** Ends the admin session. */

import { ADMIN_COOKIE, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  return handleRoute('auth/logout', async () => {
    const response = ok({ signedOut: true }, 'Signed out.');
    response.cookies.delete(ADMIN_COOKIE);
    return response;
  });
}

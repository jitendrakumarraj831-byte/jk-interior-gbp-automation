/**
 * Dashboard shell.
 *
 * This is where admin access is really enforced: middleware only checks that a
 * cookie exists, but this server component verifies its HMAC signature and
 * expiry before rendering anything.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/nav';
import { adminAuthMode } from '@/lib/config';
import { ADMIN_COOKIE, verifySessionToken } from '@/lib/security';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const mode = adminAuthMode();

  // Production without credentials never renders the dashboard. Middleware
  // catches this first; this check is the authoritative one, because the
  // signature of the session cookie can only be verified here.
  if (mode === 'misconfigured') redirect('/config-error');

  if (mode === 'enforced') {
    const token = (await cookies()).get(ADMIN_COOKIE)?.value;
    if (!verifySessionToken(token)) redirect('/login?next=/dashboard');
  }

  // Reachable only on a developer's machine — production took a branch above.
  const developmentBanner = mode === 'development_only';

  return (
    <AppShell
      authEnabled={mode === 'enforced'}
      banner={
        developmentBanner ? (
          <p className="border-b border-warning-100 bg-warning-50 px-4 py-2 text-center text-xs font-medium text-warning-700">
            Local development — no admin password set. Production refuses to serve without one.
          </p>
        ) : null
      }
    >
      {children}
    </AppShell>
  );
}

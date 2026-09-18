/**
 * Dashboard shell.
 *
 * This is where admin access is really enforced: middleware only checks that a
 * cookie exists, but this server component verifies its HMAC signature and
 * expiry before rendering anything.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { MobileHeader, MobileTabBar, SideNav } from '@/components/nav';
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

  // Reachable only on a developer's machine — production took one of the
  // branches above.
  const developmentBanner = mode === 'development_only';

  return (
    <div className="flex min-h-dvh">
      <SideNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        {developmentBanner ? (
          <p className="bg-warn-50 px-4 py-2 text-center text-xs font-medium text-warn-700">
            Local development — no admin password set. Production refuses to serve without one.
          </p>
        ) : null}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 sm:px-6 sm:pb-10 lg:pt-8">
          {children}
        </main>
        <MobileTabBar />
      </div>
    </div>
  );
}

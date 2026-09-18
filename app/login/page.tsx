import { redirect } from 'next/navigation';

import { adminAuthMode } from '@/lib/config';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const mode = adminAuthMode();

  // Production without credentials cannot offer a sign-in — there is no
  // password to check against. Say so plainly instead of showing a dead form.
  if (mode === 'misconfigured') redirect('/config-error');

  // Local development with no password set: nothing to sign in to.
  if (mode === 'development_only') redirect('/dashboard');

  const { next } = await searchParams;
  // Only same-origin relative paths are accepted, so ?next= cannot be used as
  // an open redirect.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50/60 via-canvas to-canvas px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-brand">
            JK
          </span>
          <h1 className="mt-3 text-lg font-semibold tracking-[-0.015em] text-ink-950">JK Interior</h1>
          <p className="mt-0.5 text-sm text-ink-500">Google Business Profile Automation</p>
        </div>
        <LoginForm next={safeNext} />
        <p className="mt-5 text-center text-xs text-ink-400">
          Signing in is required before any Business Profile data is shown.
        </p>
      </div>
    </main>
  );
}

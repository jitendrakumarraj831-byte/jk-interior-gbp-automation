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
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 text-sm font-bold text-white">
            JK
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">JK Interior</p>
            <p className="text-xs text-ink-500">Admin sign-in</p>
          </div>
        </div>
        <LoginForm next={safeNext} />
      </div>
    </main>
  );
}

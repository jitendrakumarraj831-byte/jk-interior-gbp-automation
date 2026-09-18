/**
 * Shown when a production deployment is missing its admin credentials.
 *
 * This is what "fail securely" looks like from the outside: the dashboard is
 * not served at all, and the page names the missing variables — names only,
 * never values, and nothing about the Google or AI configuration.
 */

import { redirect } from 'next/navigation';

import { AlertIcon, LockIcon } from '@/components/icons';
import { isAdminAuthMisconfigured, missingAdminAuthVars } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Configuration required' };

export default function ConfigErrorPage() {
  // If the deployment is healthy there is nothing to show here.
  if (!isAdminAuthMisconfigured()) redirect('/dashboard');

  const missing = missingAdminAuthVars();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-danger-50/50 via-canvas to-canvas px-5 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-[0.8125rem] font-bold text-white shadow-brand">
            JK
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-950">JK Interior</p>
            <p className="text-xs text-ink-500">Business Profile Automation</p>
          </div>
        </div>

        <section className="rounded-panel border border-danger-100 bg-surface p-5 shadow-raised sm:p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-danger-50 text-danger-700 ring-1 ring-inset ring-danger-100">
            <AlertIcon size={22} />
          </span>
          <h1 className="mt-3.5 text-lg font-semibold tracking-[-0.015em] text-ink-950">
            Configuration required
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            This deployment is running in production without admin authentication configured, so the
            dashboard and every admin API are refusing requests. Nothing is reachable without a
            signed-in session — by design.
          </p>

          <p className="mt-5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
            Missing environment {missing.length === 1 ? 'variable' : 'variables'}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {missing.map((name) => (
              <li key={name}>
                <code className="inline-flex rounded-lg bg-danger-50 px-2.5 py-1.5 text-[0.8125rem] font-medium text-danger-700 ring-1 ring-inset ring-danger-100">
                  {name}
                </code>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4 rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="text-sm font-semibold text-ink-950">How to fix it</h2>
          <ol className="mt-3 space-y-3.5">
            {[
              {
                title: 'Generate a value for each missing variable',
                body: (
                  <code className="mt-1.5 block overflow-x-auto rounded-lg bg-ink-950 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-ink-200">
                    node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;hex&apos;))&quot;
                  </code>
                ),
              },
              {
                title: 'Add them in Vercel',
                body: (
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">
                    Project → Settings → Environment Variables, scoped to Production.
                  </p>
                ),
              },
              {
                title: 'Redeploy',
                body: (
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">
                    This page will hand you straight to the dashboard.
                  </p>
                ),
              },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[0.6875rem] font-bold text-brand-700">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] font-medium text-ink-800">{step.title}</p>
                  {step.body}
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-xs leading-relaxed text-ink-500">
            <LockIcon size={15} className="mt-px shrink-0 text-ink-400" />
            <span>
              <code className="font-medium text-ink-700">ADMIN_PASSWORD</code> is the dashboard
              password. <code className="font-medium text-ink-700">SESSION_SECRET</code> signs the
              session cookie. Keep both server-side and never commit them.
            </span>
          </p>
        </section>

        <p className="mt-5 text-center text-xs text-ink-400">
          <a href="/api/health" className="rounded underline underline-offset-2 hover:text-ink-600">
            /api/health
          </a>{' '}
          remains available for uptime monitoring.
        </p>
      </div>
    </main>
  );
}

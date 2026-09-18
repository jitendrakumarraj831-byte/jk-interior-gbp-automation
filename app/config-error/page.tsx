/**
 * Shown when a production deployment is missing its admin credentials.
 *
 * This is what "fail securely" looks like from the outside: the dashboard is
 * not served at all, and the page names the missing variables — names only,
 * never values, and nothing about the Google or AI configuration.
 */

import { isAdminAuthMisconfigured, missingAdminAuthVars } from '@/lib/config';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Configuration required' };

export default function ConfigErrorPage() {
  // If the deployment is healthy there is nothing to show here.
  if (!isAdminAuthMisconfigured()) redirect('/dashboard');

  const missing = missingAdminAuthVars();

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 text-sm font-bold text-white">
            JK
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">JK Interior</p>
            <p className="text-xs text-ink-500">GBP Automation</p>
          </div>
        </div>

        <section className="rounded-2xl border border-danger-50 bg-danger-50 p-5">
          <h1 className="text-lg font-semibold text-ink-900">Configuration required</h1>
          <p className="mt-2 text-sm text-ink-700">
            This deployment is running in production without admin authentication configured, so
            the dashboard and every admin API are refusing requests. Nothing is reachable without a
            signed-in session — by design.
          </p>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Missing environment {missing.length === 1 ? 'variable' : 'variables'}
          </p>
          <ul className="mt-1.5 space-y-1">
            {missing.map((name) => (
              <li key={name}>
                <code className="rounded-lg bg-surface px-2 py-1 text-sm text-ink-900">{name}</code>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4 rounded-2xl border border-hairline bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-900">How to fix it</h2>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-ink-700">
            <li>
              Generate a value for each missing variable:
              <code className="mt-1 block overflow-x-auto rounded-lg bg-canvas px-3 py-2 text-xs">
                node -e
                &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;hex&apos;))&quot;
              </code>
            </li>
            <li>
              Add them in Vercel under <strong>Project → Settings → Environment Variables</strong>,
              scoped to Production.
            </li>
            <li>Redeploy. This page will hand you straight to the dashboard.</li>
          </ol>
          <p className="mt-3 text-xs text-ink-500">
            <code>ADMIN_PASSWORD</code> is the dashboard password. <code>SESSION_SECRET</code> signs
            the session cookie — keep both server-side and never commit them.
          </p>
        </section>

        <p className="mt-4 text-center text-xs text-ink-500">
          <a href="/api/health" className="underline underline-offset-2 hover:text-ink-700">
            /api/health
          </a>{' '}
          remains available for uptime monitoring.
        </p>
      </div>
    </main>
  );
}

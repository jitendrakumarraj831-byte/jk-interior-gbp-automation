/**
 * Public landing page.
 *
 * Deliberately contains no business data and no configuration detail — it is
 * reachable without signing in.
 */

import Link from 'next/link';

const MODULES = [
  { title: 'Google Reviews', body: 'Pull every review with rating, text, date and reply state.' },
  { title: 'AI Reply Drafts', body: 'Draft replies in English, Hindi or Hinglish — never auto-sent.' },
  { title: 'Manual Approval', body: 'Nothing reaches Google until you read it and press Publish.' },
  { title: 'Business Posts', body: 'Offers, project updates, service promos and festival greetings.' },
  { title: 'Scheduled Posts', body: 'Queue posts and let Vercel Cron publish them on time.' },
  { title: 'Performance', body: 'Views, calls, website clicks and direction requests from Google.' },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-10 sm:px-8 sm:py-16">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 text-sm font-bold text-white">
          JK
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-900">JK Interior</p>
          <p className="text-xs text-ink-500">Google Business Profile Automation</p>
        </div>
      </div>

      <div className="mt-10 max-w-2xl sm:mt-16">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
          Your Google Business Profile, handled.
        </h1>
        <p className="mt-4 text-base text-ink-700 sm:text-lg">
          Reviews collected, replies drafted for you, posts scheduled and performance tracked — with
          a human approval step before anything is published to Google.
        </p>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            Open dashboard
          </Link>
          <Link
            href="/api/health"
            className="rounded-xl bg-surface px-5 py-3 text-sm font-medium text-ink-900 ring-1 ring-inset ring-hairline transition-colors hover:bg-canvas"
          >
            System health
          </Link>
        </div>
      </div>

      <div className="mt-12 grid gap-3 sm:mt-16 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((module) => (
          <div key={module.title} className="rounded-2xl border border-hairline bg-surface p-4">
            <p className="text-sm font-semibold text-ink-900">{module.title}</p>
            <p className="mt-1 text-sm text-ink-500">{module.body}</p>
          </div>
        ))}
      </div>

      <footer className="mt-auto pt-12 text-xs text-ink-500">
        <p>
          JK Interior ·{' '}
          <a
            href="https://www.jkinterior.online"
            className="underline underline-offset-2 hover:text-ink-700"
            rel="noreferrer noopener"
            target="_blank"
          >
            www.jkinterior.online
          </a>
        </p>
      </footer>
    </main>
  );
}

/**
 * Public landing page.
 *
 * Deliberately contains no business data and no configuration detail — it is
 * reachable without signing in.
 */

import Link from 'next/link';

import {
  AutomationIcon,
  ChartIcon,
  CheckIcon,
  ChevronRightIcon,
  GoogleIcon,
  PostIcon,
  ShieldIcon,
  SparkIcon,
  StarIcon,
} from '@/components/icons';

const MODULES = [
  {
    title: 'Google Reviews',
    body: 'Every review with its rating, text, date and reply status in one list.',
    icon: <StarIcon size={20} />,
    accent: 'bg-warning-50 text-warning-700 ring-warning-100',
  },
  {
    title: 'AI Reply Drafts',
    body: 'Replies drafted in English, Hindi or Hinglish — matched to how the customer wrote.',
    icon: <SparkIcon size={20} />,
    accent: 'bg-ai-50 text-ai-700 ring-ai-100',
  },
  {
    title: 'Manual Approval',
    body: 'Nothing reaches Google until you have read it and pressed Publish.',
    icon: <ShieldIcon size={20} />,
    accent: 'bg-brand-50 text-brand-700 ring-brand-100',
  },
  {
    title: 'Business Posts',
    body: 'Offers, project updates, service promotions and festival greetings.',
    icon: <PostIcon size={20} />,
    accent: 'bg-info-50 text-info-700 ring-info-100',
  },
  {
    title: 'Scheduled Publishing',
    body: 'Queue a post once and let it publish itself at the right moment.',
    icon: <AutomationIcon size={20} />,
    accent: 'bg-google-50 text-google-700 ring-google-100',
  },
  {
    title: 'Performance',
    body: 'Views, calls, website clicks and direction requests, straight from Google.',
    icon: <ChartIcon size={20} />,
    accent: 'bg-success-50 text-success-700 ring-success-100',
  },
];

const STEPS = [
  'Google review arrives',
  'A reply is drafted for you',
  'You approve or edit it',
  'Published to Google',
];

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50/60 via-canvas to-canvas">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <span className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-[0.8125rem] font-bold text-white shadow-brand">
            JK
          </span>
          <span>
            <span className="block text-sm font-semibold leading-tight text-ink-950">JK Interior</span>
            <span className="block text-[0.6875rem] leading-tight text-ink-500">
              Business Profile Automation
            </span>
          </span>
        </span>
        <Link
          href="/dashboard"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white shadow-brand transition-colors hover:bg-brand-700"
        >
          Open dashboard
          <ChevronRightIcon size={16} />
        </Link>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8">
        <section className="py-10 sm:py-16">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-600 ring-1 ring-line">
            <GoogleIcon size={14} className="text-google-600" />
            For the JK Interior Google Business Profile
          </span>
          <h1 className="mt-5 max-w-3xl text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink-950 sm:text-[3.25rem]">
            Your Google Business Profile, handled.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-600 sm:text-lg">
            Reviews collected, replies drafted for you, posts scheduled and performance tracked —
            with a human approval step before anything is published.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[0.9375rem] font-medium text-white shadow-brand transition-colors hover:bg-brand-700"
            >
              Open dashboard
              <ChevronRightIcon size={17} />
            </Link>
            <Link
              href="/api/health"
              className="inline-flex min-h-12 items-center rounded-xl bg-surface px-5 text-[0.9375rem] font-medium text-ink-800 ring-1 ring-inset ring-line transition-colors hover:bg-subtle"
            >
              System health
            </Link>
          </div>
        </section>

        <section className="rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-brand-600">
            How replies work
          </p>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-4">
            {STEPS.map((step, index) => (
              <div key={step} className="rounded-xl bg-subtle px-3.5 py-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-[0.6875rem] font-bold text-white">
                  {index + 1}
                </span>
                <p className="mt-2 text-[0.8125rem] font-medium leading-snug text-ink-800">{step}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 flex items-start gap-2 text-[0.8125rem] leading-relaxed text-ink-500">
            <CheckIcon size={16} className="mt-0.5 shrink-0 text-success-600" />
            Automatic publishing is off by default. Approved replies still wait for you.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold tracking-[-0.015em] text-ink-950">
            Everything in one place
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((module) => (
              <div
                key={module.title}
                className="rounded-card border border-line bg-surface p-4 shadow-card transition-shadow duration-200 hover:shadow-raised"
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset ${module.accent}`}
                >
                  {module.icon}
                </span>
                <p className="mt-3 text-sm font-semibold text-ink-950">{module.title}</p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">{module.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-ink-500 sm:px-8">
          <p>JK Interior · Google Business Profile Automation</p>
          <a
            href="https://www.jkinterior.online"
            className="rounded underline underline-offset-2 hover:text-ink-800"
            rel="noreferrer noopener"
            target="_blank"
          >
            www.jkinterior.online
          </a>
        </div>
      </footer>
    </div>
  );
}

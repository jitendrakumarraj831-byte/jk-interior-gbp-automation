'use client';

/**
 * Dashboard navigation.
 *
 * Desktop: a fixed left rail. Mobile: a bottom tab bar for the five most-used
 * sections plus a slide-over sheet for the rest — the dashboard is mostly
 * driven from a phone, so the primary actions stay inside thumb reach.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/client';

export type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: string;
  primary?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', short: 'Home', icon: 'M3 10.5 12 3l9 7.5V21H3z', primary: true },
  { href: '/dashboard/reviews', label: 'Reviews', short: 'Reviews', icon: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z', primary: true },
  { href: '/dashboard/drafts', label: 'AI Reply Drafts', short: 'Drafts', icon: 'M4 4h16v12H7l-3 3z', primary: true },
  { href: '/dashboard/posts', label: 'Posts', short: 'Posts', icon: 'M4 5h16v14H4z M8 9h8 M8 13h5', primary: true },
  { href: '/dashboard/scheduled', label: 'Scheduled Posts', short: 'Queue', icon: 'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', primary: true },
  { href: '/dashboard/performance', label: 'Performance', short: 'Stats', icon: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2' },
  { href: '/dashboard/connection', label: 'Google Connection', short: 'Google', icon: 'M12 3a9 9 0 1 0 9 9h-9z' },
  { href: '/dashboard/automation', label: 'Automation Status', short: 'Auto', icon: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { href: '/dashboard/settings', label: 'Settings', short: 'Settings', icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M4 12h2 M18 12h2 M12 4v2 M12 18v2' },
];

function Icon({ path, active }: { path: string; active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-5 w-5 shrink-0 ${active ? 'stroke-brand-600' : 'stroke-ink-500'}`}
    >
      {path.split(' M').map((segment, index) => (
        <path key={index} d={index === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname.startsWith(href);
}

/* ------------------------------ desktop rail ----------------------------- */

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="hidden w-64 shrink-0 border-r border-hairline bg-surface lg:flex lg:flex-col">
      <div className="px-5 py-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">
            JK
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink-900">JK Interior</span>
            <span className="block truncate text-xs text-ink-500">GBP Automation</span>
          </span>
        </Link>
      </div>
      <div className="flex-1 space-y-0.5 px-3 pb-6">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                active
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-ink-700 hover:bg-canvas'
              }`}
            >
              <Icon path={item.icon} active={active} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* --------------------------- mobile top + sheet -------------------------- */

export function MobileHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const current = NAV_ITEMS.find((item) => isActive(pathname, item.href));

  async function signOut() {
    // Through the api helper so the request carries the CSRF header and is
    // sent same-origin only.
    await api.post('/api/auth/logout').catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-hairline bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
            JK
          </span>
          <span className="truncate text-sm font-semibold text-ink-900">
            {current?.label ?? 'JK Interior'}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label="More sections"
          className="rounded-lg p-2 text-ink-700 hover:bg-canvas"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 stroke-current" fill="none" strokeWidth={1.8}>
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink-900/25"
          />
          <div className="absolute inset-x-0 top-0 max-h-[85vh] overflow-y-auto rounded-b-3xl bg-surface p-4 shadow-xl">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
              All sections
            </p>
            <div className="grid grid-cols-2 gap-2">
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2 rounded-xl px-3 py-3 text-sm ${
                      active ? 'bg-brand-50 font-medium text-brand-700' : 'bg-canvas text-ink-700'
                    }`}
                  >
                    <Icon path={item.icon} active={active} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-3 w-full rounded-xl bg-canvas px-3 py-3 text-sm font-medium text-ink-700"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------ mobile tabs ------------------------------ */

export function MobileTabBar() {
  const pathname = usePathname();
  const tabs = NAV_ITEMS.filter((item) => item.primary);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-hairline bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {tabs.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${
              active ? 'font-medium text-brand-700' : 'text-ink-500'
            }`}
          >
            <Icon path={item.icon} active={active} />
            <span className="truncate px-1">{item.short}</span>
          </Link>
        );
      })}
    </nav>
  );
}

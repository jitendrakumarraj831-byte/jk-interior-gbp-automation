'use client';

/**
 * Application shell.
 *
 * Desktop: a fixed left sidebar plus a slim top header.
 * Mobile:  a sticky compact header, a five-slot bottom tab bar for the sections
 *          used daily, and a bottom sheet for everything else.
 *
 * The five bottom tabs are Home / Reviews / Drafts / Posts / Performance. Every
 * other destination lives in the sheet, so the primary actions stay inside
 * thumb reach on a phone.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { api } from '@/lib/client';
import { Avatar, Badge, TONE_SOFT, type Tone } from './ui';
import {
  AutomationIcon,
  BellIcon,
  CalendarIcon,
  ChartIcon,
  CloseIcon,
  GoogleIcon,
  HelpIcon,
  HomeIcon,
  InboxIcon,
  LogoutIcon,
  MenuIcon,
  PinIcon,
  PostIcon,
  SettingsIcon,
  ShieldIcon,
  SparkIcon,
  StarIcon,
} from './icons';

type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: (props: { size?: number; className?: string }) => ReactNode;
  tone: Tone;
};

/** Daily-use sections. These become the mobile bottom tabs, in this order. */
export const PRIMARY_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', short: 'Home', icon: HomeIcon, tone: 'brand' },
  { href: '/dashboard/reviews', label: 'Reviews', short: 'Reviews', icon: StarIcon, tone: 'warning' },
  { href: '/dashboard/drafts', label: 'AI Reply Drafts', short: 'Drafts', icon: SparkIcon, tone: 'ai' },
  { href: '/dashboard/posts', label: 'Business Posts', short: 'Posts', icon: PostIcon, tone: 'info' },
  {
    href: '/dashboard/performance',
    label: 'Performance',
    short: 'Insights',
    icon: ChartIcon,
    tone: 'success',
  },
];

/** Secondary destinations. Sidebar on desktop, bottom sheet on mobile. */
export const SECONDARY_NAV: NavItem[] = [
  {
    href: '/dashboard/scheduled',
    label: 'Scheduled Posts',
    short: 'Queue',
    icon: CalendarIcon,
    tone: 'info',
  },
  {
    href: '/dashboard/connection',
    label: 'Google Connection',
    short: 'Google',
    icon: GoogleIcon,
    tone: 'google',
  },
  {
    href: '/dashboard/automation',
    label: 'Automation',
    short: 'Automation',
    icon: AutomationIcon,
    tone: 'brand',
  },
  {
    href: '/dashboard/notifications',
    label: 'Notifications',
    short: 'Alerts',
    icon: BellIcon,
    tone: 'warning',
  },
  {
    href: '/dashboard/health',
    label: 'System Health',
    short: 'Health',
    icon: ShieldIcon,
    tone: 'success',
  },
  {
    href: '/dashboard/audit',
    label: 'Audit Log',
    short: 'Audit',
    icon: InboxIcon,
    tone: 'neutral',
  },
  { href: '/dashboard/settings', label: 'Settings', short: 'Settings', icon: SettingsIcon, tone: 'neutral' },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function currentItem(pathname: string): NavItem | undefined {
  return [...PRIMARY_NAV, ...SECONDARY_NAV].find((item) => isActive(pathname, item.href));
}

/* ================================== logo ================================= */

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-[0.8125rem] font-bold tracking-tight text-white shadow-brand">
        JK
      </span>
      {compact ? null : (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight tracking-[-0.011em] text-ink-950">
            JK Interior
          </span>
          <span className="block truncate text-[0.6875rem] leading-tight text-ink-500">
            Business Profile Automation
          </span>
        </span>
      )}
    </span>
  );
}

/* ================================ sidebar ================================ */

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Glyph = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-150 ${
        active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-600 hover:bg-subtle hover:text-ink-900'
      }`}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-600" />
      ) : null}
      <Glyph size={19} className={active ? 'text-brand-600' : 'text-ink-400 group-hover:text-ink-600'} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-y-0 left-0 hidden w-[17rem] shrink-0 flex-col border-r border-line bg-surface lg:flex"
    >
      <div className="px-5 py-5">
        <Link href="/dashboard" className="block rounded-xl">
          <Wordmark />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-3 pb-1.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-400">
          Workspace
        </p>
        <div className="space-y-0.5">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </div>

        <p className="px-3 pb-1.5 pt-5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-400">
          Manage
        </p>
        <div className="space-y-0.5">
          {SECONDARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </div>
      </div>

      <div className="border-t border-line p-3">
        <a
          href="https://www.jkinterior.online"
          target="_blank"
          rel="noreferrer noopener"
          className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-ink-600 transition-colors hover:bg-subtle hover:text-ink-900"
        >
          <PinIcon size={19} className="text-ink-400" />
          <span className="truncate">jkinterior.online</span>
        </a>
      </div>
    </nav>
  );
}

/* ============================== account menu ============================= */

function AccountMenu({ authEnabled }: { authEnabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await api.post('/api/auth/logout').catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-line hover:shadow-xs"
      >
        <Avatar name="JK Interior" size={32} />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close account menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 top-11 z-50 w-60 animate-pop-in origin-top-right rounded-card border border-line bg-surface p-1.5 shadow-pop"
          >
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <Avatar name="JK Interior" size={36} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-950">JK Interior</p>
                <p className="truncate text-xs text-ink-500">Business owner</p>
              </div>
            </div>
            <div className="my-1 h-px bg-line" />
            <Link
              href="/dashboard/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-700 hover:bg-subtle"
            >
              <SettingsIcon size={17} className="text-ink-400" />
              Settings
            </Link>
            <Link
              href="/dashboard/connection"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-700 hover:bg-subtle"
            >
              <GoogleIcon size={17} className="text-ink-400" />
              Google connection
            </Link>
            {authEnabled ? (
              <>
                <div className="my-1 h-px bg-line" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void signOut()}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-700 hover:bg-subtle"
                >
                  <LogoutIcon size={17} className="text-ink-400" />
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ================================= header ================================ */

/**
 * `alertCount` is the number of real setup warnings the server reported. It is
 * never a decorative badge — zero warnings means no indicator.
 */
export function TopBar({
  alertCount = 0,
  authEnabled,
  onOpenMenu,
}: {
  alertCount?: number;
  authEnabled: boolean;
  onOpenMenu: () => void;
}) {
  const pathname = usePathname();
  const item = currentItem(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 shadow-[0_1px_0_0_rgb(16_24_40/0.02),0_4px_16px_-12px_rgb(16_24_40/0.25)] backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2.5 px-4 sm:h-16 sm:gap-3 sm:px-6">
        {/* Mobile: logo + current section. Desktop: section title only. */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Link href="/dashboard" className="shrink-0 lg:hidden">
            <Wordmark compact />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] font-semibold leading-tight tracking-[-0.014em] text-ink-950">
              {item?.label ?? 'Dashboard'}
            </p>
            <p className="truncate text-[0.6875rem] leading-tight text-ink-500">
              JK Interior
            </p>
          </div>
        </div>

        <Link
          href="/dashboard/settings"
          aria-label={
            alertCount > 0
              ? `${alertCount} setup ${alertCount === 1 ? 'item needs' : 'items need'} attention`
              : 'No setup items need attention'
          }
          className="press relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-500 hover:bg-subtle hover:text-ink-800"
        >
          <BellIcon size={19} />
          {alertCount > 0 ? (
            <span className="tnum absolute -right-1 -top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-warning-600 px-1 text-[0.6875rem] font-bold text-white ring-2 ring-surface">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          ) : null}
        </Link>

        <AccountMenu authEnabled={authEnabled} />

        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-600 hover:bg-subtle lg:hidden"
        >
          <MenuIcon size={20} />
        </button>
      </div>
    </header>
  );
}

/* ============================== bottom sheet ============================= */

export function NavSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

  // Lock body scroll and close on Escape while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 animate-scrim bg-ink-950/35 backdrop-blur-[2px]"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[88vh] animate-sheet-up overflow-y-auto rounded-t-3xl bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-pop">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <Wordmark />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-subtle"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="px-4 py-4">
          <p className="pb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-400">
            Workspace
          </p>
          <div className="grid grid-cols-2 gap-2">
            {PRIMARY_NAV.map((sheetItem) => {
              const Glyph = sheetItem.icon;
              const active = isActive(pathname, sheetItem.href);
              return (
                <Link
                  key={sheetItem.href}
                  href={sheetItem.href}
                  onClick={onClose}
                  className={`flex min-h-[3.25rem] items-center gap-2.5 rounded-xl px-3 text-sm transition-colors ${
                    active
                      ? 'bg-brand-50 font-semibold text-brand-700 ring-1 ring-inset ring-brand-100'
                      : 'bg-subtle text-ink-700'
                  }`}
                >
                  <Glyph size={19} className={active ? 'text-brand-600' : 'text-ink-400'} />
                  <span className="truncate">{sheetItem.short}</span>
                </Link>
              );
            })}
          </div>

          <p className="pb-2 pt-5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-400">
            Manage
          </p>
          <div className="space-y-1">
            {SECONDARY_NAV.map((sheetItem) => {
              const Glyph = sheetItem.icon;
              const active = isActive(pathname, sheetItem.href);
              return (
                <Link
                  key={sheetItem.href}
                  href={sheetItem.href}
                  onClick={onClose}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
                    active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-700 hover:bg-subtle'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      TONE_SOFT[sheetItem.tone]
                    }`}
                  >
                    <Glyph size={17} />
                  </span>
                  <span className="truncate">{sheetItem.label}</span>
                </Link>
              );
            })}

            <a
              href="https://www.jkinterior.online"
              target="_blank"
              rel="noreferrer noopener"
              onClick={onClose}
              className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm text-ink-700 hover:bg-subtle"
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TONE_SOFT.neutral}`}>
                <HelpIcon size={17} />
              </span>
              <span className="truncate">Help &amp; website</span>
              <Badge tone="neutral" className="ml-auto">
                jkinterior.online
              </Badge>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =============================== bottom tabs ============================= */

export function BottomTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_-12px_rgb(16_24_40/0.3)] backdrop-blur-xl lg:hidden"
    >
      <div className="grid grid-cols-5">
        {PRIMARY_NAV.map((item) => {
          const Glyph = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className="group flex min-h-[3.5rem] flex-col items-center justify-center gap-1 px-1 active:scale-[0.96]"
              style={{ transition: 'transform 0.12s var(--ease-out-soft)' }}
            >
              <span
                className={`flex h-7 w-[3.25rem] items-center justify-center rounded-full transition-all duration-200 ${
                  active ? 'bg-brand-600 text-white shadow-brand' : 'text-ink-400 group-hover:bg-subtle'
                }`}
              >
                <Glyph size={19} />
              </span>
              <span
                className={`max-w-full truncate text-[0.6875rem] leading-none transition-colors ${
                  active ? 'font-semibold text-brand-700' : 'text-ink-500'
                }`}
              >
                {item.short}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ================================= shell ================================= */

export function AppShell({
  children,
  authEnabled,
  banner,
}: {
  children: ReactNode;
  authEnabled: boolean;
  banner?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  // The bell reflects real server-reported setup warnings, nothing decorative.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ warnings: string[] }>('/api/status')
      .then((response) => {
        if (!cancelled) setAlertCount(response.data?.warnings.length ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-dvh lg:pl-[17rem]">
      <Sidebar />
      <div className="flex min-h-dvh flex-col">
        <TopBar alertCount={alertCount} authEnabled={authEnabled} onOpenMenu={() => setMenuOpen(true)} />
        {banner}
        <main className="mx-auto w-full max-w-[80rem] flex-1 px-4 pb-28 pt-4 sm:px-6 sm:pb-10 sm:pt-6 lg:px-8">
          {children}
        </main>
        <BottomTabs />
        <NavSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
      </div>
    </div>
  );
}

/**
 * Design-system primitives.
 *
 * Everything visual in the dashboard is composed from these. They are pure
 * presentation — no data fetching, no server imports — so they render on both
 * sides of the boundary.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import { ArrowRightIcon, CheckIcon, ChevronRightIcon, StarIcon } from './icons';

/* ============================== tone system ============================== */

export type Tone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'ai'
  | 'google'
  | 'cyan'
  | 'teal';

/** Soft fill + text, for badges and icon tiles. */
export const TONE_SOFT: Record<Tone, string> = {
  neutral: 'bg-subtle text-ink-700',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-info-50 text-info-700',
  ai: 'bg-ai-50 text-ai-700',
  google: 'bg-google-50 text-google-700',
  cyan: 'bg-cyan-50 text-cyan-700',
  teal: 'bg-teal-50 text-teal-700',
};

/** Hairline ring matching each tone. */
const TONE_RING: Record<Tone, string> = {
  neutral: 'ring-line',
  brand: 'ring-brand-100',
  success: 'ring-success-100',
  warning: 'ring-warning-100',
  danger: 'ring-danger-100',
  info: 'ring-info-100',
  ai: 'ring-ai-100',
  google: 'ring-google-100',
  cyan: 'ring-cyan-100',
  teal: 'ring-teal-100',
};

/** Solid dot, for status indicators. */
const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-ink-400',
  brand: 'bg-brand-500',
  success: 'bg-success-600',
  warning: 'bg-warning-600',
  danger: 'bg-danger-600',
  info: 'bg-info-600',
  ai: 'bg-ai-600',
  google: 'bg-google-600',
  cyan: 'bg-cyan-600',
  teal: 'bg-teal-600',
};

/* ================================= card ================================== */

export function Card({
  children,
  className = '',
  padded = true,
  interactive = false,
  as: As = 'section',
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  /** Adds hover elevation. Only for cards that are themselves clickable. */
  interactive?: boolean;
  as?: 'section' | 'div' | 'article' | 'li';
}) {
  return (
    <As
      className={`rounded-card border border-line bg-surface shadow-card ${
        padded ? 'p-4 sm:p-5' : ''
      } ${
        interactive
          ? 'transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised'
          : ''
      } ${className}`}
    >
      {children}
    </As>
  );
}

/** Section heading inside a card or a page region. */
export function SectionHeader({
  title,
  description,
  action,
  icon,
  tone = 'neutral',
  className = '',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={`mb-3 flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${TONE_SOFT[tone]} ${TONE_RING[tone]}`}
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[1rem] font-semibold tracking-[-0.014em] text-ink-950">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-500">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Page-level heading. */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-5">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-brand-600">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[1.5rem] font-semibold tracking-[-0.022em] text-ink-950 sm:text-[1.75rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[0.875rem] leading-relaxed text-ink-500 sm:text-[0.9375rem]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </header>
  );
}

/* ================================= badge ================================= */

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONE_SOFT[tone]} ${TONE_RING[tone]} ${className}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Live status pill with a soft pulse, for connection state. */
export function StatusPill({
  tone,
  children,
  pulse = false,
}: {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${TONE_SOFT[tone]} ${TONE_RING[tone]}`}
    >
      <span className="relative flex h-2 w-2">
        {pulse ? (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${TONE_DOT[tone]}`}
          />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
      </span>
      {children}
    </span>
  );
}

/* ================================ button ================================= */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-brand hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 disabled:shadow-none',
  secondary:
    'bg-surface text-ink-800 ring-1 ring-inset ring-line shadow-xs hover:bg-subtle hover:ring-line-strong disabled:text-ink-300',
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:text-brand-300',
  ghost: 'text-ink-600 hover:bg-subtle hover:text-ink-900 disabled:text-ink-300',
  danger:
    'bg-surface text-danger-600 ring-1 ring-inset ring-danger-100 hover:bg-danger-50 disabled:text-danger-200',
};

/* Min heights hit the 44px touch target on mobile without looking chunky on
   desktop, where the same control sits at 36–40px. */
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-[0.8125rem] gap-1.5',
  md: 'min-h-11 sm:min-h-10 px-4 text-sm gap-2',
  lg: 'min-h-12 px-5 text-[0.9375rem] gap-2',
};

const BUTTON_BASE =
  'inline-flex items-center justify-center rounded-xl font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 select-none';

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${className}`}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

/** Anchor styled as a button, for real navigations (OAuth, external links). */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  className = '',
  external = false,
  disabled = false,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  className?: string;
  external?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const classes = `${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${
    disabled ? 'pointer-events-none opacity-50' : ''
  } ${className}`;

  if (external) {
    return (
      <a
        href={href}
        className={classes}
        aria-disabled={disabled || undefined}
        {...(href.startsWith('http') ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      >
        {icon}
        {children}
        {iconRight}
      </a>
    );
  }

  return (
    <Link href={href} className={classes} aria-disabled={disabled || undefined}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 animate-spin ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/* ================================ metrics ================================ */

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  loading = false,
  className = '',
}: {
  label: string;
  value: string | number | null;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`press rounded-card border border-line bg-surface p-3.5 shadow-card hover:border-line-strong hover:shadow-raised sm:p-4 ${className}`}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONE_SOFT[tone]}`}
          >
            {icon}
          </span>
        ) : null}
        <p className="min-w-0 truncate text-[0.8125rem] font-medium text-ink-600">{label}</p>
      </div>
      {loading ? (
        <Skeleton className="mt-2.5 h-7 w-16" />
      ) : (
        <p className="tnum mt-2 text-[1.625rem] font-semibold leading-none tracking-[-0.02em] text-ink-950">
          {value ?? '—'}
        </p>
      )}
      {hint ? <p className="mt-1.5 line-clamp-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

/** Two columns on a phone, four on desktop. The KPI row of the dashboard. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/**
 * Horizontally scrollable rail on mobile, grid on larger screens.
 * Metric cards are the one place a rail beats stacking: it keeps the fold
 * useful on a 360px phone without shrinking the numbers.
 */
export function MetricRail({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4 ${className}`}
    >
      {children}
    </div>
  );
}

/** Wrapper that gives a rail child a sensible fixed width on mobile only. */
export function RailItem({ children }: { children: ReactNode }) {
  return <div className="w-[13.5rem] shrink-0 sm:w-auto sm:shrink">{children}</div>;
}

/* ============================== feedback ================================= */

export function Callout({
  tone = 'info',
  title,
  icon,
  action,
  children,
}: {
  tone?: Tone;
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const border: Record<Tone, string> = {
    neutral: 'border-line bg-subtle',
    brand: 'border-brand-100 bg-brand-50',
    success: 'border-success-100 bg-success-50',
    warning: 'border-warning-100 bg-warning-50',
    danger: 'border-danger-100 bg-danger-50',
    info: 'border-info-100 bg-info-50',
    ai: 'border-ai-100 bg-ai-50',
    google: 'border-google-100 bg-google-50',
    cyan: 'border-cyan-100 bg-cyan-50',
    teal: 'border-teal-100 bg-teal-50',
  };

  return (
    <div className={`animate-fade-in rounded-card border p-4 ${border[tone]}`}>
      <div className="flex gap-3">
        {icon ? <span className={`mt-0.5 shrink-0 ${TONE_SOFT[tone].split(' ')[1]}`}>{icon}</span> : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-900">{title}</p>
          {children ? (
            <div className="mt-1 text-sm leading-relaxed text-ink-700">{children}</div>
          ) : null}
          {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Empty state.
 *
 * Always answers three questions: what is missing, why it matters, what to do
 * next. That contract is why this takes `description` and `action` rather than
 * arbitrary children.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: Tone;
  /** Even tighter, for a section that sits inside another card. */
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-card border border-dashed border-line-strong bg-subtle/50 px-5 text-center ${
        compact ? 'py-5' : 'py-6 sm:py-7'
      }`}
    >
      {icon ? (
        <span
          className={`mb-2.5 flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset ${TONE_SOFT[tone]} ${TONE_RING[tone]}`}
        >
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-xs text-[0.8125rem] leading-relaxed text-ink-500">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/* ============================== skeletons ================================ */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-shimmer rounded-lg bg-ink-200/70 ${className}`} />;
}

export function SkeletonCard({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <Card className={className}>
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton key={index} className={`h-3 ${index === lines - 1 ? 'w-2/3' : 'w-full'}`} />
        ))}
      </div>
    </Card>
  );
}

export function SkeletonMetrics({ count = 4 }: { count?: number }) {
  return (
    <KpiGrid>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-card border border-line bg-surface p-3.5 shadow-card sm:p-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="mt-3 h-7 w-14" />
          <Skeleton className="mt-2 h-2.5 w-24" />
        </div>
      ))}
    </KpiGrid>
  );
}

/* ================================ misc =================================== */

export function Stars({ rating, size = 15 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon
          key={n}
          size={size}
          className={n <= rating ? 'fill-gold-400 text-gold-500' : 'fill-none text-ink-300'}
        />
      ))}
    </span>
  );
}

/** Initials avatar. Deterministic tone so the same person keeps the same colour. */
export function Avatar({
  name,
  size = 40,
  src,
}: {
  name: string;
  size?: number;
  src?: string;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?';

  const palette: Tone[] = ['brand', 'info', 'ai', 'google', 'warning'];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const tone = palette[hash % palette.length] as Tone;

  if (src) {
    return (
      // Remote Google avatars: plain <img> avoids configuring remotePatterns for
      // a host list Google does not publish.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover ring-1 ring-line"
        style={{ width: size, height: size }}
        loading="lazy"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${TONE_SOFT[tone]}`}
    >
      {initials}
    </span>
  );
}

/** Thin progress bar, used by the setup checklist. */
export function Progress({ value, total, tone = 'brand' }: { value: number; total: number; tone?: Tone }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-ink-200"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label="Setup progress"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${TONE_DOT[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Segmented control for small mutually-exclusive choices (filters, ranges). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex shrink-0 rounded-xl bg-subtle p-0.5 ring-1 ring-inset ring-line"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-9 rounded-[0.625rem] px-3 text-[0.8125rem] font-medium transition-all duration-150 disabled:opacity-50 ${
              active
                ? 'bg-surface text-ink-900 shadow-xs'
                : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The small "View all" / "Details" link that sits beside a section title.
 * Padded to a proper tap target, with negative margin so it still lines up
 * optically with the heading.
 */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="press -mr-2 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[0.8125rem] font-medium text-brand-700 hover:bg-brand-50"
    >
      {children}
      <ChevronRightIcon size={14} />
    </Link>
  );
}

/** Row that navigates somewhere. Used in quick actions and list cards. */
export function NavRow({
  href,
  icon,
  title,
  meta,
  tone = 'neutral',
}: {
  href: string;
  icon?: ReactNode;
  title: string;
  meta?: ReactNode;
  tone?: Tone;
}) {
  return (
    <Link
      href={href}
      className="press group flex min-h-[3rem] items-center gap-3 rounded-xl px-2.5 hover:bg-subtle active:bg-brand-50"
    >
      {icon ? (
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-150 group-hover:scale-105 ${TONE_SOFT[tone]}`}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[0.875rem] font-medium text-ink-800">
        {title}
      </span>
      {meta}
      <ChevronRightIcon
        size={16}
        className="shrink-0 text-ink-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-500"
      />
    </Link>
  );
}

/**
 * Feature card — icon, title, description, live count, arrow.
 * The accent tone is contextual: reviews are brand, AI is violet, and so on.
 */
export function FeatureCard({
  href,
  icon,
  title,
  description,
  count,
  countLabel,
  tone = 'brand',
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  count?: number | string | null;
  countLabel?: string;
  tone?: Tone;
}) {
  return (
    <Link
      href={href}
      className="press group flex flex-col rounded-card border border-line bg-surface p-3.5 shadow-card hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised sm:p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset ${TONE_SOFT[tone]} ${TONE_RING[tone]}`}
        >
          {icon}
        </span>
        <ArrowRightIcon
          size={15}
          className="mt-1 shrink-0 text-ink-300 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-ink-600"
        />
      </div>
      <p className="mt-2.5 text-[0.9375rem] font-semibold leading-snug text-ink-950">{title}</p>
      <p className="mt-1 flex-1 text-[0.8125rem] leading-relaxed text-ink-500">{description}</p>
      {count != null ? (
        <p className="tnum mt-2.5 text-[0.8125rem] font-semibold text-ink-800">
          {count}
          {countLabel ? <span className="ml-1 font-normal text-ink-500">{countLabel}</span> : null}
        </p>
      ) : null}
    </Link>
  );
}

/** Checklist row for the onboarding component. */
export function ChecklistItem({
  icon,
  title,
  description,
  done,
  status,
  tone,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  done: boolean;
  status: string;
  tone: Tone;
  action?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
          done ? `${TONE_SOFT.success} ${TONE_RING.success}` : `${TONE_SOFT[tone]} ${TONE_RING[tone]}`
        }`}
      >
        {done ? <CheckIcon size={16} /> : icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[0.875rem] font-medium text-ink-900">{title}</p>
          <Badge tone={done ? 'success' : tone} dot>
            {status}
          </Badge>
        </div>
        <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-500">{description}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </li>
  );
}

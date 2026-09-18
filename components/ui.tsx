/**
 * Presentational building blocks shared across the dashboard.
 * No server imports here — these render on both sides.
 */

import type { ReactNode } from 'react';

/* ---------------------------------- card --------------------------------- */

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border border-hairline bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-16px_rgba(16,24,40,0.18)] ${
        padded ? 'p-4 sm:p-5' : ''
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------- badge --------------------------------- */

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'gold';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-canvas text-ink-700 ring-hairline',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  ok: 'bg-ok-50 text-ok-600 ring-ok-50',
  warn: 'bg-warn-50 text-warn-700 ring-warn-50',
  danger: 'bg-danger-50 text-danger-600 ring-danger-50',
  gold: 'bg-gold-100 text-warn-700 ring-gold-100',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* --------------------------------- button -------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary:
    'bg-surface text-ink-900 ring-1 ring-inset ring-hairline hover:bg-canvas disabled:text-ink-300',
  ghost: 'text-ink-700 hover:bg-canvas disabled:text-ink-300',
  danger: 'bg-danger-50 text-danger-600 ring-1 ring-inset ring-danger-50 hover:brightness-95',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  const sizing = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm';
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-colors disabled:cursor-not-allowed ${sizing} ${VARIANTS[variant]} ${className}`}
    />
  );
}

/* --------------------------------- alerts -------------------------------- */

export function Alert({
  tone = 'warn',
  title,
  children,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
}) {
  const border: Record<Tone, string> = {
    neutral: 'border-hairline bg-canvas',
    brand: 'border-brand-100 bg-brand-50',
    ok: 'border-ok-50 bg-ok-50',
    warn: 'border-gold-100 bg-warn-50',
    danger: 'border-danger-50 bg-danger-50',
    gold: 'border-gold-100 bg-warn-50',
  };
  return (
    <div className={`rounded-2xl border p-4 ${border[tone]}`}>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {children ? <div className="mt-1 text-sm text-ink-700">{children}</div> : null}
    </div>
  );
}

/* ------------------------------- stat cards ------------------------------ */

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
}) {
  const accent: Record<Tone, string> = {
    neutral: 'text-ink-900',
    brand: 'text-brand-700',
    ok: 'text-ok-600',
    warn: 'text-warn-700',
    danger: 'text-danger-600',
    gold: 'text-gold-500',
  };
  return (
    <Card className="min-w-0">
      <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums sm:text-3xl ${accent[tone]}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 line-clamp-2 text-xs text-ink-500">{hint}</p> : null}
    </Card>
  );
}

/* ------------------------------ empty / load ----------------------------- */

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline bg-surface/60 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{description}</p> : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-canvas ${className}`} />;
}

export function LoadingCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <Skeleton className="mb-3 h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="mb-2 h-3 w-full last:w-2/3" />
      ))}
    </Card>
  );
}

/* --------------------------------- stars --------------------------------- */

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`h-4 w-4 ${n <= rating ? 'fill-gold-500' : 'fill-ink-300'}`}
        >
          <path d="M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.2l-4.94 2.6.94-5.5-4-3.9 5.53-.8L10 1.6z" />
        </svg>
      ))}
    </span>
  );
}

/* ------------------------------ page heading ----------------------------- */

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

/* ------------------------------ status banner ---------------------------- */

/**
 * Renders the "why is this empty" explanation for a failed API call. Keeps the
 * approval-pending case visually distinct from a real error, because one is
 * expected and the other is not.
 */
export function StatusNotice({ status, message }: { status: string; message: string }) {
  if (status === 'pending_approval') {
    return (
      <Alert tone="warn" title="Google Business Profile API approval pending">
        <p>{message}</p>
        <p className="mt-2 text-ink-500">
          Everything here is wired up and waiting. Once Google approves the project, this page
          starts showing live data with no code changes.
        </p>
      </Alert>
    );
  }
  if (status === 'not_connected') {
    return (
      <Alert tone="brand" title="Google account not connected">
        <p>{message}</p>
      </Alert>
    );
  }
  return (
    <Alert tone="danger" title="Something went wrong">
      <p>{message}</p>
    </Alert>
  );
}

'use client';

/**
 * Shared pieces for showing Business Profile API access.
 *
 * Every screen that mentions Google access renders from the same
 * GbpAccessSnapshot, so the words and colours can never drift apart: the
 * per-API list below and the "Check access now" action are used on both the
 * Connection page and Settings.
 */

import { useState } from 'react';

import { api, ApiError, relativeTime } from '@/lib/client';
import {
  ACCESS_LABEL,
  GBP_SERVICE_API,
  GBP_SERVICES,
  GBP_SERVICE_LABEL,
  GOOGLE_API_TITLES,
  type GbpAccessSnapshot,
  type ServiceAccess,
} from '@/lib/gbp-status';
import { AlertIcon, RefreshIcon } from './icons';
import { Badge, Button, Callout, type Tone } from './ui';

/**
 * What to do about one API that is not working. Names the exact Google Cloud API
 * when it is switched off — "the APIs are off" alone leaves the owner guessing
 * which of four to enable. Null when nothing specific is known.
 */
export function serviceHint(record: ServiceAccess): string | null {
  if (record.status === 'available') return null;
  const api = GBP_SERVICE_API[record.service];
  const title = GOOGLE_API_TITLES[api] ?? api;
  if (record.lastCode === 'GBP_API_NOT_ENABLED') {
    return `Enable "${title}" (${api}) in Google Cloud Console → APIs & Services → Library, then check access again.`;
  }
  switch (record.status) {
    case 'pending':
      return `Google has not opened "${title}" for this project yet. It switches on by itself once approved.`;
    case 'rate_limited':
      return 'Google is rate limiting this API right now. This is temporary.';
    case 'permission_error':
      return 'The connected Google account is not allowed to use this API for this profile.';
    default:
      return null;
  }
}

/** Shown when access is proven but some API is failing — the part a green badge hides. */
export function DegradedNotice({ access }: { access: GbpAccessSnapshot }) {
  if (access.degraded.length === 0) return null;
  return (
    <Callout tone="warning" title="Some Google APIs are not working" icon={<AlertIcon size={18} />}>
      <ul className="mt-1 list-disc space-y-1.5 pl-5">
        {access.degraded.map((record) => (
          <li key={record.service} className="[overflow-wrap:anywhere]">
            <strong>{GBP_SERVICE_LABEL[record.service]}</strong>
            {serviceHint(record) ? ` — ${serviceHint(record)}` : ''}
          </li>
        ))}
      </ul>
    </Callout>
  );
}

/** One row per Google API: what it last did, and when it last worked. */
export function AccessServiceList({ access }: { access: GbpAccessSnapshot }) {
  return (
    <ul className="divide-y divide-line">
      {GBP_SERVICES.map((service) => {
        const record = access.services.find((s) => s.service === service);
        const meta = record ? ACCESS_LABEL[record.status] : ACCESS_LABEL.unknown;
        return (
          <li
            key={service}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-[0.875rem] font-medium text-ink-900">
                {GBP_SERVICE_LABEL[service]}
              </p>
              <p className="text-xs text-ink-500">
                {record?.lastSuccessAt
                  ? `Last worked ${relativeTime(record.lastSuccessAt)}`
                  : record
                    ? `Checked ${relativeTime(record.checkedAt)}`
                    : 'Not checked yet'}
              </p>
              {record && serviceHint(record) ? (
                <p className="mt-1 text-xs leading-relaxed text-warning-700 [overflow-wrap:anywhere]">
                  {serviceHint(record)}
                </p>
              ) : null}
            </div>
            <Badge tone={meta.tone as Tone} dot>
              {record?.status === 'available' ? 'Working' : meta.label}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Check access now". Asks the server to re-verify every Business Profile API
 * immediately (bypassing any pending cooldown) and reports the result. The
 * server throttles it, and the button is disabled while a check is running, so
 * a double-tap cannot send two.
 */
export function CheckAccessButton({
  onChecked,
  onError,
  variant = 'secondary',
  className = '',
}: {
  onChecked: (access: GbpAccessSnapshot, message: string) => void;
  onError?: (message: string) => void;
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function check() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await api.post<{ access: GbpAccessSnapshot }>('/api/gbp/check');
      if (response.data) onChecked(response.data.access, response.message);
    } catch (caught) {
      onError?.(caught instanceof ApiError ? caught.message : 'Could not check Google access.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={variant}
      loading={busy}
      onClick={() => void check()}
      icon={busy ? undefined : <RefreshIcon size={16} />}
      className={className}
    >
      {busy ? 'Checking…' : 'Check access now'}
    </Button>
  );
}

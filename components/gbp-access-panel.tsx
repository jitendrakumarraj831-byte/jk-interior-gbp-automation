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
  GBP_SERVICES,
  GBP_SERVICE_LABEL,
  type GbpAccessSnapshot,
} from '@/lib/gbp-status';
import { RefreshIcon } from './icons';
import { Badge, Button, type Tone } from './ui';

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

'use client';

/**
 * System Health Center.
 *
 * Reads the same cached state the rest of the dashboard already uses — opening
 * this page never spends Google quota or makes a fresh provider call.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, relativeTime } from '@/lib/client';
import { CheckCircleIcon, RefreshIcon, ShieldIcon } from '@/components/icons';
import { Callout, Card, PageHeader, SkeletonCard, StatusPill, type Tone } from '@/components/ui';
import type { HealthCheck, HealthStatus, SystemHealthReport } from '@/lib/types';

const STATUS_META: Record<HealthStatus, { label: string; tone: Tone }> = {
  healthy: { label: 'Healthy', tone: 'success' },
  configured: { label: 'Configured', tone: 'brand' },
  pending: { label: 'Pending', tone: 'warning' },
  not_configured: { label: 'Not configured', tone: 'neutral' },
  rate_limited: { label: 'Rate limited', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
};

function Row({ check }: { check: HealthCheck }) {
  const meta = STATUS_META[check.status];
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-900">{check.label}</p>
        <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-500">{check.detail}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
        <span className="text-[0.6875rem] text-ink-400">Checked {relativeTime(check.checkedAt)}</span>
      </div>
    </li>
  );
}

export default function HealthClient() {
  const [report, setReport] = useState<SystemHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<SystemHealthReport>('/api/system-health');
      setReport(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load system health.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const checks = report?.checks ?? [];
  const healthyCount = checks.filter((c) => c.status === 'healthy' || c.status === 'configured').length;

  return (
    <>
      <PageHeader
        eyebrow="Behind the scenes"
        title="System Health"
        description="Every subsystem this app depends on, read from the same status it already tracks."
        action={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="press flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink-700 hover:bg-subtle disabled:opacity-60"
          >
            <RefreshIcon size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Callout tone="danger" title="Could not load system health">
            <p>{error}</p>
          </Callout>
        </div>
      ) : null}

      {loading && !report ? (
        <SkeletonCard lines={6} />
      ) : (
        <div className="space-y-4">
          <Card className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-50 text-success-700">
              <ShieldIcon size={20} />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-950">
                {healthyCount} of {checks.length} subsystems ready
              </p>
              <p className="text-xs text-ink-500">
                {report ? `Last checked ${relativeTime(report.generatedAt)}` : ''}
              </p>
            </div>
          </Card>

          <Card padded={false}>
            <ul className="divide-y divide-line">
              {checks.map((check) => (
                <Row key={check.id} check={check} />
              ))}
            </ul>
          </Card>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-400">
            <CheckCircleIcon size={14} className="mt-0.5 shrink-0" />
            This page never calls Google or an AI provider — it only reads status this app already
            recorded elsewhere, so opening it costs no quota.
          </p>
        </div>
      )}
    </>
  );
}

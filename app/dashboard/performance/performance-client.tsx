'use client';

/**
 * Business Profile Performance.
 *
 * Every number here comes straight from Google's DailyMetric series — nothing
 * is estimated or derived beyond summing the days in the selected range.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiError, formatDate } from '@/lib/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingCard,
  PageHeading,
  StatCard,
  StatusNotice,
} from '@/components/ui';
import type { MetricSeries, PerformanceSnapshot } from '@/lib/types';

type Payload = { snapshot: PerformanceSnapshot; source: 'google' | 'cache' };

const INTERACTION_METRICS = new Set([
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_CONVERSATIONS',
]);

function Sparkline({ series }: { series: MetricSeries }) {
  const points = series.daily;
  if (points.length < 2) return null;

  const max = Math.max(...points.map((p) => p.value), 1);
  const width = 100;
  const height = 28;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - (point.value / max) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${series.label} trend`}
      className="mt-2 h-8 w-full"
    >
      <path d={path} fill="none" className="stroke-brand-500" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function PerformanceClient() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [notice, setNotice] = useState<{ status: string; message: string } | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = useCallback(async (range: number) => {
    try {
      const response = await api.get<Payload>(`/api/performance?days=${range}`);
      setPayload(response.data);
      setCacheMessage(response.data?.source === 'cache' ? response.message : null);
      setNotice(null);
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : null;
      setNotice({
        status: error?.status ?? 'error',
        message: error?.message ?? 'Could not load performance data.',
      });
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  const totals = useMemo(() => {
    const series = payload?.snapshot.series ?? [];
    const views = series
      .filter((s) => s.metric.startsWith('BUSINESS_IMPRESSIONS'))
      .reduce((sum, s) => sum + s.total, 0);
    const interactions = series
      .filter((s) => INTERACTION_METRICS.has(s.metric))
      .reduce((sum, s) => sum + s.total, 0);
    const calls = series.find((s) => s.metric === 'CALL_CLICKS')?.total ?? 0;
    const website = series.find((s) => s.metric === 'WEBSITE_CLICKS')?.total ?? 0;
    const directions = series.find((s) => s.metric === 'BUSINESS_DIRECTION_REQUESTS')?.total ?? 0;
    return { views, interactions, calls, website, directions };
  }, [payload]);

  return (
    <>
      <PageHeading
        title="Performance"
        description="Metrics reported by the Google Business Profile Performance API"
        action={
          <div className="flex gap-1.5">
            {[7, 30, 90].map((range) => (
              <Button
                key={range}
                size="sm"
                variant={days === range ? 'primary' : 'secondary'}
                onClick={() => setDays(range)}
                disabled={loading}
              >
                {range}d
              </Button>
            ))}
          </div>
        }
      />

      {notice ? (
        <div className="mb-5">
          <StatusNotice status={notice.status} message={notice.message} />
        </div>
      ) : null}

      {cacheMessage ? (
        <div className="mb-5">
          <Alert tone="warn" title="Showing cached data">
            <p>{cacheMessage}</p>
          </Alert>
        </div>
      ) : null}

      {loading && !payload ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <LoadingCard key={n} lines={1} />
          ))}
        </div>
      ) : null}

      {payload ? (
        <>
          <p className="mb-3 text-xs text-ink-500">
            {formatDate(payload.snapshot.rangeStart)} – {formatDate(payload.snapshot.rangeEnd)} ·
            Google reports with roughly a two-day delay.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Profile views" value={totals.views.toLocaleString('en-IN')} tone="brand" />
            <StatCard
              label="Interactions"
              value={totals.interactions.toLocaleString('en-IN')}
              hint="Calls, website clicks, directions, messages"
            />
            <StatCard label="Calls" value={totals.calls.toLocaleString('en-IN')} />
            <StatCard label="Website clicks" value={totals.website.toLocaleString('en-IN')} />
            <StatCard label="Direction requests" value={totals.directions.toLocaleString('en-IN')} />
          </div>

          <div className="mt-4">
            <Card>
              <CardHeader
                title="By metric"
                description="Exactly the metrics Google's DailyMetric enum exposes"
                action={<Badge tone={payload.source === 'google' ? 'ok' : 'warn'}>{payload.source === 'google' ? 'Live' : 'Cached'}</Badge>}
              />
              {payload.snapshot.series.length === 0 ? (
                <EmptyState
                  title="Google returned no data for this range"
                  description="New or low-traffic profiles often have empty series until enough activity accumulates."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {payload.snapshot.series.map((series) => (
                    <div key={series.metric} className="rounded-xl bg-canvas p-3">
                      <p className="truncate text-xs font-medium text-ink-500">{series.label}</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-ink-900">
                        {series.total.toLocaleString('en-IN')}
                      </p>
                      <Sparkline series={series} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}

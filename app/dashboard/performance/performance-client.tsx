'use client';

/**
 * Performance.
 *
 * Every figure comes straight from Google's DailyMetric series. Nothing is
 * derived beyond summing the days in the selected range, and when Google has no
 * data the page says so rather than drawing an empty chart.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiError, formatDate } from '@/lib/client';
import { MetricBars, MetricTable, Sparkline, TrendChart } from '@/components/charts';
import { StatusNotice } from '@/components/status-notice';
import {
  ChartIcon,
  ChatIcon,
  CursorClickIcon,
  EyeIcon,
  InfoIcon,
  PhoneIcon,
  RefreshIcon,
  RouteIcon,
} from '@/components/icons';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  SectionHeader,
  Segmented,
  Skeleton,
  SkeletonCard,
  SkeletonMetrics,
  type Tone,
} from '@/components/ui';
import type { DailyMetric, MetricSeries, PerformanceSnapshot } from '@/lib/types';

type Payload = { snapshot: PerformanceSnapshot; source: 'google' | 'cache' };

const INTERACTIONS: DailyMetric[] = [
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_CONVERSATIONS',
];

const HEADLINES: {
  key: string;
  label: string;
  icon: React.ReactNode;
  tone: Tone;
  metrics: DailyMetric[] | 'views';
}[] = [
  { key: 'views', label: 'Profile views', icon: <EyeIcon size={15} />, tone: 'brand', metrics: 'views' },
  { key: 'calls', label: 'Calls', icon: <PhoneIcon size={15} />, tone: 'success', metrics: ['CALL_CLICKS'] },
  {
    key: 'website',
    label: 'Website clicks',
    icon: <CursorClickIcon size={15} />,
    tone: 'info',
    metrics: ['WEBSITE_CLICKS'],
  },
  {
    key: 'directions',
    label: 'Direction requests',
    icon: <RouteIcon size={15} />,
    tone: 'ai',
    metrics: ['BUSINESS_DIRECTION_REQUESTS'],
  },
  {
    key: 'messages',
    label: 'Messages',
    icon: <ChatIcon size={15} />,
    tone: 'warning',
    metrics: ['BUSINESS_CONVERSATIONS'],
  },
];

/** Sums several series day by day so a sparkline can be drawn for the group. */
function combine(series: MetricSeries[]): { date: string; value: number }[] {
  const byDate = new Map<string, number>();
  for (const entry of series) {
    for (const point of entry.daily) {
      byDate.set(point.date, (byDate.get(point.date) ?? 0) + point.value);
    }
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

export default function PerformanceClient() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [notice, setNotice] = useState<{ status: string; message: string } | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [focus, setFocus] = useState<DailyMetric | 'views'>('views');
  const [showTable, setShowTable] = useState(false);

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

  function changeRange(next: number) {
    setLoading(true);
    setDays(next);
  }

  const series = useMemo(() => payload?.snapshot.series ?? [], [payload]);
  const viewSeries = useMemo(
    () => series.filter((s) => s.metric.startsWith('BUSINESS_IMPRESSIONS')),
    [series],
  );

  const groupFor = useCallback(
    (metrics: DailyMetric[] | 'views'): MetricSeries[] =>
      metrics === 'views' ? viewSeries : series.filter((s) => metrics.includes(s.metric)),
    [series, viewSeries],
  );

  const focusSeries: MetricSeries | null = useMemo(() => {
    if (focus === 'views') {
      const daily = combine(viewSeries);
      if (daily.length === 0) return null;
      return {
        metric: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
        label: 'Profile views',
        total: daily.reduce((sum, p) => sum + p.value, 0),
        daily,
      };
    }
    return series.find((s) => s.metric === focus) ?? null;
  }, [focus, series, viewSeries]);

  const totals = useMemo(() => {
    const interactions = series
      .filter((s) => INTERACTIONS.includes(s.metric))
      .reduce((sum, s) => sum + s.total, 0);
    return { interactions };
  }, [series]);

  const hasData = series.length > 0 && series.some((s) => s.total > 0);

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Performance"
        description="How customers found and contacted JK Interior, reported by Google."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setLoading(true);
              void load(days);
            }}
            loading={loading}
            icon={<RefreshIcon size={16} />}
          >
            Refresh
          </Button>
        }
      />

      {/* Filters sit in one row above the charts. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Date range"
          value={days}
          disabled={loading}
          onChange={changeRange}
          options={[
            { value: 7, label: '7 days' },
            { value: 30, label: '30 days' },
            { value: 90, label: '90 days' },
          ]}
        />
        {payload ? (
          <div className="flex items-center gap-2">
            <Badge tone={payload.source === 'google' ? 'success' : 'warning'} dot>
              {payload.source === 'google' ? 'Live' : 'Cached'}
            </Badge>
            <span className="hidden text-xs text-ink-400 sm:inline">
              {formatDate(payload.snapshot.rangeStart)} – {formatDate(payload.snapshot.rangeEnd)}
            </span>
          </div>
        ) : null}
      </div>

      {notice ? (
        <div className="mb-5">
          <StatusNotice
            status={notice.status}
            message={notice.message}
            subject="performance data"
            onRetry={() => {
              setLoading(true);
              void load(days);
            }}
          />
        </div>
      ) : null}

      {cacheMessage ? (
        <div className="mb-5">
          <Callout tone="warning" title="Showing the last synced snapshot" icon={<InfoIcon size={18} />}>
            <p>{cacheMessage}</p>
          </Callout>
        </div>
      ) : null}

      {loading && !payload ? (
        <div className="space-y-5">
          <SkeletonMetrics count={4} />
          <SkeletonCard lines={6} />
        </div>
      ) : null}

      {payload && !hasData ? (
        <EmptyState
          icon={<ChartIcon size={24} />}
          tone="success"
          title="No activity in this range"
          description="Google reports with about a two-day delay, and a newer profile needs some search traffic before numbers appear. Try a longer range."
          action={
            days < 90 ? (
              <Button size="sm" variant="secondary" onClick={() => changeRange(90)}>
                Try 90 days
              </Button>
            ) : null
          }
        />
      ) : null}

      {payload && hasData ? (
        <div className="space-y-5 sm:space-y-6">
          {/* ------------------------- stat tiles ------------------------ */}
          <div className="rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-5">
            {HEADLINES.map((headline) => {
              const group = groupFor(headline.metrics);
              const total = group.reduce((sum, s) => sum + s.total, 0);
              const daily = headline.metrics === 'views' ? combine(group) : (group[0]?.daily ?? []);
              const selected =
                focus === (headline.metrics === 'views' ? 'views' : headline.metrics[0]);

              return (
                <button
                  key={headline.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setFocus(headline.metrics === 'views' ? 'views' : headline.metrics[0]!)
                  }
                  className={`w-[13.5rem] shrink-0 rounded-card border bg-surface p-4 text-left shadow-card transition-[box-shadow,border-color] duration-200 hover:shadow-raised sm:w-auto sm:shrink ${
                    selected ? 'border-brand-300 ring-1 ring-brand-200' : 'border-line'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[0.8125rem] font-medium text-ink-500">{headline.label}</span>
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                        selected ? 'bg-brand-50 text-brand-700' : 'bg-subtle text-ink-500'
                      }`}
                    >
                      {headline.icon}
                    </span>
                  </div>
                  <p className="tnum mt-2 text-[1.75rem] font-semibold leading-none text-ink-950">
                    {total.toLocaleString('en-IN')}
                  </p>
                  <div className="mt-2.5">
                    <Sparkline points={daily} label={headline.label} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* --------------------------- trend --------------------------- */}
          <Card>
            <SectionHeader
              title={focusSeries ? focusSeries.label : 'Trend'}
              description={`Daily total over the last ${days} days · tap the chart to inspect a day`}
              icon={<ChartIcon size={18} />}
              tone="brand"
              action={
                focusSeries ? (
                  <span className="tnum text-sm font-semibold text-ink-900">
                    {focusSeries.total.toLocaleString('en-IN')}
                  </span>
                ) : undefined
              }
            />
            {focusSeries ? (
              <TrendChart series={focusSeries} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-500">
                Google returned no data for this metric.
              </p>
            )}
          </Card>

          {/* ------------------------ all metrics ------------------------ */}
          <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
            <Card className="min-w-0">
              <SectionHeader
                title="All metrics"
                description="Exactly what Google's DailyMetric reports — nothing derived"
                action={
                  <Button size="sm" variant="ghost" onClick={() => setShowTable((v) => !v)}>
                    {showTable ? 'Show chart' : 'Show table'}
                  </Button>
                }
              />
              {showTable ? <MetricTable series={series} /> : <MetricBars series={series} />}
            </Card>

            <Card className="min-w-0">
              <SectionHeader
                title="Customer actions"
                description="Calls, website clicks, directions and messages combined"
                icon={<CursorClickIcon size={18} />}
                tone="success"
              />
              <p className="tnum text-[2.5rem] font-semibold leading-none text-ink-950">
                {totals.interactions.toLocaleString('en-IN')}
              </p>
              <p className="mt-1.5 text-sm text-ink-500">
                actions in the last {days} days
              </p>
              <ul className="mt-4 space-y-2.5 border-t border-line pt-4">
                {series
                  .filter((s) => INTERACTIONS.includes(s.metric))
                  .sort((a, b) => b.total - a.total)
                  .map((entry) => (
                    <li key={entry.metric} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[0.8125rem] text-ink-600">{entry.label}</span>
                      <span className="tnum shrink-0 text-[0.8125rem] font-semibold text-ink-900">
                        {entry.total.toLocaleString('en-IN')}
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          </div>

          <p className="text-xs leading-relaxed text-ink-400">
            Google reports Business Profile performance with roughly a two-day delay, so the range
            above ends two days before today.
          </p>
        </div>
      ) : null}

      {loading && payload ? (
        <div className="mt-4">
          <Skeleton className="h-1 w-full" />
        </div>
      ) : null}
    </>
  );
}

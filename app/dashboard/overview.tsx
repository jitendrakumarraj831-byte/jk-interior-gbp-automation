'use client';

/**
 * Dashboard home.
 *
 * Reading order, top to bottom: who you are and what you can do now →
 * is Google connected → the four numbers that matter → what is left to set up
 * → shortcuts → the whole product → recent reviews → upcoming posts →
 * performance → automation health.
 *
 * Every figure comes from the API. Nothing is estimated: a metric that is not
 * available yet renders a dash and says why, never a placeholder number.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, relativeTime, scheduleLabel } from '@/lib/client';
import { ReviewCard } from '@/components/review-card';
import { SetupChecklist, type SetupConfig } from '@/components/setup-checklist';
import {
  ArrowRightIcon,
  AutomationIcon,
  CalendarIcon,
  ChartIcon,
  ChatIcon,
  CheckCircleIcon,
  ClockIcon,
  CursorClickIcon,
  EyeIcon,
  GoogleIcon,
  PhoneIcon,
  PinIcon,
  PlusIcon,
  PostIcon,
  RefreshIcon,
  RouteIcon,
  SettingsIcon,
  SparkIcon,
  StarIcon,
} from '@/components/icons';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  FeatureCard,
  KpiGrid,
  MetricCard,
  NavRow,
  SectionHeader,
  SectionLink,
  SkeletonCard,
  SkeletonMetrics,
  StatusPill,
  type Tone,
} from '@/components/ui';
import type { AutomationRun, DashboardSummary, GbpPost, PerformanceSnapshot } from '@/lib/types';

type SettingsPayload = { config: SetupConfig & { cronConfigured: boolean } };
type PerformancePayload = { snapshot: PerformanceSnapshot; source: 'google' | 'cache' };

function connectionTone(summary: DashboardSummary | null): Tone {
  if (!summary) return 'neutral';
  if (summary.connection.connected) return 'google';
  if (summary.connection.label === 'Approval pending') return 'warning';
  if (summary.connection.label === 'Connection problem') return 'danger';
  return 'neutral';
}

/**
 * Next firing of a daily UTC cron, derived from the schedule in vercel.json.
 * This is read off real configuration, not invented.
 */
function nextDailyUtc(hour: number, minute: number): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export default function DashboardOverview() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [config, setConfig] = useState<SettingsPayload['config'] | null>(null);
  const [posts, setPosts] = useState<GbpPost[] | null>(null);
  const [performance, setPerformance] = useState<PerformanceSnapshot | null>(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [status, settings, postList] = await Promise.all([
        api.get<DashboardSummary>('/api/status'),
        api.get<SettingsPayload>('/api/settings'),
        api.get<{ posts: GbpPost[] }>('/api/posts'),
      ]);
      setSummary(status.data);
      setConfig(settings.data?.config ?? null);
      setPosts(postList.data?.posts ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Performance is a separate Google call, so it loads on its own and never
  // blocks the rest of the page.
  const loadPerformance = useCallback(async () => {
    try {
      const response = await api.get<PerformancePayload>('/api/performance?days=30');
      setPerformance(response.data?.snapshot ?? null);
    } catch {
      setPerformance(null);
    } finally {
      setPerfLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadPerformance();
  }, [load, loadPerformance]);

  async function syncNow() {
    setSyncing(true);
    setSynced(false);
    setPerfLoading(true);
    await Promise.all([load(), loadPerformance()]);
    setSyncing(false);
    setSynced(true);
    window.setTimeout(() => setSynced(false), 2600);
  }

  const connected = summary?.connection.connected ?? false;
  const tone = connectionTone(summary);
  const scheduled = (posts ?? [])
    .filter((post) => post.status === 'scheduled')
    .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))
    .slice(0, 3);

  const metric = (name: string) => performance?.series.find((s) => s.metric === name)?.total ?? null;
  const views = performance
    ? performance.series
        .filter((s) => s.metric.startsWith('BUSINESS_IMPRESSIONS'))
        .reduce((sum, s) => sum + s.total, 0)
    : null;

  const runs = summary?.automation.lastRuns ?? [];
  const lastRun: AutomationRun | undefined = runs[0];
  const runFor = (task: AutomationRun['task']) => runs.find((r) => r.task === task);
  const cronReady = config?.cronConfigured ?? false;

  const automationTone: Tone = !cronReady ? 'neutral' : runs.length === 0 ? 'warning' : 'success';
  const automationLabel = !cronReady ? 'Not configured' : runs.length === 0 ? 'Waiting' : 'Ready';

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ----------------------------- welcome ---------------------------- */}
      <section className="animate-fade-up relative overflow-hidden rounded-panel border border-brand-100 bg-surface p-4 shadow-card sm:p-5">
        {/* A soft brand wash in the corner rather than a full-bleed banner. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-gradient-to-br from-brand-100 to-brand-50 opacity-70 blur-2xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.022em] text-ink-950 sm:text-[1.75rem]">
              Welcome back <span aria-hidden="true">👋</span>
            </h1>
            <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-600 sm:text-[0.9375rem]">
              Manage your Google Business Profile smarter.
            </p>
            <p className="mt-2 text-[0.75rem] font-medium tracking-wide text-brand-700">
              Reviews <span className="text-brand-300">•</span> Posts{' '}
              <span className="text-brand-300">•</span> Performance{' '}
              <span className="text-brand-300">•</span> Automation
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              onClick={() => void syncNow()}
              loading={syncing}
              icon={
                synced ? <CheckCircleIcon size={17} /> : syncing ? undefined : <RefreshIcon size={17} />
              }
              className="flex-1 sm:flex-none"
            >
              {syncing ? 'Syncing…' : synced ? 'Synced' : 'Sync now'}
            </Button>
            <ButtonLink
              href="/dashboard/settings"
              variant="secondary"
              icon={<SettingsIcon size={17} />}
              className="flex-1 sm:flex-none"
            >
              Settings
            </ButtonLink>
          </div>
        </div>
      </section>

      {error ? (
        <Callout
          tone="danger"
          title="We could not load your dashboard"
          action={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          <p>{error}</p>
        </Callout>
      ) : null}

      {/* -------------------------- connection ---------------------------- */}
      {loading ? (
        <SkeletonCard lines={2} />
      ) : summary ? (
        <Card
          className={`animate-fade-up ${
            connected ? 'border-google-100 bg-gradient-to-br from-google-50/60 to-surface' : ''
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
                connected
                  ? 'bg-google-100 text-google-700 ring-google-100'
                  : 'bg-subtle text-ink-500 ring-line'
              }`}
            >
              <GoogleIcon size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[0.9375rem] font-semibold text-ink-950">
                  Google Business Profile
                </p>
                <StatusPill tone={tone} pulse={connected}>
                  {summary.connection.label}
                </StatusPill>
              </div>

              {connected ? (
                <dl className="mt-2.5 grid gap-x-4 gap-y-2 sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
                      Business
                    </dt>
                    <dd className="truncate text-[0.8125rem] font-medium text-ink-900">
                      JK Interior
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
                      Location
                    </dt>
                    <dd className="truncate text-[0.8125rem] font-medium text-ink-900">
                      {summary.connection.detail}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
                      Last synced
                    </dt>
                    <dd className="truncate text-[0.8125rem] font-medium text-ink-900">
                      {lastRun ? relativeTime(lastRun.startedAt) : 'Not yet'}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-600">
                  {summary.connection.label === 'Approval pending'
                    ? 'Your credentials are stored and valid. Google has not yet approved API access for this project — nothing else to do.'
                    : 'Connect your Google Business Profile to unlock reviews, posts and performance data.'}
                </p>
              )}

              <div className="mt-3">
                <ButtonLink
                  href="/dashboard/connection"
                  variant={connected ? 'secondary' : 'primary'}
                  size="sm"
                  iconRight={<ArrowRightIcon size={15} />}
                >
                  {connected ? 'Manage connection' : 'Connect Google'}
                </ButtonLink>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* ---------------------------- KPI row ----------------------------- */}
      <section>
        <SectionHeader
          title="Your profile at a glance"
          description={connected ? 'Live from Google Business Profile' : 'Available once connected'}
        />
        {loading ? (
          <SkeletonMetrics />
        ) : (
          <KpiGrid>
            {/*
              Counts show a real 0 — that is the true count we hold, not an
              invented figure. Average rating stays a dash, because printing
              "0.0" would assert a rating the business does not have.
            */}
            <MetricCard
              label="Total reviews"
              value={summary?.totalReviews ?? 0}
              icon={<StarIcon size={15} />}
              tone="warning"
              hint={connected ? 'All time' : 'Once connected'}
            />
            <MetricCard
              label="Average rating"
              value={summary?.averageRating != null ? summary.averageRating.toFixed(1) : null}
              icon={<StarIcon size={15} />}
              tone="warning"
              hint={summary?.averageRating != null ? 'Out of 5' : 'Once connected'}
            />
            <MetricCard
              label="New reviews"
              value={summary?.newReviews ?? 0}
              icon={<ChatIcon size={15} />}
              tone="brand"
              hint={connected ? 'Last 7 days' : 'Once connected'}
            />
            <MetricCard
              label="Posts published"
              value={summary?.publishedPosts ?? 0}
              icon={<PostIcon size={15} />}
              tone="cyan"
              hint={`${summary?.scheduledPosts ?? 0} scheduled`}
            />
          </KpiGrid>
        )}
      </section>

      {/* -------------------------- setup + actions ----------------------- */}
      <div className="grid gap-4 lg:grid-cols-5 lg:gap-5">
        <div className="min-w-0 lg:col-span-3">
          {loading || !config ? <SkeletonCard lines={5} /> : <SetupChecklist config={config} />}
        </div>

        <div className="min-w-0 lg:col-span-2">
          <Card className="h-full">
            <SectionHeader title="Quick actions" description="The things you do most often" />
            <div className="-mx-1">
              <NavRow
                href="/dashboard/reviews"
                icon={<StarIcon size={17} />}
                tone="warning"
                title="Read new reviews"
                meta={
                  summary && summary.unansweredReviews > 0 ? (
                    <Badge tone="warning">{summary.unansweredReviews}</Badge>
                  ) : undefined
                }
              />
              <NavRow
                href="/dashboard/drafts"
                icon={<SparkIcon size={17} />}
                tone="ai"
                title="Approve reply drafts"
                meta={
                  summary && summary.pendingDrafts > 0 ? (
                    <Badge tone="ai">{summary.pendingDrafts}</Badge>
                  ) : undefined
                }
              />
              <NavRow
                href="/dashboard/posts"
                icon={<PlusIcon size={17} />}
                tone="cyan"
                title="Create a post"
              />
              <NavRow
                href="/dashboard/performance"
                icon={<ChartIcon size={17} />}
                tone="success"
                title="Check performance"
              />
              <NavRow
                href="/dashboard/connection"
                icon={<GoogleIcon size={17} />}
                tone="google"
                title="Google connection"
              />
            </div>
          </Card>
        </div>
      </div>

      {/* --------------------------- feature cards ------------------------ */}
      <section>
        <SectionHeader title="Everything you can do" description="Each area of your profile, in one place" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <FeatureCard
            href="/dashboard/reviews"
            icon={<StarIcon size={19} />}
            tone="brand"
            title="Reviews"
            description="Every review with its rating and reply status."
            count={summary?.totalReviews ?? 0}
            countLabel="total"
          />
          <FeatureCard
            href="/dashboard/drafts"
            icon={<SparkIcon size={19} />}
            tone="ai"
            title="AI Reply Drafts"
            description="Replies drafted for you. You approve each one."
            count={summary?.pendingDrafts ?? 0}
            countLabel="awaiting you"
          />
          <FeatureCard
            href="/dashboard/posts"
            icon={<PostIcon size={19} />}
            tone="cyan"
            title="Business Posts"
            description="Offers, updates and festival greetings."
            count={summary?.publishedPosts ?? 0}
            countLabel="published"
          />
          <FeatureCard
            href="/dashboard/performance"
            icon={<ChartIcon size={19} />}
            tone="success"
            title="Performance"
            description="Views, calls and clicks from Google."
            count={views}
            countLabel={views != null ? 'views, 30d' : undefined}
          />
          <FeatureCard
            href="/dashboard/connection"
            icon={<PinIcon size={19} />}
            tone="teal"
            title="Locations"
            description="The profile and location this dashboard manages."
            count={connected ? 'Connected' : 'Not linked'}
          />
          <FeatureCard
            href="/dashboard/settings"
            icon={<SettingsIcon size={19} />}
            tone="neutral"
            title="Settings"
            description="Automation rules and configuration status."
          />
        </div>
      </section>

      {/* ----------------- recent reviews + upcoming posts ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <section className="min-w-0">
          <SectionHeader
            title="Recent reviews"
            description="What customers said most recently"
            action={
              <SectionLink href="/dashboard/reviews">View all</SectionLink>
            }
          />
          {loading ? (
            <SkeletonCard lines={2} />
          ) : summary && summary.recentReviews.length > 0 ? (
            <div className="space-y-2.5">
              {summary.recentReviews.map((review) => (
                <ReviewCard
                  key={review.reviewId}
                  review={review}
                  compact
                  action={
                    review.existingReply ? null : (
                      <ButtonLink href="/dashboard/drafts" size="sm" variant="soft">
                        Reply
                      </ButtonLink>
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<StarIcon size={18} />}
              tone="warning"
              compact
              title={connected ? 'No reviews yet' : 'Your latest reviews will appear here'}
              description={
                connected
                  ? 'New Google reviews land here automatically after each sync.'
                  : 'Connect Google to automatically bring your latest reviews here.'
              }
              action={
                connected ? null : (
                  <ButtonLink href="/dashboard/connection" size="sm">
                    Connect Google
                  </ButtonLink>
                )
              }
            />
          )}
        </section>

        <section className="min-w-0">
          <SectionHeader
            title="Upcoming posts"
            description="Scheduled to publish automatically"
            action={
              <SectionLink href="/dashboard/scheduled">View all</SectionLink>
            }
          />
          {loading ? (
            <SkeletonCard lines={3} />
          ) : scheduled.length > 0 ? (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {scheduled.map((post) => (
                  <li key={post.id} className="flex items-center gap-3 p-3">
                    {post.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.imageUrl}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-lg bg-subtle object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
                        <CalendarIcon size={18} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-medium text-ink-950">
                        {post.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        {scheduleLabel(post.scheduledFor)}
                      </p>
                    </div>
                    <Badge tone="info">Scheduled</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <EmptyState
              icon={<CalendarIcon size={18} />}
              tone="cyan"
              compact
              title="No scheduled posts"
              description="Queue a post and it publishes on its own — handy for offers and greetings."
              action={
                <ButtonLink href="/dashboard/posts" size="sm" icon={<PlusIcon size={15} />}>
                  Create a post
                </ButtonLink>
              }
            />
          )}
        </section>
      </div>

      {/* --------------------------- performance -------------------------- */}
      <section>
        <SectionHeader
          title="Performance overview"
          description="How customers found and contacted you in the last 30 days"
          action={
            <SectionLink href="/dashboard/performance">Full report</SectionLink>
          }
        />
        {perfLoading ? (
          <SkeletonMetrics />
        ) : performance && performance.series.length > 0 ? (
          <KpiGrid>
            <MetricCard
              label="Profile views"
              value={views?.toLocaleString('en-IN') ?? null}
              icon={<EyeIcon size={15} />}
              tone="brand"
            />
            <MetricCard
              label="Calls"
              value={metric('CALL_CLICKS')?.toLocaleString('en-IN') ?? null}
              icon={<PhoneIcon size={15} />}
              tone="success"
            />
            <MetricCard
              label="Website clicks"
              value={metric('WEBSITE_CLICKS')?.toLocaleString('en-IN') ?? null}
              icon={<CursorClickIcon size={15} />}
              tone="cyan"
            />
            <MetricCard
              label="Directions"
              value={metric('BUSINESS_DIRECTION_REQUESTS')?.toLocaleString('en-IN') ?? null}
              icon={<RouteIcon size={15} />}
              tone="teal"
            />
          </KpiGrid>
        ) : (
          <EmptyState
            icon={<ChartIcon size={18} />}
            tone="success"
            compact
            title={connected ? 'No performance data yet' : 'Connect Google to see your real performance'}
            description={
              connected
                ? 'Google reports with about a two-day delay, and a newer profile needs some traffic first.'
                : 'Views, calls, website clicks and direction requests come straight from Google.'
            }
            action={
              connected ? null : (
                <ButtonLink href="/dashboard/connection" size="sm">
                  Connect Google
                </ButtonLink>
              )
            }
          />
        )}
      </section>

      {/* --------------------------- automation --------------------------- */}
      <section>
        <SectionHeader
          title="Automation status"
          description="What runs on its own, and when"
          action={
            <SectionLink href="/dashboard/automation">Details</SectionLink>
          }
        />
        {loading ? (
          <SkeletonCard lines={4} />
        ) : (
          <Card padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                    automationTone === 'success'
                      ? 'bg-success-50 text-success-700'
                      : automationTone === 'warning'
                        ? 'bg-warning-50 text-warning-700'
                        : 'bg-subtle text-ink-500'
                  }`}
                >
                  <AutomationIcon size={18} />
                </span>
                <div>
                  <p className="text-[0.875rem] font-semibold text-ink-950">Automation</p>
                  <p className="text-xs text-ink-500">
                    {cronReady ? 'Daily jobs are authenticated' : 'CRON_SECRET is not set'}
                  </p>
                </div>
              </div>
              <StatusPill tone={automationTone} pulse={automationTone === 'success'}>
                {automationLabel}
              </StatusPill>
            </div>

            <dl className="grid grid-cols-2 divide-x divide-line border-b border-line">
              <div className="p-3.5">
                <dt className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
                  <ClockIcon size={13} /> Last run
                </dt>
                <dd className="mt-1 truncate text-[0.875rem] font-medium text-ink-900">
                  {lastRun ? relativeTime(lastRun.startedAt) : 'Never'}
                </dd>
              </div>
              <div className="p-3.5">
                <dt className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
                  <CalendarIcon size={13} /> Next run
                </dt>
                <dd className="mt-1 truncate text-[0.875rem] font-medium text-ink-900">
                  {cronReady ? scheduleLabel(nextDailyUtc(2, 30)) : 'Not scheduled'}
                </dd>
              </div>
            </dl>

            <ul className="divide-y divide-line">
              {(
                [
                  ['sync-reviews', 'Reviews sync', <StarIcon key="a" size={15} />],
                  ['publish-posts', 'Post publishing', <PostIcon key="b" size={15} />],
                  ['sync-performance', 'Performance sync', <ChartIcon key="c" size={15} />],
                ] as const
              ).map(([task, label, glyph]) => {
                const run = runFor(task);
                const runTone: Tone = !cronReady
                  ? 'neutral'
                  : !run
                    ? 'warning'
                    : run.ok
                      ? 'success'
                      : 'danger';
                const runLabel = !cronReady
                  ? 'Not configured'
                  : !run
                    ? 'Waiting'
                    : run.ok
                      ? 'Healthy'
                      : 'Failed';
                return (
                  <li key={task} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-500">
                      {glyph}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink-800">
                      {label}
                    </span>
                    {run ? (
                      <span className="hidden shrink-0 text-xs text-ink-400 sm:inline">
                        {relativeTime(run.startedAt)}
                      </span>
                    ) : null}
                    <Badge tone={runTone} dot>
                      {runLabel}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

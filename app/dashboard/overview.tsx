'use client';

/**
 * Dashboard home.
 *
 * Reading order, top to bottom: who you are and what you can do right now →
 * is Google connected → the numbers → what still needs setting up → where to
 * go next → what actually happened recently.
 *
 * Every number shown comes from the API. Nothing is estimated, and a section
 * with no data renders an empty state rather than a placeholder figure.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, relativeTime } from '@/lib/client';
import { ReviewCard } from '@/components/review-card';
import { SetupChecklist, type SetupConfig } from '@/components/setup-checklist';
import {
  AutomationIcon,
  CalendarIcon,
  ChartIcon,
  ChatIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CursorClickIcon,
  EyeIcon,
  GoogleIcon,
  PhoneIcon,
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
  MetricCard,
  MetricRail,
  NavRow,
  RailItem,
  SectionHeader,
  SkeletonCard,
  SkeletonMetrics,
  StatusPill,
  type Tone,
} from '@/components/ui';
import type { DashboardSummary, GbpPost, PerformanceSnapshot } from '@/lib/types';

type SettingsPayload = { config: SetupConfig };
type PerformancePayload = { snapshot: PerformanceSnapshot; source: 'google' | 'cache' };

/** Maps the connection label the server produced onto a visual tone. */
function connectionTone(summary: DashboardSummary | null): Tone {
  if (!summary) return 'neutral';
  if (summary.connection.connected) return 'google';
  if (summary.connection.label === 'Approval pending') return 'warning';
  if (summary.connection.label === 'Connection problem') return 'danger';
  return 'neutral';
}

export default function DashboardOverview() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [config, setConfig] = useState<SetupConfig | null>(null);
  const [posts, setPosts] = useState<GbpPost[] | null>(null);
  const [performance, setPerformance] = useState<PerformanceSnapshot | null>(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
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

  // Performance is a separate Google call, so it loads independently and never
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
    setPerfLoading(true);
    await Promise.all([load(), loadPerformance()]);
    setSyncing(false);
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

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ----------------------------- welcome ---------------------------- */}
      <section className="animate-fade-up overflow-hidden rounded-panel border border-brand-100 bg-gradient-to-br from-brand-50 via-surface to-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-950 sm:text-[1.75rem]">
              Welcome back <span aria-hidden="true">👋</span>
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-600 sm:text-[0.9375rem]">
              Manage your Google Business Profile, save time and stay connected with your customers.
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              onClick={() => void syncNow()}
              loading={syncing}
              icon={syncing ? undefined : <RefreshIcon size={17} />}
              className="flex-1 sm:flex-none"
            >
              {syncing ? 'Syncing…' : 'Sync now'}
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
        <Card className="animate-fade-up">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
                  connected
                    ? 'bg-google-50 text-google-700 ring-google-100'
                    : 'bg-subtle text-ink-500 ring-line'
                }`}
              >
                <GoogleIcon size={22} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink-950">Google Business Profile</p>
                  <StatusPill tone={tone} pulse={connected}>
                    {summary.connection.label}
                  </StatusPill>
                </div>
                <p className="mt-1 break-words text-[0.8125rem] text-ink-500">
                  {summary.connection.detail}
                </p>
              </div>
            </div>
            <ButtonLink
              href="/dashboard/connection"
              variant={connected ? 'secondary' : 'primary'}
              size="sm"
              iconRight={<ChevronRightIcon size={15} />}
            >
              {connected ? 'Manage' : 'Connect Google'}
            </ButtonLink>
          </div>
        </Card>
      ) : null}

      {/* ---------------------------- metrics ----------------------------- */}
      <section>
        <SectionHeader
          title="Your profile at a glance"
          description={connected ? 'Live from Google Business Profile' : 'Connect Google to see real data'}
        />
        {loading ? (
          <SkeletonMetrics />
        ) : (
          <MetricRail>
            <RailItem>
              <MetricCard
                label="Total reviews"
                value={summary?.totalReviews ?? null}
                icon={<StarIcon size={15} />}
                tone="warning"
                hint={connected ? undefined : 'Available once connected'}
              />
            </RailItem>
            <RailItem>
              <MetricCard
                label="Average rating"
                value={summary?.averageRating != null ? summary.averageRating.toFixed(1) : null}
                icon={<StarIcon size={15} />}
                tone="warning"
                hint={summary?.averageRating != null ? 'Out of 5' : 'Available once connected'}
              />
            </RailItem>
            <RailItem>
              <MetricCard
                label="New reviews"
                value={summary?.newReviews ?? null}
                icon={<ChatIcon size={15} />}
                tone="brand"
                hint="Last 7 days"
              />
            </RailItem>
            <RailItem>
              <MetricCard
                label="Posts published"
                value={summary?.publishedPosts ?? null}
                icon={<PostIcon size={15} />}
                tone="info"
                hint={`${summary?.scheduledPosts ?? 0} scheduled`}
              />
            </RailItem>
          </MetricRail>
        )}
      </section>

      {/* -------------------------- setup + actions ----------------------- */}
      <div className="grid gap-5 lg:grid-cols-5 lg:gap-6">
        <div className="min-w-0 lg:col-span-3">
          {loading || !config ? <SkeletonCard lines={5} /> : <SetupChecklist config={config} />}
        </div>

        <div className="min-w-0 lg:col-span-2">
          <Card className="h-full">
            <SectionHeader title="Quick actions" description="The things you do most often" />
            <div className="-mx-1.5 space-y-0.5">
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
                tone="info"
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            href="/dashboard/reviews"
            icon={<StarIcon size={20} />}
            tone="warning"
            title="Reviews"
            description="Every Google review with its rating, text and reply status."
            count={summary?.totalReviews ?? null}
            countLabel="total"
          />
          <FeatureCard
            href="/dashboard/drafts"
            icon={<SparkIcon size={20} />}
            tone="ai"
            title="AI Reply Drafts"
            description="Replies drafted for you in English, Hindi or Hinglish. You approve each one."
            count={summary?.pendingDrafts ?? null}
            countLabel="awaiting you"
          />
          <FeatureCard
            href="/dashboard/posts"
            icon={<PostIcon size={20} />}
            tone="info"
            title="Business Posts"
            description="Offers, project updates and festival greetings on your profile."
            count={summary?.publishedPosts ?? null}
            countLabel="published"
          />
          <FeatureCard
            href="/dashboard/performance"
            icon={<ChartIcon size={20} />}
            tone="success"
            title="Performance"
            description="Views, calls, website clicks and direction requests from Google."
            count={views}
            countLabel="views, 30 days"
          />
          <FeatureCard
            href="/dashboard/connection"
            icon={<GoogleIcon size={20} />}
            tone="google"
            title="Locations"
            description="The Business Profile account and location this dashboard manages."
            count={connected ? 'Connected' : 'Not linked'}
          />
          <FeatureCard
            href="/dashboard/settings"
            icon={<SettingsIcon size={20} />}
            tone="neutral"
            title="Settings"
            description="Automation behaviour, approval rules and configuration status."
          />
        </div>
      </section>

      {/* ----------------- recent reviews + upcoming posts ---------------- */}
      <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
        <section className="min-w-0">
          <SectionHeader
            title="Recent reviews"
            description="What customers said most recently"
            action={
              <Link
                href="/dashboard/reviews"
                className="inline-flex items-center gap-1 rounded-lg text-[0.8125rem] font-medium text-brand-700 hover:underline"
              >
                View all <ChevronRightIcon size={14} />
              </Link>
            }
          />
          {loading ? (
            <div className="space-y-3">
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
            </div>
          ) : summary && summary.recentReviews.length > 0 ? (
            <div className="space-y-3">
              {summary.recentReviews.map((review) => (
                <ReviewCard key={review.reviewId} review={review} compact />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<StarIcon size={22} />}
              tone="warning"
              compact
              title={connected ? 'No reviews yet' : 'Connect Google to see your reviews'}
              description={
                connected
                  ? 'When a customer leaves a review on your Google profile, it appears here within a day.'
                  : 'Once your Business Profile is linked, every review lands here automatically.'
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
              <Link
                href="/dashboard/scheduled"
                className="inline-flex items-center gap-1 rounded-lg text-[0.8125rem] font-medium text-brand-700 hover:underline"
              >
                View queue <ChevronRightIcon size={14} />
              </Link>
            }
          />
          {loading ? (
            <SkeletonCard lines={3} />
          ) : scheduled.length > 0 ? (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {scheduled.map((post) => (
                  <li key={post.id} className="flex items-start gap-3 p-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-info-50 text-info-700">
                      <CalendarIcon size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{post.title}</p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        Publishes {relativeTime(post.scheduledFor)}
                      </p>
                    </div>
                    <Badge tone="info">Scheduled</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <EmptyState
              icon={<CalendarIcon size={22} />}
              tone="info"
              compact
              title="No scheduled posts"
              description="Queue a post and it will publish on its own — useful for offers and festival greetings."
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
            <Link
              href="/dashboard/performance"
              className="inline-flex items-center gap-1 rounded-lg text-[0.8125rem] font-medium text-brand-700 hover:underline"
            >
              Full report <ChevronRightIcon size={14} />
            </Link>
          }
        />
        {perfLoading ? (
          <SkeletonMetrics />
        ) : performance && performance.series.length > 0 ? (
          <MetricRail>
            <RailItem>
              <MetricCard label="Profile views" value={views?.toLocaleString('en-IN') ?? null} icon={<EyeIcon size={15} />} tone="brand" />
            </RailItem>
            <RailItem>
              <MetricCard label="Calls" value={metric('CALL_CLICKS')?.toLocaleString('en-IN') ?? null} icon={<PhoneIcon size={15} />} tone="success" />
            </RailItem>
            <RailItem>
              <MetricCard label="Website clicks" value={metric('WEBSITE_CLICKS')?.toLocaleString('en-IN') ?? null} icon={<CursorClickIcon size={15} />} tone="info" />
            </RailItem>
            <RailItem>
              <MetricCard label="Direction requests" value={metric('BUSINESS_DIRECTION_REQUESTS')?.toLocaleString('en-IN') ?? null} icon={<RouteIcon size={15} />} tone="ai" />
            </RailItem>
          </MetricRail>
        ) : (
          <EmptyState
            icon={<ChartIcon size={22} />}
            tone="success"
            compact
            title={connected ? 'No performance data yet' : 'Connect Google to see your real data'}
            description={
              connected
                ? 'Google reports with about a two-day delay, and new profiles need some activity before numbers appear.'
                : 'Views, calls, website clicks and direction requests all come straight from Google once your profile is linked.'
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
          description="What ran on its own, and when"
          action={
            <Link
              href="/dashboard/automation"
              className="inline-flex items-center gap-1 rounded-lg text-[0.8125rem] font-medium text-brand-700 hover:underline"
            >
              Details <ChevronRightIcon size={14} />
            </Link>
          }
        />
        {loading ? (
          <SkeletonCard lines={3} />
        ) : summary && summary.automation.lastRuns.length > 0 ? (
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {summary.automation.lastRuns.slice(0, 4).map((run) => (
                <li key={`${run.task}-${run.startedAt}`} className="flex items-start gap-3 p-4">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      run.ok ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'
                    }`}
                  >
                    {run.ok ? <CheckCircleIcon size={17} /> : <AutomationIcon size={17} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{run.task}</p>
                    <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-500">{run.summary}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-ink-400">
                    {relativeTime(run.startedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState
            icon={<AutomationIcon size={22} />}
            tone="brand"
            compact
            title="No automation runs yet"
            description="Scheduled jobs record every run here. You can also trigger one at any time with Sync now."
          />
        )}
      </section>
    </div>
  );
}

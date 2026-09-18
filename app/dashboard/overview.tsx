'use client';

/** Overview cards: connection, review counts, draft queue, automation state. */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, relativeTime } from '@/lib/client';
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
} from '@/components/ui';
import type { DashboardSummary } from '@/lib/types';

export default function DashboardOverview() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await api.get<DashboardSummary>('/api/status');
      setSummary(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  // `loading` starts as true, so the initial run needs no synchronous state
  // update — that is what keeps the effect below free of cascading renders.
  // Manual refreshes go through this wrapper instead.
  const refresh = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const connectionTone = summary?.connection.connected
    ? 'ok'
    : summary?.connection.label === 'Approval pending'
      ? 'warn'
      : 'neutral';

  return (
    <>
      <PageHeading
        title="Dashboard"
        description="JK Interior — Google Business Profile automation"
        action={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      {error ? (
        <div className="mb-5">
          <Alert tone="danger" title="Could not load the dashboard">
            <p>{error}</p>
          </Alert>
        </div>
      ) : null}

      {summary && summary.warnings.length > 0 ? (
        <div className="mb-5">
          <Alert tone="warn" title="Setup checklist">
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {summary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      {loading && !summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <LoadingCard key={n} lines={2} />
          ))}
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Google connection
              </p>
              <p className="mt-2">
                <Badge tone={connectionTone}>{summary.connection.label}</Badge>
              </p>
              <p className="mt-2 line-clamp-2 break-words text-xs text-ink-500">
                {summary.connection.detail}
              </p>
            </Card>

            <StatCard
              label="New reviews (7 days)"
              value={summary.newReviews}
              hint={`${summary.totalReviews} total · ${
                summary.averageRating != null ? summary.averageRating.toFixed(1) : '—'
              } average`}
              tone="brand"
            />
            <StatCard
              label="Drafts awaiting approval"
              value={summary.pendingDrafts}
              hint={`${summary.approvedDrafts} approved, not yet published`}
              tone={summary.pendingDrafts > 0 ? 'warn' : 'neutral'}
            />
            <StatCard
              label="Scheduled posts"
              value={summary.scheduledPosts}
              hint={`${summary.publishedPosts} published so far`}
            />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Automation status"
                description="Most recent cron and manual task runs"
                action={
                  <Link
                    href="/dashboard/automation"
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    View all
                  </Link>
                }
              />
              {summary.automation.lastRuns.length === 0 ? (
                <EmptyState
                  title="No automation runs yet"
                  description="Vercel Cron records every run here once it starts firing, and you can trigger a run manually from Automation Status."
                />
              ) : (
                <ul className="divide-y divide-hairline">
                  {summary.automation.lastRuns.map((run) => (
                    <li key={`${run.task}-${run.startedAt}`} className="flex gap-3 py-3">
                      <Badge tone={run.ok ? 'ok' : 'danger'}>{run.ok ? 'OK' : 'Failed'}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">{run.task}</p>
                        <p className="text-sm text-ink-500">{run.summary}</p>
                      </div>
                      <span className="shrink-0 text-xs text-ink-500">
                        {relativeTime(run.startedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Quick actions" />
              <div className="space-y-2">
                {[
                  { href: '/dashboard/reviews', label: 'Read latest reviews' },
                  { href: '/dashboard/drafts', label: 'Approve reply drafts' },
                  { href: '/dashboard/posts', label: 'Write a new post' },
                  { href: '/dashboard/performance', label: 'Check performance' },
                  { href: '/dashboard/connection', label: 'Google connection' },
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center justify-between rounded-xl bg-canvas px-3.5 py-3 text-sm text-ink-700 transition-colors hover:bg-brand-50 hover:text-brand-700"
                  >
                    {link.label}
                    <span aria-hidden="true">→</span>
                  </Link>
                ))}
              </div>
            </Card>
          </div>

          <div className="mt-3">
            <Card>
              <CardHeader
                title="Reply workflow"
                description="Nothing is published to Google without your approval"
              />
              <ol className="grid gap-2 text-sm text-ink-700 sm:grid-cols-5">
                {[
                  'Google review arrives',
                  'AI drafts a reply',
                  'Draft appears here',
                  'You approve or edit',
                  'Published to Google',
                ].map((step, index) => (
                  <li key={step} className="rounded-xl bg-canvas px-3 py-3">
                    <span className="block text-xs font-semibold text-brand-700">
                      Step {index + 1}
                    </span>
                    <span className="mt-0.5 block">{step}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}

'use client';

/** The publish queue: posts waiting on cron, plus anything that failed. */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, formatDateTime, relativeTime } from '@/lib/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingCard,
  PageHeading,
} from '@/components/ui';
import type { GbpPost } from '@/lib/types';
import { STATUS_META } from '../posts/posts-client';

export default function ScheduledClient() {
  const [posts, setPosts] = useState<GbpPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ posts: GbpPost[] }>('/api/posts');
      setPosts(response.data?.posts ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the queue.');
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

  const scheduled = posts
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''));
  const failed = posts.filter((p) => p.status === 'failed');
  const published = posts.filter((p) => p.status === 'published').slice(0, 10);

  async function action(post: GbpPost, kind: 'publish' | 'cancel') {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      if (kind === 'publish') {
        const response = await api.post<{ post: GbpPost }>(`/api/posts/${post.id}/publish`);
        setFlash(response.message);
      } else {
        const response = await api.patch<{ post: GbpPost }>(`/api/posts/${post.id}`, {
          status: 'cancelled',
        });
        setFlash(response.message);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That action failed.');
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <>
      <PageHeading
        title="Scheduled Posts"
        description="Vercel Cron publishes these automatically at their scheduled time"
        action={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert tone="danger" title="Could not complete that">
            <p>{error}</p>
          </Alert>
        </div>
      ) : null}
      {flash ? (
        <div className="mb-4">
          <Alert tone="ok" title="Done">
            <p>{flash}</p>
          </Alert>
        </div>
      ) : null}

      {loading && posts.length === 0 ? <LoadingCard lines={3} /> : null}

      <Card className="mb-4">
        <CardHeader title="Waiting to publish" description={`${scheduled.length} in the queue`} />
        {scheduled.length === 0 ? (
          <EmptyState
            title="Nothing scheduled"
            description="Schedule a post from the Posts page and it will show up here."
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {scheduled.map((post) => (
              <li key={post.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{post.title}</p>
                    <p className="text-xs text-ink-500">
                      Publishes {formatDateTime(post.scheduledFor)}
                    </p>
                  </div>
                  <Badge tone="brand">Scheduled</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void action(post, 'publish')}>
                    Publish now
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void action(post, 'cancel')}
                  >
                    Cancel
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {failed.length > 0 ? (
        <Card className="mb-4">
          <CardHeader
            title="Failed to publish"
            description="These were never posted to Google. Fix the cause and retry."
          />
          <ul className="divide-y divide-hairline">
            {failed.map((post) => (
              <li key={post.id} className="py-3">
                <p className="truncate font-medium text-ink-900">{post.title}</p>
                <p className="mt-1 text-sm text-danger-600">{post.error}</p>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={busy}
                  onClick={() => void action(post, 'publish')}
                >
                  Retry
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Recently published"
          description="Confirmed live on Google Business Profile"
          action={
            <Link href="/dashboard/posts" className="text-sm font-medium text-brand-700 hover:underline">
              All posts
            </Link>
          }
        />
        {published.length === 0 ? (
          <EmptyState title="Nothing published yet" />
        ) : (
          <ul className="divide-y divide-hairline">
            {published.map((post) => (
              <li key={post.id} className="flex items-center gap-3 py-3">
                <Badge tone={STATUS_META.published.tone}>Published</Badge>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{post.title}</span>
                <span className="shrink-0 text-xs text-ink-500">
                  {relativeTime(post.publishedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

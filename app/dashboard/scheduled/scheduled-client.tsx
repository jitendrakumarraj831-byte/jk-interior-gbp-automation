'use client';

/** The publish queue: what is waiting, what failed, and what recently went live. */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, formatDateTime, relativeTime } from '@/lib/client';
import {
  AlertIcon,
  CalendarIcon,
  CheckCircleIcon,
  CheckIcon,
  PlusIcon,
  RefreshIcon,
  SendIcon,
} from '@/components/icons';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  SectionHeader,
  SkeletonCard,
} from '@/components/ui';
import type { GbpPost } from '@/lib/types';

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
  const published = posts.filter((p) => p.status === 'published').slice(0, 8);

  async function action(post: GbpPost, kind: 'publish' | 'cancel') {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const response =
        kind === 'publish'
          ? await api.post<{ post: GbpPost }>(`/api/posts/${post.id}/publish`)
          : await api.patch<{ post: GbpPost }>(`/api/posts/${post.id}`, { status: 'cancelled' });
      setFlash(response.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That action did not go through.');
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Scheduled Posts"
        description="Posts waiting to publish automatically, and anything that needs another look."
        action={
          <>
            <Button
              variant="secondary"
              onClick={refresh}
              loading={loading}
              icon={<RefreshIcon size={16} />}
              className="hidden sm:inline-flex"
            >
              Refresh
            </Button>
            <ButtonLink href="/dashboard/posts" icon={<PlusIcon size={17} />}>
              Create post
            </ButtonLink>
          </>
        }
      />

      {error ? (
        <div className="mb-4">
          <Callout tone="danger" title="That did not go through">
            <p>{error}</p>
          </Callout>
        </div>
      ) : null}
      {flash ? (
        <div className="mb-4">
          <Callout tone="success" title="Done" icon={<CheckIcon size={18} />}>
            <p>{flash}</p>
          </Callout>
        </div>
      ) : null}

      {loading && posts.length === 0 ? <SkeletonCard lines={4} /> : null}

      <div className="space-y-5">
        <section>
          <SectionHeader
            title="Waiting to publish"
            description={`${scheduled.length} in the queue`}
            icon={<CalendarIcon size={18} />}
            tone="info"
          />
          {scheduled.length === 0 && !loading ? (
            <EmptyState
              icon={<CalendarIcon size={24} />}
              tone="info"
              compact
              title="Nothing scheduled"
              description="Schedule a post and it publishes on its own — handy for festival greetings and limited-time offers you want to set up in advance."
              action={
                <ButtonLink href="/dashboard/posts" size="sm" icon={<PlusIcon size={15} />}>
                  Create a post
                </ButtonLink>
              }
            />
          ) : (
            <div className="space-y-3">
              {scheduled.map((post) => (
                <Card key={post.id} className="animate-fade-up">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-info-50 text-info-700">
                        <CalendarIcon size={19} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-950">{post.title}</p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          Publishes {formatDateTime(post.scheduledFor)} ·{' '}
                          {relativeTime(post.scheduledFor)}
                        </p>
                      </div>
                    </div>
                    <Badge tone="info" dot>
                      Scheduled
                    </Badge>
                  </div>
                  <p className="clamp-3 mt-3 text-[0.8125rem] leading-relaxed text-ink-600">
                    {post.description}
                  </p>
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      icon={<SendIcon size={14} />}
                      onClick={() => void action(post, 'publish')}
                    >
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
                </Card>
              ))}
            </div>
          )}
        </section>

        {failed.length > 0 ? (
          <section>
            <SectionHeader
              title="Needs attention"
              description="These were never posted to Google"
              icon={<AlertIcon size={18} />}
              tone="danger"
            />
            <div className="space-y-3">
              {failed.map((post) => (
                <Card key={post.id} className="border-l-[3px] border-l-danger-200">
                  <p className="text-sm font-semibold text-ink-950">{post.title}</p>
                  <p className="mt-1.5 rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] leading-relaxed text-danger-700">
                    {post.error}
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    disabled={busy}
                    icon={<RefreshIcon size={14} />}
                    onClick={() => void action(post, 'publish')}
                  >
                    Try again
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <SectionHeader
            title="Recently published"
            description="Confirmed live on your profile"
            icon={<CheckCircleIcon size={18} />}
            tone="success"
            action={
              <ButtonLink href="/dashboard/posts" variant="ghost" size="sm">
                All posts
              </ButtonLink>
            }
          />
          {published.length === 0 ? (
            <EmptyState
              icon={<CheckCircleIcon size={24} />}
              tone="success"
              compact
              title="Nothing published yet"
              description="Once a post goes live on Google it is listed here with the time it published."
            />
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {published.map((post) => (
                  <li key={post.id} className="flex items-center gap-3 p-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-700">
                      <CheckIcon size={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">
                      {post.title}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-xs text-ink-400">
                      {relativeTime(post.publishedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

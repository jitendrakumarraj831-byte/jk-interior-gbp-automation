'use client';

/**
 * Content Calendar.
 *
 * Draft → Approve → Schedule → Publish, enforced server-side (every
 * transition is its own endpoint that checks the post's current state — this
 * page only calls them). "Manual publish" is wired in Phase D, alongside the
 * cron publisher, since both need the same Facebook/Instagram adapters.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiError, formatDateTime, scheduleLabel } from '@/lib/client';
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  FacebookIcon,
  InstagramIcon,
  RefreshIcon,
  SocialIcon,
  TrashIcon,
} from '@/components/icons';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  SkeletonCard,
  type Tone,
} from '@/components/ui';
import type { SocialPlatformTarget, SocialPost, SocialPostStatus } from '@/lib/social/types';

const STATUS_META: Record<SocialPostStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_approval: { label: 'Pending approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  publishing: { label: 'Publishing', tone: 'warning' },
  published: { label: 'Published', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const PLATFORM_FILTERS: { value: 'all' | SocialPlatformTarget; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'both', label: 'Both' },
];

const STATUS_FILTERS: { value: 'all' | SocialPostStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' },
];

const inputClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-brand-500';

function withinView(post: SocialPost, view: 'month' | 'week'): boolean {
  const anchor = post.scheduledAt ?? post.createdAt;
  const date = new Date(anchor);
  const now = new Date();
  if (view === 'month') {
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return date >= startOfWeek && date < endOfWeek;
}

export default function ContentCalendarClient() {
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<'all' | SocialPlatformTarget>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | SocialPostStatus>('all');
  const [view, setView] = useState<'month' | 'week'>('month');
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ posts: SocialPost[] }>('/api/social/posts');
      setPosts(response.data?.posts ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the content calendar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return (posts ?? []).filter((post) => {
      if (platformFilter !== 'all' && post.platforms !== platformFilter) return false;
      if (statusFilter !== 'all' && post.status !== statusFilter) return false;
      return withinView(post, view);
    });
  }, [posts, platformFilter, statusFilter, view]);

  async function act(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Social"
        title="Content Calendar"
        description="Approve, schedule and track every Facebook and Instagram post."
        action={
          <Button variant="secondary" onClick={() => void load()} loading={loading} icon={<RefreshIcon size={16} />}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Callout tone="danger" title="Something went wrong" icon={<AlertIcon size={18} />}>
            <p>{error}</p>
          </Callout>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented<'month' | 'week'>
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'week', label: 'Weekly' },
          ]}
        />
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value as 'all' | SocialPlatformTarget)}
          className={`${inputClass} w-auto`}
        >
          {PLATFORM_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              Platform: {f.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | SocialPostStatus)}
          className={`${inputClass} w-auto`}
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              Status: {f.label}
            </option>
          ))}
        </select>
      </div>

      {loading && !posts ? <SkeletonCard lines={4} /> : null}

      {posts && filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon size={22} />}
          title="Nothing here yet"
          description="Generate content in the AI Content Studio and save it as a draft to see it here."
        />
      ) : null}

      <div className="space-y-3">
        {filtered.map((post) => {
          const meta = STATUS_META[post.status];
          const busy = busyId === post.id;
          return (
            <Card key={post.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink-950">{post.title}</h3>
                    <Badge tone={meta.tone} dot>
                      {meta.label}
                    </Badge>
                    <Badge tone="neutral">
                      {post.platforms === 'facebook' ? (
                        <FacebookIcon size={12} />
                      ) : post.platforms === 'instagram' ? (
                        <InstagramIcon size={12} />
                      ) : (
                        <SocialIcon size={12} />
                      )}
                      {post.platforms}
                    </Badge>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs text-ink-500">
                    {post.facebookContent?.caption || post.instagramContent?.caption || post.content}
                  </p>
                  <p className="mt-1.5 text-xs text-ink-400">
                    {post.status === 'scheduled' && post.scheduledAt
                      ? `Scheduled ${scheduleLabel(post.scheduledAt)}`
                      : post.status === 'published' && post.publishedAt
                        ? `Published ${formatDateTime(post.publishedAt)}`
                        : `Created ${formatDateTime(post.createdAt)}`}
                  </p>
                  {post.lastError ? (
                    <p className="mt-1.5 text-xs text-danger-600">{post.lastError}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {post.status === 'draft' ? (
                    <Button
                      size="sm"
                      loading={busy}
                      icon={<CheckIcon size={14} />}
                      onClick={() => void act(post.id, () => api.post(`/api/social/posts/${post.id}/approve`))}
                    >
                      Approve
                    </Button>
                  ) : null}

                  {post.status === 'approved' ? (
                    schedulingId === post.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="datetime-local"
                          value={scheduleValue}
                          onChange={(e) => setScheduleValue(e.target.value)}
                          className={`${inputClass} w-auto`}
                        />
                        <Button
                          size="sm"
                          loading={busy}
                          onClick={() =>
                            void act(post.id, () =>
                              api.post(`/api/social/posts/${post.id}/schedule`, {
                                scheduledAt: new Date(scheduleValue).toISOString(),
                              }),
                            ).then(() => setSchedulingId(null))
                          }
                        >
                          Confirm
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setSchedulingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        icon={<ClockIcon size={14} />}
                        onClick={() => {
                          setSchedulingId(post.id);
                          setScheduleValue('');
                        }}
                      >
                        Schedule
                      </Button>
                    )
                  ) : null}

                  {post.status === 'scheduled' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      onClick={() => void act(post.id, () => api.post(`/api/social/posts/${post.id}/unschedule`))}
                    >
                      Unschedule
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy}
                    icon={<CopyIcon size={14} />}
                    onClick={() => void act(post.id, () => api.post(`/api/social/posts/${post.id}/duplicate`))}
                  >
                    Duplicate
                  </Button>

                  {post.status === 'draft' || post.status === 'approved' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      icon={<TrashIcon size={14} />}
                      onClick={() => void act(post.id, () => api.del(`/api/social/posts/${post.id}`))}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

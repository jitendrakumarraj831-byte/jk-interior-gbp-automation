'use client';

/**
 * Social History — a read-only record of every post, regardless of current
 * lifecycle state. The Content Calendar is for acting on posts; this page is
 * for looking back at what happened.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, formatDateTime } from '@/lib/client';
import { AlertIcon, FacebookIcon, InstagramIcon, RefreshIcon, SocialIcon } from '@/components/icons';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, SkeletonCard, type Tone } from '@/components/ui';
import type { SocialPost, SocialPostStatus } from '@/lib/social/types';

const STATUS_TONE: Record<SocialPostStatus, Tone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'info',
  scheduled: 'info',
  publishing: 'warning',
  published: 'success',
  failed: 'danger',
  skipped: 'warning',
  cancelled: 'neutral',
};

export default function SocialHistoryClient() {
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ posts: SocialPost[] }>('/api/social/posts');
      setPosts(response.data?.posts ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load social history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        eyebrow="Social"
        title="Social History"
        description="Every Facebook and Instagram post, past and present."
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

      {loading && !posts ? <SkeletonCard lines={5} /> : null}

      {posts && posts.length === 0 ? (
        <EmptyState icon={<SocialIcon size={22} />} title="No posts yet" description="History will appear once a post is drafted." />
      ) : null}

      {posts && posts.length > 0 ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-400">
                <th className="px-4 py-3 font-medium">Platform</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Scheduled</th>
                <th className="px-4 py-3 font-medium">Published</th>
                <th className="px-4 py-3 font-medium">External ID</th>
                <th className="px-4 py-3 font-medium">Retry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {posts.map((post) => (
                <tr key={post.id} className="align-top">
                  <td className="px-4 py-3">
                    {post.platforms === 'facebook' ? (
                      <FacebookIcon size={16} />
                    ) : post.platforms === 'instagram' ? (
                      <InstagramIcon size={16} />
                    ) : (
                      <SocialIcon size={16} />
                    )}
                  </td>
                  <td className="max-w-[220px] px-4 py-3">
                    <p className="truncate font-medium text-ink-900" title={post.title}>
                      {post.title}
                    </p>
                    {post.lastError ? <p className="mt-0.5 truncate text-xs text-danger-600" title={post.lastError}>{post.lastError}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[post.status]}>{post.status}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">{formatDateTime(post.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {post.scheduledAt ? formatDateTime(post.scheduledAt) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {post.publishedAt ? formatDateTime(post.publishedAt) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-400">
                    {post.externalPostIds.facebook ? <p className="truncate">FB: {post.externalPostIds.facebook}</p> : null}
                    {post.externalPostIds.instagram ? <p className="truncate">IG: {post.externalPostIds.instagram}</p> : null}
                    {!post.externalPostIds.facebook && !post.externalPostIds.instagram ? '—' : null}
                  </td>
                  <td className="px-4 py-3 text-ink-500">{post.retryCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </>
  );
}

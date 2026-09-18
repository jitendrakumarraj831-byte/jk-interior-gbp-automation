'use client';

/**
 * Review list.
 *
 * Shows reviewer, rating, text, date, any reply already live on Google and the
 * local reply status. "Draft reply" only creates a draft — it never publishes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { api, ApiError, formatDate } from '@/lib/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingCard,
  PageHeading,
  Stars,
  StatusNotice,
  type Tone,
} from '@/components/ui';
import type { ReplyDraft, ReplyStatus, Review } from '@/lib/types';

type Payload = {
  reviews: Review[];
  averageRating: number | null;
  totalReviewCount: number;
  source: 'google' | 'cache';
  fetchedAt: string;
};

const STATUS_LABEL: Record<ReplyStatus, { label: string; tone: Tone }> = {
  no_reply: { label: 'No reply', tone: 'neutral' },
  draft_pending: { label: 'Draft awaiting approval', tone: 'warn' },
  approved: { label: 'Approved — not published', tone: 'brand' },
  published: { label: 'Reply published', tone: 'ok' },
  publish_failed: { label: 'Publish failed', tone: 'danger' },
  replied_on_google: { label: 'Replied on Google', tone: 'ok' },
};

type Filter = 'all' | 'unanswered' | 'negative';

export default function ReviewsClient() {
  const router = useRouter();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [notice, setNotice] = useState<{ status: string; message: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      const response = await api.get<Payload>('/api/reviews');
      setPayload(response.data);
      setMessage(response.data?.source === 'cache' ? response.message : null);
      setNotice(null);
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : null;
      setNotice({
        status: error?.status ?? 'error',
        message: error?.message ?? 'Could not load reviews.',
      });
      setPayload(null);
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

  async function draftReply(review: Review) {
    setDrafting(review.reviewId);
    setMessage(null);
    try {
      await api.post<{ draft: ReplyDraft }>('/api/reviews/reply', {
        reviewId: review.reviewId,
        reviewName: review.name,
        reviewerName: review.reviewerName,
        starRating: review.starRating,
        comment: review.comment,
        regenerate: true,
      });
      router.push('/dashboard/drafts');
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'Could not generate a draft.');
    } finally {
      setDrafting(null);
    }
  }

  const reviews = useMemo(() => {
    const all = payload?.reviews ?? [];
    if (filter === 'unanswered') return all.filter((r) => !r.existingReply);
    if (filter === 'negative') return all.filter((r) => r.starRating <= 3);
    return all;
  }, [payload, filter]);

  return (
    <>
      <PageHeading
        title="Reviews"
        description={
          payload
            ? `${payload.totalReviewCount} review(s) · average ${
                payload.averageRating != null ? payload.averageRating.toFixed(1) : '—'
              }`
            : 'Google Business Profile reviews'
        }
        action={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        }
      />

      {notice ? (
        <div className="mb-5">
          <StatusNotice status={notice.status} message={notice.message} />
        </div>
      ) : null}

      {message ? (
        <div className="mb-5">
          <Alert tone="warn" title="Heads up">
            <p>{message}</p>
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ['all', 'All'],
            ['unanswered', 'Needs a reply'],
            ['negative', '3 stars & below'],
          ] as [Filter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              filter === value
                ? 'bg-brand-600 text-white'
                : 'bg-surface text-ink-700 ring-1 ring-inset ring-hairline'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && !payload ? (
        <div className="space-y-3">
          <LoadingCard />
          <LoadingCard />
        </div>
      ) : null}

      {payload && reviews.length === 0 ? (
        <EmptyState
          title="No reviews to show"
          description="Nothing matches this filter yet. New reviews appear after the next sync."
        />
      ) : null}

      <div className="space-y-3">
        {reviews.map((review) => {
          const status = STATUS_LABEL[review.replyStatus];
          return (
            <Card key={review.reviewId}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900">{review.reviewerName}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Stars rating={review.starRating} />
                    <span className="text-xs text-ink-500">{formatDate(review.createTime)}</span>
                  </div>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>

              {review.comment ? (
                <p className="mt-3 whitespace-pre-line text-sm text-ink-700">{review.comment}</p>
              ) : (
                <p className="mt-3 text-sm italic text-ink-500">Rating only — no review text.</p>
              )}

              {review.existingReply ? (
                <div className="mt-3 rounded-xl bg-canvas p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Your reply on Google
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-ink-700">
                    {review.existingReply.comment}
                  </p>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void draftReply(review)}
                    disabled={drafting === review.reviewId}
                  >
                    {drafting === review.reviewId ? 'Drafting…' : 'Draft AI reply'}
                  </Button>
                  <span className="self-center text-xs text-ink-500">
                    Creates a draft only — you approve before it goes live.
                  </span>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

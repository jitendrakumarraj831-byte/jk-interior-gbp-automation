'use client';

/**
 * Reviews.
 *
 * One primary action per card — "Generate reply" when nothing exists yet,
 * "Review reply" when a draft is already waiting — so the list never turns into
 * a wall of buttons.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { api, ApiError, relativeTime } from '@/lib/client';
import { ReviewCard } from '@/components/review-card';
import { StatusNotice } from '@/components/status-notice';
import { ChevronRightIcon, InfoIcon, RefreshIcon, SparkIcon, StarIcon } from '@/components/icons';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  EmptyState,
  MetricCard,
  MetricRail,
  PageHeader,
  RailItem,
  Segmented,
  SkeletonCard,
  SkeletonMetrics,
} from '@/components/ui';
import type { ReplyDraft, Review } from '@/lib/types';

type Payload = {
  reviews: Review[];
  averageRating: number | null;
  totalReviewCount: number;
  source: 'google' | 'cache';
  fetchedAt: string;
};

type Filter = 'all' | 'needs_reply' | 'low';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs_reply', label: 'Needs reply' },
  { value: 'low', label: '3★ & below' },
];

export default function ReviewsClient() {
  const router = useRouter();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [notice, setNotice] = useState<{ status: string; message: string } | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      const response = await api.get<Payload>('/api/reviews');
      setPayload(response.data);
      setCacheMessage(response.data?.source === 'cache' ? response.message : null);
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

  const refresh = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  async function draftReply(review: Review) {
    setDrafting(review.reviewId);
    setNotice(null);
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
      setNotice({
        status: caught instanceof ApiError ? caught.status : 'error',
        message: caught instanceof ApiError ? caught.message : 'Could not generate a draft.',
      });
    } finally {
      setDrafting(null);
    }
  }

  const all = useMemo(() => payload?.reviews ?? [], [payload]);
  const reviews = useMemo(() => {
    if (filter === 'needs_reply') return all.filter((r) => !r.existingReply);
    if (filter === 'low') return all.filter((r) => r.starRating <= 3);
    return all;
  }, [all, filter]);

  const unanswered = all.filter((r) => !r.existingReply).length;

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Reviews"
        description="Everything customers have said about JK Interior on Google, and where each reply stands."
        action={
          <Button variant="secondary" onClick={refresh} loading={loading} icon={<RefreshIcon size={16} />}>
            Refresh
          </Button>
        }
      />

      {notice ? (
        <div className="mb-5">
          <StatusNotice
          status={notice.status}
          message={notice.message}
          subject="reviews"
          onRetry={refresh}
        />
        </div>
      ) : null}

      {cacheMessage ? (
        <div className="mb-5">
          <Callout tone="warning" title="Showing the last synced copy" icon={<InfoIcon size={18} />}>
            <p>{cacheMessage}</p>
          </Callout>
        </div>
      ) : null}

      {loading && !payload ? (
        <SkeletonMetrics count={3} />
      ) : payload ? (
        <MetricRail className="lg:grid-cols-3">
          <RailItem>
            <MetricCard
              label="Total reviews"
              value={payload.totalReviewCount}
              icon={<StarIcon size={15} />}
              tone="warning"
            />
          </RailItem>
          <RailItem>
            <MetricCard
              label="Average rating"
              value={payload.averageRating != null ? payload.averageRating.toFixed(1) : null}
              icon={<StarIcon size={15} />}
              tone="warning"
              hint="Out of 5"
            />
          </RailItem>
          <RailItem>
            <MetricCard
              label="Awaiting a reply"
              value={unanswered}
              icon={<SparkIcon size={15} />}
              tone={unanswered > 0 ? 'ai' : 'success'}
              hint={unanswered > 0 ? 'Reply to build trust' : 'All caught up'}
            />
          </RailItem>
        </MetricRail>
      ) : null}

      {payload ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Filter reviews" />
          <p className="text-xs text-ink-400">Updated {relativeTime(payload.fetchedAt)}</p>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {loading && !payload ? (
          <>
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
            <SkeletonCard lines={2} />
          </>
        ) : null}

        {payload && reviews.length === 0 ? (
          <EmptyState
            icon={<StarIcon size={24} />}
            tone="warning"
            title={all.length === 0 ? 'No reviews yet' : 'Nothing matches this filter'}
            description={
              all.length === 0
                ? 'When a customer reviews JK Interior on Google, it appears here automatically after the next sync.'
                : 'Try a different filter to see the rest of your reviews.'
            }
            action={
              all.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => setFilter('all')}>
                  Show all reviews
                </Button>
              ) : null
            }
          />
        ) : null}

        {reviews.map((review) => (
          <ReviewCard
            key={review.reviewId}
            review={review}
            action={
              review.existingReply ? null : review.replyStatus === 'no_reply' ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => void draftReply(review)}
                    loading={drafting === review.reviewId}
                    icon={drafting === review.reviewId ? undefined : <SparkIcon size={15} />}
                  >
                    Generate reply
                  </Button>
                  <span className="text-xs text-ink-400">
                    Creates a draft — you approve before it goes live.
                  </span>
                </>
              ) : (
                <>
                  <ButtonLink
                    href="/dashboard/drafts"
                    size="sm"
                    variant="soft"
                    iconRight={<ChevronRightIcon size={15} />}
                  >
                    Review reply
                  </ButtonLink>
                  <Badge tone="ai">Draft waiting</Badge>
                </>
              )
            }
          />
        ))}
      </div>
    </>
  );
}

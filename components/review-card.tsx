'use client';

/**
 * Review card, shared by the Reviews page and the dashboard's recent list.
 *
 * Customer content is always on a neutral surface. Anything AI-generated is
 * visually separated elsewhere (violet) so the two are never confused.
 */

import type { ReactNode } from 'react';

import { formatDate } from '@/lib/client';
import type { ReplyStatus, Review } from '@/lib/types';
import { Avatar, Badge, Card, Stars, type Tone } from './ui';

export const REPLY_STATUS: Record<ReplyStatus, { label: string; tone: Tone }> = {
  no_reply: { label: 'New', tone: 'brand' },
  draft_pending: { label: 'Draft ready', tone: 'ai' },
  approved: { label: 'Approved', tone: 'info' },
  published: { label: 'Published', tone: 'success' },
  publish_failed: { label: 'Needs attention', tone: 'danger' },
  replied_on_google: { label: 'Published', tone: 'success' },
};

export function ReviewCard({
  review,
  action,
  compact = false,
}: {
  review: Review;
  action?: ReactNode;
  compact?: boolean;
}) {
  const status = REPLY_STATUS[review.replyStatus];
  // A calm, non-alarming treatment for low ratings: a quiet left rule rather
  // than red fills, so a bad review never looks like a system error.
  const negative = review.starRating <= 3;

  return (
    <Card
      as="article"
      className={negative ? 'border-l-[3px] border-l-warning-200' : undefined}
      padded={!compact}
    >
      <div className={compact ? 'p-3.5' : undefined}>
        <div className="flex items-start gap-3">
          <Avatar name={review.reviewerName} src={review.reviewerPhotoUrl} size={compact ? 34 : 40} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="truncate text-sm font-semibold text-ink-950">{review.reviewerName}</p>
              <Badge tone={status.tone} dot>
                {status.label}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <Stars rating={review.starRating} size={compact ? 13 : 15} />
              <span className="text-xs text-ink-400">{formatDate(review.createTime)}</span>
            </div>
          </div>
        </div>

        {review.comment ? (
          <p
            className={`mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-700 ${
              compact ? 'clamp-3' : ''
            }`}
          >
            {review.comment}
          </p>
        ) : (
          <p className="mt-3 text-sm italic text-ink-400">Rating only — no review text.</p>
        )}

        {review.existingReply ? (
          <div className="mt-3 rounded-xl border border-line bg-subtle p-3">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
              Your reply on Google
            </p>
            <p
              className={`mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-700 ${
                compact ? 'clamp-3' : ''
              }`}
            >
              {review.existingReply.comment}
            </p>
          </div>
        ) : null}

        {action ? <div className="mt-4 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </Card>
  );
}

'use client';

/**
 * AI reply drafts — the approval queue.
 *
 * The central design rule: customer content sits on a neutral surface, and
 * anything the AI wrote sits in a violet-tinted panel. You can always tell at a
 * glance which words are yours and which are suggested.
 *
 * Publishing stays a deliberate, separate action. A draft must be approved
 * first, and the server enforces that independently of this UI.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiError, relativeTime } from '@/lib/client';
import {
  CheckIcon,
  EditIcon,
  RefreshIcon,
  SendIcon,
  SparkIcon,
  StarIcon,
  TrashIcon,
} from '@/components/icons';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  SkeletonCard,
  Stars,
  type Tone,
} from '@/components/ui';
import type { ReplyDraft } from '@/lib/types';

const MAX_REPLY_CHARS = 700;

const STATUS: Record<ReplyDraft['status'], { label: string; tone: Tone }> = {
  draft_pending: { label: 'Awaiting your approval', tone: 'ai' },
  approved: { label: 'Approved — not published', tone: 'info' },
  published: { label: 'Published to Google', tone: 'success' },
  publish_failed: { label: 'Needs attention', tone: 'danger' },
};

const LANGUAGE: Record<ReplyDraft['language'], string> = {
  en: 'English',
  hi: 'Hindi',
  hinglish: 'Hinglish',
};

/** Tone is derived from the rating — the same signal the generator used. */
function toneLabel(stars: number): string {
  if (stars >= 4) return 'Warm · thankful';
  if (stars === 3) return 'Balanced · attentive';
  return 'Apologetic · professional';
}

type Filter = 'pending' | 'approved' | 'all';

export default function DraftsClient() {
  const [drafts, setDrafts] = useState<ReplyDraft[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('pending');

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ drafts: ReplyDraft[] }>('/api/reviews/reply');
      setDrafts(response.data?.drafts ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your drafts.');
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

  const textOf = (draft: ReplyDraft) => edits[draft.id] ?? draft.text;

  async function act(
    draft: ReplyDraft,
    action: 'save' | 'approve' | 'unapprove' | 'publish' | 'discard',
  ) {
    setBusy(draft.id);
    setError(null);
    setFlash(null);
    try {
      if (action === 'discard') {
        await api.del(`/api/reviews/reply?id=${encodeURIComponent(draft.id)}`);
        setFlash('Draft discarded.');
      } else if (action === 'publish') {
        const response = await api.post<{ draft: ReplyDraft }>('/api/reviews/reply/publish', {
          id: draft.id,
        });
        setFlash(response.message);
      } else {
        const body: { id: string; text?: string; action?: 'approve' | 'unapprove' } = {
          id: draft.id,
          text: textOf(draft),
        };
        if (action === 'approve') body.action = 'approve';
        if (action === 'unapprove') body.action = 'unapprove';
        const response = await api.patch<{ draft: ReplyDraft }>('/api/reviews/reply', body);
        setFlash(response.message);
      }
      setEdits((current) => {
        const next = { ...current };
        delete next[draft.id];
        return next;
      });
      setEditing((current) => ({ ...current, [draft.id]: false }));
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That action did not go through.');
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(
    () => ({
      pending: drafts.filter((d) => d.status === 'draft_pending').length,
      approved: drafts.filter((d) => d.status === 'approved').length,
    }),
    [drafts],
  );

  const visible = useMemo(() => {
    if (filter === 'pending') return drafts.filter((d) => d.status === 'draft_pending');
    if (filter === 'approved') return drafts.filter((d) => d.status === 'approved');
    return drafts;
  }, [drafts, filter]);

  return (
    <>
      <PageHeader
        eyebrow="AI assistant"
        title="AI Reply Drafts"
        description="Replies written for you, in the language your customer used. Nothing reaches Google until you publish it."
        action={
          <Button variant="secondary" onClick={refresh} loading={loading} icon={<RefreshIcon size={16} />}>
            Refresh
          </Button>
        }
      />

      {/* The safety promise, stated once, up front. */}
      <div className="mb-5">
        <Callout tone="ai" title="You are always the last step" icon={<SparkIcon size={18} />}>
          <p>
            Every draft below is private. Read it, edit anything you want, approve it, then publish —
            in that order.
          </p>
        </Callout>
      </div>

      {error ? (
        <div className="mb-4">
          <Callout tone="danger" title="That action did not go through">
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

      <div className="mb-4">
        <Segmented
          label="Filter drafts"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'pending', label: `Awaiting you${counts.pending ? ` (${counts.pending})` : ''}` },
            { value: 'approved', label: `Approved${counts.approved ? ` (${counts.approved})` : ''}` },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      {loading && drafts.length === 0 ? (
        <div className="space-y-3">
          <SkeletonCard lines={5} />
          <SkeletonCard lines={4} />
        </div>
      ) : null}

      {!loading && visible.length === 0 ? (
        <EmptyState
          icon={<SparkIcon size={24} />}
          tone="ai"
          title={drafts.length === 0 ? 'No reply drafts yet' : 'Nothing in this view'}
          description={
            drafts.length === 0
              ? 'Drafts appear here automatically when the daily sync finds a review without a reply — or instantly when you press "Generate reply" on a review.'
              : 'Switch to another filter to see the rest of your drafts.'
          }
          action={
            drafts.length === 0 ? (
              <ButtonLink href="/dashboard/reviews" size="sm" icon={<StarIcon size={15} />}>
                Go to reviews
              </ButtonLink>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setFilter('all')}>
                Show all drafts
              </Button>
            )
          }
        />
      ) : null}

      <div className="space-y-4">
        {visible.map((draft) => {
          const value = textOf(draft);
          const dirty = value !== draft.text;
          const locked = draft.status === 'published';
          const isBusy = busy === draft.id;
          const isEditing = editing[draft.id] ?? false;
          const status = STATUS[draft.status];

          return (
            <Card key={draft.id} padded={false} className="animate-fade-up overflow-hidden">
              {/* ---------------------- customer content ---------------- */}
              <div className="border-b border-line p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <Avatar name={draft.reviewerName} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="truncate text-sm font-semibold text-ink-950">
                        {draft.reviewerName}
                      </p>
                      <Badge tone={status.tone} dot>
                        {status.label}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <Stars rating={draft.starRating} size={14} />
                      <span className="text-xs text-ink-400">{relativeTime(draft.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {draft.reviewComment ? (
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-700">
                    {draft.reviewComment}
                  </p>
                ) : (
                  <p className="mt-3 text-sm italic text-ink-400">Rating only — no review text.</p>
                )}
              </div>

              {/* ------------------------ AI content -------------------- */}
              <div className="bg-ai-50/50 p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ai-700">
                    <SparkIcon size={15} />
                    AI suggested reply
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone="ai">{LANGUAGE[draft.language]}</Badge>
                    <Badge tone="neutral">{toneLabel(draft.starRating)}</Badge>
                  </span>
                </div>

                {isEditing && !locked ? (
                  <>
                    <label htmlFor={`draft-${draft.id}`} className="sr-only">
                      Edit reply for {draft.reviewerName}
                    </label>
                    <textarea
                      id={`draft-${draft.id}`}
                      rows={5}
                      maxLength={MAX_REPLY_CHARS}
                      autoFocus
                      value={value}
                      onChange={(event) =>
                        setEdits((current) => ({ ...current, [draft.id]: event.target.value }))
                      }
                      className="w-full resize-y rounded-xl border border-ai-200 bg-surface px-3.5 py-3 text-sm leading-relaxed text-ink-900 outline-none transition-colors focus:border-ai-600"
                    />
                    <p className="tnum mt-1 text-right text-xs text-ink-400">
                      {value.length}/{MAX_REPLY_CHARS}
                    </p>
                  </>
                ) : (
                  <div className="rounded-xl border border-ai-100 bg-surface px-3.5 py-3">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800">{value}</p>
                  </div>
                )}

                {draft.error ? (
                  <p className="mt-3 rounded-xl bg-danger-50 px-3 py-2.5 text-sm text-danger-700">
                    {draft.error}
                  </p>
                ) : null}

                {!locked ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {draft.status === 'approved' ? (
                      <Button
                        size="sm"
                        onClick={() => void act(draft, 'publish')}
                        loading={isBusy}
                        icon={isBusy ? undefined : <SendIcon size={15} />}
                      >
                        Publish to Google
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => void act(draft, dirty ? 'save' : 'approve')}
                        loading={isBusy}
                        icon={isBusy ? undefined : <CheckIcon size={15} />}
                      >
                        {dirty ? 'Save & approve' : 'Approve'}
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      icon={<EditIcon size={15} />}
                      onClick={() => setEditing((c) => ({ ...c, [draft.id]: !isEditing }))}
                    >
                      {isEditing ? 'Done editing' : 'Edit'}
                    </Button>

                    {draft.status === 'approved' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() => void act(draft, 'unapprove')}
                      >
                        Undo approval
                      </Button>
                    ) : null}

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isBusy}
                      icon={<TrashIcon size={15} />}
                      className="ml-auto text-ink-400 hover:text-danger-600"
                      onClick={() => void act(draft, 'discard')}
                    >
                      Discard
                    </Button>
                  </div>
                ) : null}

                {draft.status === 'approved' ? (
                  <p className="mt-2.5 text-xs text-ink-500">
                    Approved, but still private. Press Publish to send it to Google.
                  </p>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

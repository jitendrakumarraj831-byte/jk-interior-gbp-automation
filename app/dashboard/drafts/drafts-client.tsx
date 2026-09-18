'use client';

/**
 * The approval queue.
 *
 * Every draft is editable before approval, and Publish is only enabled once the
 * draft is approved — the safety rule is enforced on the server too.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, relativeTime } from '@/lib/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingCard,
  PageHeading,
  Stars,
  type Tone,
} from '@/components/ui';
import type { ReplyDraft } from '@/lib/types';

const MAX_REPLY_CHARS = 700;

const STATUS_TONE: Record<ReplyDraft['status'], Tone> = {
  draft_pending: 'warn',
  approved: 'brand',
  published: 'ok',
  publish_failed: 'danger',
};

const STATUS_LABEL: Record<ReplyDraft['status'], string> = {
  draft_pending: 'Awaiting approval',
  approved: 'Approved — not published',
  published: 'Published to Google',
  publish_failed: 'Publish failed',
};

const LANGUAGE_LABEL = { en: 'English', hi: 'Hindi', hinglish: 'Hinglish' } as const;

export default function DraftsClient() {
  const [drafts, setDrafts] = useState<ReplyDraft[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ drafts: ReplyDraft[] }>('/api/reviews/reply');
      setDrafts(response.data?.drafts ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load drafts.');
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

  function textOf(draft: ReplyDraft): string {
    return edits[draft.id] ?? draft.text;
  }

  async function act(draft: ReplyDraft, action: 'save' | 'approve' | 'unapprove' | 'publish' | 'discard') {
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
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That action failed.');
    } finally {
      setBusy(null);
    }
  }

  const pending = drafts.filter((d) => d.status === 'draft_pending').length;

  return (
    <>
      <PageHeading
        title="AI Reply Drafts"
        description={`${pending} draft(s) waiting for you. Nothing is sent to Google until you publish.`}
        action={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert tone="danger" title="Action failed">
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

      {loading && drafts.length === 0 ? <LoadingCard lines={4} /> : null}

      {!loading && drafts.length === 0 ? (
        <EmptyState
          title="No reply drafts yet"
          description="Drafts appear here after the automation runs, or when you press “Draft AI reply” on a review."
        />
      ) : null}

      <div className="space-y-3">
        {drafts.map((draft) => {
          const value = textOf(draft);
          const dirty = value !== draft.text;
          const locked = draft.status === 'published';
          const isBusy = busy === draft.id;

          return (
            <Card key={draft.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900">{draft.reviewerName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Stars rating={draft.starRating} />
                    <span className="text-xs text-ink-500">{relativeTime(draft.createdAt)}</span>
                    <Badge>{LANGUAGE_LABEL[draft.language]}</Badge>
                  </div>
                </div>
                <Badge tone={STATUS_TONE[draft.status]}>{STATUS_LABEL[draft.status]}</Badge>
              </div>

              {draft.reviewComment ? (
                <p className="mt-3 rounded-xl bg-canvas p-3 text-sm text-ink-700">
                  {draft.reviewComment}
                </p>
              ) : null}

              <label
                htmlFor={`draft-${draft.id}`}
                className="mt-4 mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500"
              >
                Reply draft
              </label>
              <textarea
                id={`draft-${draft.id}`}
                rows={4}
                maxLength={MAX_REPLY_CHARS}
                disabled={locked}
                value={value}
                onChange={(event) =>
                  setEdits((current) => ({ ...current, [draft.id]: event.target.value }))
                }
                className="w-full resize-y rounded-xl border border-hairline bg-surface px-3.5 py-3 text-ink-900 outline-none focus:border-brand-500 disabled:bg-canvas disabled:text-ink-500"
              />
              <p className="mt-1 text-right text-xs text-ink-500">
                {value.length}/{MAX_REPLY_CHARS}
              </p>

              {draft.error ? (
                <p className="mt-2 rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-600">
                  {draft.error}
                </p>
              ) : null}

              {!locked ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {dirty ? (
                    <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => void act(draft, 'save')}>
                      Save edit
                    </Button>
                  ) : null}

                  {draft.status === 'approved' ? (
                    <>
                      <Button size="sm" disabled={isBusy} onClick={() => void act(draft, 'publish')}>
                        {isBusy ? 'Publishing…' : 'Publish to Google'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isBusy}
                        onClick={() => void act(draft, 'unapprove')}
                      >
                        Undo approval
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" disabled={isBusy} onClick={() => void act(draft, 'approve')}>
                      {isBusy ? 'Saving…' : 'Approve'}
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="danger"
                    disabled={isBusy}
                    onClick={() => void act(draft, 'discard')}
                  >
                    Discard
                  </Button>
                </div>
              ) : null}

              {draft.status === 'approved' ? (
                <p className="mt-2 text-xs text-ink-500">
                  Approved but still private. Press Publish to send it to Google.
                </p>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}

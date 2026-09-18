'use client';

/**
 * Compose and manage Business Profile posts.
 *
 * A post is only shown as "Published" once Google has accepted it; a failure is
 * shown as Failed with Google's reason attached.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, formatDateTime } from '@/lib/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingCard,
  PageHeading,
  type Tone,
} from '@/components/ui';
import type { CallToActionType, GbpPost, PostStatus, PostType } from '@/lib/types';

export const POST_TYPES: { value: PostType; label: string }[] = [
  { value: 'service_promotion', label: 'Service promotion' },
  { value: 'project_update', label: 'Project update' },
  { value: 'offer', label: 'Offer' },
  { value: 'festival_greeting', label: 'Festival greeting' },
  { value: 'general', label: 'General update' },
];

const CTA_TYPES: { value: CallToActionType; label: string; needsUrl: boolean }[] = [
  { value: 'NONE', label: 'No button', needsUrl: false },
  { value: 'LEARN_MORE', label: 'Learn more', needsUrl: true },
  { value: 'BOOK', label: 'Book', needsUrl: true },
  { value: 'ORDER', label: 'Order online', needsUrl: true },
  { value: 'SHOP', label: 'Shop', needsUrl: true },
  { value: 'SIGN_UP', label: 'Sign up', needsUrl: true },
  { value: 'CALL', label: 'Call now', needsUrl: false },
];

export const STATUS_META: Record<PostStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'brand' },
  publishing: { label: 'Publishing…', tone: 'warn' },
  published: { label: 'Published', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const EMPTY_FORM = {
  type: 'service_promotion' as PostType,
  title: '',
  description: '',
  ctaType: 'LEARN_MORE' as CallToActionType,
  ctaUrl: 'https://www.jkinterior.online',
  imageUrl: '',
  scheduledFor: '',
};

export default function PostsClient() {
  const [posts, setPosts] = useState<GbpPost[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ posts: GbpPost[] }>('/api/posts');
      setPosts(response.data?.posts ?? []);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load posts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ctaMeta = CTA_TYPES.find((c) => c.value === form.ctaType);

  async function submit(action: 'draft' | 'schedule' | 'publish_now') {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api.post<{ post: GbpPost }>('/api/posts', {
        type: form.type,
        title: form.title,
        description: form.description,
        cta: {
          type: form.ctaType,
          ...(ctaMeta?.needsUrl && form.ctaUrl ? { url: form.ctaUrl } : {}),
        },
        ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}),
        ...(action === 'schedule' && form.scheduledFor
          ? { scheduledFor: new Date(form.scheduledFor).toISOString() }
          : {}),
        action,
      });
      setFlash(
        action === 'publish_now'
          ? 'Post published to Google.'
          : action === 'schedule'
            ? 'Post scheduled.'
            : 'Post saved as a draft.',
      );
      setForm(EMPTY_FORM);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the post.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function publishExisting(post: GbpPost) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const response = await api.post<{ post: GbpPost }>(`/api/posts/${post.id}/publish`);
      setFlash(response.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Publishing failed.');
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function remove(post: GbpPost) {
    setBusy(true);
    try {
      const response = await api.del<{ deleted: string }>(`/api/posts/${post.id}`);
      setFlash(response.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete the post.');
    } finally {
      setBusy(false);
      await load();
    }
  }

  const valid = form.title.trim().length > 0 && form.description.trim().length > 0;
  const inputClass =
    'w-full rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-ink-900 outline-none focus:border-brand-500';

  return (
    <>
      <PageHeading title="Posts" description="Create, draft, schedule and publish Business Profile posts" />

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

      <Card className="mb-5">
        <CardHeader title="New post" description="Saved locally first — publishing is a separate step." />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="post-type" className="mb-1.5 block text-sm font-medium text-ink-900">
              Post type
            </label>
            <select
              id="post-type"
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value as PostType })}
              className={inputClass}
            >
              {POST_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="post-title" className="mb-1.5 block text-sm font-medium text-ink-900">
              Title
            </label>
            <input
              id="post-title"
              maxLength={120}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Gypsum False Ceiling — monsoon offer"
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="post-body" className="mb-1.5 block text-sm font-medium text-ink-900">
              Description
            </label>
            <textarea
              id="post-body"
              rows={4}
              maxLength={1500}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="What should customers know? Keep it specific and short."
              className={`${inputClass} resize-y`}
            />
            <p className="mt-1 text-right text-xs text-ink-500">{form.description.length}/1500</p>
          </div>

          <div>
            <label htmlFor="post-cta" className="mb-1.5 block text-sm font-medium text-ink-900">
              Call to action
            </label>
            <select
              id="post-cta"
              value={form.ctaType}
              onChange={(event) =>
                setForm({ ...form, ctaType: event.target.value as CallToActionType })
              }
              className={inputClass}
            >
              {CTA_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {ctaMeta?.needsUrl ? (
            <div>
              <label htmlFor="post-cta-url" className="mb-1.5 block text-sm font-medium text-ink-900">
                Button link
              </label>
              <input
                id="post-cta-url"
                type="url"
                inputMode="url"
                value={form.ctaUrl}
                onChange={(event) => setForm({ ...form, ctaUrl: event.target.value })}
                className={inputClass}
              />
            </div>
          ) : null}

          <div>
            <label htmlFor="post-image" className="mb-1.5 block text-sm font-medium text-ink-900">
              Image URL <span className="font-normal text-ink-500">(optional)</span>
            </label>
            <input
              id="post-image"
              type="url"
              inputMode="url"
              value={form.imageUrl}
              onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
              placeholder="https://…/ceiling.jpg"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="post-when" className="mb-1.5 block text-sm font-medium text-ink-900">
              Schedule for <span className="font-normal text-ink-500">(optional)</span>
            </label>
            <input
              id="post-when"
              type="datetime-local"
              value={form.scheduledFor}
              onChange={(event) => setForm({ ...form, scheduledFor: event.target.value })}
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!valid || busy} onClick={() => void submit('draft')}>
            Save draft
          </Button>
          <Button
            variant="secondary"
            disabled={!valid || busy || !form.scheduledFor}
            onClick={() => void submit('schedule')}
          >
            Schedule
          </Button>
          <Button disabled={!valid || busy} onClick={() => void submit('publish_now')}>
            {busy ? 'Working…' : 'Publish now'}
          </Button>
        </div>
      </Card>

      <CardHeader title="All posts" description={`${posts.length} saved`} />

      {loading && posts.length === 0 ? <LoadingCard lines={3} /> : null}
      {!loading && posts.length === 0 ? (
        <EmptyState title="No posts yet" description="Create your first Business Profile post above." />
      ) : null}

      <div className="space-y-3">
        {posts.map((post) => {
          const meta = STATUS_META[post.status];
          return (
            <Card key={post.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900">{post.title}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {POST_TYPES.find((t) => t.value === post.type)?.label} ·{' '}
                    {post.scheduledFor
                      ? `scheduled ${formatDateTime(post.scheduledFor)}`
                      : `created ${formatDateTime(post.createdAt)}`}
                  </p>
                </div>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </div>

              <p className="mt-3 whitespace-pre-line text-sm text-ink-700">{post.description}</p>

              {post.imageUrl ? (
                <p className="mt-2 truncate text-xs text-ink-500">Image: {post.imageUrl}</p>
              ) : null}

              {post.error ? (
                <p className="mt-2 rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-600">
                  {post.error}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {post.status !== 'published' && post.status !== 'publishing' ? (
                  <Button size="sm" disabled={busy} onClick={() => void publishExisting(post)}>
                    Publish now
                  </Button>
                ) : null}
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(post)}>
                  Delete
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

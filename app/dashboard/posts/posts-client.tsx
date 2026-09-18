'use client';

/**
 * Business Posts.
 *
 * The editor opens as a full-screen sheet on mobile and a centred dialog on
 * desktop, with a live preview of how the post will read on Google. A post is
 * only shown as Published once Google has accepted it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiError, formatDateTime } from '@/lib/client';
import {
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  PlusIcon,
  PostIcon,
  RefreshIcon,
  SendIcon,
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
import type { CallToActionType, GbpPost, PostStatus, PostType } from '@/lib/types';

export const POST_TYPES: { value: PostType; label: string; blurb: string }[] = [
  { value: 'service_promotion', label: 'Service promotion', blurb: 'Highlight a service you offer' },
  { value: 'project_update', label: 'Project update', blurb: 'Show recent work' },
  { value: 'offer', label: 'Offer', blurb: 'A limited-time deal' },
  { value: 'festival_greeting', label: 'Festival greeting', blurb: 'Seasonal wishes' },
  { value: 'general', label: 'General update', blurb: 'Anything else' },
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
  scheduled: { label: 'Scheduled', tone: 'info' },
  publishing: { label: 'Publishing', tone: 'warning' },
  published: { label: 'Published', tone: 'success' },
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

const inputClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-brand-500';

const labelClass = 'mb-1.5 block text-[0.8125rem] font-medium text-ink-800';

type Filter = 'all' | 'draft' | 'scheduled' | 'published';

export default function PostsClient() {
  const [posts, setPosts] = useState<GbpPost[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ posts: GbpPost[] }>('/api/posts');
      setPosts(response.data?.posts ?? []);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your posts.');
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

  // Lock the page behind the editor sheet while it is open.
  useEffect(() => {
    if (!editorOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setEditorOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [editorOpen]);

  const ctaMeta = CTA_TYPES.find((c) => c.value === form.ctaType);
  const valid = form.title.trim().length > 0 && form.description.trim().length > 0;

  async function submit(action: 'draft' | 'schedule' | 'publish_now') {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api.post<{ post: GbpPost }>('/api/posts', {
        type: form.type,
        title: form.title,
        description: form.description,
        cta: { type: form.ctaType, ...(ctaMeta?.needsUrl && form.ctaUrl ? { url: form.ctaUrl } : {}) },
        ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}),
        ...(action === 'schedule' && form.scheduledFor
          ? { scheduledFor: new Date(form.scheduledFor).toISOString() }
          : {}),
        action,
      });
      setFlash(
        action === 'publish_now'
          ? 'Your post is live on Google.'
          : action === 'schedule'
            ? 'Scheduled. It will publish on its own.'
            : 'Saved as a draft.',
      );
      setForm(EMPTY_FORM);
      setEditorOpen(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save your post.');
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
      setError(caught instanceof ApiError ? caught.message : 'Publishing did not go through.');
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
      setError(caught instanceof ApiError ? caught.message : 'Could not delete that post.');
    } finally {
      setBusy(false);
      await load();
    }
  }

  const visible = useMemo(() => {
    if (filter === 'all') return posts;
    return posts.filter((post) => post.status === filter);
  }, [posts, filter]);

  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Business Posts"
        description="Offers, project updates and greetings that appear on your Google Business Profile."
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
            <Button onClick={() => setEditorOpen(true)} icon={<PlusIcon size={17} />}>
              Create post
            </Button>
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

      <div className="mb-4">
        <Segmented
          label="Filter posts"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'Drafts' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'published', label: 'Published' },
          ]}
        />
      </div>

      {loading && posts.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      ) : null}

      {!loading && visible.length === 0 ? (
        <EmptyState
          icon={<PostIcon size={24} />}
          tone="info"
          title={posts.length === 0 ? 'No posts yet' : 'Nothing in this view'}
          description={
            posts.length === 0
              ? 'Posts keep your profile active and give customers a reason to call. Start with a service you want more enquiries for.'
              : 'Switch filters to see your other posts.'
          }
          action={
            posts.length === 0 ? (
              <Button size="sm" onClick={() => setEditorOpen(true)} icon={<PlusIcon size={15} />}>
                Create your first post
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setFilter('all')}>
                Show all posts
              </Button>
            )
          }
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((post) => {
          const meta = STATUS_META[post.status];
          const typeLabel = POST_TYPES.find((t) => t.value === post.type)?.label;
          return (
            <Card key={post.id} padded={false} className="flex animate-fade-up flex-col overflow-hidden">
              {post.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.imageUrl}
                  alt=""
                  className="h-36 w-full bg-subtle object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-20 items-center justify-center bg-gradient-to-br from-brand-50 to-subtle text-brand-300">
                  <PostIcon size={24} />
                </div>
              )}

              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-ink-400">{typeLabel}</p>
                  <Badge tone={meta.tone} dot>
                    {meta.label}
                  </Badge>
                </div>

                <p className="mt-1.5 text-sm font-semibold leading-snug text-ink-950">{post.title}</p>
                <p className="clamp-3 mt-1.5 flex-1 text-[0.8125rem] leading-relaxed text-ink-600">
                  {post.description}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                  {post.cta.type !== 'NONE' ? (
                    <Badge tone="brand">
                      {CTA_TYPES.find((c) => c.value === post.cta.type)?.label}
                    </Badge>
                  ) : null}
                  <span className="inline-flex items-center gap-1">
                    <CalendarIcon size={13} />
                    {post.scheduledFor
                      ? formatDateTime(post.scheduledFor)
                      : formatDateTime(post.publishedAt ?? post.createdAt)}
                  </span>
                </div>

                {post.error ? (
                  <p className="mt-2.5 rounded-lg bg-danger-50 px-2.5 py-2 text-xs leading-relaxed text-danger-700">
                    {post.error}
                  </p>
                ) : null}

                <div className="mt-3.5 flex items-center gap-2 border-t border-line pt-3">
                  {post.status !== 'published' && post.status !== 'publishing' ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      icon={<SendIcon size={14} />}
                      onClick={() => void publishExisting(post)}
                    >
                      Publish
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-700">
                      <CheckIcon size={14} /> Live on Google
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Delete post: ${post.title}`}
                    className="ml-auto text-ink-400 hover:text-danger-600"
                    icon={<TrashIcon size={15} />}
                    onClick={() => void remove(post)}
                  >
                    <span className="sr-only sm:not-sr-only">Delete</span>
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* ------------------------------ editor ---------------------------- */}
      {editorOpen ? (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Create a Business Profile post"
        >
          <button
            type="button"
            aria-label="Close editor"
            onClick={() => setEditorOpen(false)}
            className="absolute inset-0 animate-scrim bg-ink-950/40 backdrop-blur-[2px]"
          />
          <div className="absolute inset-x-0 bottom-0 top-8 animate-sheet-up overflow-y-auto rounded-t-3xl bg-surface shadow-pop sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[calc(100dvh-4rem)] sm:w-[min(52rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3.5 backdrop-blur sm:px-6">
              <div>
                <h2 className="text-[0.9375rem] font-semibold text-ink-950">Create post</h2>
                <p className="text-xs text-ink-500">Saved privately first — publishing is a separate step.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                aria-label="Close editor"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-subtle"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-5">
              <div className="space-y-4 lg:col-span-3">
                <div>
                  <label htmlFor="post-type" className={labelClass}>
                    What kind of post?
                  </label>
                  <select
                    id="post-type"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as PostType })}
                    className={inputClass}
                  >
                    {POST_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} — {option.blurb}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="post-title" className={labelClass}>
                    Title
                  </label>
                  <input
                    id="post-title"
                    maxLength={120}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Gypsum False Ceiling — monsoon offer"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor="post-body" className={labelClass}>
                    Description
                  </label>
                  <textarea
                    id="post-body"
                    rows={5}
                    maxLength={1500}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="What should customers know? Keep it specific and short."
                    className={`${inputClass} resize-y leading-relaxed`}
                  />
                  <p className="tnum mt-1 text-right text-xs text-ink-400">
                    {form.description.length}/1500
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="post-cta" className={labelClass}>
                      Button
                    </label>
                    <select
                      id="post-cta"
                      value={form.ctaType}
                      onChange={(e) =>
                        setForm({ ...form, ctaType: e.target.value as CallToActionType })
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
                      <label htmlFor="post-cta-url" className={labelClass}>
                        Button link
                      </label>
                      <input
                        id="post-cta-url"
                        type="url"
                        inputMode="url"
                        value={form.ctaUrl}
                        onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  ) : null}

                  <div>
                    <label htmlFor="post-image" className={labelClass}>
                      Image URL <span className="font-normal text-ink-400">optional</span>
                    </label>
                    <input
                      id="post-image"
                      type="url"
                      inputMode="url"
                      value={form.imageUrl}
                      onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                      placeholder="https://…/ceiling.jpg"
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label htmlFor="post-when" className={labelClass}>
                      Schedule <span className="font-normal text-ink-400">optional</span>
                    </label>
                    <input
                      id="post-when"
                      type="datetime-local"
                      value={form.scheduledFor}
                      onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {/* ------------------------- live preview ------------------ */}
              <div className="lg:col-span-2">
                <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
                  Preview
                </p>
                <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
                  {form.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.imageUrl} alt="" className="h-32 w-full bg-subtle object-cover" />
                  ) : (
                    <div className="flex h-20 items-center justify-center bg-gradient-to-br from-brand-50 to-subtle text-brand-300">
                      <PostIcon size={22} />
                    </div>
                  )}
                  <div className="p-3.5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-[0.6875rem] font-bold text-white">
                        JK
                      </span>
                      <span className="text-xs font-medium text-ink-800">JK Interior</span>
                    </div>
                    <p className="mt-2.5 text-sm font-semibold leading-snug text-ink-950">
                      {form.title || 'Your title appears here'}
                    </p>
                    <p className="mt-1.5 whitespace-pre-line text-[0.8125rem] leading-relaxed text-ink-600">
                      {form.description || 'Your description appears here, exactly as customers will read it on Google.'}
                    </p>
                    {form.ctaType !== 'NONE' ? (
                      <p className="mt-3 border-t border-line pt-2.5 text-[0.8125rem] font-medium text-brand-700">
                        {CTA_TYPES.find((c) => c.value === form.ctaType)?.label}
                      </p>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-400">
                  Google renders standard posts without a separate title, so your title is added to
                  the top of the description.
                </p>
              </div>
            </div>

            <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-line bg-surface/95 px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6">
              <Button
                variant="secondary"
                disabled={!valid || busy}
                onClick={() => void submit('draft')}
                className="flex-1 sm:flex-none"
              >
                Save draft
              </Button>
              <Button
                variant="secondary"
                disabled={!valid || busy || !form.scheduledFor}
                icon={<CalendarIcon size={16} />}
                onClick={() => void submit('schedule')}
                className="flex-1 sm:flex-none"
              >
                Schedule
              </Button>
              <Button
                disabled={!valid}
                loading={busy}
                icon={busy ? undefined : <SendIcon size={16} />}
                onClick={() => void submit('publish_now')}
                className="flex-1 sm:ml-auto sm:flex-none"
              >
                Publish now
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

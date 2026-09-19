'use client';

/**
 * Media Manager.
 *
 * Every upload goes to the configured storage (Vercel Blob) and is validated
 * for type/size first — see lib/social/media.ts. "Used" is derived from
 * `usedInPostIds`, which the Content Calendar (Phase C) updates when a post
 * references a media asset; nothing here marks that by itself.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '@/lib/client';
import { AlertIcon, ImageIcon, PlusIcon, RefreshIcon, TrashIcon } from '@/components/icons';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, SkeletonCard } from '@/components/ui';
import type { MediaAsset } from '@/lib/social/types';

const inputClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-brand-500';
const labelClass = 'mb-1.5 block text-[0.8125rem] font-medium text-ink-800';

export default function MediaManagerClient() {
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('');
  const [altText, setAltText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ assets: MediaAsset[] }>('/api/social/media');
      setAssets(response.data?.assets ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load media.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload() {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      if (category.trim()) form.set('category', category.trim());
      if (altText.trim()) form.set('altText', altText.trim());
      await api.postForm('/api/social/media', form);
      if (fileInput.current) fileInput.current.value = '';
      setCategory('');
      setAltText('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.del(`/api/social/media/${id}`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete.');
    }
  }

  const filtered = (assets ?? []).filter((asset) => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return asset.filename.toLowerCase().includes(q) || (asset.category ?? '').toLowerCase().includes(q);
  });

  return (
    <>
      <PageHeader
        eyebrow="Media"
        title="Media Manager"
        description="Upload images for social posts. Instagram publishing requires a public URL, so files are stored on Vercel Blob, never locally."
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

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <div>
            <label htmlFor="media-file" className={labelClass}>
              File
            </label>
            <input id="media-file" ref={fileInput} type="file" accept="image/*,video/*" className={inputClass} />
          </div>
          <div>
            <label htmlFor="media-category" className={labelClass}>
              Category <span className="font-normal text-ink-400">optional</span>
            </label>
            <input
              id="media-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. gypsum-ceiling"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="media-alt" className={labelClass}>
              Alt text <span className="font-normal text-ink-400">optional</span>
            </label>
            <input
              id="media-alt"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder="Describe the image"
              className={inputClass}
            />
          </div>
          <div className="flex items-end">
            <Button loading={uploading} icon={<PlusIcon size={16} />} onClick={() => void upload()}>
              Upload
            </Button>
          </div>
        </div>
      </Card>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search by filename or category…"
        className={`${inputClass} mb-4 max-w-sm`}
      />

      {loading && !assets ? <SkeletonCard lines={4} /> : null}

      {assets && filtered.length === 0 ? (
        <EmptyState
          icon={<ImageIcon size={22} />}
          title="No media yet"
          description="Upload an image above to use it in a social post."
        />
      ) : null}

      {filtered.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((asset) => (
            <Card key={asset.id} className="p-0 overflow-hidden">
              <div className="flex aspect-square items-center justify-center bg-subtle">
                {asset.contentType.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote Blob URL, not a local asset
                  <img src={asset.url} alt={asset.altText ?? asset.filename} className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon size={28} className="text-ink-300" />
                )}
              </div>
              <div className="space-y-2 p-3">
                <p className="truncate text-xs font-medium text-ink-900" title={asset.filename}>
                  {asset.filename}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {asset.category ? <Badge tone="neutral">{asset.category}</Badge> : null}
                  <Badge tone={asset.usedInPostIds.length > 0 ? 'success' : 'neutral'}>
                    {asset.usedInPostIds.length > 0 ? 'Used' : 'Unused'}
                  </Badge>
                </div>
                <Button size="sm" variant="secondary" className="w-full" onClick={() => void remove(asset.id)} icon={<TrashIcon size={14} />}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </>
  );
}

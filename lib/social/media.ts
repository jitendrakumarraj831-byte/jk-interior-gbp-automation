/**
 * Media storage abstraction.
 *
 * This project has no existing media/upload/CDN system to reuse (confirmed by
 * repo-wide search before this feature was built), so this is new. Vercel
 * Blob is the implementation because it is the same platform this app already
 * deploys to and requires no new vendor account — but every caller goes
 * through this module's interface, not the Vercel Blob SDK directly, so a
 * different backend could replace it without touching call sites.
 *
 * Disabled (throws MEDIA_STORAGE_NOT_CONFIGURED) until BLOB_READ_WRITE_TOKEN
 * is set — Vercel injects that automatically once a Blob store is attached to
 * the project; nothing here asks an operator to paste a token by hand.
 *
 * Instagram/Facebook publishing requires a publicly reachable https URL at
 * publish time — never a local path or a browser blob: URL. Vercel Blob's
 * `public` access mode is exactly that.
 *
 * Server-only module.
 */

import { del, put } from '@vercel/blob';

import { env, isMediaStorageConfigured } from '../config';
import { AppError } from '../errors';

/** Conservative, provisional limits — reconfirm against the live Meta docs before first real use. */
export const MEDIA_LIMITS = {
  image: { maxBytes: 8 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  video: { maxBytes: 100 * 1024 * 1024, types: ['video/mp4', 'video/quicktime'] },
} as const;

export function validateMediaFile(file: { contentType: string; sizeBytes: number }): void {
  const isImage = (MEDIA_LIMITS.image.types as readonly string[]).includes(file.contentType);
  const isVideo = (MEDIA_LIMITS.video.types as readonly string[]).includes(file.contentType);

  if (!isImage && !isVideo) {
    throw new AppError(
      'META_MEDIA_INVALID',
      `Unsupported file type "${file.contentType}". Allowed: ${[
        ...MEDIA_LIMITS.image.types,
        ...MEDIA_LIMITS.video.types,
      ].join(', ')}.`,
      400,
    );
  }

  const limit = isImage ? MEDIA_LIMITS.image.maxBytes : MEDIA_LIMITS.video.maxBytes;
  if (file.sizeBytes > limit) {
    throw new AppError(
      'META_MEDIA_INVALID',
      `File is too large (${Math.round(file.sizeBytes / 1024 / 1024)}MB). Limit is ${Math.round(
        limit / 1024 / 1024,
      )}MB for this file type.`,
      400,
    );
  }
}

function assertConfigured(): void {
  if (!isMediaStorageConfigured()) {
    throw new AppError(
      'MEDIA_STORAGE_NOT_CONFIGURED',
      'No media storage is configured. Attach a Vercel Blob store to this project (sets BLOB_READ_WRITE_TOKEN automatically).',
      503,
    );
  }
}

export async function uploadMedia(input: {
  buffer: Buffer;
  filename: string;
  contentType: string;
}): Promise<{ url: string }> {
  assertConfigured();
  const blob = await put(input.filename, input.buffer, {
    access: 'public',
    contentType: input.contentType,
    addRandomSuffix: true,
    token: env().BLOB_READ_WRITE_TOKEN,
  });
  return { url: blob.url };
}

/** Best-effort: a missing store or an already-deleted blob must never fail the caller. */
export async function deleteMedia(url: string): Promise<void> {
  if (!isMediaStorageConfigured()) return;
  await del(url, { token: env().BLOB_READ_WRITE_TOKEN }).catch(() => {
    /* best effort */
  });
}

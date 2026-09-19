/**
 * Media Manager: list + upload.
 *
 * Upload is multipart/form-data (`file`, optional `category`/`altText`).
 * Validated for type/size before it ever reaches storage (lib/social/media.ts).
 */

import { z } from 'zod';

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { sanitizeText } from '@/lib/security';
import { uploadMedia, validateMediaFile } from '@/lib/social/media';
import { listMediaAssets, newSocialId, saveMediaAsset } from '@/lib/social/repository';
import type { MediaAsset } from '@/lib/social/types';
import { assertAdmin, handleRoute, ok } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILENAME = 200;
const MAX_CATEGORY = 60;
const MAX_ALT_TEXT = 300;

export async function GET(request: Request) {
  return handleRoute('social/media', async () => {
    assertAdmin(request);
    const assets = await listMediaAssets();
    return ok({ assets });
  });
}

const metaSchema = z.object({
  category: z.string().trim().max(MAX_CATEGORY).optional(),
  altText: z.string().trim().max(MAX_ALT_TEXT).optional(),
});

export async function POST(request: Request) {
  return handleRoute('social/media', async () => {
    assertAdmin(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Expected multipart/form-data with a "file" field.', 400);
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', 'No file was provided.', 400);
    }

    const meta = metaSchema.parse({
      category: form.get('category')?.toString(),
      altText: form.get('altText')?.toString(),
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    validateMediaFile({ contentType: file.type, sizeBytes: buffer.length });

    const { url } = await uploadMedia({
      buffer,
      filename: sanitizeText(file.name, MAX_FILENAME) || `upload-${Date.now()}`,
      contentType: file.type,
    });

    const asset: MediaAsset = {
      id: newSocialId(),
      url,
      filename: sanitizeText(file.name, MAX_FILENAME),
      contentType: file.type,
      sizeBytes: buffer.length,
      category: meta.category,
      altText: meta.altText,
      usedInPostIds: [],
      createdAt: new Date().toISOString(),
    };
    await saveMediaAsset(asset);

    await recordAudit({
      actor: actorFromRequest(request),
      action: 'media_uploaded',
      resource: `media:${asset.id}`,
      status: 'success',
      source: 'dashboard',
      detail: `Uploaded ${asset.filename}`,
    });

    return ok({ asset }, 'Media uploaded.');
  });
}

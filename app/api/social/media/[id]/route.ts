/** Delete a media asset — from the store and from storage. */

import { actorFromRequest, recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { assertAdmin, handleRoute, ok } from '@/lib/security';
import { deleteMedia } from '@/lib/social/media';
import { deleteMediaAsset, getMediaAsset } from '@/lib/social/repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute('social/media/[id]', async () => {
    assertAdmin(request);
    const { id } = await params;
    const asset = await getMediaAsset(id);
    if (!asset) throw new AppError('NOT_FOUND', 'Media asset not found.', 404);

    await deleteMedia(asset.url);
    await deleteMediaAsset(id);
    await recordAudit({
      actor: actorFromRequest(request),
      action: 'media_deleted',
      resource: `media:${id}`,
      status: 'success',
      source: 'dashboard',
      detail: asset.filename,
    });

    return ok({ deleted: true }, 'Media deleted.');
  });
}

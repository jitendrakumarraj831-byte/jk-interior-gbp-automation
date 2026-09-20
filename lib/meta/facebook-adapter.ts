/**
 * Facebook Page publishing.
 *
 * Text-only → POST /{page-id}/feed. One image → POST /{page-id}/photos
 * (the photo post IS the feed post). Multiple images → upload each photo
 * unpublished, then attach them to one /{page-id}/feed post via
 * attached_media — Meta's documented multi-photo album pattern.
 *
 * NOTE: sends parameters as a JSON body (graphRequest's default), which the
 * Graph API has accepted for POST requests for years. Verify against a real
 * app before the first live publish — this was written without direct
 * access to developers.facebook.com from this environment (see
 * docs/META_SOCIAL_AUTOMATION.md).
 */

import { graphRequest } from './client';

export async function publishToFacebook(input: {
  pageId: string;
  accessToken: string;
  caption: string;
  mediaUrls: string[];
}): Promise<{ externalId: string }> {
  if (input.mediaUrls.length === 0) {
    const result = await graphRequest<{ id: string }>('POST', `${input.pageId}/feed`, {
      accessToken: input.accessToken,
      body: { message: input.caption },
    });
    return { externalId: result.id };
  }

  if (input.mediaUrls.length === 1) {
    const result = await graphRequest<{ id: string; post_id?: string }>('POST', `${input.pageId}/photos`, {
      accessToken: input.accessToken,
      body: { url: input.mediaUrls[0], caption: input.caption },
    });
    return { externalId: result.post_id ?? result.id };
  }

  const uploaded = await Promise.all(
    input.mediaUrls.slice(0, 10).map((url) =>
      graphRequest<{ id: string }>('POST', `${input.pageId}/photos`, {
        accessToken: input.accessToken,
        body: { url, published: false },
      }),
    ),
  );
  const result = await graphRequest<{ id: string }>('POST', `${input.pageId}/feed`, {
    accessToken: input.accessToken,
    body: {
      message: input.caption,
      attached_media: uploaded.map((u) => ({ media_fbid: u.id })),
    },
  });
  return { externalId: result.id };
}

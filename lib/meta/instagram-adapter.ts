/**
 * Instagram Professional publishing — container-based, per Meta's
 * documented flow: POST /{ig-user-id}/media to create a container, then
 * POST /{ig-user-id}/media_publish with its id.
 *
 *  - Single image: container publishes immediately.
 *  - Single video: media_type=REELS, then poll the container's status_code
 *    until FINISHED before publishing (bounded — see waitForContainerReady).
 *  - Carousel (2-10 items, images only here): one child container per image
 *    with is_carousel_item=true, then a parent container with
 *    media_type=CAROUSEL and those children.
 *
 * NOTE: written without direct access to developers.facebook.com from this
 * environment — the container/publish flow, REELS media_type and the
 * documented 100-post/24h publishing limit are corroborated by multiple
 * independent 2026 sources, but should be re-verified against the live docs
 * before the first real publish (see docs/META_SOCIAL_AUTOMATION.md).
 */

import { AppError } from '../errors';
import { graphRequest } from './client';

export type InstagramMediaInput = { url: string; contentType: string };

function isVideo(media: InstagramMediaInput): boolean {
  return media.contentType.startsWith('video/');
}

/**
 * Polls a video container until Meta finishes processing it. Bounded to a
 * handful of short, increasing waits (~24s total) rather than an open-ended
 * loop — a serverless cron invocation has a hard time limit, and "not ready
 * yet" is retried on the next scheduled cron run, not by blocking this one.
 */
async function waitForContainerReady(containerId: string, accessToken: string): Promise<void> {
  const delaysMs = [2000, 3000, 4000, 5000, 5000, 5000];
  for (const delay of delaysMs) {
    const status = await graphRequest<{ status_code?: string }>('GET', containerId, {
      accessToken,
      params: { fields: 'status_code' },
    });
    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR') {
      throw new AppError('META_API_ERROR', 'Instagram failed to process the uploaded video.', 502);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new AppError(
    'META_RATE_LIMITED',
    'Instagram is still processing the video container. This will retry on the next scheduled run.',
    503,
  );
}

export async function publishToInstagram(input: {
  igUserId: string;
  accessToken: string;
  caption: string;
  media: InstagramMediaInput[];
}): Promise<{ externalId: string }> {
  if (input.media.length === 0) {
    throw new AppError('META_MEDIA_INVALID', 'Instagram requires at least one image or video.', 400);
  }

  let creationId: string;

  if (input.media.length === 1) {
    const item = input.media[0]!;
    if (isVideo(item)) {
      const container = await graphRequest<{ id: string }>('POST', `${input.igUserId}/media`, {
        accessToken: input.accessToken,
        body: { media_type: 'REELS', video_url: item.url, caption: input.caption },
      });
      await waitForContainerReady(container.id, input.accessToken);
      creationId = container.id;
    } else {
      const container = await graphRequest<{ id: string }>('POST', `${input.igUserId}/media`, {
        accessToken: input.accessToken,
        body: { image_url: item.url, caption: input.caption },
      });
      creationId = container.id;
    }
  } else {
    if (input.media.some(isVideo)) {
      throw new AppError(
        'META_MEDIA_INVALID',
        'A carousel can only contain images here — publish a video as a single Reel instead.',
        400,
      );
    }
    const children = await Promise.all(
      input.media.slice(0, 10).map((item) =>
        graphRequest<{ id: string }>('POST', `${input.igUserId}/media`, {
          accessToken: input.accessToken,
          body: { image_url: item.url, is_carousel_item: true },
        }),
      ),
    );
    const parent = await graphRequest<{ id: string }>('POST', `${input.igUserId}/media`, {
      accessToken: input.accessToken,
      body: { media_type: 'CAROUSEL', children: children.map((c) => c.id), caption: input.caption },
    });
    creationId = parent.id;
  }

  const published = await graphRequest<{ id: string }>('POST', `${input.igUserId}/media_publish`, {
    accessToken: input.accessToken,
    body: { creation_id: creationId },
  });
  return { externalId: published.id };
}

/**
 * Facebook Page publishing adapter. All Graph API calls are mocked via
 * `fetch` — no real Facebook post is ever created.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realFetch = globalThis.fetch;
const calls: { url: string; body: unknown }[] = [];

function mockGraph(responses: { url: RegExp; body: unknown }[]) {
  globalThis.fetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0]);
    const init = args[1] as RequestInit | undefined;
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const match = responses.find((r) => r.url.test(url));
    if (!match) throw new Error(`Unexpected fetch call: ${url}`);
    return new Response(JSON.stringify(match.body), { status: 200 });
  }) as typeof fetch;
}

async function loadAdapter() {
  vi.resetModules();
  return import('@/lib/meta/facebook-adapter');
}

beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('publishToFacebook', () => {
  it('posts text-only content to /{page}/feed', async () => {
    mockGraph([{ url: /\/page-1\/feed/, body: { id: 'post-1' } }]);
    const { publishToFacebook } = await loadAdapter();

    const result = await publishToFacebook({
      pageId: 'page-1',
      accessToken: 'token',
      caption: 'Hello JK Interior',
      mediaUrls: [],
    });

    expect(result.externalId).toBe('post-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/page-1/feed');
    expect(calls[0]!.body).toMatchObject({ message: 'Hello JK Interior' });
  });

  it('posts a single image via /{page}/photos and prefers post_id', async () => {
    mockGraph([{ url: /\/page-1\/photos/, body: { id: 'photo-1', post_id: 'page-1_post-1' } }]);
    const { publishToFacebook } = await loadAdapter();

    const result = await publishToFacebook({
      pageId: 'page-1',
      accessToken: 'token',
      caption: 'A photo',
      mediaUrls: ['https://blob.example/a.jpg'],
    });

    expect(result.externalId).toBe('page-1_post-1');
    expect(calls[0]!.body).toMatchObject({ url: 'https://blob.example/a.jpg', caption: 'A photo' });
  });

  it('uploads multiple photos unpublished, then attaches them to one feed post', async () => {
    let photoCount = 0;
    globalThis.fetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      const init = args[1] as RequestInit | undefined;
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, body });
      if (url.includes('/page-1/photos')) {
        photoCount += 1;
        return new Response(JSON.stringify({ id: `photo-${photoCount}` }), { status: 200 });
      }
      if (url.includes('/page-1/feed')) {
        return new Response(JSON.stringify({ id: 'album-post-1' }), { status: 200 });
      }
      throw new Error(`Unexpected call: ${url}`);
    }) as typeof fetch;

    const { publishToFacebook } = await loadAdapter();
    const result = await publishToFacebook({
      pageId: 'page-1',
      accessToken: 'token',
      caption: 'An album',
      mediaUrls: ['https://blob.example/a.jpg', 'https://blob.example/b.jpg'],
    });

    expect(result.externalId).toBe('album-post-1');
    const photoUploads = calls.filter((c) => c.url.includes('/photos'));
    expect(photoUploads).toHaveLength(2);
    expect(photoUploads.every((c) => (c.body as { published: boolean }).published === false)).toBe(true);

    const feedCall = calls.find((c) => c.url.includes('/feed'));
    expect(feedCall?.body).toMatchObject({
      message: 'An album',
      attached_media: [{ media_fbid: 'photo-1' }, { media_fbid: 'photo-2' }],
    });
  });

  it('classifies a Meta error response instead of throwing a raw fetch error', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 190, error_subcode: 463, message: 'Expired' } }), {
          status: 401,
        }),
    ) as typeof fetch;

    const { publishToFacebook } = await loadAdapter();
    await expect(
      publishToFacebook({ pageId: 'page-1', accessToken: 'bad', caption: 'x', mediaUrls: [] }),
    ).rejects.toMatchObject({ code: 'META_TOKEN_EXPIRED' });
  });
});

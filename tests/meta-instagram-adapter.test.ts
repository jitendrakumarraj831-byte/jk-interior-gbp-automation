/**
 * Instagram Professional publishing adapter. All Graph API calls are mocked
 * via `fetch` — no real Instagram post is ever created. Video-container
 * polling uses real timers with tiny mocked delays.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realFetch = globalThis.fetch;

async function loadAdapter() {
  vi.resetModules();
  return import('@/lib/meta/instagram-adapter');
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe('publishToInstagram', () => {
  it('throws META_MEDIA_INVALID when no media is supplied', async () => {
    const { publishToInstagram } = await loadAdapter();
    await expect(
      publishToInstagram({ igUserId: 'ig-1', accessToken: 'token', caption: 'x', media: [] }),
    ).rejects.toMatchObject({ code: 'META_MEDIA_INVALID' });
  });

  it('publishes a single image container immediately, with no polling', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      calls.push(url);
      if (url.includes('/media_publish')) return new Response(JSON.stringify({ id: 'media-1' }), { status: 200 });
      return new Response(JSON.stringify({ id: 'container-1' }), { status: 200 });
    }) as typeof fetch;

    const { publishToInstagram } = await loadAdapter();
    const result = await publishToInstagram({
      igUserId: 'ig-1',
      accessToken: 'token',
      caption: 'A photo',
      media: [{ url: 'https://blob.example/a.jpg', contentType: 'image/jpeg' }],
    });

    expect(result.externalId).toBe('media-1');
    // Exactly container create + publish — no status polling for an image.
    expect(calls.filter((u) => u.includes('status_code'))).toHaveLength(0);
    expect(calls).toHaveLength(2);
  });

  it('polls a video container until FINISHED, then publishes', async () => {
    vi.useFakeTimers();
    let statusCalls = 0;
    globalThis.fetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      if (url.includes('/media_publish')) return new Response(JSON.stringify({ id: 'media-reel-1' }), { status: 200 });
      if (url.includes('fields=status_code')) {
        statusCalls += 1;
        const status_code = statusCalls < 3 ? 'IN_PROGRESS' : 'FINISHED';
        return new Response(JSON.stringify({ status_code }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'container-reel-1' }), { status: 200 });
    }) as typeof fetch;

    const { publishToInstagram } = await loadAdapter();
    const promise = publishToInstagram({
      igUserId: 'ig-1',
      accessToken: 'token',
      caption: 'A reel',
      media: [{ url: 'https://blob.example/a.mp4', contentType: 'video/mp4' }],
    });

    // Advance through the adapter's bounded polling delays.
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;

    expect(result.externalId).toBe('media-reel-1');
    expect(statusCalls).toBeGreaterThanOrEqual(3);
  });

  it('throws META_RATE_LIMITED (not an infinite loop) if the video never finishes processing', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      if (url.includes('fields=status_code')) {
        return new Response(JSON.stringify({ status_code: 'IN_PROGRESS' }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'container-stuck' }), { status: 200 });
    }) as typeof fetch;

    const { publishToInstagram } = await loadAdapter();
    const promise = publishToInstagram({
      igUserId: 'ig-1',
      accessToken: 'token',
      caption: 'x',
      media: [{ url: 'https://blob.example/stuck.mp4', contentType: 'video/mp4' }],
    });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'META_RATE_LIMITED' });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it('publishes a multi-image carousel via child containers + a CAROUSEL parent', async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      const init = args[1] as RequestInit | undefined;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      bodies.push(body);
      if (url.includes('/media_publish')) return new Response(JSON.stringify({ id: 'media-carousel-1' }), { status: 200 });
      if (body.media_type === 'CAROUSEL') return new Response(JSON.stringify({ id: 'parent-container' }), { status: 200 });
      return new Response(JSON.stringify({ id: `child-${bodies.length}` }), { status: 200 });
    }) as typeof fetch;

    const { publishToInstagram } = await loadAdapter();
    const result = await publishToInstagram({
      igUserId: 'ig-1',
      accessToken: 'token',
      caption: 'A carousel',
      media: [
        { url: 'https://blob.example/a.jpg', contentType: 'image/jpeg' },
        { url: 'https://blob.example/b.jpg', contentType: 'image/jpeg' },
      ],
    });

    expect(result.externalId).toBe('media-carousel-1');
    const childBodies = bodies.filter((b) => b.is_carousel_item === true);
    expect(childBodies).toHaveLength(2);
    const parentBody = bodies.find((b) => b.media_type === 'CAROUSEL');
    expect(parentBody?.children).toEqual(['child-1', 'child-2']);
  });

  it('rejects a carousel containing a video', async () => {
    const { publishToInstagram } = await loadAdapter();
    await expect(
      publishToInstagram({
        igUserId: 'ig-1',
        accessToken: 'token',
        caption: 'x',
        media: [
          { url: 'https://blob.example/a.jpg', contentType: 'image/jpeg' },
          { url: 'https://blob.example/b.mp4', contentType: 'video/mp4' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'META_MEDIA_INVALID' });
  });

  it('classifies the Instagram daily publishing-limit error (code 9) as META_RATE_LIMITED', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 9, message: 'Publishing limit reached' } }), { status: 400 }),
    ) as typeof fetch;

    const { publishToInstagram } = await loadAdapter();
    await expect(
      publishToInstagram({
        igUserId: 'ig-1',
        accessToken: 'token',
        caption: 'x',
        media: [{ url: 'https://blob.example/a.jpg', contentType: 'image/jpeg' }],
      }),
    ).rejects.toMatchObject({ code: 'META_RATE_LIMITED' });
  });
});

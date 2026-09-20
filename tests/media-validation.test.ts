/**
 * Media validation + storage abstraction. @vercel/blob is mocked — no network
 * call is made and nothing is actually uploaded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const putMock = vi.fn(async (filename: string, _body: unknown, _options: unknown) => ({
  url: `https://blob.example/${filename}`,
}));
const delMock = vi.fn(async (_url: string, _options: unknown) => undefined);

vi.mock('@vercel/blob', () => ({
  put: (filename: string, body: unknown, options: unknown) => putMock(filename, body, options),
  del: (url: string, options: unknown) => delMock(url, options),
}));

async function loadMedia(env: Record<string, string | undefined>) {
  vi.resetModules();
  delete process.env.BLOB_READ_WRITE_TOKEN;
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  return import('@/lib/social/media');
}

beforeEach(() => {
  putMock.mockClear();
  delMock.mockClear();
});

describe('validateMediaFile', () => {
  it('accepts a JPEG under the image size limit', async () => {
    const media = await loadMedia({});
    expect(() => media.validateMediaFile({ contentType: 'image/jpeg', sizeBytes: 2 * 1024 * 1024 })).not.toThrow();
  });

  it('rejects an unsupported content type', async () => {
    const media = await loadMedia({});
    expect(() => media.validateMediaFile({ contentType: 'application/pdf', sizeBytes: 1024 })).toThrow(
      'Unsupported file type',
    );
  });

  it('rejects an image over the size limit', async () => {
    const media = await loadMedia({});
    expect(() =>
      media.validateMediaFile({ contentType: 'image/png', sizeBytes: 20 * 1024 * 1024 }),
    ).toThrow('too large');
  });

  it('accepts an MP4 under the video size limit', async () => {
    const media = await loadMedia({});
    expect(() =>
      media.validateMediaFile({ contentType: 'video/mp4', sizeBytes: 50 * 1024 * 1024 }),
    ).not.toThrow();
  });
});

describe('uploadMedia', () => {
  it('throws MEDIA_STORAGE_NOT_CONFIGURED when BLOB_READ_WRITE_TOKEN is unset', async () => {
    const media = await loadMedia({});
    await expect(
      media.uploadMedia({ buffer: Buffer.from('x'), filename: 'a.jpg', contentType: 'image/jpeg' }),
    ).rejects.toThrow('No media storage is configured');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('uploads via the storage abstraction once configured', async () => {
    const media = await loadMedia({ BLOB_READ_WRITE_TOKEN: 'test-token' });
    const result = await media.uploadMedia({
      buffer: Buffer.from('x'),
      filename: 'a.jpg',
      contentType: 'image/jpeg',
    });
    expect(result.url).toBe('https://blob.example/a.jpg');
    expect(putMock).toHaveBeenCalledTimes(1);
  });
});

describe('deleteMedia', () => {
  it('is a no-op (never throws) when storage is not configured', async () => {
    const media = await loadMedia({});
    await expect(media.deleteMedia('https://blob.example/a.jpg')).resolves.toBeUndefined();
    expect(delMock).not.toHaveBeenCalled();
  });

  it('calls the storage delete once configured', async () => {
    const media = await loadMedia({ BLOB_READ_WRITE_TOKEN: 'test-token' });
    await media.deleteMedia('https://blob.example/a.jpg');
    expect(delMock).toHaveBeenCalledTimes(1);
  });
});

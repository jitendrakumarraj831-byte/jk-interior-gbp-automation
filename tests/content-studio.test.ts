/**
 * AI Content Studio prompt building + response parsing. The AI router is
 * mocked — no real provider call is made.
 */

import { describe, expect, it, vi } from 'vitest';

const generateMock = vi.fn();

vi.mock('@/lib/ai/router', () => ({
  generate: (...args: unknown[]) => generateMock(...args),
}));

async function loadStudio() {
  vi.resetModules();
  generateMock.mockReset();
  return import('@/lib/social/content-studio');
}

describe('generateSocialContent', () => {
  it('returns distinct Facebook and Instagram content for platforms="both"', async () => {
    const studio = await loadStudio();
    generateMock.mockResolvedValue({
      provider: 'groq',
      model: 'test-model',
      content: JSON.stringify({
        title: 'Gypsum ceiling post',
        facebook: { caption: 'Facebook caption', hashtags: ['jkinterior'] },
        instagram: { caption: 'Instagram caption', hashtags: ['interior', 'ceiling'] },
      }),
    });

    const result = await studio.generateSocialContent({
      contentType: 'gypsum_false_ceiling',
      platforms: 'both',
      language: 'en',
    });

    expect(result.title).toBe('Gypsum ceiling post');
    expect(result.facebookContent).toEqual({ caption: 'Facebook caption', hashtags: ['jkinterior'] });
    expect(result.instagramContent).toEqual({
      caption: 'Instagram caption',
      hashtags: ['interior', 'ceiling'],
    });
    expect(result.facebookContent?.caption).not.toBe(result.instagramContent?.caption);
  });

  it('returns only Facebook content when platforms="facebook"', async () => {
    const studio = await loadStudio();
    generateMock.mockResolvedValue({
      provider: 'groq',
      model: 'test-model',
      content: JSON.stringify({ title: 'Offer post', facebook: { caption: 'FB only', hashtags: [] } }),
    });

    const result = await studio.generateSocialContent({
      contentType: 'offer',
      platforms: 'facebook',
      language: 'en',
    });

    expect(result.facebookContent).toEqual({ caption: 'FB only', hashtags: [] });
    expect(result.instagramContent).toBeNull();
  });

  it('strips a markdown code fence around the JSON response', async () => {
    const studio = await loadStudio();
    generateMock.mockResolvedValue({
      provider: 'gemini',
      model: 'test-model',
      content:
        '```json\n' +
        JSON.stringify({ title: 'Tip', instagram: { caption: 'A tip', hashtags: ['tip'] } }) +
        '\n```',
    });

    const result = await studio.generateSocialContent({
      contentType: 'interior_tip',
      platforms: 'instagram',
      language: 'en',
    });

    expect(result.instagramContent?.caption).toBe('A tip');
  });

  it('throws AI_FAILED when the response is not valid JSON', async () => {
    const studio = await loadStudio();
    generateMock.mockResolvedValue({ provider: 'groq', model: 'test-model', content: 'not json at all' });

    await expect(
      studio.generateSocialContent({ contentType: 'faq', platforms: 'both', language: 'en' }),
    ).rejects.toThrow('could not be parsed');
  });

  it('throws AI_FAILED when the requested platform content is missing', async () => {
    const studio = await loadStudio();
    generateMock.mockResolvedValue({
      provider: 'groq',
      model: 'test-model',
      content: JSON.stringify({ title: 'Missing IG' }), // no facebook/instagram key at all
    });

    await expect(
      studio.generateSocialContent({ contentType: 'faq', platforms: 'both', language: 'en' }),
    ).rejects.toThrow('did not return usable content');
  });
});

/**
 * Reply-quality guards and provider fallback edge cases.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('Google translation markers', () => {
  it('keeps the original text the customer wrote, not the machine translation', async () => {
    const { originalComment } = await import('@/lib/ai-reply');
    expect(
      originalComment('(Translated by Google) Very good work\n\n(Original)\nबहुत बढ़िया काम किया'),
    ).toBe('बहुत बढ़िया काम किया');
    expect(originalComment('Plain English review')).toBe('Plain English review');
    expect(originalComment('(Translated by Google) Only a translation')).toBe('Only a translation');
  });

  it('detects the language from the original, so a Hindi review gets a Hindi reply', async () => {
    const { detectLanguage, originalComment } = await import('@/lib/ai-reply');
    const raw = '(Translated by Google) Very good work\n\n(Original)\nबहुत बढ़िया काम किया';
    expect(detectLanguage(raw)).toBe('hi');
    expect(detectLanguage(originalComment(raw))).toBe('hi');
  });
});

describe('truncateAtSentence', () => {
  it('cuts at the last full sentence that fits, never mid-word', async () => {
    const { truncateAtSentence } = await import('@/lib/ai-reply');
    const text = 'First sentence is here. Second sentence is also here. Third sentence runs on and on forever';
    const cut = truncateAtSentence(text, 60);
    expect(cut).toBe('First sentence is here. Second sentence is also here.');
    expect(cut.length).toBeLessThanOrEqual(60);
  });

  it('falls back to a word boundary when there is no usable sentence end', async () => {
    const { truncateAtSentence } = await import('@/lib/ai-reply');
    const cut = truncateAtSentence('word '.repeat(50), 42);
    expect(cut.length).toBeLessThanOrEqual(42);
    expect(cut.endsWith('word')).toBe(true);
  });

  it('leaves a short reply alone', async () => {
    const { truncateAtSentence } = await import('@/lib/ai-reply');
    expect(truncateAtSentence('Thanks a lot.', 700)).toBe('Thanks a lot.');
  });
});

describe('replyFlags', () => {
  const review = { starRating: 3 as const, comment: 'ok' };

  it('stays quiet for a normal reply', async () => {
    const { replyFlags } = await import('@/lib/ai-reply');
    expect(replyFlags('Thank you for the feedback — we will keep improving.', review)).toEqual([]);
  });

  it('flags contact details, links and money promises', async () => {
    const { replyFlags } = await import('@/lib/ai-reply');
    expect(replyFlags('Call us on +91 98765 43210', review)).toHaveLength(1);
    expect(replyFlags('See www.example.com for details', review)).toHaveLength(1);
    expect(replyFlags('Write to owner@example.com', review)).toHaveLength(1);
    expect(replyFlags('We will refund you in full', review)).toHaveLength(1);
    expect(replyFlags('You get 20% off next time', review)).toHaveLength(1);
    expect(replyFlags('We guarantee the result', review)).toHaveLength(1);
    expect(replyFlags('We will fix it within 3 days', review)).toHaveLength(1);
  });

  it('flags a cheerful reply to a low rating', async () => {
    const { replyFlags } = await import('@/lib/ai-reply');
    expect(replyFlags('We are thrilled to hear this!', { starRating: 1, comment: 'bad' })).toHaveLength(1);
    expect(replyFlags('We are thrilled to hear this!', { starRating: 5, comment: 'great' })).toHaveLength(0);
  });

  it('refuses a reply that says it was written by an AI', async () => {
    const { replyFlags } = await import('@/lib/ai-reply');
    expect(() => replyFlags('As an AI language model, I thank you.', review)).toThrow(/AI/);
    // …but never throws on text a person typed.
    const { editedReplyFlags } = await import('@/lib/ai-reply');
    expect(editedReplyFlags('As an AI language model, I thank you.', review)).toHaveLength(1);
  });
});

describe('provider error classification', () => {
  it('a retired model (404 / model_decommissioned) falls through to the next provider', async () => {
    const { classify, shouldFallBack } = await import('@/lib/ai/errors');
    expect(classify(Object.assign(new Error('x'), { status: 404 }))).toBe('model_unavailable');
    expect(classify(Object.assign(new Error('x'), { status: 400, code: 'model_decommissioned' }))).toBe('model_unavailable');
    expect(shouldFallBack('model_unavailable')).toBe(true);
  });

  it('a malformed request (400/422) still does NOT fall through', async () => {
    const { classify, shouldFallBack } = await import('@/lib/ai/errors');
    expect(classify(Object.assign(new Error('x'), { status: 400 }))).toBe('invalid_request');
    expect(classify(Object.assign(new Error('x'), { status: 422 }))).toBe('invalid_request');
    expect(shouldFallBack('invalid_request')).toBe(false);
  });

  it('auth, rate limit, timeout and outage are each distinguished', async () => {
    const { classify } = await import('@/lib/ai/errors');
    expect(classify(Object.assign(new Error('x'), { status: 401 }))).toBe('auth');
    expect(classify(Object.assign(new Error('x'), { status: 429 }))).toBe('rate_limit');
    expect(classify(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('timeout');
    expect(classify(Object.assign(new Error('x'), { status: 503 }))).toBe('temporary');
    expect(classify(new Error('socket hang up'))).toBe('temporary');
  });
});

describe('provider SDK retries', () => {
  it('the OpenAI-compatible providers do not retry on their own — the router owns fallback', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['lib/ai/providers/groq.ts', 'lib/ai/providers/openai.ts']) {
      expect(readFileSync(file, 'utf8')).toContain('maxRetries: 0');
    }
  });
});

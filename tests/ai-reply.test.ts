/**
 * AI reply drafting — provider contract and safety rules.
 *
 * The `openai` SDK is mocked so nothing here reaches the network. What is
 * asserted is the contract we depend on: that the client is pointed at Groq,
 * that the configured model is used, that failures degrade safely, and that a
 * key never escapes into a response or a log line.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Review } from '@/lib/types';

/* ------------------------------ SDK mock -------------------------------- */

const constructorCalls: { apiKey?: string; baseURL?: string }[] = [];
const createCalls: { model?: string }[] = [];
let createImpl: (args: unknown) => Promise<unknown> = async () => ({
  choices: [{ message: { content: 'Thank you Ramesh, glad the ceiling turned out well.' } }],
});

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat: { completions: { create: (args: { model?: string }) => Promise<unknown> } };
    constructor(options: { apiKey?: string; baseURL?: string }) {
      constructorCalls.push(options);
      this.chat = {
        completions: {
          create: (args: { model?: string }) => {
            createCalls.push(args);
            return createImpl(args) as Promise<never>;
          },
        },
      };
    }
  },
}));

/* ------------------------------- fixtures -------------------------------- */

const TEST_KEY = 'gsk_UNIT_TEST_NOT_A_REAL_KEY_000000';

const review: Review = {
  name: 'accounts/1/locations/2/reviews/3',
  reviewId: '3',
  reviewerName: 'Ramesh Kumar',
  starRating: 5,
  comment: 'Very good false ceiling work, finished on time.',
  createTime: '2026-09-01T10:00:00.000Z',
  updateTime: '2026-09-01T10:00:00.000Z',
  existingReply: null,
  replyStatus: 'no_reply',
};

/** Fresh module graph per test so env changes are actually picked up. */
async function loadAi(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('@/lib/ai-reply');
}

beforeEach(() => {
  constructorCalls.length = 0;
  createCalls.length = 0;
  createImpl = async () => ({
    choices: [{ message: { content: 'Thank you Ramesh, glad the ceiling turned out well.' } }],
  });
});

afterEach(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODEL;
});

/* --------------------------------- tests --------------------------------- */

describe('provider configuration', () => {
  it('1. reports AI as not configured when GROQ_API_KEY is missing', async () => {
    const ai = await loadAi({ GROQ_API_KEY: undefined, GROQ_MODEL: undefined });
    await expect(ai.generateReplyDraft(review)).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
      httpStatus: 503,
    });
    // No client was ever constructed, so no request could have been attempted.
    expect(constructorCalls).toHaveLength(0);
  });

  it('2. points the client at the Groq base URL', async () => {
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY });
    await ai.generateReplyDraft(review);
    expect(constructorCalls[0]?.baseURL).toBe('https://api.groq.com/openai/v1');
    expect(constructorCalls[0]?.apiKey).toBe(TEST_KEY);
  });

  it('3a. defaults to openai/gpt-oss-20b when GROQ_MODEL is unset', async () => {
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY, GROQ_MODEL: undefined });
    await ai.generateReplyDraft(review);
    expect(createCalls[0]?.model).toBe('openai/gpt-oss-20b');
  });

  it('3b. honours GROQ_MODEL when it is set', async () => {
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY, GROQ_MODEL: 'llama-3.3-70b-versatile' });
    await ai.generateReplyDraft(review);
    expect(createCalls[0]?.model).toBe('llama-3.3-70b-versatile');
  });
});

describe('generation', () => {
  it('4. returns the generated reply with language and model', async () => {
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY });
    const result = await ai.generateReplyDraft(review);
    expect(result.text).toBe('Thank you Ramesh, glad the ceiling turned out well.');
    expect(result.language).toBe('en');
    expect(result.model).toBe('openai/gpt-oss-20b');
  });

  it('4b. replies in Hinglish when the review is Hinglish', async () => {
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY });
    const result = await ai.generateReplyDraft({
      ...review,
      comment: 'Bahut badhiya kaam kiya bhai, ghar ki chhat ekdum mast lag rahi hai',
    });
    expect(result.language).toBe('hinglish');
  });
});

describe('failure handling', () => {
  it('5a. surfaces a safe error when Groq fails, and invents no reply', async () => {
    createImpl = async () => {
      throw Object.assign(new Error('upstream exploded'), { status: 500 });
    };
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY });
    await expect(ai.generateReplyDraft(review)).rejects.toMatchObject({ code: 'AI_FAILED' });
  });

  it('5b. handles rate limiting distinctly', async () => {
    createImpl = async () => {
      throw Object.assign(new Error('rate limit'), { status: 429 });
    };
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY });
    await expect(ai.generateReplyDraft(review)).rejects.toMatchObject({
      code: 'AI_FAILED',
      httpStatus: 503,
    });
  });

  it('5c. treats a rejected key as a configuration problem, not an outage', async () => {
    createImpl = async () => {
      throw Object.assign(new Error('invalid api key'), { status: 401 });
    };
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY });
    await expect(ai.generateReplyDraft(review)).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
  });

  it('5d. never substitutes canned text for an empty completion', async () => {
    createImpl = async () => ({ choices: [{ message: { content: '   ' } }] });
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY });
    await expect(ai.generateReplyDraft(review)).rejects.toMatchObject({ code: 'AI_FAILED' });
  });
});

describe('secret containment', () => {
  it('6. the key never appears in a successful result', async () => {
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY });
    const result = await ai.generateReplyDraft(review);
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });

  it('6b. the key never appears in a thrown error', async () => {
    createImpl = async () => {
      throw Object.assign(new Error(`request failed with key ${TEST_KEY}`), { status: 500 });
    };
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY });
    const caught = await ai.generateReplyDraft(review).catch((error: unknown) => error);
    expect(JSON.stringify(caught)).not.toContain(TEST_KEY);
    expect(String((caught as Error).message)).not.toContain(TEST_KEY);
  });

  it('7. the key never reaches a log line', async () => {
    const captured: string[] = [];
    const spies = (['log', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }),
    );

    createImpl = async () => {
      throw Object.assign(new Error(`boom sk-${'x'.repeat(30)} ${TEST_KEY}`), { status: 500 });
    };
    const ai = await loadAi({ GROQ_API_KEY: TEST_KEY });
    await ai.generateReplyDraft(review).catch(() => undefined);

    expect(captured.length).toBeGreaterThan(0);
    expect(captured.join('\n')).not.toContain(TEST_KEY);
    for (const spy of spies) spy.mockRestore();
  });
});

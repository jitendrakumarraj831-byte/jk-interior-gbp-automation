/**
 * Multi-provider AI router — ordering, fallback and containment.
 *
 * Groq and OpenAI go through the `openai` SDK, which is mocked per-baseURL so
 * the two are distinguishable. Gemini uses fetch, which is stubbed. Nothing
 * here touches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------ SDK / fetch mocks ------------------------ */

type Behaviour = () => Promise<{ choices: { message: { content: string } }[] }>;

const calls: string[] = [];
let groqBehaviour: Behaviour = async () => ({ choices: [{ message: { content: 'from groq' } }] });
let openaiBehaviour: Behaviour = async () => ({ choices: [{ message: { content: 'from openai' } }] });

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat: { completions: { create: () => Promise<unknown> } };
    constructor(options: { apiKey?: string; baseURL?: string }) {
      // Groq is the one configured with a baseURL; plain OpenAI has none.
      const isGroq = Boolean(options.baseURL?.includes('api.groq.com'));
      this.chat = {
        completions: {
          create: () => {
            calls.push(isGroq ? 'groq' : 'openai');
            return (isGroq ? groqBehaviour() : openaiBehaviour()) as Promise<never>;
          },
        },
      };
    }
  },
}));

let geminiBehaviour: () => Promise<Response> = async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] }), {
    status: 200,
  });

const realFetch = globalThis.fetch;

function fail(status: number) {
  return async () => new Response('{}', { status });
}

/* -------------------------------- helpers -------------------------------- */

const KEYS = {
  groq: 'gsk_TEST_NOT_REAL_0000000000000000',
  gemini: 'AIza_TEST_NOT_REAL_0000000000000',
  openai: 'sk-TEST_NOT_REAL_00000000000000000',
};

async function loadRouter(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'AI_PROVIDER_ORDER']) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  return import('@/lib/ai/router');
}

const REQUEST = { system: 'system prompt', user: 'user prompt' };

beforeEach(() => {
  calls.length = 0;
  groqBehaviour = async () => ({ choices: [{ message: { content: 'from groq' } }] });
  openaiBehaviour = async () => ({ choices: [{ message: { content: 'from openai' } }] });
  geminiBehaviour = async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] }),
      { status: 200 },
    );
  globalThis.fetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0]);
    if (url.includes('generativelanguage.googleapis.com')) {
      calls.push('gemini');
      return geminiBehaviour();
    }
    return realFetch(...args);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/* --------------------------------- tests --------------------------------- */

describe('provider selection', () => {
  it('1. uses Groq when only Groq is configured', async () => {
    const router = await loadRouter({ GROQ_API_KEY: KEYS.groq });
    const result = await router.generate(REQUEST);
    expect(result.provider).toBe('groq');
    expect(result.content).toBe('from groq');
    expect(calls).toEqual(['groq']);
  });

  it('2. falls back to Gemini when Groq fails temporarily', async () => {
    groqBehaviour = async () => {
      throw Object.assign(new Error('upstream'), { status: 500 });
    };
    const router = await loadRouter({ GROQ_API_KEY: KEYS.groq, GEMINI_API_KEY: KEYS.gemini });
    const result = await router.generate(REQUEST);
    expect(result.provider).toBe('gemini');
    expect(calls).toEqual(['groq', 'gemini']);
  });

  it('3. reaches OpenAI when Groq is rate limited and Gemini fails', async () => {
    groqBehaviour = async () => {
      throw Object.assign(new Error('429'), { status: 429 });
    };
    geminiBehaviour = fail(503);
    const router = await loadRouter({
      GROQ_API_KEY: KEYS.groq,
      GEMINI_API_KEY: KEYS.gemini,
      OPENAI_API_KEY: KEYS.openai,
    });
    const result = await router.generate(REQUEST);
    expect(result.provider).toBe('openai');
    expect(calls).toEqual(['groq', 'gemini', 'openai']);
  });

  it('4. reports AI as not configured when no provider has a key', async () => {
    const router = await loadRouter({});
    await expect(router.generate(REQUEST)).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
      httpStatus: 503,
    });
    expect(calls).toEqual([]);
  });

  it('5. skips a provider whose key is missing without calling it', async () => {
    const router = await loadRouter({ GEMINI_API_KEY: KEYS.gemini });
    const result = await router.generate(REQUEST);
    expect(result.provider).toBe('gemini');
    expect(calls).toEqual(['gemini']); // Groq never attempted
  });

  it('8. respects a custom AI_PROVIDER_ORDER', async () => {
    const router = await loadRouter({
      AI_PROVIDER_ORDER: 'openai,gemini,groq',
      GROQ_API_KEY: KEYS.groq,
      GEMINI_API_KEY: KEYS.gemini,
      OPENAI_API_KEY: KEYS.openai,
    });
    const result = await router.generate(REQUEST);
    expect(result.provider).toBe('openai');
    expect(calls).toEqual(['openai']);
  });

  it('8b. drops unknown provider names instead of breaking', async () => {
    const router = await loadRouter({
      AI_PROVIDER_ORDER: 'bogus, gemini ,groq',
      GROQ_API_KEY: KEYS.groq,
      GEMINI_API_KEY: KEYS.gemini,
    });
    const result = await router.generate(REQUEST);
    expect(result.provider).toBe('gemini');
  });
});

describe('failure handling', () => {
  it('6. does not fall through on an invalid request', async () => {
    groqBehaviour = async () => {
      throw Object.assign(new Error('bad request'), { status: 400 });
    };
    const router = await loadRouter({ GROQ_API_KEY: KEYS.groq, GEMINI_API_KEY: KEYS.gemini });
    await expect(router.generate(REQUEST)).rejects.toMatchObject({ code: 'AI_FAILED' });
    // Stopped at Groq — no pointless retry of a payload every provider rejects.
    expect(calls).toEqual(['groq']);
  });

  it('7. moves to the next provider when one times out', async () => {
    groqBehaviour = async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    const router = await loadRouter({ GROQ_API_KEY: KEYS.groq, GEMINI_API_KEY: KEYS.gemini });
    const result = await router.generate(REQUEST);
    expect(result.provider).toBe('gemini');
    expect(calls).toEqual(['groq', 'gemini']);
  });

  it('7b. attempts each provider exactly once — no retry loop', async () => {
    groqBehaviour = async () => {
      throw Object.assign(new Error('boom'), { status: 500 });
    };
    geminiBehaviour = fail(500);
    openaiBehaviour = async () => {
      throw Object.assign(new Error('boom'), { status: 500 });
    };
    const router = await loadRouter({
      GROQ_API_KEY: KEYS.groq,
      GEMINI_API_KEY: KEYS.gemini,
      OPENAI_API_KEY: KEYS.openai,
    });
    await expect(router.generate(REQUEST)).rejects.toMatchObject({ httpStatus: 503 });
    expect(calls).toEqual(['groq', 'gemini', 'openai']);
  });

  it('6b. surfaces a key rejected by every provider as a setup problem', async () => {
    groqBehaviour = async () => {
      throw Object.assign(new Error('unauthorized'), { status: 401 });
    };
    geminiBehaviour = fail(403);
    const router = await loadRouter({ GROQ_API_KEY: KEYS.groq, GEMINI_API_KEY: KEYS.gemini });
    await expect(router.generate(REQUEST)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });

  it('6c. never fabricates content when a provider returns an empty completion', async () => {
    groqBehaviour = async () => ({ choices: [{ message: { content: '   ' } }] });
    const router = await loadRouter({ GROQ_API_KEY: KEYS.groq });
    await expect(router.generate(REQUEST)).rejects.toMatchObject({ code: 'AI_FAILED' });
  });
});

describe('secret containment', () => {
  it('9. no provider key appears in a successful result', async () => {
    const router = await loadRouter({
      GROQ_API_KEY: KEYS.groq,
      GEMINI_API_KEY: KEYS.gemini,
      OPENAI_API_KEY: KEYS.openai,
    });
    const serialised = JSON.stringify(await router.generate(REQUEST));
    for (const key of Object.values(KEYS)) expect(serialised).not.toContain(key);
  });

  it('9b. no provider key appears in a thrown error or the router status', async () => {
    groqBehaviour = async () => {
      throw Object.assign(new Error(`failed with ${KEYS.groq}`), { status: 500 });
    };
    geminiBehaviour = fail(500);
    const router = await loadRouter({ GROQ_API_KEY: KEYS.groq, GEMINI_API_KEY: KEYS.gemini });
    const caught = await router.generate(REQUEST).catch((error: unknown) => error);
    expect(JSON.stringify(caught)).not.toContain(KEYS.groq);
    expect((caught as Error).message).not.toContain(KEYS.groq);

    const status = JSON.stringify(await router.routerStatus());
    for (const key of Object.values(KEYS)) expect(status).not.toContain(key);
  });

  it('10. no provider key reaches a log line', async () => {
    const captured: string[] = [];
    const spies = (['log', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }),
    );

    groqBehaviour = async () => {
      throw Object.assign(new Error(`boom ${KEYS.groq} ${KEYS.openai}`), { status: 500 });
    };
    const router = await loadRouter({ GROQ_API_KEY: KEYS.groq, GEMINI_API_KEY: KEYS.gemini });
    await router.generate(REQUEST);

    expect(captured.length).toBeGreaterThan(0);
    const joined = captured.join('\n');
    for (const key of Object.values(KEYS)) expect(joined).not.toContain(key);
    for (const spy of spies) spy.mockRestore();
  });
});

describe('status reporting', () => {
  it('reports ready with a primary and fallbacks when several are configured', async () => {
    const router = await loadRouter({
      GROQ_API_KEY: KEYS.groq,
      GEMINI_API_KEY: KEYS.gemini,
      OPENAI_API_KEY: KEYS.openai,
    });
    const status = await router.routerStatus();
    expect(status.ready).toBe(true);
    expect(status.primary).toBe('groq');
    expect(status.fallbacks).toEqual(['gemini', 'openai']);
  });

  it('is not "ready" and has no fallbacks when nothing is configured', async () => {
    const router = await loadRouter({});
    const status = await router.routerStatus();
    expect(status.ready).toBe(false);
    expect(status.primary).toBeNull();
    expect(status.fallbacks).toEqual([]);
    expect(status.providers.every((p) => !p.configured)).toBe(true);
  });

  it('lists only real fallbacks when just Groq is configured', async () => {
    const router = await loadRouter({ GROQ_API_KEY: KEYS.groq });
    const status = await router.routerStatus();
    expect(status.primary).toBe('groq');
    expect(status.fallbacks).toEqual([]);
  });
});

describe('Gemini credential classification', () => {
  it('treats Gemini 400 "API key not valid" as auth, so fallback continues', async () => {
    // Gemini answers a bad key with 400 INVALID_ARGUMENT, not 401. Without the
    // adapter's special case this halts the chain as an invalid request.
    geminiBehaviour = async () =>
      new Response(
        JSON.stringify({
          error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' },
        }),
        { status: 400 },
      );
    groqBehaviour = async () => {
      throw Object.assign(new Error('unauthorized'), { status: 401 });
    };
    const router = await loadRouter({
      GROQ_API_KEY: KEYS.groq,
      GEMINI_API_KEY: KEYS.gemini,
      OPENAI_API_KEY: KEYS.openai,
    });
    const result = await router.generate(REQUEST);
    expect(result.provider).toBe('openai');
    expect(calls).toEqual(['groq', 'gemini', 'openai']);
  });

  it('still halts on a genuinely malformed Gemini payload', async () => {
    geminiBehaviour = async () =>
      new Response(
        JSON.stringify({
          error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received.' },
        }),
        { status: 400 },
      );
    const router = await loadRouter({
      AI_PROVIDER_ORDER: 'gemini,openai',
      GEMINI_API_KEY: KEYS.gemini,
      OPENAI_API_KEY: KEYS.openai,
    });
    await expect(router.generate(REQUEST)).rejects.toMatchObject({ code: 'AI_FAILED' });
    expect(calls).toEqual(['gemini']);
  });
});

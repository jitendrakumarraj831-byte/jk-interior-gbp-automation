/**
 * Gemini — secondary provider.
 *
 * Called over its REST `generateContent` endpoint with plain fetch, so no
 * additional SDK enters the dependency tree. The key travels in the
 * `x-goog-api-key` header rather than a query string, which keeps it out of
 * URLs (and therefore out of any access log that records them).
 */

import { env, GEMINI_BASE_URL, geminiModel } from '../../config';
import { classify, ProviderError, type AiErrorKind } from '../errors';
import type { GenerateRequest, GenerateResult, ProviderAdapter } from '../types';

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
};

type GeminiError = { error?: { status?: string; message?: string } };

/**
 * Gemini answers a bad API key with 400 INVALID_ARGUMENT, not 401 — so the
 * generic status mapping would read a credential problem as a malformed
 * payload and stop the router's fallback chain. The body is inspected here
 * purely to tell those two apart; none of its text is ever propagated.
 */
async function classifyBadRequest(response: Response): Promise<AiErrorKind> {
  try {
    const body = (await response.json()) as GeminiError;
    const message = (body.error?.message ?? '').toLowerCase();
    if (message.includes('api key') || message.includes('api_key')) return 'auth';
  } catch {
    /* unreadable body — fall through to the generic mapping */
  }
  return 'invalid_request';
}

export const geminiProvider: ProviderAdapter = {
  name: 'gemini',
  label: 'Gemini',
  isConfigured: () => Boolean(env().GEMINI_API_KEY),
  model: geminiModel,

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model = geminiModel();
    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env().GEMINI_API_KEY,
        },
        body: JSON.stringify({
          // Gemini takes the system prompt separately from the turn content.
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.user }] }],
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
          },
        }),
        signal: request.signal,
        cache: 'no-store',
      });
    } catch (error) {
      throw new ProviderError('gemini', classify(error), 'Gemini request failed.');
    }

    if (!response.ok) {
      const kind =
        response.status === 400
          ? await classifyBadRequest(response)
          : classify(null, response.status);
      // Only the classified kind travels onward — no provider text is propagated.
      throw new ProviderError('gemini', kind, 'Gemini request failed.', response.status);
    }

    let body: GeminiResponse;
    try {
      body = (await response.json()) as GeminiResponse;
    } catch {
      throw new ProviderError('gemini', 'temporary', 'Gemini returned an unreadable response.');
    }

    if (body.promptFeedback?.blockReason) {
      // A safety block is about this prompt; another provider may still answer.
      throw new ProviderError('gemini', 'temporary', 'Gemini declined to answer this prompt.');
    }

    const content = (body.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!content) {
      throw new ProviderError('gemini', 'temporary', 'Gemini returned an empty completion.');
    }
    return { provider: 'gemini', model, content };
  },
};

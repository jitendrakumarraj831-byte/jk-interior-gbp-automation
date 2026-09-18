/**
 * Groq — primary provider.
 *
 * Groq speaks the OpenAI chat-completions protocol, so the `openai` package
 * already in the tree is reused purely as an HTTP transport pointed at Groq's
 * base URL. No second SDK, no OpenAI account involved.
 */

import OpenAI from 'openai';

import { env, GROQ_BASE_URL, groqModel } from '../../config';
import { classify, ProviderError } from '../errors';
import type { GenerateRequest, GenerateResult, ProviderAdapter } from '../types';

let client: OpenAI | null = null;

function sdk(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env().GROQ_API_KEY, baseURL: GROQ_BASE_URL });
  }
  return client;
}

/** Test seam: drops the memoised client so a new key or URL is picked up. */
export function resetGroqClient(): void {
  client = null;
}

export const groqProvider: ProviderAdapter = {
  name: 'groq',
  label: 'Groq',
  isConfigured: () => Boolean(env().GROQ_API_KEY),
  model: groqModel,

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model = groqModel();
    try {
      const completion = await sdk().chat.completions.create(
        {
          model,
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        },
        { signal: request.signal },
      );

      const content = completion.choices[0]?.message?.content ?? '';
      if (!content.trim()) {
        // An empty completion is a real failure — never substitute canned text.
        throw new ProviderError('groq', 'temporary', 'Groq returned an empty completion.');
      }
      return { provider: 'groq', model, content };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('groq', classify(error), 'Groq request failed.');
    }
  },
};

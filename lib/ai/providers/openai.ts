/**
 * OpenAI — optional third fallback.
 *
 * Never required: with no OPENAI_API_KEY the router simply skips it.
 */

import OpenAI from 'openai';

import { env, openaiModel } from '../../config';
import { classify, ProviderError } from '../errors';
import type { GenerateRequest, GenerateResult, ProviderAdapter } from '../types';

let client: OpenAI | null = null;

function sdk(): OpenAI {
  // No baseURL: this one really is OpenAI, so the SDK default applies.
  if (!client) client = new OpenAI({ apiKey: env().OPENAI_API_KEY });
  return client;
}

/** Test seam: drops the memoised client so a new key is picked up. */
export function resetOpenAiClient(): void {
  client = null;
}

export const openaiProvider: ProviderAdapter = {
  name: 'openai',
  label: 'OpenAI',
  isConfigured: () => Boolean(env().OPENAI_API_KEY),
  model: openaiModel,

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model = openaiModel();
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
        throw new ProviderError('openai', 'temporary', 'OpenAI returned an empty completion.');
      }
      return { provider: 'openai', model, content };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('openai', classify(error), 'OpenAI request failed.');
    }
  },
};

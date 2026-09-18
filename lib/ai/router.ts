/**
 * Multi-provider AI router with automatic fallback.
 *
 * Walks AI_PROVIDER_ORDER, skipping providers with no credential, and gives
 * each one a single bounded attempt. A provider-level failure — throttling, an
 * outage, a timeout, a rejected key — moves to the next provider. A malformed
 * request does not: every provider would reject it identically, so falling
 * through would just burn quota on a guaranteed failure.
 *
 * This module only ever produces text. It cannot publish anything: it has no
 * reference to the Google client, and publishing lives behind an explicit admin
 * action in /api/reviews/reply/publish.
 */

import { AI_TIMEOUT_MS, aiProviderOrder } from '../config';
import { AppError } from '../errors';
import { log } from '../logger';
import { isConfigurationFault, ProviderError, shouldFallBack, type AiErrorKind } from './errors';
import { readHealth, recordFailure, recordSuccess } from './health';
import { geminiProvider } from './providers/gemini';
import { groqProvider } from './providers/groq';
import { openaiProvider } from './providers/openai';
import {
  isProviderName,
  type AiRouterStatus,
  type GenerateResult,
  type ProviderAdapter,
  type ProviderName,
} from './types';

const ADAPTERS: Record<ProviderName, ProviderAdapter> = {
  groq: groqProvider,
  gemini: geminiProvider,
  openai: openaiProvider,
};

/** Adapters in the configured order. Unknown names are already filtered out. */
export function orderedAdapters(): ProviderAdapter[] {
  return aiProviderOrder()
    .filter(isProviderName)
    .map((name) => ADAPTERS[name]);
}

export function configuredAdapters(): ProviderAdapter[] {
  return orderedAdapters().filter((adapter) => adapter.isConfigured());
}

export type RouterRequest = {
  system: string;
  user: string;
  maxOutputTokens?: number;
  temperature?: number;
};

/**
 * Generates one completion, trying providers in order.
 *
 * Throws AI_NOT_CONFIGURED when nothing is configured (or every configured
 * provider turned out to have a bad credential), and AI_FAILED when providers
 * were reachable but none succeeded. Never returns fabricated content.
 */
export async function generate(request: RouterRequest): Promise<GenerateResult> {
  const candidates = orderedAdapters();

  if (candidates.every((adapter) => !adapter.isConfigured())) {
    throw new AppError(
      'AI_NOT_CONFIGURED',
      'No AI provider is configured, so reply drafting is unavailable.',
      503,
    );
  }

  const attempted: { provider: ProviderName; kind: AiErrorKind }[] = [];

  for (const adapter of candidates) {
    if (!adapter.isConfigured()) {
      // Not a failure worth recording — the operator simply has not set a key.
      attempted.push({ provider: adapter.name, kind: 'missing_key' });
      continue;
    }

    // One controlled attempt per provider. No inner retry loop.
    const signal = AbortSignal.timeout(AI_TIMEOUT_MS);

    try {
      const result = await adapter.generate({
        system: request.system,
        user: request.user,
        maxOutputTokens: request.maxOutputTokens ?? 220,
        temperature: request.temperature ?? 0.85,
        signal,
      });

      await recordSuccess(adapter.name);
      if (attempted.length > 0) {
        log.info('ai-router', 'Recovered on a fallback provider.', {
          provider: adapter.name,
          model: result.model,
          skipped: attempted.map((a) => `${a.provider}:${a.kind}`),
        });
      }
      return result;
    } catch (error) {
      const kind: AiErrorKind = error instanceof ProviderError ? error.kind : 'unknown';
      attempted.push({ provider: adapter.name, kind });
      await recordFailure(adapter.name, kind);

      // Only the provider name, model id and classified kind are logged. The
      // logger additionally redacts credential-shaped strings.
      log.warn('ai-router', 'Provider attempt failed.', {
        provider: adapter.name,
        model: adapter.model(),
        kind,
      });

      if (!shouldFallBack(kind)) {
        throw new AppError(
          'AI_FAILED',
          'The reply request was rejected as invalid. Nothing was published.',
          502,
        );
      }
    }
  }

  // Everything that was tried failed. If the only reason was credentials, this
  // is a setup problem, not an outage — say so, so the UI shows a setup step.
  const realAttempts = attempted.filter((a) => a.kind !== 'missing_key');
  if (realAttempts.length > 0 && realAttempts.every((a) => isConfigurationFault(a.kind))) {
    throw new AppError(
      'AI_NOT_CONFIGURED',
      'Every configured AI provider rejected its API key. Check your provider keys.',
      503,
    );
  }

  // Throttling and outages are "come back shortly" (503); anything else is a
  // genuine upstream fault (502). The distinction drives how the UI reads.
  const transient = new Set<AiErrorKind>(['rate_limit', 'timeout', 'temporary']);
  const allTransient = realAttempts.length > 0 && realAttempts.every((a) => transient.has(a.kind));

  throw new AppError(
    'AI_FAILED',
    allTransient
      ? 'Every AI provider is busy or unreachable right now. Nothing was published — try again shortly.'
      : 'No AI provider could generate a reply. Nothing was published.',
    allTransient ? 503 : 502,
  );
}

/** Non-sensitive router status for the dashboard and settings pages. */
export async function routerStatus(): Promise<AiRouterStatus> {
  const health = await readHealth();
  const ordered = orderedAdapters();
  const configured = ordered.filter((adapter) => adapter.isConfigured());

  return {
    ready: configured.length > 0,
    order: ordered.map((adapter) => adapter.name),
    primary: configured[0]?.name ?? null,
    fallbacks: configured.slice(1).map((adapter) => adapter.name),
    providers: ordered.map((adapter) => ({
      name: adapter.name,
      label: adapter.label,
      configured: adapter.isConfigured(),
      model: adapter.model(),
      health: health[adapter.name] ?? null,
    })),
  };
}

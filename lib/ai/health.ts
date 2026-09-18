/**
 * Lightweight provider health, persisted through the existing store
 * abstraction — durable when Upstash is configured, in-memory otherwise.
 * No second database, and nothing recorded here is a secret: the failure field
 * holds a classified kind, never a provider payload that might echo a key.
 */

import { getStore, nsKey } from '../store';
import type { ProviderHealth, ProviderName } from './types';

const HEALTH_KEY = nsKey('ai', 'health');

type HealthMap = Partial<Record<ProviderName, ProviderHealth>>;

export async function readHealth(): Promise<HealthMap> {
  try {
    return (await getStore().get<HealthMap>(HEALTH_KEY)) ?? {};
  } catch {
    // Health is diagnostic. A store outage must never fail a draft.
    return {};
  }
}

async function write(provider: ProviderName, patch: Partial<ProviderHealth>): Promise<void> {
  try {
    const store = getStore();
    const current = (await store.get<HealthMap>(HEALTH_KEY)) ?? {};
    const existing: ProviderHealth = current[provider] ?? { provider, status: 'unknown' };
    current[provider] = { ...existing, ...patch, provider };
    await store.set(HEALTH_KEY, current);
  } catch {
    /* best effort only */
  }
}

export async function recordSuccess(provider: ProviderName): Promise<void> {
  await write(provider, {
    status: 'ok',
    lastSuccess: new Date().toISOString(),
    failureReason: undefined,
  });
}

/** `reason` must be a classified kind, never raw provider text. */
export async function recordFailure(provider: ProviderName, reason: string): Promise<void> {
  await write(provider, {
    status: 'failing',
    lastFailure: new Date().toISOString(),
    failureReason: reason,
  });
}

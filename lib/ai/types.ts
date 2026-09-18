/**
 * Shared contract for the multi-provider AI router.
 *
 * Server-only. Nothing here may be imported from a Client Component: provider
 * adapters read API keys from the environment.
 */

export const PROVIDER_NAMES = ['groq', 'gemini', 'openai'] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/** A single completion request. Provider-agnostic on purpose. */
export type GenerateRequest = {
  /** Instructions that frame the assistant's behaviour. */
  system: string;
  /** The user-side content to respond to. */
  user: string;
  /** Upper bound on generated length. Providers map this to their own field. */
  maxOutputTokens: number;
  /** 0-1. Enough variation to avoid templated-sounding output. */
  temperature: number;
  /** Abort signal carrying the router's per-provider timeout. */
  signal: AbortSignal;
};

/** What a provider returns on success. Never contains a key. */
export type GenerateResult = {
  provider: ProviderName;
  model: string;
  content: string;
};

/**
 * A provider adapter.
 *
 * `isConfigured()` must be a pure environment check with no network access, so
 * the router can skip an unconfigured provider without paying for a request.
 */
export type ProviderAdapter = {
  name: ProviderName;
  /** Display name for the UI. */
  label: string;
  isConfigured: () => boolean;
  /** Model this provider would use. Safe to display — a model id is not a secret. */
  model: () => string;
  generate: (request: GenerateRequest) => Promise<GenerateResult>;
};

/** Lightweight runtime status, persisted through the existing store. */
export type ProviderHealth = {
  provider: ProviderName;
  status: 'ok' | 'failing' | 'unknown';
  lastSuccess?: string;
  lastFailure?: string;
  /** Classified reason only — never a raw provider payload. */
  failureReason?: string;
};

/** What the router reports to the UI. Booleans, names and model ids only. */
export type AiRouterStatus = {
  ready: boolean;
  order: ProviderName[];
  primary: ProviderName | null;
  fallbacks: ProviderName[];
  providers: {
    name: ProviderName;
    label: string;
    configured: boolean;
    model: string;
    health: ProviderHealth | null;
  }[];
};

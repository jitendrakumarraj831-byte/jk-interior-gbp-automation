/**
 * Central configuration + environment validation.
 *
 * Rules enforced here:
 *  - Every secret is read on the server only. Nothing in this module may be
 *    imported from a Client Component.
 *  - Missing configuration never throws at import time, because the app must
 *    build and deploy to Vercel while Google Business Profile API approval is
 *    still pending. Callers ask `isGoogleConfigured()` and degrade gracefully.
 */

import { z } from 'zod';

import { redact } from './logger';

export const BUSINESS = {
  name: 'JK Interior',
  location: 'Forbesganj, Bihar',
  website: 'https://www.jkinterior.online',
  googleCloudProjectId: 'jk-interior-gbp-automation',
} as const;

/** Services JK Interior offers. Used to ground AI reply drafts and post copy. */
export const SERVICES = [
  'Gypsum False Ceiling',
  'PVC Ceiling',
  'WPC Louvers',
  'Fluted Panels',
  'UV Marble Sheets',
  'TV Units',
  'Gypsum Board Partition',
  'Interior Work',
] as const;

/**
 * AI provider for review reply drafting.
 *
 * Groq exposes an OpenAI-compatible chat-completions API, so the existing
 * `openai` SDK is reused as the transport with this base URL — no second SDK.
 */
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/*
 * Default models. Every one is overridable by environment variable, because a
 * provider can retire a model id at any time and a hard-coded default would
 * then break drafting with no way out but a redeploy.
 */
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/** Provider order used when AI_PROVIDER_ORDER is unset or unparseable. */
export const DEFAULT_PROVIDER_ORDER = 'groq,gemini,openai';

/** How long one provider gets before the router moves on. */
export const AI_TIMEOUT_MS = 20_000;

/** The only OAuth scope the Google Business Profile APIs accept. */
export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().trim().default(''),
  GOOGLE_CLIENT_SECRET: z.string().trim().default(''),
  GOOGLE_REDIRECT_URI: z.string().trim().default(''),
  GOOGLE_REFRESH_TOKEN: z.string().trim().default(''),

  AI_PROVIDER_ORDER: z.string().trim().default(DEFAULT_PROVIDER_ORDER),

  GROQ_API_KEY: z.string().trim().default(''),
  GROQ_MODEL: z.string().trim().default(DEFAULT_GROQ_MODEL),

  GEMINI_API_KEY: z.string().trim().default(''),
  GEMINI_MODEL: z.string().trim().default(DEFAULT_GEMINI_MODEL),

  OPENAI_API_KEY: z.string().trim().default(''),
  OPENAI_MODEL: z.string().trim().default(DEFAULT_OPENAI_MODEL),

  CRON_SECRET: z.string().trim().default(''),

  ADMIN_PASSWORD: z.string().trim().default(''),
  SESSION_SECRET: z.string().trim().default(''),

  UPSTASH_REDIS_REST_URL: z.string().trim().default(''),
  UPSTASH_REDIS_REST_TOKEN: z.string().trim().default(''),

  GBP_ACCOUNT_NAME: z.string().trim().default(''),
  GBP_LOCATION_NAME: z.string().trim().default(''),

  GBP_MOCK_MODE: z
    .string()
    .trim()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  AUTO_PUBLISH_REPLIES: z
    .string()
    .trim()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  VERCEL_ENV: z.string().trim().default(''),
  VERCEL_URL: z.string().trim().default(''),
  NODE_ENV: z.string().trim().default('development'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Parsed environment. Never returns secrets to the client — server-only use. */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Defaults make this near-impossible, but never crash the whole app on it.
    // Routed through redact() so a validation message can never echo a value.
    console.error('[config] Environment validation failed:', redact(parsed.error.message));
    cached = envSchema.parse({});
    return cached;
  }
  cached = parsed.data;
  return cached;
}

/** True when the OAuth client is configured (login flow can start). */
export function isOAuthConfigured(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_REDIRECT_URI);
}

/**
 * True when we hold everything needed to call Google on the business's behalf.
 * A refresh token may come from the environment or from the OAuth callback.
 */
export function isGoogleConfigured(refreshTokenFromStore?: string | null): boolean {
  return isOAuthConfigured() && Boolean(env().GOOGLE_REFRESH_TOKEN || refreshTokenFromStore);
}

export function groqModel(): string {
  return env().GROQ_MODEL || DEFAULT_GROQ_MODEL;
}

export function geminiModel(): string {
  return env().GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function openaiModel(): string {
  return env().OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

/**
 * Provider preference, e.g. "groq,gemini,openai".
 *
 * Unknown names are dropped and duplicates collapsed, so a typo degrades the
 * order rather than breaking drafting. An order that names nothing valid falls
 * back to the default rather than leaving the router with no providers.
 */
export function aiProviderOrder(): string[] {
  const raw = env().AI_PROVIDER_ORDER || DEFAULT_PROVIDER_ORDER;
  const known = ['groq', 'gemini', 'openai'];
  const parsed = raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => known.includes(name));
  const unique = [...new Set(parsed)];
  return unique.length > 0 ? unique : DEFAULT_PROVIDER_ORDER.split(',');
}

/** True when at least one provider in the order has a key. */
export function isAiConfigured(): boolean {
  const e = env();
  const keyFor: Record<string, string> = {
    groq: e.GROQ_API_KEY,
    gemini: e.GEMINI_API_KEY,
    openai: e.OPENAI_API_KEY,
  };
  return aiProviderOrder().some((name) => Boolean(keyFor[name]));
}

export function isCronConfigured(): boolean {
  return Boolean(env().CRON_SECRET);
}

export function isAdminAuthConfigured(): boolean {
  const e = env();
  return Boolean(e.ADMIN_PASSWORD && e.SESSION_SECRET);
}

/**
 * Whether admin authentication is enforced, and if not, why.
 *
 *  - `enforced`         credentials present; every admin surface requires a session.
 *  - `misconfigured`    PRODUCTION with credentials missing. The app refuses to
 *                       serve admin surfaces at all — it fails closed rather than
 *                       falling back to unauthenticated access.
 *  - `development_only` local development with no credentials set. Convenience
 *                       only; unreachable in production by construction.
 */
export type AdminAuthMode = 'enforced' | 'misconfigured' | 'development_only';

export function adminAuthMode(): AdminAuthMode {
  if (isAdminAuthConfigured()) return 'enforced';
  return isProduction() ? 'misconfigured' : 'development_only';
}

/**
 * True when the deployment is production but ADMIN_PASSWORD / SESSION_SECRET
 * are absent. Admin routes and the dashboard must refuse to serve in this
 * state — never fall through to unauthenticated access.
 */
export function isAdminAuthMisconfigured(): boolean {
  return adminAuthMode() === 'misconfigured';
}

/** Names of the admin-auth variables that are missing. Names only, no values. */
export function missingAdminAuthVars(): string[] {
  const e = env();
  const missing: string[] = [];
  if (!e.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');
  if (!e.SESSION_SECRET) missing.push('SESSION_SECRET');
  return missing;
}

export function isDurableStoreConfigured(): boolean {
  const e = env();
  return Boolean(e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Whether the safe mock Business Profile is active.
 *
 * Deliberately impossible to switch on for the production deployment: the flag
 * is ANDed with "this is not the production environment". On Vercel that means
 * local development and preview deployments can mock, and the production
 * deployment cannot — there is no override, because an override is exactly how
 * a mock ends up live by accident.
 *
 * NODE_ENV is 'production' for Vercel preview builds too, so VERCEL_ENV is the
 * signal that actually distinguishes a preview from production.
 */
export function isMockModeActive(): boolean {
  const e = env();
  if (!e.GBP_MOCK_MODE) return false;
  if (e.VERCEL_ENV) return e.VERCEL_ENV !== 'production';
  return e.NODE_ENV !== 'production';
}

/** True when the flag is set but the environment refuses to honour it. */
export function isMockModeBlocked(): boolean {
  return env().GBP_MOCK_MODE && !isMockModeActive();
}

export function isProduction(): boolean {
  const e = env();
  return e.VERCEL_ENV === 'production' || e.NODE_ENV === 'production';
}

/** Base URL for building absolute links (OAuth redirects, cron self-calls). */
export function baseUrl(): string {
  const e = env();
  if (e.GOOGLE_REDIRECT_URI) {
    try {
      return new URL(e.GOOGLE_REDIRECT_URI).origin;
    } catch {
      /* fall through */
    }
  }
  if (e.VERCEL_URL) return `https://${e.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/**
 * Non-sensitive configuration summary. Safe to serialise to the browser and to
 * return from /api/health — contains booleans and never a secret value.
 */
export type ConfigSummary = {
  business: { name: string; website: string };
  oauthConfigured: boolean;
  googleConfigured: boolean;
  aiConfigured: boolean;
  /** Ordered provider names the router will try. Never a key. */
  aiProviderOrder: string[];
  /** Which providers hold a credential. Booleans only. */
  aiProvidersConfigured: Record<string, boolean>;
  /** Model id per provider. A model id is not a secret. */
  aiModels: Record<string, string>;
  cronConfigured: boolean;
  adminAuthConfigured: boolean;
  adminAuthMode: AdminAuthMode;
  durableStore: boolean;
  autoPublishReplies: boolean;
  /** Safe mock Business Profile — never true on the production deployment. */
  mockMode: boolean;
  /** Flag set but refused because this is production. */
  mockModeBlocked: boolean;
  pinnedLocation: boolean;
  environment: string;
};

export function configSummary(refreshTokenFromStore?: string | null): ConfigSummary {
  const e = env();
  return {
    business: { name: BUSINESS.name, website: BUSINESS.website },
    oauthConfigured: isOAuthConfigured(),
    googleConfigured: isGoogleConfigured(refreshTokenFromStore),
    aiConfigured: isAiConfigured(),
    aiProviderOrder: aiProviderOrder(),
    aiProvidersConfigured: {
      groq: Boolean(e.GROQ_API_KEY),
      gemini: Boolean(e.GEMINI_API_KEY),
      openai: Boolean(e.OPENAI_API_KEY),
    },
    aiModels: { groq: groqModel(), gemini: geminiModel(), openai: openaiModel() },
    cronConfigured: isCronConfigured(),
    adminAuthConfigured: isAdminAuthConfigured(),
    adminAuthMode: adminAuthMode(),
    durableStore: isDurableStoreConfigured(),
    autoPublishReplies: e.AUTO_PUBLISH_REPLIES,
    mockMode: isMockModeActive(),
    mockModeBlocked: isMockModeBlocked(),
    pinnedLocation: Boolean(e.GBP_LOCATION_NAME),
    environment: e.VERCEL_ENV || e.NODE_ENV,
  };
}

/** Human-readable warnings shown in the dashboard. Never includes secrets. */
export function configWarnings(refreshTokenFromStore?: string | null): string[] {
  const warnings: string[] = [];
  const e = env();

  if (!isOAuthConfigured()) {
    warnings.push(
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.',
    );
  } else if (!isGoogleConfigured(refreshTokenFromStore)) {
    warnings.push(
      'Google OAuth client is configured but the business account is not connected yet. Use "Connect Google".',
    );
  }
  if (!isAiConfigured()) {
    warnings.push(
      'No AI provider is configured — set GROQ_API_KEY (or GEMINI_API_KEY / OPENAI_API_KEY) to enable reply drafting.',
    );
  }
  if (!isCronConfigured()) {
    warnings.push('CRON_SECRET is not set — cron endpoints reject every request until it is.');
  }
  if (isAdminAuthMisconfigured()) {
    warnings.push(
      `Admin authentication is not configured in production (missing ${missingAdminAuthVars().join(
        ' and ',
      )}). The dashboard and every admin API are refusing requests until both are set.`,
    );
  } else if (!isAdminAuthConfigured()) {
    warnings.push(
      'ADMIN_PASSWORD / SESSION_SECRET are not set. That is allowed in local development only — production refuses to serve without them.',
    );
  }
  if (!isDurableStoreConfigured()) {
    warnings.push(
      'No durable store configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Drafts and posts are kept in memory only and are lost on cold start.',
    );
  }
  if (isMockModeActive()) {
    warnings.push(
      'Mock Business Profile mode is ON. Reviews and publishing are simulated — nothing reaches Google.',
    );
  }
  if (isMockModeBlocked()) {
    warnings.push(
      'GBP_MOCK_MODE is set but ignored: mock mode cannot run on the production deployment.',
    );
  }
  if (e.AUTO_PUBLISH_REPLIES) {
    warnings.push('AUTO_PUBLISH_REPLIES is ON — approved replies can be published without review.');
  }
  return warnings;
}

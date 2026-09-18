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

export const BUSINESS = {
  name: 'JK Interior',
  website: 'https://www.jkinterior.online',
  googleCloudProjectId: 'jk-interior-gbp-automation',
} as const;

/** Services JK Interior offers. Used to ground AI reply drafts and post copy. */
export const SERVICES = [
  'Gypsum False Ceiling',
  'PVC Ceiling',
  'Grid Ceiling',
  'PVC Wall Panels',
  'WPC Louvers',
  'WPC Fluted Panels',
  'UV Marble Sheet',
  'TV Unit Design',
  'Gypsum Board Partition',
  'Wall Panelling',
  'Interior Work',
] as const;

/** The only OAuth scope the Google Business Profile APIs accept. */
export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().trim().default(''),
  GOOGLE_CLIENT_SECRET: z.string().trim().default(''),
  GOOGLE_REDIRECT_URI: z.string().trim().default(''),
  GOOGLE_REFRESH_TOKEN: z.string().trim().default(''),

  OPENAI_API_KEY: z.string().trim().default(''),
  OPENAI_MODEL: z.string().trim().default('gpt-4o-mini'),

  CRON_SECRET: z.string().trim().default(''),

  ADMIN_PASSWORD: z.string().trim().default(''),
  SESSION_SECRET: z.string().trim().default(''),

  UPSTASH_REDIS_REST_URL: z.string().trim().default(''),
  UPSTASH_REDIS_REST_TOKEN: z.string().trim().default(''),

  GBP_ACCOUNT_NAME: z.string().trim().default(''),
  GBP_LOCATION_NAME: z.string().trim().default(''),

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
    console.error('[config] Environment validation failed:', parsed.error.message);
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

export function isAiConfigured(): boolean {
  return Boolean(env().OPENAI_API_KEY);
}

export function isCronConfigured(): boolean {
  return Boolean(env().CRON_SECRET);
}

export function isAdminAuthConfigured(): boolean {
  const e = env();
  return Boolean(e.ADMIN_PASSWORD && e.SESSION_SECRET);
}

export function isDurableStoreConfigured(): boolean {
  const e = env();
  return Boolean(e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN);
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
  cronConfigured: boolean;
  adminAuthConfigured: boolean;
  durableStore: boolean;
  autoPublishReplies: boolean;
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
    cronConfigured: isCronConfigured(),
    adminAuthConfigured: isAdminAuthConfigured(),
    durableStore: isDurableStoreConfigured(),
    autoPublishReplies: e.AUTO_PUBLISH_REPLIES,
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
    warnings.push('OPENAI_API_KEY is not set — AI reply drafting is disabled.');
  }
  if (!isCronConfigured()) {
    warnings.push('CRON_SECRET is not set — cron endpoints reject every request until it is.');
  }
  if (!isAdminAuthConfigured() && isProduction()) {
    warnings.push(
      'ADMIN_PASSWORD / SESSION_SECRET are not set — the dashboard is publicly reachable. Set both before going live.',
    );
  }
  if (!isDurableStoreConfigured()) {
    warnings.push(
      'No durable store configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Drafts and posts are kept in memory only and are lost on cold start.',
    );
  }
  if (e.AUTO_PUBLISH_REPLIES) {
    warnings.push('AUTO_PUBLISH_REPLIES is ON — approved replies can be published without review.');
  }
  return warnings;
}

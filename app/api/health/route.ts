/**
 * Health / readiness probe.
 *
 * Returns booleans only — never a secret, never a credential fragment. Safe to
 * hit publicly and safe to point an uptime monitor at.
 */

import { NextResponse } from 'next/server';

import { BUSINESS, configSummary } from '@/lib/config';
import { getRefreshToken } from '@/lib/google-auth';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // A missing/unreachable store must not make the app look unhealthy.
  let refreshToken: string | null = null;
  let storeReachable = true;
  try {
    refreshToken = await getRefreshToken();
  } catch {
    storeReachable = false;
  }

  const summary = configSummary(refreshToken);

  return NextResponse.json(
    {
      status: 'ok',
      service: 'JK Interior GBP Automation',
      business: BUSINESS.name,
      website: BUSINESS.website,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      environment: summary.environment,
      googleConfigured: summary.googleConfigured,
      checks: {
        oauthConfigured: summary.oauthConfigured,
        googleConnected: summary.googleConfigured,
        aiConfigured: summary.aiConfigured,
        cronConfigured: summary.cronConfigured,
        adminAuthConfigured: summary.adminAuthConfigured,
        durableStore: summary.durableStore,
        storeKind: getStore().kind,
        storeReachable,
        autoPublishReplies: summary.autoPublishReplies,
      },
      gbpApiAccess: summary.googleConfigured
        ? 'configured'
        : 'awaiting_credentials_or_api_approval',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

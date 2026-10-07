/**
 * Health / readiness probe.
 *
 * The one deliberately public endpoint. It returns booleans and short status
 * words only — never a secret, a credential fragment, a resource name, an email
 * or a hostname. Safe to point an uptime monitor at.
 *
 * It makes NO Google call: Business Profile status is read from the shared
 * access snapshot that every real Google call keeps current, so probing this
 * endpoint costs no quota and can never disagree with the dashboard.
 */

import { NextResponse } from 'next/server';

import { BUSINESS, configSummary } from '@/lib/config';
import { readAccess } from '@/lib/gbp-access';
import { getCredentialState } from '@/lib/google-auth';
import { getStore, pingStore } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const [credential, access, reachable] = await Promise.all([
    getCredentialState(),
    readAccess(),
    pingStore(),
  ]);

  const summary = configSummary(credential.connected);

  const degradedReasons: string[] = [];
  if (summary.adminAuthMode === 'misconfigured') {
    degradedReasons.push(
      'Admin authentication is not configured in production; admin routes are refusing requests.',
    );
  }
  if (!reachable) degradedReasons.push('The data store is not responding.');
  if (credential.connected && access.status === 'auth_error') {
    degradedReasons.push('Google rejected the saved sign-in; the account must be reconnected.');
  }
  if (credential.connected && access.status === 'permission_error') {
    degradedReasons.push('Google Business Profile access needs attention.');
  }

  return NextResponse.json(
    {
      status: degradedReasons.length > 0 ? 'degraded' : 'ok',
      ...(degradedReasons.length > 0 ? { degradedReasons } : {}),
      service: 'JK Interior GBP Automation',
      business: BUSINESS.name,
      website: BUSINESS.website,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      environment: summary.environment,
      googleConfigured: summary.googleConfigured,
      checks: {
        oauthConfigured: summary.oauthConfigured,
        // A credential is held and Google has not rejected it.
        googleConnected: credential.connected && access.status !== 'auth_error',
        aiConfigured: summary.aiConfigured,
        cronConfigured: summary.cronConfigured,
        adminAuthConfigured: summary.adminAuthConfigured,
        // 'enforced' | 'misconfigured' | 'development_only'. Never a value.
        adminAuthMode: summary.adminAuthMode,
        durableStore: summary.durableStore,
        storeKind: getStore().kind,
        storeReachable: reachable,
        autoPublishReplies: summary.autoPublishReplies,
      },
      // What Google actually last said — not whether credentials merely exist.
      // 'unknown' | 'available' | 'pending' | 'rate_limited' | 'auth_error' |
      // 'permission_error' | 'error'
      gbpApiAccess: credential.connected ? access.status : 'not_connected',
      gbpServices: Object.fromEntries(access.services.map((s) => [s.service, s.status])),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

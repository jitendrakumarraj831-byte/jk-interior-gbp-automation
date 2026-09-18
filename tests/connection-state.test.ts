/**
 * The headline regression: an account whose OAuth works but whose Business
 * Profile API access is still pending must report CONNECTED + PENDING — never
 * "not connected", and never a prompt to reconnect.
 *
 * Google is mocked at the module boundary so the five states can each be
 * reproduced deterministically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppErrorCode } from '@/lib/errors';

const mutableEnv = process.env as Record<string, string | undefined>;

const getAccessToken = vi.fn();
const listAccounts = vi.fn();
const listLocations = vi.fn();

vi.mock('@/lib/google-auth', () => ({
  getAccessToken: () => getAccessToken(),
  getRefreshToken: async () => 'stored-refresh-token',
  getConnectionMeta: async () => ({
    connectedAt: '2026-09-01T00:00:00.000Z',
    googleAccountEmail: 'owner@example.com',
  }),
}));

vi.mock('@/lib/google-business', () => ({
  listAccounts: () => listAccounts(),
  listLocations: (account: string) => listLocations(account),
  buildLocationPath: (a: string, l: string) => `${a}/${l}`,
  pinnedTarget: () => null,
}));

/**
 * vi.resetModules() rebuilds the module graph, so the AppError class the code
 * under test sees is a different object from one imported at the top of this
 * file. The error factory therefore has to come from the same fresh graph, or
 * `instanceof AppError` fails and every case degrades to 'error'.
 */
async function loadConnection() {
  vi.resetModules();
  const errors = await import('@/lib/errors');
  const connection = await import('@/lib/connection');
  const appError = (code: AppErrorCode, message: string, status: number) =>
    new errors.AppError(code, message, status);
  return { ...connection, appError };
}

beforeEach(() => {
  mutableEnv.GOOGLE_CLIENT_ID = 'test-client-id';
  mutableEnv.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  mutableEnv.GOOGLE_REDIRECT_URI = 'https://example.test/api/auth/google/callback';
  delete mutableEnv.GBP_MOCK_MODE;
  getAccessToken.mockReset().mockResolvedValue('ya29.fake-access-token');
  listAccounts.mockReset();
  listLocations.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']) {
    delete mutableEnv[key];
  }
});

describe('OAuth connected + GBP API pending', () => {
  it('reports the account as CONNECTED and the API as PENDING', async () => {
    // What a 0 QPM project actually returns.
    const { getConnectionState, appError } = await loadConnection();
    listAccounts.mockRejectedValue(appError('GBP_QUOTA_EXCEEDED', 'Google Business Profile API quota exhausted.', 503));
    const state = await getConnectionState();

    expect(state.oauthConnected).toBe(true);
    expect(state.apiAccess).toBe('pending');
    expect(state.apiAccessMessage).toContain('connected');
    expect(state.apiAccessMessage).toContain('pending approval');
    // A pending API is not an error the operator can act on.
    expect(state.lastError).toBeUndefined();
    // The account link survives untouched.
    expect(state.hasRefreshToken).toBe(true);
    expect(state.googleAccountEmail).toBe('owner@example.com');
  });

  it('does not re-call Google while the pending cooldown holds', async () => {
    const { getConnectionState, appError } = await loadConnection();
    listAccounts.mockRejectedValue(appError('GBP_QUOTA_EXCEEDED', 'quota', 503));

    await getConnectionState();
    const afterFirst = listAccounts.mock.calls.length;
    await getConnectionState();
    await getConnectionState();

    // The first probe happened; the next two were suppressed by the cooldown.
    expect(afterFirst).toBe(1);
    expect(listAccounts.mock.calls.length).toBe(1);
  });

  it('API-not-enabled is treated the same as 0 QPM', async () => {
    const { getConnectionState, appError } = await loadConnection();
    listAccounts.mockRejectedValue(appError('GBP_API_NOT_ENABLED', 'not enabled', 503));
    const state = await getConnectionState();
    expect(state.oauthConnected).toBe(true);
    expect(state.apiAccess).toBe('pending');
  });
});

describe('the other connection states stay distinct', () => {
  it('a revoked refresh token is an auth error, not "pending"', async () => {
    const { getConnectionState, appError } = await loadConnection();
    getAccessToken.mockRejectedValue(appError('GOOGLE_AUTH_FAILED', 'Could not refresh the Google access token.', 401));
    const state = await getConnectionState();
    expect(state.oauthConnected).toBe(false);
    expect(state.apiAccess).toBe('auth_error');
    expect(state.lastError).toBeDefined();
  });

  it('a temporary rate limit is not mistaken for pending approval', async () => {
    const { getConnectionState, appError } = await loadConnection();
    listAccounts.mockRejectedValue(appError('GBP_RATE_LIMITED', 'rate limited', 503));
    const state = await getConnectionState();
    expect(state.oauthConnected).toBe(true);
    expect(state.apiAccess).toBe('rate_limited');
  });

  it('a permission problem is reported as such', async () => {
    const { getConnectionState, appError } = await loadConnection();
    listAccounts.mockRejectedValue(appError('GBP_FORBIDDEN', 'forbidden', 403));
    const state = await getConnectionState();
    expect(state.apiAccess).toBe('permission_error');
  });

  it('a working API reports available and lists locations', async () => {
    listAccounts.mockResolvedValue([{ name: 'accounts/1', accountName: 'JK Interior' }]);
    listLocations.mockResolvedValue([{ name: 'locations/2', title: 'Forbesganj' }]);
    const { getConnectionState } = await loadConnection();
    const state = await getConnectionState();
    expect(state.oauthConnected).toBe(true);
    expect(state.apiAccess).toBe('available');
    expect(state.connected).toBe(true);
    expect(state.locations).toHaveLength(1);
  });
});

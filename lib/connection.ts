/**
 * Resolves which Business Profile account/location the app should act on, and
 * reports the connection state for the dashboard.
 *
 * Resolution order: environment pins → dashboard selection → first account and
 * location Google returns.
 */

import { isMockModeActive, isOAuthConfigured } from './config';
import { AppError } from './errors';
import {
  describeAccess,
  readAccess,
  recordAccessAvailable,
  recordAccessFailure,
  shouldSkipGoogleCalls,
  type GbpAccessStatus,
} from './gbp-access';
import { getAccessToken, getConnectionMeta, getRefreshToken } from './google-auth';
import { MOCK_LOCATION_PATH } from './gbp-mock';
import { buildLocationPath, listAccounts, listLocations, pinnedTarget } from './google-business';
import { getSettings } from './repository';
import type { ConnectionState } from './types';

export type ResolvedTarget = {
  /** e.g. accounts/123 */
  accountName: string;
  /** e.g. locations/456 */
  locationName: string;
  /** e.g. accounts/123/locations/456 — what the v4 API needs. */
  locationPath: string;
};

/**
 * Figures out the account/location to operate on. Calls Google only when the
 * pair is not already pinned by env or stored settings, so the common path
 * costs no extra quota.
 */
export async function resolveTarget(): Promise<ResolvedTarget> {
  const pinned = pinnedTarget();
  if (pinned) {
    return {
      accountName: pinned.account,
      locationName: pinned.location,
      locationPath: buildLocationPath(pinned.account, pinned.location),
    };
  }

  const settings = await getSettings();
  if (settings.selectedAccount && settings.selectedLocation) {
    return {
      accountName: settings.selectedAccount,
      locationName: settings.selectedLocation,
      locationPath: buildLocationPath(settings.selectedAccount, settings.selectedLocation),
    };
  }

  const accounts = await listAccounts();
  const account = accounts[0];
  if (!account) {
    throw new AppError(
      'GBP_NOT_FOUND',
      'The connected Google account does not manage any Business Profile accounts.',
      404,
    );
  }

  const locations = await listLocations(account.name);
  const location = locations[0];
  if (!location) {
    throw new AppError(
      'GBP_NOT_FOUND',
      `No locations found under ${account.accountName}. Pick one in Settings or set GBP_LOCATION_NAME.`,
      404,
    );
  }

  return {
    accountName: account.name,
    locationName: location.name,
    locationPath: buildLocationPath(account.name, location.name),
  };
}

/**
 * Connection state for the UI. Never throws: a Google failure becomes
 * `lastError` so the Connection page can render it instead of a 500.
 */
export async function getConnectionState(): Promise<ConnectionState> {
  const refreshToken = await getRefreshToken();
  const meta = await getConnectionMeta();
  const settings = await getSettings();
  const pinned = pinnedTarget();
  const cached = await readAccess();

  const state: ConnectionState = {
    connected: false,
    oauthConnected: false,
    apiAccess: cached.status,
    apiAccessMessage: describeAccess(cached.status),
    hasRefreshToken: Boolean(refreshToken),
    connectedAt: meta?.connectedAt,
    googleAccountEmail: meta?.googleAccountEmail,
    accounts: [],
    locations: [],
    selectedAccount: pinned?.account ?? settings.selectedAccount,
    selectedLocation: pinned?.location ?? settings.selectedLocation,
  };

  // Mock mode stands in for the whole Business Profile, including its identity.
  if (isMockModeActive()) {
    return {
      ...state,
      connected: true,
      oauthConnected: true,
      apiAccess: 'available',
      apiAccessMessage: 'Mock Business Profile — simulated data, nothing reaches Google.',
      accounts: [{ name: 'mock/accounts/jk-interior', accountName: 'JK Interior (mock)' }],
      locations: [{ name: MOCK_LOCATION_PATH, title: 'JK Interior — Forbesganj (mock)' }],
      selectedAccount: 'mock/accounts/jk-interior',
      selectedLocation: MOCK_LOCATION_PATH,
    };
  }

  if (!isOAuthConfigured() || !refreshToken) return state;

  /*
   * Step 1 — is the ACCOUNT linked? Refreshing the access token hits Google's
   * OAuth endpoint, which is unaffected by Business Profile quota. This is what
   * lets a connected account stay "connected" while API access is at 0 QPM.
   */
  try {
    await getAccessToken();
    state.oauthConnected = true;
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'GOOGLE_API_ERROR';
    state.apiAccess = await recordAccessFailure(code);
    state.apiAccessMessage = describeAccess(state.apiAccess);
    state.lastError =
      error instanceof AppError ? error.message : 'Unexpected error contacting Google.';
    return state;
  }

  /*
   * Step 2 — is API ACCESS granted?
   *
   * While a pending result is inside its cooldown the call is skipped entirely:
   * every dashboard load would otherwise re-ask an endpoint known to be closed.
   * The cooldown expires on its own, so approval is picked up without any
   * manual step.
   */
  if (await shouldSkipGoogleCalls()) {
    state.apiAccess = 'pending';
    state.apiAccessMessage = describeAccess('pending');
    return state;
  }

  // A failure here never un-links the account and never touches the refresh token.
  try {
    const accounts = await listAccounts();
    state.accounts = accounts;
    const accountName = state.selectedAccount ?? accounts[0]?.name;
    if (accountName) {
      state.locations = await listLocations(accountName);
      state.selectedAccount = accountName;
      state.selectedLocation = state.selectedLocation ?? state.locations[0]?.name;
    }
    state.connected = true;
    state.apiAccess = 'available';
    state.apiAccessMessage = describeAccess('available');
    await recordAccessAvailable();
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'GOOGLE_API_ERROR';
    const status: GbpAccessStatus = await recordAccessFailure(code);
    state.apiAccess = status;
    state.apiAccessMessage = describeAccess(status);
    // Only a genuine fault is surfaced as an error; "pending" is an expected
    // waiting state, not something the operator can act on.
    if (status !== 'pending') {
      state.lastError =
        error instanceof AppError ? error.message : 'Unexpected error contacting Google.';
    }
  }

  return state;
}

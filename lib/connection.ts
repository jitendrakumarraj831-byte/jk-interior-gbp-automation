/**
 * Resolves which Business Profile account/location the app should act on, and
 * reports the connection state for the dashboard.
 *
 * Resolution order: environment pins → dashboard selection → first account and
 * location Google returns.
 */

import { isOAuthConfigured } from './config';
import { AppError } from './errors';
import { getConnectionMeta, getRefreshToken } from './google-auth';
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

  const state: ConnectionState = {
    connected: false,
    hasRefreshToken: Boolean(refreshToken),
    connectedAt: meta?.connectedAt,
    googleAccountEmail: meta?.googleAccountEmail,
    accounts: [],
    locations: [],
    selectedAccount: pinned?.account ?? settings.selectedAccount,
    selectedLocation: pinned?.location ?? settings.selectedLocation,
  };

  if (!isOAuthConfigured() || !refreshToken) return state;

  try {
    const accounts = await listAccounts();
    state.accounts = accounts;
    const accountName = state.selectedAccount ?? accounts[0]?.name;
    if (accountName) {
      state.locations = await listLocations(accountName);
      state.selectedAccount = accountName;
      state.selectedLocation = state.selectedLocation ?? state.locations[0]?.name;
    }
    // Reaching here means Google actually answered — that is a real connection.
    state.connected = true;
  } catch (error) {
    state.lastError =
      error instanceof AppError ? error.message : 'Unexpected error contacting Google.';
  }

  return state;
}

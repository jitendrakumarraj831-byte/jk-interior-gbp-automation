/**
 * Resolves which Business Profile account/location the app should act on, and
 * reports the connection state for the dashboard.
 *
 * Resolution order: environment pins → dashboard selection → the first account
 * and location Google returns (remembered for a day, so ordinary page loads
 * cost no discovery quota).
 *
 * There is ONE source of truth for "is the Business Profile API working":
 * the access snapshot in lib/gbp-access.ts, fed by every Google call. This file
 * only reads it (and can re-verify it on demand) — it never keeps a second copy.
 */

import { isMockModeActive, isOAuthConfigured } from './config';
import { AppError } from './errors';
import {
  isCheckDue,
  readAccess,
  recordAuthFailure,
  type GbpAccessSnapshot,
} from './gbp-access';
import { MOCK_LOCATION_PATH } from './gbp-mock';
import {
  fetchPerformance,
  buildLocationPath,
  listAccounts,
  listLocations,
  listReviews,
  pinnedTarget,
  probeLocalPosts,
} from './google-business';
import { getAccessToken, getConnectionMeta, getCredentialState } from './google-auth';
import { log } from './logger';
import { getSettings, type AppSettings } from './repository';
import { getStore, nsKey, withLock } from './store';
import type { ConnectionState, GbpAccount, GbpLocation } from './types';

export type ResolvedTarget = {
  /** e.g. accounts/123 */
  accountName: string;
  /** e.g. locations/456 */
  locationName: string;
  /** e.g. accounts/123/locations/456 — what the v4 API needs. */
  locationPath: string;
  /** Where the choice came from. */
  source: 'pinned' | 'selected' | 'discovered';
};

/* -------------------------------- discovery ------------------------------ */

type Discovery = {
  accounts: GbpAccount[];
  /** Locations per account, filled in only for accounts we have been asked about. */
  locationsByAccount: Record<string, GbpLocation[]>;
  fetchedAt: string;
};

const DISCOVERY_KEY = nsKey('gbp', 'discovery');
/** Ordinary resolution trusts a discovery this old — locations rarely change. */
const TARGET_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** The Connection page re-lists after this long, or immediately on Refresh. */
const PAGE_MAX_AGE_MS = 10 * 60 * 1000;

async function readDiscovery(): Promise<Discovery | null> {
  try {
    return await getStore().get<Discovery>(DISCOVERY_KEY);
  } catch {
    return null;
  }
}

async function writeDiscovery(discovery: Discovery): Promise<void> {
  try {
    await getStore().set(DISCOVERY_KEY, discovery);
  } catch {
    /* a cache — never fail a request over it */
  }
}

function isFresh(discovery: Discovery | null, maxAgeMs: number): discovery is Discovery {
  if (!discovery) return false;
  const age = Date.now() - Date.parse(discovery.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs;
}

/**
 * Lists accounts, and the locations of `accountName` (default: the first
 * account), reusing the cached answer while it is young enough.
 *
 * The Account Management API has by far the tightest quota of the Business
 * Profile APIs, so this is the one call worth not repeating on every request.
 */
async function discover(options: {
  accountName?: string | null;
  maxAgeMs: number;
  force?: boolean;
}): Promise<{ discovery: Discovery; source: 'live' | 'cached'; accountName: string | null }> {
  const cached = await readDiscovery();
  const wanted = options.accountName ?? cached?.accounts[0]?.name ?? null;

  if (!options.force && isFresh(cached, options.maxAgeMs)) {
    const account = wanted ?? cached.accounts[0]?.name ?? null;
    if (!account || cached.locationsByAccount[account]) {
      return { discovery: cached, source: 'cached', accountName: account };
    }
  }

  const accounts = await listAccounts();
  const accountName = options.accountName ?? accounts[0]?.name ?? null;
  const locationsByAccount: Record<string, GbpLocation[]> = {};
  if (accountName) locationsByAccount[accountName] = await listLocations(accountName);

  const discovery: Discovery = { accounts, locationsByAccount, fetchedAt: new Date().toISOString() };
  await writeDiscovery(discovery);
  return { discovery, source: 'live', accountName };
}

/* ------------------------------ target resolution ------------------------ */

/**
 * Figures out the account/location to operate on. Calls Google only when the
 * pair is not already pinned by env or stored settings and no recent discovery
 * is cached, so the common path costs no extra quota.
 */
export async function resolveTarget(): Promise<ResolvedTarget> {
  const pinned = pinnedTarget();
  const settings = await getSettings();

  const account = pinned?.account ?? settings.selectedAccount ?? null;
  const location = pinned?.location ?? settings.selectedLocation ?? null;

  if (account && location) {
    const path = buildLocationPath(account, location);
    return {
      accountName: account,
      locationName: `locations/${path.split('/locations/')[1]}`,
      locationPath: path,
      source: pinned?.account && pinned.location ? 'pinned' : 'selected',
    };
  }

  const { discovery, accountName } = await discover({
    accountName: account,
    maxAgeMs: TARGET_MAX_AGE_MS,
  });

  const resolvedAccount = account ?? accountName;
  if (!resolvedAccount) {
    throw new AppError(
      'GBP_NOT_FOUND',
      'The connected Google account does not manage any Business Profile accounts.',
      404,
    );
  }

  const resolvedLocation =
    location ?? discovery.locationsByAccount[resolvedAccount]?.[0]?.name ?? null;
  if (!resolvedLocation) {
    throw new AppError(
      'GBP_NOT_FOUND',
      'No locations were found on this Business Profile account. Pick one on the Google Connection page or set GBP_LOCATION_NAME.',
      404,
    );
  }

  const path = buildLocationPath(resolvedAccount, resolvedLocation);
  return {
    accountName: resolvedAccount,
    locationName: `locations/${path.split('/locations/')[1]}`,
    locationPath: path,
    source: location ? (pinned?.location ? 'pinned' : 'selected') : 'discovered',
  };
}

/**
 * The display name of a location, from what the dashboard already knows — the
 * title captured when it was selected, or the cached listing. Makes no Google
 * call; `undefined` means "not known yet", and callers fall back to the id.
 */
export async function getLocationTitle(
  locationPathOrName: string,
  settings: Pick<AppSettings, 'selectedLocation' | 'selectedLocationTitle'>,
): Promise<string | undefined> {
  const idOf = (value: string) => value.split('/locations/').pop()?.replace(/^locations\//, '');
  const wanted = idOf(locationPathOrName);
  if (!wanted) return undefined;

  if (
    settings.selectedLocationTitle &&
    settings.selectedLocation &&
    idOf(settings.selectedLocation) === wanted
  ) {
    return settings.selectedLocationTitle;
  }

  const discovery = await readDiscovery();
  for (const locations of Object.values(discovery?.locationsByAccount ?? {})) {
    const match = locations.find((l) => idOf(l.name) === wanted);
    if (match) return match.title;
  }
  return undefined;
}

/* ------------------------------ access checking -------------------------- */

const CHECK_THROTTLE_KEY = nsKey('gbp', 'check_throttle');
/** A manual check is allowed at most this often. */
const MANUAL_CHECK_INTERVAL_SECONDS = 10;

/**
 * Re-verifies Business Profile access by exercising each API once, cheaply:
 * list accounts and locations, read one review, read one post, fetch one
 * metric. Every call records its own outcome, so afterwards the snapshot says
 * exactly which APIs work — and a single success flips the overall state to
 * available immediately, however stale any earlier "pending" was.
 *
 * Never throws for a Google failure (those are the result being measured). A
 * manual check is throttled so the button cannot be used to hammer Google.
 */
export async function checkGbpAccess(options: { manual: boolean }): Promise<GbpAccessSnapshot> {
  if (isMockModeActive()) return readAccess();

  if (options.manual) {
    let allowed = true;
    try {
      allowed = await getStore().setIfAbsent(CHECK_THROTTLE_KEY, new Date().toISOString(), {
        ttlSeconds: MANUAL_CHECK_INTERVAL_SECONDS,
      });
    } catch {
      allowed = true;
    }
    if (!allowed) {
      throw new AppError(
        'RATE_LIMITED',
        'A check just ran. Wait a few seconds and try again.',
        429,
      );
    }
  }

  // The OAuth step: refreshing a token hits Google's OAuth endpoint, which is
  // unaffected by Business Profile quota.
  try {
    await getAccessToken();
  } catch (error) {
    if (error instanceof AppError && error.code === 'GOOGLE_AUTH_FAILED') {
      await recordAuthFailure(error.code);
    }
    return readAccess();
  }

  const ignore = () => undefined; // each call already recorded its own outcome

  let target: ResolvedTarget | null = null;
  try {
    const chosen = pinnedTarget()?.account ?? (await getSettings()).selectedAccount ?? null;
    await discover({ accountName: chosen, maxAgeMs: 0, force: true });
  } catch {
    /* recorded against accounts/locations by googleFetch */
  }
  try {
    target = await resolveTarget();
  } catch {
    /* no target → the target-scoped APIs simply cannot be checked yet */
  }

  if (target) {
    const t = target;
    await Promise.allSettled([
      listReviews(t.locationPath, { maxPages: 1, pageSize: 1 }).catch(ignore),
      probeLocalPosts(t.locationPath).catch(ignore),
      fetchPerformance(t.locationName, { days: 7, metrics: ['CALL_CLICKS'] }).catch(ignore),
    ]);
  }

  return readAccess();
}

/**
 * Self-healing read of the access snapshot.
 *
 * When access is already proven it returns straight away. Otherwise — and only
 * once per cooldown, with a lock so concurrent page loads share one check — it
 * re-verifies against Google first, so a dashboard that last saw "pending"
 * notices approval the moment it lands instead of hours later.
 */
export async function ensureAccessChecked(): Promise<GbpAccessSnapshot> {
  const snapshot = await readAccess();
  if (isMockModeActive() || !isOAuthConfigured()) return snapshot;
  if (!isCheckDue(snapshot)) return snapshot;
  if (snapshot.status === 'auth_error') return snapshot; // only Reconnect can fix this

  const credential = await getCredentialState();
  if (!credential.connected) return snapshot;

  try {
    const result = await withLock('access-check', 60, () => checkGbpAccess({ manual: false }));
    return result.ran ? result.value : await readAccess();
  } catch (error) {
    log.warn('connection', 'Automatic access check failed.', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return readAccess();
  }
}

/* --------------------------- connection state (UI) ----------------------- */

/**
 * Connection state for the UI. Never throws: a Google failure becomes
 * `lastError` so the Connection page can render it instead of a 500.
 *
 * `refresh` forces a live re-check of access and a fresh account/location
 * listing; without it, cached discovery is reused and no check is forced.
 */
export async function getConnectionState(
  options: { refresh?: boolean } = {},
): Promise<ConnectionState> {
  const [credential, meta, settings] = await Promise.all([
    getCredentialState(),
    getConnectionMeta(),
    getSettings(),
  ]);
  const pinned = pinnedTarget();

  const base: ConnectionState = {
    connected: false,
    oauthConnected: false,
    apiAccess: 'unknown',
    apiAccessMessage: '',
    access: await readAccess(),
    hasRefreshToken: credential.connected,
    credentialSource: credential.source,
    environmentTokenIgnored: credential.environmentTokenIgnored,
    connectedAt: meta?.connectedAt,
    googleAccountEmail: meta?.googleAccountEmail,
    accounts: [],
    locations: [],
    selectedAccount: pinned?.account ?? settings.selectedAccount,
    selectedLocation: pinned?.location ?? settings.selectedLocation,
    selectedLocationTitle: settings.selectedLocationTitle,
    selectionSource: pinned?.location ? 'pinned' : settings.selectedLocation ? 'selected' : null,
    discovery: { source: 'none' },
  };

  // Mock mode stands in for the whole Business Profile, including its identity.
  if (isMockModeActive()) {
    return {
      ...base,
      connected: true,
      oauthConnected: true,
      apiAccess: 'available',
      apiAccessMessage: 'Mock Business Profile — simulated data, nothing reaches Google.',
      accounts: [{ name: 'mock/accounts/jk-interior', accountName: 'JK Interior (mock)' }],
      locations: [{ name: MOCK_LOCATION_PATH, title: 'JK Interior — Forbesganj (mock)' }],
      selectedAccount: 'mock/accounts/jk-interior',
      selectedLocation: MOCK_LOCATION_PATH,
      selectedLocationTitle: 'JK Interior — Forbesganj (mock)',
      selectionSource: 'selected',
    };
  }

  if (!isOAuthConfigured() || !credential.connected) {
    return { ...base, apiAccessMessage: 'No Google account is connected yet.' };
  }

  /*
   * Step 1 — is the ACCOUNT linked? Refreshing the access token hits Google's
   * OAuth endpoint, which is unaffected by Business Profile quota. This is what
   * lets a connected account stay "connected" while API access is still pending.
   */
  try {
    await getAccessToken();
    base.oauthConnected = true;
  } catch (error) {
    const appError = error instanceof AppError ? error : null;
    if (appError?.code === 'GOOGLE_AUTH_FAILED') {
      await recordAuthFailure(appError.code);
      const access = await readAccess();
      return {
        ...base,
        access,
        apiAccess: access.status,
        apiAccessMessage: access.message,
        lastError: appError.message,
      };
    }
    // A network blip while refreshing: the account is still linked.
    const access = await readAccess();
    return {
      ...base,
      oauthConnected: true,
      access,
      apiAccess: access.status,
      apiAccessMessage: access.message,
      lastError: appError?.message ?? 'Unexpected error contacting Google.',
    };
  }

  /*
   * Step 2 — API access. A forced refresh re-verifies every API; otherwise the
   * snapshot is brought up to date only if it is not proven and a check is due.
   */
  let access: GbpAccessSnapshot;
  try {
    access = options.refresh ? await checkGbpAccess({ manual: true }) : await ensureAccessChecked();
  } catch (error) {
    // Throttled (a check just ran): the snapshot that check produced is current.
    if (!(error instanceof AppError && error.code === 'RATE_LIMITED')) throw error;
    access = await readAccess();
  }

  /* Step 3 — accounts and locations, from cache unless refreshing. */
  const chosenAccount = pinned?.account ?? settings.selectedAccount ?? null;
  let discoveryError: string | undefined;
  try {
    const { discovery, source, accountName } = await discover({
      accountName: chosenAccount,
      maxAgeMs: PAGE_MAX_AGE_MS,
      force: false,
    });
    const account = chosenAccount ?? accountName;
    base.accounts = discovery.accounts;
    base.locations = account ? (discovery.locationsByAccount[account] ?? []) : [];
    base.discovery = { source, fetchedAt: discovery.fetchedAt };
    if (account) base.selectedAccount = account;
  } catch (error) {
    discoveryError =
      error instanceof AppError ? error.message : 'Unexpected error listing your locations.';
    // Stale beats empty: show the last known list rather than hide the locations.
    const stale = await readDiscovery();
    if (stale) {
      const account = chosenAccount ?? stale.accounts[0]?.name ?? null;
      base.accounts = stale.accounts;
      base.locations = account ? (stale.locationsByAccount[account] ?? []) : [];
      base.discovery = { source: 'cached', fetchedAt: stale.fetchedAt };
      if (account) base.selectedAccount = account;
    }
  }

  if (!base.selectedLocation) {
    base.selectedLocation = base.locations[0]?.name;
    if (base.selectedLocation) base.selectionSource = 'auto';
  }
  const selected = base.locations.find((l) => l.name === base.selectedLocation);
  base.selectedLocationTitle = selected?.title ?? base.selectedLocationTitle;
  if (discoveryError) base.discovery = { ...base.discovery, error: discoveryError };

  base.access = access;
  base.apiAccess = access.status;
  base.apiAccessMessage = access.message;
  base.connected = access.status === 'available';

  // "Pending" is an expected wait, not something the operator can act on; every
  // other non-available state carries a message worth surfacing.
  if (access.status !== 'available' && access.status !== 'pending' && access.status !== 'unknown') {
    base.lastError = access.message;
  }

  return base;
}

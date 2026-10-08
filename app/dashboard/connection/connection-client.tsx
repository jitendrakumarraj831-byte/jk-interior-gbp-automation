'use client';

/**
 * Google connection.
 *
 * The Google ACCOUNT and Business Profile API ACCESS are two separate facts,
 * reported separately. Everything shown here is read from one place — the
 * shared access snapshot returned by /api/accounts — so this page, the
 * dashboard and Settings cannot disagree. No token or secret is ever rendered:
 * only booleans, statuses and Google resource names.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError, formatDateTime, relativeTime } from '@/lib/client';
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  GoogleIcon,
  LockIcon,
  PinIcon,
  RefreshIcon,
  SettingsIcon,
  ShieldIcon,
} from '@/components/icons';
import { AccessServiceList, CheckAccessButton, DegradedNotice } from '@/components/gbp-access-panel';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  SectionHeader,
  SkeletonCard,
  StatusPill,
  type Tone,
} from '@/components/ui';
import { accessLabel } from '@/lib/gbp-status';
import type { ConnectionState } from '@/lib/types';

type SettingsPayload = {
  config: { oauthConfigured: boolean; googleConfigured: boolean; pinnedLocation: boolean };
};

type ConnState =
  | 'not_connected'
  | 'configuration_required'
  | 'connected'
  | 'approval_pending'
  | 'rate_limited'
  | 'checking'
  | 'connection_error';

const STATE_META: Record<ConnState, { label: string; tone: Tone }> = {
  connected: { label: 'Connected & Active', tone: 'google' },
  approval_pending: { label: 'Approval pending', tone: 'warning' },
  rate_limited: { label: 'Rate limited', tone: 'warning' },
  checking: { label: 'Not checked yet', tone: 'neutral' },
  configuration_required: { label: 'Configuration required', tone: 'neutral' },
  connection_error: { label: 'Needs attention', tone: 'danger' },
  not_connected: { label: 'Not connected', tone: 'neutral' },
};

/**
 * Collapses the structured access status into one of the page's visual states.
 * The account and the API are separate: a linked account whose API access is
 * still pending must never read as "disconnected", and an API that is proven
 * to be answering must never read as "pending".
 */
function resolveState(state: ConnectionState, oauthReady: boolean): ConnState {
  if (!oauthReady) return 'configuration_required';
  if (!state.hasRefreshToken) return 'not_connected';
  if (!state.oauthConnected) return 'connection_error';
  switch (state.apiAccess) {
    case 'available':
      return 'connected';
    case 'pending':
      return 'approval_pending';
    case 'rate_limited':
      return 'rate_limited';
    case 'unknown':
      return 'checking';
    default:
      return 'connection_error';
  }
}

export default function ConnectionClient({
  connectResult,
  connectReason,
  connectedAccount,
}: {
  connectResult: string | null;
  connectReason: string | null;
  connectedAccount: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<ConnectionState | null>(null);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ title: string; text: string; tone: 'success' | 'warning' } | null>(
    null,
  );
  const [callback, setCallback] = useState<{
    result: string | null;
    reason: string | null;
    account: string | null;
  }>({ result: connectResult, reason: connectReason, account: connectedAccount });
  const requestId = useRef(0);

  const load = useCallback(async () => {
    // Only the most recent request may update the screen, so a slow earlier
    // response can never overwrite a newer one (stale state after a quick
    // Disconnect → Reconnect, or a double Refresh).
    const mine = ++requestId.current;
    try {
      const [connection, config] = await Promise.all([
        api.get<ConnectionState>('/api/accounts'),
        api.get<SettingsPayload>('/api/settings'),
      ]);
      if (mine !== requestId.current) return;
      setState(connection.data);
      setSettings(config.data);
      setError(null);
    } catch (caught) {
      if (mine !== requestId.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Could not load the connection state.');
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setFlash(null);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  // The OAuth result arrives as query parameters. Show it once, then clear the
  // URL so a reload does not resurrect an old banner.
  useEffect(() => {
    if (connectResult) router.replace(pathname, { scroll: false });
  }, [connectResult, pathname, router]);

  async function select(kind: 'selectedAccount' | 'selectedLocation', value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api.patch('/api/settings', { [kind]: value });
      await load();
      setFlash({ title: 'Done', text: 'Selection saved.', tone: 'success' });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save that selection.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    if (
      !window.confirm(
        'Disconnect Google? Reviews, posts and performance will stop syncing until you reconnect.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    setCallback({ result: null, reason: null, account: null });
    try {
      const response = await api.post<{ disconnected: boolean }>('/api/auth/google/disconnect');
      setFlash({ title: 'Done', text: response.message, tone: 'success' });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  const oauthReady = settings?.config.oauthConfigured ?? false;
  const connState = state ? resolveState(state, oauthReady) : 'not_connected';
  const meta = STATE_META[connState];
  /** Access is proven, but some API is failing — never show that as plain green. */
  const partlyWorking = connState === 'connected' && (state?.access.degraded.length ?? 0) > 0;
  const selectedLocation = state?.locations.find((l) => l.name === state.selectedLocation);
  const locationLabel =
    selectedLocation?.title ??
    state?.selectedLocationTitle ??
    (state?.selectedLocation ? state.selectedLocation : null);
  const accountLabel =
    state?.accounts.find((a) => a.name === state.selectedAccount)?.accountName ??
    state?.selectedAccount ??
    state?.accounts[0]?.accountName ??
    null;

  return (
    <>
      <PageHeader
        eyebrow="Integration"
        title="Google Connection"
        description="Link the Google account that manages the JK Interior Business Profile."
        action={
          <Button variant="secondary" onClick={refresh} loading={loading} icon={<RefreshIcon size={16} />}>
            Refresh
          </Button>
        }
      />

      {callback.result === 'success' ? (
        <div className="mb-4">
          <Callout tone="success" title="Google account connected" icon={<CheckCircleIcon size={18} />}>
            <p>
              {callback.account
                ? `Connected as ${callback.account}.`
                : 'Your credentials are stored securely on the server.'}
            </p>
          </Callout>
        </div>
      ) : null}

      {callback.result === 'error' ? (
        <div className="mb-4">
          <Callout tone="danger" title="Connection did not complete" icon={<AlertIcon size={18} />}>
            <p>{callback.reason ?? 'Google did not complete the authorization.'}</p>
          </Callout>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <Callout tone="danger" title="Something went wrong">
            <p>{error}</p>
          </Callout>
        </div>
      ) : null}
      {flash ? (
        <div className="mb-4">
          <Callout
            tone={flash.tone}
            title={flash.title}
            icon={flash.tone === 'success' ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
          >
            <p>{flash.text}</p>
          </Callout>
        </div>
      ) : null}

      {loading && !state ? <SkeletonCard lines={4} /> : null}

      {state ? (
        <div className="space-y-5">
          {/* --------------------------- hero state --------------------- */}
          <Card
            className={`animate-fade-up ${
              connState === 'connected'
                ? 'bg-gradient-to-br from-google-50 via-surface to-surface'
                : connState === 'approval_pending'
                  ? 'bg-gradient-to-br from-warning-50 via-surface to-surface'
                  : ''
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ${
                    connState === 'connected'
                      ? 'bg-google-100 text-google-700 ring-google-100'
                      : 'bg-subtle text-ink-500 ring-line'
                  }`}
                >
                  <GoogleIcon size={24} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink-950">Google Business Profile</h2>

                  {/* Account and API access reported separately. */}
                  <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2">
                    <div>
                      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
                        Google account
                      </dt>
                      <dd className="mt-1">
                        <StatusPill
                          tone={state.oauthConnected ? 'google' : 'neutral'}
                          pulse={state.oauthConnected}
                        >
                          {state.oauthConnected
                            ? 'Connected'
                            : state.hasRefreshToken
                              ? 'Reconnect needed'
                              : 'Not connected'}
                        </StatusPill>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
                        Business Profile API
                      </dt>
                      <dd className="mt-1">
                        <StatusPill
                          tone={partlyWorking ? 'warning' : meta.tone}
                          pulse={connState === 'connected' && !partlyWorking}
                        >
                          {partlyWorking ? accessLabel(state.access).label : meta.label}
                        </StatusPill>
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-ink-600">
                    {state.apiAccessMessage}
                  </p>
                </div>
              </div>

              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                {oauthReady && state.hasRefreshToken ? (
                  <CheckAccessButton
                    variant={connState === 'connected' ? 'secondary' : 'primary'}
                    className="flex-1 sm:flex-none"
                    onChecked={(access, message) => {
                      setError(null);
                      const healthy = access.status === 'available' && access.degraded.length === 0;
                      setFlash({
                        title: healthy ? 'Done' : 'Checked',
                        text: message,
                        tone: healthy ? 'success' : 'warning',
                      });
                      setCallback({ result: null, reason: null, account: null });
                      void load();
                    }}
                    onError={(message) => {
                      setFlash(null);
                      setError(message);
                      void load();
                    }}
                  />
                ) : null}
                <ButtonLink
                  href="/api/auth/google"
                  external
                  variant={connState === 'connected' || state.oauthConnected ? 'secondary' : 'primary'}
                  disabled={!oauthReady}
                  icon={<GoogleIcon size={17} />}
                  className="flex-1 sm:flex-none"
                >
                  {state.hasRefreshToken ? 'Reconnect' : 'Connect Google'}
                </ButtonLink>
                {state.hasRefreshToken ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void disconnect()}
                    className="flex-1 sm:flex-none"
                  >
                    Disconnect
                  </Button>
                ) : null}
              </div>
            </div>

            {state.lastError ? (
              <div className="mt-4">
                <Callout
                  tone="danger"
                  title={connState === 'rate_limited' ? 'Google is rate limiting' : 'Google reported a problem'}
                  icon={<AlertIcon size={18} />}
                >
                  <p>{state.lastError}</p>
                </Callout>
              </div>
            ) : connState === 'approval_pending' ? (
              <div className="mt-4">
                <Callout tone="warning" title="Waiting for Google" icon={<ClockIcon size={18} />}>
                  <p>
                    Nothing to do here. The integration switches on by itself once Google opens API
                    access, and this page checks again automatically. Already approved? Press{' '}
                    <strong>Check access now</strong>.
                  </p>
                </Callout>
              </div>
            ) : null}

            {partlyWorking && state ? (
              <div className="mt-4">
                <DegradedNotice access={state.access} />
              </div>
            ) : null}

            {state.environmentTokenIgnored ? (
              <p className="mt-4 rounded-xl bg-subtle px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink-600">
                <code className="font-medium text-ink-800">GOOGLE_REFRESH_TOKEN</code> is still set in
                your environment but is ignored because you disconnected. Reconnect to use Google
                again, or remove the variable in Vercel.
              </p>
            ) : null}

            {!oauthReady ? (
              <p className="mt-4 rounded-xl bg-subtle px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink-600">
                Set <code className="font-medium text-ink-800">GOOGLE_CLIENT_ID</code>,{' '}
                <code className="font-medium text-ink-800">GOOGLE_CLIENT_SECRET</code> and{' '}
                <code className="font-medium text-ink-800">GOOGLE_REDIRECT_URI</code> in your
                environment, then redeploy.
              </p>
            ) : null}
          </Card>

          {/* ------------------------ connection facts ------------------- */}
          <Card>
            <SectionHeader
              title="Connection details"
              description="Credentials stay on the server and are never shown here"
              icon={<ShieldIcon size={18} />}
              tone="brand"
            />
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Fact label="Google account" value={state.googleAccountEmail ?? (state.hasRefreshToken ? 'Connected' : 'Not linked')} />
              <Fact label="Business Profile" value={accountLabel ?? 'Not available'} />
              <Fact
                label="Location"
                value={
                  locationLabel ??
                  (connState === 'approval_pending' ? 'Waiting for API access' : 'Not selected')
                }
                hint={
                  state.selectionSource === 'pinned'
                    ? 'Pinned by environment'
                    : state.selectionSource === 'auto'
                      ? 'Detected automatically — choose one below to fix it'
                      : undefined
                }
              />
              <Fact
                label="Last successful sync"
                value={
                  state.access.lastSuccessAt ? relativeTime(state.access.lastSuccessAt) : 'Never'
                }
                hint={state.access.lastSuccessAt ? formatDateTime(state.access.lastSuccessAt) : undefined}
              />
              <Fact
                label="Credential"
                value={
                  state.credentialSource === 'stored'
                    ? 'Saved from Connect Google'
                    : state.credentialSource === 'environment'
                      ? 'GOOGLE_REFRESH_TOKEN (environment)'
                      : 'None'
                }
                hint={state.connectedAt ? `Connected ${formatDateTime(state.connectedAt)}` : undefined}
              />
            </dl>

            <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-subtle px-3.5 py-3">
              <LockIcon size={17} className="shrink-0 text-ink-400" />
              <p className="text-[0.8125rem] leading-relaxed text-ink-600">
                Your refresh token is stored server-side and never sent to this page.
              </p>
            </div>
          </Card>

          {/* ----------------------------- API status -------------------- */}
          {state.hasRefreshToken ? (
            <Card>
              <SectionHeader
                title="Google APIs"
                description="Each Business Profile API is checked on its own"
                icon={<ShieldIcon size={18} />}
                tone="google"
                action={
                  <Badge tone={accessLabel(state.access).tone as Tone} dot>
                    {accessLabel(state.access).label}
                  </Badge>
                }
              />
              <AccessServiceList access={state.access} />
              {state.access.checkedAt ? (
                <p className="mt-3 border-t border-line pt-3 text-xs text-ink-400">
                  Last checked {relativeTime(state.access.checkedAt)}
                </p>
              ) : null}
            </Card>
          ) : null}

          {/* --------------------------- locations ----------------------- */}
          <Card>
            <SectionHeader
              title="Locations"
              description="Choose which location this dashboard manages"
              icon={<PinIcon size={18} />}
              tone="google"
              action={
                settings?.config.pinnedLocation ? <Badge tone="neutral">Pinned by env</Badge> : undefined
              }
            />
            {state.discovery.error && state.locations.length > 0 ? (
              <p className="mb-3 rounded-xl bg-warning-50 px-3.5 py-2.5 text-xs leading-relaxed text-warning-700">
                Showing the last known list — Google could not refresh it just now.
              </p>
            ) : null}
            {state.locations.length === 0 ? (
              <EmptyState
                icon={<PinIcon size={22} />}
                tone="google"
                compact
                title="No locations to show yet"
                description={
                  connState === 'approval_pending'
                    ? 'Waiting for API access. Your locations will list here automatically as soon as Google approves this project — no action needed.'
                    : state.discovery.error
                      ? `Google could not list your locations: ${state.discovery.error}`
                      : state.hasRefreshToken
                        ? 'Press Check access now. If Google reports no locations, this account does not manage a Business Profile.'
                        : 'Connect the Google account that manages your Business Profile and your locations will appear here.'
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {state.locations.map((location) => {
                  const active = state.selectedLocation === location.name;
                  return (
                    <li key={location.name} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          active ? 'bg-google-50 text-google-700' : 'bg-subtle text-ink-400'
                        }`}
                      >
                        <PinIcon size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-950">{location.title}</p>
                        <p className="truncate text-xs text-ink-500">
                          {location.primaryPhone ?? location.name}
                        </p>
                      </div>
                      {active ? (
                        <Badge tone="google" dot>
                          Selected
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy || state.selectionSource === 'pinned'}
                          onClick={() => void select('selectedLocation', location.name)}
                        >
                          Use this
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* --------------------------- accounts ------------------------ */}
          {state.accounts.length > 1 ? (
            <Card>
              <SectionHeader
                title="Business Profile accounts"
                description="Accounts the connected Google user can manage"
                icon={<SettingsIcon size={18} />}
              />
              <ul className="divide-y divide-line">
                {state.accounts.map((account) => (
                  <li key={account.name} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-950">{account.accountName}</p>
                      <p className="truncate text-xs text-ink-500">{account.name}</p>
                    </div>
                    {state.selectedAccount === account.name ? (
                      <Badge tone="brand" dot>
                        Selected
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void select('selectedAccount', account.name)}
                      >
                        Use this
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium text-ink-900" title={value}>
        {value}
      </dd>
      {hint ? <p className="mt-0.5 break-words text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

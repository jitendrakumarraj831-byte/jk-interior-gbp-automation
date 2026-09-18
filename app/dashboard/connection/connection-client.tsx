'use client';

/**
 * Google connection.
 *
 * Six honest states: not connected, connecting, connected, approval pending,
 * configuration required, connection error. Each gets its own copy and its own
 * next step. No token or secret value is ever rendered — only booleans and
 * Google resource names.
 */

import { useCallback, useEffect, useState } from 'react';

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
import type { ConnectionState } from '@/lib/types';

type SettingsPayload = {
  config: { oauthConfigured: boolean; googleConfigured: boolean; pinnedLocation: boolean };
};

type ConnState =
  | 'not_connected'
  | 'configuration_required'
  | 'connected'
  | 'approval_pending'
  | 'connection_error';

const STATE_META: Record<ConnState, { label: string; tone: Tone }> = {
  connected: { label: 'Connected', tone: 'google' },
  approval_pending: { label: 'Approval pending', tone: 'warning' },
  configuration_required: { label: 'Configuration required', tone: 'neutral' },
  connection_error: { label: 'Connection error', tone: 'danger' },
  not_connected: { label: 'Not connected', tone: 'neutral' },
};

function resolveState(state: ConnectionState, oauthReady: boolean): ConnState {
  if (!oauthReady) return 'configuration_required';
  if (state.connected) return 'connected';
  if (state.lastError) {
    return state.lastError.toLowerCase().includes('approval pending')
      ? 'approval_pending'
      : 'connection_error';
  }
  return 'not_connected';
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
  const [state, setState] = useState<ConnectionState | null>(null);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [connection, config] = await Promise.all([
        api.get<ConnectionState>('/api/accounts'),
        api.get<SettingsPayload>('/api/settings'),
      ]);
      setState(connection.data);
      setSettings(config.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the connection state.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  async function select(kind: 'selectedAccount' | 'selectedLocation', value: string) {
    setBusy(true);
    try {
      await api.patch('/api/settings', { [kind]: value });
      await load();
      setFlash('Selection saved.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save that selection.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const response = await api.post<{ disconnected: boolean }>('/api/auth/google/disconnect');
      setFlash(response.message);
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
  const selectedLocation = state?.locations.find((l) => l.name === state.selectedLocation);

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

      {connectResult === 'success' ? (
        <div className="mb-4">
          <Callout tone="success" title="Google account connected" icon={<CheckCircleIcon size={18} />}>
            <p>
              {connectedAccount
                ? `Connected as ${connectedAccount}.`
                : 'Your credentials are stored securely on the server.'}
            </p>
          </Callout>
        </div>
      ) : null}

      {connectResult === 'error' ? (
        <div className="mb-4">
          <Callout tone="danger" title="Connection did not complete" icon={<AlertIcon size={18} />}>
            <p>{connectReason ?? 'Google did not complete the authorization.'}</p>
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
          <Callout tone="success" title="Saved" icon={<CheckCircleIcon size={18} />}>
            <p>{flash}</p>
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
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-ink-950">Google Business Profile</h2>
                    <StatusPill tone={meta.tone} pulse={connState === 'connected'}>
                      {meta.label}
                    </StatusPill>
                  </div>
                  <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-ink-600">
                    {connState === 'connected'
                      ? 'Reviews, posts and performance are syncing from your profile.'
                      : connState === 'approval_pending'
                        ? 'Your credentials are stored and valid. Google has not yet approved API access for this project.'
                        : connState === 'configuration_required'
                          ? 'Add your Google OAuth credentials to the environment, then redeploy before connecting.'
                          : connState === 'connection_error'
                            ? 'We reached Google but the request was refused. The details are below.'
                            : 'No Google account is linked yet.'}
                  </p>
                </div>
              </div>

              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <ButtonLink
                  href="/api/auth/google"
                  external
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
                  tone={connState === 'approval_pending' ? 'warning' : 'danger'}
                  title={
                    connState === 'approval_pending'
                      ? 'Google Business Profile API approval pending'
                      : 'Google returned an error'
                  }
                  icon={
                    connState === 'approval_pending' ? <ClockIcon size={18} /> : <AlertIcon size={18} />
                  }
                >
                  <p>{state.lastError}</p>
                  {connState === 'approval_pending' ? (
                    <p className="mt-2 text-ink-500">
                      Nothing more to do here — the integration activates itself once Google
                      approves your project.
                    </p>
                  ) : null}
                </Callout>
              </div>
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
              <Fact label="Google account" value={state.googleAccountEmail ?? 'Not linked'} />
              <Fact
                label="Business Profile"
                value={
                  state.accounts.find((a) => a.name === state.selectedAccount)?.accountName ??
                  (state.accounts[0]?.accountName || 'Not available')
                }
              />
              <Fact label="Location" value={selectedLocation?.title ?? 'Not selected'} />
              <Fact
                label="Last sync"
                value={state.connectedAt ? relativeTime(state.connectedAt) : 'Never'}
                hint={state.connectedAt ? formatDateTime(state.connectedAt) : undefined}
              />
            </dl>

            <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-subtle px-3.5 py-3">
              <LockIcon size={17} className="shrink-0 text-ink-400" />
              <p className="text-[0.8125rem] leading-relaxed text-ink-600">
                Your refresh token is stored server-side and never sent to this page.
              </p>
            </div>
          </Card>

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
            {state.locations.length === 0 ? (
              <EmptyState
                icon={<PinIcon size={22} />}
                tone="google"
                compact
                title="No locations available yet"
                description={
                  connState === 'approval_pending'
                    ? 'Your locations will list here as soon as Google approves API access for this project.'
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
                          disabled={busy}
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
      {hint ? <p className="mt-0.5 truncate text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

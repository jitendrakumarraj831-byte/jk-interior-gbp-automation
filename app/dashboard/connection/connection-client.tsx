'use client';

/**
 * Google connection.
 *
 * Shows whether an account is linked, which Business Profile accounts and
 * locations it can manage, and what is still missing. No token or secret value
 * is ever rendered here — only booleans and Google resource names.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, formatDateTime } from '@/lib/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingCard,
  PageHeading,
} from '@/components/ui';
import type { ConnectionState } from '@/lib/types';

type SettingsPayload = {
  settings: { selectedAccount?: string; selectedLocation?: string };
  config: { oauthConfigured: boolean; googleConfigured: boolean; pinnedLocation: boolean };
  warnings: string[];
};

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

  // `loading` starts as true, so the initial run needs no synchronous state
  // update — that is what keeps the effect below free of cascading renders.
  // Manual refreshes go through this wrapper instead.
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
      setError(caught instanceof ApiError ? caught.message : 'Could not save the selection.');
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

  return (
    <>
      <PageHeading
        title="Google Connection"
        description="Link the Google account that manages the JK Interior Business Profile"
        action={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        }
      />

      {connectResult === 'success' ? (
        <div className="mb-4">
          <Alert tone="ok" title="Google account connected">
            <p>
              {connectedAccount
                ? `Connected as ${connectedAccount}.`
                : 'The refresh token has been stored server-side.'}
            </p>
          </Alert>
        </div>
      ) : null}

      {connectResult === 'error' ? (
        <div className="mb-4">
          <Alert tone="danger" title="Connection failed">
            <p>{connectReason ?? 'Google did not complete the authorization.'}</p>
          </Alert>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <Alert tone="danger" title="Problem">
            <p>{error}</p>
          </Alert>
        </div>
      ) : null}
      {flash ? (
        <div className="mb-4">
          <Alert tone="ok" title="Done">
            <p>{flash}</p>
          </Alert>
        </div>
      ) : null}

      {loading && !state ? <LoadingCard lines={3} /> : null}

      {state ? (
        <>
          <Card className="mb-4">
            <CardHeader
              title="Status"
              action={
                <Badge tone={state.connected ? 'ok' : state.hasRefreshToken ? 'warn' : 'neutral'}>
                  {state.connected
                    ? 'Connected'
                    : state.hasRefreshToken
                      ? 'Token stored, API unavailable'
                      : 'Not connected'}
                </Badge>
              }
            />

            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  OAuth client
                </dt>
                <dd className="mt-1 text-sm text-ink-900">
                  {oauthReady ? 'Configured' : 'Missing GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Refresh token
                </dt>
                <dd className="mt-1 text-sm text-ink-900">
                  {state.hasRefreshToken ? 'Stored (never displayed)' : 'Not set'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Google account
                </dt>
                <dd className="mt-1 truncate text-sm text-ink-900">
                  {state.googleAccountEmail ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Connected at
                </dt>
                <dd className="mt-1 text-sm text-ink-900">{formatDateTime(state.connectedAt)}</dd>
              </div>
            </dl>

            {state.lastError ? (
              <div className="mt-4">
                <Alert
                  tone={state.lastError.toLowerCase().includes('approval pending') ? 'warn' : 'danger'}
                  title={
                    state.lastError.toLowerCase().includes('approval pending')
                      ? 'Google Business Profile API approval pending'
                      : 'Google returned an error'
                  }
                >
                  <p>{state.lastError}</p>
                </Alert>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href="/api/auth/google"
                className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  oauthReady
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'pointer-events-none bg-brand-600/40 text-white'
                }`}
                aria-disabled={!oauthReady}
              >
                {state.hasRefreshToken ? 'Reconnect Google' : 'Connect Google'}
              </a>
              {state.hasRefreshToken ? (
                <Button variant="danger" disabled={busy} onClick={() => void disconnect()}>
                  Disconnect
                </Button>
              ) : null}
            </div>

            {!oauthReady ? (
              <p className="mt-3 text-xs text-ink-500">
                Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in your
                environment, then redeploy, before connecting.
              </p>
            ) : null}
          </Card>

          <Card className="mb-4">
            <CardHeader
              title="Business Profile accounts"
              description="Accounts the connected Google user can manage"
            />
            {state.accounts.length === 0 ? (
              <EmptyState
                title="No accounts available"
                description="They appear once the Google account is connected and the API is reachable."
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {state.accounts.map((account) => (
                  <li key={account.name} className="flex flex-wrap items-center gap-2 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {account.accountName}
                      </p>
                      <p className="truncate text-xs text-ink-500">{account.name}</p>
                    </div>
                    {state.selectedAccount === account.name ? (
                      <Badge tone="brand">Selected</Badge>
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
            )}
          </Card>

          <Card>
            <CardHeader title="Locations" description="Pick the location this dashboard manages" />
            {state.locations.length === 0 ? (
              <EmptyState title="No locations available" />
            ) : (
              <ul className="divide-y divide-hairline">
                {state.locations.map((location) => (
                  <li key={location.name} className="flex flex-wrap items-center gap-2 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{location.title}</p>
                      <p className="truncate text-xs text-ink-500">
                        {location.name}
                        {location.primaryPhone ? ` · ${location.primaryPhone}` : ''}
                      </p>
                    </div>
                    {state.selectedLocation === location.name ? (
                      <Badge tone="brand">Selected</Badge>
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
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}

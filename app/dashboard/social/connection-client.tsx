'use client';

/**
 * Meta (Facebook Page + Instagram Professional) connection.
 *
 * Mirrors app/dashboard/connection/connection-client.tsx: honest states, no
 * token ever rendered, Facebook and Instagram reported as two separate facts
 * because a Page can be connected with no Instagram account linked to it.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, relativeTime } from '@/lib/client';
import {
  AlertIcon,
  CheckCircleIcon,
  FacebookIcon,
  InstagramIcon,
  LockIcon,
  RefreshIcon,
  ShieldIcon,
  SocialIcon,
} from '@/components/icons';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  PageHeader,
  SectionHeader,
  SkeletonCard,
  StatusPill,
  type Tone,
} from '@/components/ui';
import type { MetaConnectionState } from '@/lib/social/types';

type StatusPayload = {
  connection: MetaConnectionState;
  config: { oauthConfigured: boolean; encryptionConfigured: boolean; metaConfigured: boolean };
};

export default function SocialConnectionClient({
  connectResult,
  connectReason,
  connectedPage,
}: {
  connectResult: string | null;
  connectReason: string | null;
  connectedPage: string | null;
}) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get<StatusPayload>('/api/meta/status');
      setStatus(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the Meta connection state.');
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

  async function disconnect() {
    setBusy(true);
    try {
      const response = await api.post<{ disconnected: boolean }>('/api/auth/meta/disconnect');
      setFlash(response.message);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  const config = status?.config;
  const connection = status?.connection;
  const oauthReady = config?.oauthConfigured ?? false;
  const metaReady = config?.metaConfigured ?? false;

  return (
    <>
      <PageHeader
        eyebrow="Integration"
        title="Social Automation"
        description="Connect the Facebook Page and Instagram Professional account for JK Interior."
        action={
          <Button variant="secondary" onClick={refresh} loading={loading} icon={<RefreshIcon size={16} />}>
            Refresh
          </Button>
        }
      />

      {connectResult === 'success' ? (
        <div className="mb-4">
          <Callout tone="success" title="Meta connected" icon={<CheckCircleIcon size={18} />}>
            <p>
              {connectedPage
                ? `Connected Facebook Page "${connectedPage}".`
                : 'Your Page access token is stored encrypted on the server.'}
            </p>
          </Callout>
        </div>
      ) : null}

      {connectResult === 'error' ? (
        <div className="mb-4">
          <Callout tone="danger" title="Connection did not complete" icon={<AlertIcon size={18} />}>
            <p>{connectReason ?? 'Meta did not complete the authorization.'}</p>
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

      {loading && !status ? <SkeletonCard lines={4} /> : null}

      {status ? (
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-subtle text-ink-500 ring-1 ring-inset ring-line">
                  <SocialIcon size={24} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink-950">Meta connection</h2>
                  <p className="mt-1 max-w-lg text-sm leading-relaxed text-ink-600">
                    One connection covers both Facebook and Instagram — Instagram publishing uses the
                    Instagram Professional account linked to this Facebook Page.
                  </p>
                </div>
              </div>

              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <ButtonLink
                  href="/api/auth/meta"
                  external
                  disabled={!metaReady}
                  icon={<SocialIcon size={17} />}
                  className="flex-1 sm:flex-none"
                >
                  {connection?.connected ? 'Reconnect' : 'Connect Meta'}
                </ButtonLink>
                {connection?.connected ? (
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

            {connection?.lastError ? (
              <div className="mt-4">
                <Callout tone="danger" title="Meta returned an error" icon={<AlertIcon size={18} />}>
                  <p>{connection.lastError}</p>
                </Callout>
              </div>
            ) : null}

            {!oauthReady ? (
              <p className="mt-4 rounded-xl bg-subtle px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink-600">
                Set <code className="font-medium text-ink-800">META_APP_ID</code>,{' '}
                <code className="font-medium text-ink-800">META_APP_SECRET</code> and{' '}
                <code className="font-medium text-ink-800">META_REDIRECT_URI</code> in your environment,
                then redeploy.
              </p>
            ) : null}
            {oauthReady && !config?.encryptionConfigured ? (
              <p className="mt-4 rounded-xl bg-warning-50 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-warning-800">
                Set <code className="font-medium">META_ENCRYPTION_KEY</code> (a 32-byte base64 key) before
                connecting — Meta tokens are never stored unencrypted.
              </p>
            ) : null}
          </Card>

          <div className="grid gap-5 sm:grid-cols-2">
            <PlatformCard
              icon={<FacebookIcon size={20} />}
              tone="info"
              title="Facebook"
              connected={connection?.facebook.connected ?? false}
              rows={[
                { label: 'Page name', value: connection?.facebook.pageName ?? '—' },
                { label: 'Page ID', value: connection?.facebook.pageId ?? '—' },
              ]}
            />
            <PlatformCard
              icon={<InstagramIcon size={20} />}
              tone="ai"
              title="Instagram"
              connected={connection?.instagram.connected ?? false}
              rows={[
                { label: 'Professional account', value: connection?.instagram.name ?? connection?.instagram.username ?? '—' },
                { label: 'Account ID', value: connection?.instagram.igUserId ?? '—' },
              ]}
              note={
                connection?.facebook.connected && !connection.instagram.connected
                  ? 'No Instagram Professional account is linked to this Facebook Page yet — link one in Meta Business Suite, then reconnect.'
                  : undefined
              }
            />
          </div>

          <Card>
            <SectionHeader
              title="Connection details"
              description="Credentials stay on the server and are never shown here"
              icon={<ShieldIcon size={18} />}
              tone="brand"
            />
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Fact
                label="Connected"
                value={connection?.connectedAt ? relativeTime(connection.connectedAt) : 'Never'}
              />
              <Fact
                label="Last sync"
                value={connection?.lastSyncAt ? relativeTime(connection.lastSyncAt) : 'Never'}
              />
            </dl>
            <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-subtle px-3.5 py-3">
              <LockIcon size={17} className="shrink-0 text-ink-400" />
              <p className="text-[0.8125rem] leading-relaxed text-ink-600">
                The Page access token is encrypted (AES-256-GCM) and stored server-side. It is never sent
                to this page.
              </p>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function PlatformCard({
  icon,
  tone,
  title,
  connected,
  rows,
  note,
}: {
  icon: React.ReactNode;
  tone: Tone;
  title: string;
  connected: boolean;
  rows: { label: string; value: string }[];
  note?: string;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-subtle text-ink-600">
            {icon}
          </span>
          <h3 className="text-sm font-semibold text-ink-950">{title}</h3>
        </div>
        <StatusPill tone={connected ? tone : 'neutral'} pulse={connected}>
          {connected ? 'Connected' : 'Not connected'}
        </StatusPill>
      </div>
      <dl className="mt-4 space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-ink-500">{row.label}</dt>
            <dd className="truncate font-medium text-ink-900" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {note ? (
        <p className="mt-3 rounded-lg bg-subtle px-3 py-2 text-xs leading-relaxed text-ink-600">{note}</p>
      ) : null}
      {!connected ? (
        <div className="mt-3">
          <Badge tone="neutral">
            {title === 'Instagram' ? 'Linked automatically via the Page' : 'Connect via Meta'}
          </Badge>
        </div>
      ) : null}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-ink-900" title={value}>
        {value}
      </dd>
    </div>
  );
}

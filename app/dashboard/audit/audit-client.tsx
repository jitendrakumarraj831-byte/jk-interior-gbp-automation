'use client';

/**
 * Audit log.
 *
 * Read-only. Entries are written by the actions themselves (see lib/audit.ts)
 * — this page just lists what already happened. `actor` is a non-reversible
 * hash of the admin session or "cron"; never a token, password or secret.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, formatDateTime } from '@/lib/client';
import { InboxIcon, RefreshIcon } from '@/components/icons';
import { Badge, Callout, Card, EmptyState, PageHeader, SkeletonCard } from '@/components/ui';
import type { AuditLogEntry } from '@/lib/types';

const ACTION_LABEL: Record<string, string> = {
  review_draft_generated: 'Review draft generated',
  review_draft_approved: 'Review draft approved',
  review_draft_unapproved: 'Review draft unapproved',
  review_draft_discarded: 'Review draft discarded',
  review_reply_published: 'Review reply published',
  post_created: 'Post created',
  post_scheduled: 'Post scheduled',
  post_updated: 'Post updated',
  post_deleted: 'Post deleted',
  post_published: 'Post published',
  automation_executed: 'Automation executed',
  settings_updated: 'Settings updated',
  google_connected: 'Google account connected',
  google_disconnected: 'Google account disconnected',
};

export default function AuditClient() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<{ entries: AuditLogEntry[] }>('/api/audit');
      setEntries(response.data?.entries ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        eyebrow="Accountability"
        title="Audit Log"
        description="Every reply, post and automation run this dashboard has taken action on."
        action={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="press flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink-700 hover:bg-subtle disabled:opacity-60"
          >
            <RefreshIcon size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Callout tone="danger" title="Could not load the audit log">
            <p>{error}</p>
          </Callout>
        </div>
      ) : null}

      {loading && !entries ? (
        <SkeletonCard lines={6} />
      ) : !entries || entries.length === 0 ? (
        <EmptyState
          icon={<InboxIcon size={22} />}
          tone="neutral"
          title="No activity recorded yet"
          description="Entries appear here as drafts are approved, posts are published, and automation runs."
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink-900">
                      {ACTION_LABEL[entry.action] ?? entry.action}
                    </p>
                    <Badge tone={entry.status === 'success' ? 'success' : 'danger'}>
                      {entry.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[0.8125rem] text-ink-500">
                    {entry.resource} · {entry.actor} · {entry.source}
                    {entry.detail ? ` · ${entry.detail}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-ink-400">{formatDateTime(entry.timestamp)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/**
 * Audit log.
 *
 * Every destructive or externally visible action — a draft generated or
 * approved, a reply published, a post created/scheduled/published, an
 * automation run — is recorded here. Never the payload, never a secret: the
 * actor is a non-reversible hash of the admin session, and `detail` is only
 * ever a short human summary already safe to show in the dashboard.
 *
 * Persisted through the shared store, same pattern as lib/repository.ts.
 */

import { createHmac, randomUUID } from 'node:crypto';

import { env } from './config';
import { ADMIN_COOKIE, readCookie } from './security';
import { getStore, nsKey, readCollection } from './store';
import type { AuditAction, AuditLogEntry, AuditStatus } from './types';

const PREFIX = nsKey('audit', '');

function key(id: string): string {
  return `${PREFIX}${id}`;
}

/**
 * Stable, non-reversible id for the admin session making a request — never
 * the session token itself. Falls back to a fixed label when there is no
 * session (e.g. local development without admin auth configured).
 */
export function actorFromRequest(request: Request): string {
  const token = readCookie(request, ADMIN_COOKIE);
  if (!token) return 'admin';
  const digest = createHmac('sha256', env().SESSION_SECRET || 'audit')
    .update(token)
    .digest('hex')
    .slice(0, 12);
  return `admin:${digest}`;
}

export async function listAudit(limit = 200): Promise<AuditLogEntry[]> {
  try {
    const items = await readCollection<AuditLogEntry>(PREFIX);
    return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  } catch {
    return [];
  }
}

export async function recordAudit(input: {
  actor: string;
  action: AuditAction;
  resource: string;
  status: AuditStatus;
  source: 'dashboard' | 'cron';
  detail?: string;
}): Promise<void> {
  try {
    const entry: AuditLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...input,
    };
    await getStore().set(key(entry.id), entry);
  } catch {
    // Audit logging is best-effort — it must never fail the action it is
    // recording.
  }
}

/**
 * Notification Center.
 *
 * Persisted through the shared store (durable with Upstash, in-memory
 * otherwise — no second database), same as everything else in lib/repository.ts.
 *
 * Every notification carries a `dedupeKey`. Creating one twice with the same
 * key is a no-op, which is what stops cron re-runs (or a dashboard sync
 * racing a cron run) from posting the same event twice — see Part 21 of the
 * upgrade brief ("duplicate notifications").
 */

import { createHmac, randomUUID } from 'node:crypto';

import { getStore, nsKey, readCollection } from './store';
import type { AppNotification, NotificationCategory } from './types';

const PREFIX = nsKey('notification', '');
const DEDUPE_PREFIX = nsKey('notification-dedupe', '');

function key(id: string): string {
  return `${PREFIX}${id}`;
}

/** A short, non-reversible index key so the raw dedupe string is never stored. */
function dedupeKeyOf(dedupeKey: string): string {
  return `${DEDUPE_PREFIX}${createHmac('sha256', 'notify').update(dedupeKey).digest('hex').slice(0, 32)}`;
}

export async function listNotifications(): Promise<AppNotification[]> {
  try {
    const items = await readCollection<AppNotification>(PREFIX);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    // Diagnostic surface only — a store outage must never break the dashboard.
    return [];
  }
}

export async function unreadCount(): Promise<number> {
  const items = await listNotifications();
  return items.filter((n) => !n.read).length;
}

/**
 * Creates a notification unless one with the same `dedupeKey` already exists.
 * Returns null both on a duplicate and on a store failure — callers treat
 * notifying as best-effort, never something that should fail the caller.
 */
export async function notify(input: {
  category: NotificationCategory;
  title: string;
  message: string;
  href?: string;
  dedupeKey: string;
}): Promise<AppNotification | null> {
  try {
    const store = getStore();
    const indexKey = dedupeKeyOf(input.dedupeKey);
    const existingId = await store.get<string>(indexKey);
    if (existingId) return null;

    const notification: AppNotification = {
      id: randomUUID(),
      category: input.category,
      title: input.title,
      message: input.message,
      href: input.href,
      dedupeKey: input.dedupeKey,
      read: false,
      createdAt: new Date().toISOString(),
    };
    await store.set(key(notification.id), notification);
    await store.set(indexKey, notification.id);
    return notification;
  } catch {
    return null;
  }
}

export async function markRead(id: string): Promise<void> {
  try {
    const store = getStore();
    const existing = await store.get<AppNotification>(key(id));
    if (!existing || existing.read) return;
    await store.set(key(id), { ...existing, read: true, readAt: new Date().toISOString() });
  } catch {
    /* best effort */
  }
}

/** Returns how many notifications were newly marked read. */
export async function markAllRead(): Promise<number> {
  const items = await listNotifications();
  const unread = items.filter((n) => !n.read);
  await Promise.all(unread.map((n) => markRead(n.id)));
  return unread.length;
}

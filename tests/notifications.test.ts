/**
 * Notification Center: creation, read state, and duplicate protection.
 *
 * Duplicate protection matters here specifically — Part 21 of the upgrade
 * brief calls out "duplicate notifications" as something to prevent, and cron
 * re-running the same sync (or a manual sync racing a scheduled one) is
 * exactly the scenario that would otherwise double-post the same event.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadNotifications() {
  vi.resetModules();
  return import('@/lib/notifications');
}

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe('creating notifications', () => {
  it('stores the fields passed in, unread by default', async () => {
    const { notify, listNotifications } = await loadNotifications();
    const created = await notify({
      category: 'new_review',
      title: 'New Google review',
      message: 'Someone left a 5★ review.',
      href: '/dashboard/reviews',
      dedupeKey: 'review:abc',
    });

    expect(created).not.toBeNull();
    expect(created?.read).toBe(false);
    expect(created?.category).toBe('new_review');

    const list = await listNotifications();
    expect(list).toHaveLength(1);
    expect(list[0]?.dedupeKey).toBe('review:abc');
  });

  it('never creates a second notification for the same dedupeKey', async () => {
    const { notify, listNotifications } = await loadNotifications();
    const input = {
      category: 'ai_draft_ready' as const,
      title: 'AI reply draft ready',
      message: 'A draft is ready.',
      dedupeKey: 'draft-ready:xyz',
    };

    const first = await notify(input);
    const second = await notify(input);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await listNotifications()).toHaveLength(1);
  });

  it('distinct dedupeKeys create distinct notifications', async () => {
    const { notify, listNotifications } = await loadNotifications();
    await notify({ category: 'post_published', title: 'a', message: 'a', dedupeKey: 'post-published:1' });
    await notify({ category: 'post_published', title: 'b', message: 'b', dedupeKey: 'post-published:2' });
    expect(await listNotifications()).toHaveLength(2);
  });

  it('newest notification sorts first', async () => {
    const { notify, listNotifications } = await loadNotifications();
    await notify({ category: 'post_published', title: 'first', message: '', dedupeKey: 'k1' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await notify({ category: 'post_published', title: 'second', message: '', dedupeKey: 'k2' });

    const list = await listNotifications();
    expect(list[0]?.title).toBe('second');
  });
});

describe('read state', () => {
  it('unreadCount reflects only unread notifications', async () => {
    const { notify, markRead, unreadCount } = await loadNotifications();
    const a = await notify({ category: 'new_review', title: 'a', message: '', dedupeKey: 'a' });
    await notify({ category: 'new_review', title: 'b', message: '', dedupeKey: 'b' });

    expect(await unreadCount()).toBe(2);
    await markRead(a!.id);
    expect(await unreadCount()).toBe(1);
  });

  it('markRead is idempotent and ignores an unknown id', async () => {
    const { notify, markRead, unreadCount } = await loadNotifications();
    const a = await notify({ category: 'new_review', title: 'a', message: '', dedupeKey: 'a' });
    await markRead(a!.id);
    await markRead(a!.id);
    await markRead('does-not-exist');
    expect(await unreadCount()).toBe(0);
  });

  it('markAllRead marks every unread notification and reports how many', async () => {
    const { notify, markRead, markAllRead, unreadCount } = await loadNotifications();
    const a = await notify({ category: 'new_review', title: 'a', message: '', dedupeKey: 'a' });
    await notify({ category: 'new_review', title: 'b', message: '', dedupeKey: 'b' });
    await notify({ category: 'new_review', title: 'c', message: '', dedupeKey: 'c' });
    await markRead(a!.id);

    const marked = await markAllRead();
    expect(marked).toBe(2); // only the two that were still unread
    expect(await unreadCount()).toBe(0);
  });
});

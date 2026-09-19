/**
 * Notification Center.
 *
 *   GET   list notifications + unread count
 *   PATCH mark one notification read ({ id }) or every notification read ({ all: true })
 */

import { z } from 'zod';

import { listNotifications, markAllRead, markRead, unreadCount } from '@/lib/notifications';
import { assertAdmin, handleRoute, ok, parseJson } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const patchSchema = z.union([
  z.object({ id: z.string().trim().min(1).max(100) }),
  z.object({ all: z.literal(true) }),
]);

export async function GET(request: Request) {
  return handleRoute('notifications', async () => {
    assertAdmin(request);
    const [notifications, unread] = await Promise.all([listNotifications(), unreadCount()]);
    return ok({ notifications, unread });
  });
}

export async function PATCH(request: Request) {
  return handleRoute('notifications', async () => {
    assertAdmin(request);
    const body = await parseJson(request, patchSchema);

    if ('all' in body) {
      const marked = await markAllRead();
      return ok({ marked }, `Marked ${marked} notification(s) read.`);
    }

    await markRead(body.id);
    return ok({ marked: 1 }, 'Notification marked read.');
  });
}

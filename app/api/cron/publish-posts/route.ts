/**
 * Publishes Business Profile posts whose scheduled time has passed.
 * Scheduled in vercel.json. Protected by CRON_SECRET.
 */

import { cronRoute } from '@/lib/cron';
import { publishScheduledPosts } from '@/lib/tasks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const handler = cronRoute('cron/publish-posts', async () => [await publishScheduledPosts()]);

export const GET = handler;
export const POST = handler;

/** Publishes due, approved, scheduled social posts. See lib/social/tasks.ts. */

import { cronRoute } from '@/lib/cron';
import { publishScheduledSocialPosts } from '@/lib/social/tasks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const handler = cronRoute('cron/publish-social', async () => [await publishScheduledSocialPosts()]);

export const GET = handler;
export const POST = handler;

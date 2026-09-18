/** Single task: refresh reviews from Google. Protected by CRON_SECRET. */

import { cronRoute } from '@/lib/cron';
import { syncReviews } from '@/lib/tasks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const handler = cronRoute('cron/sync-reviews', async () => [await syncReviews()]);

export const GET = handler;
export const POST = handler;

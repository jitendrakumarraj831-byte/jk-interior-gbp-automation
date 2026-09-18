/** Single task: refresh the performance snapshot. Protected by CRON_SECRET. */

import { cronRoute } from '@/lib/cron';
import { syncPerformance } from '@/lib/tasks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const handler = cronRoute('cron/sync-performance', async () => [await syncPerformance()]);

export const GET = handler;
export const POST = handler;

/** Drafts one AI social post per day from the weekly plan. Never publishes. */

import { cronRoute } from '@/lib/cron';
import { generateDailySocialContent } from '@/lib/social/tasks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const handler = cronRoute('cron/generate-social-content', async () => [await generateDailySocialContent()]);

export const GET = handler;
export const POST = handler;

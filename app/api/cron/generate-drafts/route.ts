/** Single task: draft AI replies for unanswered reviews. Protected by CRON_SECRET. */

import { cronRoute } from '@/lib/cron';
import { generateDrafts } from '@/lib/tasks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const handler = cronRoute('cron/generate-drafts', async () => [await generateDrafts()]);

export const GET = handler;
export const POST = handler;

/**
 * Daily maintenance cron.
 *
 * Pulls reviews, drafts replies for anything unanswered and refreshes the
 * performance snapshot. Each task records its own AutomationRun, and one
 * failing task never stops the others.
 *
 * Scheduled in vercel.json. Protected by CRON_SECRET.
 */

import { cronRoute } from '@/lib/cron';
import { generateDrafts, publishApprovedReplies, syncPerformance, syncReviews } from '@/lib/tasks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const handler = cronRoute('cron/sync', async () => [
  await syncReviews(),
  await generateDrafts(),
  // No-op unless auto-publishing has been deliberately switched on.
  await publishApprovedReplies(),
  await syncPerformance(),
]);

export const GET = handler;
export const POST = handler;

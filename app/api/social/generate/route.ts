/**
 * AI Content Studio — generates draft copy only. Nothing is persisted or
 * published here; POST /api/social/posts (Phase C) saves a draft the admin
 * chooses to keep.
 */

import { z } from 'zod';

import { assertAdmin, handleRoute, ok, parseJson } from '@/lib/security';
import { generateSocialContent } from '@/lib/social/content-studio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTENT_TYPES = [
  'gypsum_false_ceiling',
  'pvc_ceiling',
  'wpc_louvers',
  'wpc_fluted_panel',
  'uv_marble_sheet',
  'tv_unit',
  'wall_paneling',
  'partition',
  'interior_project',
  'before_after',
  'customer_project',
  'interior_tip',
  'offer',
  'festival',
  'faq',
  'local_business_promotion',
] as const;

const generateSchema = z.object({
  contentType: z.enum(CONTENT_TYPES),
  platforms: z.enum(['facebook', 'instagram', 'both']),
  language: z.enum(['en', 'hi', 'hinglish']),
  topic: z.string().trim().max(500).optional(),
  campaign: z.string().trim().max(100).optional(),
});

export async function POST(request: Request) {
  return handleRoute('social/generate', async () => {
    assertAdmin(request);
    const input = await parseJson(request, generateSchema);
    const generated = await generateSocialContent(input);
    return ok({ generated });
  });
}

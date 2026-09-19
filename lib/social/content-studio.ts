/**
 * AI Content Studio — drafts Facebook/Instagram post copy.
 *
 * Reuses the existing multi-provider AI router (lib/ai/router.ts) exactly the
 * way lib/ai-reply.ts does; this module only owns the prompt. It asks the
 * model for strict JSON so Facebook and Instagram can get genuinely different
 * copy from one call, instead of the same caption pasted onto both platforms.
 *
 * Same non-negotiable rule as review replies: never invent a fact. Reviews,
 * awards, certifications, prices and specific past projects are named here
 * only when the caller supplies them — the prompt explicitly forbids the
 * model from inventing its own.
 */

import { generate } from '../ai/router';
import type { ProviderName } from '../ai/types';
import { BUSINESS, SERVICES } from '../config';
import { AppError } from '../errors';
import type {
  PlatformContent,
  SocialContentType,
  SocialLanguage,
  SocialPlatformTarget,
} from './types';

const CONTENT_TYPE_GUIDANCE: Record<SocialContentType, string> = {
  gypsum_false_ceiling: 'Gypsum false ceiling work — clean lines, smooth finish, lighting-ready design.',
  pvc_ceiling: 'PVC ceiling installation — moisture-resistant, low-maintenance, modern look.',
  wpc_louvers: 'WPC louvers — ventilated, weather-resistant panelling for a contemporary facade or interior.',
  wpc_fluted_panel: 'WPC fluted panels — textured wall panelling for an accent wall or feature.',
  uv_marble_sheet: 'UV marble sheets — high-gloss, marble-look wall cladding.',
  tv_unit: 'TV unit design and installation — a custom media wall.',
  wall_paneling: 'Wall paneling — a textured or patterned accent wall.',
  partition: 'Gypsum board partition — room division that keeps a space flexible.',
  interior_project: 'A general interior fit-out project for a home or commercial space.',
  before_after: 'A before/after transformation. Describe the change in general terms without inventing specific measurements, costs, or a client name unless supplied.',
  customer_project: 'A completed customer project. Do not invent the customer\'s name, location or a quote from them unless supplied — write about the work itself.',
  interior_tip: 'A practical interior-design tip homeowners in India would find useful — maintenance, material choice, or planning advice.',
  offer: 'A promotional offer. Do NOT invent a discount percentage, price, or deadline — only describe an offer using details explicitly supplied in the topic.',
  festival: 'A festival greeting relevant to North Indian customers (e.g. Diwali, Holi, Eid, Chhath) tied naturally back to the business, not just a generic greeting.',
  faq: 'Answer a common customer question about interior work, ceilings, or paneling — factual, no invented pricing or timelines.',
  local_business_promotion: `General promotion for ${BUSINESS.name} as a local interior business in ${BUSINESS.location}.`,
};

const LANGUAGE_INSTRUCTION: Record<SocialLanguage, string> = {
  en: 'Write in natural, warm English.',
  hi: 'Write in Hindi using Devanagari script, the way a local business owner would speak.',
  hinglish: 'Write in Hinglish — conversational Hindi written in Latin script, mixed naturally with English.',
};

function buildSystemPrompt(
  contentType: SocialContentType,
  platforms: SocialPlatformTarget,
  language: SocialLanguage,
): string {
  const wantsFacebook = platforms === 'facebook' || platforms === 'both';
  const wantsInstagram = platforms === 'instagram' || platforms === 'both';

  return [
    `You write Facebook and Instagram posts for ${BUSINESS.name}, an interior fit-out business in ${BUSINESS.location}, India.`,
    `Services actually offered: ${SERVICES.join(', ')}. Website: ${BUSINESS.website}.`,
    '',
    `Today's content: ${CONTENT_TYPE_GUIDANCE[contentType]}`,
    '',
    'Hard rules — never break these:',
    '- Never invent customer reviews, quotes, names, or testimonials.',
    '- Never invent awards, certifications, or credentials.',
    '- Never invent prices, discounts, percentages, or offer deadlines.',
    '- Never invent project details (size, location, cost, timeline) beyond what the topic supplies.',
    '- Never claim a specific number of completed projects or years of experience unless the topic supplies it.',
    '- Never mention AI, automation, or that this post was generated.',
    '',
    'Platform differences — the two must read as different posts, never the same text reused:',
    wantsFacebook
      ? '- Facebook: slightly more detailed, 2-4 sentences, ends with a clear local-business call to action (visit the website or contact for a quote).'
      : '',
    wantsInstagram
      ? '- Instagram: concise and visual-first, 1-2 short sentences, ends with a short call to action, followed by 5-10 relevant hashtags (mix of service, location and generic interior-design tags, no banned/spammy tags).'
      : '',
    '',
    LANGUAGE_INSTRUCTION[language],
    '',
    'Respond with ONLY a single JSON object, no markdown fences, no commentary, in exactly this shape:',
    '{',
    '  "title": "short internal headline for the dashboard, not part of the post copy",',
    wantsFacebook ? '  "facebook": { "caption": "...", "hashtags": ["...", "..."] },' : '',
    wantsInstagram ? '  "instagram": { "caption": "...", "hashtags": ["...", "..."] }' : '',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildUserPrompt(input: { topic?: string; campaign?: string }): string {
  const lines = [
    input.topic
      ? `Specific brief for this post: ${input.topic}`
      : 'No specific brief was given — write a general post for this content type using only the facts already provided above.',
  ];
  if (input.campaign) lines.push(`Campaign: ${input.campaign}`);
  return lines.join('\n');
}

export type GeneratedSocialContent = {
  title: string;
  facebookContent: PlatformContent | null;
  instagramContent: PlatformContent | null;
  provider: ProviderName;
  model: string;
};

type ParsedJson = {
  title?: string;
  facebook?: { caption?: string; hashtags?: string[] };
  instagram?: { caption?: string; hashtags?: string[] };
};

function parseModelJson(raw: string): ParsedJson | null {
  const cleaned = raw
    .trim()
    .replace(/^```(json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as ParsedJson;
  } catch {
    return null;
  }
}

/**
 * Generates draft copy for one or both platforms. Throws AI_NOT_CONFIGURED /
 * AI_FAILED (via the router) — never fabricates content when the model or the
 * parse fails.
 */
export async function generateSocialContent(input: {
  contentType: SocialContentType;
  platforms: SocialPlatformTarget;
  language: SocialLanguage;
  topic?: string;
  campaign?: string;
}): Promise<GeneratedSocialContent> {
  const result = await generate({
    system: buildSystemPrompt(input.contentType, input.platforms, input.language),
    user: buildUserPrompt(input),
    maxOutputTokens: 700,
    temperature: 0.8,
  });

  const parsed = parseModelJson(result.content);
  if (!parsed || !parsed.title) {
    throw new AppError(
      'AI_FAILED',
      'The AI provider returned content that could not be parsed. Try generating again.',
      502,
    );
  }

  const wantsFacebook = input.platforms === 'facebook' || input.platforms === 'both';
  const wantsInstagram = input.platforms === 'instagram' || input.platforms === 'both';

  const facebookContent: PlatformContent | null =
    wantsFacebook && parsed.facebook?.caption
      ? { caption: parsed.facebook.caption.trim(), hashtags: parsed.facebook.hashtags ?? [] }
      : null;
  const instagramContent: PlatformContent | null =
    wantsInstagram && parsed.instagram?.caption
      ? { caption: parsed.instagram.caption.trim(), hashtags: parsed.instagram.hashtags ?? [] }
      : null;

  if ((wantsFacebook && !facebookContent) || (wantsInstagram && !instagramContent)) {
    throw new AppError(
      'AI_FAILED',
      'The AI provider did not return usable content for the requested platform(s). Try again.',
      502,
    );
  }

  return {
    title: parsed.title.trim(),
    facebookContent,
    instagramContent,
    provider: result.provider,
    model: result.model,
  };
}

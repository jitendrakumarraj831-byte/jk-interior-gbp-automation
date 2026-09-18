/**
 * AI review-reply drafting for JK Interior.
 *
 * Output of this module is always a DRAFT. Nothing here publishes anything;
 * publishing lives behind an explicit admin action in
 * /api/reviews/reply/publish.
 */

import OpenAI from 'openai';

import { BUSINESS, env, isAiConfigured, SERVICES } from './config';
import { AppError } from './errors';
import { log } from './logger';
import type { Review, ReviewLanguage, StarRating } from './types';

/** Hard cap. Google truncates long replies and they read as spam anyway. */
const MAX_REPLY_CHARS = 700;

/* ----------------------------- language guess ---------------------------- */

const DEVANAGARI = /[ऀ-ॿ]/;

/** Common Hinglish markers written in Latin script. */
const HINGLISH_MARKERS = [
  'accha',
  'acha',
  'bahut',
  'bohot',
  'bhai',
  'kaam',
  'kam bahut',
  'sahi',
  'badhiya',
  'badiya',
  'shukriya',
  'dhanyavad',
  'paisa',
  'kimat',
  'keemat',
  'ghar',
  'chhat',
  'chat ka kaam',
  'banwaya',
  'karwaya',
  'kiya hai',
  'nahi',
  'nahin',
  'bilkul',
  'zabardast',
  'mast',
  'thik',
  'theek',
  'kharab',
  'galat',
  'jaldi',
  'time pe',
  'samay',
];

/**
 * Detects the language a reply should be written in. Devanagari means Hindi;
 * Latin script with enough Hindi words means Hinglish; otherwise English.
 */
export function detectLanguage(text: string): ReviewLanguage {
  if (!text.trim()) return 'en';
  if (DEVANAGARI.test(text)) return 'hi';

  const lowered = ` ${text.toLowerCase().replace(/[^a-z\s]/g, ' ')} `;
  const hits = HINGLISH_MARKERS.filter((marker) => lowered.includes(` ${marker} `)).length;
  return hits >= 2 ? 'hinglish' : 'en';
}

/* ------------------------------ prompt build ----------------------------- */

const LANGUAGE_INSTRUCTION: Record<ReviewLanguage, string> = {
  en: 'Write the reply in natural, warm English.',
  hi: 'Write the reply in Hindi using Devanagari script, the way a local business owner would speak.',
  hinglish:
    'Write the reply in Hinglish — conversational Hindi written in Latin script, mixed naturally with English, exactly how the customer wrote.',
};

function toneInstruction(stars: StarRating): string {
  if (stars >= 4) {
    return [
      'This is a positive review. Thank them specifically for what they praised.',
      'Do not upsell aggressively. One short, natural invitation to reach out again is enough.',
    ].join(' ');
  }
  if (stars === 3) {
    return [
      'This is a mixed review. Thank them for the honest feedback,',
      'acknowledge the specific gap they mention, and offer to make it right.',
    ].join(' ');
  }
  return [
    'This is a negative review. Do not argue, do not make excuses and do not blame the customer.',
    'Apologise sincerely for their specific experience, take responsibility for looking into it,',
    'and invite them to contact the business directly so it can be resolved.',
  ].join(' ');
}

function buildSystemPrompt(language: ReviewLanguage, stars: StarRating): string {
  return [
    `You write Google review replies for ${BUSINESS.name}, an interior fit-out business in India.`,
    `Services offered: ${SERVICES.join(', ')}.`,
    '',
    'Rules:',
    '- Reply as the business owner, in first person plural ("we", "hamari team").',
    '- Keep it to 2-3 short sentences, under 60 words. Concise beats thorough.',
    '- Use the reviewer\'s first name once, naturally, only if it is a real name (not "Anonymous", not "Google user").',
    '- Sound like a person, not a template. Vary your opening; never start with "Thank you for your review".',
    '- Reference the actual work or detail the review mentions. If the review has no text, keep it brief and generic but still warm.',
    '- Mention at most one service, and only when the review already refers to it. Never list services. Never keyword-stuff.',
    '- No emojis, no hashtags, no marketing slogans, no phone numbers, no prices, no links.',
    '- Never invent facts: no claimed discounts, no promises about dates, no details the review does not contain.',
    '- Do not add a signature line or the business name at the end.',
    '',
    toneInstruction(stars),
    LANGUAGE_INSTRUCTION[language],
    '',
    'Return only the reply text. No quotes, no preamble, no explanation.',
  ].join('\n');
}

function buildUserPrompt(review: Review): string {
  return [
    `Reviewer name: ${review.reviewerName}`,
    `Rating: ${review.starRating} out of 5`,
    `Review date: ${review.createTime.slice(0, 10)}`,
    `Review text: ${review.comment ? review.comment : '(the reviewer left a rating with no text)'}`,
  ].join('\n');
}

/* -------------------------------- generate ------------------------------- */

export type GeneratedReply = {
  text: string;
  language: ReviewLanguage;
  model: string;
};

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!isAiConfigured()) {
    throw new AppError(
      'AI_NOT_CONFIGURED',
      'OPENAI_API_KEY is not set, so AI reply drafting is unavailable.',
      503,
    );
  }
  if (!client) client = new OpenAI({ apiKey: env().OPENAI_API_KEY });
  return client;
}

/** Strips wrapper quotes and boilerplate the model sometimes adds anyway. */
function cleanReply(raw: string): string {
  let text = raw.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/^(reply|response)\s*:\s*/i, '');
  text = text.replace(/\s*[-–—]\s*Team JK Interior\.?$/i, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.slice(0, MAX_REPLY_CHARS).trim();
}

/**
 * Produces a reply draft for a review. Throws AI_NOT_CONFIGURED when no key is
 * present — callers show that as a setup step, not an outage.
 */
export async function generateReplyDraft(review: Review): Promise<GeneratedReply> {
  const language = detectLanguage(review.comment);
  const model = env().OPENAI_MODEL || 'gpt-4o-mini';

  let completion;
  try {
    completion = await openai().chat.completions.create({
      model,
      // Enough variation to avoid templated-sounding replies across reviews.
      temperature: 0.85,
      max_tokens: 220,
      messages: [
        { role: 'system', content: buildSystemPrompt(language, review.starRating) },
        { role: 'user', content: buildUserPrompt(review) },
      ],
    });
  } catch (error) {
    log.error('ai-reply', 'Reply generation failed', {
      error: error instanceof Error ? error.message : String(error),
      model,
    });
    throw new AppError('AI_FAILED', 'The AI provider could not generate a reply draft.', 502);
  }

  const text = cleanReply(completion.choices[0]?.message?.content ?? '');
  if (!text) {
    throw new AppError('AI_FAILED', 'The AI provider returned an empty reply.', 502);
  }

  return { text, language, model };
}

export { MAX_REPLY_CHARS };

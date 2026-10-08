/**
 * Business Profile post content rules.
 *
 * Pure and dependency-free so the Google client, the API routes and the editor
 * all apply the SAME limits. Anything Google would reject is caught here with a
 * message a business owner can act on, instead of coming back later as an
 * opaque HTTP 400.
 */

import type { CallToActionType, PostType } from './types';

/** A local post summary (title + text for standard posts) may hold this many characters. */
export const POST_SUMMARY_LIMIT = 1500;
/** An offer's headline lives in `event.title`, which Google caps much lower. */
export const OFFER_TITLE_LIMIT = 58;
/** Our own cap on a title for any post type. */
export const MAX_POST_TITLE = 120;

export const CTA_NEEDS_URL: Record<CallToActionType, boolean> = {
  NONE: false,
  CALL: false,
  BOOK: true,
  ORDER: true,
  SHOP: true,
  LEARN_MORE: true,
  SIGN_UP: true,
};

type PostContent = {
  type: PostType;
  title: string;
  description: string;
  cta: { type: CallToActionType; url?: string };
};

/**
 * What will be sent to Google as the post's summary. Standard posts have no
 * title field, so the title is folded in; offers keep it in `event.title`.
 */
export function summaryOf(post: Pick<PostContent, 'type' | 'title' | 'description'>): string {
  if (post.type === 'offer') return post.description;
  return post.title ? `${post.title}\n\n${post.description}` : post.description;
}

/** First problem with this post, or null when Google would accept it. */
export function postContentProblem(post: PostContent): string | null {
  if (post.type === 'offer' && post.title.length > OFFER_TITLE_LIMIT) {
    return `An offer title can be at most ${OFFER_TITLE_LIMIT} characters on Google (yours is ${post.title.length}).`;
  }
  const summary = summaryOf(post);
  if (summary.length > POST_SUMMARY_LIMIT) {
    return `A Google post can hold at most ${POST_SUMMARY_LIMIT} characters${
      post.type === 'offer' ? '' : ', including the title'
    } (yours is ${summary.length}). Shorten it and try again.`;
  }
  if (CTA_NEEDS_URL[post.cta.type] && !post.cta.url) {
    return 'This call-to-action button needs a link.';
  }
  return null;
}

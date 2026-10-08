/**
 * Google Business Profile REST client.
 *
 * Google split the old "My Business" API into several services. This module
 * talks to all of the ones we need, over plain fetch + a bearer token:
 *
 *  - Account Management  mybusinessaccountmanagement.googleapis.com/v1
 *  - Business Information mybusinessbusinessinformation.googleapis.com/v1
 *  - Reviews & Local Posts  mybusiness.googleapis.com/v4   (still the only
 *    surface Google exposes for reviews and posts)
 *  - Performance  businessprofileperformance.googleapis.com/v1
 *
 * Every one of these requires the project to be approved by Google. Until that
 * lands, calls fail with a zero-quota 429/403, which is classified as "approval
 * pending" (lib/errors.ts) — we never synthesise a response. Each API is
 * tracked on its own, because each can be opened separately.
 */

import { env } from './config';
import { AppError, classifyGoogleError } from './errors';
import { recordServiceFailure, recordServiceSuccess } from './gbp-access';
import type { GbpService } from './gbp-status';
import { getAccessToken } from './google-auth';
import { log } from './logger';
import { postContentProblem, summaryOf } from './post-rules';
import {
  SUPPORTED_DAILY_METRICS,
  type DailyMetric,
  type GbpAccount,
  type GbpLocation,
  type GbpPost,
  type MetricSeries,
  type PerformanceSnapshot,
  type Review,
  type StarRating,
} from './types';

const ACCOUNT_MGMT = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const LEGACY_V4 = 'https://mybusiness.googleapis.com/v4';
const PERFORMANCE = 'https://businessprofileperformance.googleapis.com/v1';

/** One request must never be able to hold a serverless function hostage. */
const REQUEST_TIMEOUT_MS = 15_000;

/* ------------------------------ http plumbing ---------------------------- */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Every Google call goes through here, which is what makes the access state
 * trustworthy: the outcome of EACH call — success or classified failure — is
 * recorded against the API it hit (`service`), whoever made the call.
 *
 * Safe (GET) requests are retried once on a network error or a 502/503/504.
 * Rate limits (429) and everything else are never retried: hammering a limit
 * only prolongs it, and writes are not idempotent.
 */
async function googleFetch<T>(
  service: GbpService,
  url: string,
  init: RequestInit & { method?: string } = {},
): Promise<T> {
  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (error) {
    if (error instanceof AppError) await recordServiceFailure(service, error);
    throw error;
  }

  const method = (init.method ?? 'GET').toUpperCase();
  const attempts = method === 'GET' ? 2 : 1;
  let lastError: AppError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      log.error('gbp', 'Network failure calling Google', {
        service,
        attempt,
        error: error instanceof Error ? error.name : 'unknown',
      });
      lastError = new AppError(
        'GOOGLE_API_ERROR',
        'Could not reach Google just now. This is usually temporary — try again in a minute.',
        502,
      );
      if (attempt < attempts) {
        await sleep(400);
        continue;
      }
      break;
    }

    const text = await response.text();
    const body: unknown = text ? safeJsonParse(text) : {};

    if (response.ok) {
      await recordServiceSuccess(service);
      return body as T;
    }

    const appError = classifyGoogleError(response.status, body);
    log.info('gbp', `Google responded ${response.status}`, {
      service,
      code: appError.code,
      ...(appError.detail ? { detail: appError.detail } : {}),
    });

    const transient = [502, 503, 504].includes(response.status);
    if (transient && attempt < attempts) {
      await sleep(400);
      lastError = appError;
      continue;
    }
    await recordServiceFailure(service, appError);
    throw appError;
  }

  const finalError =
    lastError ?? new AppError('GOOGLE_API_ERROR', 'Could not reach the Google Business Profile API.', 502);
  await recordServiceFailure(service, finalError);
  throw finalError;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* ----------------------------- resource names ---------------------------- */

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** "." and ".." pass the character check but would be resolved away by the URL parser. */
const isDotSegment = (value: string) => /^\.+$/.test(value);

function requireSegment(value: string, what: string): string {
  if (!SAFE_SEGMENT.test(value) || isDotSegment(value)) {
    throw new AppError('VALIDATION_FAILED', `That ${what} is not a valid Google resource id.`, 400);
  }
  return value;
}

/** "accounts/123" or "123" → "accounts/123". */
export function normalizeAccountName(account: string): string {
  const id = account.startsWith('accounts/') ? account.slice('accounts/'.length) : account;
  return `accounts/${requireSegment(id, 'account')}`;
}

/**
 * "locations/456", "accounts/1/locations/456" or "456" → "456".
 * The WHOLE value must be one of those shapes — trailing path segments or a
 * query string are an error, not something to quietly cut off.
 */
export function parseLocationId(location: string): string {
  const match = /^(?:accounts\/[^/]+\/)?locations\/([^/]+)$/.exec(location);
  return requireSegment(match ? match[1]! : location, 'location');
}

/** The bare "locations/456" form the Business Information and Performance APIs use. */
export function bareLocationName(location: string): string {
  return `locations/${parseLocationId(location)}`;
}

/**
 * The v4 Reviews/Posts surface needs `accounts/{a}/locations/{l}`, while the
 * Business Information API hands back a bare `locations/{l}`. This joins them,
 * and accepts either form (or a full path) for both halves.
 */
export function buildLocationPath(accountName: string, locationName: string): string {
  return `${normalizeAccountName(accountName)}/locations/${parseLocationId(locationName)}`;
}

/**
 * Account/location pinned via env, when the operator has fixed them. The
 * location alone is enough — the account is then taken from the dashboard
 * selection or discovery, which is why it may be null.
 */
export function pinnedTarget(): { account: string | null; location: string } | null {
  const e = env();
  if (!e.GBP_LOCATION_NAME) return null;
  return { account: e.GBP_ACCOUNT_NAME || null, location: e.GBP_LOCATION_NAME };
}

const REVIEW_NAME = /^accounts\/[A-Za-z0-9_.-]+\/locations\/[A-Za-z0-9_.-]+\/reviews\/[A-Za-z0-9_.=-]+$/;
const POST_NAME = /^accounts\/[A-Za-z0-9_.-]+\/locations\/[A-Za-z0-9_.-]+\/localPosts\/[A-Za-z0-9_.-]+$/;

/**
 * The review/post resource name is interpolated into a URL, so it is validated
 * strictly: nothing that could add a path segment or query string gets through.
 */
export function isReviewResourceName(name: string): boolean {
  return REVIEW_NAME.test(name) && !name.split('/').some(isDotSegment);
}

function assertReviewName(name: string): void {
  if (!isReviewResourceName(name)) {
    throw new AppError('VALIDATION_FAILED', 'That is not a valid Google review resource name.', 400);
  }
}

/* -------------------------------- accounts ------------------------------- */

type AccountsResponse = {
  accounts?: {
    name: string;
    accountName?: string;
    type?: string;
    verificationState?: string;
  }[];
  nextPageToken?: string;
};

const MAX_LIST_PAGES = 5;

export async function listAccounts(): Promise<GbpAccount[]> {
  const accounts: GbpAccount[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const params = new URLSearchParams({ pageSize: '20' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await googleFetch<AccountsResponse>(
      'accounts',
      `${ACCOUNT_MGMT}/accounts?${params.toString()}`,
    );
    for (const a of data.accounts ?? []) {
      accounts.push({
        name: a.name,
        accountName: a.accountName ?? a.name,
        type: a.type,
        verificationState: a.verificationState,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return accounts;
}

type LocationsResponse = {
  locations?: {
    name: string;
    title?: string;
    storeCode?: string;
    phoneNumbers?: { primaryPhone?: string };
    websiteUri?: string;
  }[];
  nextPageToken?: string;
};

export async function listLocations(accountName: string): Promise<GbpLocation[]> {
  const account = normalizeAccountName(accountName);
  const readMask = ['name', 'title', 'storeCode', 'phoneNumbers', 'websiteUri'].join(',');
  const locations: GbpLocation[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const params = new URLSearchParams({ readMask, pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await googleFetch<LocationsResponse>(
      'locations',
      `${BUSINESS_INFO}/${account}/locations?${params.toString()}`,
    );
    for (const l of data.locations ?? []) {
      locations.push({
        name: l.name,
        title: l.title ?? l.name,
        storeCode: l.storeCode,
        primaryPhone: l.phoneNumbers?.primaryPhone,
        websiteUri: l.websiteUri,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return locations;
}

/* --------------------------------- reviews ------------------------------- */

const STAR_WORDS: Record<string, StarRating> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

type V4Review = {
  name?: string;
  reviewId: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

type V4ReviewsResponse = {
  reviews?: V4Review[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
};

export type ReviewsResult = {
  reviews: Review[];
  averageRating: number | null;
  totalReviewCount: number;
};

/**
 * Turns Google's review into ours, or null when it has no usable star rating.
 * A review is never given a rating Google did not report: defaulting to five
 * stars would let the AI answer an unrated (or unparseable) complaint cheerfully.
 */
function normalizeReview(raw: V4Review, locationPath: string): Review | null {
  const starRating = STAR_WORDS[raw.starRating ?? ''];
  if (!starRating || !raw.reviewId) return null;

  const hasReply = Boolean(raw.reviewReply?.comment?.trim());
  const createTime = raw.createTime ?? raw.updateTime ?? new Date(0).toISOString();
  return {
    name: raw.name ?? `${locationPath}/reviews/${raw.reviewId}`,
    reviewId: raw.reviewId,
    reviewerName: raw.reviewer?.isAnonymous
      ? 'Anonymous'
      : (raw.reviewer?.displayName ?? 'Google user'),
    reviewerPhotoUrl: raw.reviewer?.profilePhotoUrl,
    starRating,
    comment: raw.comment ?? '',
    createTime,
    updateTime: raw.updateTime ?? createTime,
    existingReply: hasReply
      ? {
          comment: raw.reviewReply?.comment ?? '',
          updateTime: raw.reviewReply?.updateTime ?? '',
        }
      : null,
    replyStatus: hasReply ? 'replied_on_google' : 'no_reply',
  };
}

/**
 * Fetches reviews for a location, following pagination up to `maxPages`.
 * Duplicates across pages are dropped, and the result is newest-first by the
 * date the review was written.
 */
export async function listReviews(
  locationPath: string,
  options: { maxPages?: number; pageSize?: number } = {},
): Promise<ReviewsResult> {
  const { maxPages = 4, pageSize = 50 } = options;
  const byId = new Map<string, Review>();
  let pageToken: string | undefined;
  let averageRating: number | null = null;
  let totalReviewCount = 0;
  let dropped = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      pageSize: String(Math.min(Math.max(pageSize, 1), 50)),
      orderBy: 'updateTime desc',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await googleFetch<V4ReviewsResponse>(
      'reviews',
      `${LEGACY_V4}/${locationPath}/reviews?${params.toString()}`,
    );

    averageRating = data.averageRating ?? averageRating;
    totalReviewCount = data.totalReviewCount ?? totalReviewCount;
    for (const raw of data.reviews ?? []) {
      const review = normalizeReview(raw, locationPath);
      if (!review) dropped += 1;
      else if (!byId.has(review.reviewId)) byId.set(review.reviewId, review);
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  if (dropped > 0) log.warn('gbp', 'Ignored reviews that carried no star rating.', { dropped });

  const reviews = [...byId.values()].sort((a, b) => b.createTime.localeCompare(a.createTime));
  return { reviews, averageRating, totalReviewCount: totalReviewCount || reviews.length };
}

/**
 * Publishes a reply. `reviewName` is the full resource name
 * accounts/{a}/locations/{l}/reviews/{r}. Google upserts, so this both creates
 * and edits a reply.
 */
export async function publishReviewReply(reviewName: string, comment: string): Promise<void> {
  assertReviewName(reviewName);
  await googleFetch('reviews', `${LEGACY_V4}/${reviewName}/reply`, {
    method: 'PUT',
    body: JSON.stringify({ comment }),
  });
  log.info('gbp', 'Review reply published.', { reviewName });
}

export async function deleteReviewReply(reviewName: string): Promise<void> {
  assertReviewName(reviewName);
  await googleFetch('reviews', `${LEGACY_V4}/${reviewName}/reply`, { method: 'DELETE' });
}

/* ------------------------------- local posts ----------------------------- */

type V4LocalPost = { name?: string; state?: string; searchUrl?: string };

const CTA_WITHOUT_URL = new Set(['CALL', 'NONE']);

const DEVANAGARI = /[\u0900-\u097F]/;

/**
 * Maps our post model onto Google's LocalPost.
 *
 * Google's STANDARD local posts have no title field — only `summary`. Offers
 * and events carry a title inside `event`. So a title is folded into the
 * summary for standard posts, and used properly for offers.
 *
 * Anything Google would reject is refused here with a clear message, instead
 * of being sent and coming back as an opaque 400.
 */
export function toLocalPost(post: GbpPost, now: Date = new Date()): Record<string, unknown> {
  const body: Record<string, unknown> = {
    languageCode: DEVANAGARI.test(`${post.title} ${post.description}`) ? 'hi' : 'en',
    topicType: post.type === 'offer' ? 'OFFER' : 'STANDARD',
  };

  const problem = postContentProblem(post);
  if (problem) throw new AppError('VALIDATION_FAILED', problem, 400);

  body.summary = summaryOf(post);
  if (post.type === 'offer') {
    // The offer starts when it goes live. Using `scheduledFor` would hand Google
    // a start date in the past whenever the daily job publishes a day late.
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    body.event = {
      title: post.title,
      schedule: {
        startDate: toGoogleDate(now),
        endDate: toGoogleDate(end),
      },
    };
  }

  if (post.cta.type !== 'NONE') {
    const callToAction: Record<string, string> = { actionType: post.cta.type };
    if (post.cta.url && !CTA_WITHOUT_URL.has(post.cta.type)) callToAction.url = post.cta.url;
    body.callToAction = callToAction;
  }

  if (post.imageUrl) {
    body.media = [{ mediaFormat: 'PHOTO', sourceUrl: post.imageUrl }];
  }

  return body;
}

function toGoogleDate(date: Date): { year: number; month: number; day: number } {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Creates a local post on Google. Returns the created resource name. */
export async function createLocalPost(locationPath: string, post: GbpPost): Promise<string> {
  const payload = toLocalPost(post);
  const created = await googleFetch<V4LocalPost>('posts', `${LEGACY_V4}/${locationPath}/localPosts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!created.name) {
    throw new AppError('GOOGLE_API_ERROR', 'Google accepted the post but returned no name.', 502);
  }
  log.info('gbp', 'Local post created.', { name: created.name });
  return created.name;
}

export async function deleteLocalPost(postName: string): Promise<void> {
  if (!POST_NAME.test(postName) || postName.split('/').some(isDotSegment)) {
    throw new AppError('VALIDATION_FAILED', 'That is not a valid Google post resource name.', 400);
  }
  await googleFetch('posts', `${LEGACY_V4}/${postName}`, { method: 'DELETE' });
}

/** Cheapest read-only call on the posts API — used to check access, not to show data. */
export async function probeLocalPosts(locationPath: string): Promise<void> {
  await googleFetch('posts', `${LEGACY_V4}/${locationPath}/localPosts?pageSize=1`);
}

/* ------------------------------- performance ----------------------------- */

const METRIC_LABELS: Record<DailyMetric, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'Maps views (desktop)',
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'Search views (desktop)',
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'Maps views (mobile)',
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'Search views (mobile)',
  BUSINESS_CONVERSATIONS: 'Messages',
  BUSINESS_DIRECTION_REQUESTS: 'Direction requests',
  CALL_CLICKS: 'Calls',
  WEBSITE_CLICKS: 'Website clicks',
  BUSINESS_BOOKINGS: 'Bookings',
  BUSINESS_FOOD_ORDERS: 'Food orders',
  BUSINESS_FOOD_MENU_CLICKS: 'Food menu clicks',
};

/** Metrics worth showing for an interiors business. */
export const DEFAULT_METRICS: DailyMetric[] = [
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_CONVERSATIONS',
];

export function metricLabel(metric: DailyMetric): string {
  return METRIC_LABELS[metric];
}

type MultiDailyResponse = {
  multiDailyMetricTimeSeries?: {
    dailyMetricTimeSeries?: {
      dailyMetric?: string;
      timeSeries?: {
        datedValues?: { date?: { year?: number; month?: number; day?: number }; value?: string }[];
      };
    }[];
  }[];
};

function isSupportedMetric(value: string): value is DailyMetric {
  return (SUPPORTED_DAILY_METRICS as readonly string[]).includes(value);
}

function isoDate(d: { year?: number; month?: number; day?: number } | undefined): string {
  if (!d?.year || !d.month || !d.day) return '';
  const mm = String(d.month).padStart(2, '0');
  const dd = String(d.day).padStart(2, '0');
  return `${d.year}-${mm}-${dd}`;
}

/** Google omits `value` for a zero day, and sends int64 as a string. Never NaN. */
function metricValue(raw: string | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Google's performance data trails real time; ending "today" returns blanks. */
export const PERFORMANCE_LAG_DAYS = 2;

/**
 * Business Profile Performance API — `fetchMultiDailyMetricsTimeSeries`.
 * `locationName` may be `locations/{id}` or an account-scoped path.
 *
 * The range is whole days ending PERFORMANCE_LAG_DAYS before today (UTC) and
 * spanning exactly `days` days inclusive. Totals are the plain sum of the days
 * Google returned — nothing is estimated or back-filled.
 */
export async function fetchPerformance(
  locationName: string,
  options: { days?: number; metrics?: DailyMetric[]; now?: Date } = {},
): Promise<PerformanceSnapshot> {
  const days = Math.floor(Math.min(Math.max(options.days ?? 30, 1), 540));
  const metrics = options.metrics ?? DEFAULT_METRICS;
  const now = options.now ?? new Date();

  const DAY_MS = 24 * 60 * 60 * 1000;
  const end = new Date(now.getTime() - PERFORMANCE_LAG_DAYS * DAY_MS);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);

  const params = new URLSearchParams();
  for (const metric of metrics) params.append('dailyMetrics', metric);
  const s = toGoogleDate(start);
  const e = toGoogleDate(end);
  params.set('dailyRange.start_date.year', String(s.year));
  params.set('dailyRange.start_date.month', String(s.month));
  params.set('dailyRange.start_date.day', String(s.day));
  params.set('dailyRange.end_date.year', String(e.year));
  params.set('dailyRange.end_date.month', String(e.month));
  params.set('dailyRange.end_date.day', String(e.day));

  const bare = bareLocationName(locationName);

  const data = await googleFetch<MultiDailyResponse>(
    'performance',
    `${PERFORMANCE}/${bare}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`,
  );

  const byMetric = new Map<DailyMetric, MetricSeries>();
  for (const group of data.multiDailyMetricTimeSeries ?? []) {
    for (const entry of group.dailyMetricTimeSeries ?? []) {
      const metric = entry.dailyMetric ?? '';
      if (!isSupportedMetric(metric)) continue;

      const daily = (entry.timeSeries?.datedValues ?? [])
        .map((dv) => ({ date: isoDate(dv.date), value: metricValue(dv.value) }))
        .filter((dv) => dv.date !== '')
        .sort((a, b) => a.date.localeCompare(b.date));

      // A metric repeated across groups is merged, never double counted.
      const existing = byMetric.get(metric);
      const merged = existing
        ? [...new Map([...existing.daily, ...daily].map((dv) => [dv.date, dv])).values()].sort(
            (a, b) => a.date.localeCompare(b.date),
          )
        : daily;

      byMetric.set(metric, {
        metric,
        label: metricLabel(metric),
        total: merged.reduce((sum, dv) => sum + dv.value, 0),
        daily: merged,
      });
    }
  }

  return {
    locationName: bare,
    rangeStart: isoDate(s),
    rangeEnd: isoDate(e),
    days,
    series: [...byMetric.values()],
    fetchedAt: new Date().toISOString(),
  };
}

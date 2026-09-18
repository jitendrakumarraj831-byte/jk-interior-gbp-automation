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
 * Every one of these requires the project to be allow-listed by Google. Until
 * that approval lands, calls fail with 403 and we surface
 * "approval pending" — we never synthesise a response.
 */

import { env } from './config';
import { AppError, classifyGoogleError } from './errors';
import { getAccessToken } from './google-auth';
import { log } from './logger';
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

/* ------------------------------ http plumbing ---------------------------- */

async function googleFetch<T>(
  url: string,
  init: RequestInit & { method?: string } = {},
): Promise<T> {
  const accessToken = await getAccessToken();

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
    });
  } catch (error) {
    log.error('gbp', 'Network failure calling Google', {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError('GOOGLE_API_ERROR', 'Could not reach the Google Business Profile API.', 502);
  }

  const text = await response.text();
  const body: unknown = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const appError = classifyGoogleError(response.status, body);
    log.info('gbp', `Google responded ${response.status}`, { url, code: appError.code });
    throw appError;
  }

  return body as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
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
};

export async function listAccounts(): Promise<GbpAccount[]> {
  const data = await googleFetch<AccountsResponse>(`${ACCOUNT_MGMT}/accounts?pageSize=20`);
  return (data.accounts ?? []).map((a) => ({
    name: a.name,
    accountName: a.accountName ?? a.name,
    type: a.type,
    verificationState: a.verificationState,
  }));
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
  const readMask = ['name', 'title', 'storeCode', 'phoneNumbers', 'websiteUri'].join(',');
  const url = `${BUSINESS_INFO}/${accountName}/locations?readMask=${encodeURIComponent(readMask)}&pageSize=100`;
  const data = await googleFetch<LocationsResponse>(url);
  return (data.locations ?? []).map((l) => ({
    name: l.name,
    title: l.title ?? l.name,
    storeCode: l.storeCode,
    primaryPhone: l.phoneNumbers?.primaryPhone,
    websiteUri: l.websiteUri,
  }));
}

/**
 * The v4 Reviews/Posts surface needs `accounts/{a}/locations/{l}`, while the
 * Business Information API hands back a bare `locations/{l}`. This joins them.
 */
export function buildLocationPath(accountName: string, locationName: string): string {
  const locationId = locationName.startsWith('locations/')
    ? locationName.slice('locations/'.length)
    : locationName;
  const account = accountName.startsWith('accounts/') ? accountName : `accounts/${accountName}`;
  return `${account}/locations/${locationId}`;
}

/** Account/location pinned via env, when the operator has fixed them. */
export function pinnedTarget(): { account: string; location: string } | null {
  const e = env();
  if (!e.GBP_ACCOUNT_NAME || !e.GBP_LOCATION_NAME) return null;
  return { account: e.GBP_ACCOUNT_NAME, location: e.GBP_LOCATION_NAME };
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

function normalizeReview(raw: V4Review, locationPath: string): Review {
  const hasReply = Boolean(raw.reviewReply?.comment);
  return {
    name: raw.name ?? `${locationPath}/reviews/${raw.reviewId}`,
    reviewId: raw.reviewId,
    reviewerName: raw.reviewer?.isAnonymous
      ? 'Anonymous'
      : (raw.reviewer?.displayName ?? 'Google user'),
    reviewerPhotoUrl: raw.reviewer?.profilePhotoUrl,
    starRating: STAR_WORDS[raw.starRating ?? ''] ?? 5,
    comment: raw.comment ?? '',
    createTime: raw.createTime ?? new Date(0).toISOString(),
    updateTime: raw.updateTime ?? raw.createTime ?? new Date(0).toISOString(),
    existingReply: hasReply
      ? {
          comment: raw.reviewReply?.comment ?? '',
          updateTime: raw.reviewReply?.updateTime ?? '',
        }
      : null,
    replyStatus: hasReply ? 'replied_on_google' : 'no_reply',
  };
}

/** Fetches reviews for a location, following pagination up to `maxPages`. */
export async function listReviews(
  locationPath: string,
  options: { maxPages?: number; pageSize?: number } = {},
): Promise<ReviewsResult> {
  const { maxPages = 4, pageSize = 50 } = options;
  const reviews: Review[] = [];
  let pageToken: string | undefined;
  let averageRating: number | null = null;
  let totalReviewCount = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ pageSize: String(pageSize), orderBy: 'updateTime desc' });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await googleFetch<V4ReviewsResponse>(
      `${LEGACY_V4}/${locationPath}/reviews?${params.toString()}`,
    );

    averageRating = data.averageRating ?? averageRating;
    totalReviewCount = data.totalReviewCount ?? totalReviewCount;
    for (const raw of data.reviews ?? []) reviews.push(normalizeReview(raw, locationPath));

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return { reviews, averageRating, totalReviewCount: totalReviewCount || reviews.length };
}

/**
 * Publishes a reply. `reviewName` is the full resource name
 * accounts/{a}/locations/{l}/reviews/{r}. Google upserts, so this both creates
 * and edits a reply.
 */
export async function publishReviewReply(reviewName: string, comment: string): Promise<void> {
  await googleFetch(`${LEGACY_V4}/${reviewName}/reply`, {
    method: 'PUT',
    body: JSON.stringify({ comment }),
  });
  log.info('gbp', 'Review reply published.', { reviewName });
}

export async function deleteReviewReply(reviewName: string): Promise<void> {
  await googleFetch(`${LEGACY_V4}/${reviewName}/reply`, { method: 'DELETE' });
}

/* ------------------------------- local posts ----------------------------- */

type V4LocalPost = { name?: string; state?: string; searchUrl?: string };

const CTA_WITHOUT_URL = new Set(['CALL', 'NONE']);

/**
 * Maps our post model onto Google's LocalPost.
 *
 * Google's STANDARD local posts have no title field — only `summary`. Offers
 * and events carry a title inside `event`. So a title is folded into the
 * summary for standard posts, and used properly for offers.
 */
function toLocalPost(post: GbpPost): Record<string, unknown> {
  const body: Record<string, unknown> = {
    languageCode: 'en',
    topicType: post.type === 'offer' ? 'OFFER' : 'STANDARD',
  };

  if (post.type === 'offer') {
    const start = post.scheduledFor ? new Date(post.scheduledFor) : new Date();
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    body.summary = post.description;
    body.event = {
      title: post.title,
      schedule: {
        startDate: toGoogleDate(start),
        endDate: toGoogleDate(end),
      },
    };
  } else {
    body.summary = post.title ? `${post.title}\n\n${post.description}` : post.description;
  }

  if (post.cta.type !== 'NONE') {
    const callToAction: Record<string, string> = { actionType: post.cta.type };
    if (!CTA_WITHOUT_URL.has(post.cta.type) && post.cta.url) callToAction.url = post.cta.url;
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
  const created = await googleFetch<V4LocalPost>(`${LEGACY_V4}/${locationPath}/localPosts`, {
    method: 'POST',
    body: JSON.stringify(toLocalPost(post)),
  });
  if (!created.name) {
    throw new AppError('GOOGLE_API_ERROR', 'Google accepted the post but returned no name.', 502);
  }
  log.info('gbp', 'Local post created.', { name: created.name });
  return created.name;
}

export async function deleteLocalPost(postName: string): Promise<void> {
  await googleFetch(`${LEGACY_V4}/${postName}`, { method: 'DELETE' });
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

/**
 * Business Profile Performance API — `fetchMultiDailyMetricsTimeSeries`.
 * `locationName` must be `locations/{id}` (not the account-scoped path).
 */
export async function fetchPerformance(
  locationName: string,
  options: { days?: number; metrics?: DailyMetric[] } = {},
): Promise<PerformanceSnapshot> {
  const days = Math.min(Math.max(options.days ?? 30, 1), 540);
  const metrics = options.metrics ?? DEFAULT_METRICS;

  // Google's performance data lags by ~2 days; ending "today" returns blanks.
  const end = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

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

  const bare = locationName.startsWith('locations/')
    ? locationName
    : `locations/${locationName.split('/').pop()}`;

  const data = await googleFetch<MultiDailyResponse>(
    `${PERFORMANCE}/${bare}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`,
  );

  const series: MetricSeries[] = [];
  for (const group of data.multiDailyMetricTimeSeries ?? []) {
    for (const entry of group.dailyMetricTimeSeries ?? []) {
      const metric = entry.dailyMetric ?? '';
      if (!isSupportedMetric(metric)) continue;

      const daily = (entry.timeSeries?.datedValues ?? [])
        .map((dv) => ({ date: isoDate(dv.date), value: Number(dv.value ?? 0) }))
        .filter((dv) => dv.date !== '');

      series.push({
        metric,
        label: metricLabel(metric),
        total: daily.reduce((sum, dv) => sum + dv.value, 0),
        daily,
      });
    }
  }

  return {
    locationName: bare,
    rangeStart: isoDate(s),
    rangeEnd: isoDate(e),
    series,
    fetchedAt: new Date().toISOString(),
  };
}

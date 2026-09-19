/** Shared domain types. Kept free of secrets so they can cross to the client. */

import type { GbpAccessStatus } from './gbp-access';

export type { GbpAccessStatus };

export type ApiStatus = 'ok' | 'pending_approval' | 'not_connected' | 'error';

/** Normalised envelope every dashboard API returns. */
export type ApiEnvelope<T> = {
  status: ApiStatus;
  /** Present only when status === 'ok'. Never fabricated. */
  data: T | null;
  message: string;
  /** Machine-readable reason, e.g. 'GBP_API_NOT_ENABLED'. */
  code?: string;
};

export type StarRating = 1 | 2 | 3 | 4 | 5;

export type ReplyStatus =
  | 'no_reply'
  | 'draft_pending'
  | 'approved'
  | 'published'
  | 'publish_failed'
  | 'replied_on_google';

export type ReviewLanguage = 'en' | 'hi' | 'hinglish';

export type Review = {
  /** Google resource name: accounts/{a}/locations/{l}/reviews/{r} */
  name: string;
  reviewId: string;
  reviewerName: string;
  reviewerPhotoUrl?: string;
  starRating: StarRating;
  comment: string;
  createTime: string;
  updateTime: string;
  /** Reply already live on Google, if any. */
  existingReply?: { comment: string; updateTime: string } | null;
  replyStatus: ReplyStatus;
  /**
   * Where this record came from. Absent or 'google' means a real review.
   * 'mock' records exist only while GBP_MOCK_MODE is active and never mix with
   * real ones — the two are served by mutually exclusive code paths.
   */
  source?: 'google' | 'mock';
};

export type ReplyDraft = {
  id: string;
  reviewId: string;
  reviewName: string;
  reviewerName: string;
  starRating: StarRating;
  reviewComment: string;
  /** What the AI produced. Kept for audit even after an admin edits it. */
  generatedText: string;
  /** What will actually be published — admin-edited when they change it. */
  text: string;
  language: ReviewLanguage;
  status: Exclude<ReplyStatus, 'no_reply' | 'replied_on_google'>;
  model: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  publishedAt?: string;
  error?: string;
};

export type PostType =
  | 'service_promotion'
  | 'project_update'
  | 'offer'
  | 'festival_greeting'
  | 'general';

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

export type CallToActionType =
  | 'NONE'
  | 'BOOK'
  | 'ORDER'
  | 'SHOP'
  | 'LEARN_MORE'
  | 'SIGN_UP'
  | 'CALL';

export type GbpPost = {
  id: string;
  type: PostType;
  title: string;
  description: string;
  cta: { type: CallToActionType; url?: string };
  imageUrl?: string;
  /** ISO timestamp. When set and in the future the post waits for cron. */
  scheduledFor?: string;
  status: PostStatus;
  /** Google resource name once published. Only ever set by a real API call. */
  googlePostName?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  error?: string;
};

/**
 * Metrics exposed by the Business Profile Performance API
 * (businessprofileperformance.googleapis.com v1, `dailyMetrics`).
 * This list mirrors Google's DailyMetric enum — nothing invented.
 */
export const SUPPORTED_DAILY_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_DIRECTION_REQUESTS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_FOOD_ORDERS',
  'BUSINESS_FOOD_MENU_CLICKS',
] as const;

export type DailyMetric = (typeof SUPPORTED_DAILY_METRICS)[number];

export type MetricSeries = {
  metric: DailyMetric;
  label: string;
  total: number;
  daily: { date: string; value: number }[];
};

export type PerformanceSnapshot = {
  locationName: string;
  rangeStart: string;
  rangeEnd: string;
  series: MetricSeries[];
  fetchedAt: string;
};

export type GbpAccount = {
  name: string;
  accountName: string;
  type?: string;
  verificationState?: string;
};

export type GbpLocation = {
  name: string;
  title: string;
  storeCode?: string;
  primaryPhone?: string;
  websiteUri?: string;
};

export type ConnectionState = {
  /**
   * True when Google answered a Business Profile call. Kept for compatibility;
   * prefer `oauthConnected` + `apiAccess`, which separate "is the account
   * linked" from "is API access granted yet".
   */
  connected: boolean;
  /** The Google account is linked and its refresh token still works. */
  oauthConnected: boolean;
  /** Business Profile API access state — pending, available, or a fault. */
  apiAccess: GbpAccessStatus;
  /** Plain-language explanation of apiAccess. Never a raw Google payload. */
  apiAccessMessage: string;
  /** True once we have a usable refresh token. */
  hasRefreshToken: boolean;
  connectedAt?: string;
  /** Email of the Google account that authorised, when we could read it. */
  googleAccountEmail?: string;
  accounts: GbpAccount[];
  locations: GbpLocation[];
  selectedAccount?: string;
  selectedLocation?: string;
  lastError?: string;
};

export type AutomationRunName =
  | 'sync-reviews'
  | 'generate-drafts'
  | 'publish-posts'
  | 'publish-replies'
  | 'sync-performance';

export type AutomationRun = {
  task: AutomationRunName;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  summary: string;
  details?: Record<string, number | string | boolean>;
};

/* ----------------------------- notifications ----------------------------- */

export type NotificationCategory =
  | 'new_review'
  | 'ai_draft_ready'
  | 'post_scheduled'
  | 'post_published'
  | 'google_api_issue'
  | 'performance_report_ready'
  | 'profile_update';

export type AppNotification = {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  /** Dashboard path this notification points at. */
  href?: string;
  /** Stable key that prevents the same event from ever notifying twice. */
  dedupeKey: string;
  read: boolean;
  createdAt: string;
  readAt?: string;
};

/* -------------------------------- audit log ------------------------------- */

export type AuditAction =
  | 'review_draft_generated'
  | 'review_draft_approved'
  | 'review_draft_unapproved'
  | 'review_draft_discarded'
  | 'review_reply_published'
  | 'post_created'
  | 'post_scheduled'
  | 'post_updated'
  | 'post_deleted'
  | 'post_published'
  | 'automation_executed'
  | 'settings_updated'
  | 'google_connected'
  | 'google_disconnected';

export type AuditStatus = 'success' | 'failure';

export type AuditLogEntry = {
  id: string;
  timestamp: string;
  /** Non-reversible session identifier, e.g. "admin:3f9a1c" — never a token. */
  actor: string;
  action: AuditAction;
  resource: string;
  status: AuditStatus;
  source: 'dashboard' | 'cron';
  /** Safe, human-readable context. Never a secret or raw provider payload. */
  detail?: string;
};

/* ----------------------------- system health ------------------------------ */

export type HealthStatus =
  | 'healthy'
  | 'configured'
  | 'pending'
  | 'not_configured'
  | 'rate_limited'
  | 'error';

export type HealthCheck = {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
  checkedAt: string;
};

export type SystemHealthReport = {
  checks: HealthCheck[];
  generatedAt: string;
};

export type DashboardSummary = {
  connection: { connected: boolean; label: string; detail: string };
  newReviews: number;
  unansweredReviews: number;
  pendingDrafts: number;
  approvedDrafts: number;
  scheduledPosts: number;
  publishedPosts: number;
  averageRating: number | null;
  totalReviews: number;
  automation: { enabled: boolean; lastRuns: AutomationRun[] };
  warnings: string[];
  /**
   * The few most recent reviews, for the dashboard's "Recent reviews" section.
   * Sliced from the reviews this endpoint already fetches, so surfacing them
   * costs no extra Google API call.
   */
  recentReviews: Review[];
};

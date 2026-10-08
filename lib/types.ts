/** Shared domain types. Kept free of secrets so they can cross to the client. */

import type { GbpAccessSnapshot, GbpAccessStatus } from './gbp-status';

export type { GbpAccessSnapshot, GbpAccessStatus };

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
  /** Things worth a second look before approving, e.g. "mentions a refund". Advisory only. */
  flags?: string[];
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
  /** Automatic publish attempts that ended in a temporary Google fault. */
  attempts?: number;
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
  /** Length of the requested range in days. Absent on snapshots cached by older builds. */
  days?: number;
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
   * True when the Business Profile API is proven to be answering — the account
   * is linked AND at least one API has succeeded. Never true on a cached guess.
   */
  connected: boolean;
  /** The Google account is linked and its refresh token still works. */
  oauthConnected: boolean;
  /** Business Profile API access state — available, pending, or a specific fault. */
  apiAccess: GbpAccessStatus;
  /** Plain-language explanation of apiAccess. Never a raw Google payload. */
  apiAccessMessage: string;
  /** The full per-API picture behind apiAccess. */
  access: GbpAccessSnapshot;
  /** True once we have a usable refresh token. */
  hasRefreshToken: boolean;
  /** Which credential is in use. Never the credential itself. */
  credentialSource: 'stored' | 'environment' | null;
  /** GOOGLE_REFRESH_TOKEN is set but ignored because the account was disconnected. */
  environmentTokenIgnored: boolean;
  connectedAt?: string;
  /** Email of the Google account that authorised, when we could read it. */
  googleAccountEmail?: string;
  accounts: GbpAccount[];
  locations: GbpLocation[];
  selectedAccount?: string;
  selectedLocation?: string;
  selectedLocationTitle?: string;
  /** pinned = environment, selected = chosen in the dashboard, auto = first one Google listed. */
  selectionSource: 'pinned' | 'selected' | 'auto' | null;
  /** Where the account/location lists came from. */
  discovery: { source: 'live' | 'cached' | 'none'; fetchedAt?: string; error?: string };
  lastError?: string;
};

export type AutomationRunName =
  | 'sync-reviews'
  | 'generate-drafts'
  | 'publish-posts'
  | 'publish-replies'
  | 'sync-performance'
  | 'publish-social'
  | 'generate-social-content';

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
  | 'profile_update'
  // --- Meta Social Automation ---
  | 'meta_connected'
  | 'meta_disconnected'
  | 'social_draft_created'
  | 'social_post_approved'
  | 'social_post_scheduled'
  | 'social_post_published'
  | 'social_post_failed'
  | 'social_post_skipped'
  | 'meta_rate_limited'
  | 'meta_token_expired'
  | 'meta_permission_error';

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
  | 'google_disconnected'
  | 'google_access_checked'
  // --- Meta Social Automation ---
  | 'meta_connected'
  | 'meta_disconnected'
  | 'media_uploaded'
  | 'media_deleted'
  | 'social_draft_created'
  | 'social_content_edited'
  | 'social_post_approved'
  | 'social_post_scheduled'
  | 'social_post_unscheduled'
  | 'social_post_duplicated'
  | 'social_post_deleted'
  | 'social_post_published_manual'
  | 'social_post_published_auto'
  | 'social_post_failed'
  | 'social_post_skipped'
  | 'social_settings_updated';

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
  connection: {
    /** A Google credential is held (the account is linked), whatever Google last said. */
    linked: boolean;
    /** True only when the Business Profile API is proven to be answering. */
    connected: boolean;
    /** Structured status — the UI keys off this, never off `label` text. */
    status: GbpAccessStatus;
    label: string;
    detail: string;
    /** Last time Google answered a request successfully. */
    lastSuccessAt: string | null;
    locationTitle?: string;
    locationPath?: string;
  };
  /** The full per-API picture, from the same source every other page reads. */
  access: GbpAccessSnapshot;
  /** Where the review figures came from. 'cache' must be shown as such. */
  reviewsSource: 'google' | 'cache' | 'mock' | 'none';
  reviewsFetchedAt?: string;
  /** Plain-language reason the reviews could not be refreshed live. */
  reviewsNote?: string;
  newReviews: number;
  unansweredReviews: number;
  pendingDrafts: number;
  approvedDrafts: number;
  scheduledPosts: number;
  publishedPosts: number;
  averageRating: number | null;
  totalReviews: number;
  automation: {
    enabled: boolean;
    lastRuns: AutomationRun[];
    /** Most recent run of each task — a plain overwrite, so never lost to a race. */
    latestByTask: AutomationRun[];
  };
  warnings: string[];
  /**
   * The few most recent reviews, for the dashboard's "Recent reviews" section.
   * Sliced from the reviews this endpoint already fetches, so surfacing them
   * costs no extra Google API call.
   */
  recentReviews: Review[];
};

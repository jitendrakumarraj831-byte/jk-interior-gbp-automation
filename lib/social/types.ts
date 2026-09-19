/**
 * Meta Social Automation domain types.
 *
 * Kept isolated from lib/types.ts (the existing GBP domain model) rather than
 * folded into it — the Social feature is additive and independent, and this
 * file is where it grows without expanding the GBP file it does not touch.
 *
 * Free of secrets so it can cross to the client, same rule as lib/types.ts.
 */

export type MetaPlatform = 'facebook' | 'instagram';

/** Facebook Page identity + connection facts. Never a token. */
export type FacebookConnection = {
  connected: boolean;
  pageId?: string;
  pageName?: string;
};

/** Instagram Professional account identity + connection facts. Never a token. */
export type InstagramConnection = {
  connected: boolean;
  igUserId?: string;
  username?: string;
  name?: string;
};

export type MetaConnectionState = {
  /** True when at least one of Facebook/Instagram is connected. */
  connected: boolean;
  facebook: FacebookConnection;
  instagram: InstagramConnection;
  connectedAt?: string;
  lastSyncAt?: string;
  /** Plain-language, safe-to-show explanation of the last failure, if any. */
  lastError?: string;
};

/* --------------------------------- content -------------------------------- */

/**
 * Content categories the AI Content Studio can draft. The eight service-named
 * entries map onto lib/config.ts#SERVICES; the rest are business-generic.
 */
export type SocialContentType =
  | 'gypsum_false_ceiling'
  | 'pvc_ceiling'
  | 'wpc_louvers'
  | 'wpc_fluted_panel'
  | 'uv_marble_sheet'
  | 'tv_unit'
  | 'wall_paneling'
  | 'partition'
  | 'interior_project'
  | 'before_after'
  | 'customer_project'
  | 'interior_tip'
  | 'offer'
  | 'festival'
  | 'faq'
  | 'local_business_promotion';

export type SocialPlatformTarget = 'facebook' | 'instagram' | 'both';

export type SocialLanguage = 'en' | 'hi' | 'hinglish';

/** One platform's generated copy. Facebook and Instagram never share the same text. */
export type PlatformContent = {
  caption: string;
  hashtags: string[];
};

/* ---------------------------------- media ---------------------------------- */

/**
 * An uploaded media file. `url` must be a publicly reachable https URL —
 * Instagram fetches media by URL at publish time, so a local path or a
 * browser blob: URL can never be stored here.
 */
export type MediaAsset = {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  category?: string;
  altText?: string;
  /** Ids of SocialPosts referencing this asset — "used" is derived from length > 0. */
  usedInPostIds: string[];
  createdAt: string;
};

/* ------------------------------- social posts ------------------------------ */

export type SocialPostStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type SocialApprovalStatus = 'pending' | 'approved';

/** External post ids per platform once published — a "both" post gets two. */
export type SocialExternalPostIds = {
  facebook?: string;
  instagram?: string;
};

export type SocialPost = {
  id: string;
  title: string;
  contentType: SocialContentType;
  platforms: SocialPlatformTarget;
  language: SocialLanguage;
  /** The shared topic/brief the platform-specific captions were generated from. */
  content: string;
  facebookContent: PlatformContent | null;
  instagramContent: PlatformContent | null;
  mediaIds: string[];
  status: SocialPostStatus;
  approvalStatus: SocialApprovalStatus;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Non-reversible actor id, same convention as lib/audit.ts. */
  createdBy: string;
  lastError?: string;
  retryCount: number;
  externalPostIds: SocialExternalPostIds;
  /** Stable hash of the platform content, used for duplicate-content protection. */
  contentHash: string;
  campaign?: string;
  metadata?: Record<string, string>;
};

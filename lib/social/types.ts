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

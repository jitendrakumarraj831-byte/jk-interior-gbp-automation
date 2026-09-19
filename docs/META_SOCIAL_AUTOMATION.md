# Meta Social Automation (Facebook + Instagram)

Extends the JK Interior GBP Automation dashboard with Facebook Page and
Instagram Professional publishing. Built alongside — and completely
independent from — the existing Google Business Profile automation. GBP
being rate-limited never blocks Meta, and Meta being unconfigured never
blocks GBP.

**Every Auto Publish setting defaults OFF.** No code path in this build
makes a real Facebook/Instagram API call outside of a deliberate manual
action once you connect a real account — see [Safe testing](#safe-testing).

---

## 1. Meta Developer App requirements

1. Create an app at [developers.facebook.com](https://developers.facebook.com/) (Business type).
2. Add these products to the app: **Facebook Login for Business** and
   **Instagram Graph API** (via the Instagram product, which requires the
   Page to have a linked Instagram Professional — Business or Creator —
   account).
3. Add the JK Interior Facebook Page, and the admin's Facebook account, as
   app **admins/testers** — this unlocks Development-mode testing (real Meta
   API calls against your own Page/IG account) before App Review, which is
   how you'd do the "explicitly approved" live test the spec required before
   any real publish.
4. Note the **App ID** and **App Secret** from the app dashboard — these
   become `META_APP_ID` / `META_APP_SECRET`.

## 2. Current API flow (as implemented)

Pinned to **Graph API v26.0** (current stable as of this build; `META_API_VERSION`
overrides it without a code change — Meta ships a new version roughly every
quarter, and v20.0 is deprecated 2026-09-24).

1. **OAuth start** (`GET /api/auth/meta`) → Facebook Login for Business
   dialog with the scopes below.
2. **Callback** (`GET /api/auth/meta/callback`) exchanges the code for a
   short-lived user token, exchanges that for a long-lived user token
   (~60 days), then calls `GET /me/accounts` to discover the Facebook
   Page(s) the user manages and each Page's own access token. Page tokens
   derived from a long-lived user token do not expire on their own, but are
   invalidated if the underlying user token is revoked, the Facebook
   password changes, or the user's role on the Page is removed — there is
   no refresh endpoint for a dead Page token; reconnecting re-derives one.
3. `instagram_business_account` is read off the connected Page to discover
   the linked Instagram Professional account, if any.
4. The Page access token is the only secret persisted, and only **encrypted**
   (AES-256-GCM, `lib/meta/crypto.ts`) — this is a stronger standard than
   the existing Google refresh token, which this build deliberately did not
   touch.
5. **Publishing**:
   - Facebook: `POST /{page-id}/feed` (text), `POST /{page-id}/photos`
     (single image — the photo post *is* the feed post), or multiple
     unpublished photo uploads attached to one `/feed` post (album).
   - Instagram: container-based — `POST /{ig-user-id}/media` to create a
     container (`image_url`, or `media_type=REELS` + `video_url`, or
     `is_carousel_item=true` per child + one `media_type=CAROUSEL` parent),
     then `POST /{ig-user-id}/media_publish` with the container id. A video
     container is polled (`GET /{container-id}?fields=status_code`) with a
     bounded set of short waits (~24s total) before publishing — never an
     open-ended loop, to respect the serverless function time limit.

### Verification gap — please read

`developers.facebook.com` is blocked by this build environment's network
egress proxy, so this flow was written from **cross-referenced third-party
2026 sources**, not fetched directly from Meta's own pages. Before your
first real connect, re-verify against the live docs (or Graph API Explorer):

- The exact daily Instagram publishing cap. Sources disagree (25 / 50 / 100
  posts per rolling 24h) — the code does **not** hardcode any of these
  numbers; query `GET /{ig-user-id}/content_publishing_limit` for the real,
  current figure if you need it.
- Reels constraints (aspect ratio, duration, codec) if you plan to publish
  video.
- That POST requests accepting a JSON body (rather than
  form-urlencoded) is still current — this build's `lib/meta/client.ts`
  sends JSON, which the Graph API has accepted for years, but reconfirm
  against a real app response before relying on it.

## 3. Required permissions (least privilege)

| Permission | Why |
| --- | --- |
| `pages_show_list` | Discover the Pages the admin manages |
| `pages_read_engagement` | Read Page metadata during discovery |
| `pages_manage_posts` | Publish to the Facebook Page |
| `instagram_business_basic` | Read the linked Instagram Professional account |
| `instagram_business_content_publish` | Publish to Instagram |

`instagram_business_basic` / `instagram_business_content_publish` are the
**current** names — they replaced the deprecated `instagram_basic` /
`instagram_content_publish` (retired 2025-01-27). Do not request the old
names. All five require Meta App Review (screencast, 2–4 weeks) before they
work for real end users; Development-mode testers can use them immediately
against their own Page/IG account.

## 4. Environment variables

None of these are set by default — every one is optional, and the app never
crashes on a missing value (same pattern as the existing `GOOGLE_*` vars).

| Variable | Purpose |
| --- | --- |
| `META_APP_ID` | Meta app ID |
| `META_APP_SECRET` | Meta app secret — never expose client-side |
| `META_REDIRECT_URI` | Must exactly match the app's OAuth redirect allow-list, e.g. `https://<your-domain>/api/auth/meta/callback` |
| `META_API_VERSION` | Defaults to `v26.0` |
| `META_ENCRYPTION_KEY` | Base64-encoded 32-byte key for AES-256-GCM. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `META_SOCIAL_ENABLED` | Master switch. Defaults `false` |
| `META_FACEBOOK_ENABLED` | Defaults `false` |
| `META_INSTAGRAM_ENABLED` | Defaults `false` |
| `BLOB_READ_WRITE_TOKEN` | Auto-set by Vercel once a Blob store is attached — enables the Media Manager |

Set these in Vercel's dashboard (Preview/Production), never pasted into
chat or committed to the repo.

## 5. Manual setup you need to do

1. Complete [§1](#1-meta-developer-app-requirements) in the Meta Developer
   dashboard.
2. Set `META_REDIRECT_URI` in the Meta app's OAuth redirect allow-list.
3. Generate and set `META_ENCRYPTION_KEY` before connecting anything.
4. Set the four `META_*` vars above in Vercel, then redeploy.
5. Attach a **Vercel Blob** store to the project (Vercel dashboard → Storage
   → Create Database → Blob) for the Media Manager — `BLOB_READ_WRITE_TOKEN`
   is injected automatically.
6. Visit `/dashboard/social` and click **Connect Meta**.
7. **Cron scheduling**: `vercel.json` was **not** modified by this build.
   Vercel's Hobby plan caps cron jobs at 2, and both existing slots are
   already used by `/api/cron/sync` and `/api/cron/publish-posts`. The two
   new routes (`/api/cron/publish-social`, `/api/cron/generate-social-content`)
   exist and are `CRON_SECRET`-protected, but nothing calls them on a
   schedule yet. Pick one:
   - **Upgrade to a Vercel plan with more cron jobs** and add both paths to
     `vercel.json`'s `crons` array (see the existing two entries for the
     format).
   - **Composite them into the existing two cron routes** — add a call to
     `publishScheduledSocialPosts()` inside `app/api/cron/publish-posts/route.ts`'s
     handler array, and `generateDailySocialContent()` inside
     `app/api/cron/sync/route.ts`'s, the same way those files already run
     several independent tasks per invocation.
   - **Trigger them externally** (an outside scheduler calling the URL with
     the `x-cron-secret` header) if neither of the above fits.

## 6. Facebook Page / Instagram Professional connection

The dashboard's Social Automation page shows Facebook and Instagram as two
separate facts, because a Page can be connected with no Instagram account
linked to it: connect the Facebook Page first, then link an Instagram
Professional (Business/Creator) account to that Page in Meta Business
Suite, then reconnect from this app to pick it up.

## 7. Media requirements

Instagram fetches media **by public HTTPS URL** at publish time — a local
file path or a browser `blob:` URL is never enough. This is why the Media
Manager uploads to Vercel Blob (`access: 'public'`) rather than storing
files any other way. Current provisional limits (`lib/social/media.ts`,
reconfirm against live docs before relying on them):

- Images: JPEG/PNG/WebP, ≤ 8MB
- Video: MP4/QuickTime, ≤ 100MB
- Carousel: 2–10 items, images only in this build (a video carousel item is
  rejected — publish a video as a single Reel instead)

## 8. Safe testing

Every automated test in this repo mocks the Meta Graph API via `fetch` or a
module mock — **no test makes a real network call to Meta**. To test
against real Meta APIs before enabling anything for real customers:

1. Add your own Facebook account + Page as a tester on the Meta app
   (Development mode — works before App Review).
2. Connect from `/dashboard/social`.
3. Create a draft in the Content Calendar, approve it, and use **Publish
   now** for a single, deliberate, real post — Auto Publish stays off, so
   nothing goes out on a schedule while you're testing.
4. Only enable Auto Publish (below) once you're satisfied.

## 9. Enabling / disabling Auto Publish

`/dashboard/social` → Social Automation settings → **Facebook Auto
Publish** / **Instagram Auto Publish** toggles. Both default off. While
off, a due scheduled post just waits — the cron publisher (once scheduled,
see §5) leaves it alone and it must be published manually. Turn a toggle on
to let the cron actually publish due, approved, scheduled posts for that
platform automatically. Turn it back off at any time to return to
manual-only.

## 10. Token expiry

- The Page access token has no fixed expiry but is not permanent — see
  §2 step 2. If Meta rejects it (classified `META_TOKEN_EXPIRED`), the
  Social Connection page and System Health's "Meta Connection" line will
  show the error; reconnect from `/dashboard/social`.
- Media Manager (Vercel Blob) URLs do not expire.

## 11. Rate limits

- **App-level throttling** (Graph API error codes 4/17/32/613): classified
  `META_RATE_LIMITED`. The cron publisher reverts the post to `scheduled`
  and stops that run's loop rather than retrying every other due post
  immediately.
- **Instagram's daily publishing cap** (error code 9): also classified
  `META_RATE_LIMITED` — same handling.
- **Retry policy**: a post stuck on a retryable error for
  `maxRetries` consecutive cron runs (default 5, editable in settings) is
  marked `failed` instead of retried forever, so a persistent problem
  becomes visible rather than silently repeating.

## 12. Common errors

| Error | Meaning | What to do |
| --- | --- | --- |
| `META_NOT_CONFIGURED` | Env vars missing or `META_SOCIAL_ENABLED` is off | Set the vars in §4 |
| `META_ENCRYPTION_NOT_CONFIGURED` | `META_ENCRYPTION_KEY` missing/invalid | Generate and set it (§5.3) |
| `META_NOT_CONNECTED` | No Facebook Page connected yet | Connect from `/dashboard/social` |
| `META_TOKEN_EXPIRED` | Page token invalidated | Reconnect |
| `META_PERMISSION_ERROR` | A required permission isn't granted/approved | Check App Review status; re-consent |
| `META_RATE_LIMITED` | Temporary — see §11 | Wait for the next cron run, or retry manually later |
| `META_DUPLICATE_CONTENT` | Identical content already scheduled/published recently | Edit the content, or turn off duplicate protection in settings if intentional |
| `META_MEDIA_INVALID` | Wrong file type, too large, or a video in a carousel | Fix the media per §7 |

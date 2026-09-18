# JK Interior — Google Business Profile Automation

Admin console and automation system for the **JK Interior** Google Business Profile.

- **Business:** JK Interior
- **Website:** https://www.jkinterior.online
- **Google Cloud project:** `jk-interior-gbp-automation`
- **Hosting:** Vercel (serverless functions + Vercel Cron)

> **Google Business Profile API approval is currently pending.**
> The application is built to deploy and run *now*. Every Google-dependent
> screen degrades to a clear "approval pending" state instead of failing or
> showing invented data. When Google approves the project, adding the
> environment variables is all that is needed — no code changes.

---

## Contents

1. [What it does](#1-what-it-does)
2. [Local installation](#2-local-installation)
3. [Environment variables](#3-environment-variables)
4. [Google Cloud setup](#4-google-cloud-setup)
5. [OAuth configuration](#5-oauth-configuration)
6. [Google Business Profile API configuration](#6-google-business-profile-api-configuration)
7. [Vercel deployment](#7-vercel-deployment)
8. [Vercel environment variables](#8-vercel-environment-variables)
9. [Cron configuration](#9-cron-configuration)
10. [Activating Google integration after approval](#10-activating-google-integration-after-approval)
11. [Security precautions](#11-security-precautions)
12. [Architecture](#12-architecture)
13. [API reference](#13-api-reference)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. What it does

| Module | Status |
| --- | --- |
| Google OAuth 2.0 (`business.manage` scope) | Built — needs credentials |
| Business Profile account / location connection | Built — needs API approval |
| Review retrieval | Built — needs API approval |
| AI reply drafts (English / Hindi / Hinglish) | Built — needs `OPENAI_API_KEY` |
| Manual approval before publishing | Built and enforced server-side |
| Business Profile post creation | Built — needs API approval |
| Scheduled posts via Vercel Cron | Built |
| Performance / statistics | Built — needs API approval |
| Secure cron endpoints | Built |
| Admin dashboard (light, mobile-first) | Built |
| Health / status monitoring | Built — `/api/health` works today |

### The review reply workflow

```
Google review  →  AI draft  →  Dashboard  →  You approve / edit  →  Published to Google
```

Automatic publishing is **off by design**. Two independent gates guard it:
a draft must be explicitly `approved`, *and* auto-publish must be turned on
(Settings toggle or `AUTO_PUBLISH_REPLIES=true`). With auto-publish off — the
default — approved replies wait for you to press **Publish**.

---

## 2. Local installation

Requires Node.js 20 or newer.

```bash
git clone https://github.com/jitendrakumarraj831-byte/jk-interior-gbp-automation.git
cd jk-interior-gbp-automation

npm install
cp .env.example .env.local     # fill in what you have; blanks are fine

npm run dev                    # http://localhost:3000
```

The app starts with **no** configuration. The dashboard opens, `/api/health`
responds, and every screen tells you exactly which environment variable is
still missing.

### Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify` | lint + typecheck + build, in order |
| `npm run get-refresh-token` | One-time local helper to obtain `GOOGLE_REFRESH_TOKEN` |

---

## 3. Environment variables

Copy `.env.example` → `.env.local`. **Never commit `.env.local`.**

### Required to connect Google

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 web client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | Must match the OAuth client exactly |
| `GOOGLE_REFRESH_TOKEN` | Long-lived token for the Business Profile owner |

### Required in production

| Variable | Purpose |
| --- | --- |
| `CRON_SECRET` | Authenticates every `/api/cron/*` request. Without it, cron endpoints reject everything. |
| `ADMIN_PASSWORD` | Locks the dashboard and all write APIs |
| `SESSION_SECRET` | Signs the admin session cookie |

### Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | Enables AI reply drafting. Without it, drafting is disabled (everything else works). |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model used for drafts |
| `UPSTASH_REDIS_REST_URL` | — | Durable storage for drafts, posts, run log |
| `UPSTASH_REDIS_REST_TOKEN` | — | Paired with the URL above |
| `GBP_ACCOUNT_NAME` | auto-detected | Pin the account, e.g. `accounts/1234567890` |
| `GBP_LOCATION_NAME` | auto-detected | Pin the location, e.g. `locations/1234567890` |
| `AUTO_PUBLISH_REPLIES` | `false` | Keep this `false`. |

Generate the two random secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### About storage

Vercel functions are stateless. Without `UPSTASH_REDIS_REST_*`, reply drafts,
posts and the run log live in memory and are **lost on every cold start**. That
is fine for previewing, not for real automation. Create a free Upstash Redis
database, copy the two REST values, and everything persists. The dashboard warns
you whenever the durable store is missing.

---

## 4. Google Cloud setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select
   the project **`jk-interior-gbp-automation`**.
2. Go to **APIs & Services → Library** and enable:
   - Google My Business API *(reviews and local posts — the v4 surface)*
   - My Business Account Management API
   - My Business Business Information API
   - Business Profile Performance API
3. Go to **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - App name: `JK Interior GBP Automation`
   - Support email and developer email: your address
   - Authorised domain: `jkinterior.online` (and your Vercel domain)
   - Scope: `https://www.googleapis.com/auth/business.manage`
   - Add the Google account that owns the JK Interior profile as a **Test user**
     while the app is unverified.

> Until Google approves your Business Profile API request, these APIs stay at
> **0 requests per minute quota**. Enabling them is necessary but not sufficient
> — approval is what actually unlocks the calls.

---

## 5. OAuth configuration

**APIs & Services → Credentials → Create credentials → OAuth client ID →
Web application.**

Authorised redirect URIs — add all of these:

```
http://localhost:3000/api/auth/google/callback
http://localhost:5858/callback
https://<your-vercel-domain>/api/auth/google/callback
```

(The `localhost:5858` entry is only for the `npm run get-refresh-token` helper.)

Copy the client ID and client secret into `.env.local`.

### Getting a refresh token

**Option A — local helper (recommended for the first token):**

```bash
# in .env.local, temporarily set:
#   GOOGLE_REDIRECT_URI=http://localhost:5858/callback
npm run get-refresh-token
```

Open the printed URL while signed in as the Business Profile **owner**, approve,
and the refresh token is printed to your terminal. Copy it into `.env.local` and
into Vercel. It is never written to disk and never leaves your machine.

**Option B — in the app:** set the three OAuth variables, deploy, then use
**Dashboard → Google Connection → Connect Google**. The refresh token is stored
server-side and is never rendered in the browser.

Set `GOOGLE_REDIRECT_URI` back to the real callback URL afterwards.

---

## 6. Google Business Profile API configuration

Google requires a separate access request on top of enabling the APIs:

1. Submit the [Business Profile APIs access request form](https://developers.google.com/my-business/content/prereqs).
2. Wait for approval (typically a few days to several weeks).
3. Until then, every call returns HTTP 403. The app classifies those responses
   and shows **"Google Business Profile API approval pending"** rather than a
   generic error — see `lib/errors.ts`.

APIs used once approved:

| API | Used for |
| --- | --- |
| `mybusinessaccountmanagement.googleapis.com/v1` | Listing accounts |
| `mybusinessbusinessinformation.googleapis.com/v1` | Listing locations |
| `mybusiness.googleapis.com/v4` | Reviews, replies, local posts |
| `businessprofileperformance.googleapis.com/v1` | Daily metrics |

### Metrics actually available

Only Google's documented `DailyMetric` values are requested — nothing is
invented or derived:

`BUSINESS_IMPRESSIONS_DESKTOP_MAPS`, `BUSINESS_IMPRESSIONS_DESKTOP_SEARCH`,
`BUSINESS_IMPRESSIONS_MOBILE_MAPS`, `BUSINESS_IMPRESSIONS_MOBILE_SEARCH`,
`BUSINESS_CONVERSATIONS`, `BUSINESS_DIRECTION_REQUESTS`, `CALL_CLICKS`,
`WEBSITE_CLICKS`, `BUSINESS_BOOKINGS`, `BUSINESS_FOOD_ORDERS`,
`BUSINESS_FOOD_MENU_CLICKS`.

Google's performance data lags roughly two days, so the requested range always
ends two days before today.

---

## 7. Vercel deployment

1. Push this repository to GitHub.
2. In Vercel, **Add New → Project** and import the repository.
3. Framework preset: **Next.js** (auto-detected). No build overrides needed.
4. Add the environment variables (next section) **before** the first deploy, or
   redeploy after adding them.
5. Deploy. `vercel.json` registers the cron jobs automatically.

The build does not require any Google credentials — it succeeds with an empty
environment, which is what makes deploying before approval possible.

---

## 8. Vercel environment variables

**Project → Settings → Environment Variables.** Add to *Production* (and
*Preview* if you use preview deployments):

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI        = https://<your-domain>/api/auth/google/callback
GOOGLE_REFRESH_TOKEN
OPENAI_API_KEY
CRON_SECRET
ADMIN_PASSWORD
SESSION_SECRET
UPSTASH_REDIS_REST_URL     (recommended)
UPSTASH_REDIS_REST_TOKEN   (recommended)
```

All of these are server-side only. None is prefixed `NEXT_PUBLIC_`, so none
reaches the browser. Redeploy after changing any of them.

---

## 9. Cron configuration

`vercel.json` ships with two **daily** jobs, which fits inside Vercel's Hobby
plan limits (2 cron jobs, once per day) so the project deploys on any plan:

| Path | Schedule (UTC) | Does |
| --- | --- | --- |
| `/api/cron/sync` | `30 2 * * *` | Sync reviews → draft replies → refresh performance |
| `/api/cron/publish-posts` | `30 3 * * *` | Publish posts whose scheduled time has passed |

On a **Pro** plan you can run them far more often. Replace the `crons` array:

```json
"crons": [
  { "path": "/api/cron/sync-reviews",     "schedule": "0 */2 * * *" },
  { "path": "/api/cron/generate-drafts",  "schedule": "15 */2 * * *" },
  { "path": "/api/cron/publish-posts",    "schedule": "*/15 * * * *" },
  { "path": "/api/cron/sync-performance", "schedule": "0 4 * * *" }
]
```

### Authentication

Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Every cron route calls
`assertCronAuthorized()` **before doing any work**:

- no `CRON_SECRET` configured → `503`, endpoint disabled
- wrong secret → `401`
- correct secret → runs

Comparison is constant-time. Trigger a job manually with:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/sync
```

Never put `CRON_SECRET` in client-side code — the dashboard deliberately cannot
trigger cron jobs for this reason.

---

## 10. Activating Google integration after approval

When the approval email arrives:

1. Confirm the four APIs from §4 are **Enabled** and quota is above zero.
2. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and
   `GOOGLE_REFRESH_TOKEN` in Vercel, then redeploy.
3. Open **Dashboard → Google Connection**. It should read **Connected**, and
   your accounts and locations should list.
4. Pick the JK Interior location (or pin it with `GBP_ACCOUNT_NAME` /
   `GBP_LOCATION_NAME`).
5. Check `/api/health` — `googleConfigured` flips to `true`.
6. Open **Reviews**. Live reviews load.
7. Add `OPENAI_API_KEY` to enable drafting, then **Drafts** to approve replies.

No code changes are required at any step.

---

## 11. Security precautions

**Implemented**

- **Environment validation** — every variable parsed through a Zod schema at
  startup (`lib/config.ts`). Missing values degrade gracefully, never crash.
- **Server-side credentials only** — no `NEXT_PUBLIC_*` variable exists. Client
  components import only `lib/client.ts`, which talks to our own API routes.
- **OAuth CSRF protection** — signed `state` stored in an httpOnly cookie and
  compared on callback; expires after 10 minutes.
- **Refresh token never displayed** — stored server-side, reported to the UI as
  a boolean only.
- **Admin session** — HMAC-signed, httpOnly, `SameSite=Lax`, `Secure` in
  production, 12-hour expiry. Verified server-side in the dashboard layout and
  in every API route via `assertAdmin()`; middleware only handles redirects.
- **Constant-time comparison** for the admin password, cron secret and OAuth
  state.
- **Cron authentication** on every `/api/cron/*` route, before any work.
- **Input validation** — every request body parsed with Zod; URLs restricted to
  `http`/`https`; text sanitised and length-capped before storage.
- **Safe logging** — `lib/logger.ts` redacts anything matching a token, secret,
  password or key pattern before it reaches the log drain.
- **Error handling** — `handleRoute()` wraps every route so no stack trace or
  credential can leak to a client.
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`; `Cache-Control: no-store` on all APIs.
- **No open redirect** — `?next=` on `/login` accepts same-origin paths only.
- **`robots: noindex`** on the whole app.

**Your responsibilities**

- Never commit `.env.local`. It is git-ignored — keep it that way.
- Never paste a refresh token, client secret, `OPENAI_API_KEY` or `CRON_SECRET`
  into an issue, a commit, a screenshot or a chat.
- Set `ADMIN_PASSWORD` and `SESSION_SECRET` before going live. Without them the
  dashboard runs in **open mode** and warns you on every page.
- Rotate `CRON_SECRET` and `SESSION_SECRET` periodically.
- Revoke a leaked refresh token at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## 12. Architecture

```
app/
  page.tsx                       Public landing page
  login/                         Admin sign-in
  dashboard/
    layout.tsx                   Shell + real session verification
    page.tsx + overview.tsx      Overview cards
    reviews/  drafts/  posts/  scheduled/
    performance/  connection/  automation/  settings/
  api/
    health/                      Public health probe
    auth/google/                 OAuth start
    auth/google/callback/        OAuth callback
    auth/google/disconnect/
    auth/login/  auth/logout/
    accounts/                    Accounts + locations
    reviews/                     List reviews
    reviews/reply/               Generate / edit / approve / discard drafts
    reviews/reply/publish/       The only path that publishes a reply
    posts/                       List + create
    posts/[id]/                  Update / delete
    posts/[id]/publish/          Publish one post
    performance/                 Daily metrics
    status/                      Dashboard summary
    settings/                    Runtime settings
    cron/sync                    Daily: reviews → drafts → performance
    cron/publish-posts           Publish due posts
    cron/sync-reviews            Individual tasks, for manual triggering
    cron/generate-drafts
    cron/sync-performance

lib/
  config.ts          Environment validation, feature flags, business profile
  security.ts        Cron auth, admin sessions, OAuth state, validation, responses
  google-auth.ts     OAuth 2.0 client, token exchange, refresh handling
  google-business.ts REST client for all four Google APIs
  ai-reply.ts        Reply drafting + language detection
  tasks.ts           Automation tasks shared by cron and the dashboard
  repository.ts      Drafts, posts, caches, run log, settings
  store.ts           Upstash Redis REST, or in-memory fallback
  connection.ts      Account/location resolution and connection state
  errors.ts          Error taxonomy + Google 403 classification
  logger.ts          Redacting logger
  types.ts           Shared domain types
  client.ts          The only module client components import
  cron.ts            Cron route wrapper

components/
  ui.tsx             Cards, badges, buttons, alerts, stat tiles, stars
  nav.tsx            Desktop rail + mobile tab bar and sheet

middleware.ts        Redirects unauthenticated visitors to /login
scripts/get-refresh-token.mjs
```

**Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4,
`google-auth-library`, `openai`, `zod`. Google APIs are called over plain
`fetch`, which keeps the bundle small and gives exact control over error
handling — the v4 Reviews surface has no official client library anyway.

**Design:** light-only, mobile-first. A bottom tab bar covers the five most-used
sections; everything else is one tap away in the sheet. Inputs stay 16px on
mobile so iOS does not zoom on focus.

---

## 13. API reference

Every endpoint returns the same envelope:

```json
{ "status": "ok | pending_approval | not_connected | error",
  "data": null, "message": "...", "code": "..." }
```

`status` is what the UI branches on — `pending_approval` renders the waiting-on-
Google notice, not an error.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | public | Health probe, booleans only |
| `GET` | `/api/status` | admin | Dashboard summary |
| `GET` | `/api/accounts` | admin | Connection state |
| `GET` | `/api/reviews` | admin | Reviews + local reply state |
| `GET` | `/api/reviews/reply` | admin | List drafts |
| `POST` | `/api/reviews/reply` | admin | Generate a draft |
| `PATCH` | `/api/reviews/reply` | admin | Edit / approve / unapprove |
| `DELETE` | `/api/reviews/reply?id=` | admin | Discard a draft |
| `POST` | `/api/reviews/reply/publish` | admin | **Publish an approved reply** |
| `GET` `POST` | `/api/posts` | admin | List / create |
| `PATCH` `DELETE` | `/api/posts/{id}` | admin | Update / delete |
| `POST` | `/api/posts/{id}/publish` | admin | Publish a post |
| `GET` | `/api/performance?days=30` | admin | Daily metrics |
| `GET` `PATCH` | `/api/settings` | admin | Runtime settings |
| `GET` | `/api/auth/google` | admin | Start OAuth |
| `GET` | `/api/auth/google/callback` | — | OAuth callback |
| `POST` | `/api/auth/google/disconnect` | admin | Clear stored connection |
| `POST` | `/api/auth/login` `/logout` | — | Admin session |
| `GET` `POST` | `/api/cron/*` | `CRON_SECRET` | Automation tasks |

"admin" means an ADMIN_PASSWORD session when one is configured; with no
`ADMIN_PASSWORD` set the app runs in open mode and says so.

---

## 14. Troubleshooting

**"Google Business Profile API approval pending"**
Expected until Google approves the project. Verify with:
```bash
curl https://<your-domain>/api/health
```

**`redirect_uri_mismatch`**
`GOOGLE_REDIRECT_URI` must match an entry on the OAuth client character for
character, including `https://` and any trailing path.

**"Google did not return a refresh token"**
Google only issues one on first consent. Remove the app at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions)
and connect again.

**Drafts and posts disappear**
The in-memory store was wiped by a cold start. Configure
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

**Cron returns 401 / 503**
`CRON_SECRET` is missing, or the header does not match. Check the variable in
Vercel and redeploy.

**Performance returns empty series**
Normal for new or low-traffic profiles, and Google's data lags about two days.

**"No locations found"**
The connected Google account must *manage* the JK Interior profile. Pin the
location with `GBP_ACCOUNT_NAME` / `GBP_LOCATION_NAME` if auto-detection picks
the wrong one.

---

## Licence

Private and proprietary to JK Interior.

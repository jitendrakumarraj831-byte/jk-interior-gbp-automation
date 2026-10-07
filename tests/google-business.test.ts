/**
 * The Google client: payloads we send, responses we parse, and the retry /
 * recording behaviour of the one function every call goes through.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mutableEnv = process.env as Record<string, string | undefined>;

vi.mock('@/lib/google-auth', () => ({
  getAccessToken: async () => 'ya29.fake',
}));

type Reply = { status: number; body?: unknown };
let queue: Reply[] = [];
const requests: { url: string; init: RequestInit }[] = [];

function reply(...replies: Reply[]) {
  queue = [...replies];
}

async function load() {
  vi.resetModules();
  const business = await import('@/lib/google-business');
  const access = await import('@/lib/gbp-access');
  return { business, access };
}

beforeEach(() => {
  delete mutableEnv.UPSTASH_REDIS_REST_URL;
  delete mutableEnv.UPSTASH_REDIS_REST_TOKEN;
  requests.length = 0;
  queue = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), init });
      const next = queue.shift() ?? { status: 200, body: {} };
      return new Response(JSON.stringify(next.body ?? {}), { status: next.status });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ----------------------------- resource names ---------------------------- */

describe('resource names', () => {
  it('buildLocationPath accepts every spelling and never doubles segments', async () => {
    const { business } = await load();
    expect(business.buildLocationPath('accounts/1', 'locations/2')).toBe('accounts/1/locations/2');
    expect(business.buildLocationPath('1', '2')).toBe('accounts/1/locations/2');
    expect(business.buildLocationPath('accounts/1', 'accounts/1/locations/2')).toBe(
      'accounts/1/locations/2',
    );
    expect(business.bareLocationName('accounts/1/locations/2')).toBe('locations/2');
  });

  it('refuses ids that could add a path segment or query string', async () => {
    const { business } = await load();
    expect(() => business.buildLocationPath('accounts/1', 'locations/2/../../x')).toThrow();
    expect(() => business.buildLocationPath('accounts/1', 'locations/2?x=1')).toThrow();
    expect(() => business.normalizeAccountName('accounts/1/other')).toThrow();
  });

  it('only genuine review resource names can be replied to', async () => {
    const { business } = await load();
    expect(business.isReviewResourceName('accounts/1/locations/2/reviews/AbC-123_x')).toBe(true);
    for (const bad of [
      'accounts/1/locations/2/reviews/../../x',
      'accounts/1/locations/2/reviews/x?foo=bar',
      'accounts/1/locations/2/reviews/x/reply',
      'locations/2/reviews/x',
      'https://evil.example/reviews/x',
      '',
    ]) {
      expect(business.isReviewResourceName(bad)).toBe(false);
    }
    reply({ status: 200 });
    await expect(
      business.publishReviewReply('accounts/1/locations/2/reviews/x/../../..', 'hi'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(requests).toHaveLength(0); // nothing was sent
  });
});

/* -------------------------------- reviews -------------------------------- */

describe('reviews', () => {
  const raw = (id: string, star: string | undefined, create = '2026-09-01T00:00:00Z', extra = {}) => ({
    reviewId: id,
    starRating: star,
    comment: `comment ${id}`,
    createTime: create,
    updateTime: create,
    reviewer: { displayName: `Person ${id}` },
    ...extra,
  });

  it('maps every star rating, and detects an existing reply', async () => {
    const { business } = await load();
    reply({
      status: 200,
      body: {
        averageRating: 4.2,
        totalReviewCount: 5,
        reviews: [
          raw('a', 'ONE'),
          raw('b', 'TWO'),
          raw('c', 'THREE'),
          raw('d', 'FOUR'),
          raw('e', 'FIVE', undefined, { reviewReply: { comment: 'Thanks!', updateTime: '2026-09-02T00:00:00Z' } }),
        ],
      },
    });
    const result = await business.listReviews('accounts/1/locations/2');
    expect(result.reviews.map((r) => r.starRating).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(result.reviews.find((r) => r.reviewId === 'e')?.existingReply?.comment).toBe('Thanks!');
    expect(result.reviews.find((r) => r.reviewId === 'e')?.replyStatus).toBe('replied_on_google');
    expect(result.reviews.find((r) => r.reviewId === 'a')?.replyStatus).toBe('no_reply');
    expect(result.averageRating).toBe(4.2);
    expect(result.totalReviewCount).toBe(5);
  });

  it('a blank reply is NOT treated as a reply', async () => {
    const { business } = await load();
    reply({ status: 200, body: { reviews: [raw('a', 'FIVE', undefined, { reviewReply: { comment: '  ' } })] } });
    const { reviews } = await business.listReviews('accounts/1/locations/2');
    expect(reviews[0]?.existingReply).toBeNull();
  });

  it('a review with no usable star rating is dropped, never defaulted to five stars', async () => {
    const { business } = await load();
    reply({ status: 200, body: { reviews: [raw('x', undefined), raw('y', 'STAR_RATING_UNSPECIFIED'), raw('z', 'ONE')] } });
    const { reviews } = await business.listReviews('accounts/1/locations/2');
    expect(reviews.map((r) => r.reviewId)).toEqual(['z']);
    expect(reviews[0]?.starRating).toBe(1);
  });

  it('follows pagination, drops duplicates across pages, and sorts newest first', async () => {
    const { business } = await load();
    reply(
      { status: 200, body: { reviews: [raw('old', 'FIVE', '2026-01-01T00:00:00Z'), raw('mid', 'FOUR', '2026-05-01T00:00:00Z')], nextPageToken: 'p2' } },
      { status: 200, body: { reviews: [raw('mid', 'FOUR', '2026-05-01T00:00:00Z'), raw('new', 'ONE', '2026-09-01T00:00:00Z')] } },
    );
    const { reviews } = await business.listReviews('accounts/1/locations/2');
    expect(reviews.map((r) => r.reviewId)).toEqual(['new', 'mid', 'old']);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toContain('pageToken=p2');
  });

  it('anonymous and unnamed reviewers get safe display names', async () => {
    const { business } = await load();
    reply({
      status: 200,
      body: {
        reviews: [
          { reviewId: 'a', starRating: 'FIVE', reviewer: { isAnonymous: true } },
          { reviewId: 'b', starRating: 'FIVE' },
        ],
      },
    });
    const { reviews } = await business.listReviews('accounts/1/locations/2');
    expect(reviews.map((r) => r.reviewerName).sort()).toEqual(['Anonymous', 'Google user']);
  });

  it('publishing a reply is a PUT with only the comment', async () => {
    const { business } = await load();
    await business.publishReviewReply('accounts/1/locations/2/reviews/r1', 'Thank you.');
    expect(requests[0]?.init.method).toBe('PUT');
    expect(requests[0]?.url).toBe('https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/r1/reply');
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({ comment: 'Thank you.' });
  });
});

/* ------------------------------- local posts ------------------------------ */

describe('Local Post payload', () => {
  const base = {
    id: 'p',
    type: 'general' as const,
    title: 'Title',
    description: 'Body',
    cta: { type: 'NONE' as const },
    status: 'draft' as const,
    createdAt: '',
    updatedAt: '',
  };

  it('a standard post folds the title into the summary (Google has no title field)', async () => {
    const { business } = await load();
    const body = business.toLocalPost(base);
    expect(body).toMatchObject({ topicType: 'STANDARD', languageCode: 'en', summary: 'Title\n\nBody' });
    expect(body).not.toHaveProperty('callToAction');
    expect(body).not.toHaveProperty('media');
  });

  it('an offer carries its title in event and starts when it goes live, not at scheduledFor', async () => {
    const { business } = await load();
    const now = new Date('2026-10-07T10:00:00Z');
    const body = business.toLocalPost(
      { ...base, type: 'offer', title: 'Diwali offer', scheduledFor: '2026-10-01T00:00:00Z' },
      now,
    );
    expect(body).toMatchObject({
      topicType: 'OFFER',
      summary: 'Body',
      event: {
        title: 'Diwali offer',
        schedule: { startDate: { year: 2026, month: 10, day: 7 }, endDate: { year: 2026, month: 10, day: 14 } },
      },
    });
  });

  it('CTA with a URL, CALL without, and media for an image', async () => {
    const { business } = await load();
    expect(
      business.toLocalPost({ ...base, cta: { type: 'LEARN_MORE', url: 'https://www.jkinterior.online' } }),
    ).toMatchObject({ callToAction: { actionType: 'LEARN_MORE', url: 'https://www.jkinterior.online' } });
    expect(
      business.toLocalPost({ ...base, cta: { type: 'CALL', url: 'https://ignored.example' } }).callToAction,
    ).toEqual({ actionType: 'CALL' });
    expect(business.toLocalPost({ ...base, imageUrl: 'https://cdn.example/a.jpg' }).media).toEqual([
      { mediaFormat: 'PHOTO', sourceUrl: 'https://cdn.example/a.jpg' },
    ]);
  });

  it('Hindi text is sent with languageCode hi', async () => {
    const { business } = await load();
    expect(business.toLocalPost({ ...base, description: 'दिवाली की शुभकामनाएं' }).languageCode).toBe('hi');
  });

  it('refuses what Google would reject, with a message instead of an opaque 400', async () => {
    const { business } = await load();
    expect(() => business.toLocalPost({ ...base, description: 'x'.repeat(1500) })).toThrow(/1500/);
    expect(() => business.toLocalPost({ ...base, type: 'offer', title: 'x'.repeat(59) })).toThrow(/58/);
    expect(() => business.toLocalPost({ ...base, cta: { type: 'BOOK' } })).toThrow(/link/);
  });

  it('createLocalPost posts to the localPosts collection and returns the resource name', async () => {
    const { business } = await load();
    reply({ status: 200, body: { name: 'accounts/1/locations/2/localPosts/9' } });
    expect(await business.createLocalPost('accounts/1/locations/2', base)).toBe(
      'accounts/1/locations/2/localPosts/9',
    );
    expect(requests[0]?.url).toBe('https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts');
    expect(requests[0]?.init.method).toBe('POST');
  });

  it('a 200 without a name is an error, not a published post', async () => {
    const { business } = await load();
    reply({ status: 200, body: {} });
    await expect(business.createLocalPost('accounts/1/locations/2', base)).rejects.toMatchObject({
      code: 'GOOGLE_API_ERROR',
    });
  });
});

/* ------------------------------- performance ------------------------------ */

describe('performance', () => {
  const series = (metric: string, values: Record<string, string | undefined>) => ({
    dailyMetric: metric,
    timeSeries: {
      datedValues: Object.entries(values).map(([date, value]) => {
        const [year, month, day] = date.split('-').map(Number);
        return { date: { year, month, day }, ...(value === undefined ? {} : { value }) };
      }),
    },
  });

  it('sums exactly what Google returned; an omitted value is a zero day', async () => {
    const { business } = await load();
    reply({
      status: 200,
      body: {
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: [
              series('CALL_CLICKS', { '2026-10-03': '4', '2026-10-02': '5', '2026-10-01': undefined }),
              series('WEBSITE_CLICKS', { '2026-10-01': '3' }),
              series('NOT_A_REAL_METRIC', { '2026-10-01': '99' }),
            ],
          },
        ],
      },
    });
    const snapshot = await business.fetchPerformance('locations/2', { days: 7 });
    const calls = snapshot.series.find((s) => s.metric === 'CALL_CLICKS')!;
    expect(calls.total).toBe(9);
    expect(calls.daily.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(snapshot.series.find((s) => s.metric === 'WEBSITE_CLICKS')?.total).toBe(3);
    expect(snapshot.series.map((s) => s.metric)).not.toContain('NOT_A_REAL_METRIC');
  });

  it('never produces NaN or negative values from malformed data', async () => {
    const { business } = await load();
    reply({
      status: 200,
      body: { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [series('CALL_CLICKS', { '2026-10-01': 'abc', '2026-10-02': '-5', '2026-10-03': '2' })] }] },
    });
    const snapshot = await business.fetchPerformance('locations/2');
    expect(snapshot.series[0]?.total).toBe(2);
  });

  it('asks for exactly N inclusive days ending two days before today', async () => {
    const { business } = await load();
    reply({ status: 200, body: {} });
    const now = new Date('2026-10-07T12:00:00Z');
    const snapshot = await business.fetchPerformance('accounts/1/locations/2', { days: 7, now });
    expect(snapshot.rangeEnd).toBe('2026-10-05');
    expect(snapshot.rangeStart).toBe('2026-09-29'); // 7 inclusive days
    expect(snapshot.days).toBe(7);
    expect(snapshot.locationName).toBe('locations/2');

    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe('/v1/locations/2:fetchMultiDailyMetricsTimeSeries');
    expect(url.searchParams.get('dailyRange.start_date.day')).toBe('29');
    expect(url.searchParams.get('dailyRange.end_date.day')).toBe('5');
    expect(url.searchParams.getAll('dailyMetrics')).toContain('BUSINESS_IMPRESSIONS_MOBILE_SEARCH');
  });

  it('supports 7, 30, 90 days and clamps absurd ranges', async () => {
    const { business } = await load();
    for (const [asked, expected] of [[7, 7], [30, 30], [90, 90], [0, 1], [99999, 540], [12.9, 12]] as const) {
      reply({ status: 200, body: {} });
      const snapshot = await business.fetchPerformance('locations/2', { days: asked });
      expect(snapshot.days).toBe(expected);
    }
  });
});

/* ----------------------- recording, retries and errors -------------------- */

describe('googleFetch: recording, retries and classification', () => {
  it('records every success against the API that answered', async () => {
    const { business, access } = await load();
    reply({ status: 200, body: { accounts: [] } });
    await business.listAccounts();
    const snapshot = await access.readAccess();
    expect(snapshot.status).toBe('available');
    expect(snapshot.services.map((s) => s.service)).toEqual(['accounts']);
  });

  it('retries a safe GET once on a 503, and records the eventual success', async () => {
    vi.useFakeTimers();
    const { business, access } = await load();
    reply({ status: 503, body: {} }, { status: 200, body: { accounts: [] } });
    const pending = business.listAccounts();
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(requests).toHaveLength(2);
    expect((await access.readAccess()).status).toBe('available');
  });

  it('does NOT retry a 429 — hammering a limit only prolongs it', async () => {
    const { business } = await load();
    reply({ status: 429, body: { error: { details: [{ metadata: { quota_limit_value: '300' } }] } } });
    await expect(business.listAccounts()).rejects.toMatchObject({ code: 'GBP_RATE_LIMITED' });
    expect(requests).toHaveLength(1);
  });

  it('does NOT retry a write (POST) even on a 503 — it might have been created', async () => {
    const { business } = await load();
    reply({ status: 503, body: {} });
    await expect(
      business.createLocalPost('accounts/1/locations/2', {
        id: 'p', type: 'general', title: 'T', description: 'B', cta: { type: 'NONE' }, status: 'draft', createdAt: '', updatedAt: '',
      }),
    ).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR' });
    expect(requests).toHaveLength(1);
  });

  it('a network failure becomes a clear, recorded, retried-once error', async () => {
    vi.useFakeTimers();
    const { business, access } = await load();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error('ECONNRESET');
    });
    const pending = business.listAccounts().catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const error = await pending;
    expect(error).toMatchObject({ code: 'GOOGLE_API_ERROR', httpStatus: 502 });
    expect(error.message).not.toContain('ECONNRESET');
    expect((await access.readAccess()).status).toBe('error');
  });

  it('sends the bearer token in a header, never in the URL', async () => {
    const { business } = await load();
    reply({ status: 200, body: { accounts: [] } });
    await business.listAccounts();
    expect(requests[0]?.url).not.toContain('ya29');
    expect((requests[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.fake');
  });
});

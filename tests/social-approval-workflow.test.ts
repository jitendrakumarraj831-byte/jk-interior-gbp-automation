/**
 * Content Calendar approval workflow — draft → approve → schedule →
 * unschedule/duplicate/delete, enforced server-side by the route handlers
 * themselves (called directly, no HTTP server involved). Also covers
 * duplicate-content protection at schedule time.
 *
 * Runs with no ADMIN_PASSWORD/SESSION_SECRET set ("development_only" admin
 * mode — see lib/security.ts#assertAdmin), which only requires a matching
 * Origin/Host pair on state-changing requests. No Meta/AI call is made.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const HOST = 'localhost:3000';

function req(method: string, body?: unknown): Request {
  return new Request(`http://${HOST}/api/social/posts`, {
    method,
    headers: {
      'content-type': 'application/json',
      host: HOST,
      origin: `http://${HOST}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function paramsOf(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function loadRoutes() {
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.SESSION_SECRET;
  return {
    posts: await import('@/app/api/social/posts/route'),
    approve: await import('@/app/api/social/posts/[id]/approve/route'),
    schedule: await import('@/app/api/social/posts/[id]/schedule/route'),
    unschedule: await import('@/app/api/social/posts/[id]/unschedule/route'),
    duplicate: await import('@/app/api/social/posts/[id]/duplicate/route'),
    detail: await import('@/app/api/social/posts/[id]/route'),
  };
}

const DRAFT_INPUT = {
  title: 'Gypsum ceiling post',
  contentType: 'gypsum_false_ceiling',
  platforms: 'facebook',
  language: 'en',
  content: 'topic',
  facebookContent: { caption: 'A clean gypsum ceiling finish.', hashtags: ['jkinterior'] },
  instagramContent: null,
};

async function createDraft(routes: Awaited<ReturnType<typeof loadRoutes>>, overrides: Partial<typeof DRAFT_INPUT> = {}) {
  const response = await routes.posts.POST(req('POST', { ...DRAFT_INPUT, ...overrides }));
  const body = await response.json();
  expect(response.status).toBe(200);
  return body.data.post as { id: string; status: string; approvalStatus: string };
}

describe('draft → approve → schedule → unschedule', () => {
  it('walks the full happy path', async () => {
    const routes = await loadRoutes();
    const draft = await createDraft(routes);
    expect(draft.status).toBe('draft');
    expect(draft.approvalStatus).toBe('pending');

    const approveRes = await routes.approve.POST(req('POST'), paramsOf(draft.id));
    const approved = (await approveRes.json()).data.post;
    expect(approveRes.status).toBe(200);
    expect(approved.status).toBe('approved');
    expect(approved.approvalStatus).toBe('approved');

    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduleRes = await routes.schedule.POST(req('POST', { scheduledAt }), paramsOf(draft.id));
    const scheduled = (await scheduleRes.json()).data.post;
    expect(scheduleRes.status).toBe(200);
    expect(scheduled.status).toBe('scheduled');
    expect(scheduled.scheduledAt).toBe(scheduledAt);

    const unscheduleRes = await routes.unschedule.POST(req('POST'), paramsOf(draft.id));
    const unscheduled = (await unscheduleRes.json()).data.post;
    expect(unscheduleRes.status).toBe(200);
    expect(unscheduled.status).toBe('approved');
    expect(unscheduled.scheduledAt).toBeUndefined();
  });

  it('rejects scheduling a post that has not been approved', async () => {
    const routes = await loadRoutes();
    const draft = await createDraft(routes);

    const res = await routes.schedule.POST(
      req('POST', { scheduledAt: new Date(Date.now() + 3600_000).toISOString() }),
      paramsOf(draft.id),
    );
    expect(res.status).toBe(409);
  });

  it('rejects approving an already-approved post', async () => {
    const routes = await loadRoutes();
    const draft = await createDraft(routes);
    await routes.approve.POST(req('POST'), paramsOf(draft.id));

    const res = await routes.approve.POST(req('POST'), paramsOf(draft.id));
    expect(res.status).toBe(409);
  });

  it('rejects scheduling a time in the past', async () => {
    const routes = await loadRoutes();
    const draft = await createDraft(routes);
    await routes.approve.POST(req('POST'), paramsOf(draft.id));

    const res = await routes.schedule.POST(
      req('POST', { scheduledAt: new Date(Date.now() - 3600_000).toISOString() }),
      paramsOf(draft.id),
    );
    expect(res.status).toBe(400);
  });
});

describe('duplicate-content protection', () => {
  it('rejects scheduling a post whose content hash matches a recently scheduled one', async () => {
    const routes = await loadRoutes();

    const first = await createDraft(routes);
    await routes.approve.POST(req('POST'), paramsOf(first.id));
    const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
    await routes.schedule.POST(req('POST', { scheduledAt }), paramsOf(first.id));

    // Identical Facebook caption, different title — the hash is over content, not title.
    const second = await createDraft(routes, { title: 'A different title, same copy' });
    await routes.approve.POST(req('POST'), paramsOf(second.id));

    const res = await routes.schedule.POST(
      req('POST', { scheduledAt: new Date(Date.now() + 7200_000).toISOString() }),
      paramsOf(second.id),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('META_DUPLICATE_CONTENT');
  });

  it('allows scheduling genuinely different content', async () => {
    const routes = await loadRoutes();

    const first = await createDraft(routes);
    await routes.approve.POST(req('POST'), paramsOf(first.id));
    await routes.schedule.POST(
      req('POST', { scheduledAt: new Date(Date.now() + 3600_000).toISOString() }),
      paramsOf(first.id),
    );

    const second = await createDraft(routes, {
      facebookContent: { caption: 'A completely different post about PVC ceilings.', hashtags: [] },
    });
    await routes.approve.POST(req('POST'), paramsOf(second.id));
    const res = await routes.schedule.POST(
      req('POST', { scheduledAt: new Date(Date.now() + 7200_000).toISOString() }),
      paramsOf(second.id),
    );
    expect(res.status).toBe(200);
  });
});

describe('duplicate (copy) action', () => {
  it('creates a fresh draft from an existing post', async () => {
    const routes = await loadRoutes();
    const original = await createDraft(routes);
    await routes.approve.POST(req('POST'), paramsOf(original.id));

    const res = await routes.duplicate.POST(req('POST'), paramsOf(original.id));
    const copy = (await res.json()).data.post;
    expect(res.status).toBe(200);
    expect(copy.id).not.toBe(original.id);
    expect(copy.status).toBe('draft');
    expect(copy.approvalStatus).toBe('pending');
    expect(copy.facebookContent).toEqual(DRAFT_INPUT.facebookContent);
  });
});

describe('editing after approval', () => {
  it('drops an approved post back to draft/pending when its content changes', async () => {
    const routes = await loadRoutes();
    const draft = await createDraft(routes);
    await routes.approve.POST(req('POST'), paramsOf(draft.id));

    const patchRes = await routes.detail.PATCH(
      req('PATCH', { facebookContent: { caption: 'Edited caption', hashtags: [] } }),
      paramsOf(draft.id),
    );
    const edited = (await patchRes.json()).data.post;
    expect(patchRes.status).toBe(200);
    expect(edited.status).toBe('draft');
    expect(edited.approvalStatus).toBe('pending');
  });

  it('rejects editing a scheduled post', async () => {
    const routes = await loadRoutes();
    const draft = await createDraft(routes);
    await routes.approve.POST(req('POST'), paramsOf(draft.id));
    await routes.schedule.POST(
      req('POST', { scheduledAt: new Date(Date.now() + 3600_000).toISOString() }),
      paramsOf(draft.id),
    );

    const res = await routes.detail.PATCH(req('PATCH', { title: 'New title' }), paramsOf(draft.id));
    expect(res.status).toBe(409);
  });
});

describe('delete', () => {
  it('deletes a draft', async () => {
    const routes = await loadRoutes();
    const draft = await createDraft(routes);
    const res = await routes.detail.DELETE(req('DELETE'), paramsOf(draft.id));
    expect(res.status).toBe(200);

    const getRes = await routes.detail.GET(req('GET'), paramsOf(draft.id));
    expect(getRes.status).toBe(404);
  });
});

beforeEach(() => {
  vi.useRealTimers();
});

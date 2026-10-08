/**
 * Persistence for everything the automation owns: reply drafts, Business
 * Profile posts, cached reviews and the automation run log.
 *
 * Backed by lib/store.ts, so it is durable when Upstash is configured and
 * in-memory otherwise.
 */

import { randomUUID } from 'node:crypto';

import { getStore, nsKey, readCollection } from './store';
import type {
  AutomationRun,
  AutomationRunName,
  GbpPost,
  PerformanceSnapshot,
  ReplyDraft,
  Review,
} from './types';

const DRAFT_PREFIX = nsKey('draft', '');
const POST_PREFIX = nsKey('post', '');
const REVIEWS_CACHE_KEY = nsKey('cache', 'reviews');
const PERFORMANCE_CACHE_PREFIX = nsKey('cache', 'performance');
const LAST_RUN_PREFIX = nsKey('automation', 'last');
const RUNS_KEY = nsKey('automation', 'runs');
const SETTINGS_KEY = nsKey('settings', 'app');

export function newId(): string {
  return randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

/* --------------------------------- drafts -------------------------------- */

function draftKey(id: string): string {
  return `${DRAFT_PREFIX}${id}`;
}

export async function listDrafts(): Promise<ReplyDraft[]> {
  const drafts = await readCollection<ReplyDraft>(DRAFT_PREFIX);
  return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getDraft(id: string): Promise<ReplyDraft | null> {
  return getStore().get<ReplyDraft>(draftKey(id));
}

export async function findDraftByReviewId(reviewId: string): Promise<ReplyDraft | null> {
  const drafts = await listDrafts();
  return drafts.find((d) => d.reviewId === reviewId) ?? null;
}

export async function saveDraft(draft: ReplyDraft): Promise<ReplyDraft> {
  const updated: ReplyDraft = { ...draft, updatedAt: nowIso() };
  await getStore().set(draftKey(draft.id), updated);
  return updated;
}

export async function deleteDraft(id: string): Promise<void> {
  await getStore().del(draftKey(id));
}

/* --------------------------------- posts --------------------------------- */

function postKey(id: string): string {
  return `${POST_PREFIX}${id}`;
}

export async function listPosts(): Promise<GbpPost[]> {
  const posts = await readCollection<GbpPost>(POST_PREFIX);
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPost(id: string): Promise<GbpPost | null> {
  return getStore().get<GbpPost>(postKey(id));
}

export async function savePost(post: GbpPost): Promise<GbpPost> {
  const updated: GbpPost = { ...post, updatedAt: nowIso() };
  await getStore().set(postKey(post.id), updated);
  return updated;
}

export async function deletePost(id: string): Promise<void> {
  await getStore().del(postKey(id));
}

function normalizeContent(post: Pick<GbpPost, 'title' | 'description'>): string {
  return `${post.title}\n${post.description}`.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** How long identical content is treated as a duplicate. */
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * An identical post (same title and text) that is already live, publishing or
 * queued within the last day. Stops a double-click, a retry or two queued
 * copies from putting the same post on Google twice.
 */
export async function findDuplicatePost(
  candidate: Pick<GbpPost, 'id' | 'title' | 'description'>,
  now = Date.now(),
): Promise<GbpPost | null> {
  const wanted = normalizeContent(candidate);
  const posts = await listPosts();
  return (
    posts.find((post) => {
      if (post.id === candidate.id) return false;
      if (!['published', 'publishing', 'scheduled'].includes(post.status)) return false;
      if (normalizeContent(post) !== wanted) return false;
      const reference = Date.parse(post.publishedAt ?? post.updatedAt);
      return Number.isFinite(reference) && now - reference < DUPLICATE_WINDOW_MS;
    }) ?? null
  );
}

/** Scheduled posts whose time has come and that have not been published. */
export async function listDuePosts(at: Date = new Date()): Promise<GbpPost[]> {
  const posts = await listPosts();
  return posts.filter(
    (p) => p.status === 'scheduled' && p.scheduledFor != null && new Date(p.scheduledFor) <= at,
  );
}

/* ----------------------------- review cache ------------------------------ */

export type ReviewCache = {
  reviews: Review[];
  averageRating: number | null;
  totalReviewCount: number;
  fetchedAt: string;
  locationPath: string;
};

export async function getCachedReviews(): Promise<ReviewCache | null> {
  return getStore().get<ReviewCache>(REVIEWS_CACHE_KEY);
}

export async function setCachedReviews(cache: ReviewCache): Promise<void> {
  await getStore().set(REVIEWS_CACHE_KEY, cache);
}

/*
 * Performance snapshots are cached PER RANGE. A single shared slot would let a
 * 90-day snapshot answer a 7-day request (and a snapshot of another location
 * answer this one), silently showing numbers for the wrong window.
 */
function performanceKey(days: number): string {
  return `${PERFORMANCE_CACHE_PREFIX}:${days}`;
}

export async function getCachedPerformance(
  days: number,
  locationName?: string,
): Promise<PerformanceSnapshot | null> {
  const snapshot = await getStore().get<PerformanceSnapshot>(performanceKey(days));
  if (!snapshot) return null;
  // Never serve another location's numbers.
  if (locationName && snapshot.locationName !== locationName) return null;
  return snapshot;
}

export async function setCachedPerformance(
  snapshot: PerformanceSnapshot,
  days: number,
): Promise<void> {
  await getStore().set(performanceKey(days), snapshot);
}

/**
 * After a reply is published, records it on the cached review so the dashboard
 * stops counting that review as unanswered without waiting for the next sync.
 */
export async function markCachedReviewReplied(reviewName: string, comment: string): Promise<void> {
  try {
    const cache = await getCachedReviews();
    if (!cache) return;
    const reviews = cache.reviews.map((review) =>
      review.name === reviewName
        ? {
            ...review,
            existingReply: { comment, updateTime: nowIso() },
            replyStatus: 'replied_on_google' as const,
          }
        : review,
    );
    await setCachedReviews({ ...cache, reviews });
  } catch {
    /* a cache — the next sync corrects it */
  }
}

/* ------------------------------ automation log --------------------------- */

const MAX_RUNS_KEPT = 40;

export async function listRuns(): Promise<AutomationRun[]> {
  return (await getStore().get<AutomationRun[]>(RUNS_KEY)) ?? [];
}

/**
 * The history list is a read-modify-write on one key, so two jobs finishing at
 * the same moment can drop an entry from it. The most recent run of each task
 * therefore also lives in its own key, which is a plain overwrite and cannot be
 * lost — that is what System Health and the dashboard read.
 */
export async function recordRun(run: AutomationRun): Promise<void> {
  const store = getStore();
  await store.set(`${LAST_RUN_PREFIX}:${run.task}`, run);
  const runs = await listRuns();
  runs.unshift(run);
  await store.set(RUNS_KEY, runs.slice(0, MAX_RUNS_KEPT));
}

export async function lastRunOf(task: AutomationRunName): Promise<AutomationRun | null> {
  const direct = await getStore().get<AutomationRun>(`${LAST_RUN_PREFIX}:${task}`);
  if (direct) return direct;
  const runs = await listRuns();
  return runs.find((r) => r.task === task) ?? null;
}

/** Most recent run of every task, newest first. */
export async function latestRuns(): Promise<AutomationRun[]> {
  const tasks: AutomationRunName[] = [
    'sync-reviews',
    'generate-drafts',
    'publish-posts',
    'publish-replies',
    'sync-performance',
  ];
  const found = await Promise.all(tasks.map((task) => lastRunOf(task)));
  return found
    .filter((run): run is AutomationRun => run !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/* -------------------------------- settings ------------------------------- */

export type AppSettings = {
  /** Account/location chosen in the dashboard; env pins override these. */
  selectedAccount?: string;
  selectedLocation?: string;
  /** Display name of selectedLocation, captured at selection time. */
  selectedLocationTitle?: string;
  /** Mirrors AUTO_PUBLISH_REPLIES but toggleable at runtime. Off by default. */
  autoPublishReplies: boolean;
  /** Generate drafts automatically when cron finds unanswered reviews. */
  autoGenerateDrafts: boolean;
  /** Ratings the automation is allowed to auto-draft for. */
  autoDraftMinStars: number;
  updatedAt: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  autoPublishReplies: false,
  autoGenerateDrafts: true,
  autoDraftMinStars: 1,
  updatedAt: new Date(0).toISOString(),
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await getStore().get<AppSettings>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = { ...current, ...patch, updatedAt: nowIso() };
  await getStore().set(SETTINGS_KEY, next);
  return next;
}

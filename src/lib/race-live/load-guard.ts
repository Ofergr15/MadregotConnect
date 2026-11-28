/**
 * RACE-LIVE LOAD GUARD (task 176, Valencia 2026-12-06).
 *
 * Race morning is the one time ~50 viewers poll the board at once while ~25 phones post positions.
 * Two brakes and one fallback, all in memory per warm instance (the same stance as
 * createRateLimiter in lib/academy/intake.ts: a brake on a loop or a retry storm, not a quota):
 *
 *   per-runner  — POST position: at most RUNNER_LIMIT writes a minute per (event, runner), checked
 *                 BEFORE any DB read. The phone's own 8 s rule (phone.ts) still applies after it.
 *   per-viewer  — GET board: at most VIEWER_LIMIT builds a minute per (event, viewer). Over it the
 *                 viewer gets their own last board back (a 200, never an error) or a 429.
 *   degraded    — when this instance is busy (too many boards building at once, or too many built
 *                 in the last 10 s), or the build itself fails, the board is served from a cached
 *                 snapshot instead of hitting the DB again: the viewer's own recent board if there
 *                 is one, else ONE shared snapshot per event built for no viewer (single-flight).
 *
 * Privacy of a cached board: the shared snapshot is liveBoard(…, viewerId = null) — opted-out
 * runners are absent and there are no positions in it at all, so it is safe for any member who
 * passed the gate. A viewer's own cached board only goes back to that same viewer, and its
 * positions are dropped once it is older than POSITION_MAX_AGE_MS, so "stop sharing" and the
 * race-window close are never held open by the cache for longer than that.
 */

export const RUNNER_LIMIT = 12; // per minute; a phone at the 8 s floor sends 7.5
export const VIEWER_LIMIT = 6; // per minute; the viewer page polls every 30 s (2)
export const WINDOW_MS = 60_000;
/** More boards than this building at once on one instance → degraded. */
export const MAX_INFLIGHT = 8;
/** More board builds than this in BUSY_WINDOW_MS on one instance → degraded. */
export const MAX_BUILDS_PER_BUSY_WINDOW = 80;
export const BUSY_WINDOW_MS = 10_000;
/** The shared snapshot is rebuilt at most this often. */
export const SHARED_TTL_MS = 15_000;
/** A viewer's own board is reused (when limited or degraded) up to this age. */
export const VIEWER_CACHE_MAX_MS = 2 * 60_000;
/** A failing DB still gets an answer from a snapshot up to this old. */
export const STALE_ON_ERROR_MAX_MS = 10 * 60_000;
/** Positions are never served from a cached board older than this. */
export const POSITION_MAX_AGE_MS = 60_000;
const MAX_KEYS = 5_000;

export type DegradedReason = 'viewer-limit' | 'busy' | 'error';

interface Snapshot<T> { at: number; board: T }

type WithRunners = { runners: Array<{ position?: unknown }> };

/** Fixed window counter. A clock that moved backwards (tests, a skewed instance) starts a new window. */
export function createWindowLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { start: number; count: number }>();
  return {
    allow(key: string, now = Date.now()): boolean {
      const h = hits.get(key);
      if (!h || now - h.start >= windowMs || now < h.start) {
        hits.set(key, { start: now, count: 1 });
        if (hits.size > MAX_KEYS) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        return true;
      }
      h.count += 1;
      return h.count <= limit;
    },
    /** Seconds until this key's window resets (for Retry-After). */
    retryAfterSec(key: string, now = Date.now()): number {
      const h = hits.get(key);
      if (!h) return 0;
      return Math.max(1, Math.ceil((h.start + windowMs - now) / 1000));
    },
    reset() { hits.clear(); },
  };
}

/** Drop positions from a cached board that is too old to vouch for them. */
export function withoutStalePositions<T extends WithRunners>(board: T, ageMs: number): T {
  if (ageMs <= POSITION_MAX_AGE_MS) return board;
  return { ...board, runners: board.runners.map((r) => (r.position ? { ...r, position: null } : r)) };
}

export type GuardedBoard<T> =
  | { kind: 'fresh'; board: T }
  | { kind: 'cached'; board: T; reason: DegradedReason; snapshotAt: string }
  | { kind: 'limited'; retryAfterSec: number }
  | { kind: 'failed'; error: unknown };

export function createBoardGuard<T extends WithRunners>(opts: { now?: () => number } = {}) {
  const now = opts.now ?? (() => Date.now());
  const viewerLimit = createWindowLimiter(VIEWER_LIMIT, WINDOW_MS);
  const viewerCache = new Map<string, Snapshot<T>>();
  const shared = new Map<string, Snapshot<T>>();
  const sharedBuilding = new Map<string, Promise<T>>();
  let inflight = 0;
  let builds: number[] = [];

  function busy(t: number): boolean {
    builds = builds.filter((b) => t - b < BUSY_WINDOW_MS && b <= t);
    return inflight >= MAX_INFLIGHT || builds.length >= MAX_BUILDS_PER_BUSY_WINDOW;
  }

  async function build(fn: () => Promise<T>): Promise<T> {
    inflight++;
    builds.push(now());
    try { return await fn(); } finally { inflight--; }
  }

  function remember(key: string, board: T, t: number) {
    viewerCache.set(key, { at: t, board });
    if (viewerCache.size > MAX_KEYS) for (const [k, v] of viewerCache) if (t - v.at > VIEWER_CACHE_MAX_MS) viewerCache.delete(k);
  }

  function cachedFor(key: string, eventId: string, t: number, maxAgeMs: number): Snapshot<T> | null {
    const own = viewerCache.get(key);
    if (own && t - own.at <= maxAgeMs && t >= own.at) return own;
    const sh = shared.get(eventId);
    if (sh && t - sh.at <= maxAgeMs && t >= sh.at) return sh;
    return null;
  }

  const served = (s: Snapshot<T>, reason: DegradedReason, t: number): GuardedBoard<T> =>
    ({ kind: 'cached', board: withoutStalePositions(s.board, t - s.at), reason, snapshotAt: new Date(s.at).toISOString() });

  /** One shared snapshot per event, built for no viewer; concurrent callers share one build. */
  async function sharedSnapshot(eventId: string, buildShared: () => Promise<T>, t: number): Promise<Snapshot<T>> {
    const sh = shared.get(eventId);
    if (sh && t - sh.at <= SHARED_TTL_MS && t >= sh.at) return sh;
    let p = sharedBuilding.get(eventId);
    if (!p) {
      p = build(buildShared).finally(() => sharedBuilding.delete(eventId));
      sharedBuilding.set(eventId, p);
    }
    const board = await p;
    const snap = { at: now(), board };
    shared.set(eventId, snap);
    return snap;
  }

  return {
    /**
     * `viewerKey` is the caller's athlete id (or `ip:<addr>` for a staff caller without one);
     * `buildOwn` builds this viewer's board, `buildShared` the no-viewer board.
     */
    async board(viewerKey: string, eventId: string, buildOwn: () => Promise<T>, buildShared: () => Promise<T>): Promise<GuardedBoard<T>> {
      const t = now();
      const key = `${eventId}:${viewerKey}`;
      if (!viewerLimit.allow(key, t)) {
        const c = cachedFor(key, eventId, t, VIEWER_CACHE_MAX_MS);
        return c ? served(c, 'viewer-limit', t) : { kind: 'limited', retryAfterSec: viewerLimit.retryAfterSec(key, t) };
      }
      if (busy(t)) {
        const own = viewerCache.get(key);
        if (own && t - own.at <= VIEWER_CACHE_MAX_MS && t >= own.at) return served(own, 'busy', t);
        try {
          return served(await sharedSnapshot(eventId, buildShared, t), 'busy', t);
        } catch (error) {
          const c = cachedFor(key, eventId, t, STALE_ON_ERROR_MAX_MS);
          return c ? served(c, 'error', t) : { kind: 'failed', error };
        }
      }
      try {
        const board = await build(buildOwn);
        remember(key, board, now());
        return { kind: 'fresh', board };
      } catch (error) {
        const c = cachedFor(key, eventId, t, STALE_ON_ERROR_MAX_MS);
        return c ? served(c, 'error', t) : { kind: 'failed', error };
      }
    },
    reset() {
      viewerLimit.reset(); viewerCache.clear(); shared.clear(); sharedBuilding.clear(); inflight = 0; builds = [];
    },
  };
}

/** Per-runner brake on position writes, keyed (event, runner). */
export const runnerPositionLimiter = createWindowLimiter(RUNNER_LIMIT, WINDOW_MS);

/** The board guard for GET /api/race-live/[eventId] (one per warm instance). */
export const raceBoardGuard = createBoardGuard<Awaited<ReturnType<typeof import('./server').liveBoard>>>();

'use client';

import type { Cache, State } from 'swr';
import { APP_VERSION } from '@/lib/version';

// ═════════════════════════════════════════════════════════════════════════════
// A persistent SWR cache — the fix for "a refresh feels like a hard refresh".
//
// SWR's defaults (lib/api.ts) already give the app cache-first data with
// background revalidation, and inside a session that works: hopping feed →
// dashboard → feed paints instantly. But the cache was memory-only, so every
// full document load — a reload, reopening the installed PWA, iOS discarding the
// web view while you were in another app — started from ZERO. Which is why the
// same screen that appears instantly on a tab switch shows a spinner and then
// pops in three waves when you pull to refresh: not slow requests, an empty
// cache. The `(app)` shell makes it worse by holding a full-screen spinner until
// /api/auth/me answers, so nothing at all is on screen for a whole round trip.
//
// With this, a reload paints the last answer immediately and SWR replaces it as
// the network catches up.
//
// ── What this puts on the device ─────────────────────────────────────────────
// Personal club data, in localStorage: whatever GET the app has made through
// useApi — this member's runs and paces, the feed they can see, teammate names.
// It is the same data the screen was already showing and nothing that wasn't
// already readable by this session, but it now RESTS on the device between
// sessions, so:
//   • It is scoped to one identity and discarded when that changes (see
//     `identityFingerprint`) — signing in as somebody else on a shared phone must
//     never paint the previous person's numbers.
//   • signOutEverywhere() wipes it, via clearIdentityKeys().
//   • It carries APP_VERSION and is discarded on a deploy, so a changed response
//     shape can't be restored into a screen that no longer understands it.
// Do NOT reach for this to store anything the API doesn't already hand this
// session — it is a cache, not a store.
// ═════════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'mc_swr_cache_v1';

/** Serialized size caps. localStorage is ~5 MB for the whole origin, and it is
 *  shared with the Supabase session, the identity keys and the onboarding flags —
 *  none of which may be squeezed out by a cached feed. A single oversized entry
 *  (a long feed page with per-km splits) is skipped rather than allowed to consume
 *  the budget alone. */
const MAX_ENTRY_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;

/** Coalesce the writes: SWR touches the cache several times per request (start
 *  revalidating → data → stop), and a page load is dozens of those. */
const FLUSH_DEBOUNCE_MS = 1500;

interface Persisted {
  v: string;
  id: string;
  e: [string, unknown][];
}

/**
 * Who this cache belongs to. Both keys, because the app has two login paths and
 * an account can arrive by either — an admin has `coach_email`, a runner who
 * signed in through Strava has only `athlete_id`.
 *
 * An empty string means "nobody is signed in", and nothing is persisted for that
 * state: there is no one to scope it to, and a public visitor's landing page has
 * nothing worth restoring.
 */
function identityFingerprint(): string {
  try {
    const id = localStorage.getItem('athlete_id') || '';
    const email = localStorage.getItem('coach_email') || '';
    return id || email ? `${id}|${email}` : '';
  } catch {
    return ''; // private mode — memory-only cache, which is the right answer there
  }
}

/** Remove the persisted cache. Called from clearIdentityKeys() on sign-out. */
export function clearPersistedSWRCache(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing we can do, and nothing that should break a sign-out */
  }
}

/**
 * What SWR keeps per key is `{ data, error, isLoading, isValidating, _k }`.
 * Only `data` is worth restoring — and the rest is actively wrong to restore: a
 * persisted `error` would render a failure screen for a request that never ran,
 * and a persisted `isValidating: true` describes an in-flight fetch that died
 * with the page.
 */
function dataOf(value: State<unknown> | undefined): unknown {
  if (!value || typeof value !== 'object') return undefined;
  return value.data;
}

type CacheMap = Map<string, State<unknown>>;

function load(map: CacheMap, identity: string): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Persisted;
    // A different person, or a different deploy — either makes the whole blob
    // unusable, so drop it now rather than leaving it to be overwritten later.
    if (parsed?.v !== APP_VERSION || parsed?.id !== identity || !Array.isArray(parsed.e)) {
      clearPersistedSWRCache();
      return;
    }
    for (const [key, data] of parsed.e) {
      if (typeof key === 'string') map.set(key, { data });
    }
  } catch {
    clearPersistedSWRCache();
  }
}

function save(map: CacheMap, identity: string): void {
  const entries: [string, unknown][] = [];
  let total = 0;
  for (const [key, value] of map) {
    // `$`-prefixed keys are SWR's own internals (useSWRInfinite's composite keys,
    // request/length bookkeeping). Nothing in this app creates them, and none of
    // them means anything to a fresh page.
    if (typeof key !== 'string' || key.startsWith('$')) continue;
    const data = dataOf(value);
    if (data === undefined) continue;
    let serialized: string;
    try {
      serialized = JSON.stringify(data);
    } catch {
      continue; // not round-trippable (a Blob, a cycle) — it can be refetched
    }
    if (!serialized) continue;
    // UTF-16 units, which is what browsers actually charge localStorage in.
    const size = serialized.length;
    if (size > MAX_ENTRY_BYTES) continue;
    if (total + size > MAX_TOTAL_BYTES) break;
    total += size;
    entries.push([key, data]);
  }
  const blob: Persisted = { v: APP_VERSION, id: identity, e: entries };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // Quota. Drop what's there rather than leaving a half-written or stale blob
    // behind — the app's own identity keys matter more than a warm cache.
    clearPersistedSWRCache();
  }
}

/**
 * The `provider` for SWRConfig. Returns a Map that reads itself from localStorage
 * on creation and writes itself back on a debounce.
 *
 * `pagehide` as well as the debounce, and `visibilitychange` as well as that:
 * on iOS a PWA that gets backgrounded and then discarded may never run
 * `beforeunload` at all, and "the cache is only warm if you closed the app
 * politely" is not a feature anyone would notice working.
 */
export function persistedCacheProvider(): Cache<unknown> {
  const map: CacheMap = new Map();
  if (typeof window === 'undefined') return map;

  const identity = identityFingerprint();
  // Restoring only ever happens for a browser that is already signed in. When it
  // isn't, drop whatever a previous session left, so the next person to sign in on
  // this device starts clean even if the last one never signed out.
  if (identity) load(map, identity);
  else clearPersistedSWRCache();

  // The writer is attached either way, NOT only when there was an identity to
  // restore: signing in is a soft navigation, so this provider is constructed
  // once, before there is anybody to scope a cache to, and stays for the whole
  // session. Bailing out here meant the session right after a login was the one
  // that never got a warm cache. `flush` re-reads the identity and does nothing
  // while there still isn't one.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    // Re-read the identity: a sign-in during this page's life changes who the
    // cache belongs to, and writing this session's data under the old
    // fingerprint is the one mistake here that could show A's data to B.
    const current = identityFingerprint();
    if (!current) { clearPersistedSWRCache(); return; }
    save(map, current);
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  };

  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // A Proxy rather than a Map subclass: SWR's cache interface is duck-typed
  // (`get`/`set`/`delete`/`keys`), and subclassing Map means every internal call
  // goes through the override — including the reads, which is pure overhead on
  // the hot path. This intercepts only the two that dirty it.
  return new Proxy(map, {
    // `target` as the receiver throughout, never the proxy: Map's methods and its
    // `size` getter are all built-ins that check their `this` for internal slots,
    // and a proxy doesn't have them — reading `.size` through the proxy would
    // throw "called on incompatible receiver".
    get(target, prop) {
      if (prop === 'set' || prop === 'delete') {
        const fn = Reflect.get(target, prop, target) as (...a: unknown[]) => unknown;
        return (...args: unknown[]) => {
          const result = fn.apply(target, args);
          schedule();
          return result;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

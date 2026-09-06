/**
 * Naming and pruning for the service worker's PAGE caches.
 *
 * ⚠️ The bug this exists for. Both the HTML document and the RSC payload that a
 * client-side navigation fetches are served with
 * `cache-control: private, no-cache, no-store, must-revalidate` — the server is
 * explicit that these must not be stored. `NetworkFirst` stores them anyway:
 * Cache Storage is written by the handler, not by the HTTP cache, and Serwist
 * applies no cacheability check beyond "status 200". So every page you visit is
 * kept, and Serwist's own cleanup only prunes the PRECACHE — these runtime
 * buckets survive a deploy untouched.
 *
 * Result, as reported from a phone: you tap a link, the network is slower than
 * `networkTimeoutSeconds`, and the SW hands back the copy it saved — which can be
 * from the PREVIOUS BUILD. The real response lands a moment later and overwrites
 * the entry, so the next navigation looks correct. Hence "sometimes I get the old
 * version first, then it fixes itself".
 *
 * The fix is to put the build id in the cache name. A new deploy then reads from
 * an empty bucket instead of the last deploy's, so serving a previous version
 * stops being possible rather than becoming unlikely — and `staleCacheKeys()`
 * deletes the buckets that are no longer current, including the unversioned ones
 * this app wrote before the fix.
 *
 * This lives outside `sw.ts` on purpose: that file references webworker globals
 * and can never run under vitest, and the pruning rule is the one piece of it
 * where a wrong answer either deletes a cache it shouldn't or keeps the stale one
 * that caused the bug.
 */

/**
 * Serwist's page-cache bucket names (`PAGES_CACHE_NAME` in
 * `@serwist/turbopack/worker`), duplicated as plain strings.
 *
 * Not imported from there: this module is unit-tested, and that entrypoint is
 * worker code. Keep in sync — it has been stable at these three values, and a
 * rename upstream would show up as old buckets never being pruned.
 */
export const PAGE_CACHES = ['pages-rsc-prefetch', 'pages-rsc', 'pages'] as const;

/** How long a stored page may be served when the network doesn't answer in time. */
export const PAGE_CACHE_MAX_AGE_S = 30 * 60;

/**
 * `pages-rsc` + build `abc123` -> `pages-rsc--abc123`.
 *
 * Two dashes, not one: `pages` is a prefix of `pages-rsc`, so with a single
 * separator `pages-rsc--abc` would look like the `pages` bucket for build
 * `rsc--abc` and get pruned as stale on every activate.
 */
export function pageCacheName(base: string, build: string): string {
  return `${base}--${build}`;
}

/**
 * Of the caches this origin holds, the page buckets that aren't this build's.
 *
 * Deliberately narrow: it only ever returns keys that are one of `PAGE_CACHES`
 * or a versioned form of one. Everything else — Serwist's precache, the hashed
 * static-asset buckets, `next-image`, `others`, `cross-origin` — is left alone,
 * because those hold content-addressed or genuinely long-lived responses and
 * dropping them on every deploy would turn a warm app cold for no reason.
 */
export function staleCacheKeys(keys: string[], build: string): string[] {
  const current = new Set<string>(PAGE_CACHES.map((base) => pageCacheName(base, build)));
  return keys.filter((key) => {
    if (current.has(key)) return false;
    // An unversioned bucket: written by the build that predates this fix, and
    // holding exactly the payloads that were being served as "the old version".
    if ((PAGE_CACHES as readonly string[]).includes(key)) return true;
    return PAGE_CACHES.some((base) => key.startsWith(`${base}--`));
  });
}

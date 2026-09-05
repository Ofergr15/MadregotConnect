import { describe, it, expect } from 'vitest';
import { PAGE_CACHES, PAGE_CACHE_MAX_AGE_S, pageCacheName, staleCacheKeys } from '@/lib/sw-caches';

// The service worker's page caches are what made a navigation sometimes render
// the PREVIOUS DEPLOY's page: NetworkFirst stores the no-store document and RSC
// payload anyway, and those buckets outlive a deploy. The build id in the name is
// the fix; this file pins the two halves of it that can silently go wrong —
// generating a name that collides, and pruning either too much or too little.

describe('pageCacheName', () => {
  it('scopes a bucket to a build', () => {
    expect(pageCacheName('pages-rsc', 'abc12345')).toBe('pages-rsc--abc12345');
  });

  it('keeps `pages` and `pages-rsc` distinguishable', () => {
    // The reason the separator is two dashes. With one, `pages-rsc-abc` is
    // ambiguous: it reads equally as the `pages-rsc` bucket for build `abc` and
    // as the `pages` bucket for build `rsc-abc`, so the prefix test in
    // staleCacheKeys would delete the current RSC cache on every activate.
    const html = pageCacheName('pages', 'abc');
    const rsc = pageCacheName('pages-rsc', 'abc');
    expect(rsc.startsWith('pages--')).toBe(false);
    expect(staleCacheKeys([html, rsc], 'abc')).toEqual([]);
  });
});

describe('staleCacheKeys', () => {
  const current = PAGE_CACHES.map((base) => pageCacheName(base, 'build2'));

  it('keeps every page bucket belonging to this build', () => {
    expect(staleCacheKeys(current, 'build2')).toEqual([]);
  });

  it('deletes the same buckets from a previous build', () => {
    const old = PAGE_CACHES.map((base) => pageCacheName(base, 'build1'));
    expect(staleCacheKeys([...old, ...current], 'build2').sort()).toEqual([...old].sort());
  });

  it('deletes the unversioned buckets written before this fix shipped', () => {
    // The whole point of the first activate after the fix: these hold the
    // payloads that were being served as "the old version".
    expect(staleCacheKeys([...PAGE_CACHES], 'build2').sort()).toEqual([...PAGE_CACHES].sort());
  });

  it('leaves precache and the content-addressed asset buckets alone', () => {
    // Dropping these on every deploy would turn a warm app cold for no reason —
    // they are keyed by content hash or hold genuinely long-lived responses.
    const others = [
      'serwist-precache-v2-https://www.madregot.app/',
      'next-static-js-assets',
      'static-image-assets',
      'next-image',
      'static-style-assets',
      'others',
      'cross-origin',
      'apis',
    ];
    expect(staleCacheKeys(others, 'build2')).toEqual([]);
  });

  it('is not fooled by a cache that merely mentions a page bucket name', () => {
    expect(staleCacheKeys(['my-pages', 'pages-of-something', 'pagesrsc'], 'build2')).toEqual([]);
  });

  it('handles an empty origin', () => {
    expect(staleCacheKeys([], 'build2')).toEqual([]);
  });
});

describe('PAGE_CACHE_MAX_AGE_S', () => {
  it('is 30 minutes, not defaultCache\'s 24 hours', () => {
    // Within one build these entries are only ever served when the network failed
    // or timed out. A day-old feed presented as current is worse than the offline
    // page; half an hour still covers reopening the app in a tunnel.
    expect(PAGE_CACHE_MAX_AGE_S).toBe(1800);
  });
});

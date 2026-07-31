/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected by @serwist/next at build time: the precache manifest.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  // Precache the build's app shell + hashed static assets. `/offline.html`
  // lives in `public/`, so Serwist already includes it here automatically
  // (with a content-hash revision) — don't add it again, or the two entries
  // conflict and the SW throws on install.
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // 1) Never cache the app's own API — guarantees data freshness and avoids
    //    persisting any authenticated response body.
    {
      matcher: ({ url }) => url.pathname.startsWith('/api/'),
      handler: new NetworkOnly(),
    },
    // 2) Never cache Supabase (auth tokens + live data).
    {
      matcher: ({ url }) => url.hostname.endsWith('.supabase.co'),
      handler: new NetworkOnly(),
    },
    // 3) Never intercept OAuth callbacks / PKCE code exchanges.
    {
      matcher: ({ url, request }) =>
        request.mode === 'navigate' &&
        (/^\/(auth|garmin-callback)(\/|$)/.test(url.pathname) ||
          url.searchParams.has('code')),
      handler: new NetworkOnly(),
    },
    // 4) Everything else -> Next-tuned defaults (handles _next/static,
    //    next-image, fonts, and NetworkFirst navigations). First match wins,
    //    so the NetworkOnly rules above supersede defaultCache's own /api entry.
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: '/offline.html',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

serwist.addEventListeners();

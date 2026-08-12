/// <reference lib="webworker" />
import { defaultCache } from '@serwist/turbopack/worker';
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
        (/^\/(auth|garmin-callback|serwist)(\/|$)/.test(url.pathname) ||
          url.searchParams.has('code')),
      handler: new NetworkOnly(),
    },
    // 4) Don't mediate the Races-page map (Leaflet CDN + CARTO map tiles).
    //    defaultCache would otherwise route these cross-origin requests through
    //    NetworkFirst, which can make opaque no-cors responses flaky on mobile.
    //    Let the browser fetch them directly, exactly as it did pre-PWA.
    {
      matcher: ({ url }) =>
        url.hostname === 'unpkg.com' ||
        url.hostname.endsWith('.basemaps.cartocdn.com'),
      handler: new NetworkOnly(),
    },
    // 5) Everything else -> Next-tuned defaults (handles _next/static,
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

// --- Web Push (Notification Center) ---
// Serwist's addEventListeners() wires install/activate/fetch/message only, so we
// add our own push + notificationclick handlers.
self.addEventListener('push', (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string; tag?: string; badge?: number } = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  const title = data.title || 'Madregot';
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/images/icon-192.png',
        badge: '/images/icon-192.png',
        tag: data.tag,
        data: { url: data.url || '/dashboard' },
      });
      // App-icon badge count (iOS 16.4+ installed PWA). Guard: not all engines
      // expose it, and clearing needs the count param on iOS.
      if (typeof data.badge === 'number' && 'setAppBadge' in self.navigator) {
        try {
          if (data.badge > 0) await (self.navigator as Navigator).setAppBadge(data.badge);
          else await (self.navigator as Navigator).clearAppBadge();
        } catch { /* badging unsupported / denied — ignore */ }
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url || '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          (client as WindowClient).navigate(url);
          return (client as WindowClient).focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

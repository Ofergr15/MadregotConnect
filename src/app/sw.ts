/// <reference lib="webworker" />
import { defaultCache, PAGES_CACHE_NAME } from '@serwist/turbopack/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from 'serwist';

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
  //
  // Note: large, rarely-used files (e.g. the run-chat feature's
  // stream-chat-react bundle and its AI-coach avatar image) are already
  // excluded from this manifest via `maximumFileSizeToCacheInBytes` in
  // `src/app/serwist/[path]/route.ts`, which is the only place @serwist/build
  // exposes manifest-size/content filtering (the manifest below is generated
  // server-side and injected as a plain `{url, revision}` array — by the time
  // it reaches this file, per-entry file size is no longer available, so
  // filtering here isn't possible). See that file for the threshold + why.
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
    // 5) Navigations/documents/RSC payloads, same as defaultCache's own
    //    NetworkFirst entries for these (same cacheNames, so we reuse rather
    //    than orphan those Cache Storage buckets) -- but with a timeout.
    //    defaultCache (@serwist/turbopack) doesn't expose a way to configure
    //    networkTimeoutSeconds on its built-in entries, and without one,
    //    Workbox's NetworkFirst waits indefinitely for the network before
    //    falling back to cache. That makes a *repeat* visit on a slow/flaky
    //    connection stall exactly like a cold load instead of feeling instant
    //    from cache. These duplicate the matchers below only so we can add
    //    the timeout; first match wins, so they take priority over
    //    defaultCache's equivalents.
    {
      matcher: ({ request, url: { pathname }, sameOrigin }) =>
        request.headers.get('RSC') === '1' &&
        request.headers.get('Next-Router-Prefetch') === '1' &&
        sameOrigin &&
        !pathname.startsWith('/api/'),
      handler: new NetworkFirst({
        cacheName: PAGES_CACHE_NAME.rscPrefetch,
        networkTimeoutSeconds: 4,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 32,
            maxAgeSeconds: 24 * 60 * 60, // 24 hours
          }),
        ],
      }),
    },
    {
      matcher: ({ request, url: { pathname }, sameOrigin }) =>
        request.headers.get('RSC') === '1' && sameOrigin && !pathname.startsWith('/api/'),
      handler: new NetworkFirst({
        cacheName: PAGES_CACHE_NAME.rsc,
        networkTimeoutSeconds: 4,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 32,
            maxAgeSeconds: 24 * 60 * 60, // 24 hours
          }),
        ],
      }),
    },
    {
      matcher: ({ request, url: { pathname }, sameOrigin }) =>
        !!request.headers.get('Content-Type')?.includes('text/html') && sameOrigin && !pathname.startsWith('/api/'),
      handler: new NetworkFirst({
        cacheName: PAGES_CACHE_NAME.html,
        networkTimeoutSeconds: 4,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 32,
            maxAgeSeconds: 24 * 60 * 60, // 24 hours
          }),
        ],
      }),
    },
    // 6) Everything else -> Next-tuned defaults (handles _next/static,
    //    next-image, fonts, and NetworkFirst navigations). First match wins,
    //    so the NetworkOnly rules above supersede defaultCache's own /api entry,
    //    and the timeout-guarded entries above supersede its nav/RSC/document ones.
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
  let data: {
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
    badge?: number;
    icon?: string;
    image?: string;
    renotify?: boolean;
    actions?: Array<{ action: string; title: string }>;
    athleteId?: string;
    rsvp?: { weekStart: string; day: number };
    kudosActivityId?: string;
  } = {};
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
        // Per-notification photo (e.g. the replying coach's avatar) when the
        // sender has one in scope; otherwise fall back to the app icon so every
        // pre-existing push (no icon field) still renders exactly as before.
        icon: data.icon || '/images/icon-192.png',
        badge: '/images/icon-192.png',
        tag: data.tag,
        // Only re-alert on a tag-replace when the sender explicitly asked for
        // it (e.g. a recurring reminder that should still ping, not just swap
        // the old card's content silently). The spec requires a non-empty tag
        // whenever renotify is true, or showNotification throws — guard it.
        renotify: !!(data.renotify && data.tag),
        // OS-level action buttons (Chrome/Android + desktop; iOS/WebKit has no
        // Notification actions API and just ignores this field). Context each
        // action needs at click time travels alongside in `data`, since the SW
        // has no page/localStorage to read from.
        actions: data.actions,
        data: {
          url: data.url || '/dashboard',
          athleteId: data.athleteId,
          rsvp: data.rsvp,
          kudosActivityId: data.kudosActivityId,
        },
        // `image` (expanded banner photo) isn't in TS's NotificationOptions lib
        // typing yet, though it's supported at runtime on platforms that honor
        // it (browsers ignore unknown notification options harmlessly).
        ...(data.image ? { image: data.image } : {}),
      } as NotificationOptions & { image?: string });
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
  const notifData = (event.notification.data as {
    url?: string;
    athleteId?: string;
    rsvp?: { weekStart: string; day: number };
    kudosActivityId?: string;
  }) || {};

  // Action-button taps: perform the action directly in the background — no
  // need to open/focus the app at all, same as any native app's notification
  // actions (e.g. Gmail's "archive"). `event.action` is '' when the
  // notification BODY was tapped instead of a button, which falls through to
  // the normal open/focus/navigate behavior below.
  if (event.action === 'rsvp_yes' || event.action === 'rsvp_no') {
    if (notifData.athleteId && notifData.rsvp) {
      event.waitUntil(
        fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            athleteId: notifData.athleteId,
            weekStart: notifData.rsvp.weekStart,
            day: notifData.rsvp.day,
            attending: event.action === 'rsvp_yes',
          }),
        }).catch(() => {}),
      );
    }
    return;
  }
  if (event.action === 'kudos') {
    if (notifData.athleteId && notifData.kudosActivityId) {
      event.waitUntil(
        fetch(`/api/activities/${notifData.kudosActivityId}/kudos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ athleteId: notifData.athleteId }),
        }).catch(() => {}),
      );
    }
    return;
  }

  const url = notifData.url || '/dashboard';
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

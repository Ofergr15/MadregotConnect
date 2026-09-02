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
    // 1) Never intercept OAuth callbacks / PKCE code exchanges — navigationPreload
    //    sends a direct network request AND the SW would make a second fetch via
    //    NetworkOnly, consuming a one-time-use code twice. Return the preload
    //    response directly to guarantee exactly one round-trip to the server.
    //    Must be listed before the /api/* rule or that rule wins first.
    {
      matcher: ({ url, request }) =>
        request.mode === 'navigate' &&
        (/^\/(auth|garmin-callback|serwist)(\/|$)/.test(url.pathname) ||
          url.searchParams.has('code')),
      handler: {
        handle: async ({ event }) => {
          const preload = await (event as FetchEvent).preloadResponse;
          return preload || fetch((event as FetchEvent).request);
        },
      },
    },
    // 2) Never cache the app's own API — guarantees data freshness and avoids
    //    persisting any authenticated response body.
    {
      matcher: ({ url }) => url.pathname.startsWith('/api/'),
      handler: new NetworkOnly(),
    },
    // 3) Never cache Supabase (auth tokens + live data).
    {
      matcher: ({ url }) => url.hostname.endsWith('.supabase.co'),
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
    actionToken?: string;
  } = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  const title = data.title || 'Madregot';
  event.waitUntil(
    (async () => {
      // A push already reported delivered by the push service (no 404/410,
      // so no dead-subscription cleanup ever triggers) can still fail to
      // actually show — e.g. permission got revoked between subscribing and
      // this push arriving. Without this try/catch that failure was an
      // unhandled rejection inside waitUntil: the notification silently
      // never appears, with zero visibility anywhere that it happened.
      try {
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
            // Server-signed authorization for this athlete to press this
            // notification's buttons — the SW's stand-in for the bearer token
            // it can't reach. See src/lib/auth/action-token.ts.
            actionToken: data.actionToken,
          },
          // `image` (expanded banner photo) isn't in TS's NotificationOptions lib
          // typing yet, though it's supported at runtime on platforms that honor
          // it (browsers ignore unknown notification options harmlessly).
          ...(data.image ? { image: data.image } : {}),
        } as NotificationOptions & { image?: string });
        // Delivery receipt. This is the ONLY evidence anywhere in the system
        // that a push actually reached a phone: Apple returns 201 for an
        // endpoint that is still registered but no longer bound to a live
        // service worker, so the send path's success status proves nothing.
        // Measured on a real device: four endpoints, three of them ghosts, took
        // 52 consecutive sends with 201 and displayed none of them.
        //
        // Only reached when showNotification above resolved, so it means "this
        // device displayed it" — not "the push service took it". Deliberately
        // after the await, so a slow/failing receipt can never delay or
        // suppress the notification itself.
        try {
          const sub = await self.registration.pushManager.getSubscription();
          if (sub) {
            await fetch('/api/push/receipt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: sub.endpoint }),
            });
          }
        } catch { /* offline, or the receipt route is older than this SW — the notification still showed */ }
      } catch { /* see comment above — never let this break badge updates below */ }
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

// A service worker can't read the Supabase session (it lives in localStorage, in
// the page), so an action button has no bearer token to send. Instead the send
// path signs a token scoped to this athlete and this exact action and ships it in
// the push payload; forwarding it here is what makes the button authorized. An
// older notification that predates this (no token in its data) simply gets no
// header and is rejected — the same dead button it already was.
// The header name is spelled out rather than imported from action-token.ts:
// that module pulls in node:crypto, which must not end up in the service-worker
// bundle. Keep it in sync with ACTION_TOKEN_HEADER there.
function actionHeaders(token: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'x-action-token': token } : {}),
  };
}

// Tell every open tab an action fired so an already-mounted screen (e.g.
// AttendanceRSVP/AttendanceRoster, still showing the pre-action state) can
// refetch instead of silently going stale until a manual reload. `ok: false`
// also covers "the fetch resolved but the server rejected it" (4xx/5xx) —
// fetch() doesn't reject on those, so this is the only place that surfaces it.
async function broadcastAction(type: string, ok: boolean, extra: Record<string, unknown> = {}) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) client.postMessage({ source: 'madregot-sw', type, ok, ...extra });
}

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  const notifData = (event.notification.data as {
    url?: string;
    athleteId?: string;
    rsvp?: { weekStart: string; day: number };
    kudosActivityId?: string;
    actionToken?: string;
  }) || {};
  const action = event.action;
  event.notification.close();

  // Action-button taps: perform the action directly in the background — no
  // need to open/focus the app at all, same as any native app's notification
  // actions (e.g. Gmail's "archive"). `event.action` is '' when the
  // notification BODY was tapped instead of a button, which falls through to
  // the normal open/focus/navigate behavior below.
  if (action === 'rsvp_yes' || action === 'rsvp_no') {
    if (notifData.athleteId && notifData.rsvp) {
      event.waitUntil(
        fetch('/api/attendance', {
          method: 'POST',
          headers: actionHeaders(notifData.actionToken),
          body: JSON.stringify({
            athleteId: notifData.athleteId,
            weekStart: notifData.rsvp.weekStart,
            day: notifData.rsvp.day,
            attending: action === 'rsvp_yes',
          }),
        })
          .then((r) => broadcastAction('rsvp', r.ok, { weekStart: notifData.rsvp!.weekStart, day: notifData.rsvp!.day }))
          .catch(() => broadcastAction('rsvp', false, { weekStart: notifData.rsvp!.weekStart, day: notifData.rsvp!.day })),
      );
    }
    return;
  }
  if (action === 'kudos') {
    if (notifData.athleteId && notifData.kudosActivityId) {
      event.waitUntil(
        fetch(`/api/activities/${notifData.kudosActivityId}/kudos`, {
          method: 'POST',
          headers: actionHeaders(notifData.actionToken),
          body: JSON.stringify({ athleteId: notifData.athleteId }),
        })
          .then((r) => broadcastAction('kudos', r.ok, { activityId: notifData.kudosActivityId }))
          .catch(() => broadcastAction('kudos', false, { activityId: notifData.kudosActivityId })),
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

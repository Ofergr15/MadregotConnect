'use client';

import { useEffect } from 'react';

const RELOAD_KEY = 'dev_service_worker_cleanup_reloaded';

/**
 * Production keeps the offline service worker. Development must not: stable
 * Turbopack chunk URLs plus a previously installed worker can serve stale UI
 * through an HTTPS tunnel even after the dev server has changed.
 */
export function DevServiceWorkerCleanup() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    void (async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const hadWorker = registrations.length > 0 || !!navigator.serviceWorker.controller;
      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      }

      if (hadWorker && !sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        window.location.reload();
      }
    })();
  }, []);

  return null;
}

'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// "New version available — tap to refresh" banner.
//
// The installed PWA and web tabs cache the app shell via the service worker, so
// after a deploy people keep running the OLD bundle until a full reload. Serwist
// registers the SW with skipWaiting + clientsClaim, so a new SW activates on its
// own — but the already-loaded page JS is still stale until the page reloads.
//
// This watches the existing registration (no re-register — serwist already did
// that) for a newly-installed worker and prompts a one-tap reload. We also poll
// for updates on mount and whenever the tab regains focus, so the banner shows
// promptly instead of only on the next cold start. Mounted globally in the root
// layout; z above the maintenance gate (200) so even a blocked user sees it.
export function UpdatePrompt() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    let reg: ServiceWorkerRegistration | null = null;
    let disposed = false;

    // Was a SW already controlling this page WHEN IT LOADED? If not, this is a
    // first install (or a hard reload with no controller) — the initial worker
    // installing then is NOT an update, so we must not show the prompt for it.
    // Only a worker that installs LATER, while we already had a controller,
    // is a genuine new version.
    const hadControllerAtLoad = !!navigator.serviceWorker.controller;

    const markReady = () => { if (!disposed && hadControllerAtLoad) setReady(true); };

    const watchWorker = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) markReady();
      });
    };

    navigator.serviceWorker.getRegistration().then((r) => {
      if (!r || disposed) return;
      reg = r;
      // A worker already waiting means a new version is ready right now.
      if (r.waiting) markReady();
      watchWorker(r.installing);
      r.addEventListener('updatefound', () => watchWorker(r!.installing));
      r.update().catch(() => {}); // check for a fresh build now
    });

    // The most reliable "new version is now controlling" signal.
    navigator.serviceWorker.addEventListener('controllerchange', markReady);

    // Re-check when the tab regains focus (cheap; catches deploys since last view).
    const onVisible = () => {
      if (document.visibilityState === 'visible') reg?.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker.removeEventListener('controllerchange', markReady);
    };
  }, []);

  if (!ready) return null;

  const refresh = () => {
    // Reload only AFTER the new worker takes control — otherwise the reload can
    // fetch the shell while the OLD worker is still controlling and re-serve
    // stale chunks (the exact loop this prompt exists to fix). Fall back to an
    // unconditional reload if controllerchange doesn't fire promptly.
    let reloaded = false;
    const go = () => { if (!reloaded) { reloaded = true; window.location.reload(); } };
    navigator.serviceWorker.addEventListener('controllerchange', go, { once: true });
    setTimeout(go, 2000);
    navigator.serviceWorker.getRegistration()
      .then((r) => { r?.waiting?.postMessage({ type: 'SKIP_WAITING' }); })
      .catch(() => {});
  };

  return (
    <button
      onClick={refresh}
      dir="rtl"
      className="fixed left-1/2 -translate-x-1/2 z-[310] flex items-center gap-2.5 px-4 py-2.5 rounded-full text-white text-sm font-bold shadow-xl safe-bottom animate-bounce-gentle"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 16px)', background: 'linear-gradient(90deg,#4338ff,#6366f1)' }}
    >
      <RefreshCw className="h-4 w-4" />
      גרסה חדשה זמינה — הקישו לרענון
    </button>
  );
}

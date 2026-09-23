'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { askBuildId, isNewerBuild } from '@/lib/sw-build-id';

// "New version available — tap to refresh" banner.
//
// The installed PWA and web tabs cache the app shell via the service worker, so
// after a deploy people keep running the OLD bundle until a full reload. sw.ts is
// `skipWaiting: false`, so the new worker INSTALLS AND WAITS rather than seizing a
// page that is still executing the previous build's JS. That makes this component
// the only way an update is ever accepted: no tap, no new version, until every tab
// for the app closes.
//
// It watches the existing registration (no re-register — serwist already did that)
// for a worker that reaches `waiting`/`installed`, and polls on mount and whenever
// the tab regains focus so the banner shows promptly rather than only on the next
// cold start. Mounted globally in the root layout; z above the maintenance gate
// (200) so even a blocked user sees it.
//
// Note on `controllerchange` below, which used to be the main reason this banner
// appeared: under the old `skipWaiting: true` it fired on every deploy the instant
// the new worker took over, so the banner announced a takeover that had already
// happened — which is why it was unmounted for a while as too noisy. It now only
// fires when an update is accepted, here or in another tab. In another tab's case
// this page is suddenly being served by a worker whose build it is not running, so
// offering the reload is exactly right.
//
// All three of those signals also fire for a RE-INSTALL of the build this page is
// already running, which iOS does on its own schedule — that is the "the banner
// doesn't go away after the version updates, it's back on every launch" report,
// filed from a phone whose reported app version was the newest one. So no signal
// is trusted on its own any more: each one only names a CANDIDATE worker, and the
// banner appears once that candidate says it belongs to a different deploy than
// the worker that served this page (askBuildId above, MC_BUILD_ID in sw.ts).
export function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  const [applying, setApplying] = useState(false);
  // The build that was serving this page when it loaded — i.e. the version the
  // JS currently executing came from. Every candidate is compared against it.
  // null = it wouldn't say (a worker older than sw.ts's handler), which makes
  // every comparison inconclusive and so falls through to showing the banner.
  const loadedBuild = useRef<string | null>(null);

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
    // Asked once, immediately, and remembered: by the time a candidate appears
    // the controller may already have been replaced by it.
    const loadedBuildReady = hadControllerAtLoad
      ? askBuildId(navigator.serviceWorker.controller).then((id) => { loadedBuild.current = id; })
      : Promise.resolve();

    // `candidate` is the worker claiming to be the new version. Everything below
    // routes through here, because the signals it routes (a waiting worker, an
    // install completing, a controller swap) all fire for a re-install of the
    // build we are already running — see the note in sw.ts. Only a candidate
    // from a DIFFERENT deploy is an update.
    const markReady = async (candidate: ServiceWorker | null | undefined) => {
      if (disposed || !hadControllerAtLoad) return;
      await loadedBuildReady;
      const theirs = await askBuildId(candidate);
      if (disposed || !isNewerBuild(loadedBuild.current, theirs)) return;
      setReady(true);
    };

    const watchWorker = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) markReady(w);
      });
    };

    navigator.serviceWorker.getRegistration().then((r) => {
      if (!r || disposed) return;
      reg = r;
      // A worker already waiting means a new version is ready right now.
      if (r.waiting) markReady(r.waiting);
      watchWorker(r.installing);
      r.addEventListener('updatefound', () => watchWorker(r!.installing));
      r.update().catch(() => {}); // check for a fresh build now
    });

    // The most reliable "new version is now controlling" signal — and the
    // candidate to ask is the new controller itself, since by now it has taken
    // the page over from whatever was serving it at load.
    const onControllerChange = () => markReady(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    // Re-check when the tab regains focus (cheap; catches deploys since last view).
    const onVisible = () => {
      if (document.visibilityState === 'visible') reg?.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!ready) return null;

  const refresh = async () => {
    if (applying) return;
    setApplying(true);
    // Reload only AFTER the new worker takes control — otherwise the reload can
    // fetch the shell while the OLD worker is still controlling and re-serve
    // stale chunks (the exact loop this prompt exists to fix).
    let reloaded = false;
    const go = () => { if (!reloaded) { reloaded = true; window.location.reload(); } };
    navigator.serviceWorker.addEventListener('controllerchange', go, { once: true });
    const r = await navigator.serviceWorker.getRegistration().catch(() => undefined);
    const next = r?.waiting ?? r?.installing;
    next?.postMessage({ type: 'SKIP_WAITING' });
    // "I tap it and nothing happens" (b80f50a6, an installed PWA): the handover
    // never came, and the old fallback — a plain reload — keeps the page on the
    // OLD worker, since a waiting worker is not activated by a reload. So the
    // banner was back the moment the page returned. If the takeover hasn't come,
    // drop the registration instead: the reload then goes to the network for the
    // new build, and SerwistProvider registers the newest worker on that load
    // (with no controller at load, which this banner never fires for).
    setTimeout(async () => {
      if (reloaded) return;
      try { await r?.unregister(); } catch { /* reload anyway */ }
      go();
    }, next ? 3000 : 0);
  };

  return (
    <button
      onClick={refresh}
      disabled={applying}
      dir="rtl"
      className="fixed left-1/2 -translate-x-1/2 z-[310] flex items-center gap-2.5 px-4 py-2.5 rounded-full text-white text-sm font-bold shadow-xl safe-bottom animate-bounce-gentle"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 16px)', background: 'linear-gradient(90deg,#1525FF,#159AFF)' }}
    >
      <RefreshCw className={`h-4 w-4 ${applying ? 'animate-spin' : ''}`} />
      {applying ? 'מעדכן…' : 'גרסה חדשה זמינה — הקישו לרענון'}
    </button>
  );
}

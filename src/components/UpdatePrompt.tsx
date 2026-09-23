'use client';

import { useEffect } from 'react';
import { askBuildId, isNewerBuild } from '@/lib/sw-build-id';
import { AWAY_MS, canApplyUpdate } from '@/lib/update-timing';

// Applies a new deploy on its own, at a moment when the reload costs nothing
// (see lib/update-timing.ts). It used to be a "new version available — tap to
// refresh" banner, shown on every deploy; with several deploys a day that was
// a banner most days for a one-line fix, so it is gone and nothing renders.
//
// The installed PWA and web tabs cache the app shell via the service worker, so
// after a deploy people keep running the OLD bundle until a full reload. sw.ts is
// `skipWaiting: false`, so the new worker INSTALLS AND WAITS rather than seizing a
// page that is still executing the previous build's JS. That makes this component
// the only way an update is ever accepted short of every tab for the app closing,
// which an installed iOS PWA almost never does.
//
// It watches the existing registration (no re-register — serwist already did that)
// for a worker that reaches `waiting`/`installed`, and polls on mount and whenever
// the tab regains focus. Mounted globally in the root layout.
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
// update is taken once that candidate says it belongs to a different deploy than
// the worker that served this page (askBuildId above, MC_BUILD_ID in sw.ts).
export function UpdatePrompt() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    let reg: ServiceWorkerRegistration | null = null;
    let disposed = false;
    // Start of the current quiet stretch: the load, or a return after being away.
    let quietSince = Date.now();
    let interacted = false;
    let hiddenAt: number | null = null;
    let pending = false; // a newer build is installed and waiting for a safe moment
    let applying = false;
    // The build that was serving this page when it loaded — i.e. the version the
    // JS currently executing came from. Every candidate is compared against it.
    // null = it wouldn't say (a worker older than sw.ts's handler), which makes
    // every comparison inconclusive and so counts as newer.
    let loadedBuild: string | null = null;

    // Was a SW already controlling this page WHEN IT LOADED? If not, this is a
    // first install (or a hard reload with no controller) — the initial worker
    // installing then is NOT an update. Only a worker that installs LATER, while
    // we already had a controller, is a genuine new version.
    const hadControllerAtLoad = !!navigator.serviceWorker.controller;
    // Asked once, immediately, and remembered: by the time a candidate appears
    // the controller may already have been replaced by it.
    const loadedBuildReady = hadControllerAtLoad
      ? askBuildId(navigator.serviceWorker.controller).then((id) => { loadedBuild = id; })
      : Promise.resolve();

    const apply = async () => {
      if (applying) return;
      applying = true;
      // Reload only AFTER the new worker takes control — otherwise the reload can
      // fetch the shell while the OLD worker is still controlling and re-serve
      // stale chunks.
      let reloaded = false;
      const go = () => { if (!reloaded) { reloaded = true; window.location.reload(); } };
      navigator.serviceWorker.addEventListener('controllerchange', go, { once: true });
      const r = await navigator.serviceWorker.getRegistration().catch(() => undefined);
      const next = r?.waiting ?? r?.installing;
      next?.postMessage({ type: 'SKIP_WAITING' });
      // b80f50a6: on an installed PWA the handover sometimes never comes, and a
      // plain reload keeps the page on the OLD worker (a reload does not activate
      // a waiting one). If the takeover hasn't come, drop the registration: the
      // reload then goes to the network for the new build, and SerwistProvider
      // registers the newest worker on that load.
      setTimeout(async () => {
        if (reloaded) return;
        try { await r?.unregister(); } catch { /* reload anyway */ }
        go();
      }, next ? 3000 : 0);
    };

    const tryApply = (awayMs = 0) => {
      if (!pending || disposed) return;
      if (canApplyUpdate({
        sinceLoadMs: Date.now() - quietSince,
        interacted,
        visible: document.visibilityState === 'visible',
        awayMs,
      })) apply();
    };

    // `candidate` is the worker claiming to be the new version. Everything below
    // routes through here, because the signals it routes (a waiting worker, an
    // install completing, a controller swap) all fire for a re-install of the
    // build we are already running — see the note in sw.ts. Only a candidate
    // from a DIFFERENT deploy is an update.
    const markReady = async (candidate: ServiceWorker | null | undefined) => {
      if (disposed || !hadControllerAtLoad) return;
      await loadedBuildReady;
      const theirs = await askBuildId(candidate);
      if (disposed || !isNewerBuild(loadedBuild, theirs)) return;
      pending = true;
      tryApply();
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
      if (r.waiting) markReady(r.waiting);
      watchWorker(r.installing);
      r.addEventListener('updatefound', () => watchWorker(r!.installing));
      r.update().catch(() => {}); // check for a fresh build now
    });

    // Another tab accepted an update, so this page is now served by a worker
    // whose build it is not running.
    const onControllerChange = () => markReady(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const onInteract = () => { interacted = true; };
    window.addEventListener('pointerdown', onInteract, { capture: true });
    window.addEventListener('keydown', onInteract, { capture: true });

    const onVisible = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      // Back after a long time away is a fresh start: a build that finishes
      // downloading in the next few seconds may still apply before the first tap.
      if (away >= AWAY_MS) { quietSince = Date.now(); interacted = false; }
      tryApply(away);
      reg?.update().catch(() => {}); // catches deploys since the last view
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', onInteract, { capture: true });
      window.removeEventListener('keydown', onInteract, { capture: true });
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}

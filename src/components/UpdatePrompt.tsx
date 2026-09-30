'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiFetcher } from '@/lib/api';
import { useIsSuperUser } from '@/lib/impersonation';
import { askBuildId, isNewerBuild } from '@/lib/sw-build-id';
import { AWAY_MS, canApplyUpdate } from '@/lib/update-timing';
import { APP_VERSION } from '@/lib/version';
import { isPublicPath } from '@/lib/public-paths';
import type { WhatsNewRelease } from '@/lib/release-notes';
import { WHATS_NEW_KEY, markSeen, readWhatsNewLedger } from '@/lib/whats-new/ledger';
import {
  FORCE_RELOAD_MS, MIN_SPLASH_MS, STAGE, UPDATING_KEY, isMidTyping, landedOnNewBuild,
  onlyTheWorkerIsOld, readUpdatingNote, seenSlugs, updateContent, writeUpdatingNote, type UpdateContent,
} from '@/lib/update-flow';
import { UpdateSheet } from '@/components/update/UpdateSheet';
import { UpdateSplash } from '@/components/update/UpdateSplash';

/** The reload's hooks, for the path that shows its progress. */
interface ApplyHooks {
  asked: () => void;
  handover: () => void;
  /** Awaited just before the reload. */
  beforeReload: () => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The new server's releases, or null: offline, slow, or refused. */
async function fetchReleases(): Promise<WhatsNewRelease[] | null> {
  try {
    const data = await Promise.race([
      apiFetcher<{ releases?: WhatsNewRelease[] }>('/api/whats-new'),
      sleep(4000).then(() => null),
    ]);
    return data?.releases ?? null;
  } catch {
    return null;
  }
}

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
//
// For the super user, until rollout, it no longer applies anything on its own: a
// newer build opens the mandatory "New version" sheet (lib/update-flow.ts), and
// only its button reloads, under the loading splash. Everyone else keeps the
// silent safe-moment update above, unchanged.
export function UpdatePrompt() {
  const t = useTranslations('update');
  const isSuper = useIsSuperUser();
  const superRef = useRef(isSuper);
  // Set by the effect below; the sheet's button and a late super-user answer call in.
  const askRef = useRef<() => void>(() => {});
  const applyRef = useRef<(hooks?: ApplyHooks) => void>(() => {});
  const [content, setContent] = useState<UpdateContent | null>(null);
  const [busy, setBusy] = useState(false);
  // 'boot' until this load knows whether it is the second half of an update.
  const [splash, setSplash] = useState<{ phase: 'boot' | 'on' | 'out' | 'done'; target: number }>(
    { phase: 'boot', target: STAGE.handover },
  );
  const [toast, setToast] = useState<string | null>(null);

  // Leaving a public page for the app is when a held-back sheet may ask.
  const pathname = usePathname();
  useEffect(() => {
    if (superRef.current) askRef.current();
  }, [pathname]);

  useEffect(() => {
    superRef.current = isSuper;
    // A build may have been found before the answer came back.
    if (isSuper) askRef.current();
  }, [isSuper]);

  // The second half: this load came from the button's reload. Finish the level,
  // fade into the app, say which version it is now.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(UPDATING_KEY);
      sessionStorage.removeItem(UPDATING_KEY);
    } catch { /* private mode: no note, no cover */ }
    const note = readUpdatingNote(raw, Date.now());
    document.documentElement.classList.remove('mc-updating');
    if (!note) {
      setSplash({ phase: 'done', target: STAGE.done });
      return;
    }
    setSplash({ phase: 'on', target: STAGE.done });
    const timers = [
      // ~850ms for the level to top out, then the ink and a short hold, as at opening.
      setTimeout(() => setSplash({ phase: 'out', target: STAGE.done }), 1280),
      setTimeout(() => {
        setSplash({ phase: 'done', target: STAGE.done });
        if (landedOnNewBuild(note, APP_VERSION)) setToast(APP_VERSION);
      }, 1700),
      setTimeout(() => setToast(null), 1700 + 3300),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

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

    const apply = async (hooks?: ApplyHooks) => {
      if (applying) return;
      applying = true;
      // Reload only AFTER the new worker takes control — otherwise the reload can
      // fetch the shell while the OLD worker is still controlling and re-serve
      // stale chunks.
      let reloaded = false;
      const go = async () => {
        if (reloaded) return;
        reloaded = true;
        hooks?.handover();
        await hooks?.beforeReload();
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener('controllerchange', () => { void go(); }, { once: true });
      const r = await navigator.serviceWorker.getRegistration().catch(() => undefined);
      const next = r?.waiting ?? r?.installing;
      next?.postMessage({ type: 'SKIP_WAITING' });
      hooks?.asked();
      // b80f50a6: on an installed PWA the handover sometimes never comes, and a
      // plain reload keeps the page on the OLD worker (a reload does not activate
      // a waiting one). If the takeover hasn't come, drop the registration: the
      // reload then goes to the network for the new build, and SerwistProvider
      // registers the newest worker on that load.
      setTimeout(async () => {
        if (reloaded) return;
        try { await r?.unregister(); } catch { /* reload anyway */ }
        void go();
      }, next ? 3000 : 0);
    };
    applyRef.current = (hooks) => { void apply(hooks); };

    // The super user's path: ask, never apply. Waits only for a visible page and
    // for nobody to be halfway through typing (lib/update-flow.ts isMidTyping).
    let asking = false;
    let asked = false;
    // Set when the server knows nothing newer than this bundle: the swap is then
    // the worker's only, and goes the quiet way (lib/update-flow.ts onlyTheWorkerIsOld).
    let quiet = false;
    // Read at the moment, not at mount: the layout persists across client
    // navigation, so a pending update waits here and asks once they are in the app.
    const onPublicPage = () => isPublicPath(window.location.pathname);

    const ask = async () => {
      if (!pending || disposed || applying || asking || asked) return;
      if (onPublicPage()) return;
      if (document.visibilityState !== 'visible') return;
      if (isMidTyping(document.activeElement as HTMLInputElement | null)) {
        document.addEventListener('focusout', () => setTimeout(() => { void ask(); }, 300), { once: true });
        return;
      }
      asking = true;
      const releases = await fetchReleases();
      asking = false;
      if (disposed || asked) return;
      asked = true;
      if (onlyTheWorkerIsOld(releases, APP_VERSION)) {
        quiet = true;
        tryApply();
        return;
      }
      setContent(updateContent(releases, APP_VERSION));
    };
    askRef.current = () => { void ask(); };

    const tryApply = (awayMs = 0) => {
      if (!pending || disposed) return;
      // No update of any kind on a stranger's page (lib/public-paths.ts).
      if (onPublicPage()) return;
      if (superRef.current && !quiet) { void ask(); return; }
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
      // `applying`: our own SKIP_WAITING fires controllerchange too.
      if (disposed || applying || !hadControllerAtLoad) return;
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

  const onUpdate = () => {
    if (busy || !content) return;
    setBusy(true);
    // Read just now, so the digest sheet does not open with it again after the reload.
    try {
      const ledger = readWhatsNewLedger(localStorage.getItem(WHATS_NEW_KEY));
      localStorage.setItem(WHATS_NEW_KEY, JSON.stringify(markSeen(ledger, seenSlugs(content))));
    } catch { /* the digest shows it once more; nothing worse */ }
    const started = Date.now();
    let handoverAt = started;
    setSplash({ phase: 'on', target: STAGE.tapped });
    // Whatever happens below, the page is not left under the splash.
    setTimeout(() => window.location.reload(), FORCE_RELOAD_MS);
    applyRef.current({
      asked: () => setSplash({ phase: 'on', target: STAGE.asked }),
      handover: () => {
        handoverAt = Date.now();
        setSplash({ phase: 'on', target: STAGE.handover });
      },
      beforeReload: async () => {
        // Let the level visibly reach the handover, and never flash.
        await sleep(Math.max(MIN_SPLASH_MS - (Date.now() - started), 650 - (Date.now() - handoverAt), 0));
        try { sessionStorage.setItem(UPDATING_KEY, writeUpdatingNote(APP_VERSION, STAGE.handover, Date.now())); } catch { /* no second half */ }
      },
    });
  };

  const version = content?.version;
  return (
    <>
      {content && splash.phase !== 'on' && splash.phase !== 'out' && (
        <UpdateSheet content={content} busy={busy} onUpdate={onUpdate} />
      )}
      {splash.phase !== 'done' && (
        <UpdateSplash
          phase={splash.phase}
          target={splash.target}
          // On the second half this bundle IS the new version; on the first, the
          // server said which one is waiting, or did not.
          caption={
            busy
              ? version ? t('updatingTo', { version }) : t('updating')
              : t('updatingTo', { version: APP_VERSION })
          }
        />
      )}
      {toast && (
        <div
          role="status"
          className="mc-update-toast fixed inset-x-3.5 bottom-[calc(22px+env(safe-area-inset-bottom))] z-[430] flex items-center gap-2.5 rounded-2xl bg-ink-900 px-3.5 py-3 text-[13px] text-white shadow-lg"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#34c759] text-xs">✓</span>
          <span>{t('updated', { version: toast })}</span>
        </div>
      )}
    </>
  );
}

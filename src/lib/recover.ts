'use client';

import { PUSH_HEAL_DAY_KEY } from '@/lib/push-storage';

/**
 * Recovery for a client-side crash, shared by the app's error boundaries.
 *
 * ⚠️ The PWA-specific failure this exists for. This app ships a service worker
 * that caches HTML `NetworkFirst` and its build assets by URL. After a deploy the
 * hashed chunk filenames change, so a phone holding a cached HTML document can ask
 * for a chunk that no longer exists — the classic `ChunkLoadError` /
 * "Failed to fetch dynamically imported module". React's `reset()` cannot fix
 * that: it re-renders the same tree, which imports the same dead URL, and the
 * error screen simply comes back. The only cure is to drop the caches and reload.
 *
 * That matters most in the hours after a deploy, which is exactly when a launch
 * happens and exactly when someone is most likely to be told "try again".
 */

/** True for the family of errors that mean "this bundle is stale", not "this data is bad". */
export function isStaleBundleError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { name?: string; message?: string };
  const name = err.name || '';
  const message = err.message || '';
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk \d+ failed/i.test(message) ||
    /Loading CSS chunk/i.test(message) ||
    // Safari and Chrome word this differently, and both reach us from a dynamic
    // import of a chunk the cache no longer has.
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

/**
 * Drops every cache this origin holds, forces a service-worker update, then
 * reloads.
 *
 * ⚠️ It deliberately does NOT unregister the service worker, which is what this
 * did until 2026-09-06. Unregistering destroys that device's PushManager
 * subscription as a side effect, and nothing re-subscribed it: the endpoint
 * stayed in `push_subscriptions` and Apple kept answering 201 for it, so the
 * phone silently stopped receiving anything while the server counted every send
 * as delivered. Since this function fires automatically on the whole
 * stale-bundle family — i.e. potentially for every athlete after any deploy —
 * it was a ghost factory pointed at the exact failure it looks unrelated to.
 *
 * Purging the caches is what actually cures a stale bundle (the dead chunk URLs
 * live there); `update()` gets the fresh worker script without taking the
 * subscription down with it.
 *
 * Best-effort by contract: each step is separately guarded, because a browser
 * that is refusing to serve a chunk is not a browser to trust with a happy path,
 * and a throw here would leave the user on a dead screen with the one button that
 * could have helped them already spent. The reload happens whatever fails.
 */
export async function hardReload(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Ignore: an unreachable Cache Storage is not worse than a stale one.
  }
  try {
    const sw = navigator.serviceWorker;
    if (sw) {
      const regs = await sw.getRegistrations();
      // Per registration, so one rejecting can't skip the others. A failed
      // update just means the current worker stays — with empty caches it has
      // to go to the network anyway.
      await Promise.all(regs.map((r) => Promise.resolve(r.update()).catch(() => {})));
    }
  } catch {
    // Ignore: the reload below still fetches fresh HTML from the network.
  }
  try {
    // This is the app's "reset this device" button, so let the next load
    // re-verify the push subscription instead of trusting today's stamp. The
    // heal is once-a-day and stamped on success, so without this a device whose
    // subscription broke after today's heal stays unreachable until tomorrow.
    localStorage.removeItem(PUSH_HEAL_DAY_KEY);
  } catch {
    // Ignore: a blocked localStorage costs a delayed re-check, nothing more.
  }
  try {
    // A cache-busted URL rather than location.reload(): reload can be served from
    // the HTTP cache, and on iOS Safari frequently is.
    const url = new URL(window.location.href);
    url.searchParams.set('_r', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

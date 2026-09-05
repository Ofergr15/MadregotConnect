'use client';

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
 * Drops every cache and service worker this origin holds, then reloads.
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
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // Ignore: the reload below still fetches fresh HTML from the network.
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

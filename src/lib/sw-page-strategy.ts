/**
 * Which page strategy to run, decided by whether we actually have a page to fall
 * back to.
 *
 * The page cache is a NetworkFirst with `networkTimeoutSeconds: 4`. That timeout
 * means one thing only: "prefer a STORED page over a slow one." It is the right
 * behaviour on a repeat visit and it is pure loss on a cold one — with nothing
 * stored, four seconds go by, Workbox finds no fallback, and the request rejects.
 * lib/sw-page-retry.ts then re-issues it, which starts the network leg over from
 * zero. So the cold open that a runner actually experiences is
 *
 *     4s of nothing + the full request again
 *
 * on top of a server that was measured at 26.5s from cold. The four seconds bought
 * nothing, because there was never anything to prefer.
 *
 * These page buckets are BUILD-SCOPED (see lib/sw-caches.ts), so "nothing stored"
 * is not an edge case: every athlete's bucket is empty after every deploy, and
 * again 30 minutes after they last used the app. That is most opens.
 *
 * So: look first. Something usable stored → run the timed strategy, because the
 * timeout can do its job. Nothing → run a patient one that just waits for the
 * network, since a timeout can only turn "slow" into "you are offline".
 *
 * Nothing here weakens the retry in lib/sw-page-retry.ts. It stays wrapped around
 * this, because a stored entry can still be ruled expired by the ExpirationPlugin
 * AFTER the timeout has already been spent — same rejection as before, same cure.
 * This just stops that path being the normal one.
 */

/** The shape of a Serwist/Workbox strategy, narrowed to what this needs. */
export type PageStrategyLike<P> = { handle: (params: P) => Promise<Response> };

/** What choosing a strategy needs out of the handler params. */
export type PageParams = { request: Request };

/**
 * Is there a page in this bucket that could still be served for `request`?
 *
 * Age-aware on purpose. A present-but-expired entry is exactly the case that makes
 * the timeout harmful: `cache.match` finds it, the ExpirationPlugin then refuses to
 * serve it, and the four seconds are spent for nothing. Read from the response's
 * own `date` header rather than the plugin's IndexedDB timestamps, which Workbox
 * does not expose — for a stored network response the two describe the same moment.
 *
 * Every failure answers "no": a bucket we cannot read is not a fallback we can
 * promise, and the patient path is the safe side of that mistake.
 */
export async function hasStoredPage(
  cacheName: string,
  request: Request,
  maxAgeS?: number,
): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(cacheName);
    const stored = await cache.match(request);
    if (!stored) return false;
    if (maxAgeS == null) return true;
    const date = stored.headers.get('date');
    if (!date) return true;
    const ageS = (Date.now() - Date.parse(date)) / 1000;
    // A phone with a skewed clock reports a negative age; that is not a reason to
    // distrust the entry. Only a legibly OLD one counts as absent.
    return Number.isFinite(ageS) ? ageS < maxAgeS : true;
  } catch {
    return false;
  }
}

/**
 * Run `stored` when there is something to fall back to, `unstored` when there
 * isn't.
 *
 * The check is a Cache Storage read on the worker's own thread — microseconds
 * against the four seconds it removes.
 */
export function preferStored<P extends PageParams>(opts: {
  /** Timeout-guarded: worth it, because a stored page can answer instead. */
  stored: PageStrategyLike<P>;
  /** No timeout: there is no second answer, so cutting the first one off is loss. */
  unstored: PageStrategyLike<P>;
  isStored: (request: Request) => Promise<boolean>;
}): PageStrategyLike<P> {
  return {
    handle: async (params: P) =>
      (await opts.isStored(params.request))
        ? opts.stored.handle(params)
        : opts.unstored.handle(params),
  };
}

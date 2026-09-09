/**
 * "No internet connection" shown to somebody who has one.
 *
 * Reported 2026-09-08 22:17 IL: the offline screen, on wifi AND on cellular.
 * Nothing was wrong with the phone. The page cache is a NetworkFirst with
 * `networkTimeoutSeconds: 4`, and Workbox's NetworkFirst resolves that timeout
 * by handing back whatever is in the cache — which is `undefined` on a cold open,
 * because these entries expire after 30 minutes (PAGE_CACHE_MAX_AGE_S). A
 * strategy that produces no response REJECTS, and a rejected document request is
 * exactly what Serwist's `fallbacks` turns into /offline.html.
 *
 * So the offline screen was the app's answer to "the server took more than four
 * seconds and I had nothing saved" — which on a cold serverless start over
 * cellular is an ordinary morning, not an outage.
 *
 * The timeout itself is worth keeping: it is what makes a flaky connection serve
 * a stored page instantly instead of stalling. What is wrong is letting it decide
 * the user is OFFLINE when there was no stored page to prefer in the first place.
 * So: if the strategy comes back empty-handed, ask the network again, this time
 * without a ceiling. A genuinely offline phone fails that immediately and still
 * gets the offline page; a slow one gets the page it asked for.
 */

/** The shape of a Serwist/Workbox strategy, narrowed to what this needs. */
export type PageStrategyLike<P> = { handle: (params: P) => Promise<Response> };

/** What the retry needs out of the handler params: the request to re-issue. */
export type RetryableParams = { request: Request };

/**
 * Wrap a page strategy so that "no response" means "try the network properly",
 * not "you are offline".
 *
 * Only a THROWN failure is retried. A 4xx/5xx is a real answer from a reachable
 * server and is passed through untouched — re-requesting it would double every
 * error page and could replay a non-idempotent navigation.
 */
export function withNetworkRetry<P extends RetryableParams>(
  strategy: PageStrategyLike<P>,
  doFetch: (request: Request) => Promise<Response> = (request) => fetch(request),
): PageStrategyLike<P> {
  return {
    handle: async (params: P) => {
      try {
        return await strategy.handle(params);
      } catch {
        // Deliberately not logged: this runs in a service worker with no console
        // anyone reads, and the second fetch either succeeds (nothing to report)
        // or rejects and becomes the offline page (already visible).
        return doFetch(params.request);
      }
    },
  };
}

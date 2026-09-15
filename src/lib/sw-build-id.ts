/**
 * Ask a service worker which DEPLOY it belongs to.
 *
 * ⚠️ The bug this exists for. `UpdatePrompt` decides that a new version is ready
 * from three service-worker signals: a worker sitting in `waiting`, a worker
 * reaching `installed` while this page has a controller, and `controllerchange`.
 * All three also fire when the browser re-installs the build the page is ALREADY
 * RUNNING — iOS does that on its own schedule for an installed PWA (a cold
 * relaunch, or after storage eviction), and nothing about the app is new, only the
 * registration. Reported from a 2.40.54 phone that was itself on 2.40.54: "the
 * banner doesn't go away after the version updates, it's back on every launch."
 *
 * So a signal is no longer proof. Each one names a candidate worker, this asks the
 * candidate for its build, and the banner appears only if that build differs from
 * the one that was serving the page — which is a question only the workers can
 * answer, since the page's own bundle carries no deploy id (`APP_VERSION` is
 * hand-bumped and identical across every rebuild of one release).
 *
 * The reply is `null` for a worker that won't answer: one built before sw.ts grew
 * the `MC_BUILD_ID` handler, or one already `redundant`. A null makes the
 * comparison inconclusive, and inconclusive must show the banner — a missed update
 * leaves someone on a build with a fixed bug still in it, while an extra banner
 * costs one tap.
 *
 * Lives outside both the component and `sw.ts` so it can be tested in node: the
 * component needs React and the worker file references webworker globals, but this
 * needs nothing but `MessageChannel` and an object with `postMessage`.
 */

/** Message both sides agree on. Must match the handler in `src/app/sw.ts`. */
export const BUILD_ID_MESSAGE = 'MC_BUILD_ID';

/**
 * How long to wait for a worker to name its build.
 *
 * Only ever reached when a worker is present and silent, and that case shows the
 * banner anyway, so this is a delay on an unusual path and never a lost update.
 */
export const BUILD_ID_TIMEOUT_MS = 1500;

/** The half of `ServiceWorker` this needs — so a test can pass a plain object. */
export interface BuildIdTarget {
  postMessage(message: unknown, transfer: unknown[]): void;
}

export function askBuildId(
  worker: BuildIdTarget | null | undefined,
  timeoutMs: number = BUILD_ID_TIMEOUT_MS,
): Promise<string | null> {
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (id: string | null) => {
      if (settled) return;
      settled = true;
      resolve(id);
    };
    // A MessageChannel rather than `navigator.serviceWorker.onmessage`: the reply
    // has to be attributable to the worker we asked, and the caller may be asking
    // two of them at once (its controller and a pending one).
    //
    // Wrapped because postMessage THROWS for a worker in `redundant` — a worker
    // that will never control anything, so it has no build worth reporting.
    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event: MessageEvent) => {
        const id = (event.data as { buildId?: unknown } | null)?.buildId;
        finish(typeof id === 'string' && id ? id : null);
      };
      worker.postMessage({ type: BUILD_ID_MESSAGE }, [channel.port2]);
    } catch {
      finish(null);
    }
    setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Is `candidate` a genuinely different deploy from the one serving this page?
 *
 * The one rule worth stating out loud: equal ids are the ONLY silent case.
 * Everything else — either side unknown, or two different ids — shows the banner.
 */
export function isNewerBuild(loaded: string | null, candidate: string | null): boolean {
  if (loaded && candidate && loaded === candidate) return false;
  return true;
}

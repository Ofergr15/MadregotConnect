/**
 * Leaflet, loaded from the CDN exactly once per document.
 *
 * Two screens draw maps — the activity route (`components/activity/RouteMap.tsx`)
 * and the calendar's race map — and each used to inject its own `<script>`. That
 * is not merely wasteful: leaflet's UMD build assigns `window.L` on load, so a
 * SECOND load replaces the library object while a map built by the first one is
 * still on screen. From then on the two instances are mixed, and mixing them is a
 * crash, not a glitch — `L.latLngBounds()` from instance B is not an
 * `instanceof LatLngBounds` to instance A, so A's `toLatLngBounds` treats the
 * object as a corner array, builds empty bounds and `fitBounds` throws
 * "Bounds are not valid." The error boundary then replaces the whole activity
 * screen with "back to home".
 *
 * Measured, not theorised: the UI audit's `activity-detail` screen crashed on 2 of
 * 8 loads, every load carried two `<script src=…leaflet…>` tags, and the crash
 * landed on whichever loads finished in the unlucky order. It is intermittent by
 * nature — which is exactly why it needs a structural fix rather than a retry.
 *
 * The promise is module-level on purpose: every caller awaits the same load and
 * gets the same library object. Callers must then hold the RESOLVED value and use
 * it for all later leaflet calls instead of re-reading `window.L`, so no map can
 * ever be handed an object from a different instance again.
 */

const CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

let loading: Promise<any> | null = null;

export function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('leaflet: no document'));
  }
  if (loading) return loading;

  const existing = (window as any).L;
  // `L?.Map`, not `L`: the UMD wrapper assigns an EMPTY object first and fills it
  // as the file evaluates, so a bare truthiness check can hand out a library with
  // no `Map` on it yet.
  if (existing?.Map) {
    loading = Promise.resolve(existing);
    return loading;
  }

  loading = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS_URL;
      link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }

    const done = () => resolve((window as any).L);
    const failed = () => {
      // Cleared so a later mount can try again — a map that failed to load once on
      // a flaky connection should not be permanently dead for the session.
      loading = null;
      reject(new Error('leaflet: script failed to load'));
    };

    // A tag from an earlier version of this code, or from a call that started
    // before this one. Attach and wait rather than adding a second copy.
    const started = document.querySelector<HTMLScriptElement>('script[data-leaflet]');
    if (started) {
      started.addEventListener('load', done);
      started.addEventListener('error', failed);
      return;
    }

    const script = document.createElement('script');
    script.src = JS_URL;
    script.setAttribute('data-leaflet', '1');
    script.addEventListener('load', done);
    script.addEventListener('error', failed);
    document.head.appendChild(script);
  });

  return loading;
}

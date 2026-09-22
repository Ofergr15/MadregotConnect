'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { APP_VERSION } from '@/lib/version';
import { MAX_BATCH, type ClientEventKind } from '@/lib/bugs/client-events';

/**
 * The half of the bug board that watches the browser.
 *
 * Five of the eleven detectors have no source but this — see migration 118. What
 * this component does is narrow on purpose: it notices five things and posts
 * them, and it is allowed to do nothing else.
 *
 * ── THE RULES IT LIVES BY ───────────────────────────────────────────────────
 *
 * 1. IT NEVER SHOWS ANYTHING. No toast, no banner, no console noise in
 *    production. An athlete must not learn about a bug from the bug reporter.
 * 2. IT NEVER RETRIES. A failed POST is dropped. A reporter that retries turns a
 *    bad deploy into a flood, and the flood arrives at the moment the app is
 *    least able to take it.
 * 3. IT CANNOT BE THE BUG. Every handler is wrapped, it reports at most a handful
 *    of events per page life, and it will not report an error thrown by its own
 *    code — otherwise the first failure in here becomes an infinite loop that
 *    files itself.
 * 4. IT SENDS NO CONTENT. Paths without query strings, error messages, and the
 *    build number. Never a form value, never a stack trace, never a user agent.
 *    Each of those would be a thing to justify keeping about 25 named people.
 */

/** Per page life, across all kinds. A loop must cost a dozen rows, not a table. */
const MAX_PER_PAGE = 24;
/** How long a route gets to actually render before "empty" means anything. */
const BLANK_AFTER_MS = 2500;
/** Batched rather than sent one at a time: a burst of errors is one request. */
const FLUSH_AFTER_MS = 4000;

interface Queued {
  kind: ClientEventKind;
  route: string;
  message?: string;
}

/**
 * Is the app shell showing nothing?
 *
 * Measured against <main>, which only the app shell renders — so the probe is
 * simply absent on login and the other bare pages rather than reporting every one
 * of them as blank. A picture counts as content: a map or a photo with no text
 * around it is a page that rendered.
 */
function looksBlank(): boolean {
  const main = document.querySelector('main');
  if (!main) return false;
  const hasText = (main.textContent || '').trim().length > 1;
  const hasPicture = !!main.querySelector('img, svg, canvas, video');
  return !hasText && !hasPicture;
}

/** The probe's own channel, so the listeners are installed exactly once. */
const BLANK_EVENT = 'mc:blank';

export function ClientEventReporter() {
  const pathname = usePathname();
  // A ref rather than state throughout: nothing here may cause a render, and a
  // reporter that re-renders the app it is watching is measuring itself.
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const queue: Queued[] = [];
    let sent = 0;
    let inside = false;          // rule 3: no reporting from inside the reporter
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disabled = false;        // set when the POST is refused, e.g. no session

    /** The path only. The query string is stripped HERE, before it can be sent. */
    const route = () => (path.current || window.location.pathname || '/').split('?')[0];

    const flush = (beacon = false) => {
      if (!queue.length || disabled) return;
      const body = JSON.stringify({ events: queue.splice(0, MAX_BATCH) });
      try {
        // On the way out of the page, a normal fetch is cancelled with it — which
        // is exactly when a crash report is most likely to exist.
        if (beacon && navigator.sendBeacon) {
          navigator.sendBeacon('/api/client-events', new Blob([body], { type: 'application/json' }));
          return;
        }
        void fetch('/api/client-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).then(res => {
          // 401 on the login page is the expected answer, not a problem: stop
          // trying for the rest of this page rather than posting into a 401 loop.
          if (res.status === 401 || res.status === 403) disabled = true;
        }).catch(() => undefined);
      } catch {
        // Rule 2. There is nothing useful to do with a failure to report.
      }
    };

    const record = (kind: ClientEventKind, message?: string) => {
      if (inside || disabled || sent >= MAX_PER_PAGE) return;
      inside = true;
      try {
        sent += 1;
        queue.push({ kind, route: route(), message: message?.slice(0, 300) });
        if (timer) clearTimeout(timer);
        // `boot` is not urgent and an error might be followed by three more, so
        // everything waits a few seconds and travels together.
        timer = setTimeout(() => flush(), FLUSH_AFTER_MS);
      } catch {
        // Nothing. See rule 3.
      } finally {
        inside = false;
      }
    };

    /* ── error ── an uncaught exception, or a promise nobody caught ───────── */
    const onError = (e: ErrorEvent) => {
      record('error', e.message || 'error');
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as unknown;
      const message = r instanceof Error ? r.message : typeof r === 'string' ? r : 'unhandled rejection';
      record('error', message);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    /* ── api_error ── our own API answered 5xx, measured where it was felt ──
     *
     * Wrapping fetch rather than instrumenting a hundred route files, and read
     * from the client on purpose: a 500 nobody was waiting on is a log line, a
     * 500 that broke a page is a bug, and only the browser knows which it was.
     * The reporter's own endpoint is excluded, or a failing report reports itself.
     */
    const realFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await realFetch(...args);
      try {
        const url = typeof args[0] === 'string'
          ? args[0]
          : args[0] instanceof Request ? args[0].url : String(args[0]);
        const p = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];
        if (res.status >= 500 && p.startsWith('/api/') && !p.startsWith('/api/client-events')) {
          record('api_error', String(res.status));
          // `route` on this event is the API path, not the screen: that is the
          // thing somebody can go and fix, and it is how the detector groups.
          const last = queue[queue.length - 1];
          if (last) last.route = p;
        }
      } catch {
        // Never let the measurement break the call it was measuring.
      }
      return res;
    };

    /* ── form_abandon ── typed into, then left, without a submit ────────────
     *
     * Listened for on the document in the capture phase, so no form needs to know
     * about it. It sees real <form> elements only — a "form" the app builds out of
     * divs and a button is invisible here, which is a known limit and better than
     * asking thirty components to report on themselves.
     *
     * No field VALUE is read. The only fact recorded is that a form on this route
     * was typed into and never submitted.
     */
    const dirty = new Set<HTMLFormElement>();
    const onInput = (e: Event) => {
      const form = (e.target as HTMLElement | null)?.closest?.('form');
      if (form) dirty.add(form as HTMLFormElement);
    };
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      if (form) dirty.delete(form);
    };
    document.addEventListener('input', onInput, true);
    document.addEventListener('submit', onSubmit, true);

    /* ── blank ── the route settled with nothing in it ──────────────────────
     *
     * The probe itself runs per route, in the second effect; this is the one
     * listener it reports through, so the queue and its caps stay in one place.
     */
    const onBlank = () => record('blank');
    window.addEventListener(BLANK_EVENT, onBlank);

    /* ── boot ── which build this phone is actually running ───────────────── */
    record('boot', APP_VERSION);

    const onHide = () => {
      // Route-level abandonment is counted here rather than on every navigation,
      // because the page being hidden is the moment the input is definitively lost.
      for (let i = 0; i < dirty.size; i += 1) record('form_abandon');
      dirty.clear();
      flush(true);
    };
    window.addEventListener('pagehide', onHide);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener(BLANK_EVENT, onBlank);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('submit', onSubmit, true);
      if (timer) clearTimeout(timer);
      window.fetch = realFetch;
      flush();
    };
    // Mounted once for the life of the page. The blank probe and the boot event
    // are both about this load, and re-running the effect per route would file a
    // boot on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The blank probe runs per route: a page that renders empty after a tap is the
   * same bug as one that renders empty on a cold open, and only re-measuring
   * catches the first of those. It reports through the listener installed above
   * rather than owning a second queue, so the per-page cap covers both. */
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (looksBlank()) window.dispatchEvent(new Event(BLANK_EVENT));
      } catch {
        // Nothing. The probe is not allowed to be the thing that breaks a page.
      }
    }, BLANK_AFTER_MS);
    return () => clearTimeout(t);
  }, [pathname]);

  return null;
}

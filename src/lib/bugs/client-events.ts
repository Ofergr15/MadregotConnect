/**
 * What the app is allowed to tell the server about its own failures.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Five of the eleven detectors in `detectors.ts` could not be written at all,
 * because nothing in the database knows what happened in the browser. A chunk
 * that 404s after a deploy, a page that renders empty, a form somebody filled in
 * and lost — every one of those is invisible from the server, and the athlete's
 * version of the report is "it didn't work". `client_events` is the smallest
 * table that makes those five answerable.
 *
 * ── THE RULES OF THE WIRE ───────────────────────────────────────────────────
 *
 * 1. NO IDENTITY IN THE BODY. The athlete is taken from the session, never from
 *    what was posted. The client cannot report an event as somebody else, which
 *    is the same rule the whole `x-user-email` sweep was about.
 * 2. THE VERSION IS THE CLIENT'S. `app_version` is the one field that must come
 *    from the browser: the entire point of `stuck_version` is that the client is
 *    running an OLDER build than the server, so stamping the server's version
 *    would erase the only signal. It is shape-checked, not trusted.
 * 3. NO FREE-TEXT SURFACE. `kind` is an allow-list, `message` is truncated, and
 *    a batch is capped. This endpoint is a funnel into a table; it must not be
 *    usable as storage.
 * 4. NOTHING PERSONAL. A message is an error string and a route is a path. No
 *    form VALUES are ever sent — `form_abandon` reports that a form was
 *    abandoned, not what was in it. Anything else would mean a bug board that
 *    quietly accumulates the club's private data.
 */

/**
 * The five kinds, and what each one is FOR. Adding a sixth means adding a
 * detector that reads it — a kind nothing detects is data collected for its own
 * sake, which is the thing that makes a table like this grow forever.
 *
 *  · `error`        — an uncaught exception or rejected promise. → client_error
 *  · `api_error`    — a call to our own API came back 5xx.       → server_error
 *  · `blank`        — the page settled with nothing in it.       → blank_screen
 *  · `form_abandon` — a form was typed into and then left.       → dropped_form
 *  · `boot`         — the app started, and on which build.       → stuck_version
 */
export const CLIENT_EVENT_KINDS = ['error', 'api_error', 'blank', 'form_abandon', 'boot'] as const;

export type ClientEventKind = (typeof CLIENT_EVENT_KINDS)[number];

/** One event as the browser posts it. */
export interface ClientEventInput {
  kind: string;
  route?: string | null;
  message?: string | null;
  appVersion?: string | null;
}

/** One event as it is stored. `athlete_id` is added by the route from the session. */
export interface ClientEventPayload {
  kind: ClientEventKind;
  route: string | null;
  message: string | null;
  app_version: string | null;
}

/** A stored row, as the detectors read it back. */
export interface ClientEventRow {
  id: string;
  athlete_id: string | null;
  kind: string;
  route: string | null;
  message: string | null;
  app_version: string | null;
  created_at: string;
}

/** Enough for a whole page's worth of trouble; not enough to be a write API. */
export const MAX_BATCH = 20;
const MAX_MESSAGE = 300;
const MAX_ROUTE = 120;

/** `2.40.99`, and nothing else. A version is three numbers. */
const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;

/**
 * A path, with the query string removed.
 *
 * The query string is dropped rather than truncated: it is the one part of a URL
 * that carries tokens and ids, and `/join/abc123?token=…` on a bug board is a
 * credential on a bug board. Route ids are kept — `/dashboard/teammate/<uuid>`
 * is how you find out a page only breaks for one person.
 */
function cleanRoute(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.split('?')[0].split('#')[0].trim();
  if (!path.startsWith('/')) return null;
  return path.slice(0, MAX_ROUTE);
}

/**
 * Validate and trim a posted batch. Pure, so the rules can be tested against the
 * shapes that actually arrive rather than against a mock of the route.
 *
 * Bad events are DROPPED, not rejected: one malformed entry in a batch of twelve
 * must not lose the other eleven, and a reporter that gets a 400 back has no way
 * to tell which event it was about.
 */
export function sanitiseEvents(body: unknown): ClientEventPayload[] {
  const raw = Array.isArray(body) ? body : (body as { events?: unknown })?.events;
  if (!Array.isArray(raw)) return [];

  const out: ClientEventPayload[] = [];
  for (const item of raw.slice(0, MAX_BATCH)) {
    const e = item as ClientEventInput;
    if (!e || typeof e !== 'object') continue;
    if (!CLIENT_EVENT_KINDS.includes(e.kind as ClientEventKind)) continue;

    const message = typeof e.message === 'string' ? e.message.trim().slice(0, MAX_MESSAGE) : '';
    out.push({
      kind: e.kind as ClientEventKind,
      route: cleanRoute(e.route),
      message: message || null,
      app_version:
        typeof e.appVersion === 'string' && VERSION_SHAPE.test(e.appVersion) ? e.appVersion : null,
    });
  }
  return out;
}

/**
 * Collapse an error message to its SHAPE, so the same bug from twelve phones is
 * one finding rather than twelve.
 *
 * What gets stripped is everything that varies per occurrence and carries no
 * diagnostic weight: the content hash in a chunk name, line and column numbers,
 * ids, quoted values. Without this, `Loading chunk 4f3a1b failed` and
 * `Loading chunk 9c02de failed` are two unrelated problems and the one real
 * finding — a deploy that broke the cache — never reaches two people.
 */
export function errorShape(message: string | null): string {
  if (!message) return '(no message)';
  return message
    .replace(/https?:\/\/[^\s)]+/g, '<url>')
    // A build hash: hex, and it must contain a digit, or `decade` and `faced` get
    // eaten out of the middle of a real message.
    .replace(/\b(?=[0-9a-z]*\d)[0-9a-f]{4,}\b/gi, '<hash>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/["'`][^"'`]{0,60}["'`]/g, '<value>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Compare two version strings numerically. `2.40.9` is older than `2.40.10`,
 * which a string comparison gets backwards — and getting it backwards means
 * `stuck_version` reports the whole club as stale on the day the patch number
 * crosses a ten.
 *
 * Returns a negative number when `a` is older, 0 when equal, positive when newer.
 * An unparseable version sorts as equal, i.e. never produces a finding.
 */
export function compareVersions(a: string | null, b: string | null): number {
  if (!a || !b || !VERSION_SHAPE.test(a) || !VERSION_SHAPE.test(b)) return 0;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

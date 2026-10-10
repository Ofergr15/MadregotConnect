'use client';

// The client half of "view as this person" (lib/auth/view-as.ts). Kept in
// sessionStorage, so closing the app ends it, and folded into the SWR cache's
// identity (lib/swr-persist.ts), so whatever was fetched as somebody else is
// thrown away on the way in and on the way out instead of being shown later as
// the admin's own.
//
// The server answers every /api/ read as the viewed person. That is only half of
// "the whole app as they see it", because the client keeps its own idea of who is
// signed in: some seventy reads of `localStorage.athlete_id` and friends decide
// which athlete a screen asks about. So while viewing, those keys read as the
// viewed person's (installViewAsOverlay), and writes to them are dropped, so the
// admin's real identity is still there, untouched, the moment the view ends.
//
// And because the server refusing a write is a 403 after the fact, the client
// does not send one at all: every non-GET to /api/ while viewing is answered here
// with the same `view_as_read_only` the server would give. A write the person
// tapped raises the read-only toast (ViewAsBanner); a background one (a read mark,
// a sync on open, analytics, a push subscription) is dropped silently.

import { useState } from 'react';
import { VIEW_AS_HEADER, type ViewAsTag } from '@/lib/auth/view-as';

const KEY = 'mc_view_as_person';
/** The last few people viewed, newest first — the chooser's "אחרונים". */
export const RECENT_KEY = 'mc_view_as_recent';
const RECENT_MAX = 5;

/** Fired on window when a write was refused, so the banner can say why. */
export const VIEW_AS_BLOCKED_EVENT = 'view-as-blocked';

export interface ViewedPerson {
  id: string;
  name: string;
  /** What they are, for the banner: the chooser's tag (lib/auth/view-as.ts). */
  tag: ViewAsTag;
  email?: string | null;
  groupId?: string | null;
  avatarUrl?: string | null;
}

export interface RecentPerson extends ViewedPerson {
  /** When they were last viewed (ms). */
  at: number;
}

// The browser's own methods, captured before the overlay replaces them, so this
// module can always reach the REAL identity keys.
const nativeGet = typeof Storage !== 'undefined' ? Storage.prototype.getItem : null;
const nativeSet = typeof Storage !== 'undefined' ? Storage.prototype.setItem : null;
const nativeRemove = typeof Storage !== 'undefined' ? Storage.prototype.removeItem : null;

let parsed: { raw: string | null; person: ViewedPerson | null } = { raw: null, person: null };

export function getViewedPerson(): ViewedPerson | null {
  if (typeof window === 'undefined' || !nativeGet) return null;
  try {
    const raw = nativeGet.call(window.sessionStorage, KEY);
    if (raw === parsed.raw) return parsed.person;
    const v = raw ? (JSON.parse(raw) as ViewedPerson) : null;
    const person = v && typeof v.id === 'string' && typeof v.name === 'string' ? v : null;
    parsed = { raw, person };
    return person;
  } catch {
    return null;
  }
}

export function isViewingPerson(): boolean {
  return getViewedPerson() !== null;
}

export function readRecentPeople(): RecentPerson[] {
  if (typeof window === 'undefined' || !nativeGet) return [];
  try {
    const list = JSON.parse(nativeGet.call(window.localStorage, RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function rememberRecent(person: ViewedPerson): void {
  if (!nativeSet) return;
  const next = [{ ...person, at: Date.now() }, ...readRecentPeople().filter((p) => p.id !== person.id)].slice(0, RECENT_MAX);
  try { nativeSet.call(window.localStorage, RECENT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

/** Where to land after a switch: the same screen, without the query string's one-shot params. */
function here(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Start viewing as `person` and reload, so every read is theirs. `to` defaults
 * to the feed: the screen the admin is on is often one the person cannot open.
 */
export function startViewingAs(person: ViewedPerson, to = '/feed'): void {
  if (!nativeSet || !nativeRemove) return;
  try {
    nativeSet.call(window.sessionStorage, KEY, JSON.stringify(person));
    // A role preview underneath would draw somebody else's nav over their data.
    nativeRemove.call(window.localStorage, 'view_as_role');
  } catch { return; }
  rememberRecent(person);
  window.location.assign(to);
}

/**
 * End the view without navigating — for sign-out (clearIdentityKeys), which has
 * to reach the REAL identity keys, and the overlay hides them while viewing.
 */
export function clearViewedPerson(): void {
  try { nativeRemove?.call(window.sessionStorage, KEY); } catch { /* nothing to remove */ }
}

/** Back to yourself, on the same screen. */
export function stopViewingAs(to?: string): void {
  try { nativeRemove?.call(window.sessionStorage, KEY); } catch { /* nothing to remove */ }
  window.location.assign(to ?? here());
}

/**
 * Open the eye button's chooser (ImpersonationBar) on one of its tabs. The one
 * way in, so the Header, the tab bar, the admin account screen and the academy's
 * ⚙ all open the same sheet.
 */
export function openViewAsChooser(tab: 'person' | 'role' = 'person'): void {
  window.dispatchEvent(new CustomEvent('open-view-as', { detail: tab }));
}

/**
 * For a write button: is the app being viewed as somebody, so it should draw
 * greyed and answer a tap with announceReadOnly() instead? Read once on mount —
 * starting or ending a view reloads the page.
 */
export function useViewAsReadOnly(): boolean {
  const [viewing] = useState(isViewingPerson);
  return viewing;
}

/** Say "read-only" (the banner's toast) for a control that is greyed while viewing. */
export function announceReadOnly(): void {
  window.dispatchEvent(new Event(VIEW_AS_BLOCKED_EVENT));
}

// ── The overlay ──────────────────────────────────────────────────────────────

/**
 * What the identity keys read as while viewing. Every key in IDENTITY_KEYS
 * (lib/auth/identity-keys.ts) is here: the four that name a person read as the
 * viewed one, and the elevated or per-identity ones read as absent, so neither
 * the admin's staff flags nor their view switch leak into somebody else's app.
 */
const OVERLAY: Record<string, (p: ViewedPerson) => string | null> = {
  athlete_id: (p) => p.id,
  athlete_name: (p) => p.name || null,
  athlete_email: (p) => p.email || null,
  athlete_group_id: (p) => p.groupId || null,
  coach_email: () => null,
  admin_session: () => null,
  view_as_role: () => null,
  active_view: () => null,
  active_view_role: () => null,
  view_group: () => null,
  garmin_ticket: () => null,
  dashboard_synced: () => null,
  dashboard_synced_with_garmin: () => null,
};

/**
 * What a write to /api/ does while viewing. `send` for the deny-listed auth doors
 * (silent re-auth and sign-out are the admin's own session), `silent` for writes
 * nobody tapped, `toast` for everything else.
 */
export type ViewAsWrite = 'send' | 'silent' | 'toast';

const BACKGROUND_WRITES = [
  '/api/client-events',
  '/api/client-log',
  '/api/push/',
  '/api/strava/sync-activities',
  '/api/garmin/sync-activities',
  '/api/run-chat/token',
  '/api/academy/threads',
  '/api/onboarding',
];

export function viewAsWriteDisposition(pathname: string, method: string): ViewAsWrite {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'send';
  if (pathname.startsWith('/api/auth/') && pathname !== '/api/auth/me') return 'send';
  if (BACKGROUND_WRITES.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p))) return 'silent';
  return 'toast';
}

function readOnlyResponse(): Response {
  return new Response(JSON.stringify({ error: 'view_as_read_only' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

let installed = false;

/**
 * Install the overlay once per page. Idempotent and free when nobody is being
 * viewed: each patched method asks getViewedPerson() first and otherwise is the
 * browser's own.
 */
export function installViewAsOverlay(): void {
  if (installed || typeof window === 'undefined' || !nativeGet || !nativeSet || !nativeRemove) return;
  installed = true;

  const isLocal = (s: Storage) => {
    try { return s === window.localStorage; } catch { return false; }
  };

  Storage.prototype.getItem = function (this: Storage, key: string) {
    const person = isLocal(this) && key in OVERLAY ? getViewedPerson() : null;
    return person ? OVERLAY[key](person) : nativeGet.call(this, key);
  };
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    if (isLocal(this) && key in OVERLAY && getViewedPerson()) return;
    nativeSet.call(this, key, value);
  };
  Storage.prototype.removeItem = function (this: Storage, key: string) {
    if (isLocal(this) && key in OVERLAY && getViewedPerson()) return;
    nativeRemove.call(this, key);
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const person = getViewedPerson();
    if (!person) return nativeFetch(input, init);
    let url: URL;
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    } catch {
      return nativeFetch(input, init);
    }
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, init);

    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const disposition = viewAsWriteDisposition(url.pathname, method);
    if (disposition !== 'send') {
      if (disposition === 'toast') window.dispatchEvent(new Event(VIEW_AS_BLOCKED_EVENT));
      return Promise.resolve(readOnlyResponse());
    }
    // A hand-written fetch that built its own headers (a raw Bearer, the Stream
    // token route) would otherwise be answered as the admin.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(VIEW_AS_HEADER)) headers.set(VIEW_AS_HEADER, person.id);
    return nativeFetch(input, { ...init, headers });
  };

  // Analytics beacons (ClientEventReporter) are writes nobody tapped.
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      if (getViewedPerson()) {
        try {
          if (new URL(String(url), window.location.href).origin === window.location.origin) return true;
        } catch { return true; }
      }
      return nativeBeacon(url, data);
    };
  }
}

installViewAsOverlay();

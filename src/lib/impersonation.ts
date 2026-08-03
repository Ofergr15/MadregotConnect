'use client';

// "View as" / impersonation for the super user (see SUPER_USER_EMAIL).
//
// The app derives the current user entirely from a handful of localStorage keys
// and then filters data client-side (see Header + every dashboard page). So to
// preview the app exactly as another member sees it, we snapshot the super
// user's own identity, overwrite those keys with the target's, and reload — the
// whole app (and the MaintenanceGate) then renders as that member. Exit restores
// the snapshot and reloads back.
//
// The preview is READ-ONLY: while impersonating, installImpersonationGuard()
// blocks all data-mutating requests so nothing is ever written under a member's
// name. Auth/session refreshes are left untouched so the session stays alive.

export interface ViewAsTarget {
  id: string;
  email: string;
  name: string;
  groupId?: string | null;
  role?: string;
}

// The super user's real identity, saved before the first switch so Exit can
// restore it verbatim (JSON of the identity keys below).
const SNAPSHOT_KEY = 'view_as_snapshot';
// The member currently being previewed (JSON of ViewAsTarget). Presence of this
// key === "impersonating".
const ACTIVE_KEY = 'view_as_active';

// Identity keys the app reads to decide "who am I". Overwriting these is what
// makes the app render as the target user.
const IDENTITY_KEYS = [
  'athlete_id',
  'athlete_name',
  'athlete_email',
  'athlete_group_id',
  'coach_email',
  'admin_session',
] as const;

export function getActiveImpersonation(): ViewAsTarget | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return raw ? (JSON.parse(raw) as ViewAsTarget) : null;
  } catch {
    return null;
  }
}

export function isImpersonating(): boolean {
  return getActiveImpersonation() !== null;
}

// Enter (or switch) "view as" for a target member, then reload so every page
// re-reads identity from localStorage and renders as that member.
export function startImpersonation(target: ViewAsTarget) {
  if (typeof window === 'undefined') return;

  // Snapshot the REAL identity only once (don't overwrite it when switching
  // from one previewed member to another).
  if (!localStorage.getItem(SNAPSHOT_KEY)) {
    const snapshot: Record<string, string | null> = {};
    for (const k of IDENTITY_KEYS) snapshot[k] = localStorage.getItem(k);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  }

  // Become the target member: an athlete session keyed by their id/email.
  localStorage.setItem('athlete_id', target.id);
  localStorage.setItem('athlete_name', target.name || '');
  localStorage.setItem('athlete_email', target.email || '');
  if (target.groupId) localStorage.setItem('athlete_group_id', target.groupId);
  else localStorage.removeItem('athlete_group_id');
  // Drop staff flags so we see the member's own (non-staff) view.
  localStorage.removeItem('coach_email');
  localStorage.removeItem('admin_session');

  localStorage.setItem(ACTIVE_KEY, JSON.stringify(target));
  // Clear a cached "already synced" flag so the previewed dashboard loads fresh.
  localStorage.removeItem('dashboard_synced');
  window.location.assign('/dashboard');
}

// Exit "view as": restore the super user's real identity and reload back.
export function stopImpersonation() {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    const snapshot: Record<string, string | null> = raw ? JSON.parse(raw) : {};
    for (const k of IDENTITY_KEYS) {
      const v = snapshot[k];
      if (v === null || v === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    }
  } finally {
    localStorage.removeItem(SNAPSHOT_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem('dashboard_synced');
  }
  window.location.assign('/dashboard');
}

// Requests that must stay allowed even while impersonating (session/auth
// refresh, and the reads that power the switcher itself).
function isAllowedWhileImpersonating(url: string, method: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const u = url.toLowerCase();
  // Supabase GoTrue auth (token refresh, session) — never block, or the preview
  // session dies. Everything else on Supabase rest/storage is a data mutation.
  if (u.includes('/auth/v1/')) return true;
  return false;
}

// Wrap window.fetch once so that, while impersonating, every data-mutating
// request is short-circuited with a synthetic 403. This makes the whole preview
// read-only without touching any of the app's ~40 forms individually.
let guardInstalled = false;
export function installImpersonationGuard() {
  if (typeof window === 'undefined' || guardInstalled) return;
  guardInstalled = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isImpersonating()) {
      const method = (
        init?.method ||
        (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : 'GET') ||
        'GET'
      ).toUpperCase();
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (!isAllowedWhileImpersonating(url, method)) {
        // Synthetic, non-throwing response so callers' .then/.catch behave and
        // the UI simply shows "couldn't save" rather than crashing.
        return new Response(
          JSON.stringify({ error: 'read_only_preview', message: 'View-as preview is read-only.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    return nativeFetch(input, init);
  };
}

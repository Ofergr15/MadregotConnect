'use client';

// "View as" for the super user (Ofer — see SUPER_USER_EMAIL).
//
// This does NOT change who you are — you stay signed in as yourself. It only
// overrides which ROLE / SCENARIO the app renders, so the super user can preview
// the different options each kind of user sees:
//   - a role name ('admin' | 'coach' | 'runner' | 'viewer' | …) → the Header nav
//     and role-gated UI render as if you had that role (and the maintenance gate
//     is bypassed so you can actually see the app);
//   - '__maintenance__' → force-show the maintenance ("rebuilding the stairs")
//     screen, i.e. what a member blocked by maintenance sees.
//
// The chosen mode lives in one localStorage key and is read by the Header
// (nav/role) and the MaintenanceGate. While a mode is active the preview is
// READ-ONLY (installViewGuard blocks data-mutating requests) so nothing changes
// while you're just looking around.

export const MAINTENANCE_MODE = '__maintenance__';

const KEY = 'view_as_role';

export function getViewMode(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
}

export function isPreviewing(): boolean {
  return !!getViewMode();
}

// Roles that see the "staff" flavour of the app (full nav, no profile tab). Used
// to decide whether a previewed role should also get the athlete profile tab.
export const STAFF_ROLES = ['admin', 'coach', 'academy_coach'];

// Enter (or switch) a view mode, then reload so the Header + gate re-read it.
export function startViewAs(mode: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, mode);
  localStorage.removeItem('dashboard_synced');
  window.location.assign('/dashboard');
}

// Exit the preview and return to the super user's real view.
export function stopViewAs() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
  localStorage.removeItem('dashboard_synced');
  window.location.assign('/dashboard');
}

// Requests that stay allowed even while previewing (session/auth refresh).
function isAllowedWhilePreviewing(url: string, method: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const u = url.toLowerCase();
  if (u.includes('/auth/v1/')) return true;
  // Sending a notification/survey already has its own explicit
  // confirm-before-send step (NotificationCenter's ConfirmSheet) — that
  // deliberate-intent gate covers what this guard exists to prevent, so a
  // role preview shouldn't also block an intentional real send. Only the
  // real super user can ever be in a preview mode in the first place, so
  // this never lets a different person's action through.
  if (u.includes('/api/notifications') || u.includes('/api/admin/surveys')) return true;
  return false;
}

// Wrap window.fetch once so that, while a view mode is active, every
// data-mutating request is short-circuited with a synthetic 403 — the whole
// preview is read-only without touching any of the app's forms individually.
let guardInstalled = false;
export function installViewGuard() {
  if (typeof window === 'undefined' || guardInstalled) return;
  guardInstalled = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isPreviewing()) {
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

      if (!isAllowedWhilePreviewing(url, method)) {
        return new Response(
          JSON.stringify({ error: 'read_only_preview', message: 'View-as preview is read-only.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    return nativeFetch(input, init);
  };
}

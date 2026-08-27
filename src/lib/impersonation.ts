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
// (nav/role) and the MaintenanceGate.

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

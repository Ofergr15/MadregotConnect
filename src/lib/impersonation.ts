'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { Shield, Megaphone, Footprints, Glasses, Construction } from 'lucide-react';
import { isSuperUser } from '@/lib/constants';
import { getSupabase } from '@/lib/supabase/client';

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

/**
 * The scenarios that can be previewed, in the order they're offered. One list,
 * because three surfaces render it now — the chooser sheet (ImpersonationBar),
 * the tab bar's "More" sheet, and the Header's own entry point — and a role
 * missing from one of them is a role you can't get back to.
 */
export const VIEW_AS_SCENARIOS: Array<{ mode: string; label: string; icon: ComponentType<{ className?: string }>; tone: string }> = [
  { mode: 'runner', label: 'רץ', icon: Footprints, tone: 'text-accent-600' },
  { mode: 'coach', label: 'מאמן', icon: Megaphone, tone: 'text-band-2' },
  { mode: 'admin', label: 'מנהל', icon: Shield, tone: 'text-violet-700' },
  { mode: 'viewer', label: 'צופה', icon: Glasses, tone: 'text-ink-500' },
  { mode: MAINTENANCE_MODE, label: 'מסך תחזוקה', icon: Construction, tone: 'text-band-3' },
];

/**
 * Is the person at the keyboard the super user, so the view-as control should be
 * offered at all?
 *
 * Both identity sources are checked, not one-then-the-other: the app has two
 * login paths and each leaves a different trace. A Strava/Garmin athlete gets a
 * synthetic `athlete_email` (…@strava.madregot.local) that will never match, so
 * a check that stops at localStorage decides "not the super user" and hides
 * every entry point — which is how the switcher went missing while all of its
 * code was still there. The Supabase session is the authority; localStorage is
 * only the fast answer that avoids a frame without the control.
 *
 * Purely a UI question: view-as changes what is RENDERED, never what the server
 * will do (every API route authorizes the real session), so being wrong here
 * costs a hidden button, not access.
 */
export function useIsSuperUser(): boolean {
  const [isSuper, setIsSuper] = useState(false);

  useEffect(() => {
    const stored =
      localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
    if (isSuperUser(stored)) setIsSuper(true);

    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (isSuperUser(data.session?.user?.email)) setIsSuper(true);
      })
      .catch(() => {});
  }, []);

  return isSuper;
}

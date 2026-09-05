'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { Shield, Megaphone, Footprints, Glasses, Construction } from 'lucide-react';
import { isSuperUser } from '@/lib/constants';
import { useApi } from '@/lib/api';
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
 * code was still there.
 *
 * Reading the Supabase session instead was not enough either: the session's email
 * IS the synthetic one, so the literal honestly does not match and the switcher
 * stayed hidden. The authority is now the server, which resolves the flag off the
 * athlete row (migration 084) or the literal, whichever says yes. The two local
 * checks stay in front of it as the fast path — they answer instantly for anyone
 * with a real address, so the request only decides the synthetic case.
 *
 * Purely a UI question: view-as changes what is RENDERED, never what the server
 * will do (every API route authorizes the real session), so being wrong here
 * costs a hidden button, not access.
 */
export function useIsSuperUser(): boolean {
  // Answered by an address alone, with no network at all.
  const [emailSuper, setEmailSuper] = useState(false);
  // Set only once the session has resolved AND neither address matched — i.e.
  // the synthetic-Strava case, the one time the server has to be asked.
  const [askServer, setAskServer] = useState(false);

  useEffect(() => {
    const stored =
      localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
    if (isSuperUser(stored)) { setEmailSuper(true); return; }

    let cancelled = false;
    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (isSuperUser(data.session?.user?.email)) setEmailSuper(true);
        else setAskServer(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // useApi, NOT a hand-written fetch. This hook has three callers (Header,
  // ImpersonationBar and useNavItems) and each one mounts its own copy, so a
  // bare fetch here was three uncached round trips on EVERY page — measured at
  // seven /api/auth/me requests on a single load. SWR keys on the URL alone, so
  // all three now share one in-flight request, and they share it with the
  // `useApi('/api/auth/me')` that Header and useNavItems already make: the extra
  // cost of the synthetic case drops to zero requests rather than three.
  //
  // Worth being precise about who was paying: the fast path above returns early
  // for anyone with a real address, so club members never made these calls at
  // all. It was specifically the Strava-only accounts — Ofer's own included,
  // whose session email is …@strava.madregot.local and cannot match the literal
  // — that fell through to the network on every single screen.
  const { data } = useApi<{ isSuper?: boolean }>(
    askServer && !emailSuper ? '/api/auth/me' : null,
  );

  // Only ever ORed to true, never assigned from the response: a failed request
  // or a signed-out moment must not yank a control the fast path already showed.
  return emailSuper || !!data?.isSuper;
}

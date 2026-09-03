'use client';

import { useState, useEffect } from 'react';
import {
  Activity, Calendar, Users, Layers, Clock, ClipboardList, User, Settings,
  Route, MessageSquare, Dumbbell, GraduationCap, UserCheck, ClipboardCheck,
  BarChart3, Newspaper, CalendarDays, Wrench, ShoppingBag, Gift,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { useApi } from '@/lib/api';
import { isSuperUser } from '@/lib/constants';
import { getViewMode, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';

// Shared "which pages can this signed-in user reach" resolution. FOUR places
// need the same answer: the desktop Header nav, the mobile BottomTabBar, the
// global Search page (which offers reachable "sections" as a result category),
// and this hook.
//
// It was extracted here so they couldn't drift — and then two of them kept
// their own copy of the list and the rules anyway, which is precisely how the
// desktop nav ended up without the academy force-add that mobile has: an
// athlete whose role is plain `runner` but who IS in the academy got the tab on
// their phone and not on their laptop. So the decision now lives in ONE pure
// function, `resolveNavItems`, which every caller passes its inputs to.
//
// Pure on purpose: it's the only part of nav that can be unit-tested (this repo
// has no jsdom, so the hook itself can't be), and it's the part where a wrong
// answer is invisible until someone opens the app as an unusual role.

export interface NavItem { href: string; tab: string; labelKey: string; icon: React.ComponentType<{ className?: string }>; }

// Named because it's force-added for academy members below as well as being a
// permission-gated staff tab — one definition so the two can't drift.
export const ACADEMY_ITEM: NavItem = { href: '/dashboard/academy', tab: 'academy', labelKey: 'academy', icon: GraduationCap };

export const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', tab: 'dashboard', labelKey: 'dashboard', icon: Activity },
  { href: '/feed', tab: 'feed', labelKey: 'feed', icon: Newspaper },
  { href: '/dashboard/review', tab: 'review', labelKey: 'review', icon: MessageSquare },
  { href: '/dashboard/plan/new', tab: 'plan/new', labelKey: 'planner', icon: Calendar },
  { href: '/dashboard/athletes', tab: 'athletes', labelKey: 'athletes', icon: Users },
  ACADEMY_ITEM,
  { href: '/dashboard/groups', tab: 'groups', labelKey: 'groups', icon: Layers },
  { href: '/dashboard/activities', tab: 'activities', labelKey: 'activities', icon: Route },
  { href: '/dashboard/program', tab: 'program', labelKey: 'program', icon: ClipboardList },
  { href: '/dashboard/practice', tab: 'practice', labelKey: 'practice', icon: Dumbbell },
  { href: '/dashboard/practice-attendance', tab: 'practice-attendance', labelKey: 'practiceAttendance', icon: UserCheck },
  { href: '/dashboard/workout-feedback', tab: 'workout-feedback', labelKey: 'workoutFeedback', icon: ClipboardCheck },
  { href: '/dashboard/team-volume', tab: 'team-volume', labelKey: 'teamVolume', icon: BarChart3 },
  { href: '/dashboard/calendar', tab: 'calendar', labelKey: 'calendar', icon: CalendarDays },
  { href: '/dashboard/history', tab: 'history', labelKey: 'history', icon: Clock },
  { href: '/dashboard/settings', tab: 'settings', labelKey: 'settings', icon: Settings },
];
export const PROFILE_ITEM: NavItem = { href: '/dashboard/profile', tab: 'profile', labelKey: 'profile', icon: User };
export const COACH_TOOLS_ITEM: NavItem = { href: '/dashboard/coach-tools', tab: 'coach-tools', labelKey: 'coachTools', icon: Wrench };
// Store and Benefits are static "More" sheet rows, not gated by
// role_tab_permissions (roadmap #9, #5) — every role can reach them.
export const STORE_ITEM: NavItem = { href: '/dashboard/store', tab: 'store', labelKey: 'store', icon: ShoppingBag };
export const BENEFITS_ITEM: NavItem = { href: '/dashboard/benefits', tab: 'benefits', labelKey: 'benefits', icon: Gift };

export interface TabPermission { role: string; tab: string; enabled: boolean; }

export interface NavResolutionInput {
  /** Every row from /api/admin/tab-permissions; filtered by role in here. */
  permissions: TabPermission[];
  /** The view-as role if one is active, else the account's own (admin for a super-user). */
  effectiveRole: string | null;
  /** Set only while previewing another role — it suppresses the profile force-add for staff previews. */
  previewRole?: string | null;
  /** Whether this account has an athlete row (`athlete_id` in localStorage). */
  isAthlete?: boolean;
  /** The `is_academy` flag from /api/auth/me. */
  isAcademyMember?: boolean;
  /**
   * When true, a role that resolves to nothing gets [dashboard, profile] rather
   * than an empty list. The two nav CHROMES want that (an empty bar or header
   * would strand the user with no way out); Search does not — it just has no
   * sections to offer.
   */
  fallback?: boolean;
}

/**
 * Which pages this user can reach, in nav order. The single source of truth for
 * the Header, the BottomTabBar, this module's hook and Search.
 */
export function resolveNavItems({
  permissions,
  effectiveRole,
  previewRole = null,
  isAthlete = false,
  isAcademyMember = false,
  fallback = false,
}: NavResolutionInput): NavItem[] {
  if (!effectiveRole) return [];
  const enabled = permissions.filter(p => p.role === effectiveRole && p.enabled).map(p => p.tab);
  // Admin can always reach settings — otherwise revoking that one row locks the
  // only account that can grant it back out of the permissions editor.
  if (effectiveRole === 'admin' && !enabled.includes('settings')) enabled.push('settings');
  const items = ALL_NAV_ITEMS.filter(i => enabled.includes(i.tab));

  // Athlete-flavoured roles get their own profile. Skipped for staff previews,
  // where the point is to see the staff nav.
  if (isAthlete || (previewRole && !STAFF_ROLES.includes(previewRole))) {
    if (!items.some(i => i.tab === 'profile')) items.push(PROFILE_ITEM);
  }
  // Coach Tools hub — every staff account, same force-add pattern as `settings`
  // (deliberately not gated by the DB permissions table).
  if (STAFF_ROLES.includes(effectiveRole) && !items.some(i => i.tab === 'coach-tools')) {
    items.push(COACH_TOOLS_ITEM);
  }
  // Academy members reach the academy regardless of role_tab_permissions.
  // Membership is the `is_academy` flag, not a role — an athlete whose role is
  // plain `runner` can be in the academy — so no permission row can express it.
  // Migration 022 denies `academy_user` this tab on purpose, because the only
  // thing behind it was the coach's admin console; /dashboard/academy now serves
  // an athlete their own view, so the row is theirs to have.
  if (isAcademyMember && !items.some(i => i.tab === 'academy')) items.push(ACADEMY_ITEM);

  if (!items.length && fallback) return [ALL_NAV_ITEMS[0], PROFILE_ITEM];
  return items;
}

/**
 * The signed-in user's identity as the nav needs it: which role to render as,
 * whether they're staff, and the two localStorage-derived flags. Shared by the
 * Header and the BottomTabBar, which both used to resolve this independently.
 */
export function useNavIdentity() {
  const [isAthlete, setIsAthlete] = useState(false);
  const [isSuper, setIsSuper] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);

  // Both answers go through useApi (SWR) rather than a raw fetch, because the
  // Header, the tab bar and Search all need the same two and each request pays
  // a full session verification server-side. SWR keys them, so the pair
  // resolves once per page view however many components ask.
  const { data: permsData, isLoading: permsLoading } = useApi<{ permissions?: TabPermission[] }>(
    '/api/admin/tab-permissions',
  );
  const permissions = permsData?.permissions || [];

  const { data: meData } = useApi<{ role?: string; isAcademy?: boolean }>(hasEmail ? '/api/auth/me' : null);

  useEffect(() => {
    const athleteId = localStorage.getItem('athlete_id');
    const email = localStorage.getItem('athlete_email') || localStorage.getItem('coach_email') || '';
    if (athleteId) setIsAthlete(true);

    // The email still decides super-user status locally, but the ROLE comes from
    // the session via /api/auth/me above — it stopped answering for whatever
    // address it was handed.
    const resolveEmail = (e: string) => {
      if (!e) return;
      setIsSuper(isSuperUser(e));
      setHasEmail(true);
    };
    if (email) resolveEmail(email);
    else {
      getSupabase().auth.getSession().then(({ data }) => {
        const e = data.session?.user?.email || '';
        if (e) resolveEmail(e);
      }).catch(() => {});
    }
  }, []);

  const viewMode = typeof window !== 'undefined' ? getViewMode() : null;
  const previewRole = viewMode && viewMode !== MAINTENANCE_MODE ? viewMode : null;
  const baseRole = isSuper ? 'admin' : meData?.role || null;
  const effectiveRole = previewRole || baseRole;

  return {
    permissions,
    effectiveRole,
    previewRole,
    isAthlete,
    isAcademyMember: !!meData?.isAcademy,
    ready: !permsLoading && !!effectiveRole,
    isStaffView: effectiveRole ? STAFF_ROLES.includes(effectiveRole) : false,
  };
}

export function useNavItems() {
  const identity = useNavIdentity();
  const { ready, isStaffView } = identity;
  return { ready, isStaffView, navItems: ready ? resolveNavItems(identity) : [] };
}

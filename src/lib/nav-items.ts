'use client';

import { useState, useEffect } from 'react';
import {
  Activity, Calendar, Users, Layers, Clock, ClipboardList, User, Settings,
  Route, MessageSquare, Dumbbell, GraduationCap, UserCheck, ClipboardCheck,
  BarChart3, Newspaper, CalendarDays, Wrench, ShoppingBag, Gift,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { apiHeaders } from '@/lib/api';
import { getViewMode, useIsSuperUser, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';

// Shared "which pages can this signed-in user reach" resolution — BottomTabBar
// (the tab bar itself) and the global Search page (which suggests reachable
// "sections" as a result category) both need the exact same answer. This used
// to live only in BottomTabBar; extracted here so the two can't drift (e.g. a
// tab visible in the bar but never offered by search, or vice versa).

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

interface TabPermission { role: string; tab: string; enabled: boolean; }

export function useNavItems() {
  const [isAthlete, setIsAthlete] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isAcademyMember, setIsAcademyMember] = useState(false);
  // Same two-signal resolution as the Header and the tab bar — see useIsSuperUser.
  const localSuper = useIsSuperUser();
  const [serverSuper, setServerSuper] = useState(false);
  const isSuper = localSuper || serverSuper;
  const [permissions, setPermissions] = useState<TabPermission[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  useEffect(() => {
    const athleteId = localStorage.getItem('athlete_id');
    const email = localStorage.getItem('athlete_email') || localStorage.getItem('coach_email') || '';
    if (athleteId) setIsAthlete(true);

    fetch('/api/admin/tab-permissions')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data?.permissions) setPermissions(data.permissions); setPermissionsLoaded(true); })
      .catch(() => setPermissionsLoaded(true));

    // The ROLE comes from the session — /api/auth/me stopped answering for
    // whatever address it was handed. apiHeaders() is async, hence the inner IIFE.
    const resolveEmail = (e: string) => {
      if (!e) return;
      (async () => {
        const res = await fetch('/api/auth/me', { headers: await apiHeaders() }).catch(() => null);
        const data = res?.ok ? await res.json().catch(() => null) : null;
        if (data?.role) setUserRole(data.role);
        if (data?.isAcademy) setIsAcademyMember(true);
        if (data?.isSuper) setServerSuper(true);
      })();
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
  const baseRole = isSuper ? 'admin' : userRole;
  const effectiveRole = previewRole || baseRole;
  const ready = permissionsLoaded && !!effectiveRole;
  const isStaffView = effectiveRole ? STAFF_ROLES.includes(effectiveRole) : false;

  const navItems: NavItem[] = (() => {
    if (!ready) return [];
    const enabled = permissions.filter(p => p.role === effectiveRole && p.enabled).map(p => p.tab);
    if (effectiveRole === 'admin' && !enabled.includes('settings')) enabled.push('settings');
    const items = ALL_NAV_ITEMS.filter(i => enabled.includes(i.tab));
    if (isAthlete || (previewRole && !['admin', 'coach', 'academy_coach'].includes(previewRole))) {
      if (!items.some(i => i.tab === 'profile')) items.push(PROFILE_ITEM);
    }
    if (isStaffView && !items.some(i => i.tab === 'coach-tools')) items.push(COACH_TOOLS_ITEM);
    // Academy members reach the academy regardless of role_tab_permissions.
    // Membership is the `is_academy` flag, not a role — an athlete whose role is
    // plain `runner` can be in the academy — so no permission row can express
    // it. Migration 022 denies `academy_user` this tab on purpose, because the
    // only thing behind it was the coach's admin console; /dashboard/academy now
    // serves an athlete their own view, so the row is theirs to have.
    if (isAcademyMember && !items.some(i => i.tab === 'academy')) items.push(ACADEMY_ITEM);
    return items;
  })();

  return { ready, isStaffView, navItems };
}

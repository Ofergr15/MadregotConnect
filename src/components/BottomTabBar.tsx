'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Activity, Calendar, Users, Layers, Clock, ClipboardList, User, Settings,
  Route, MessageSquare, Dumbbell, GraduationCap, UserCheck, ClipboardCheck,
  BarChart3, MoreHorizontal, X, Newspaper, CalendarCheck, CalendarDays, Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';
import { isSuperUser } from '@/lib/constants';
import { getViewMode, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';

// iOS-native redesign, phase 1: a bottom tab bar (the #1 "this is a real app"
// signal) that replaces the hamburger on mobile. Primary tabs live in the bar;
// everything else lives in a "More" sheet. Role/permission logic mirrors the
// Header exactly (same /api/admin/tab-permissions + view-as override) so the two
// never drift. Hidden on md+ (desktop keeps the header nav).

interface NavItem { href: string; tab: string; labelKey: string; icon: any; }

const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', tab: 'dashboard', labelKey: 'dashboard', icon: Activity },
  { href: '/dashboard/feed', tab: 'feed', labelKey: 'feed', icon: Newspaper },
  { href: '/dashboard/review', tab: 'review', labelKey: 'review', icon: MessageSquare },
  { href: '/dashboard/plan/new', tab: 'plan/new', labelKey: 'planner', icon: Calendar },
  { href: '/dashboard/athletes', tab: 'athletes', labelKey: 'athletes', icon: Users },
  { href: '/dashboard/academy', tab: 'academy', labelKey: 'academy', icon: GraduationCap },
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
const PROFILE_ITEM: NavItem = { href: '/dashboard/profile', tab: 'profile', labelKey: 'profile', icon: User };
// Staff-only hub replacing a flat "everything else" overflow — force-added for
// staff exactly like `settings` is force-added for admin (not DB-permission
// gated; every coach/admin/academy_coach account gets it).
const COACH_TOOLS_ITEM: NavItem = { href: '/dashboard/coach-tools', tab: 'coach-tools', labelKey: 'coachTools', icon: Wrench };

// Preferred order of PRIMARY tabs, role-explicit (not one shared list) — an
// athlete's and a coach's four daily-use destinations are genuinely different,
// and sharing one generic priority list was producing an arbitrary 4th tab for
// staff. `practice-attendance` is deliberately absent from the staff order: it's
// the FAB's own target (see primaryActionHref below), so it must never also be
// eligible as a flat primary tab — the same destination reachable twice.
const ATHLETE_PRIMARY_ORDER = ['dashboard', 'program', 'feed', 'profile'];
const STAFF_PRIMARY_ORDER = ['dashboard', 'athletes', 'workout-feedback', 'coach-tools'];

interface TabPermission { role: string; tab: string; enabled: boolean; }

export function BottomTabBar() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [isAthlete, setIsAthlete] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isSuper, setIsSuper] = useState(false);
  const [permissions, setPermissions] = useState<TabPermission[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const athleteId = localStorage.getItem('athlete_id');
    let email = localStorage.getItem('athlete_email') || localStorage.getItem('coach_email') || '';
    if (athleteId) setIsAthlete(true);

    fetch('/api/admin/tab-permissions')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data?.permissions) setPermissions(data.permissions); setPermissionsLoaded(true); })
      .catch(() => setPermissionsLoaded(true));

    const resolveEmail = (e: string) => {
      if (!e) return;
      setIsSuper(isSuperUser(e));
      fetch('/api/auth/me', { headers: { 'x-user-email': e } })
        .then(res => (res.ok ? res.json() : null))
        .then(data => { if (data?.role) setUserRole(data.role); })
        .catch(() => {});
    };
    if (email) resolveEmail(email);
    else {
      getSupabase().auth.getSession().then(({ data }) => {
        const e = data.session?.user?.email || '';
        if (e) resolveEmail(e);
      }).catch(() => {});
    }
  }, []);

  // Same effective-role resolution as the Header.
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
    // Coach Tools hub — every staff account gets it, same force-add pattern as
    // `settings` above (not gated by the DB tab-permissions table).
    if (isStaffView && !items.some(i => i.tab === 'coach-tools')) items.push(COACH_TOOLS_ITEM);
    return items.length ? items : [ALL_NAV_ITEMS[0], PROFILE_ITEM];
  })();

  if (!ready || navItems.length === 0) return null;

  // Split into up-to-4 primary tabs + overflow, using the role-appropriate
  // preferred order. "More" is added as a 5th slot whenever there are leftovers.
  const primaryOrder = isStaffView ? STAFF_PRIMARY_ORDER : ATHLETE_PRIMARY_ORDER;
  const byTab = new Map(navItems.map(i => [i.tab, i]));
  const primary: NavItem[] = [];
  for (const tab of primaryOrder) {
    if (primary.length >= 4) break;
    const item = byTab.get(tab);
    if (item) { primary.push(item); byTab.delete(tab); }
  }
  // Fill remaining primary slots from whatever's left, in nav order — but never
  // with the staff FAB's own target (a role missing some of its preferred tabs
  // must not fall back onto the one destination the FAB already covers).
  for (const item of navItems) {
    if (primary.length >= 4) break;
    if (isStaffView && item.tab === 'practice-attendance') continue;
    if (byTab.has(item.tab)) { primary.push(item); byTab.delete(item.tab); }
  }
  const overflow = navItems.filter(i => byTab.has(i.tab));
  const isActive = (href: string) => pathname === href;
  const overflowActive = overflow.some(i => isActive(i.href));

  // Elevated center FAB (Talos-style): one role-aware "do something now" primary
  // action, additive to the 4 primary tabs + More. Athletes → confirm attendance
  // for their next workout (the AttendanceRSVP card lives at the top of
  // /dashboard). Staff (coach/admin/academy_coach) → the attendance roster —
  // deliberately excluded from STAFF_PRIMARY_ORDER above so it's reachable via
  // the FAB only, never as a redundant second flat tab to the same page.
  const primaryActionHref = isStaffView ? '/dashboard/practice-attendance' : '/dashboard';
  const primaryActionAriaKey = isStaffView ? 'attendanceRosterAria' : 'confirmAttendanceAria';
  const primaryActionActive = isActive(primaryActionHref);
  // Split the primary tabs around the middle so the FAB lands visually centered
  // in the bar regardless of how many tabs (1-4) this role has.
  const midIndex = Math.ceil(primary.length / 2);

  const renderPrimaryTab = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <Link
        key={item.tab}
        href={item.href}
        onClick={() => { try { navigator.vibrate?.(8); } catch { /* no-op */ } }}
        className={cn(
          'flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors active:scale-[0.92]',
          active ? 'text-primary-400' : 'text-slate-500'
        )}
      >
        <Icon className="h-6 w-6" strokeWidth={active ? 2.4 : 2} />
        <span className={cn('text-[10px] leading-none', active ? 'font-bold' : 'font-medium')}>
          {t(item.labelKey as any)}
        </span>
      </Link>
    );
  };

  return (
    <>
      {/* Bottom tab bar — mobile only. Frosted, safe-area padded. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-slate-700/60 bg-slate-900/85 backdrop-blur-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {primary.slice(0, midIndex).map(renderPrimaryTab)}

        {/* Elevated primary-action FAB — pops above the bar line (Talos
            reference), distinct from the flat tab buttons around it. */}
        <Link
          href={primaryActionHref}
          onClick={() => { try { navigator.vibrate?.(10); } catch { /* no-op */ } }}
          aria-label={t(primaryActionAriaKey as any)}
          className="flex-1 flex flex-col items-center justify-end pb-1.5"
        >
          <span
            className={cn(
              '-mt-6 flex items-center justify-center w-14 h-14 rounded-full shadow-lg shadow-black/40 transition-transform active:scale-[0.92]',
              primaryActionActive ? 'bg-primary-500' : 'bg-primary-600'
            )}
          >
            <CalendarCheck className="h-6 w-6 text-white" strokeWidth={2.4} />
          </span>
        </Link>

        {primary.slice(midIndex).map(renderPrimaryTab)}
        {overflow.length > 0 && (
          <button
            onClick={() => { try { navigator.vibrate?.(8); } catch { /* no-op */ } setMoreOpen(true); }}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors active:scale-[0.92]',
              overflowActive ? 'text-primary-400' : 'text-slate-500'
            )}
          >
            <MoreHorizontal className="h-6 w-6" />
            <span className="text-[10px] leading-none font-medium">{t('more' as any)}</span>
          </button>
        )}
      </nav>

      {/* "More" sheet — native-style bottom sheet listing the overflow tabs. */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[60] flex items-end" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative w-full bg-slate-800 rounded-t-2xl border-t border-slate-700 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 max-h-[70vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-9 h-1.5 rounded-full bg-slate-600 mx-auto mb-3" />
            <div className="flex items-center justify-between px-5 pb-2">
              <span className="text-base font-bold text-white">{t('more' as any)}</span>
              <button onClick={() => setMoreOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-3 pb-2">
              {overflow.map(item => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.tab}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex items-center gap-3.5 px-3 py-3 rounded-xl transition-colors',
                      active ? 'bg-primary-600/20 text-primary-300' : 'text-slate-200 hover:bg-slate-700/50'
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="text-[15px] font-medium">{t(item.labelKey as any)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

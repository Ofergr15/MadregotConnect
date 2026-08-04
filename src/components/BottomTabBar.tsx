'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Activity, Calendar, Users, Layers, Clock, ClipboardList, User, Settings,
  Route, Trophy, MessageSquare, Dumbbell, GraduationCap, UserCheck, ClipboardCheck,
  MoreHorizontal, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';
import { isSuperUser } from '@/lib/constants';
import { getViewMode, MAINTENANCE_MODE } from '@/lib/impersonation';

// iOS-native redesign, phase 1: a bottom tab bar (the #1 "this is a real app"
// signal) that replaces the hamburger on mobile. Primary tabs live in the bar;
// everything else lives in a "More" sheet. Role/permission logic mirrors the
// Header exactly (same /api/admin/tab-permissions + view-as override) so the two
// never drift. Hidden on md+ (desktop keeps the header nav).

interface NavItem { href: string; tab: string; labelKey: string; icon: any; }

const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', tab: 'dashboard', labelKey: 'dashboard', icon: Activity },
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
  { href: '/dashboard/races', tab: 'races', labelKey: 'races', icon: Trophy },
  { href: '/dashboard/history', tab: 'history', labelKey: 'history', icon: Clock },
  { href: '/dashboard/settings', tab: 'settings', labelKey: 'settings', icon: Settings },
];
const PROFILE_ITEM: NavItem = { href: '/dashboard/profile', tab: 'profile', labelKey: 'profile', icon: User };

// Preferred order of PRIMARY tabs shown in the bar (first 4 that the role has).
// The rest overflow into "More". Dashboard is always first.
const PRIMARY_ORDER = ['dashboard', 'program', 'practice-attendance', 'workout-feedback', 'activities', 'athletes', 'review'];

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

  const navItems: NavItem[] = (() => {
    if (!ready) return [];
    const enabled = permissions.filter(p => p.role === effectiveRole && p.enabled).map(p => p.tab);
    if (effectiveRole === 'admin' && !enabled.includes('settings')) enabled.push('settings');
    const items = ALL_NAV_ITEMS.filter(i => enabled.includes(i.tab));
    if (isAthlete || (previewRole && !['admin', 'coach', 'academy_coach'].includes(previewRole))) {
      if (!items.some(i => i.tab === 'profile')) items.push(PROFILE_ITEM);
    }
    return items.length ? items : [ALL_NAV_ITEMS[0], PROFILE_ITEM];
  })();

  if (!ready || navItems.length === 0) return null;

  // Split into up-to-4 primary tabs + overflow. "More" is added as a 5th slot
  // whenever there are leftovers.
  const byTab = new Map(navItems.map(i => [i.tab, i]));
  const primary: NavItem[] = [];
  for (const tab of PRIMARY_ORDER) {
    if (primary.length >= 4) break;
    const item = byTab.get(tab);
    if (item) { primary.push(item); byTab.delete(tab); }
  }
  // Fill remaining primary slots from whatever's left, in nav order.
  for (const item of navItems) {
    if (primary.length >= 4) break;
    if (byTab.has(item.tab)) { primary.push(item); byTab.delete(item.tab); }
  }
  const overflow = navItems.filter(i => byTab.has(i.tab));
  const isActive = (href: string) => pathname === href;
  const overflowActive = overflow.some(i => isActive(i.href));

  return (
    <>
      {/* Bottom tab bar — mobile only. Frosted, safe-area padded. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-slate-700/60 bg-slate-900/85 backdrop-blur-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {primary.map(item => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.tab}
              href={item.href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors',
                active ? 'text-primary-400' : 'text-slate-500'
              )}
            >
              <Icon className="h-6 w-6" strokeWidth={active ? 2.4 : 2} />
              <span className={cn('text-[10px] leading-none', active ? 'font-bold' : 'font-medium')}>
                {t(item.labelKey as any)}
              </span>
            </Link>
          );
        })}
        {overflow.length > 0 && (
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors',
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
            dir="rtl"
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

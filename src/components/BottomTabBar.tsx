'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Activity, Calendar, Users, Layers, Clock, ClipboardList, User, Settings,
  Route, MessageSquare, Dumbbell, GraduationCap, UserCheck, ClipboardCheck,
  BarChart3, Menu, Newspaper, CalendarCheck, CalendarDays, Wrench, Search, ShoppingBag, Gift,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';
import { apiHeaders } from '@/lib/api';
import { isSuperUser } from '@/lib/constants';
import { getViewMode, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';
import { Sheet } from '@/components/ui';

// iOS-native redesign, phase 1: a bottom tab bar (the #1 "this is a real app"
// signal) that replaces the hamburger on mobile. Primary tabs live in the bar;
// everything else lives in a "More" sheet. Role/permission logic mirrors the
// Header exactly (same /api/admin/tab-permissions + view-as override) so the two
// never drift. Hidden on md+ (desktop keeps the header nav).
//
// Visual style (v2, per reference: My Disney Experience app): icon-only, no
// text labels, no elevated/colored FAB — every slot (including the primary
// action and the overflow trigger) is the exact same flat, evenly-spaced,
// thin-stroke icon button. Labels move to `aria-label` only (screen readers
// still get them; sighted users rely on icon + position, same as the
// reference). Active state is a plain color change — no weight/scale jump.

interface NavItem { href: string; tab: string; labelKey: string; icon: any; }

// Named because it's force-added for academy members below as well as being a
// permission-gated staff tab.
const ACADEMY_ITEM: NavItem = { href: '/dashboard/academy', tab: 'academy', labelKey: 'academy', icon: GraduationCap };

const ALL_NAV_ITEMS: NavItem[] = [
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
// Feed leads both lists — it's the app's landing page now. Only the first 4
// entries fit as flat tabs, so the staff list's 5th (coach-tools) rides in
// "More" whenever the first four are all enabled.
const ATHLETE_PRIMARY_ORDER = ['feed', 'dashboard', 'program', 'profile'];
const STAFF_PRIMARY_ORDER = ['feed', 'dashboard', 'athletes', 'workout-feedback', 'coach-tools'];

interface TabPermission { role: string; tab: string; enabled: boolean; }

export function BottomTabBar() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [isAthlete, setIsAthlete] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isAcademyMember, setIsAcademyMember] = useState(false);
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

    // The email still decides super-user status locally, but the ROLE now comes
    // from the session — /api/auth/me stopped answering for whatever address it
    // was handed. apiHeaders() is async, hence the inner IIFE.
    const resolveEmail = (e: string) => {
      if (!e) return;
      setIsSuper(isSuperUser(e));
      (async () => {
        const res = await fetch('/api/auth/me', { headers: await apiHeaders() }).catch(() => null);
        const data = res?.ok ? await res.json().catch(() => null) : null;
        if (data?.role) setUserRole(data.role);
        if (data?.isAcademy) setIsAcademyMember(true);
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
    // Academy members get the academy row whatever their role — membership is
    // the `is_academy` flag, which no role_tab_permissions row can express. See
    // the same force-add in useNavItems for the full reasoning.
    if (isAcademyMember && !items.some(i => i.tab === 'academy')) items.push(ACADEMY_ITEM);
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
  // The static quick-action pages are reachable from the "More" sheet only, so
  // they light its slot up exactly like an overflow page does.
  const MORE_SHEET_HREFS = ['/dashboard/search', '/dashboard/store', '/dashboard/benefits'];
  const moreActive = MORE_SHEET_HREFS.some(isActive);

  // STAFF ONLY: one "do something now" destination, additive to the 4 primary
  // tabs + More — the attendance roster, deliberately excluded from
  // STAFF_PRIMARY_ORDER above so it's reachable via this slot only, never as a
  // redundant second flat tab to the same page. Rendered as a plain icon button
  // (no elevation/color), same as every other slot in the bar.
  //
  // Athletes used to get a mirror of this slot ("אישור") pointing at /dashboard,
  // which is where the Dashboard tab already goes — a fifth slot to a page the
  // bar could already open. Confirming attendance now belongs to the Program tab
  // instead: AttendanceConfirmCard sits at the top of /dashboard/program. The
  // athlete bar is back to its four real destinations (feed · dashboard ·
  // program · profile), which is also exactly what the first-run tour promises.
  const midIndex = isStaffView
    // Split the staff tabs around the middle so the roster slot lands visually
    // centered in the bar regardless of how many tabs (1-4) that role has.
    ? Math.ceil(primary.length / 2)
    // No middle slot for athletes: everything renders in the first half.
    : primary.length;

  const activeColor = 'text-brand-600 font-bold';
  const idleColor = 'text-ink-400';

  const renderIconButton = ({ href, ariaLabel, label, icon: Icon }: { href: string; ariaLabel: string; label: string; icon: any }) => {
    const isActiveState = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={() => { try { navigator.vibrate?.(8); } catch { /* no-op */ } }}
        aria-label={ariaLabel}
        className={cn(
          'flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors active:scale-[0.92]',
          isActiveState ? activeColor : idleColor,
        )}
      >
        <Icon className="h-6 w-6" strokeWidth={1.75} />
        <span className="text-[10px] leading-none font-medium truncate max-w-full px-0.5">{label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Bottom tab bar — mobile only. Flat, evenly spaced, thin-stroke icons
          (My Disney Experience reference) with a small label under each
          (banking-app reference) so it's still clear what each icon is — no
          elevated FAB, no bold/weight jump on the active tab. */}
      <nav
        // Anchor for the first-run tour's "these are your tabs" step (see
        // FirstRunTour). md:hidden, so the step self-skips on desktop.
        data-tour="tabbar"
        // transform-gpu forces its own GPU compositing layer — iOS Safari has a
        // long-standing bug where a `fixed` element that also has
        // `backdrop-filter` (backdrop-blur-xl) can visually drift with scroll
        // momentum instead of staying pinned to the viewport, especially in
        // standalone PWA mode. This is the standard workaround.
        // The frames' bar: near-white and translucent over the page grey, with a
        // page-grey hairline instead of a shadow.
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-page bg-card/95 backdrop-blur-xl transform-gpu"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {primary.slice(0, midIndex).map((item) => renderIconButton({ href: item.href, ariaLabel: t(item.labelKey as any), label: t(item.labelKey as any), icon: item.icon }))}

        {/* The roster IS its own page, so plain location-based active state is
            meaningful here — no disambiguation needed now that no slot shares an
            href with a tab. */}
        {isStaffView && renderIconButton({ href: '/dashboard/practice-attendance', ariaLabel: t('attendanceRosterAria' as any), label: t('practiceAttendance' as any), icon: CalendarCheck })}

        {primary.slice(midIndex).map((item) => renderIconButton({ href: item.href, ariaLabel: t(item.labelKey as any), label: t(item.labelKey as any), icon: item.icon }))}

        {/* "עוד" is unconditional: the sheet always has the static quick-actions
            group (search/store/benefits), so it's never empty — and it used to
            vanish entirely for a role whose every enabled tab fit in the bar
            (e.g. `viewer`: activities/dashboard/program), taking the only mobile
            route to those three pages with it. */}
        <button
          onClick={() => { try { navigator.vibrate?.(8); } catch { /* no-op */ } setMoreOpen(true); }}
          aria-label={t('more' as any)}
          className={cn(
            'flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors active:scale-[0.92]',
            overflowActive || moreActive ? activeColor : idleColor,
          )}
        >
          <Menu className="h-6 w-6" strokeWidth={1.75} />
          <span className="text-[10px] leading-none font-medium">{t('more' as any)}</span>
        </button>
      </nav>

      {/* "More" sheet — grouped grid of quick-action cards (references: My
          Disney Experience's home-screen card grid, and a banking app's
          "פעולות נפוצות"/"אולי יעניין אותך" grouped circular actions) instead
          of a flat list — replacing the previous InsetSection/InsetRow rows. */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title={t('more' as any)} className="md:hidden">
        <div className="space-y-5">
          {/* Static group — every role, not gated by role_mobile_tab_permissions
              (roadmap #17, In-App Global Search; roadmap #9, Store; roadmap
              #5, Benefits/Discounts; Photos — was previously unreachable from
              mobile nav entirely, same "every role, always visible" fix). */}
          <div>
            <p className={cn('px-1 mb-2 text-2xs font-bold uppercase tracking-wider', 'text-ink-400')}>{t('quickActions' as any)}</p>
            <div className="grid grid-cols-3 gap-3">
              <MoreCard icon={Search} label={t('search' as any)} href="/dashboard/search" active={isActive('/dashboard/search')} onClick={() => setMoreOpen(false)} />
              <MoreCard icon={ShoppingBag} label={t('store' as any)} href="/dashboard/store" active={isActive('/dashboard/store')} onClick={() => setMoreOpen(false)} />
              <MoreCard icon={Gift} label={t('benefits' as any)} href="/dashboard/benefits" active={isActive('/dashboard/benefits')} onClick={() => setMoreOpen(false)} />
              {/* Photos is still being built — card and route disabled for now.
                  Restore with the Header nav entry and the page (re-add the
                  lucide Camera import too). */}
              {/* <MoreCard icon={Camera} label={t('photos' as any)} href="/dashboard/photos" active={isActive('/dashboard/photos')} onClick={() => setMoreOpen(false)} /> */}
            </div>
          </div>

          {overflow.length > 0 && (
            <div>
              <p className={cn('px-1 mb-2 text-2xs font-bold uppercase tracking-wider', 'text-ink-400')}>{t('morePages' as any)}</p>
              <div className="grid grid-cols-3 gap-3">
                {overflow.map(item => (
                  <MoreCard
                    key={item.tab}
                    icon={item.icon}
                    label={t(item.labelKey as any)}
                    href={item.href}
                    active={isActive(item.href)}
                    onClick={() => setMoreOpen(false)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}

// One quick-action card in the "More" sheet's grid — a colored icon circle
// (fills in on active, matching the bar's own active-color convention) with
// its label wrapping below, centered. 3 per row fits our longer labels
// ("Workout Feedback", "Team Volume") more comfortably than the reference
// apps' 2-line circular buttons while still reading as "a grid of actions".
function MoreCard({ icon: Icon, label, href, active, onClick }: { icon: any; label: string; href: string; active: boolean; onClick: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-card bg-page p-3 text-center active:scale-[0.96] transition-transform"
    >
      <span className={cn(
        'w-11 h-11 rounded-full flex items-center justify-center shrink-0',
        active ? 'bg-brand-600' : 'bg-card',
      )}>
        <Icon className={cn('h-5 w-5', active ? 'text-white' : 'text-brand-600')} />
      </span>
      <span className="text-2xs font-semibold leading-tight text-ink-700" dir="auto">{label}</span>
    </Link>
  );
}

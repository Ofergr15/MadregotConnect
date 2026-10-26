'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Menu, Camera, Search, ShoppingBag, Gift, LogOut, Bug, Users, UserSearch, Compass, GraduationCap } from 'lucide-react';
import { useIsSuperUser } from '@/lib/impersonation';
import { startLiveTour } from '@/components/onboarding/LiveTour';
import { TOUR_REPLAY_EVENT } from '@/lib/tour/store';
import { useTourPrefs } from '@/lib/tour/use-prefs';
import { openViewAsChooser } from '@/lib/view-as-person';
import { cn } from '@/lib/utils';
import { athletePrimaryOrder, resolveNavItems, useNavIdentity, type NavItem, STORE_TAB_OPEN, ADMIN_HOME_ORDER, NUMBERS_TAB_ITEM, isAdminHome, COACH_SPACE_ITEMS } from '@/lib/nav-items';
import { useCoachSpace } from '@/lib/coach-space/use-coach-space';
import { startViewAs, stopViewAs, MAINTENANCE_MODE, VIEW_AS_SCENARIOS } from '@/lib/impersonation';
import { Sheet } from '@/components/ui';
import { useApi } from '@/lib/api';
import { getNewTabs, setNewTabs } from '@/lib/role-views';

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

// The list itself, the role rules and the force-adds all live in
// @/lib/nav-items now — this file used to keep its own copy of every one of
// them, which is how the desktop nav and this bar drifted apart. Only the
// bar-specific part (which of those items are PRIMARY) is still here.

// Preferred order of PRIMARY tabs, role-explicit (not one shared list).
// Feed leads both lists — it's the app's landing page now.
//
// Staff (Ofer, 2026-10-17): the coaches run too, so their bar is a runner's three
// daily screens plus ONE door for the job — "ניהול" (coach-tools). Attendance,
// feedback and the athlete list were flat tabs here and are not daily enough to
// hold one of five slots; they live at the top of the Management page now, and
// the Management tab carries a dot when something there is waiting for a coach.
const ATHLETE_PRIMARY_ORDER = ['feed', 'dashboard', 'program', 'profile'];
const STAFF_PRIMARY_ORDER = ['feed', 'dashboard', 'program', 'coach-tools'];
/** Never promoted into a staff tab by the fill below — each has its home in Management. */
const STAFF_NEVER_PRIMARY = new Set(['practice-attendance', 'workout-feedback', 'athletes'])
// The operator account (#71): home is the control room, then People, Content and
// the tools.
const OPERATOR_PRIMARY_ORDER = ['dashboard', 'people', 'content', 'coach-tools'];

export function BottomTabBar() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [moreOpen, setMoreOpen] = useState(false);
  const superUser = useIsSuperUser();
  // Tabs a new role just added (RoleWelcome), marked "חדש" until each is opened once.
  const [newTabs, setNewTabsState] = useState<string[]>([]);
  useEffect(() => {
    const read = () => setNewTabsState(getNewTabs());
    read();
    window.addEventListener('new-tabs-changed', read);
    return () => window.removeEventListener('new-tabs-changed', read);
  }, []);
  const seeTabs = (tabs: string[]) => {
    const left = newTabs.filter(x => !tabs.includes(x));
    if (left.length === newTabs.length) return;
    setNewTabs(left);
    setNewTabsState(left);
  };

  // Identity and permissions come from the shared hook, so the Header, this bar
  // and Search all read one SWR-keyed pair of requests rather than each asking
  // independently (each ask pays a full session verification server-side).
  const identity = useNavIdentity();
  const { ready, isStaffView, isSuper, viewMode } = identity;
  const coachTour = useTourPrefs(ready && (isStaffView || superUser));
  // `fallback` so a role that resolves to nothing still gets a usable bar rather
  // than none at all.
  const navItems = ready ? resolveNavItems({ ...identity, fallback: true }) : [];
  // The dot on "ניהול": pain reports and unanswered requests waiting for a coach.
  // Called before the early return below (rules of hooks); a null key fetches nothing.
  const { data: attention } = useApi<{ total: number; people?: number }>(ready && isStaffView ? '/api/staff/attention' : null);
  // How many runners wait for an answer (lib/feedback/waiting.ts) — a number, not just a dot (2026-10-19).
  const attentionCount = attention ? (attention.people ?? attention.total) : 0;
  const attentionDot = attentionCount > 0;
  // The coach space (lib/coach-space): a coach's bar is its four tabs + עוד while the switch is on.
  const coachSpace = useCoachSpace(identity);

  if (!ready || navItems.length === 0) return null;

  // Split into up-to-4 primary tabs + overflow, using the role-appropriate
  // preferred order. "More" is added as a 5th slot whenever there are leftovers.
  // An academy member's bar trades Program for Academy — see athletePrimaryOrder.
  // The admin home's bar: five flat tabs, no "עוד" (lib/nav-items ADMIN_HOME_ORDER).
  const adminHome = isAdminHome(identity);
  const coachBar = !adminHome && !identity.isOperator && coachSpace.bar;
  const primaryOrder = coachBar
    ? COACH_SPACE_ITEMS.map(i => i.tab)
    : adminHome
    ? ADMIN_HOME_ORDER
    : identity.isOperator
    ? OPERATOR_PRIMARY_ORDER
    : isStaffView ? STAFF_PRIMARY_ORDER
      // A "מנהל מדרגות" gets ניהול as a FIFTH flat tab, after profile — nothing moves into "More".
      : [...athletePrimaryOrder(ATHLETE_PRIMARY_ORDER, identity.isAcademyMember, identity.traineeV2), ...(identity.isClubManager ? ['club-numbers'] : [])];
  const maxPrimary = adminHome ? 6 : !isStaffView && identity.isClubManager ? 5 : 4;
  // The admin home's bar carries the numbers as a flat tab of its own; nothing else grants it.
  const barItems = coachBar
    ? [...COACH_SPACE_ITEMS, ...navItems]
    : adminHome && !navItems.some(i => i.tab === 'numbers') ? [...navItems, NUMBERS_TAB_ITEM] : navItems;
  const byTab = new Map(barItems.map(i => [i.tab, i]));
  const primary: NavItem[] = [];
  for (const tab of primaryOrder) {
    if (primary.length >= maxPrimary) break;
    const item = byTab.get(tab);
    if (item) { primary.push(item); byTab.delete(tab); }
  }
  // Fill remaining primary slots from whatever's left, in nav order — but never
  // with the staff FAB's own target (a role missing some of its preferred tabs
  // must not fall back onto the one destination the FAB already covers).
  for (const item of barItems) {
    if (primary.length >= maxPrimary || coachBar) break;
    if (isStaffView && STAFF_NEVER_PRIMARY.has(item.tab)) continue;
    // Review has two permanent homes of its own now — the button beside the logo
    // in the Header and the static card in the sheet below — so it must never be
    // promoted into a flat tab, which would spend one of four daily-use slots on
    // a screen you visit when something breaks.
    if (item.tab === 'review') continue;
    if (byTab.has(item.tab)) { primary.push(item); byTab.delete(item.tab); }
  }
  // Same reason review is skipped above: it's a static card in the sheet for
  // every role, so leaving it in the permission-gated overflow would print it
  // twice for anyone whose `review` tab is enabled.
  const overflow = barItems.filter(i => byTab.has(i.tab) && i.tab !== 'review');
  const isActive = (href: string) => pathname === href;
  const overflowActive = overflow.some(i => isActive(i.href));
  // The static quick-action pages are reachable from the "More" sheet only, so
  // they light its slot up exactly like an overflow page does.
  const MORE_SHEET_HREFS = ['/dashboard/photos', '/dashboard/search', '/dashboard/store', '/dashboard/benefits', '/dashboard/review', '/dashboard/run-together'];
  const moreActive = MORE_SHEET_HREFS.some(isActive);

  // There used to be a fixed staff slot here for the attendance roster; it moved
  // into the Management page (2026-10-17). Athletes confirm attendance from the top
  // of /dashboard/program (AttendanceConfirmCard), as before.
  // No middle slot any more: the staff attendance button moved into Management.
  const midIndex = primary.length;

  const activeColor = 'text-brand-600 font-bold';
  const idleColor = 'text-ink-400';

  const renderIconButton = ({ href, ariaLabel, label, icon: Icon, tab }: { href: string; ariaLabel: string; label: string; icon: any; tab?: string }) => {
    const isActiveState = isActive(href);
    const isNew = !!tab && newTabs.includes(tab);
    return (
      <Link
        key={href}
        href={href}
        // The first-run tour walks the real tabs (FirstRunTour). The Header's
        // desktop nav carries the same anchors, so the tour finds whichever is shown.
        data-tour={tab ? `tab-${tab}` : undefined}
        onClick={() => { try { navigator.vibrate?.(8); } catch { /* no-op */ } if (tab) seeTabs([tab]); }}
        aria-label={ariaLabel}
        className={cn(
          'relative flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors active:scale-[0.92]',
          isActiveState ? activeColor : idleColor,
          isNew && !isActiveState && 'text-brand-600',
        )}
      >
        {isNew && (
          <span className="absolute top-0.5 left-1/2 -translate-x-1/2 rounded-[6px] bg-brand-600 px-1.5 text-[9px] font-bold leading-[14px] text-white">חדש</span>
        )}
        {!isNew && (tab === 'coach-tools' || tab === 'coach-today') && attentionDot && (
          <span className="absolute top-0.5 left-1/2 ms-2 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-card bg-accent-red px-1 text-[10px] font-extrabold leading-none text-white tabular-nums" aria-label={`${attentionCount} מחכים לתשובה`}>
            {attentionCount > 9 ? '9+' : attentionCount}
          </span>
        )}
        <Icon className="h-6 w-6" strokeWidth={1.75} />
        <span className="text-3xs leading-none font-medium truncate max-w-full px-0.5">{label}</span>
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
        // The whole bar's anchor. The tour now points at the single tabs
        // (data-tour="tab-<tab>" on each item); kept for anything that looks for the bar.
        data-tour="tabbar"
        // ── NOT POSITIONED AT ALL. Fourth attempt, and the first one that isn't
        // a CSS trick on this element.
        //
        // The history: remove `backdrop-filter`, remove `transform-gpu`, then
        // `fixed` → `sticky bottom-0`. Each made the drift rarer and none stopped
        // it, because all three kept asking the browser to align this element
        // with the VISIBLE BOTTOM of a scrolling viewport, and on iOS that edge
        // genuinely moves — the toolbar collapses, the keyboard opens, and during
        // momentum scroll it is wherever the compositor last committed.
        //
        // So the shell stopped scrolling instead. <main> is the scroll container
        // now (see lib/app-scroll.ts) and this bar is its flex sibling: the
        // bottom row of a box that is exactly one viewport tall and cannot move.
        // There is no viewport edge to track and no layer to fall behind.
        //
        // `shrink-0` so a tall screen can never squeeze the bar; the safe-area
        // padding stays here because the bar is what touches the bottom edge.
        //
        // Keep the fill opaque. A translucent bar needs a separate
        // absolutely-positioned child to carry the blur — never this element.
        className="md:hidden shrink-0 z-40 flex items-stretch border-t border-page bg-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {primary.slice(0, midIndex).map((item) => renderIconButton({ href: item.href, ariaLabel: t(item.labelKey as any), label: t(item.labelKey as any), icon: item.icon, tab: item.tab }))}

        {primary.slice(midIndex).map((item) => renderIconButton({ href: item.href, ariaLabel: t(item.labelKey as any), label: t(item.labelKey as any), icon: item.icon, tab: item.tab }))}

        {/* "עוד" is unconditional: the sheet always has the static quick-actions
            group (search/store/benefits), so it's never empty — and it used to
            vanish entirely for a role whose every enabled tab fit in the bar
            (e.g. `viewer`: activities/dashboard/program), taking the only mobile
            route to those three pages with it. */}
        {!adminHome && (
        <button
          onClick={() => { try { navigator.vibrate?.(8); } catch { /* no-op */ } setMoreOpen(true); seeTabs(overflow.map(i => i.tab)); }}
          aria-label={t('more' as any)}
          className={cn(
            'relative flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors active:scale-[0.92]',
            overflowActive || moreActive ? activeColor : idleColor,
          )}
        >
          {overflow.some(i => newTabs.includes(i.tab)) && (
            <span className="absolute top-1.5 left-1/2 ms-2.5 h-2 w-2 rounded-full bg-brand-600" aria-hidden />
          )}
          <Menu className="h-6 w-6" strokeWidth={1.75} />
          <span className="text-3xs leading-none font-medium">{t('more' as any)}</span>
        </button>
        )}
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
              {STORE_TAB_OPEN && <MoreCard icon={ShoppingBag} label={t('store' as any)} href="/dashboard/store" active={isActive('/dashboard/store')} onClick={() => setMoreOpen(false)} />}
              <MoreCard icon={Gift} label={t('benefits' as any)} href="/dashboard/benefits" active={isActive('/dashboard/benefits')} onClick={() => setMoreOpen(false)} />
              {/* Review — static, like the three above, and for a stronger
                  reason: it's the "something is broken" channel, so it cannot be
                  gated by a permission row that might itself be the thing that's
                  wrong. Also lives beside the logo in the Header now; this card
                  keeps the place the club already knows. */}
              <MoreCard icon={Bug} label={t('review' as any)} href="/dashboard/review" active={isActive('/dashboard/review')} onClick={() => setMoreOpen(false)} />
              {/* Run together (398963c7) — static for the same reason Store and
                  Benefits are: it is a member-to-member feature with nothing
                  staff-gated on it, so gating its door on a permission row would
                  mean a club social feature that only exists for whoever the
                  matrix happens to have granted. */}
              <MoreCard icon={Users} label={t('runTogether' as any)} href="/dashboard/run-together" active={isActive('/dashboard/run-together')} onClick={() => setMoreOpen(false)} />
              {/* Photos (2026-10-18): the club's Drive folders — see /dashboard/photos. */}
              <MoreCard icon={Camera} label={t('photos' as any)} href="/dashboard/photos" active={isActive('/dashboard/photos')} onClick={() => setMoreOpen(false)} />
              {/* The live tour, being tried (2026-10-19): the super user starts it here. */}
              {superUser && <MoreCard icon={Compass} label="סיור באפליקציה" active={false} onClick={() => { setMoreOpen(false); setTimeout(startLiveTour, 350); }} />}
              {/* The coach tour (lib/tour), replayed: everyone who coaches, and the super user. */}
              {/* Behind the club switch (lib/tour/switch.ts): coaches see it only when it is on; the
                  super user always, as a preview while it is off. */}
              {((isStaffView && coachTour.on) || superUser) && <MoreCard icon={GraduationCap} label={!coachTour.on ? 'סיור מאמן (כבוי לכולם)' : 'סיור מאמן'} active={false} onClick={() => { setMoreOpen(false); setTimeout(() => window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT, { detail: 'coach' })), 350); }} />}
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

          {/* Super-user "view as", one tap from the tab bar. It has lived behind
              the Header's avatar menu (mobile) and a small eye icon (desktop),
              which on a phone is three taps and easy to lose track of — and
              switching role is the most-used admin action there is. The roles
              themselves are the buttons here, so there's no sheet-on-sheet hop
              through the chooser; ImpersonationBar still owns that chooser for
              the maintenance screen and for the desktop entry point. */}
          {(isSuper || viewMode) && (
            <div>
              <p className={cn('px-1 mb-2 text-2xs font-bold uppercase tracking-wider', 'text-ink-400')}>תצוגה כמשתמש</p>
              <div className="grid grid-cols-3 gap-3">
                {VIEW_AS_SCENARIOS.filter(sc => sc.mode !== MAINTENANCE_MODE).map(sc => (
                  <MoreCard
                    key={sc.mode}
                    icon={sc.icon}
                    label={sc.label}
                    active={viewMode === sc.mode}
                    onClick={() => startViewAs(sc.mode)}
                  />
                ))}
                {/* A person rather than a role: the whole app as they see it. */}
                <MoreCard icon={UserSearch} label="אדם…" active={false} onClick={() => { setMoreOpen(false); openViewAsChooser('person'); }} />
                {viewMode && (
                  <MoreCard icon={LogOut} label="חזרה לתצוגה שלי" active={false} onClick={() => stopViewAs()} />
                )}
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
//
// `href` is optional: the view-as cards below act on the page rather than
// navigating, so they render as a button with the identical look.
function MoreCard({ icon: Icon, label, href, active, onClick }: { icon: any; label: string; href?: string; active: boolean; onClick: () => void }) {
  const className = 'flex flex-col items-center gap-2 rounded-card bg-page p-3 text-center active:scale-[0.96] transition-transform';
  const inner = (
    <>
      <span className={cn(
        'w-11 h-11 rounded-full flex items-center justify-center shrink-0',
        active ? 'bg-brand-600' : 'bg-card',
      )}>
        <Icon className={cn('h-5 w-5', active ? 'text-white' : 'text-brand-600')} />
      </span>
      <span className="text-2xs font-semibold leading-tight text-ink-700" dir="auto">{label}</span>
    </>
  );
  if (!href) return <button type="button" onClick={onClick} className={className}>{inner}</button>;
  return <Link href={href} onClick={onClick} className={className}>{inner}</Link>;
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Menu, CalendarCheck, Search, ShoppingBag, Gift, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveNavItems, useNavIdentity, type NavItem } from '@/lib/nav-items';
import { startViewAs, stopViewAs, MAINTENANCE_MODE, VIEW_AS_SCENARIOS } from '@/lib/impersonation';
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

// The list itself, the role rules and the force-adds all live in
// @/lib/nav-items now — this file used to keep its own copy of every one of
// them, which is how the desktop nav and this bar drifted apart. Only the
// bar-specific part (which of those items are PRIMARY) is still here.

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

export function BottomTabBar() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [moreOpen, setMoreOpen] = useState(false);

  // Identity and permissions come from the shared hook, so the Header, this bar
  // and Search all read one SWR-keyed pair of requests rather than each asking
  // independently (each ask pays a full session verification server-side).
  const identity = useNavIdentity();
  const { ready, isStaffView, isSuper, viewMode } = identity;
  // `fallback` so a role that resolves to nothing still gets a usable bar rather
  // than none at all.
  const navItems = ready ? resolveNavItems({ ...identity, fallback: true }) : [];

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

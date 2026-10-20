'use client';

import { useState, useEffect } from 'react';
import {
  Calendar, Users, Layers, Clock, ClipboardList, User, Settings,
  Route, MessageSquare, Bug, Dumbbell, GraduationCap, UserCheck, ClipboardCheck,
  BarChart3, Newspaper, CalendarDays, Wrench, ShoppingBag, Gift, ShieldCheck, Gauge, Trophy,
  UsersRound, Megaphone, TrendingUp, Camera, Sun,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { useApi } from '@/lib/api';
import { getViewMode, useIsSuperUser, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';
import { activeNavRole } from '@/lib/role-views';
import { useTraineeV2 } from '@/lib/trainee/v2';

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
// The same door for a trainee under the trainee experience v2 (lib/trainee/v2.ts): the
// route's trainee lens is their week and month there ("לוח", mockup screens 2/3), so the
// tab says so. Same href and tab id, so active state and every deep link are unchanged.
export const ACADEMY_BOARD_ITEM: NavItem = { href: '/dashboard/academy', tab: 'academy', labelKey: 'board', icon: CalendarDays };
// "התקדמות" (mockup screens 7/7ג/8): the trainee's fitness, threshold and body, a tab of its
// own next to the board under v2. Force-added like the academy tab, for the same reason —
// membership is a flag, not a role, so no permission row can grant it.
export const PROGRESS_ITEM: NavItem = { href: '/dashboard/academy/progress', tab: 'academy-progress', labelKey: 'progress', icon: TrendingUp };

export const ALL_NAV_ITEMS: NavItem[] = [
  // "היום" (2026-10-19): the runner's day, not a control panel — the sun, not a pulse line.
  { href: '/dashboard', tab: 'dashboard', labelKey: 'dashboard', icon: Sun },
  { href: '/feed', tab: 'feed', labelKey: 'feed', icon: Newspaper },
  // The control room, at a URL of its own since 2026-09-07. It used to be
  // /dashboard's admin branch, which only worked while an admin account was
  // assumed not to be anybody's member account — and in this club every admin
  // runs, so /dashboard is their training home and the control room needed a door.
  //
  // Listed here, so `admin` gets it by rule 1 and no exception. For an admin with
  // NO athlete row that means two doors to one screen (/dashboard still renders it,
  // since nothing else on that screen would have anything to say to them), exactly
  // as ADMIN_ACCOUNT_ITEM and PROFILE_ITEM share /dashboard/profile. Everything on
  // it is staff-gated server-side, so it is also safe to grant a coach from the
  // permissions matrix — ungranted, it is admin-only by construction.
  { href: '/dashboard/control-room', tab: 'control-room', labelKey: 'controlRoom', icon: Gauge },
  // The admin's People list and Content hub (#71 phase 2). Listed, so `admin` gets
  // them by rule 1; no matrix row exists for either, so every other role doesn't.
  // Both read staff-gated routes, so granting one to a coach later is safe.
  { href: '/dashboard/people', tab: 'people', labelKey: 'people', icon: UsersRound },
  { href: '/dashboard/content', tab: 'content', labelKey: 'contentHub', icon: Megaphone },
  // Social (2026-10-18): the quality sessions' photo folders. Admin by rule 1; the
  // route is super-user/admin gated too.
  { href: '/dashboard/social', tab: 'social', labelKey: 'social', icon: Camera },
  // A beetle, not a speech bubble: this is the "something is broken" channel,
  // and a message icon read as one more place to talk to the coach.
  { href: '/dashboard/review', tab: 'review', labelKey: 'review', icon: Bug },
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
  // The club records board. Member-facing, and the data on it is already visible
  // one profile at a time (/api/athletes/[id]/stats is requireMember), so an
  // ungranted role losing the nav entry costs discoverability and not access —
  // which is why the profile's own records section links straight to it as well.
  { href: '/dashboard/records', tab: 'records', labelKey: 'records', icon: Trophy },
  { href: '/dashboard/history', tab: 'history', labelKey: 'history', icon: Clock },
  { href: '/dashboard/settings', tab: 'settings', labelKey: 'settings', icon: Settings },
];
export const PROFILE_ITEM: NavItem = { href: '/dashboard/profile', tab: 'profile', labelKey: 'profile', icon: User };
// The profile tab for an admin account that has NO athlete row — nothing but the
// club to administer, so there is no training profile to show. SAME route and SAME
// tab id as the athlete's (one active-state rule, one place a deep link can land),
// and the page behind it branches the same way: what such an account needs is the
// thing no other screen holds — who am I signed in as, what am I allowed to do,
// which version is this, and how do I get out.
//
// An admin who DOES run gets `PROFILE_ITEM` instead, because that account is a
// member as well as an administrator; see `resolveNavItems`.
export const ADMIN_ACCOUNT_ITEM: NavItem = { href: '/dashboard/profile', tab: 'profile', labelKey: 'account', icon: ShieldCheck };
export const COACH_TOOLS_ITEM: NavItem = { href: '/dashboard/coach-tools', tab: 'coach-tools', labelKey: 'coachTools', icon: Wrench };
/** "ניהול" for a "מנהל מדרגות" who holds no staff role: the club's numbers (lib/club-numbers/access). */
export const CLUB_NUMBERS_ITEM: NavItem = { href: '/dashboard/numbers', tab: 'club-numbers', labelKey: 'coachTools', icon: Gauge };
// Store and Benefits are static "More" sheet rows, not gated by
// role_tab_permissions (roadmap #9, #5) — every role can reach them.
export const STORE_ITEM: NavItem = { href: '/dashboard/store', tab: 'store', labelKey: 'store', icon: ShoppingBag };
/**
 * The store is offered to members (the "More" sheet, search) only while this is on.
 * Off since 2026-10-19 (Ofer: "hide it for now"): no products and no order ever, and
 * an empty store with a cart read as an unfinished app. Staff still manage it from
 * Coach Tools → store manager; the page itself stays at its address.
 */
export const STORE_OPEN = false;
export const BENEFITS_ITEM: NavItem = { href: '/dashboard/benefits', tab: 'benefits', labelKey: 'benefits', icon: Gift };
// Run together (398963c7) — a static row like the two above. Member-to-member,
// nothing on it staff-gated, so a permission row in front of the door would only
// decide which members get to arrange runs with each other.
export const RUN_TOGETHER_ITEM: NavItem = { href: '/dashboard/run-together', tab: 'run-together', labelKey: 'runTogether', icon: Users };

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
   * The `isCoreRunner` flag from /api/auth/me (migration 091).
   *
   * ADDITIVE, exactly like `isAcademyMember` below and for the same reason: the
   * גרעין is a flag, not a role, so no single permission row can describe "a
   * coach who is also a core runner". Whatever `role_tab_permissions` grants the
   * legacy `core_runner` role is UNIONED onto what this account's own role
   * grants. It can never take a tab away.
   *
   * That reuse is the point: the capabilities of the גרעין stay editable in the
   * Settings → permissions matrix that already has a `core_runner` column, so
   * granting the squad a new page is one toggle and no code.
   */
  isCoreRunner?: boolean;
  /** /api/auth/me `isClubManager`: the admin made them a "מנהל מדרגות". */
  isClubManager?: boolean;
  /**
   * When true, a role that resolves to nothing gets [dashboard, profile] rather
   * than an empty list. The two nav CHROMES want that (an empty bar or header
   * would strand the user with no way out); Search does not — it just has no
   * sections to offer.
   */
  fallback?: boolean;
  /**
   * The account's OWN role is `admin` and no preview is on (#70/#71) — the
   * "Madregot Admin" operator account, which manages the club and does not train.
   * Not `effectiveRole === 'admin'`: the super-user renders as admin too, and he
   * runs. An operator gets no member feed, no training profile (the account
   * screen instead) and no separate control-room tab, since its home IS the
   * control room.
   */
  isOperator?: boolean;
  /**
   * The trainee experience v2 is on for this device (lib/trainee/v2.ts). A non-staff
   * academy member's academy tab is then the board ("לוח"). Off: exactly as before.
   */
  traineeV2?: boolean;
}

/** Member-only destinations an operator account has no use for. */
const OPERATOR_HIDDEN_TABS = ['feed', 'control-room'];

/**
 * Which pages this user can reach, in nav order. The single source of truth for
 * the Header, the BottomTabBar, this module's hook and Search.
 *
 * The rule, decided 2026-09-07 and the reason the admin branches below exist:
 *
 *   1. `admin` SEES EVERYTHING. Every tab there is, whatever `role_tab_permissions`
 *      happens to say — it is the role that administers the club, so a screen it
 *      cannot open is a screen nobody can fix. That also means the admin column of
 *      the permissions editor grants nothing; the editor says so in words rather
 *      than offering switches that do nothing.
 *   2. EVERY OTHER ROLE sees exactly what is defined for it — the matrix rows, plus
 *      the two membership flags below, which are definitions of their own (no role
 *      row can express "is in the academy" or "is in the גרעין").
 *   3. AN ACCOUNT CAN BE BOTH. A coach who runs, an admin who runs — the club has
 *      several — and the staff half must never cost them the member half. That is
 *      what the `isAthlete` branch on the profile tab is for: having an athlete row
 *      is what makes an account a member, and a member has a training profile.
 *
 * Rule 1 replaced the opposite call (v2.39.128, ADMIN_HIDDEN_TABS), which took the
 * feed, the activity list and the weekly program out of the admin's nav on the
 * grounds that "the admin account is nobody's member account". For this club it is:
 * the accounts holding `admin` are the coaches and the owner, who all train, and
 * the super-user renders as `admin` by default — so the rule read as the app
 * hiding their own training from them.
 */
export function resolveNavItems({
  permissions,
  effectiveRole,
  previewRole = null,
  isAthlete = false,
  isAcademyMember = false,
  isCoreRunner = false,
  isClubManager = false,
  fallback = false,
  isOperator = false,
  traineeV2 = false,
}: NavResolutionInput): NavItem[] {
  if (!effectiveRole) return [];
  const isAdmin = effectiveRole === 'admin';
  const enabled = permissions.filter(p => p.role === effectiveRole && p.enabled).map(p => p.tab);

  // הגרעין's own grants, unioned in. Skipped while previewing another role —
  // "view as runner" has to show what a runner sees, and the previewer's own
  // squad membership is not part of that.
  if (isCoreRunner && !previewRole) {
    for (const p of permissions) {
      if (p.role === 'core_runner' && p.enabled && !enabled.includes(p.tab)) enabled.push(p.tab);
    }
  }
  // Rule 1: the admin's list is the whole list, and the matrix is not consulted for
  // it at all. Not even `settings` needs its row any more — that force-add existed
  // because revoking that one cell locked the only account that can grant it back
  // out of the editor that grants it, and now no cell in the admin column can lock
  // anything.
  const items = isAdmin
    ? ALL_NAV_ITEMS.filter(i => !isOperator || !OPERATOR_HIDDEN_TABS.includes(i.tab))
    // Filtered last, so this also sees the גרעין union above.
    : ALL_NAV_ITEMS.filter(i => enabled.includes(i.tab));

  // Rule 3: a member's profile belongs to whoever has an athlete row, staff or not —
  // a coach who runs and an admin who runs both keep it. Skipped for a staff
  // PREVIEW, where the point is to see the staff nav and the previewer's own athlete
  // row isn't the previewed account's.
  const previewingStaff = !!previewRole && STAFF_ROLES.includes(previewRole);
  if (!isOperator && !previewingStaff && (isAthlete || previewRole)) {
    if (!items.some(i => i.tab === 'profile')) items.push(PROFILE_ITEM);
  }
  // An admin with no athlete row has no training profile to show, and this is the
  // only screen holding sign-out and the view-as switcher — so it gets the account
  // screen in that slot rather than nothing. Same for a preview of `admin`, which
  // has to show what a pure admin account sees.
  else if (isAdmin && !items.some(i => i.tab === 'profile')) {
    items.push(ADMIN_ACCOUNT_ITEM);
  }
  // Coach Tools hub — every staff account, same force-add pattern as `settings`
  // (deliberately not gated by the DB permissions table).
  if (STAFF_ROLES.includes(effectiveRole) && !items.some(i => i.tab === 'coach-tools')) {
    items.push(COACH_TOOLS_ITEM);
  }
  // A "מנהל מדרגות" with no staff role gets ניהול = the club's numbers. Not while previewing.
  if (isClubManager && !previewRole && !STAFF_ROLES.includes(effectiveRole) && !items.some(i => i.tab === 'club-numbers')) items.push(CLUB_NUMBERS_ITEM);
  // Academy members reach the academy regardless of role_tab_permissions.
  // Membership is the `is_academy` flag, not a role — an athlete whose role is
  // plain `runner` can be in the academy — so no permission row can express it.
  // Migration 022 denies `academy_user` this tab on purpose, because the only
  // thing behind it was the coach's admin console; /dashboard/academy now serves
  // an athlete their own view, so the row is theirs to have.
  if (isAcademyMember && !items.some(i => i.tab === 'academy')) items.push(ACADEMY_ITEM);
  // Under v2 a trainee's academy is their board: same door, its own name and icon. Staff
  // keep the academy centre, whatever their own membership.
  if (traineeV2 && isAcademyMember && !STAFF_ROLES.includes(effectiveRole)) {
    const at = items.findIndex(i => i.tab === 'academy');
    if (at >= 0) items[at] = ACADEMY_BOARD_ITEM;
    if (!items.some(i => i.tab === PROGRESS_ITEM.tab)) items.splice(at >= 0 ? at + 1 : items.length, 0, PROGRESS_ITEM);
  }

  if (!items.length && fallback) return [ALL_NAV_ITEMS[0], PROFILE_ITEM];
  return items;
}

/**
 * The phone bar's primary order for a non-staff account, with the academy in
 * place of the program for an academy member (2026-10-06).
 *
 * A trainee's program IS their academy plan — the home of /dashboard/academy
 * shows the week, day by day, with what they actually ran under each session —
 * so a Program tab beside it was two doors to the same week and the academy, the
 * thing they signed up for, was the one left in "More". The program page stays
 * reachable from there; nothing is removed from the nav, only reordered.
 */
export function athletePrimaryOrder(order: readonly string[], isAcademyMember: boolean, traineeV2 = false): string[] {
  if (!isAcademyMember) return [...order];
  const out = order.map((tab) => (tab === 'program' ? 'academy' : tab));
  if (!traineeV2) return out.includes('academy') ? out : [...out, 'academy'];
  // v2 (mockup tab bar: פיד · בית · לוח · התקדמות · …): the board and progress sit right
  // after home, whatever the base order held, so both are among the four flat tabs — and
  // profile, fifth, moves into "More" (decision D1 in the build plan: the bar is 4 + More,
  // the mockup draws 5 flat tabs).
  const rest = out.filter(tab => tab !== 'academy' && tab !== 'academy-progress');
  const home = rest.indexOf('dashboard');
  rest.splice(home >= 0 ? home + 1 : rest.length, 0, 'academy', 'academy-progress');
  return rest;
}

/**
 * The signed-in user's identity as the nav needs it: which role to render as,
 * whether they're staff, and the two localStorage-derived flags. Shared by the
 * Header and the BottomTabBar, which both used to resolve this independently.
 */
export function useNavIdentity() {
  const [isAthlete, setIsAthlete] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  // Super-user is TWO signals OR'd together, and it has to be: a Strava/Garmin
  // athlete signs in as a synthetic …@strava.madregot.local, which can never
  // match SUPER_USER_EMAIL, so the local check alone hid every view-as entry
  // point. `isSuper` on /api/auth/me is the server-verified answer.
  const localSuper = useIsSuperUser();
  const traineeV2 = useTraineeV2();

  // Both answers go through useApi (SWR) rather than a raw fetch, because the
  // Header, the tab bar and Search all need the same two and each request pays
  // a full session verification server-side. SWR keys them, so the pair
  // resolves once per page view however many components ask.
  const { data: permsData, isLoading: permsLoading } = useApi<{ permissions?: TabPermission[] }>(
    '/api/admin/tab-permissions',
  );
  const permissions = permsData?.permissions || [];

  const { data: meData } = useApi<{ role?: string; roles?: string[]; isAcademy?: boolean; academyOnly?: boolean; isSuper?: boolean; isCoreRunner?: boolean; isClubManager?: boolean }>(
    hasEmail ? '/api/auth/me' : null,
  );
  const isSuper = localSuper || !!meData?.isSuper;

  useEffect(() => {
    const athleteId = localStorage.getItem('athlete_id');
    const email = localStorage.getItem('athlete_email') || localStorage.getItem('coach_email') || '';
    if (athleteId) setIsAthlete(true);

    // All we need from the address is that there IS one — that's what unlocks
    // the /api/auth/me request above, which reads the SESSION rather than
    // whatever address it's handed. Role, academy membership and super-user
    // status all come from that response now.
    const markSignedIn = (e: string) => { if (e) setHasEmail(true); };
    if (email) markSignedIn(email);
    else {
      getSupabase().auth.getSession().then(({ data }) => {
        markSignedIn(data.session?.user?.email || '');
      }).catch(() => {});
    }
  }, []);

  const viewMode = typeof window !== 'undefined' ? getViewMode() : null;
  const previewRole = viewMode && viewMode !== MAINTENANCE_MODE ? viewMode : null;
  const baseRole = isSuper ? 'admin' : meData?.role || null;
  // The account's own view switch — see src/lib/role-views.ts. Under the preview.
  const activeRole = !previewRole && typeof window !== 'undefined'
    ? activeNavRole(meData?.roles, meData?.role, isSuper)
    : null;
  const effectiveRole = previewRole || activeRole || baseRole;
  // The account's own role, not the rendered one — see NavResolutionInput.isOperator.
  // An admin who switched to another view is not operating as admin.
  const isOperator = meData?.role === 'admin' && !previewRole && (!activeRole || activeRole === 'admin');

  return {
    permissions,
    effectiveRole,
    previewRole,
    // The raw mode as well as previewRole, because the two differ in exactly one
    // case that the view-as UI cares about: MAINTENANCE_MODE is a view mode but
    // deliberately not a preview ROLE, and "back to my own view" has to be
    // offered while it's active too.
    viewMode,
    isSuper,
    isAthlete,
    isAcademyMember: !!meData?.isAcademy,
    /** In the academy and no club group: always the academy trainee home (academy-dash.html). */
    isAcademyOnly: !!meData?.academyOnly,
    isCoreRunner: !!meData?.isCoreRunner,
    isClubManager: !!meData?.isClubManager,
    isOperator,
    // An academy-only trainee has no club home to fall back to: v2 is theirs regardless of the flag.
    traineeV2: traineeV2 || !!meData?.academyOnly,
    /** /api/auth/me has answered, so `isOperator` is final rather than "not yet". */
    accountKnown: !!meData,
    ready: !permsLoading && !!effectiveRole,
    isStaffView: effectiveRole ? STAFF_ROLES.includes(effectiveRole) : false,
  };
}

export function useNavItems() {
  const identity = useNavIdentity();
  const { ready, isStaffView } = identity;
  return { ready, isStaffView, navItems: ready ? resolveNavItems(identity) : [] };
}

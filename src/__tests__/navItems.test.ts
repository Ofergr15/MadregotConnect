import { describe, expect, it } from 'vitest';
import { resolveNavItems, splitNavForBar, ALL_NAV_ITEMS, type TabPermission } from '@/lib/nav-items';
import { NAV_TAB_IDS } from '@/lib/nav-tabs';

/**
 * Which pages a role can reach. Three places used to answer this independently —
 * the desktop Header, the mobile BottomTabBar and the Search page's "sections"
 * category — and they drifted: the Header's copy was missing the academy
 * force-add, so an athlete whose role is plain `runner` but who IS in the academy
 * saw the tab on their phone and not on their laptop. The logic is one pure
 * function now, and this is the only part of nav that can be tested at all (no
 * jsdom here, so the hook and the components can't be).
 *
 * The per-role expectations below are the REAL production `role_tab_permissions`
 * rows, read from the database — they're what docs/qa-matrix.md tells Ofer to
 * expect on the phone, so if someone edits the rules these fail rather than the
 * doc quietly going stale.
 */

// Verbatim from production: role -> enabled tabs.
const PROD: Record<string, string[]> = {
  academy_coach: ['academy', 'activities', 'calendar', 'dashboard', 'feed', 'photos', 'practice', 'program', 'races', 'team-volume'],
  academy_user: ['activities', 'calendar', 'dashboard', 'feed', 'photos', 'practice', 'program', 'races', 'review'],
  admin: ['academy', 'activities', 'athletes', 'calendar', 'dashboard', 'feed', 'groups', 'history', 'photos', 'plan/new', 'practice-attendance', 'program', 'races', 'review', 'settings', 'team-volume', 'workout-feedback'],
  coach: ['academy', 'activities', 'athletes', 'calendar', 'dashboard', 'feed', 'groups', 'history', 'photos', 'plan/new', 'practice-attendance', 'program', 'races', 'review', 'settings', 'team-volume', 'workout-feedback'],
  core_runner: ['activities', 'calendar', 'dashboard', 'feed', 'photos', 'plan/new', 'program', 'races', 'review'],
  runner: ['activities', 'calendar', 'dashboard', 'feed', 'photos', 'program', 'races', 'review'],
  viewer: ['activities', 'dashboard', 'program'],
};

const permissions: TabPermission[] = Object.entries(PROD).flatMap(([role, tabs]) =>
  tabs.map((tab) => ({ role, tab, enabled: true })),
);

const tabsFor = (input: Parameters<typeof resolveNavItems>[0]) =>
  resolveNavItems(input).map((i) => i.tab);

describe('what each production role can reach', () => {
  // An athlete account (has an athlete row), which is what all four of these are.
  const athlete = (role: string) => tabsFor({ permissions, effectiveRole: role, isAthlete: true });

  it('runner gets their own four plus the three extras', () => {
    expect(athlete('runner')).toEqual([
      'dashboard', 'feed', 'review', 'activities', 'program', 'calendar', 'profile',
    ]);
  });

  it('core_runner is a runner plus the plan editor', () => {
    // Worth pinning rather than tidying away: `plan/new` is the COACH's
    // plan-authoring screen, and this role is granted it in production. If that
    // row is ever corrected, this test is the reminder to update the QA matrix.
    expect(athlete('core_runner')).toContain('plan/new');
    expect(athlete('core_runner')).toEqual([
      'dashboard', 'feed', 'review', 'plan/new', 'activities', 'program', 'calendar', 'profile',
    ]);
  });

  it('viewer has no feed, even though /feed is the landing page', () => {
    expect(athlete('viewer')).toEqual(['dashboard', 'activities', 'program', 'profile']);
    expect(athlete('viewer')).not.toContain('feed');
  });

  it('academy_user gets practice, which no coach does', () => {
    expect(athlete('academy_user')).toContain('practice');
    expect(athlete('coach')).not.toContain('practice');
    // The admin does, but not from a permission row — it sees everything.
    expect(athlete('admin')).toContain('practice');
  });
});

describe('staff', () => {
  const staff = (role: string) => tabsFor({ permissions, effectiveRole: role });

  it('admin sees every tab there is, plus coach tools and its account', () => {
    // Rule 1: not "everything it is granted" — everything, full stop.
    expect(staff('admin')).toEqual([
      ...ALL_NAV_ITEMS.map(i => i.tab), 'profile', 'coach-tools',
    ]);
  });

  it('shows the admin a tab no permission row grants it', () => {
    // `practice` is enabled for the academy roles and for nobody else, so it is the
    // one tab that proves the admin's list is not read off the matrix at all. The
    // point of the rule: the role that fixes the club can open every screen in it.
    expect(permissions.some(p => p.role === 'admin' && p.tab === 'practice')).toBe(false);
    expect(staff('admin')).toContain('practice');
  });

  it('keeps every tab even if the admin column is emptied', () => {
    // The whole admin column is decorative now — the settings editor says so in
    // words instead of offering switches that change nothing.
    const noAdminRows = permissions.filter(p => p.role !== 'admin');
    expect(tabsFor({ permissions: noAdminRows, effectiveRole: 'admin' })).toEqual(staff('admin'));
  });

  it('gives an admin who also runs their training profile, and one who does not an account tab', () => {
    // Rule 3, and the defect that prompted it: every admin account in this club has
    // an athlete row — they are the coaches and the owner — and the super-user
    // renders as `admin`, so an account-screen-for-all-admins rule meant the app
    // hid its own users' training from them.
    //
    // Same route and same tab id either way (one active state, and old links still
    // land); the label is the observable difference, and ProfileGate branches on the
    // same two inputs.
    const profileOf = (input: Parameters<typeof resolveNavItems>[0]) =>
      resolveNavItems(input).find(i => i.tab === 'profile');
    const running = profileOf({ permissions, effectiveRole: 'admin', isAthlete: true });
    expect(running?.labelKey).toBe('profile');
    expect(running?.href).toBe('/dashboard/profile');

    // No athlete row: nothing to show, and this is the only screen holding sign-out
    // and the view-as switcher, so the slot can't just be empty.
    const account = profileOf({ permissions, effectiveRole: 'admin', isAthlete: false });
    expect(account?.labelKey).toBe('account');
    expect(account?.href).toBe('/dashboard/profile');

    // Exactly one of the two, never both.
    expect(resolveNavItems({ permissions, effectiveRole: 'admin', isAthlete: true }).filter(i => i.tab === 'profile'))
      .toHaveLength(1);
    // An athlete still gets the athlete one.
    expect(profileOf({ permissions, effectiveRole: 'runner', isAthlete: true })?.labelKey).toBe('profile');
  });

  it('keeps the member half of a coach who also runs', () => {
    // The other side of rule 3, and the commoner case: several coaches train with
    // the club. Their staff tabs and their own profile, never one at the cost of
    // the other.
    const coachWhoRuns = tabsFor({ permissions, effectiveRole: 'coach', isAthlete: true });
    for (const staffOnly of ['athletes', 'groups', 'settings', 'workout-feedback', 'plan/new']) {
      expect(coachWhoRuns, `lost ${staffOnly}`).toContain(staffOnly);
    }
    for (const member of ['feed', 'activities', 'program', 'profile']) {
      expect(coachWhoRuns, `lost ${member}`).toContain(member);
    }
  });

  it('a coach reaches feedback triage and attendance', () => {
    // Both rows were added 2026-09-05. The previous version of this test pinned
    // their ABSENCE and said "the day the row is added, this test says so out
    // loud" — this is that edit.
    //
    // Neither granted anything new: `requireStaffCaller` on
    // /api/workout-feedback and the isStaff branch on /api/attendance already
    // passed coach, so a coach could reach both by typing the URL and had no tab
    // to either. Attendance was the sharper of the two — the bar renders the
    // נוכחות staff slot unconditionally, so a coach saw the tab while the
    // permission row denied it, and the row was the thing out of step with both
    // the bar and the API.
    expect(staff('coach')).toContain('workout-feedback');
    expect(staff('coach')).toContain('practice-attendance');
  });

  it('leaves the admin with strictly more than a coach', () => {
    // Not the intended outcome of adding the two rows, but the actual one: those
    // were the last two tabs admin held and coach did not, so the two roles are
    // now nav-identical. Written as a set difference and asserted empty so the
    // fact is stated rather than buried in two long literal lists.
    //
    // Nav is visibility only, so this is not itself a privilege change — but
    // `settings` is in that shared set, and it hosts the tab-permission editor
    // and the maintenance toggle. Coach already held `settings` before those two
    // rows, so that predates it; recorded here because "coach ≡ admin" is the
    // kind of thing that should be a decision, not a side effect.
    //
    // They diverged again when the admin stopped being read off the matrix: the
    // admin's list is now every tab, so it is a strict superset of the coach's —
    // and these three are what it adds, with nothing a coach reaches that an admin
    // can't. Written as two set differences so the fact is stated rather than buried
    // in a pair of long literal lists.
    expect(staff('admin').filter((t) => !staff('coach').includes(t)))
      .toEqual(['control-room', 'practice', 'profile']);
    expect(staff('coach').filter((t) => !staff('admin').includes(t))).toEqual([]);
  });

  it('gives the control room to the admin and to nobody else by default', () => {
    // Admin-only BY CONSTRUCTION rather than by an exception: no production row
    // grants `control-room`, and only the admin bypasses the matrix, so listing it
    // in ALL_NAV_ITEMS is the whole implementation. That is why there is no
    // migration with this change.
    expect(permissions.some((p) => p.tab === 'control-room')).toBe(false);
    expect(staff('admin')).toContain('control-room');
    for (const role of ['coach', 'academy_coach', 'runner', 'core_runner', 'academy_user', 'viewer']) {
      expect(tabsFor({ permissions, effectiveRole: role, isAthlete: true }), `${role} reached the control room`)
        .not.toContain('control-room');
    }
    // …and it is grantable, which is the point of it being a matrix tab at all
    // (everything behind it is staff-gated server-side, so a coach given the row
    // gets a working screen). The settings editor lists it for that reason.
    expect(tabsFor({
      permissions: [...permissions, { role: 'coach', tab: 'control-room', enabled: true }],
      effectiveRole: 'coach',
    })).toContain('control-room');
  });

  it('every staff role gets the coach-tools hub without a permission row', () => {
    expect(permissions.some((p) => p.tab === 'coach-tools')).toBe(false);
    for (const role of ['admin', 'coach', 'academy_coach']) {
      expect(staff(role)).toContain('coach-tools');
    }
  });

  it('staff do not get a profile tab unless they also have an athlete row', () => {
    expect(staff('coach')).not.toContain('profile');
    expect(tabsFor({ permissions, effectiveRole: 'coach', isAthlete: true })).toContain('profile');
  });
});

describe('the two force-adds no permission row can express', () => {
  it('admin keeps settings even with the row revoked', () => {
    // Otherwise revoking it locks the only account that can grant it back out of
    // the editor that grants it.
    const withoutSettings = permissions.filter((p) => !(p.role === 'admin' && p.tab === 'settings'));
    expect(resolveNavItems({ permissions: withoutSettings, effectiveRole: 'admin' }).map((i) => i.tab))
      .toContain('settings');
  });

  it('does not hand settings to a non-admin the same way', () => {
    expect(tabsFor({ permissions, effectiveRole: 'runner', isAthlete: true })).not.toContain('settings');
  });

  it('an academy member reaches the academy whatever their role', () => {
    // The drift this whole refactor exists to close: membership is the
    // `is_academy` flag, so a plain `runner` can be in the academy and no role
    // row can say so.
    expect(athleteAcademy('runner')).toContain('academy');
    expect(athleteAcademy('academy_user')).toContain('academy');
    // …and it lands last, after the permission-derived list.
    expect(athleteAcademy('runner').at(-1)).toBe('academy');
  });

  it('does not duplicate the academy for a role already granted it', () => {
    const admin = tabsFor({ permissions, effectiveRole: 'admin', isAcademyMember: true });
    expect(admin.filter((t) => t === 'academy')).toHaveLength(1);
  });

  function athleteAcademy(role: string) {
    return tabsFor({ permissions, effectiveRole: role, isAthlete: true, isAcademyMember: true });
  }
});

describe('the גרעין adds tabs instead of replacing them', () => {
  // Same shape as the academy flag, and for the same reason: membership is
  // `athletes.is_core_runner` (migration 091), so no role row can express it.
  const core = (role: string) =>
    tabsFor({ permissions, effectiveRole: role, isAthlete: true, isCoreRunner: true });

  it('grants a plain runner the core squad extras', () => {
    // `plan/new` is the one tab the production core_runner row adds over runner,
    // so it is the observable difference.
    expect(tabsFor({ permissions, effectiveRole: 'runner', isAthlete: true })).not.toContain('plan/new');
    expect(core('runner')).toContain('plan/new');
  });

  it('keeps a coach a coach — the whole point of splitting the flag off the role', () => {
    // Before 091 this was unrepresentable: marking a coach as core rewrote their
    // role and demoted them out of staff.
    const coach = core('coach');
    for (const staffOnly of ['athletes', 'groups', 'settings', 'workout-feedback']) {
      expect(coach, `core coach lost ${staffOnly}`).toContain(staffOnly);
    }
  });

  it('does not duplicate a tab the role already grants', () => {
    expect(core('runner').filter((t) => t === 'program')).toHaveLength(1);
  });

  it('changes nothing for someone not in the גרעין', () => {
    expect(core('runner')).not.toEqual(tabsFor({ permissions, effectiveRole: 'runner', isAthlete: true }));
    expect(tabsFor({ permissions, effectiveRole: 'runner', isAthlete: true, isCoreRunner: false }))
      .toEqual(tabsFor({ permissions, effectiveRole: 'runner', isAthlete: true }));
  });

  it('is ignored while previewing another role', () => {
    // A view-as preview must show what the PREVIEWED member sees, and the
    // previewer's own membership is not theirs.
    expect(tabsFor({ permissions, effectiveRole: 'runner', previewRole: 'runner', isCoreRunner: true }))
      .not.toContain('plan/new');
  });
});

describe('view-as previews', () => {
  it('gives a previewed athlete role the profile tab even from a staff account', () => {
    // The super-user has no athlete row in this case; previewing `runner` should
    // still render the runner's nav, profile included.
    expect(tabsFor({ permissions, effectiveRole: 'runner', previewRole: 'runner' })).toContain('profile');
  });

  it('does not add profile while previewing a coach role', () => {
    // The point of a staff preview is to see the staff nav.
    for (const role of ['coach', 'academy_coach']) {
      expect(tabsFor({ permissions, effectiveRole: role, previewRole: role })).not.toContain('profile');
    }
  });

  it('previewing the admin shows the admin nav, account tab included', () => {
    // Not an exception to the rule above: the account screen IS what a pure admin
    // account has in that slot, so a preview that hid it would be showing something
    // no such admin sees. The previewer's own athlete row is not the previewed
    // account's, which is why this stays the account tab even for Ofer.
    const preview = resolveNavItems({
      permissions, effectiveRole: 'admin', previewRole: 'admin', isAthlete: true,
    });
    expect(preview.find(i => i.tab === 'profile')?.labelKey).toBe('account');
    // …and everything else an admin sees is there too.
    expect(preview.map(i => i.tab)).toEqual([...ALL_NAV_ITEMS.map(i => i.tab), 'profile', 'coach-tools']);
  });

  it('shows a previewed runner the runner nav, not the previewer\'s', () => {
    const preview = tabsFor({ permissions, effectiveRole: 'runner', previewRole: 'runner' });
    expect(preview).toEqual(['dashboard', 'feed', 'review', 'activities', 'program', 'calendar', 'profile']);
    // Nothing staff-only leaks in from the account doing the previewing.
    for (const tab of ['athletes', 'groups', 'settings', 'practice']) expect(preview).not.toContain(tab);
  });
});

describe('the empty cases', () => {
  it('resolves to nothing before the role is known', () => {
    expect(resolveNavItems({ permissions, effectiveRole: null })).toEqual([]);
    // …and the fallback must not paper over that: an unknown role isn't the same
    // as a role with no tabs, and the chromes hide themselves while !ready.
    expect(resolveNavItems({ permissions, effectiveRole: null, fallback: true })).toEqual([]);
  });

  it('gives the nav chromes a way out when a role resolves to nothing', () => {
    const unknown = { permissions, effectiveRole: 'not_a_role' };
    // Search wants the honest answer — it simply has no sections to offer.
    expect(resolveNavItems(unknown)).toEqual([]);
    // The header and the bar would strand the user, so they opt into a fallback.
    expect(resolveNavItems({ ...unknown, fallback: true }).map((i) => i.tab))
      .toEqual(['dashboard', 'profile']);
  });

  it('only ever returns real nav entries', () => {
    const known = new Set([...ALL_NAV_ITEMS.map((i) => i.tab), 'profile', 'coach-tools']);
    for (const role of Object.keys(PROD)) {
      for (const tab of tabsFor({ permissions, effectiveRole: role, isAthlete: true })) {
        expect(known, `${role} resolved unknown tab ${tab}`).toContain(tab);
      }
    }
  });

  it('silently drops permitted tabs that have no page behind them', () => {
    // `photos` and `races` are enabled for most roles in production but have no
    // ALL_NAV_ITEMS entry (photos is deliberately parked; races has no page at
    // all), so those rows are dead. Asserting it so nobody spends an afternoon
    // hunting for the missing tab.
    expect(permissions.some((p) => p.tab === 'races' && p.enabled)).toBe(true);
    expect(ALL_NAV_ITEMS.some((i) => i.tab === 'races')).toBe(false);
    for (const role of Object.keys(PROD)) {
      const tabs = tabsFor({ permissions, effectiveRole: role, isAthlete: true });
      expect(tabs).not.toContain('races');
      expect(tabs).not.toContain('photos');
    }
  });
});

/**
 * Per-member grants — `athlete_tab_grants` (migration 099).
 *
 * The interesting property isn't that a grant adds a page; it's everything a
 * grant CANNOT do. It can't reorder the nav, can't take a page away, can't
 * survive into a role preview, and can't invent a destination. Each of those is
 * a way this feature could have become a second source of truth alongside the
 * matrix, so each one is pinned here.
 */
describe('pages granted to one member', () => {
  const runner = (grantedTabs: string[], extra = {}) =>
    tabsFor({ permissions, effectiveRole: 'runner', isAthlete: true, grantedTabs, ...extra });

  const plainRunner = tabsFor({ permissions, effectiveRole: 'runner', isAthlete: true });

  it('adds the granted page and nothing else', () => {
    expect(plainRunner).not.toContain('athletes');
    expect(runner(['athletes'])).toContain('athletes');
    expect(runner(['athletes'])).toHaveLength(plainRunner.length + 1);
  });

  it('keeps the page in NAV order, not in the order it was granted', () => {
    // The list is filtered out of ALL_NAV_ITEMS, so a grant can never push a page
    // to the end and change which four the bar promotes.
    expect(runner(['athletes', 'history'])).toEqual([
      'dashboard', 'feed', 'review', 'athletes', 'activities', 'program', 'calendar', 'history', 'profile',
    ]);
  });

  it('is a no-op when the role already grants the page', () => {
    expect(runner(['program'])).toEqual(plainRunner);
  });

  it('cannot take anything away', () => {
    // The signature has no way to express a denial, which is the point — but pin
    // it, because the obvious "fix" if someone ever wants one is to reuse this
    // field with a flag, and that is the change this test should stop.
    for (const tab of plainRunner) {
      expect(runner(['athletes'])).toContain(tab);
    }
  });

  it('is ignored while previewing another role', () => {
    // "View as runner" has to show what a runner sees. A page granted personally
    // to the admin doing the previewing is not part of that.
    expect(runner(['athletes'], { previewRole: 'runner' })).not.toContain('athletes');
  });

  it('cannot invent a destination', () => {
    // A grant left behind by a deleted page, or a hand-written row, resolves to
    // nothing rather than to a nav entry with no page behind it.
    expect(runner(['races', 'not_a_tab'])).toEqual(plainRunner);
  });

  it('unions with the flags rather than replacing them', () => {
    const both = runner(['athletes'], { isAcademyMember: true, isCoreRunner: true });
    expect(both).toContain('athletes');   // the grant
    expect(both).toContain('academy');    // the academy flag
    expect(both).toContain('plan/new');   // הגרעין
  });

  it('changes nothing for an admin, who already has everything', () => {
    const admin = { permissions, effectiveRole: 'admin', isAthlete: true };
    expect(tabsFor({ ...admin, grantedTabs: ['athletes'] })).toEqual(tabsFor(admin));
  });
});

/**
 * The four flat slots, and what falls behind "More".
 *
 * This rule lived inside BottomTabBar until Settings → User Manager needed to
 * tell an admin where a page they just granted would appear. Moving it here made
 * it testable for the first time, and it is worth testing: it decides what a
 * member sees without scrolling, and the answer this screen prints is only
 * trustworthy while both callers ask the same function.
 */
describe('how the bar splits a nav list', () => {
  const items = (tabs: string[]) => ALL_NAV_ITEMS.filter((i) => tabs.includes(i.tab));
  const split = (tabs: string[], isStaffView = false) => {
    const { primary, overflow } = splitNavForBar({ navItems: items(tabs), isStaffView });
    return { primary: primary.map((i) => i.tab), overflow: overflow.map((i) => i.tab) };
  };

  it('gives an athlete their four daily destinations, in the preferred order', () => {
    const { primary } = split(['dashboard', 'feed', 'program', 'activities', 'history', 'review']);
    // Note the order: it is ATHLETE_PRIMARY_ORDER's, not nav order — feed leads
    // because it is the app's landing page.
    expect(primary).toEqual(['feed', 'dashboard', 'program', 'activities']);
  });

  it('never promotes review into a slot, even when nothing else wants one', () => {
    // Review has two homes of its own (the Header button and a static sheet card),
    // so spending one of four daily-use slots on it would print it twice.
    const { primary, overflow } = split(['dashboard', 'review']);
    expect(primary).toEqual(['dashboard']);
    // …and it isn't in the overflow either, for the same reason.
    expect(overflow).toEqual([]);
  });

  it('keeps the staff FAB target out of the flat tabs', () => {
    // practice-attendance is the FAB's own destination; promoting it would make
    // one page reachable twice from one bar.
    const { primary } = split(['dashboard', 'feed', 'practice-attendance', 'groups'], true);
    expect(primary).not.toContain('practice-attendance');
    expect(primary).toEqual(['feed', 'dashboard', 'groups']);
  });

  it('never puts more than four in the bar', () => {
    const { primary, overflow } = split(ALL_NAV_ITEMS.map((i) => i.tab), true);
    expect(primary).toHaveLength(4);
    expect(overflow.length).toBeGreaterThan(0);
    expect(primary.some((t) => overflow.includes(t))).toBe(false);
  });

  it('is what the User Manager relies on: a fifth page lands in More', () => {
    // The exact claim that screen prints when you grant somebody a page. Resolved
    // rather than hand-listed, so the fixture is a real runner's nav (which is
    // where `profile` comes from — it is PROFILE_ITEM, not an ALL_NAV_ITEMS row,
    // and a hand-written list quietly leaves it out and frees up a slot).
    const runnerNav = resolveNavItems({ permissions, effectiveRole: 'runner', isAthlete: true });
    const before = splitNavForBar({ navItems: runnerNav, isStaffView: false });
    // profile takes the fourth slot, which is the reason activities is already in
    // "More" for every runner in the club before anyone grants anything.
    expect(before.primary.map((i) => i.tab)).toEqual(['feed', 'dashboard', 'program', 'profile']);

    const granted = resolveNavItems({
      permissions, effectiveRole: 'runner', isAthlete: true, grantedTabs: ['history'],
    });
    const after = splitNavForBar({ navItems: granted, isStaffView: false });
    // The bar is unchanged and the new page is behind "More" — which is exactly
    // what the picker tells the admin before they tap.
    expect(after.primary).toEqual(before.primary);
    expect(after.overflow.map((i) => i.tab)).toContain('history');
  });
});

// The server-safe mirror of the list. A route handler cannot import
// ALL_NAV_ITEMS (nav-items is a client module — the build fails collecting page
// data with "ALL_NAV_ITEMS.map is not a function"), so /api/admin/tab-grants
// validates against NAV_TAB_IDS instead. This is what stops the two from
// drifting: add a page and forget this list, and the page is silently
// ungrantable forever.
describe('the tab-id list the API validates against', () => {
  it('is exactly ALL_NAV_ITEMS, in the same order', () => {
    expect([...NAV_TAB_IDS]).toEqual(ALL_NAV_ITEMS.map((i) => i.tab));
  });
});

import { describe, expect, it } from 'vitest';
import { resolveNavItems, ALL_NAV_ITEMS, type TabPermission } from '@/lib/nav-items';

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

  it('academy_user gets practice, which no staff role does', () => {
    expect(athlete('academy_user')).toContain('practice');
    expect(athlete('admin')).not.toContain('practice');
    expect(athlete('coach')).not.toContain('practice');
  });
});

describe('staff', () => {
  const staff = (role: string) => tabsFor({ permissions, effectiveRole: role });

  it('admin reaches everything it is granted, plus coach tools', () => {
    expect(staff('admin')).toEqual([
      'dashboard', 'feed', 'review', 'plan/new', 'athletes', 'academy', 'groups',
      'activities', 'program', 'practice-attendance', 'workout-feedback',
      'team-volume', 'calendar', 'history', 'settings', 'coach-tools',
    ]);
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

  it('leaves a coach with exactly an admin nav, which is worth knowing', () => {
    // Not the intended outcome of adding the two rows, but the actual one: those
    // were the last two tabs admin held and coach did not, so the two roles are
    // now nav-identical. Written as a set difference and asserted empty so the
    // fact is stated rather than buried in two long literal lists.
    //
    // Nav is visibility only, so this is not itself a privilege change — but
    // `settings` is in that shared set, and it hosts the tab-permission editor
    // and the maintenance toggle. Coach already held `settings` before these two
    // rows, so that predates this change; recorded here because "coach ≡ admin"
    // is the kind of thing that should be a decision, not a side effect.
    expect(staff('admin').filter((t) => !staff('coach').includes(t))).toEqual([]);
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

describe('view-as previews', () => {
  it('gives a previewed athlete role the profile tab even from a staff account', () => {
    // The super-user has no athlete row in this case; previewing `runner` should
    // still render the runner's nav, profile included.
    expect(tabsFor({ permissions, effectiveRole: 'runner', previewRole: 'runner' })).toContain('profile');
  });

  it('does not add profile while previewing a staff role', () => {
    // The point of a staff preview is to see the staff nav.
    for (const role of ['admin', 'coach', 'academy_coach']) {
      expect(tabsFor({ permissions, effectiveRole: role, previewRole: role })).not.toContain('profile');
    }
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

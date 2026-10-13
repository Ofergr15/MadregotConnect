import { describe, expect, it, vi } from 'vitest';
import { isUnauthorizedError, sessionlessSignInPath } from '@/lib/auth/sessionless';
import { createBackGate } from '@/lib/use-back-dismiss';
import { academyLens } from '@/lib/academy/lens';
import { defaultViewFor } from '@/lib/role-views';
import { traineePlanRow } from '@/lib/academy/me-plan-row';
import { sentPlanStatus } from '@/lib/plans/plan-status';
import { settlementFor, STAFF_EARLY_DAYS } from '@/lib/academy/settleInvitation';
import { mayDeleteAthlete } from '@/lib/auth/delete-athlete-policy';
import { isClubStaff } from '@/lib/academy/staff-scope';
import { withoutOwnRows } from '@/lib/plans/scope-server';
import {
  bandSetCopy, missedWeekCopy, paceUpdateCopy, planSavedCopy, removedCopy, testAnalysisCopy,
  testApprovedCopy, testConfirmedCopy, testInviteCopy, testSubmittedCopy, LOOP_KINDS,
} from '@/lib/academy/loop-notify';
import { KIND_CATEGORY } from '@/lib/notifications/prefs';
import type { WorkoutStep } from '@/lib/ai/types';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: () => ({}) }) }));

/**
 * The launch report's non-UI fixes (plans/academy-launch-report.md), the pure halves.
 * Route-level behaviour is pinned in the routes' own test files.
 */

describe('BL1 / N1 — a join that ends with no session goes to the code sign-in', () => {
  it('carries a well-formed join token and drops anything else', () => {
    expect(sessionlessSignInPath('AbCdEf123456')).toBe('/welcome?t=AbCdEf123456');
    expect(sessionlessSignInPath(null)).toBe('/welcome');
    expect(sessionlessSignInPath('short')).toBe('/welcome');
    expect(sessionlessSignInPath('bad token/../x')).toBe('/welcome');
  });
  it('recognises the fetcher\'s 401 and nothing else', () => {
    expect(isUnauthorizedError(Object.assign(new Error('x'), { status: 401 }))).toBe(true);
    expect(isUnauthorizedError(Object.assign(new Error('x'), { status: 500 }))).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
  });
});

describe('BL2 / N2 — "close A, open B": the new overlay waits for A\'s back() to land', () => {
  function fakeWindow() {
    const target = new EventTarget();
    const win = {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      history: { back: vi.fn() },
      pop: () => target.dispatchEvent(new Event('popstate')),
    };
    return win;
  }
  it('runs at once when nothing is in flight', () => {
    const win = fakeWindow();
    const gate = createBackGate(win as never);
    const fn = vi.fn();
    gate.whenSettled(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('defers the push until the popstate of the pending back()', async () => {
    const win = fakeWindow();
    const gate = createBackGate(win as never);
    gate.back();
    expect(win.history.back).toHaveBeenCalledTimes(1);
    const fn = vi.fn();
    gate.whenSettled(fn);
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
    win.pop();
    await new Promise((r) => setTimeout(r, 0));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(gate.busy).toBe(false);
  });
  it('gives up waiting after the timeout, for a browser that never fires popstate', async () => {
    const win = fakeWindow();
    const gate = createBackGate(win as never, 10);
    gate.back();
    const fn = vi.fn();
    gate.whenSettled(fn);
    await new Promise((r) => setTimeout(r, 30));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('BL5 / N4, N9, N10 — the academy lens', () => {
  const base = { storedView: null, isSuper: false, isAcademy: false, linkTab: null, linkThread: null, traineeLink: false } as const;

  it('a manager stored as academy_coach + academy_manager starts as the MANAGER', () => {
    expect(defaultViewFor('academy_coach', false, ['academy_coach', 'academy_manager'])).toBe('manager');
    const lens = academyLens({ ...base, primaryRole: 'academy_coach', roles: ['academy_coach', 'academy_manager'] });
    expect(lens).toMatchObject({ view: 'manager', isManager: true, isStaff: true, scopeCoach: false });
  });
  it('a runner-primary manager gets the manager lens, not "not a member"', () => {
    const lens = academyLens({ ...base, primaryRole: 'runner', roles: ['runner', 'academy_manager'] });
    expect(lens).toMatchObject({ view: 'manager', isStaff: true, isManager: true });
  });
  it('the coach lens is always scoped to the coach\'s own trainees', () => {
    const asCoach = academyLens({ ...base, storedView: 'coach', primaryRole: 'academy_coach', roles: ['academy_coach', 'academy_manager'] });
    expect(asCoach).toMatchObject({ view: 'coach', isManager: false, isStaff: true, scopeCoach: true });
    const plain = academyLens({ ...base, primaryRole: 'academy_coach', roles: ['academy_coach'] });
    expect(plain).toMatchObject({ view: 'coach', scopeCoach: true });
  });
  it('a plain trainee keeps the trainee lens', () => {
    const lens = academyLens({ ...base, primaryRole: 'academy_user', roles: ['academy_user'], isAcademy: true });
    expect(lens).toMatchObject({ view: 'runner', isStaff: false, adopt: null });
  });
  it('N9: a staff link opened in the runner view moves to the staff view and keeps the params', () => {
    const thread = academyLens({ ...base, storedView: 'runner', primaryRole: 'academy_coach', roles: ['academy_coach'], linkThread: 'trainee-1' });
    expect(thread).toMatchObject({ view: 'coach', isStaff: true, adopt: 'coach' });
    const funnel = academyLens({ ...base, storedView: 'runner', primaryRole: 'academy_coach', roles: ['academy_coach', 'academy_manager'], linkTab: 'funnel' });
    expect(funnel).toMatchObject({ view: 'manager', isManager: true, adopt: 'manager' });
    // A runner holding no staff role is left alone.
    const runner = academyLens({ ...base, primaryRole: 'runner', roles: ['runner'], linkTab: 'tests' });
    expect(runner).toMatchObject({ view: 'runner', isStaff: false, adopt: null });
  });
  it('N10: a coach who is also a trainee gets his own thread and test', () => {
    const lens = academyLens({ ...base, primaryRole: 'coach', roles: ['coach'], isAcademy: true, traineeLink: true });
    expect(lens).toMatchObject({ isStaff: false, isManager: false });
    // Not an academy member: a trainee link changes nothing.
    const notMember = academyLens({ ...base, primaryRole: 'coach', roles: ['coach'], isAcademy: false, traineeLink: true });
    expect(notMember.isStaff).toBe(true);
  });
  it('an admin defaults to the admin lens, which manages', () => {
    expect(academyLens({ ...base, primaryRole: 'admin', roles: ['admin'] })).toMatchObject({ view: 'admin', isManager: true });
  });
});

describe('BL3 / N3 — the classic home in the trainee\'s own terms', () => {
  const rep = (sec: number): WorkoutStep => ({ order: 2, type: 'interval', durationType: 'distance', durationValue: 800, targetType: 'pace', targetPaceMinPerKm: sec, targetPaceMaxPerKm: sec + 5 } as WorkoutStep);
  const workout = {
    steps: [
      { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'no_target' } as WorkoutStep,
      { order: 2, type: 'interval', durationType: 'distance', durationValue: 0, repeatCount: 6, repeatSteps: [rep(185), { order: 3, type: 'recovery', durationType: 'time', durationValue: 90, targetType: 'no_target' } as WorkoutStep] } as WorkoutStep,
      { order: 4, type: 'cooldown', durationType: 'distance', durationValue: 1500, targetType: 'no_target' } as WorkoutStep,
    ],
  };
  it('restates the club week\'s lane paces to the trainee\'s threshold', () => {
    // Lane reference 203, trainee threshold 281: scale 281/203.
    const scale = 281 / 203;
    const row = traineePlanRow({
      name: 'ראשון', workout, plannedMin: 185, plannedMax: 190, comparedMin: 185, comparedMax: 190,
      basis: { scale, referenceSec: 203 }, thresholdSec: 281,
    });
    expect(row.plannedPace).toBe(Math.round((Math.round(185 * scale) + Math.round(190 * scale)) / 2));
    expect(row.plannedPace).toBeGreaterThan(250);
    expect(row.comparedMin).toBe(Math.round(185 * scale));
    // The title is the session, not the weekday.
    expect(row.name).not.toBe('ראשון');
    expect(row.name).toMatch(/6/);
    const main = row.tiles?.find((t) => t.kind === 'main');
    // The tile prints the restated band's middle, never the lane's 3:05-3:10.
    expect(Math.abs((main?.pace ?? 0) - (185 + 190) / 2 * scale)).toBeLessThanOrEqual(1);
  });
  it('no threshold → no pace at all (no lane pace dressed up as theirs)', () => {
    const row = traineePlanRow({
      name: 'ראשון', workout, plannedMin: 185, plannedMax: 190, comparedMin: 185, comparedMax: 190,
      basis: { scale: 1, referenceSec: 300 }, thresholdSec: null,
    });
    expect(row.plannedPace).toBeNull();
    expect(row.comparedMin).toBeNull();
    expect(row.tiles?.every((t) => t.pace == null)).toBe(true);
  });
  it('their own plan (scale 1) reads as stored', () => {
    const row = traineePlanRow({
      name: 'x', workout, plannedMin: 260, plannedMax: 270, comparedMin: null, comparedMax: null,
      basis: { scale: 1, referenceSec: 281 }, thresholdSec: 281,
    });
    expect(row.plannedPace).toBe(265);
  });
});

describe('BL6 / N5 — a send publishes the row, watch or not', () => {
  it('pushed for the whole week, partial with other days or an undelivered push', () => {
    expect(sentPlanStatus({ otherDays: false })).toBe('pushed');
    expect(sentPlanStatus({ otherDays: true })).toBe('partial');
    expect(sentPlanStatus({ otherDays: false, delivered: false })).toBe('partial');
  });
});

describe('N27 — a coach\'s own entry answers an invitation it slightly predates', () => {
  const open = { id: 'inv', protocol: '30min', createdDay: '2026-10-10', reminderBeforeId: 'b', reminderAfterId: 'a' };
  it('settles for a staff entry dated a few days before the invitation', () => {
    expect(settlementFor(open, { id: 't', protocol: '30min', date: '2026-10-08', approved: true, enteredByStaff: true }).kind).toBe('settle');
  });
  it('still ignores an approval of an old submission, and history from long before', () => {
    expect(settlementFor(open, { id: 't', protocol: '30min', date: '2026-10-08', approved: true }).kind).toBe('none');
    const longAgo = `2026-09-${String(26 - STAFF_EARLY_DAYS).padStart(2, '0')}`;
    expect(settlementFor(open, { id: 't', protocol: '30min', date: longAgo, approved: true, enteredByStaff: true }).kind).toBe('none');
  });
});

describe('BL9 / N8 — permissions', () => {
  const pending = { approved: false, onboarding_status: 'academy_pending' };
  const member = { approved: true, onboarding_status: 'complete' };
  it('a plain academy coach deletes nobody', () => {
    const coach = { isSuperUser: false, canApprove: false, role: 'academy_coach', roles: ['academy_coach'] };
    expect(mayDeleteAthlete(coach, member)).toBe(false);
    expect(mayDeleteAthlete(coach, pending)).toBe(false);
  });
  it('an academy manager deletes only an applicant never let in', () => {
    const mgr = { isSuperUser: false, canApprove: false, role: 'academy_coach', roles: ['academy_coach', 'academy_manager'] };
    expect(mayDeleteAthlete(mgr, pending)).toBe(true);
    expect(mayDeleteAthlete(mgr, member)).toBe(false);
    expect(mayDeleteAthlete(mgr, null)).toBe(false);
  });
  it('admins, approvers and the club coach keep the club roster screen', () => {
    expect(mayDeleteAthlete({ isSuperUser: false, canApprove: false, role: 'admin' }, member)).toBe(true);
    expect(mayDeleteAthlete({ isSuperUser: false, canApprove: true, role: 'runner' }, member)).toBe(true);
    expect(mayDeleteAthlete({ isSuperUser: false, canApprove: false, role: 'coach' }, member)).toBe(true);
  });
  it('only the club\'s staff read club-wide lists unscoped', () => {
    expect(isClubStaff({ isSuperUser: false, athleteId: 'c', role: 'academy_coach', roles: ['academy_coach'] })).toBe(false);
    expect(isClubStaff({ isSuperUser: false, athleteId: 'c', role: 'academy_coach', roles: ['academy_manager'] })).toBe(false);
    expect(isClubStaff({ isSuperUser: false, athleteId: 'c', role: 'coach' })).toBe(true);
    expect(isClubStaff({ isSuperUser: true, athleteId: null })).toBe(true);
  });
});

describe('N13 — a removed trainee reads the club week again', () => {
  it('drops their own rows only when they no longer count', () => {
    const rows = [{ athlete_id: null, id: 'club' }, { athlete_id: 'me', id: 'mine' }];
    expect(withoutOwnRows(rows, true).map((r) => r.id)).toEqual(['club', 'mine']);
    expect(withoutOwnRows(rows, false).map((r) => r.id)).toEqual(['club']);
  });
});

describe('BL8 / N7 — the loop\'s copy', () => {
  const all = (l: 'he' | 'en') => [
    testInviteCopy(l, { coach: 'Sahar Cohen' }), testInviteCopy(l, {}),
    testConfirmedCopy(l, { trainee: 'Noa', slot: 'ה׳ 16.10 · 07:00' }), testConfirmedCopy(l, {}),
    testSubmittedCopy(l, { trainee: 'Noa' }), testApprovedCopy(l),
    testAnalysisCopy(l, { coach: 'Sahar' }), testAnalysisCopy(l, {}),
    bandSetCopy(l, { band: 'דבוקה 4' }), bandSetCopy(l, {}),
    planSavedCopy(l, { days: 1, failedWatch: false }), planSavedCopy(l, { days: 3, failedWatch: true }),
    paceUpdateCopy(l, { faster: true }), paceUpdateCopy(l, { faster: null }),
    missedWeekCopy(l), removedCopy(l),
  ];
  it('never ships an empty or undefined string', () => {
    for (const l of ['he', 'en'] as const) {
      for (const c of all(l)) {
        expect(c.title.trim()).not.toBe('');
        expect(c.body.trim()).not.toBe('');
        expect(`${c.title} ${c.body}`).not.toMatch(/undefined|null/);
      }
    }
  });
  it('every new kind sits in a preference category, so it can be muted', () => {
    for (const kind of Object.values(LOOP_KINDS)) expect(KIND_CATEGORY[kind]).toBeTruthy();
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildPlanWeekStatus,
  countPlanWorkouts,
  resendErrorText,
  undeliveredReason,
  type DispatchRosterEntry,
} from '@/lib/academy/week-status';
import type { DispatchRow } from '@/lib/academy/dispatch';

/**
 * תוכניות → השבוע: three tiles and a list of only the people who need something.
 * The tiles must add up to the roster, and "no plan" must never be a guess.
 */

const WEEK = '2026-10-04';

const entry = (athleteId: string, o: Partial<DispatchRosterEntry> = {}): DispatchRosterEntry => ({
  athleteId, name: athleteId.toUpperCase(), hasGarmin: true, connection: 'healthy' as never, planWorkouts: 4, ...o,
});

const row = (athleteId: string, state: DispatchRow['state'], o: Partial<DispatchRow> = {}): DispatchRow => ({
  athleteId, name: athleteId.toUpperCase(), date: '2026-10-05', state, sentAt: null, confirmedAt: null,
  detail: null, blame: null, connection: 'healthy' as never, actionable: false, ...o,
});

describe('buildPlanWeekStatus', () => {
  it('counts delivered, undelivered and no plan, and they add up to the roster', () => {
    const roster = [entry('a'), entry('b'), entry('c', { planWorkouts: 0 }), entry('d')];
    const rows = [
      row('a', 'on_account'), row('a', 'ran_from_it'),
      row('b', 'on_account'), row('b', 'send_failed', { blame: 'reconnect' }),
      row('d', 'blind'),
    ];
    const s = buildPlanWeekStatus(roster, { rows }, { weekStart: WEEK });
    expect(s).toMatchObject({ total: 4, delivered: 2, undelivered: 1, noPlan: 1 });
    expect(s.delivered + s.undelivered + s.noPlan).toBe(s.total);
    expect(s.needs.map(n => [n.athleteId, n.kind])).toEqual([['b', 'undelivered'], ['c', 'no_plan']]);
  });

  it('a blind slot is delivered — the workout is on their account', () => {
    const s = buildPlanWeekStatus([entry('a')], { rows: [row('a', 'blind')] }, { weekStart: WEEK });
    expect(s.delivered).toBe(1);
    expect(s.needs).toEqual([]);
  });

  it('a plan saved but never pushed is not delivered, and can be sent', () => {
    const s = buildPlanWeekStatus([entry('a')], { rows: [] }, { weekStart: WEEK });
    expect(s.undelivered).toBe(1);
    expect(s.needs[0]).toMatchObject({ reason: 'התוכנית נשמרה ולא נשלחה לשעון', canResend: true });
  });

  it('a trainee with no Garmin cannot be resent to', () => {
    const s = buildPlanWeekStatus([entry('a', { hasGarmin: false })], { rows: [] }, { weekStart: WEEK });
    expect(s.needs[0]).toMatchObject({ kind: 'undelivered', canResend: false });
    expect(s.needs[0].reason).toContain('אין Garmin');
  });

  it('an unknown plan count is never "no plan"', () => {
    const s = buildPlanWeekStatus([entry('a', { planWorkouts: null })], { rows: [] }, { weekStart: WEEK });
    expect(s).toMatchObject({ delivered: 0, undelivered: 0, noPlan: 0 });
    const failed = buildPlanWeekStatus(
      [entry('a', { planWorkouts: null })], { rows: [row('a', 'send_failed', { blame: 'ours' })] }, { weekStart: WEEK },
    );
    expect(failed.undelivered).toBe(1);
  });

  it('says "new" for somebody who joined within two weeks, and names a missing band', () => {
    const roster = [entry('n', { planWorkouts: 0 }), entry('o', { planWorkouts: 0 }), entry('x', { planWorkouts: 0 })];
    const extras = new Map([
      ['n', { academyJoinedOn: '2026-09-30', hasBand: true }],
      ['o', { academyJoinedOn: '2026-01-01', hasBand: true }],
      ['x', { academyJoinedOn: '2026-10-01', hasBand: false }],
    ]);
    const s = buildPlanWeekStatus(roster, { rows: [] }, { weekStart: WEEK, extras });
    const reason = Object.fromEntries(s.needs.map(n => [n.athleteId, n.reason]));
    expect(reason.n).toBe('חדש באקדמיה, עוד אין תוכנית');
    expect(reason.o).toBe('עוד אין תוכנית לשבוע הזה');
    expect(reason.x).toBe('עוד אין דבוקה ועוד אין תוכנית');
  });

  it('works with no report at all (the dispatch read failed)', () => {
    const s = buildPlanWeekStatus([entry('a', { planWorkouts: 0 })], null, { weekStart: WEEK });
    expect(s.noPlan).toBe(1);
  });
});

describe('undeliveredReason', () => {
  it('reads the worst failing slot and counts several', () => {
    const e = entry('a');
    expect(undeliveredReason(e, [row('a', 'send_failed', { blame: 'reconnect' })])).toBe('Garmin לא מחובר, צריך לחבר מחדש');
    expect(undeliveredReason(e, [row('a', 'send_failed', { blame: 'ours' }), row('a', 'unconfirmed')])).toBe('תקלה אצל Garmin או אצלנו · 2 אימונים');
    expect(undeliveredReason(e, [row('a', 'unconfirmed')])).toBe('Garmin קיבל ולא אישר');
    expect(undeliveredReason(e, [row('a', 'not_sent')])).toBe('לא נשלח לשעון');
  });
});

describe('countPlanWorkouts', () => {
  it('counts a flat academy plan and the grouped club shape, and is 0 on junk', () => {
    expect(countPlanWorkouts({ workouts: [{}, {}, {}] })).toBe(3);
    expect(countPlanWorkouts({ group1: { workouts: [{}, {}] } })).toBe(2);
    expect(countPlanWorkouts(null)).toBe(0);
    expect(countPlanWorkouts('x')).toBe(0);
    expect(countPlanWorkouts({})).toBe(0);
  });
});

describe('resendErrorText', () => {
  it('is Hebrew for every code, known or not', () => {
    for (const code of ['garmin-not-connected', 'no-plan', 'not-academy', 'Not your trainee', 'push-failed', null, undefined]) {
      expect(resendErrorText(code)).toMatch(/[֐-׿]/);
    }
  });
});

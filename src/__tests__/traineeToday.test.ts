import { describe, expect, it } from 'vitest';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import {
  bodyChips, buildTraineeToday, homeDayState, invitationSlot, mainWorkoutOf, planUploadCta, showInvitation,
  todayCard, todayForm, todayRace, todayYesterday, type TodayCard, type TodayInput,
} from '@/lib/academy/trainee-today';
import { shiftDate } from '@/lib/academy/load';
import type { TestInvitation } from '@/lib/academy/testInvite';

/**
 * The trainee's home, decided (mockup trainee-experience-v2 phones 1, 1ב, 1ג): workout vs
 * rest vs no plan — the bug where a week WITH a plan said "אין תוכנית" and offered every
 * runner the upload — the evening switch to tomorrow, the card, the invitation rule, the
 * learning states and the body chips.
 */

const pace = (sec: number) => ({ targetType: 'pace' as const, targetPaceMinPerKm: sec, targetPaceMaxPerKm: sec });
const run = (order: number, type: WorkoutStep['type'], metres: number, sec: number): WorkoutStep =>
  ({ order, type, durationType: 'distance', durationValue: metres, ...pace(sec) });
const reps = (order: number, count: number, metres: number, sec: number, rest = 120): WorkoutStep => ({
  order, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: count,
  repeatSteps: [
    { order: 1, type: 'interval', durationType: 'distance', durationValue: metres, ...pace(sec) },
    { order: 2, type: 'recovery', durationType: 'time', durationValue: rest, targetType: 'no_target' },
  ],
});
/** Screen 4's workout at Shahar's paces (threshold 4:12). */
const FIVE_BY_ONE: ParsedWorkout = {
  dayOfWeek: 2, name: '5 × 1 ק״מ', description: 'האחרונה הכי חזקה.',
  steps: [run(1, 'warmup', 2000, 340), reps(2, 5, 1000, 245), run(3, 'cooldown', 2000, 340)],
};
const EASY_SIX: ParsedWorkout = { dayOfWeek: 2, name: 'קל', steps: [run(1, 'active', 6000, 370)] };

const ctx = { date: '2026-10-13', referenceSec: 252, drawAtSec: 252, onWatch: true, expectedLoad: 61.6, done: false };

describe('homeDayState', () => {
  it('a session today is a workout day', () => {
    expect(homeDayState({ hasPlan: true, today: {}, tomorrow: null, isAcademy: true })).toBe('workout');
    expect(homeDayState({ hasPlan: true, today: {}, tomorrow: null, isAcademy: false })).toBe('workout');
  });

  it('a week with a plan and nothing today is a rest day, never "no plan"', () => {
    expect(homeDayState({ hasPlan: true, today: null, tomorrow: null, isAcademy: true })).toBe('rest');
    expect(homeDayState({ hasPlan: true, today: null, tomorrow: null, isAcademy: false })).toBe('rest');
    // Tomorrow's session lives in next week's plan: still a rest day today.
    expect(homeDayState({ hasPlan: false, today: null, tomorrow: {}, isAcademy: true })).toBe('rest');
  });

  it('the club card stretches "today" to tomorrow; the academy home shows the rest day with tomorrow under it', () => {
    expect(homeDayState({ hasPlan: true, today: null, tomorrow: {}, isAcademy: false })).toBe('workout');
    expect(homeDayState({ hasPlan: true, today: null, tomorrow: {}, isAcademy: true })).toBe('rest');
  });

  it('no plan row at all is "no plan"', () => {
    expect(homeDayState({ hasPlan: false, today: null, tomorrow: null, isAcademy: false })).toBe('noPlan');
    expect(homeDayState({ hasPlan: false, today: null, tomorrow: null, isAcademy: true })).toBe('noPlan');
  });
});

describe('planUploadCta', () => {
  it('only staff get the upload button, and only when there is no plan', () => {
    expect(planUploadCta({ dayState: 'noPlan', isStaff: true, isAcademy: false })).toBe(true);
    expect(planUploadCta({ dayState: 'noPlan', isStaff: false, isAcademy: false })).toBe(false);
    expect(planUploadCta({ dayState: 'rest', isStaff: true, isAcademy: false })).toBe(false);
  });

  it('an academy trainee never gets it', () => {
    expect(planUploadCta({ dayState: 'noPlan', isStaff: false, isAcademy: true })).toBe(false);
    expect(planUploadCta({ dayState: 'noPlan', isStaff: true, isAcademy: true })).toBe(false);
  });
});

describe('todayCard', () => {
  it('is screen 1\'s card: the book name, 10.3 km, about 51 minutes, the reps at 4:05', () => {
    const c = todayCard(FIVE_BY_ONE, ctx);
    expect(c.title).toBe('5 × 1 ק״מ');
    expect(c.paceSec).toBe(245);
    expect(c.paceOf).toBe('reps');
    expect(c.kind).toBe('quality');
    expect(Math.round(c.distanceM! / 100) / 10).toBeCloseTo(10.3, 0);
    expect(Math.round(c.durationSec! / 60)).toBeGreaterThanOrEqual(48);
    expect(Math.round(c.durationSec! / 60)).toBeLessThanOrEqual(54);
    expect(c.bar.length).toBeGreaterThan(5);
    expect(c.note).toBe('האחרונה הכי חזקה.');
    expect(c.expectedLoad).toBe(62);
    expect(c.onWatch).toBe(true);
  });

  it('an easy run is an easy day at its own pace', () => {
    const c = todayCard(EASY_SIX, { ...ctx, referenceSec: 300, drawAtSec: 300, expectedLoad: null });
    expect(c.kind).toBe('easy');
    expect(c.paceOf).toBe('run');
    expect(c.paceSec).toBe(370);
    expect(c.expectedLoad).toBeNull();
  });

  it('the session of a double day is its prescribed main part', () => {
    const optional = { ...EASY_SIX, optional: true, name: 'ערב - אופציה' };
    expect(mainWorkoutOf([optional, FIVE_BY_ONE])?.name).toBe('5 × 1 ק״מ');
    expect(mainWorkoutOf([optional])).toBeNull();
  });
});

describe('the invitation', () => {
  const inv: TestInvitation = { id: 'i', athleteId: 'a', protocol: '30min', proposedSlots: ['2026-10-20T03:30:00Z'], status: 'proposed' };
  it('takes the top slot when there is no usable test yet', () => {
    expect(showInvitation({ invitation: inv, slotDate: '2026-10-20', hasUsableTest: false, today: '2026-10-13' })).toBe(true);
  });
  it('with a test, only when it is three days away or less', () => {
    expect(showInvitation({ invitation: inv, slotDate: '2026-10-20', hasUsableTest: true, today: '2026-10-13' })).toBe(false);
    expect(showInvitation({ invitation: inv, slotDate: '2026-10-16', hasUsableTest: true, today: '2026-10-13' })).toBe(true);
  });
  it('no invitation, nothing', () => {
    expect(showInvitation({ invitation: null, slotDate: null, hasUsableTest: false, today: '2026-10-13' })).toBe(false);
  });
  it('names the confirmed slot over the first offered', () => {
    expect(invitationSlot({ proposedSlots: ['a', 'b'], confirmedSlot: 'b' })).toBe('b');
    expect(invitationSlot({ proposedSlots: ['a', 'b'] })).toBe('a');
  });
});

const TODAY = '2026-10-13';
/** A run every day for `days` days before today, about 50 load each. */
const rowsFor = (days: number, source: 'pace' | 'hr' | 'none' = 'pace') =>
  Array.from({ length: days }, (_, i) => ({ activityId: `a${i}`, date: shiftDate(TODAY, -(i + 1)), load: source === 'none' ? null : 50, source }));

describe('todayForm', () => {
  it('19 days of runs is learning: 19 of 42, 23 to go (1ג)', () => {
    expect(todayForm({ rows: rowsFor(19, 'hr'), tests: [], today: TODAY, day: 'easy' })).toEqual({ status: 'learning', daysSeen: 19, daysLeft: 23, cause: 'new' });
  });

  it('a long history gives the number, its band and the sentence for the day', () => {
    const f = todayForm({ rows: rowsFor(120), tests: [{ date: '2026-01-01', thresholdSec: 252 }], today: TODAY, day: 'quality' });
    expect(f.status).toBe('ok');
    if (f.status !== 'ok') return;
    expect(Number.isInteger(f.value)).toBe(true);
    expect(f.sentenceKey).toMatch(new RegExp(`^trainee\\.formSentence\\.${f.band}_quality`));
  });

  it('runs that could not be priced are "not enough data", never a 0', () => {
    expect(todayForm({ rows: rowsFor(60, 'none'), tests: [], today: TODAY, day: 'easy' })).toEqual({ status: 'insufficient' });
  });
});

describe('bodyChips', () => {
  // Mockup 8's 29 earlier mornings (P25 46, P75 50) and this morning's 51.
  const RHR = [47, 48, 46, 45, 51, 49, 47, 46, 44, 48, 50, 52, 47, 46, 45, 48, 51, 46, 47, 45, 50, 44, 52, 48, 46, 51, 49, 50, 48, 51];
  const nights = RHR.map((v, i) => ({ date: shiftDate(TODAY, i - RHR.length + 1), resting_hr: v, sleep_seconds: 26000 }));

  it('this morning\'s resting HR against the 30 before it: 51 is "a bit high", range 46–50', () => {
    const { rhr, sleep } = bodyChips(nights, TODAY);
    expect(rhr).toMatchObject({ value: 51, date: TODAY, verdict: 'bitHigh', range: { lo: 46, hi: 50 }, learning: null });
    expect(sleep?.verdict).toBe('normal');
  });

  it('ten nights before this morning is learning, four more to go (1ג)', () => {
    const { rhr } = bodyChips(nights.slice(-11), TODAY);
    expect(rhr).toMatchObject({ value: 51, verdict: null, range: null, learning: 4 });
  });

  it('a night older than three days is not shown as last night', () => {
    expect(bodyChips(nights.slice(0, 20), TODAY).rhr).toBeNull();
  });
});

describe('todayRace and todayYesterday', () => {
  it('the race: name, days, goal, weeks of build', () => {
    expect(todayRace({ goal: { title: 'מרתון ולנסיה', daysLeft: 54 }, raceName: 'מרתון ולנסיה', raceDate: '2026-12-06', bandGoal: '3:15' }))
      .toEqual({ name: 'מרתון ולנסיה', date: '2026-12-06', daysLeft: 54, goal: '3:15', weeksOfBuild: 7 });
    expect(todayRace({ goal: { title: 'מרתון', daysLeft: null }, raceName: null, raceDate: null, bandGoal: null })).toBeNull();
  });

  it('yesterday\'s run with its ⚡ and how it was priced', () => {
    const rows = [{ activityId: 'y', date: shiftDate(TODAY, -1), load: 31, source: 'hr' as const }];
    expect(todayYesterday({ rows, distances: { y: 5020 }, today: TODAY, title: 'קל 5 ק״מ' }))
      .toEqual({ activityId: 'y', title: 'קל 5 ק״מ', km: 5, load: 31, source: 'hr' });
    expect(todayYesterday({ rows, distances: {}, today: shiftDate(TODAY, 2), title: null })).toBeNull();
  });

  it('a run that could not be priced is still yesterday\'s row, with its km and why (round 2, new3)', () => {
    const rows = [{ activityId: 'y', date: shiftDate(TODAY, -1), load: null, source: 'none' as const }];
    expect(todayYesterday({ rows, distances: { y: 6230 }, avgHr: { y: 149 }, today: TODAY, title: null }))
      .toEqual({ activityId: 'y', title: null, km: 6.2, load: null, source: 'none', noLoad: 'hrLearning' });
    expect(todayYesterday({ rows, distances: { y: 6230 }, today: TODAY, title: null })!.noLoad).toBe('noHr');
    // A priced run the same day carries the row, as before.
    const both = [...rows, { activityId: 'p', date: shiftDate(TODAY, -1), load: 20, source: 'hr' as const }];
    expect(todayYesterday({ rows: both, distances: { y: 6230, p: 3000 }, today: TODAY, title: null })).toMatchObject({ activityId: 'p', load: 20 });
  });
});

describe('buildTraineeToday', () => {
  const card = (date: string, extra: Partial<TodayCard> = {}): TodayCard => ({ ...todayCard(FIVE_BY_ONE, { ...ctx, date }), ...extra });
  const base = (over: Partial<TodayInput> = {}): TodayInput => ({
    today: TODAY,
    evening: false,
    cards: {},
    planWeeks: { '2026-10-11': true },
    weekStartOf: () => '2026-10-11',
    athlete: { id: 'a', name: 'Shahar', gender: 'male' },
    coach: null,
    unread: 0,
    paceUpdate: null,
    invitation: null,
    invitationDate: null,
    hasUsableTest: true,
    loads: rowsFor(120),
    tests: [{ date: '2026-01-01', thresholdSec: 252 }],
    nights: [],
    race: null,
    yesterdayTitle: null,
    distances: {},
    ...over,
  });

  it('a workout today (1)', () => {
    const out = buildTraineeToday(base({ cards: { [TODAY]: card(TODAY) } }));
    expect(out).toMatchObject({ dayState: 'workout', focus: 'today', date: TODAY, next: null });
    expect(out.card?.title).toBe('5 × 1 ק״מ');
    expect(out.yesterday).toBeNull();
  });

  it('a rest day shows tomorrow under it (1ב), and the sentence is the rest day\'s', () => {
    const tomorrow = shiftDate(TODAY, 1);
    const out = buildTraineeToday(base({ cards: { [tomorrow]: card(tomorrow), [shiftDate(TODAY, -1)]: card(shiftDate(TODAY, -1)) } }));
    expect(out).toMatchObject({ dayState: 'rest', card: null, prevKind: 'quality' });
    expect(out.next?.date).toBe(tomorrow);
    expect(out.form.status === 'ok' && out.form.sentenceKey).toMatch(/_rest$/);
  });

  it('the rest day\'s "למחר" form is tomorrow\'s: today\'s 0 load is in it (mockup −9 → −10)', () => {
    const tomorrow = shiftDate(TODAY, 1);
    const rest = buildTraineeToday(base({ cards: { [tomorrow]: card(tomorrow) } }));
    const asOfToday = todayForm({ rows: rowsFor(120), tests: [{ date: '2026-01-01', thresholdSec: 252 }], today: TODAY, day: 'rest' });
    const asOfTomorrow = todayForm({ rows: rowsFor(120), tests: [{ date: '2026-01-01', thresholdSec: 252 }], today: TODAY, day: 'rest', asOf: tomorrow });
    expect(rest.form).toEqual(asOfTomorrow);
    // A day of rest after daily ~50 runs: fatigue falls faster than fitness, so form rises.
    if (asOfToday.status === 'ok' && asOfTomorrow.status === 'ok') expect(asOfTomorrow.value).toBeGreaterThan(asOfToday.value);
  });

  it('after 20:00 the form includes today\'s run and the sentence speaks of tomorrow', () => {
    const tomorrow = shiftDate(TODAY, 1);
    const ran = [...rowsFor(120), { activityId: 'tonight', date: TODAY, load: 120, source: 'pace' as const }];
    const out = buildTraineeToday(base({ evening: true, loads: ran, cards: { [TODAY]: card(TODAY), [tomorrow]: card(tomorrow) } }));
    const morning = buildTraineeToday(base({ loads: ran, cards: { [TODAY]: card(TODAY) } }));
    expect(out.form.status === 'ok' && out.form.sentenceKey).toMatch(/^trainee\.formSentenceTomorrow\./);
    expect(morning.form.status === 'ok' && morning.form.sentenceKey).toMatch(/^trainee\.formSentence\./);
    if (out.form.status === 'ok' && morning.form.status === 'ok') expect(out.form.value).toBeLessThan(morning.form.value);
  });

  it('a week with no plan at all is "no plan"', () => {
    expect(buildTraineeToday(base({ planWeeks: {} })).dayState).toBe('noPlan');
  });

  it('no published plan: the form sentence assumes no rest day (issue 24)', () => {
    const out = buildTraineeToday(base({ planWeeks: {}, evening: true }));
    expect(out.dayState).toBe('noPlan');
    expect(out.form.status === 'ok' && out.form.sentenceKey).toBe('trainee.home.form.noPlanSay');
  });

  it('a broken Garmin feed: no number, and the reason (issue 1)', () => {
    const out = buildTraineeToday(base({
      cards: { [TODAY]: card(TODAY) },
      feed: { run: { kind: 'failed', provider: 'garmin', days: 10 }, night: { kind: 'failed', provider: 'garmin', days: 10 } },
    }));
    expect(out.form).toEqual({ status: 'noFeed', feed: 'failed', provider: 'garmin', days: 10 });
    expect(out.body.missing.rhr).toMatchObject({ reason: 'feed', feed: 'failed' });
  });

  it('runs still waiting to be priced: computing, not a number (issue 4)', () => {
    const out = buildTraineeToday(base({ cards: { [TODAY]: card(TODAY) }, pending: 80 }));
    expect(out.form).toEqual({ status: 'computing', pending: 80 });
  });

  it('from 20:00 the home is about tomorrow', () => {
    const tomorrow = shiftDate(TODAY, 1);
    const out = buildTraineeToday(base({ evening: true, cards: { [TODAY]: card(TODAY), [tomorrow]: card(tomorrow) } }));
    expect(out).toMatchObject({ focus: 'tomorrow', date: tomorrow, dayState: 'workout' });
    expect(out.card?.date).toBe(tomorrow);
  });

  it('a new trainee: learning, the invitation on top, and yesterday\'s HR-estimated run (1ג)', () => {
    const inv: TestInvitation = { id: 'i', athleteId: 'a', protocol: '30min', proposedSlots: ['2026-10-20T03:30:00Z'], status: 'proposed' };
    const out = buildTraineeToday(base({
      cards: { [TODAY]: card(TODAY) },
      loads: rowsFor(19, 'hr'),
      tests: [],
      hasUsableTest: false,
      invitation: inv,
      invitationDate: '2026-10-20',
      distances: { a0: 5000 },
    }));
    expect(out.form).toEqual({ status: 'learning', daysSeen: 19, daysLeft: 23, cause: 'new' });
    expect(out.invitation).toEqual({ slot: '2026-10-20T03:30:00Z', status: 'proposed' });
    expect(out.yesterday).toMatchObject({ load: 50, source: 'hr', km: 5 });
  });
});

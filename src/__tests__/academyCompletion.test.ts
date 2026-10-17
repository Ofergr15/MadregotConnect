import { describe, expect, it } from 'vitest';
import { bandCheck, buildCompletion, completionRow, testGap, type CompletionInput } from '@/lib/academy/completion';
import { shiftDate } from '@/lib/academy/load';
import { askable, testRequestCopy, whoToAsk } from '@/lib/academy/test-request';
import { goalTimeText, hasGoal, parseGoalBody, readGoal } from '@/lib/academy/goal';

/**
 * "השלמת פרטים" (mockup academy-existing-trainees, phone 1): who is missing what. The header
 * counts must add up to the list beneath them, and "ready" must mean exactly what the trainee's
 * own screens mean by "has paces" — a list that called somebody ready while their home still
 * said "צריך טסט" would send the coach away from the one trainee who needs them.
 */

const TODAY = '2026-10-11';
const t30 = (daysAgo: number, over: Record<string, unknown> = {}) => ({
  test_date: shiftDate(TODAY, -daysAgo), protocol: '30min', status: 'approved', duration_sec: 1800, distance_m: 7120, ...over,
});

const person = (over: Partial<CompletionInput> = {}): CompletionInput => ({
  athleteId: 'a', name: 'Shahar Glazner', tests: [t30(27)], bandNumber: 4, coachIds: ['c1'], coachNames: ['Sahar Azar'], hasGoal: true, ...over,
});

describe('completionRow', () => {
  it('a 2000 m waiting for approval is "pending" with "לאשר", and nobody asks for it again', () => {
    const r = completionRow(person({ tests: [{ test_date: shiftDate(TODAY, -1), protocol: '2000m', status: 'pending', duration_sec: 470, distance_m: 2000 }] }), TODAY);
    expect(r).toMatchObject({ test: 'pending', action: 'approve', missing: ['test'] });
    expect(r.chips[0]).toMatchObject({ key: 'test', tone: 'pending' });
    expect(askable(r)).toBe(false);
  });

  it('an approved 30-minute test and a newer 2000 m waiting: still ready, nothing to ask (round 2, issue 2)', () => {
    const r = completionRow(person({ tests: [
      { test_date: shiftDate(TODAY, -1), protocol: '2000m', status: 'pending', duration_sec: 470, distance_m: 2000 },
      t30(27),
    ] }), TODAY);
    expect(r).toMatchObject({ ready: true, test: 'ok', missing: [], chips: [], action: 'complete' });
  });

  it('a long test chip leaves room for every gap, not for what they have (round 2, issue 3: one chip line)', () => {
    const keys = (r: ReturnType<typeof completionRow>) => r.chips.map(c => [c.key, c.tone]);
    // "טסט ישן · מאי" + "דבוקה 4" + "מטרה" wrapped: the band they have is the one left out.
    expect(keys(completionRow(person({ tests: [t30(150)], hasGoal: false }), TODAY))).toEqual([['test', 'missing'], ['goal', 'missing']]);
    expect(keys(completionRow(person({ tests: [{ test_date: shiftDate(TODAY, -5), protocol: '2000m', status: 'approved', duration_sec: 470, distance_m: 2000 }], hasGoal: false }), TODAY)))
      .toEqual([['test', 'missing'], ['goal', 'missing']]);
    expect(keys(completionRow(person({ tests: [t30(2, { status: 'pending' })], hasGoal: false }), TODAY))).toEqual([['test', 'pending'], ['goal', 'missing']]);
    // With only the old test missing, the band still fills the row; a short "טסט" chip keeps three.
    expect(keys(completionRow(person({ tests: [t30(150)] }), TODAY))).toEqual([['test', 'missing'], ['band', 'have']]);
    expect(keys(completionRow(person({ tests: [], hasGoal: false }), TODAY))).toEqual([['test', 'missing'], ['band', 'have'], ['goal', 'missing']]);
    // Gaps are never dropped for the rule: a long test chip with band and coach missing shows all three.
    expect(keys(completionRow(person({ tests: [t30(150)], bandNumber: null, coachIds: [], coachNames: [] }), TODAY)))
      .toEqual([['test', 'missing'], ['band', 'missing'], ['coach', 'missing']]);
  });

  it('ready = an approved 30-minute test, a band and a coach', () => {
    const r = completionRow(person(), TODAY);
    expect(r).toMatchObject({ ready: true, missing: [], incomplete: false, test: 'ok', chips: [] });
  });

  it('Shahar: no test, no goal — band 4 shown as what he has', () => {
    const r = completionRow(person({ tests: [], hasGoal: false }), TODAY);
    expect(r.missing).toEqual(['test']);
    expect(r.ready).toBe(false);
    expect(r.chips.map(c => [c.key, c.tone])).toEqual([['test', 'missing'], ['band', 'have'], ['goal', 'missing']]);
    expect(r.chips[1].bandNumber).toBe(4);
  });

  it('Yoav: no test, no band — has a coach', () => {
    const r = completionRow(person({ tests: [], bandNumber: null }), TODAY);
    expect(r.missing).toEqual(['test', 'band']);
    expect(r.chips.map(c => [c.key, c.tone])).toEqual([['test', 'missing'], ['band', 'missing'], ['coach', 'have']]);
  });

  it('Noa: a test waiting for approval — not ready, and the button is "לאשר"', () => {
    const r = completionRow(person({ tests: [t30(2, { status: 'pending' })] }), TODAY);
    expect(r.test).toBe('pending');
    expect(r.ready).toBe(false);
    expect(r.action).toBe('approve');
    expect(r.chips[0]).toMatchObject({ key: 'test', tone: 'pending' });
  });

  it('Michal: an old test is a gap (the trainee screens say "כדאי טסט חדש" at the same age)', () => {
    const r = completionRow(person({ tests: [t30(150)] }), TODAY);
    expect(r.test).toBe('old');
    expect(r.ready).toBe(false);
    expect(r.chips[0]).toMatchObject({ key: 'test', gap: 'old', date: shiftDate(TODAY, -150) });
    expect(completionRow(person({ tests: [t30(119)] }), TODAY).test).toBe('ok');
  });

  it('a 2000 m only is not a threshold, and an excluded test is not a test', () => {
    expect(completionRow(person({ tests: [t30(5, { protocol: '2000m', duration_sec: 425, distance_m: 2000 })] }), TODAY).test).toBe('otherProtocol');
    expect(completionRow(person({ tests: [t30(5, { excluded_reason: 'flu' })] }), TODAY).test).toBe('none');
  });

  it('the goal is wanted, never required: a goal-only gap is ready but incomplete', () => {
    const r = completionRow(person({ hasGoal: false }), TODAY);
    expect(r).toMatchObject({ ready: true, incomplete: true, missing: [] });
    expect(r.chips.map(c => c.key)).toEqual(['band', 'coach', 'goal']);
  });

  it('a pending test with something else missing opens the form, not the approval', () => {
    expect(completionRow(person({ tests: [t30(2, { status: 'pending' })], coachIds: [] }), TODAY).action).toBe('complete');
  });

  it('never more than three chips', () => {
    const r = completionRow(person({ tests: [], bandNumber: null, coachIds: [], hasGoal: false }), TODAY);
    expect(r.chips).toHaveLength(3);
    expect(r.missing).toEqual(['test', 'band', 'coach']);
  });
});

describe('testGap', () => {
  it('maps the trainee screens\' test state one to one', () => {
    expect(testGap({ kind: 'none' })).toBe('none');
    expect(testGap({ kind: 'pending', date: TODAY })).toBe('pending');
    expect(testGap({ kind: 'ok', date: TODAY, ageDays: 0, old: false })).toBe('ok');
    expect(testGap({ kind: 'ok', date: TODAY, ageDays: 200, old: true })).toBe('old');
  });
});

describe('buildCompletion', () => {
  it('"חסרים" is exactly the list of the not-ready, incomplete first', () => {
    const c = buildCompletion([
      person({ athleteId: '1', name: 'Ready' }),
      person({ athleteId: '2', name: 'Goal only', hasGoal: false }),
      person({ athleteId: '3', name: 'No test', tests: [] }),
      person({ athleteId: '4', name: 'Nothing', tests: [], bandNumber: null, coachIds: [] }),
      person({ athleteId: '5', name: 'Waiting', tests: [t30(1, { status: 'pending' })] }),
    ], TODAY);
    expect(c.summary).toEqual({ total: 5, ready: 2, missing: 3, needTest: 2, pending: 1 });
    expect(c.rows.filter(r => !r.ready)).toHaveLength(c.summary.missing);
    expect(c.rows[0].name).toBe('Nothing');
    expect(c.rows.slice(-2).map(r => r.name)).toEqual(['Goal only', 'Ready']);
  });
});

describe('bandCheck', () => {
  const bands = [
    { id: 'b4', bandNumber: 4, thresholdPaceSec: 250 },
    { id: 'b5', bandNumber: 5, thresholdPaceSec: 285 },
    { id: 'b6', bandNumber: 6, thresholdPaceSec: null },
  ];
  it('in range when their own band is the nearest', () => {
    expect(bandCheck(253, 'b4', bands)).toEqual({ kind: 'inRange', bandNumber: 4 });
  });
  it('says which band is nearer when it is not theirs', () => {
    expect(bandCheck(283, 'b4', bands)).toEqual({ kind: 'nearer', bandNumber: 4, nearerNumber: 5 });
  });
  it('a band with no threshold recorded has nothing to check against — said, not guessed', () => {
    expect(bandCheck(253, 'b6', bands)).toEqual({ kind: 'noRanges', bandNumber: 6 });
    expect(bandCheck(253, 'b4', [{ id: 'b4', bandNumber: 4 }])).toEqual({ kind: 'noRanges', bandNumber: 4 });
  });
  it('no band, or no pace (a 2000 m)', () => {
    expect(bandCheck(253, null, bands)).toEqual({ kind: 'noBand' });
    expect(bandCheck(null, 'b4', bands)).toEqual({ kind: 'noPace' });
  });
});

describe('whoToAsk ("לבקש מכולם", once)', () => {
  const rows = [
    { athleteId: 'none', test: 'none' as const, testDate: null },
    { athleteId: 'old', test: 'old' as const, testDate: '2026-05-01' },
    { athleteId: 'two', test: 'otherProtocol' as const, testDate: '2026-09-01' },
    { athleteId: 'wait', test: 'pending' as const, testDate: '2026-10-09' },
    { athleteId: 'ok', test: 'ok' as const, testDate: '2026-09-14' },
  ];
  it('asks everyone without a usable test; never someone waiting for approval or ready', () => {
    expect(whoToAsk(rows, [])).toEqual({ ask: ['none', 'old', 'two'], already: [] });
    expect(askable({ test: 'pending' })).toBe(false);
  });
  it('a second tap asks nobody twice', () => {
    const prior = whoToAsk(rows, []).ask.map(athleteId => ({ athleteId, sentAt: '2026-10-11T08:00:00Z' }));
    expect(whoToAsk(rows, prior)).toEqual({ ask: [], already: ['none', 'old', 'two'] });
  });
  it('a request from before their newest test does not stand: the test went stale again', () => {
    const prior = [{ athleteId: 'old', sentAt: '2026-04-01T08:00:00Z' }, { athleteId: 'old', sentAt: '2026-03-01T08:00:00Z' }];
    expect(whoToAsk(rows, prior).ask).toContain('old');
  });
});

describe('testRequestCopy', () => {
  it('agrees with the coach, and falls back when the gender is unknown', () => {
    expect(testRequestCopy('he', { coach: 'Sahar Azar', coachGender: 'male' }).body).toMatch(/^Sahar מבקש: /);
    expect(testRequestCopy('he', { coach: 'Dana', coachGender: 'female' }).body).toMatch(/^Dana מבקשת: /);
    expect(testRequestCopy('he', { coach: null }).title).toBe('🎯 חסר לנו הטסט האחרון שלך');
    expect(testRequestCopy('en', { coach: 'Dana' }).body).toMatch(/^Dana asks: /);
  });
});

describe('goal', () => {
  it('reads either case, and drops what is not readable', () => {
    expect(readGoal({ goal_type: 'full', target_race: ' טבריה ', target_race_date: '2027-01-08', goal_time_sec: 11700 }))
      .toMatchObject({ goalType: 'full', targetRace: 'טבריה', targetRaceDate: '2027-01-08', goalTimeSec: 11700 });
    expect(readGoal({ goalType: 'ultra', goalTimeSec: 30 })).toMatchObject({ goalType: null, targetRace: null, targetRaceDate: null, goalTimeSec: null, distanceKm: null });
    expect(hasGoal(readGoal(null))).toBe(false);
  });
  it('a field that was sent but is unreadable is an issue, not a silent drop', () => {
    expect(parseGoalBody({ goalType: 'full', targetRaceDate: 'tomorrow', goalTimeSec: 5 }).issues).toEqual(['targetRaceDate', 'goalTimeSec']);
    expect(parseGoalBody({ goalType: null, targetRace: '' }).issues).toEqual([]);
  });
  it('goal times read as a person says them', () => {
    expect(goalTimeText(11700)).toBe('3:15:00');
    expect(goalTimeText(2910)).toBe('48:30');
  });
});

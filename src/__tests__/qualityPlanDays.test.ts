import { describe, it, expect } from 'vitest';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { parsePlanDays, weekQuality } from '@/lib/quality-session/plan-days';

const step = (s: Partial<WorkoutStep>) => ({ targetType: 'no_target', durationType: 'time', durationValue: 60, ...s }) as WorkoutStep;
const set = (n: number, m: number, pace: number) => step({
  type: 'interval', repeatCount: n, durationValue: undefined,
  repeatSteps: [step({ type: 'interval', durationType: 'distance', durationValue: m, targetType: 'pace', targetPaceMinPerKm: pace }), step({ type: 'rest', durationValue: 90 })],
});
const w = (o: Partial<ParsedWorkout>) => ({ name: '', steps: [], partKind: 'single', ...o }) as ParsedWorkout;

// The week of 2026-10-04 as parsed: Tuesday is the club's biggest session of the
// week (12 × 1 km), saved optional because its note offers evening strength.
const sunday = w({ dayOfWeek: 0, name: 'יום ראשון', steps: [step({ type: 'warmup', durationValue: 900 }), set(10, 400, 200), set(10, 400, 200)] });
const tuesday = w({
  dayOfWeek: 2, name: 'שלישי', description: 'אופציה לאימון כוח בערב', optional: true,
  steps: [step({ type: 'warmup', durationType: 'distance', durationValue: 5000 }), set(3, 300, 195), set(12, 1000, 190), step({ type: 'active', durationType: 'distance', durationValue: 1000 })],
});
const monday = [w({ dayOfWeek: 1, name: 'שני', partKind: 'morning', steps: [step({ type: 'active', durationType: 'distance', durationValue: 12000 })] }),
  w({ dayOfWeek: 1, name: 'שני - ערב אופציה', partKind: 'evening', optional: true, steps: [set(6, 200, 200)] })];
const week = [sunday, ...monday, tuesday];

const db = (plan: ParsedWorkout[], settings: Record<string, string>) => ({
  from: (t: string) => {
    let key = '';
    const q: Record<string, unknown> = {};
    for (const k of ['select', 'order', 'limit']) q[k] = () => q;
    q.eq = (col: string, v: string) => { if (col === 'key') key = v; return q; };
    q.maybeSingle = async () => ({
      data: t === 'app_settings' ? (settings[key] ? { value: settings[key] } : null) : { parsed_workouts: { group1: { workouts: plan } } },
      error: null,
    });
    return q;
  },
});

describe('the week\'s quality days', () => {
  it('detects Sunday, and suggests the optional Tuesday instead of dropping it', () => {
    expect(weekQuality([week], undefined)).toEqual({ auto: [0], suggested: [2], days: [0], manual: false });
  });

  it('an evening extra is never a quality day or a suggestion', () => {
    expect(weekQuality([monday], undefined)).toMatchObject({ auto: [], suggested: [] });
  });

  it('a pick replaces the detection, including turning a detected day off', () => {
    expect(weekQuality([week], [2])).toEqual({ auto: [0], suggested: [2], days: [2], manual: true });
    expect(weekQuality([week], [])).toMatchObject({ days: [], manual: true });
  });

  it('reads only well-formed picks', () => {
    expect(parsePlanDays('{"2026-10-04":[2,0,2,9,"x"],"bad":[1]}')).toEqual({ '2026-10-04': [0, 2] });
    expect(parsePlanDays('["2026-10-02"]')).toEqual({});
    expect(parsePlanDays(null)).toEqual({});
  });

  it('the push and the screen follow the pick', async () => {
    const { loadQualityWorkout, planTargets } = await import('@/lib/quality-session/server');
    const tue = '2026-10-06', sun = '2026-10-04';
    // Not picked: today's behaviour, Tuesday is lost to its note.
    expect(await loadQualityWorkout(db(week, {}) as never, tue)).toBeNull();
    expect(await loadQualityWorkout(db(week, {}) as never, sun)).toMatchObject({ type: 'intervals' });
    const picked = { quality_plan_days: JSON.stringify({ [sun]: [2] }) };
    expect(await loadQualityWorkout(db(week, picked) as never, tue)).toEqual({ name: 'שלישי', type: 'intervals' });
    // Sunday was taken off by the pick.
    expect(await loadQualityWorkout(db(week, picked) as never, sun)).toBeNull();
    // A pick for another week changes nothing here.
    expect(await loadQualityWorkout(db(week, { quality_plan_days: '{"2026-09-27":[2]}' }) as never, tue)).toBeNull();
    // A special day still counts inside a picked week.
    expect(await loadQualityWorkout(db(week, { ...picked, quality_special_days: JSON.stringify([sun]) }) as never, sun)).toMatchObject({ special: true });
    // The marked optional morning brings its targets, so the scatter has its line.
    const stored = { group1: { workouts: week } };
    expect(planTargets(stored, 2)[1]).toBeUndefined();
    expect(planTargets(stored, 2, true)[1]).toHaveLength(15);
  });
});

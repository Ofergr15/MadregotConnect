import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedWorkout } from '@/lib/ai/types';
import { decideRecipients, hasWorkoutOn, mergeDay } from '@/lib/academy/day-send';
import { effortFromPace, effortFromZone, toLibrarySteps, type BookStep } from '@/lib/academy/book-steps';
import { resolveLibraryWorkout } from '@/lib/academy/library';
import { applyPaceAdjust } from '@/lib/academy/coach-tools';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';
import { mainPace } from '@/components/academy/book/DayPlanner';

// ── The pure half ─────────────────────────────────────────────────────────────────────

describe('decideRecipients', () => {
  const base = { isPrimary: false, thresholdSec: 270, hasWorkoutThatDay: false, isAcademy: true, active: true };

  it('sends to a tested trainee with a free day', () => {
    expect(decideRecipients([{ ...base, id: 'a' }])).toEqual([{ id: 'a', action: 'send', thresholdSec: 270 }]);
  });

  it('never sends without a test', () => {
    expect(decideRecipients([{ ...base, id: 'a', thresholdSec: null }])).toEqual([{ id: 'a', action: 'skip', reason: 'no-test' }]);
  });

  it('skips someone who already has a workout that day — unless they are the one being planned', () => {
    expect(decideRecipients([{ ...base, id: 'a', hasWorkoutThatDay: true }])[0]).toMatchObject({ action: 'skip', reason: 'has-workout' });
    expect(decideRecipients([{ ...base, id: 'a', hasWorkoutThatDay: true, isPrimary: true }])[0]).toMatchObject({ action: 'send' });
  });

  it('skips anyone outside the academy', () => {
    expect(decideRecipients([{ ...base, id: 'a', isAcademy: false }])[0]).toMatchObject({ action: 'skip', reason: 'not-academy' });
  });
});

describe('mergeDay', () => {
  const w = (day: number, name: string, extra: Partial<ParsedWorkout> = {}): ParsedWorkout => ({
    dayOfWeek: day, name, steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 5000, targetType: 'no_target' }], ...extra,
  });

  it('replaces every part on the day and keeps the rest of the week', () => {
    const week = [w(4, 'thu'), w(2, 'tue am', { partIndex: 1, partCount: 2 }), w(2, 'tue pm', { partIndex: 2, partCount: 2 }), w(0, 'sun')];
    const merged = mergeDay(week, w(2, 'new', { partIndex: 2, workoutKey: 'old-key' }));
    expect(merged.map(x => x.name)).toEqual(['sun', 'new', 'thu']);
    expect(merged[1].partIndex).toBeUndefined();
    expect(merged[1].workoutKey).toBeUndefined();
  });

  it('knows when a day is taken', () => {
    expect(hasWorkoutOn([w(2, 'x')], 2)).toBe(true);
    expect(hasWorkoutOn([w(2, 'x')], 3)).toBe(false);
    expect(hasWorkoutOn([{ ...w(2, 'x'), steps: [] }], 2)).toBe(false);
  });
});

// ── The route ─────────────────────────────────────────────────────────────────────────

const access = vi.fn();
vi.mock('@/lib/academy/pairing-server', () => ({
  requireTraineeAccess: (_req: Request, id: string) => access(id),
  visibleTraineeIds: async () => null,
}));

const state = {
  trainees: [] as Array<{ id: string; name: string; isAcademy: boolean; active: boolean; bandNumber: number | null; hasGarmin: boolean }>,
  thresholds: {} as Record<string, number | null>,
  weeks: {} as Record<string, { planId: string | null; workouts: ParsedWorkout[] }>,
};
vi.mock('@/lib/academy/book-server', () => ({
  loadTrainees: async (_s: unknown, ids: string[]) => state.trainees.filter(t => ids.includes(t.id)),
  loadThresholds: async (_s: unknown, ids: string[]) => Object.fromEntries(ids.map(id => [id, state.thresholds[id] ?? null])),
  loadTraineeWeeks: async (_s: unknown, ids: string[]) => Object.fromEntries(ids.map(id => [id, state.weeks[id] ?? { planId: null, workouts: [] }])),
  loadClubWeek: async () => null,
  loadLaneReferences: async () => ({ 1: 203, 2: 209, 3: 223 }),
  allAcademyTraineeIds: async () => state.trainees.map(t => t.id),
}));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: async () => ({ paceAlerts: true }) }));
vi.mock('@/lib/plans/cache', () => ({ revalidateWeeklyPlans: () => {} }));

const pushes: Array<{ athleteId: string; workouts: ParsedWorkout[]; planId: string | null; paceTarget: boolean }> = [];
vi.mock('@/lib/garmin/push-week', () => ({
  pushWeekToAthlete: async (args: { athlete: { id: string }; plannedWorkouts: ParsedWorkout[]; planId: string | null; paceTarget: boolean }) => {
    pushes.push({ athleteId: args.athlete.id, workouts: args.plannedWorkouts, planId: args.planId, paceTarget: args.paceTarget });
    return { athleteId: args.athlete.id, athleteName: '', status: 'success' };
  },
}));

type Row = Record<string, any>;
const tables: { decisions: { data: Row[] | null; error: unknown }; tests: Row[] } = { decisions: { data: [], error: null }, tests: [] };
const writes: Array<{ table: string; op: string; row: Row; id?: unknown }> = [];
const tokens: Row[] = [];
function query(table: string) {
  let op = 'select';
  let row: Row = {};
  let id: unknown;
  const q: any = {
    select: () => q, in: () => q, eq: (_c: string, v: unknown) => { id = v; return q; }, is: () => q, order: () => q,
    insert: (r: Row) => { op = 'insert'; row = r; return q; },
    update: (r: Row) => { op = 'update'; row = r; return q; },
    single: async () => {
      writes.push({ table, op, row, id });
      return { data: { id: op === 'insert' ? `new-${writes.length}` : id }, error: null };
    },
    maybeSingle: async () => ({ data: table === 'academy_workout_library' ? { use_count: 3 } : null, error: null }),
    then: (ok: (v: unknown) => unknown) => {
      if (op !== 'select') writes.push({ table, op, row, id });
      const answer = table === 'athletes' && op === 'select' ? { data: tokens, error: null }
        // The coach tools' reads (migration 141 and the tests it is keyed to).
        : table === 'academy_coach_decisions' ? tables.decisions
          : table === 'academy_tests' && op === 'select' ? { data: tables.tests, error: null }
            : { data: [], error: null };
      return Promise.resolve(answer).then(ok);
    },
  };
  return q;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => query(t) }) }));

const { POST } = await import('@/app/api/academy/day-plan/route');

const model: BookStep[] = [
  { kind: 'run', role: 'warmup', length: { measure: 'distance', value: 2000 }, effort: effortFromZone('easy') },
  { kind: 'reps', count: 5, work: { measure: 'distance', value: 1000 }, effort: effortFromPace(245, 270), rest: { length: { measure: 'time', value: 120 }, mode: 'jog' } },
];

function post(body: unknown) {
  return POST(new Request('http://x/api/academy/day-plan', { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/academy/day-plan', () => {
  beforeEach(() => {
    writes.length = 0;
    pushes.length = 0;
    tokens.length = 0;
    access.mockImplementation(async () => ({ denied: null, caller: { athleteId: 'coach', isSuperUser: false }, pair: null }));
    state.trainees = [
      { id: 'shahar', name: 'Shahar', isAcademy: true, active: true, bandNumber: 4, hasGarmin: true },
      { id: 'yoav', name: 'Yoav', isAcademy: true, active: true, bandNumber: 5, hasGarmin: false },
      { id: 'alon', name: 'Alon', isAcademy: true, active: true, bandNumber: 5, hasGarmin: true },
      { id: 'noa', name: 'Noa', isAcademy: true, active: true, bandNumber: 6, hasGarmin: true },
    ];
    state.thresholds = { shahar: 270, yoav: 300, alon: 280, noa: null };
    state.weeks = {
      shahar: { planId: 'plan-s', workouts: [{ dayOfWeek: 0, name: 'sun', steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 8000, targetType: 'no_target' }] }] },
      alon: { planId: 'plan-a', workouts: [{ dayOfWeek: 2, name: 'his', steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 8000, targetType: 'no_target' }] }] },
    };
    tokens.push({ id: 'shahar', garmin_auth: { token: 'x' }, is_academy: true });
    tables.decisions = { data: [], error: null };
    tables.tests = [];
  });

  it('refuses absolute paces in the body', async () => {
    const steps = [{ order: 1, type: 'active', durationType: 'distance', durationValue: 5000, targetType: 'pace', targetPaceMinPerKm: 245 }];
    const res = await post({ date: '2026-10-13', recipients: ['shahar'], workout: { name: 'x', steps } });
    expect(res.status).toBe(400);
  });

  it('each recipient gets their own pace, skipped people are skipped, and only that day goes to the watch', async () => {
    const res = await post({
      date: '2026-10-13', recipients: ['shahar', 'yoav', 'alon', 'noa'], entryId: 'entry-1',
      workout: { name: '5 × 1 ק״מ', notes: null, steps: toLibrarySteps(model) },
    });
    const body = await res.json();
    expect(body.results.map((r: any) => [r.athleteId, r.status, r.reason ?? null])).toEqual([
      ['shahar', 'sent', null],
      ['yoav', 'saved', null],
      ['alon', 'skipped', 'has-workout'],
      ['noa', 'skipped', 'no-test'],
    ]);

    // Shahar's week row is UPDATED with Sunday kept and Tuesday added.
    const shaharWrite = writes.find(w => w.table === 'weekly_plans' && w.op === 'update' && w.id === 'plan-s')!;
    expect(shaharWrite.row.parsed_workouts.workouts.map((w: ParsedWorkout) => w.dayOfWeek)).toEqual([0, 2]);
    // Yoav had no row: one is inserted for him.
    const yoavWrite = writes.find(w => w.table === 'weekly_plans' && w.op === 'insert')!;
    expect(yoavWrite.row).toMatchObject({ athlete_id: 'yoav', week_start_date: '2026-10-11', status: 'draft' });

    // The pace each got is from THEIR threshold: Shahar 4:05, Yoav 4:32.
    const repOf = (workouts: ParsedWorkout[]) => workouts.find(w => w.dayOfWeek === 2)!.steps[1].repeatSteps![0];
    const shaharRep = repOf(shaharWrite.row.parsed_workouts.workouts);
    const yoavRep = repOf(yoavWrite.row.parsed_workouts.workouts);
    expect(Math.round((shaharRep.targetPaceMinPerKm! + shaharRep.targetPaceMaxPerKm!) / 2)).toBe(245);
    // (The band's arithmetic middle is within a second of its pace-at-the-middle-percentage.)
    expect(Math.abs((yoavRep.targetPaceMinPerKm! + yoavRep.targetPaceMaxPerKm!) / 2 - 272)).toBeLessThanOrEqual(1);

    // Only Shahar has Garmin; only Tuesday is pushed, against his plan row.
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ athleteId: 'shahar', planId: 'plan-s', paceTarget: true });
    expect(pushes[0].workouts.map(w => w.dayOfWeek)).toEqual([2]);

    // Alon's week is untouched.
    expect(writes.some(w => w.id === 'plan-a')).toBe(false);
    // The entry is counted once per trainee who got it.
    expect(writes.find(w => w.table === 'academy_workout_library')?.row.use_count).toBe(5);
  });

  it('a trainee the coach does not coach is not written to', async () => {
    access.mockImplementation(async (id: string) => (id === 'yoav'
      ? { denied: new Response('no', { status: 403 }), caller: { athleteId: 'coach' }, pair: null }
      : { denied: null, caller: { athleteId: 'coach', isSuperUser: false }, pair: null }));
    const res = await post({ date: '2026-10-13', recipients: ['shahar', 'yoav'], workout: { name: 'x', steps: toLibrarySteps(model) } });
    const body = await res.json();
    expect(body.results.find((r: any) => r.athleteId === 'yoav')).toMatchObject({ status: 'skipped', reason: 'not-yours' });
    expect(writes.some(w => w.row?.athlete_id === 'yoav')).toBe(false);
  });

  it('the primary trainee replaces their own day', async () => {
    const res = await post({ date: '2026-10-13', recipients: ['alon'], workout: { name: 'x', steps: toLibrarySteps(model) } });
    const body = await res.json();
    // No Garmin token in this fixture for Alon: saved into his plan, not pushed.
    expect(body.results[0]).toMatchObject({ athleteId: 'alon', status: 'saved' });
    const write = writes.find(w => w.id === 'plan-a')!;
    expect(write.row.parsed_workouts.workouts).toHaveLength(1);
    expect(write.row.parsed_workouts.workouts[0].name).toBe('x');
  });

  // ── The coach's pace update (coach tools, migration 141) ──
  const update = (changes: Record<string, number>, weekStart = '2026-10-11') => {
    tables.tests = [{ athlete_id: 'shahar', test_date: '2026-09-01', duration_sec: 1800, distance_m: 6667, excluded_reason: null, status: 'approved' }];
    tables.decisions = { data: [{ athlete_id: 'shahar', kind: 'pace', action: 'apply', basis_test_date: '2026-09-01', week_start: weekStart, changes, created_at: '2026-10-10T08:00:00Z', coach: { name: 'Sahar' } }], error: null };
  };
  const shaharRep = () => {
    const w = writes.find(x => x.table === 'weekly_plans' && x.op === 'update' && x.id === 'plan-s')!;
    const tue = (w.row.parsed_workouts.workouts as ParsedWorkout[]).find(d => d.dayOfWeek === 2)!;
    return { tue, rep: tue.steps[1].repeatSteps![0] };
  };

  it('sends at the pace update in force: the pace the screen shows is the pace stored, with the marker', async () => {
    update({ reps: -7 });
    await post({ date: '2026-10-13', recipients: ['shahar'], workout: { name: '5 × 1 ק״מ', notes: null, steps: toLibrarySteps(model) } });
    const { tue, rep } = shaharRep();
    const sent = Math.round((rep.targetPaceMinPerKm! + rep.targetPaceMaxPerKm!) / 2);
    expect(sent).toBe(238);
    // The adjust screen and the send screen draw the same number.
    expect(mainPace(model, 270, { reps: -7 })!.sec).toBe(sent);
    expect(tue.paceAdjust).toEqual({ reps: -7 });
    // The warmup is easy and stays where the test puts it.
    expect(tue.steps[0].targetPaceMinPerKm).toBe(resolveLibraryWorkout({ name: 'x', notes: null, steps: toLibrarySteps(model) }, { thresholdPaceSec: 270, dayOfWeek: 2 })!.steps[0].targetPaceMinPerKm);
    // A later update moves it by the difference only, never twice.
    expect(applyPaceAdjust(tue, 270, { reps: -7 })).toBe(tue);
    expect(applyPaceAdjust(tue, 270, { reps: -10 }).steps[1].repeatSteps![0].targetPaceMinPerKm).toBe(rep.targetPaceMinPerKm! - 3);
  });

  it('an update that applies from a later week does not touch this one', async () => {
    update({ reps: -7 }, '2026-10-18');
    await post({ date: '2026-10-13', recipients: ['shahar'], workout: { name: 'x', notes: null, steps: toLibrarySteps(model) } });
    const { tue, rep } = shaharRep();
    expect(Math.round((rep.targetPaceMinPerKm! + rep.targetPaceMaxPerKm!) / 2)).toBe(245);
    expect(tue.paceAdjust).toBeUndefined();
  });

  it('without 141 the week written is byte-identical to the book without the coach tools', async () => {
    tables.decisions = { data: null, error: { code: '42P01', message: 'relation "academy_coach_decisions" does not exist' } };
    tables.tests = [{ athlete_id: 'shahar', test_date: '2026-09-01', duration_sec: 1800, distance_m: 6667, excluded_reason: null, status: 'approved' }];
    const steps = toLibrarySteps(model);
    await post({ date: '2026-10-13', recipients: ['shahar'], workout: { name: '5 × 1 ק״מ', notes: null, steps } });
    const w = writes.find(x => x.table === 'weekly_plans' && x.op === 'update' && x.id === 'plan-s')!;
    const expected = normalizeParsedWorkouts({
      workouts: mergeDay(state.weeks.shahar.workouts, resolveLibraryWorkout({ name: '5 × 1 ק״מ', notes: null, steps }, { thresholdPaceSec: 270, dayOfWeek: 2 })!),
    });
    expect(JSON.stringify(w.row.parsed_workouts)).toBe(JSON.stringify(expected));
  });
});

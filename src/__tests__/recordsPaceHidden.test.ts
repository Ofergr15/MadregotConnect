import { describe, expect, it, vi, beforeEach } from 'vitest';

// Owner decision 2026-11-23: a runner who hides pace (athletes.default_hidden_fields ∋
// 'pace') hides their record TIMES from teammates — a record is pace at a coarser grain.
// The runner and staff keep everything; ?as=member is masked; a failed read masks.
const ME = '11111111-1111-1111-1111-111111111111';
const MATE = '22222222-2222-2222-2222-222222222222';
let caller = { athleteId: MATE, isStaff: false, isSuperUser: false, role: 'runner' };
const acts = [
  { id: 'r5', activity_name: '5K', activity_type: 'running', start_time: '2026-11-01T07:00:00', distance: 5000, duration: 1200 },
];
let athleteRow: { data: unknown; error: unknown } = { data: { default_hidden_fields: ['pace'] }, error: null };

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: null, caller }),
  mayActFor: (c: typeof caller, t: string) => c.isStaff || c.isSuperUser || c.athleteId === t,
}));
vi.mock('@/lib/athletes/test-accounts', () => ({ hiddenFromCaller: async () => false }));
vi.mock('@/lib/wellness/read', () => ({ readWellnessNights: async () => [] }));
vi.mock('@/lib/supabase/paginate', () => ({ fetchAllRows: async () => acts }));
vi.mock('@/lib/athletes/week-pref', () => ({ readWeekStartDay: async () => 1 }));
vi.mock('@/lib/prs/attach-laps', () => ({
  loadPrLaps: async () => new Map(), applyPrLaps: (x: unknown) => x, attachLapsForPrs: async (_d: unknown, _i: unknown, x: unknown) => x,
}));
vi.mock('@/lib/prs/overrides-store', () => ({ readPrOverrides: async () => [] }));
vi.mock('@/lib/supabase/server', () => {
  const mk = (table: string): any => new Proxy({}, {
    get: (_t, k) => (k === 'then'
      ? (r: (v: unknown) => void) => r(table === 'athletes' ? athleteRow : { data: [], error: null })
      : () => mk(table)),
  });
  return { createServerClient: () => ({ from: (t: string) => mk(t) }) };
});

const stats = (await import('@/app/api/athletes/[id]/stats/route')).GET;
const runRecords = (await import('@/app/api/athletes/[id]/records/run/[activityId]/route')).GET;
const { athleteHidesPace, maskRecordTime } = await import('@/lib/records/pace-privacy');

const getStats = async (qs = '') =>
  (await stats(new Request(`https://x.test/api/athletes/${ME}/stats${qs}`), { params: Promise.resolve({ id: ME }) } as never)).json();
const getRun = async () =>
  (await runRecords(new Request(`https://x.test/api/athletes/${ME}/records/run/r5`), { params: Promise.resolve({ id: ME, activityId: 'r5' }) } as never)).json();
const fiveK = (b: any) => b.prs.find((p: any) => p.key === '5k');

beforeEach(() => {
  caller = { athleteId: MATE, isStaff: false, isSuperUser: false, role: 'runner' };
  athleteRow = { data: { default_hidden_fields: ['pace'] }, error: null };
});

describe('GET /api/athletes/[id]/stats — record times of a pace-hider', () => {
  it('a teammate gets null times, no history, no year bests, flagged', async () => {
    const b = await getStats();
    expect(fiveK(b)).toMatchObject({ seconds: null, paceHidden: true, date: null, activityId: null, meters: 5000 });
    expect(b.prsPaceHidden).toBe(true);
    expect(b.prHistory['5k']).toEqual([]);
    expect(b.prYearBests['5k']).toBeNull();
  });

  it('self and staff see the times', async () => {
    for (const c of [{ athleteId: ME, isStaff: false }, { athleteId: 'staff', isStaff: true }]) {
      caller = { ...caller, ...c };
      const b = await getStats();
      expect(fiveK(b).seconds).toBe(1200);
      expect(b.prHistory['5k'].length).toBeGreaterThan(0);
      expect(b.prsPaceHidden).toBeUndefined();
    }
  });

  it('?as=member on own stats is masked', async () => {
    caller = { ...caller, athleteId: ME };
    expect(fiveK(await getStats('?as=member')).seconds).toBeNull();
  });

  it('a teammate of a runner who does NOT hide pace sees the times', async () => {
    athleteRow = { data: { default_hidden_fields: ['calories'] }, error: null };
    expect(fiveK(await getStats()).seconds).toBe(1200);
  });

  it('a failed read of the setting masks', async () => {
    athleteRow = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect(fiveK(await getStats()).seconds).toBeNull();
  });
});

describe('GET /api/athletes/[id]/records/run/[activityId] — record times of a pace-hider', () => {
  it('a teammate gets the distance with a null time', async () => {
    const b = await getRun();
    expect(b.paceHidden).toBe(true);
    expect(b.records[0]).toMatchObject({ bucket: '5k', seconds: null, instead: null, paceHidden: true });
  });

  it('self and staff see the time', async () => {
    for (const c of [{ athleteId: ME, isStaff: false }, { athleteId: 'staff', isStaff: true }]) {
      caller = { ...caller, ...c };
      const b = await getRun();
      expect(b.records.find((r: any) => r.bucket === '5k').seconds).toBe(1200);
    }
  });

  it('a failed read of the setting masks', async () => {
    athleteRow = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect((await getRun()).records[0].seconds).toBeNull();
  });
});

describe('athleteHidesPace / maskRecordTime', () => {
  const db = (r: unknown): any => ({
    from: () => new Proxy({}, { get: (_t, k) => (k === 'maybeSingle' ? async () => r : () => db(r).from()) }),
  });
  it('fails closed on error, missing row and throw; open only on a missing column', async () => {
    expect(await athleteHidesPace(db({ data: null, error: { code: 'XX000' } }), ME)).toBe(true);
    expect(await athleteHidesPace(db({ data: null, error: null }), ME)).toBe(true);
    expect(await athleteHidesPace({ from: () => { throw new Error('x'); } } as never, ME)).toBe(true);
    expect(await athleteHidesPace(db({ data: null, error: { code: '42703' } }), ME)).toBe(false);
    expect(await athleteHidesPace(db({ data: { default_hidden_fields: ['pace'] }, error: null }), ME)).toBe(true);
    expect(await athleteHidesPace(db({ data: { default_hidden_fields: [] }, error: null }), ME)).toBe(false);
  });
  it('keeps the label and distance, drops the time and its run', () => {
    expect(maskRecordTime({ key: '5k', label: '5K', meters: 5000, seconds: 1200, date: '2026-11-01', activityId: 'r5', activityName: 'x', fromSegment: true, sourceMeters: 5000 }))
      .toEqual({ key: '5k', label: '5K', meters: 5000, seconds: null, date: null, activityId: null, activityName: null, fromSegment: false, sourceMeters: null, paceHidden: true });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { matchesScope, paceAtHrOf } from '@/lib/run-analysis/similar';

/**
 * GET /api/activities/similar through the REAL handler and the REAL workout reader; only
 * I/O is mocked. Pins: self-or-staff gate (teammate 403), pace hidden → empty + masked,
 * heart rate hidden → HR null, scope filters, oldest→newest with today last, cap of 8.
 * Synthetic data only.
 */
const TODAY = '00000000-0000-4000-8000-0000000000aa';
const OWNER = 'owner-athlete';
const h = vi.hoisted(() => ({
  caller: null as null | Record<string, unknown>,
  feed: { data: [] as unknown[], error: null as unknown },
  today: null as any,
  past: [] as any[],
  streams: [] as any[],
}));

vi.mock('@/lib/auth/self-or-staff', async (o) => ({
  ...(await o<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: vi.fn(async () => ({ denied: null, caller: h.caller })),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const b: any = {
        select: () => b, eq: () => b, neq: () => b, gte: () => b, lt: () => b, in: () => b, limit: () => b, order: () => b,
        maybeSingle: async () => ({ data: table === 'athlete_activities' ? h.today : null, error: null }),
        then: (ok: any, bad: any) => Promise.resolve(
          table === 'feed_items' ? h.feed
            : table === 'athlete_activities' ? { data: h.past, error: null }
              : table === 'activity_streams' ? { data: h.streams, error: null }
                : { data: [], error: null },
        ).then(ok, bad),
      };
      return b;
    },
  }),
}));

/** A structured workout: n × repM at 3:30/km, 400 m jogs. */
function quality(id: string, day: string, n: number, repM: number) {
  const laps: any[] = [{ distance: 2000, duration: 600, averageHR: 135, maxHR: 140, intensityType: 'WARMUP', wktStepIndex: 0 }];
  for (let i = 0; i < n; i++) {
    laps.push({ distance: repM, duration: Math.round(repM * 0.21), averageHR: 170, maxHR: 175, intensityType: 'ACTIVE', wktStepIndex: 2 });
    laps.push({ distance: 400, duration: 150, averageHR: 140, maxHR: 150, intensityType: 'RECOVERY', wktStepIndex: 3 });
  }
  const steps = [
    { stepIndex: 0, intensity: 'WARMUP', distanceM: 2000 }, { stepIndex: 1, iterations: n },
    { stepIndex: 2, intensity: 'INTERVAL', distanceM: repM, repeatFrom: 1 }, { stepIndex: 3, intensity: 'RECOVERY', distanceM: 400, repeatFrom: 1 },
  ];
  return { id, athlete_id: OWNER, start_time: `${day}T06:00:00+00:00`, activity_name: 'Intervals', activity_type: 'running',
    distance: 2000 + n * (repM + 400), duration: 3000, moving_duration: null, average_pace: 280, average_hr: 155, laps, executed_workout: { steps } };
}
function easy(id: string, day: string, km: number) {
  return { id, athlete_id: OWNER, start_time: `${day}T06:00:00+00:00`, activity_name: `Easy ${km}`, activity_type: 'running',
    distance: km * 1000, duration: km * 330, moving_duration: km * 320, average_pace: 330, average_hr: 140, laps: null, executed_workout: null };
}

const asOwner = () => { h.caller = { athleteId: OWNER, isStaff: false, isSuperUser: false }; };
const asStaff = () => { h.caller = { athleteId: 'coach', isStaff: true, isSuperUser: false }; };
const asTeammate = () => { h.caller = { athleteId: 'teammate', isStaff: false, isSuperUser: false }; };

async function similar(scope = 'same') {
  const { GET } = await import('@/app/api/activities/similar/route');
  return GET(new Request(`http://x/api/activities/similar?id=${TODAY}&scope=${scope}`));
}
async function ok(scope = 'same') {
  const res = await similar(scope);
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  h.feed = { data: [], error: null }; h.streams = [];
  h.today = quality(TODAY, '2026-11-20', 6, 1000);
  // Newest first, as the route orders.
  h.past = [
    quality('q-6x1000', '2026-11-10', 6, 1000),
    quality('q-10x1000', '2026-11-03', 10, 1000),
    quality('q-8x400', '2026-10-27', 8, 400),
    easy('e-10', '2026-10-25', 10),
  ];
});

describe('gate', () => {
  it('a teammate gets 403', async () => { asTeammate(); expect((await similar()).status).toBe(403); });
  it('self is ok', async () => { asOwner(); expect((await ok()).masked).toBe(false); });
  it('staff is ok', async () => { asStaff(); expect((await ok()).kind).toBe('quality'); });
  it('rejects a bad scope', async () => {
    asOwner();
    const { GET } = await import('@/app/api/activities/similar/route');
    expect((await GET(new Request(`http://x/api/activities/similar?id=${TODAY}&scope=x`))).status).toBe(400);
  });
});

describe('masking', () => {
  it('pace hidden → empty and masked', async () => {
    asOwner(); h.feed = { data: [{ payload: { hiddenFields: ['pace'] } }], error: null };
    const b = await ok();
    expect(b).toMatchObject({ sessions: [], masked: true });
  });
  it('hidden-stats read fails → fails closed', async () => {
    asOwner(); h.feed = { data: null as never, error: { message: 'boom' } };
    expect((await ok()).masked).toBe(true);
  });
  it('heart rate hidden → every avgHr and paceAtHr null', async () => {
    asOwner(); h.feed = { data: [{ payload: { hiddenFields: ['heart_rate'] } }], error: null };
    const b = await ok('all');
    expect(b.sessions.length).toBeGreaterThan(1);
    for (const s of b.sessions) { expect(s.avgHr).toBeNull(); expect(s.paceAtHr).toBeNull(); }
  });
});

describe('quality scopes', () => {
  it('same: rep length ±25% and count ±1; today last', async () => {
    asOwner();
    const b = await ok('same');
    expect(b.kind).toBe('quality');
    expect(b.sessions.map((s: any) => s.id)).toEqual(['q-6x1000', TODAY]);
    const last = b.sessions.at(-1);
    expect(last.today).toBe(true);
    expect(last.repPaces).toEqual([210, 210, 210, 210, 210, 210]);
    expect(last.repsTotal).toBe(6);
    expect(last.date).toBe('2026-11-20');
  });
  it('type: rep length only', async () => {
    asOwner();
    expect((await ok('type')).sessions.map((s: any) => s.id)).toEqual(['q-10x1000', 'q-6x1000', TODAY]);
  });
  it('all: any quality, oldest → newest, no easy runs', async () => {
    asOwner();
    expect((await ok('all')).sessions.map((s: any) => s.id)).toEqual(['q-8x400', 'q-10x1000', 'q-6x1000', TODAY]);
  });
});

describe('easy scopes', () => {
  beforeEach(() => {
    h.today = easy(TODAY, '2026-11-20', 10);
    h.past = [easy('e-11', '2026-11-18', 11), easy('e-13', '2026-11-16', 13), easy('e-6.5', '2026-11-14', 6.5),
      easy('e-5', '2026-11-12', 5), quality('q', '2026-11-11', 6, 1000)];
  });
  it('same ±15%', async () => { asOwner(); expect((await ok('same')).sessions.map((s: any) => s.id)).toEqual(['e-11', TODAY]); });
  it('type ±30%', async () => { asOwner(); expect((await ok('type')).sessions.map((s: any) => s.id)).toEqual(['e-13', 'e-11', TODAY]); });
  it('all ≥60%, quality excluded; moving avg pace; paceAtHr from streams', async () => {
    asOwner();
    h.streams = [{ activity_id: TODAY, series: { t: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => x * 60), d: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => x * 200), hr: Array(11).fill(135) } }];
    const b = await ok('all');
    expect(b.kind).toBe('easy');
    expect(b.sessions.map((s: any) => s.id)).toEqual(['e-6.5', 'e-13', 'e-11', TODAY]);
    const last = b.sessions.at(-1);
    expect(last.avgPace).toBe(320);
    expect(last.repPaces).toEqual([]);
    expect(last.repsTotal).toBeNull();
    expect(b.sessions[0].paceAtHr).toBeNull();
  });
  it('caps at 8 past sessions, keeping the newest', async () => {
    asOwner();
    h.past = Array.from({ length: 12 }, (_, i) => easy(`e${i}`, `2026-11-${String(19 - i).padStart(2, '0')}`, 10));
    const b = await ok('same');
    expect(b.sessions.length).toBe(9);
    expect(b.sessions.map((s: any) => s.id)).toEqual(['e7', 'e6', 'e5', 'e4', 'e3', 'e2', 'e1', 'e0', TODAY]);
  });
});

describe('pure helpers', () => {
  it('paceAtHrOf skips pauses and out-of-band HR', () => {
    // 1 s samples at 4 m/s → 250 s/km; a pause and a 160-bpm stretch are excluded.
    const t: number[] = []; const d: number[] = []; const hr: number[] = [];
    for (let i = 0; i <= 300; i++) { t.push(i); d.push(i * 4); hr.push(i > 200 ? 160 : 135); }
    t.push(400); d.push(1201); hr.push(135);
    expect(paceAtHrOf({ t, d, hr })).toBe(250);
    expect(paceAtHrOf({ t: [0, 1], d: [0, 4], hr: [135, 135] })).toBeNull();
    expect(paceAtHrOf(null)).toBeNull();
  });
  it('matchesScope never mixes quality with easy', () => {
    const q = { quality: true, repLen: 1000, repCount: 6, distanceM: 10000 };
    const e = { quality: false, repLen: 0, repCount: 0, distanceM: 10000 };
    expect(matchesScope('all', q, e)).toBe(false);
    expect(matchesScope('all', e, q)).toBe(false);
  });
});

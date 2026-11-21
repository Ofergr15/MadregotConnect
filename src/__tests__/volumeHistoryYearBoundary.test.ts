// T4: before/after parity for volume-history across the Dec/Jan boundary, for a
// Monday-week and a Sunday-week athlete, at week/month/year granularity. FIXTURE only.
import { describe, it, expect, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2027-01-03T09:00:00+02:00')); // a Sunday, three days into the new year

const { client, tables, log } = createMemoryDb({
  schema: {
    athletes: ['id', 'week_start_day'],
    athlete_activities: ['id', 'athlete_id', 'start_time', 'distance', 'duration', 'activity_type'],
    weekly_plans: ['id', 'coach_id', 'week_start_date', 'parsed_workouts', 'status'],
  },
});
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => client }));
let who = 'mon';
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: who, isStaff: false, isSuperUser: false, email: '', role: 'runner' } }),
}));
const plan = (a: number, b: number) => ({ group1: { workouts: [{ dayOfWeek: 0, name: 'א', distanceMinKm: a, distanceMaxKm: b, steps: [] }] }, group2: { workouts: [] }, group3: { workouts: [] } });

tables.athletes.push({ id: 'mon', week_start_day: 1 }, { id: 'sun', week_start_day: 0 });
let n = 0;
for (const id of ['mon', 'sun']) {
  // Every day from 2026-12-20 to 2027-01-03, including the Sat/Sun/Mon either side of New Year.
  for (let d = new Date(Date.UTC(2026, 11, 20)); d <= new Date(Date.UTC(2027, 0, 3)); d = new Date(d.getTime() + 86400000)) {
    const day = d.toISOString().slice(0, 10);
    tables.athlete_activities.push({ id: `r${n++}`, athlete_id: id, start_time: `${day}T06:30:00+00:00`, distance: 10000, duration: 3000, activity_type: 'running' });
  }
  tables.athlete_activities.push({ id: `late${n++}`, athlete_id: id, start_time: '2026-12-31T23:30:00+00:00', distance: 5000, duration: 1500, activity_type: 'running' });
}
for (const w of ['2026-12-20', '2026-12-27', '2027-01-03']) tables.weekly_plans.push({ id: w, coach_id: COACH_ID, week_start_date: w, status: 'pushed', parsed_workouts: plan(70, 90) });

async function run(mod: { GET: (r: Request) => Promise<Response> }, qs: string) {
  const start = log.length;
  const res = await mod.GET(new Request(`http://x/api/athletes/volume-history?${qs}`));
  return { status: res.status, body: await res.json(), q: log.slice(start).map((x) => `${x.table}|${x.op}|${[...x.filters].sort().join('&')}`).sort() };
}

describe('volume-history parity across New Year', () => {
  for (const [athlete, qs] of [['mon', 'weeks=4'], ['sun', 'weeks=4'], ['mon', 'granularity=month&periods=3'], ['sun', 'granularity=year&periods=2']] as const) {
    it(`${athlete} ${qs}`, async () => {
      who = athlete;
      const q = `athleteId=${athlete}&${qs}`;
      const before = await run(await import('./fixtures/volumeHistoryRouteBaseline'), q);
      const after = await run(await import('@/app/api/athletes/volume-history/route'), q);
      expect(after.status).toBe(200);
      expect(after.body).toEqual(before.body);
      expect(after.q).toEqual(before.q);
      process.stdout.write(`YEAR ${athlete} ${qs}: ${JSON.stringify((after.body.series || []).map((s: any) => [s.weekStart, s.km, s.target?.min ?? null]))}\n`);
    });
  }
});

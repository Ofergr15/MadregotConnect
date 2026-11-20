// B21: the one path where before/after differ. The activity read fails (a missing
// column, as on an unapplied migration). FIXTURE only.
import { describe, it, expect, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

const { client, tables, log } = createMemoryDb({
  schema: {
    athletes: ['id', 'week_start_day'],
    athlete_activities: ['id', 'athlete_id', 'start_time', 'distance', 'duration'], // no activity_type -> 42703
    weekly_plans: ['id', 'coach_id', 'week_start_date', 'parsed_workouts', 'status'],
  },
});
tables.athletes.push({ id: 'mon', week_start_day: 1 });
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => client }));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: 'mon', isStaff: false, isSuperUser: false, email: '', role: 'runner' } }),
}));

async function run(mod: { GET: (r: Request) => Promise<Response> }, qs: string) {
  const start = log.length;
  const res = await mod.GET(new Request(`http://x/api/athletes/volume-history?${qs}`));
  return { status: res.status, body: await res.json(), tables: log.slice(start).map((q) => `${q.table}:${q.op}`) };
}

describe('volume-history when the activity read fails', () => {
  it.each(['athleteId=mon&weeks=12', 'athleteId=mon&granularity=month'])('%s: same status and body; extra reads bounded to one targets select at week granularity', async (qs) => {
    const before = await run(await import('./fixtures/volumeHistoryRouteBaseline'), qs);
    const after = await run(await import('@/app/api/athletes/volume-history/route'), qs);
    expect(after.status).toBe(before.status);
    expect(after.body).toEqual(before.body);
    expect(before.tables).toEqual(['athletes:select', 'athlete_activities:select']);
    const extra = qs.includes('month') ? [] : ['weekly_plans:select'];
    expect([...after.tables].sort()).toEqual([...before.tables, ...extra].sort());
    expect(after.tables.every((t) => t.endsWith(':select'))).toBe(true);
    process.stdout.write(`B21 ${qs}: status=${after.status} body=${JSON.stringify(after.body)} before=${before.tables.join(',')} after=${after.tables.join(',')}\n`);
  });
});

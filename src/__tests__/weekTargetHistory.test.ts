import { describe, expect, it } from 'vitest';
import { fetchWeekTargets } from '@/lib/plans/week-target-history';

// The volume chart's green band is drawn PER WEEK, from the plan that week
// actually had. These pin the three things that makes possible: the pushed row
// winning over a draft, a week with no plan coming back absent rather than
// borrowing a neighbour's band, and the query touching one table once.

interface Row {
  week_start_date: string;
  status: string;
  parsed_workouts: unknown;
}

/** Just enough of the Supabase builder for `fetchWeekTargets`, and a call log. */
function fakeSupabase(rows: Row[]) {
  const calls: Array<{ table: string; weekStarts: string[] }> = [];
  return {
    calls,
    client: {
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: (_column: string, weekStarts: string[]) => {
            calls.push({ table, weekStarts });
            return Promise.resolve({
              data: rows.filter((r) => weekStarts.includes(r.week_start_date)),
            });
          },
        };
        return builder;
      },
    },
  };
}

const plan = (min: number, max: number) => ({
  group1: {
    workouts: [
      { dayOfWeek: 0, name: 'יום ראשון', distanceMinKm: min, distanceMaxKm: max, steps: [] },
    ],
  },
  group2: { workouts: [] },
  group3: { workouts: [] },
});

describe('fetchWeekTargets', () => {
  it('gives every week its own band', async () => {
    const { client } = fakeSupabase([
      { week_start_date: '2026-08-23', status: 'pushed', parsed_workouts: plan(70, 85) },
      { week_start_date: '2026-08-30', status: 'pushed', parsed_workouts: plan(101, 120) },
    ]);
    const targets = await fetchWeekTargets(client, 'coach', ['2026-08-23', '2026-08-30']);
    expect(targets.get('2026-08-23')).toMatchObject({ min: 70, max: 85 });
    expect(targets.get('2026-08-30')).toMatchObject({ min: 101, max: 120 });
  });

  it('prefers the pushed row over a draft for the same week', async () => {
    // Both orders, because the winner must not depend on the row order Postgres
    // happened to return.
    for (const rows of [
      [
        { week_start_date: '2026-08-23', status: 'draft', parsed_workouts: plan(50, 55) },
        { week_start_date: '2026-08-23', status: 'pushed', parsed_workouts: plan(70, 85) },
      ],
      [
        { week_start_date: '2026-08-23', status: 'pushed', parsed_workouts: plan(70, 85) },
        { week_start_date: '2026-08-23', status: 'draft', parsed_workouts: plan(50, 55) },
      ],
    ]) {
      const { client } = fakeSupabase(rows);
      const targets = await fetchWeekTargets(client, 'coach', ['2026-08-23']);
      expect(targets.get('2026-08-23')).toMatchObject({ min: 70, max: 85 });
    }
  });

  it('leaves a week with no plan without a band', async () => {
    const { client } = fakeSupabase([
      { week_start_date: '2026-08-30', status: 'pushed', parsed_workouts: plan(101, 120) },
    ]);
    const targets = await fetchWeekTargets(client, 'coach', ['2026-08-23', '2026-08-30']);
    expect(targets.has('2026-08-23')).toBe(false);
    expect(targets.size).toBe(1);
  });

  it('leaves a week whose plan has no distances in it without a band', async () => {
    const { client } = fakeSupabase([
      { week_start_date: '2026-08-23', status: 'pushed', parsed_workouts: null },
    ]);
    expect((await fetchWeekTargets(client, 'coach', ['2026-08-23'])).size).toBe(0);
  });

  it('asks for all the weeks in one query, and none at all for an empty chart', async () => {
    const { client, calls } = fakeSupabase([]);
    await fetchWeekTargets(client, 'coach', ['2026-08-23', '2026-08-30']);
    expect(calls).toEqual([{ table: 'weekly_plans', weekStarts: ['2026-08-23', '2026-08-30'] }]);

    const empty = fakeSupabase([]);
    expect((await fetchWeekTargets(empty.client, 'coach', [])).size).toBe(0);
    expect(empty.calls).toEqual([]);
  });
});

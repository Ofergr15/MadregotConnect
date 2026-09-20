import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `/api/academy/plan-inputs` — the characterization answers, for the composer.
 *
 * The pure module (`academyPlanFit.test.ts`) decides what the answers MEAN. This file is about
 * the three things only the route can get wrong:
 *
 *  - **The join.** The answers are keyed by candidate and the composer knows athletes. Getting
 *    this backwards would show one trainee another trainee's injury.
 *  - **Returning too much.** The characterization row holds the coach's private verdict on
 *    whether a stranger is worth taking on. The composer must never receive it.
 *  - **Absence.** Most of the club was never characterised, and migration 111 is hand-pasted.
 *    Neither is an error, and neither may become a default.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

type Row = Record<string, unknown>;

const db: { academy_candidates: Row[]; academy_characterizations: Row[] } = {
  academy_candidates: [],
  academy_characterizations: [],
};

/** Which table should read as absent, mimicking an unpasted migration. */
let missingTable: string | null = null;

/** Every `.in()` the route made, so the id cap can be asserted. */
const inCalls: Array<{ table: string; column: string; values: unknown[] }> = [];

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];

  constructor(private table: keyof typeof db) {}

  select() { return this; }

  in(column: string, values: unknown[]) {
    inCalls.push({ table: this.table, column, values });
    this.filters.push(r => values.includes(r[column]));
    return this;
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const settled = missingTable === this.table
      ? { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }
      : { data: db[this.table].filter(r => this.filters.every(f => f(r))), error: null };
    return Promise.resolve(settled).then(onfulfilled, onrejected);
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: (table: keyof typeof db) => new Query(table) }),
}));

const { GET } = await import('@/app/api/academy/plan-inputs/route');

const asStaff = () => resolveVerifiedCaller.mockResolvedValue({
  denied: null,
  caller: { email: 'dani@madregot.app', athleteId: 'coach-1', role: 'academy_coach', isStaff: true, isSuperUser: false },
});
const asTrainee = () => resolveVerifiedCaller.mockResolvedValue({
  denied: null,
  caller: { email: 'dor@x.com', athleteId: 'a1', role: 'runner', isStaff: false, isSuperUser: false },
});

const get = (query: string) => GET(new Request(`http://x/api/academy/plan-inputs?${query}`));

beforeEach(() => {
  db.academy_candidates = [
    { id: 'c1', athlete_id: 'a1' },
    { id: 'c2', athlete_id: 'a2' },
    // Joined the academy, never characterised — the form is newer than most of the roster.
    { id: 'c3', athlete_id: 'a3' },
  ];
  db.academy_characterizations = [
    {
      candidate_id: 'c1', goal_type: 'half', target_race: 'טבריה', target_race_date: null,
      weekly_km: 30, years_running: 4, available_days: [0, 2, 4],
      limitations: 'גב תחתון', watch: 'garmin', pr_distance_m: 10000, pr_time_sec: 2910,
      fit: 'maybe', recorded_by: 'coach-1',
    },
    {
      candidate_id: 'c2', goal_type: 'full', target_race: null, target_race_date: null,
      weekly_km: 55, years_running: 9, available_days: [1, 3, 5, 6],
      limitations: null, watch: null, pr_distance_m: null, pr_time_sec: null,
      fit: 'yes', recorded_by: 'coach-1',
    },
  ];
  missingTable = null;
  inCalls.length = 0;
  asStaff();
});

describe('who may read somebody else\'s injuries', () => {
  it('is staff, not the trainee', async () => {
    asTrainee();
    expect((await get('athleteIds=a1')).status).toBe(403);
  });
});

describe('the athlete-to-candidate join', () => {
  it('returns each athlete\'s own answers, keyed by athlete', async () => {
    const body = await (await get('athleteIds=a1,a2')).json();
    expect(Object.keys(body.inputs).sort()).toEqual(['a1', 'a2']);
    expect(body.inputs.a1).toMatchObject({ goalType: 'half', availableDays: [0, 2, 4], weeklyKm: 30, limitation: 'גב תחתון' });
    expect(body.inputs.a2).toMatchObject({ goalType: 'full', availableDays: [1, 3, 5, 6], weeklyKm: 55, limitation: null });
  });

  it('omits an athlete whose candidate was never characterised', async () => {
    // Absent, not an empty PlanInputs: `plan-fit.ts` says nothing about somebody missing from the
    // map, and an empty one would read as "trains no days".
    const body = await (await get('athleteIds=a3')).json();
    expect(body.inputs).toEqual({});
  });

  it('omits an athlete with no candidate row at all', async () => {
    const body = await (await get('athleteIds=nobody')).json();
    expect(body.inputs).toEqual({});
  });

  it('asks only about the athletes it was given', async () => {
    await get('athleteIds=a1');
    expect(inCalls[0]).toMatchObject({ table: 'academy_candidates', column: 'athlete_id', values: ['a1'] });
    expect(inCalls[1]).toMatchObject({ table: 'academy_characterizations', column: 'candidate_id', values: ['c1'] });
  });
});

describe('what it refuses to hand over', () => {
  it('returns plan inputs and not the raw answers — no `fit` verdict', async () => {
    // The coach's read on whether a stranger is worth taking on has no business on a board that
    // is building that person's training week.
    const body = await (await get('athleteIds=a1')).json();
    expect(JSON.stringify(body)).not.toContain('maybe');
    expect(body.inputs.a1.fit).toBeUndefined();
    expect(body.inputs.a1.watch).toBeUndefined();
  });

  it('derives readiness and a pace anchor rather than shipping raw columns', async () => {
    const body = await (await get('athleteIds=a1')).json();
    expect(body.inputs.a1.daysPerWeek).toBe(3);
    expect(body.inputs.a1.ready).toBe(true);
    // 48:30 over 10 km is 291 s/km — the quoted best, which is the only pace anchor that exists
    // before the trainee has run a test.
    expect(body.inputs.a1.prPaceSec).toBe(291);
  });
});

describe('absence is not an error', () => {
  it('answers an empty ask with an empty map, not a 400', async () => {
    // The composer fires this whenever the selection changes, including when it is cleared.
    const res = await get('athleteIds=');
    expect(res.status).toBe(200);
    expect((await res.json()).inputs).toEqual({});
    expect(inCalls).toEqual([]);
  });

  it('says so when migration 111 is unpasted, instead of failing the board', async () => {
    missingTable = 'academy_characterizations';
    const res = await get('athleteIds=a1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ inputs: {}, tableMissing: true });
  });

  it('survives the candidates table being absent too', async () => {
    missingTable = 'academy_candidates';
    const body = await (await get('athleteIds=a1')).json();
    expect(body).toMatchObject({ inputs: {}, tableMissing: true });
  });

  it('caps how many trainees can be asked about at once', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `id-${i}`).join(',');
    await get(`athleteIds=${many}`);
    expect((inCalls[0].values as string[]).length).toBe(40);
  });

  it('does not ask twice about the same athlete', async () => {
    await get('athleteIds=a1,a1,a1');
    expect(inCalls[0].values).toEqual(['a1']);
  });
});

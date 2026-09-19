import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `GET|PUT /api/academy/characterization` — the form filled during the call.
 *
 * `academyCharacterization.test.ts` proves the answers and what they hand the plan composer.
 * This file is about the four things only the route can get wrong, each of which costs
 * somebody something real:
 *
 *  - **Nobody but staff sees it.** It holds a stranger's injuries and the coach's private
 *    verdict on whether to take them. There is no "self" case: a candidate has no account.
 *  - **Every save must CORRECT the last one.** The form autosaves during a twenty-minute
 *    phone call. A second row would leave the academy with two opinions about which days
 *    somebody can run and no way to tell which the coach meant.
 *  - **Clearing an answer must clear it.** Unselecting a training day has to stick, or the
 *    coach watches the day come back on the next autosave.
 *  - **Saving the form does NOT complete the funnel step.** That is the card's own request, so
 *    there is exactly one code path moving candidates between columns — and a call that
 *    genuinely happened with half the form blank must still be recordable.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

type Row = Record<string, unknown>;

const db: {
  academy_candidates: Row[];
  academy_characterizations: Row[];
  academy_candidate_events: Row[];
} = { academy_candidates: [], academy_characterizations: [], academy_candidate_events: [] };
let seq = 0;

class Query implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private inserting: Row | null = null;

  constructor(private table: keyof typeof db) {}

  select() { return this; }

  eq(column: string, value: unknown) {
    this.filters.push(r => r[column] === value);
    return this;
  }

  /** The route's only write: UNIQUE (candidate_id) — the same call, answered again. */
  upsert(row: Row, _opts?: { onConflict?: string }) {
    const existing = db[this.table].find(r => r.candidate_id === row.candidate_id);
    if (existing) {
      Object.assign(existing, row);
      this.inserting = existing;
      return this;
    }
    this.inserting = { id: `row-${++seq}`, created_at: '2026-09-19T00:00:00.000Z', ...row };
    db[this.table].push(this.inserting);
    return this;
  }

  private settle() {
    if (this.inserting) return { data: [this.inserting], error: null };
    return { data: db[this.table].filter(r => this.filters.every(f => f(r))), error: null };
  }

  single() {
    const { data, error } = this.settle();
    return Promise.resolve({ data: data?.[0] ?? null, error });
  }

  maybeSingle() {
    const { data, error } = this.settle();
    return Promise.resolve({ data: data?.[0] ?? null, error });
  }

  then<R1 = { data: Row[] | null; error: unknown }, R2 = never>(
    onfulfilled?: ((v: { data: Row[] | null; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.settle()).then(onfulfilled, onrejected);
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: (table: keyof typeof db) => new Query(table) }),
}));

const { GET, PUT } = await import('@/app/api/academy/characterization/route');

function asStaff(email = 'ofer@madregot.app') {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email, athleteId: 'staff-1', role: 'academy_coach', isStaff: true, isSuperUser: false },
  });
}
function asRunner() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'runner@x.com', athleteId: 'a9', role: 'runner', isStaff: false, isSuperUser: false },
  });
}

const put = (payload: unknown) =>
  PUT(new Request('http://localhost/api/academy/characterization', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }));

const get = (candidateId?: string) =>
  GET(new Request(`http://localhost/api/academy/characterization${candidateId ? `?candidateId=${candidateId}` : ''}`));

beforeEach(() => {
  db.academy_candidates = [{ id: 'c1', name: 'אבי ברק' }];
  db.academy_characterizations = [];
  db.academy_candidate_events = [];
  seq = 0;
  asStaff();
});

describe('who may read it', () => {
  it('refuses a member of the club, on both verbs', async () => {
    asRunner();
    expect((await get('c1')).status).toBe(403);
    expect((await put({ candidateId: 'c1', goalType: 'half' })).status).toBe(403);
    expect(db.academy_characterizations).toHaveLength(0);
  });

  it('passes a denial from the session layer straight through', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('no', { status: 401 }), caller: null });
    expect((await get('c1')).status).toBe(401);
  });
});

describe('reading the answers', () => {
  it('needs a candidate', async () => {
    expect((await get()).status).toBe(400);
  });

  it('answers null for somebody nobody has characterised', async () => {
    // Null and not an empty form: "nobody spoke to him" and "somebody answered nothing" are
    // different facts, and only the screen knows which one it is drawing.
    const body = await (await get('c1')).json();
    expect(body.characterization).toBeNull();
  });

  it('hands back what was saved, in the shape the form uses', async () => {
    await put({
      candidateId: 'c1',
      goalType: 'full',
      targetRace: 'טבריה',
      targetRaceDate: '2027-01-10',
      weeklyKm: '35',
      yearsRunning: 2,
      availableDays: [2, 4, 6],
      limitations: 'דלקת בגיד אכילס לפני חצי שנה',
      watch: 'Garmin',
      prDistanceM: 10000,
      prTimeSec: 2910,
      fit: 'maybe',
    });
    const body = await (await get('c1')).json();
    expect(body.characterization).toMatchObject({
      candidateId: 'c1',
      goalType: 'full',
      targetRaceDate: '2027-01-10',
      weeklyKm: 35,
      availableDays: [2, 4, 6],
      fit: 'maybe',
      recordedBy: 'ofer@madregot.app',
    });
  });
});

describe('saving during the call', () => {
  it('needs a candidate that exists', async () => {
    expect((await put({ goalType: 'half' })).status).toBe(400);
    expect((await put({ candidateId: 'ghost', goalType: 'half' })).status).toBe(404);
  });

  it('corrects the previous answer instead of adding a second one', async () => {
    // The whole reason this is a PUT. The form saves itself a dozen times in twenty minutes.
    await put({ candidateId: 'c1', weeklyKm: 30 });
    await put({ candidateId: 'c1', weeklyKm: 35 });
    await put({ candidateId: 'c1', weeklyKm: 40 });
    expect(db.academy_characterizations).toHaveLength(1);
    expect(db.academy_characterizations[0].weekly_km).toBe(40);
  });

  it('clears an answer that was taken back', async () => {
    // Unselecting a training day has to stick. An autosave that only sent changed fields could
    // never clear anything, and the coach would watch the day reappear.
    await put({ candidateId: 'c1', availableDays: [0, 2, 4], limitations: 'אכילס' });
    await put({ candidateId: 'c1', availableDays: [0, 2] });
    const body = await (await get('c1')).json();
    expect(body.characterization.availableDays).toEqual([0, 2]);
    expect(body.characterization.limitations).toBeNull();
  });

  it('accepts a form that is barely filled in, because the call is still happening', async () => {
    const res = await put({ candidateId: 'c1', goalType: 'half' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.characterization.goalType).toBe('half');
    expect(body.characterization.availableDays).toEqual([]);
  });

  it('stores an empty day list as an empty array, not as null', async () => {
    // So "he has no free mornings" and "nobody asked yet" stay different in the table itself.
    await put({ candidateId: 'c1', availableDays: [] });
    expect(db.academy_characterizations[0].available_days).toEqual([]);
  });

  it('drops a goal or fit value that is not one of the choices', async () => {
    // Neither column has a CHECK constraint — the choices are product — so this is where a
    // typo has to die rather than be stored and render as a blank chip.
    const body = await (await put({ candidateId: 'c1', goalType: 'ultra', fit: 'probably' })).json();
    expect(body.characterization.goalType).toBeNull();
    expect(body.characterization.fit).toBeNull();
  });

  it('refuses a date the DATE column cannot take, rather than 500ing mid-call', async () => {
    const body = await (await put({ candidateId: 'c1', targetRace: 'טבריה', targetRaceDate: '10.01.27' })).json();
    expect(body.characterization.targetRaceDate).toBeNull();
    // And the race itself is kept, so the screen can say what is missing.
    expect(body.characterization.targetRace).toBe('טבריה');
  });

  it('keeps an absurd number inside what the column can hold', async () => {
    // NUMERIC(5,1) overflows at 10000 and answers a 500 — on a keystroke, during a call. The
    // plausibility WARNING is the coach's business and lives in the pure module; this is only
    // about the column not exploding.
    await put({ candidateId: 'c1', weeklyKm: 1e9, yearsRunning: -5 });
    expect(Number(db.academy_characterizations[0].weekly_km)).toBeLessThanOrEqual(9999.9);
    expect(Number(db.academy_characterizations[0].years_running)).toBe(0);
  });

  it('drops half a quoted personal best rather than storing half of it', async () => {
    await put({ candidateId: 'c1', prDistanceM: 10000 });
    expect(db.academy_characterizations[0].pr_distance_m).toBeNull();
    expect(db.academy_characterizations[0].pr_time_sec).toBeNull();
  });

  it('does NOT mark the funnel step done', async () => {
    // Two doors into one stage is the failure the funnel's own route tests guard: the board
    // would disagree with itself depending on which screen recorded the call. The form's
    // button calls PATCH /api/academy/candidates { action: 'step' } — the same request the
    // card already makes — and this route never touches the event table.
    await put({
      candidateId: 'c1',
      goalType: 'half',
      weeklyKm: 35,
      availableDays: [0, 2, 4],
      fit: 'yes',
    });
    expect(db.academy_candidate_events).toHaveLength(0);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { buildFunnel, type CandidateEvent, type CandidateRow } from '@/lib/academy/funnel';

/**
 * `GET|POST|PATCH /api/academy/candidates` — the funnel's write path, against a stateful table.
 *
 * `academyFunnel.test.ts` proves the reading: who is stuck, and from when. This file is about
 * the four things that can only go wrong at the route, all of which cost a real person:
 *
 *  - **Nobody outside staff sees any of it.** This is the strictest table in the academy —
 *    strangers' names, phone numbers, emails, and a coach's private impressions of them — and
 *    every other academy route has a "self" case that this one must not have, because nobody
 *    in the funnel has an account yet.
 *  - **The two doors leave a candidate in different columns.** A form applicant has step one
 *    done; an Instagram DM does not. Get it wrong and every form applicant parks in a column
 *    nobody needs to act on.
 *  - **An unknown stage key must be refused on the way IN.** The reader ignores keys it does
 *    not recognise, so a typo accepted here is a step that silently never counts.
 *  - **Recording a step twice is a correction, not an error.** A coach fixing the date of a
 *    call must not get a 409, and the card must not then print the call twice.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

type Row = Record<string, unknown>;

const db: { academy_candidates: Row[]; academy_candidate_events: Row[]; athletes: Row[] } = {
  academy_candidates: [],
  academy_candidate_events: [],
  // The roster, because linking now reads it: the athlete has to exist, and the academy flag
  // has to be set on them. `a1` is an existing club member who never touched the academy —
  // which is the case the flag is FOR.
  athletes: [],
};
let seq = 0;

/** The partial unique index on `athlete_id` from migration 110. */
function forksAnAthlete(patch: Row, matched: Row[]): boolean {
  const athleteId = patch.athlete_id;
  if (!athleteId) return false;
  return db.academy_candidates.some(r =>
    r.athlete_id === athleteId && !matched.some(m => m.id === r.id));
}

class Query implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private inserting: Row | null = null;
  private patch: Row | null = null;
  private deleting = false;
  private error: unknown = null;

  constructor(private table: keyof typeof db) {}

  select() { return this; }

  eq(column: string, value: unknown) {
    this.filters.push(r => r[column] === value);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  insert(row: Row) {
    this.inserting = {
      id: `row-${++seq}`,
      created_at: '2026-09-19T00:00:00.000Z',
      occurred_at: '2026-09-19T00:00:00.000Z',
      archived_at: null,
      archived_reason: null,
      athlete_id: null,
      ...row,
    };
    db[this.table].push(this.inserting);
    return this;
  }

  /** The route's one upsert: (candidate_id, stage) — a step recorded again is the same step. */
  upsert(row: Row, _opts?: { onConflict?: string }) {
    const existing = db.academy_candidate_events.find(r =>
      r.candidate_id === row.candidate_id && r.stage === row.stage);
    if (existing) {
      Object.assign(existing, row);
      this.inserting = existing;
      return this;
    }
    return this.insert(row);
  }

  update(row: Row) {
    this.patch = row;
    return this;
  }

  delete() {
    this.deleting = true;
    return this;
  }

  private rows(): Row[] {
    if (this.inserting) return [this.inserting];
    const matched = db[this.table].filter(r => this.filters.every(f => f(r)));

    if (this.deleting) {
      db[this.table] = db[this.table].filter(r => !matched.includes(r));
      return matched;
    }

    if (this.patch) {
      if (forksAnAthlete(this.patch, matched)) {
        this.error = { code: '23505', message: 'duplicate key value violates unique constraint' };
        return [];
      }
      for (const row of matched) Object.assign(row, this.patch);
      return matched;
    }

    let rows = matched;
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) =>
        String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
    }
    return rows;
  }

  private settle() {
    const rows = this.rows();
    return this.error ? { data: null, error: this.error } : { data: rows, error: null };
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

const { GET, PATCH, POST } = await import('@/app/api/academy/candidates/route');

function asStaff(email = 'yossi@madregot.app') {
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

const json = (method: 'POST' | 'PATCH', payload: unknown) =>
  new Request('http://localhost/api/academy/candidates', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });

const post = (payload: unknown) => POST(json('POST', payload));
const patch = (payload: unknown) => PATCH(json('PATCH', payload));
const get = () => GET(new Request('http://localhost/api/academy/candidates'));

beforeEach(() => {
  db.academy_candidates = [];
  db.academy_candidate_events = [];
  db.athletes = [
    { id: 'a1', name: 'Noa Shemesh', is_academy: false },
    { id: 'a2', name: 'Dor Alon', is_academy: true },
  ];
  seq = 0;
  asStaff();
});

describe('who may read the funnel', () => {
  it('refuses a member of the club', async () => {
    asRunner();
    expect((await get()).status).toBe(403);
    expect((await post({ name: 'רון' })).status).toBe(403);
    expect((await patch({ id: 'x', action: 'archive' })).status).toBe(403);
  });

  it('passes a denial from the session layer straight through', async () => {
    resolveVerifiedCaller.mockResolvedValue({
      denied: new Response('no', { status: 401 }), caller: null,
    });
    expect((await get()).status).toBe(401);
  });
});

describe('opening a row', () => {
  it('needs a name', async () => {
    const res = await post({ email: 'x@y.com' });
    expect(res.status).toBe(400);
    expect(db.academy_candidates).toHaveLength(0);
  });

  it('leaves an Instagram DM waiting for the form', async () => {
    await post({ name: 'רון לוי', goal: 'מרתון' });
    const body = await (await get()).json();
    const board = buildFunnel({ candidates: body.candidates, events: body.events, now: '2026-09-19T09:00:00Z' });
    expect(board.columns.find(c => c.spec.key === 'form')!.candidates.map(c => c.name)).toEqual(['רון לוי']);
  });

  it('puts a form applicant in the intro-call column instead', async () => {
    // The whole difference between the two doors. Getting this wrong parks every form
    // applicant in a column nobody needs to act on.
    await post({ name: 'מיכל כהן', source: 'form', formFilled: true });
    const body = await (await get()).json();
    const board = buildFunnel({ candidates: body.candidates, events: body.events, now: '2026-09-19T09:00:00Z' });
    expect(board.columns.find(c => c.spec.key === 'form')!.candidates).toEqual([]);
    expect(board.columns.find(c => c.spec.key === 'intro_call')!.candidates.map(c => c.name)).toEqual(['מיכל כהן']);
  });

  it('normalises the email and records who is responsible for the first step', async () => {
    await post({ name: 'דור', email: '  Dor@Example.COM ', formFilled: true });
    expect(db.academy_candidates[0].email).toBe('dor@example.com');
    expect(db.academy_candidate_events[0].recorded_by).toBe('yossi@madregot.app');
  });
});

describe('recording a step', () => {
  let id: string;
  beforeEach(async () => {
    const body = await (await post({ name: 'דור אלון', formFilled: true })).json();
    id = body.candidate.id;
  });

  it('moves them to the next column, and keeps who said what', async () => {
    const res = await patch({ id, action: 'step', stage: 'intro_call', note: 'מאוד מתלהב' });
    expect(res.status).toBe(200);

    const body = await (await get()).json();
    const board = buildFunnel({ candidates: body.candidates, events: body.events, now: '2026-09-19T09:00:00Z' });
    expect(board.columns.find(c => c.spec.key === 'characterization')!.candidates.map(c => c.name))
      .toEqual(['דור אלון']);
    const event = (body.events as CandidateEvent[]).find(e => e.stage === 'intro_call')!;
    expect(event.note).toBe('מאוד מתלהב');
    expect(event.recordedBy).toBe('yossi@madregot.app');
  });

  it('refuses a stage key it does not recognise', async () => {
    // The reader ignores unknown keys, so a typo accepted here is a step that silently never
    // counts — the candidate stays in the same column and the coach believes they moved.
    const res = await patch({ id, action: 'step', stage: 'coffee' });
    expect(res.status).toBe(400);
    expect(db.academy_candidate_events.filter(e => e.stage === 'coffee')).toHaveLength(0);
  });

  it('takes the date the step actually happened, not the moment it was typed', async () => {
    // A phone call gets logged that evening, and "3 days in stage" has to count from the call.
    await patch({ id, action: 'step', stage: 'intro_call', occurredAt: '2026-09-09T18:30:00.000Z' });
    const body = await (await get()).json();
    expect((body.events as CandidateEvent[]).find(e => e.stage === 'intro_call')!.occurredAt)
      .toBe('2026-09-09T18:30:00.000Z');
  });

  it('ignores an unparseable date rather than refusing the step', async () => {
    // The step did happen. Losing it over a malformed field would be the worse outcome.
    const res = await patch({ id, action: 'step', stage: 'intro_call', occurredAt: 'yesterday' });
    expect(res.status).toBe(200);
    expect(Date.parse(String(db.academy_candidate_events.at(-1)!.occurred_at))).not.toBeNaN();
  });

  it('treats recording the same step twice as a correction', async () => {
    await patch({ id, action: 'step', stage: 'intro_call', occurredAt: '2026-09-09T18:30:00.000Z' });
    const again = await patch({ id, action: 'step', stage: 'intro_call', occurredAt: '2026-09-10T08:00:00.000Z', note: 'בעצם דיברנו בבוקר' });
    expect(again.status).toBe(200);

    const calls = db.academy_candidate_events.filter(e => e.stage === 'intro_call');
    expect(calls).toHaveLength(1);
    expect(calls[0].occurred_at).toBe('2026-09-10T08:00:00.000Z');
    expect(calls[0].note).toBe('בעצם דיברנו בבוקר');
  });

  it('can be undone', async () => {
    await patch({ id, action: 'step', stage: 'intro_call' });
    expect((await patch({ id, action: 'unstep', stage: 'intro_call' })).status).toBe(200);
    expect(db.academy_candidate_events.filter(e => e.stage === 'intro_call')).toHaveLength(0);
  });

  it('404s on a candidate that does not exist', async () => {
    expect((await patch({ id: 'nope', action: 'step', stage: 'intro_call' })).status).toBe(404);
  });
});

describe('leaving and coming back', () => {
  let id: string;
  beforeEach(async () => {
    const body = await (await post({ name: 'עומר', formFilled: true })).json();
    id = body.candidate.id;
  });

  it('archives with a reason and takes them off the board', async () => {
    expect((await patch({ id, action: 'archive', reason: 'מחיר' })).status).toBe(200);
    const body = await (await get()).json();
    const board = buildFunnel({ candidates: body.candidates, events: body.events, now: '2026-09-19T09:00:00Z' });
    expect(board.live).toBe(0);
    expect(board.archived).toBe(1);
    expect(board.columns.flatMap(c => c.candidates)).toEqual([]);
  });

  it('keeps the steps they already did when they come back', async () => {
    // Which is the whole reason archiving is not deleting: somebody who said no in March and
    // returned in September does not do the intro call again.
    await patch({ id, action: 'archive', reason: 'מחיר' });
    expect((await patch({ id, action: 'restore' })).status).toBe(200);
    const body = await (await get()).json();
    const candidate = (body.candidates as CandidateRow[])[0];
    expect(candidate.archivedAt).toBeNull();
    expect(candidate.archivedReason).toBeNull();
    expect(body.events).toHaveLength(1);
  });
});

describe('becoming a trainee', () => {
  it('links the athlete row without ending the funnel', async () => {
    // Signup is step 4 of nine. The link is bookkeeping; the test, the analysis, the plan and
    // the standing order are all still ahead, and that is where people are lost.
    const body = await (await post({ name: 'נועה', formFilled: true })).json();
    const id = body.candidate.id;
    await patch({ id, action: 'step', stage: 'intro_call' });
    await patch({ id, action: 'step', stage: 'characterization' });
    await patch({ id, action: 'step', stage: 'signup' });
    expect((await patch({ id, action: 'link', athleteId: 'a1' })).status).toBe(200);

    const after = await (await get()).json();
    const board = buildFunnel({ candidates: after.candidates, events: after.events, now: '2026-09-19T09:00:00Z' });
    expect(board.live).toBe(1);
    expect(board.columns.find(c => c.spec.key === 'test')!.candidates.map(c => c.name)).toEqual(['נועה']);
  });

  it('refuses to fork one athlete’s history across two candidates', async () => {
    const first = await (await post({ name: 'א' })).json();
    const second = await (await post({ name: 'ב' })).json();
    await patch({ id: first.candidate.id, action: 'link', athleteId: 'a1' });
    const res = await patch({ id: second.candidate.id, action: 'link', athleteId: 'a1' });
    expect(res.status).toBe(409);
  });

  it('needs an athleteId to link', async () => {
    const body = await (await post({ name: 'ג' })).json();
    expect((await patch({ id: body.candidate.id, action: 'link' })).status).toBe(400);
  });

  it('refuses an athlete who does not exist', async () => {
    // The foreign key would catch this anyway, but as a 500 — and a 500 mid-call reads as the
    // app being broken rather than as the id being wrong.
    const body = await (await post({ name: 'ד' })).json();
    const res = await patch({ id: body.candidate.id, action: 'link', athleteId: 'nobody' });
    expect(res.status).toBe(404);
    expect(db.academy_candidates[0].athlete_id).toBeNull();
  });

  it('marks the athlete as academy, because nothing else does', async () => {
    // `a1` is an existing club member who joined the academy afterwards: their row predates
    // the academy, so `is_academy` is false and `/api/academy/register` never ran for them.
    // Without this they would be invisible to every academy screen — tests, bands, threads,
    // dispatch — with no screen anywhere able to fix it.
    const body = await (await post({ name: 'ה' })).json();
    const res = await patch({ id: body.candidate.id, action: 'link', athleteId: 'a1' });
    expect(await res.json()).toMatchObject({ ok: true, academyFlagged: true });
    expect(db.athletes.find(a => a.id === 'a1')!.is_academy).toBe(true);
  });

  it('leaves an athlete who already came through the academy door alone', async () => {
    const body = await (await post({ name: 'ו' })).json();
    const res = await patch({ id: body.candidate.id, action: 'link', athleteId: 'a2' });
    expect(await res.json()).toMatchObject({ ok: true, academyFlagged: true });
  });

  it('takes a mis-link back, and frees the athlete for the right candidate', async () => {
    // The most expensive mistake on this board is one stranger's injuries and the coach's
    // private verdict sitting on somebody else's account. The partial unique index makes it
    // unfixable without this: the right athlete cannot be linked while the wrong one holds it.
    const wrong = await (await post({ name: 'ז' })).json();
    const right = await (await post({ name: 'ח' })).json();
    await patch({ id: wrong.candidate.id, action: 'link', athleteId: 'a1' });
    expect((await patch({ id: right.candidate.id, action: 'link', athleteId: 'a1' })).status).toBe(409);

    expect((await patch({ id: wrong.candidate.id, action: 'unlink' })).status).toBe(200);
    expect((await patch({ id: right.candidate.id, action: 'link', athleteId: 'a1' })).status).toBe(200);

    const after = await (await get()).json();
    const rows = after.candidates as CandidateRow[];
    expect(rows.find(c => c.name === 'ז')!.athleteId).toBeNull();
    expect(rows.find(c => c.name === 'ח')!.athleteId).toBe('a1');
  });

  it('does NOT un-academy somebody when a mis-link is corrected', async () => {
    // Being an academy trainee is not undone by fixing a clerical error, and clearing the flag
    // would drop a real trainee out of every academy screen as a side effect.
    const body = await (await post({ name: 'ט' })).json();
    await patch({ id: body.candidate.id, action: 'link', athleteId: 'a1' });
    await patch({ id: body.candidate.id, action: 'unlink' });
    expect(db.athletes.find(a => a.id === 'a1')!.is_academy).toBe(true);
  });

  it('records no funnel step, in either direction', async () => {
    // Linking is strong evidence that signing up happened, and stamping it here would still be
    // a second door into one stage: the same candidate in different columns depending on which
    // screen recorded them. The card's `בוצע` button is the one door.
    const body = await (await post({ name: 'י' })).json();
    const id = body.candidate.id;
    await patch({ id, action: 'link', athleteId: 'a1' });
    await patch({ id, action: 'unlink' });
    expect(db.academy_candidate_events).toHaveLength(0);
  });
});

describe('editing the person', () => {
  it('updates contact details and refuses to blank the name', async () => {
    const body = await (await post({ name: 'רון' })).json();
    const id = body.candidate.id;

    const ok = await patch({ id, action: 'edit', phone: '050-1234567', goal: 'חצי מרתון' });
    expect(ok.status).toBe(200);
    const updated = await ok.json();
    expect(updated.candidate.phone).toBe('050-1234567');
    expect(updated.candidate.goal).toBe('חצי מרתון');

    expect((await patch({ id, action: 'edit', name: '   ' })).status).toBe(400);
    expect(db.academy_candidates[0].name).toBe('רון');
  });

  it('rejects an action it does not know', async () => {
    const body = await (await post({ name: 'רון' })).json();
    expect((await patch({ id: body.candidate.id, action: 'promote' })).status).toBe(400);
  });
});

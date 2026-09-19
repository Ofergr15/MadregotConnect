import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ZONE_INTENSITY, type LibraryStep } from '@/lib/academy/library';

/**
 * `GET|POST|PATCH /api/academy/library` — the book's write path, against a stateful table.
 *
 * `academyLibrary.test.ts` proves the arithmetic: a percentage resolves to the right pace and
 * 92% comes out slower than threshold. None of that is what this file is about. The two things
 * that can only go wrong at the route are both about trust:
 *
 *  - **An entry must never store an absolute pace.** That is the whole feature — one entry
 *    serving band 4 and band 9 — and it is not enforceable by a CHECK constraint, because the
 *    steps are JSONB and the rule is about which keys are absent inside them. So the refusal
 *    lives at the single point a step enters the table, which means the only proof it works is
 *    a request that tries.
 *  - **Two shelves, two permissions.** The canon is what every mentor pushes from, so a
 *    mentor's first draft landing in it is the academy pushing an unreviewed workout to
 *    everybody. A coach must also not be able to read, edit or even detect another coach's
 *    private shelf.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

type Row = Record<string, unknown>;

const db: { academy_workout_library: Row[] } = { academy_workout_library: [] };
let seq = 0;

/** The unique index from migration 109, which is what produces the 409 the route explains. */
function violatesUniqueName(row: Row, ignoreId?: unknown): boolean {
  return db.academy_workout_library.some(r =>
    r.id !== ignoreId
    && r.archived_at == null
    && r.owner_id === row.owner_id
    && r.scope === row.scope
    && String(r.name).toLowerCase() === String(row.name).toLowerCase());
}

class Query implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private inserting: Row | null = null;
  private patch: Row | null = null;
  private error: unknown = null;

  constructor(private table: keyof typeof db) {}

  select() { return this; }

  eq(column: string, value: unknown) {
    this.filters.push(r => r[column] === value);
    return this;
  }

  /** Only ever `.is('archived_at', null)` here — the live-rows filter. */
  is(column: string, value: null) {
    this.filters.push(r => (r[column] ?? null) === value);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  insert(row: Row) {
    if (violatesUniqueName(row)) {
      this.error = { code: '23505', message: 'duplicate key value violates unique constraint' };
      return this;
    }
    this.inserting = { id: `row-${++seq}`, created_at: '2026-09-19T00:00:00.000Z', use_count: 0, last_used_at: null, archived_at: null, ...row };
    db.academy_workout_library.push(this.inserting);
    return this;
  }

  update(row: Row) {
    this.patch = row;
    return this;
  }

  private rows(): Row[] {
    if (this.inserting) return [this.inserting];
    const matched = db[this.table].filter(r => this.filters.every(f => f(r)));
    if (this.patch) {
      for (const row of matched) {
        const next = { ...row, ...this.patch };
        if (this.patch.name !== undefined && violatesUniqueName(next, row.id)) {
          this.error = { code: '23505', message: 'duplicate key value violates unique constraint' };
          return [];
        }
        Object.assign(row, this.patch);
      }
      return matched;
    }
    let rows = matched;
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => (Number(a[column]) - Number(b[column])) * (ascending ? 1 : -1));
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

const { GET, PATCH, POST } = await import('@/app/api/academy/library/route');

const MANAGER = 'aaaa0000-0000-0000-0000-000000000001';
const COACH = 'aaaa0000-0000-0000-0000-000000000002';
const OTHER_COACH = 'aaaa0000-0000-0000-0000-000000000003';
const RUNNER = 'aaaa0000-0000-0000-0000-000000000004';

function asManager() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null, caller: { athleteId: MANAGER, role: 'admin', isStaff: true, isSuperUser: false },
  });
}
function asCoach(id = COACH) {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null, caller: { athleteId: id, role: 'academy_coach', isStaff: true, isSuperUser: false },
  });
}
function asRunner() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null, caller: { athleteId: RUNNER, role: 'runner', isStaff: false, isSuperUser: false },
  });
}

const STEPS: LibraryStep[] = [
  { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetZone: 'easy', intensity: ZONE_INTENSITY.easy },
  { order: 2, type: 'interval', durationType: 'distance', durationValue: 800, targetType: 'pace', targetZone: 'interval', intensity: ZONE_INTENSITY.interval, repeatCount: 6 },
];

const post = (payload: unknown) =>
  POST(new Request('http://localhost/api/academy/library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }));

const patch = (payload: unknown) =>
  PATCH(new Request('http://localhost/api/academy/library', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }));

const get = () => GET(new Request('http://localhost/api/academy/library'));

function entry(over: Row = {}): Row {
  return {
    id: `seed-${++seq}`, scope: 'mine', owner_id: COACH, name: `w${seq}`, kind: 'easy',
    notes: null, steps: STEPS, use_count: 0, last_used_at: null, archived_at: null,
    created_at: '2026-09-01T00:00:00.000Z', athletes: { name: 'Coach' }, ...over,
  };
}

beforeEach(() => {
  db.academy_workout_library = [];
  seq = 0;
  resolveVerifiedCaller.mockReset();
  asCoach();
});

describe('the book never stores a pace', () => {
  it('refuses a step carrying an absolute pace', async () => {
    const res = await post({
      name: '6×800', kind: 'intervals',
      steps: [{ ...STEPS[1], targetPaceMinPerKm: 245, targetPaceMaxPerKm: 250 }],
    });
    expect(res.status).toBe(400);
    expect(db.academy_workout_library).toHaveLength(0);
  });

  it('refuses one hidden inside a repeat', async () => {
    const res = await post({
      name: 'nested', kind: 'intervals',
      steps: [{ order: 1, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 4, repeatSteps: [{ ...STEPS[1], group2Pace: { min: 240, max: 250 } }] }],
    });
    expect(res.status).toBe(400);
  });

  it('refuses a pace written into a step note', async () => {
    // The converter prints a note verbatim on the watch when it contains a pace, so this
    // reaches the athlete exactly as if it were the target.
    const res = await post({
      name: 'noted', kind: 'tempo', steps: [{ ...STEPS[0], notes: 'בקצב 4:05' }],
    });
    expect(res.status).toBe(400);
  });

  it('accepts the same workout stored as an intensity', async () => {
    const res = await post({ name: '6×800', kind: 'intervals', notes: 'הגבעה בפארק', steps: STEPS });
    expect(res.status).toBe(200);
    const { entry: saved } = await res.json();
    expect(saved.scope).toBe('mine');
    expect(saved.ownerId).toBe(COACH);
    expect(saved.useCount).toBe(0);
    expect(saved.steps[1].intensity).toEqual(ZONE_INTENSITY.interval);
  });

  it('refuses an empty workout', async () => {
    expect((await post({ name: 'nothing', kind: 'easy', steps: [] })).status).toBe(400);
  });

  it('refuses a nameless or unknown-kind workout', async () => {
    expect((await post({ name: '   ', kind: 'easy', steps: STEPS })).status).toBe(400);
    expect((await post({ name: 'x', kind: 'fartlek', steps: STEPS })).status).toBe(400);
  });
});

describe('two shelves, two permissions', () => {
  it('lets a manager write the canon', async () => {
    asManager();
    const res = await post({ name: 'ארוך 24', kind: 'long', scope: 'academy', steps: STEPS });
    expect(res.status).toBe(200);
    expect((await res.json()).entry.scope).toBe('academy');
  });

  it('will not let a mentor write the canon', async () => {
    // The canon is what every mentor pushes from, so a first draft landing in it means the
    // academy pushed an unreviewed workout to everybody last week.
    const res = await post({ name: 'ארוך 24', kind: 'long', scope: 'academy', steps: STEPS });
    expect(res.status).toBe(403);
    expect(db.academy_workout_library).toHaveLength(0);
  });

  it('files an unrecognised scope on the coach\'s own shelf', async () => {
    const res = await post({ name: 'x', kind: 'easy', scope: 'everyone', steps: STEPS });
    expect((await res.json()).entry.scope).toBe('mine');
  });

  it('shows a coach the canon and their own shelf, and nobody else\'s', async () => {
    db.academy_workout_library = [
      entry({ name: 'mine', owner_id: COACH }),
      entry({ name: 'theirs', owner_id: OTHER_COACH }),
      entry({ name: 'canon', scope: 'academy', owner_id: MANAGER }),
    ];
    const { entries } = await (await get()).json();
    expect(entries.map((e: any) => e.name).sort()).toEqual(['canon', 'mine']);
  });

  it('keeps an archived entry off the shelf', async () => {
    db.academy_workout_library = [entry({ name: 'gone', archived_at: '2026-09-10T00:00:00.000Z' })];
    expect((await (await get()).json()).entries).toEqual([]);
  });

  it('is staff-only', async () => {
    asRunner();
    expect((await get()).status).toBe(403);
    expect((await post({ name: 'x', kind: 'easy', steps: STEPS })).status).toBe(403);
    expect((await patch({ id: 'seed-1', action: 'archive' })).status).toBe(403);
  });

  it('refuses the same name twice on one shelf', async () => {
    expect((await post({ name: 'טמפו 20', kind: 'tempo', steps: STEPS })).status).toBe(200);
    // Case-insensitively, and said in the coach's terms: the realistic cause is two taps.
    const again = await post({ name: 'טמפו 20', kind: 'tempo', steps: STEPS });
    expect(again.status).toBe(409);
    expect(db.academy_workout_library).toHaveLength(1);
  });

  it('lets two coaches keep the same name on their own shelves', async () => {
    expect((await post({ name: 'קל 8', kind: 'easy', steps: STEPS })).status).toBe(200);
    asCoach(OTHER_COACH);
    expect((await post({ name: 'קל 8', kind: 'easy', steps: STEPS })).status).toBe(200);
  });
});

describe('editing', () => {
  it('edits an entry on your own shelf', async () => {
    db.academy_workout_library = [entry({ id: 'e1', name: 'old' })];
    const res = await patch({ id: 'e1', action: 'edit', name: 'new', kind: 'intervals', notes: 'תוקן' });
    expect(res.status).toBe(200);
    const { entry: saved } = await res.json();
    expect(saved.name).toBe('new');
    expect(saved.kind).toBe('intervals');
  });

  it('will not edit another coach\'s shelf, and does not admit it exists', async () => {
    db.academy_workout_library = [entry({ id: 'e1', owner_id: OTHER_COACH })];
    // 404 rather than 403 — a 403 confirms the id is real, which is the same leak the tests
    // route closes for a trainee who is not yours.
    expect((await patch({ id: 'e1', action: 'edit', name: 'hijacked' })).status).toBe(404);
    expect(db.academy_workout_library[0].name).not.toBe('hijacked');
  });

  it('will not let a mentor edit the canon', async () => {
    db.academy_workout_library = [entry({ id: 'e1', scope: 'academy', owner_id: MANAGER })];
    expect((await patch({ id: 'e1', action: 'edit', name: 'rewritten' })).status).toBe(404);
    asManager();
    expect((await patch({ id: 'e1', action: 'edit', name: 'rewritten' })).status).toBe(200);
  });

  it('refuses to edit a pace into an existing entry', async () => {
    db.academy_workout_library = [entry({ id: 'e1' })];
    const res = await patch({ id: 'e1', action: 'edit', steps: [{ ...STEPS[0], targetPaceMaxPerKm: 300 }] });
    expect(res.status).toBe(400);
  });

  it('archives rather than deletes', async () => {
    // A session pushed 28 times is the academy's institutional memory, and the undo for a
    // mis-tap on a list row has to exist somewhere.
    db.academy_workout_library = [entry({ id: 'e1' })];
    expect((await patch({ id: 'e1', action: 'archive' })).status).toBe(200);
    expect(db.academy_workout_library).toHaveLength(1);
    expect(db.academy_workout_library[0].archived_at).toBeTruthy();
  });

  it('404s on an unknown id and 400s on an unknown action', async () => {
    expect((await patch({ id: 'nope', action: 'archive' })).status).toBe(404);
    db.academy_workout_library = [entry({ id: 'e1' })];
    expect((await patch({ id: 'e1', action: 'rename-everything' })).status).toBe(400);
    expect((await patch({ action: 'archive' })).status).toBe(400);
  });
});

describe('what the academy actually runs rises to the top', () => {
  it('counts a push of six as six', async () => {
    db.academy_workout_library = [entry({ id: 'e1', use_count: 22 })];
    expect((await patch({ id: 'e1', action: 'used', trainees: 6 })).status).toBe(200);
    expect(db.academy_workout_library[0].use_count).toBe(28);
    expect(db.academy_workout_library[0].last_used_at).toBeTruthy();
  });

  it('lets a mentor record a push from the canon they cannot edit', async () => {
    // Pushing from the canon is what the canon is for, and the count is what keeps the book
    // ordered by what the academy runs rather than by who wrote what.
    db.academy_workout_library = [entry({ id: 'e1', scope: 'academy', owner_id: MANAGER, use_count: 3 })];
    expect((await patch({ id: 'e1', action: 'used', trainees: 2 })).status).toBe(200);
    expect(db.academy_workout_library[0].use_count).toBe(5);
  });

  it('clamps a nonsense count instead of refusing it', async () => {
    // The push already happened; refusing to record it would leave the ordering quietly
    // wrong, which is worse than being off by a few.
    db.academy_workout_library = [entry({ id: 'e1', use_count: 1 })];
    await patch({ id: 'e1', action: 'used', trainees: -4 });
    expect(db.academy_workout_library[0].use_count).toBe(2);
    await patch({ id: 'e1', action: 'used', trainees: 99999 });
    expect(db.academy_workout_library[0].use_count).toBe(102);
  });
});

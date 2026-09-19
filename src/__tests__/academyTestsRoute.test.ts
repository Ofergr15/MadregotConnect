import { describe, expect, it, vi, beforeEach } from 'vitest';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';

/**
 * `GET|POST /api/academy/tests` — the write path, exercised against a stateful table.
 *
 * Every other test around this feature is pure: `academyTests.test.ts` proves the arithmetic
 * and the ranking, the audit proves the pixels. Neither one ever ran a save. Until this file
 * the only way to find out whether recording a test actually puts a readable row in front of
 * the coach was to log into production and type one — the POST had literally never executed,
 * because the route is staff-gated and session minting is not available from a test.
 *
 * So the fake below is STATEFUL on purpose. A stub that returns a canned row would re-prove
 * the arithmetic and nothing else; what has to hold is the loop: the coach saves, the same
 * row comes back out of the registry with the right pace, and the athlete stops being
 * overdue. That loop crosses the snake_case mapping twice, in both directions, and that
 * mapping is the part a refactor breaks silently — a column renamed on the way in reads back
 * as `NaN`, and `NaN` seconds per kilometre renders as `—`, which looks exactly like "no
 * test yet" on the screen the feature exists to clear.
 *
 * The four other things here that would fail quietly:
 *  - **A correction is not a second test.** Re-recording the same protocol on the same day
 *    must upsert. Two rows would put two points on one day on the improvement graph and make
 *    the delta the difference between a typo and its fix.
 *  - **A blank reason must not exclude the test.** `excluded_reason: ''` is truthy-ish
 *    plumbing away from silently dropping the test out of the very trend it was recorded for.
 *  - **A coach may only record for their own trainees**, and must not learn from the response
 *    whether somebody else's trainee exists.
 *  - **Both halves are required.** A row with a duration and no distance has no threshold,
 *    which is the only reason the row exists.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

// ── A small stateful stand-in for the two tables the route touches ───────────

type Row = Record<string, unknown>;

const db: { athletes: Row[]; academy_tests: Row[] } = { athletes: [], academy_tests: [] };
let seq = 0;

class Query implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private pending: Row | null = null;
  private conflict: string[] = [];
  private patch: Row | null = null;
  private deleting = false;

  constructor(private table: keyof typeof db) {}

  select() { return this; }

  eq(column: string, value: unknown) {
    this.filters.push(r => r[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push(r => values.includes(r[column]));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  update(row: Row) {
    this.patch = row;
    return this;
  }

  delete() {
    this.deleting = true;
    return this;
  }

  upsert(row: Row, opts?: { onConflict?: string }) {
    this.pending = row;
    this.conflict = (opts?.onConflict || '').split(',').map(s => s.trim()).filter(Boolean);
    return this;
  }

  /** The write, applied the way migration 105's unique index applies it. */
  private commit(): Row[] {
    const row = this.pending!;
    const existing = this.conflict.length
      ? db[this.table].find(r => this.conflict.every(key => r[key] === row[key]))
      : undefined;
    if (existing) {
      Object.assign(existing, row);
      return [existing];
    }
    const inserted = { id: `row-${++seq}`, ...row };
    db[this.table].push(inserted);
    return [inserted];
  }

  private rows(): Row[] {
    if (this.pending) return this.commit();
    const matched = db[this.table].filter(r => this.filters.every(f => f(r)));
    // PATCH's two writes. Applied to the SAME objects the reads hand out, so an approval is
    // visible to the next GET without the fake having to model a transaction.
    if (this.patch) {
      for (const row of matched) Object.assign(row, this.patch);
      return matched;
    }
    if (this.deleting) {
      db[this.table] = db[this.table].filter(r => !matched.includes(r));
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

  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  then<R1 = { data: Row[] | null; error: unknown }, R2 = never>(
    onfulfilled?: ((v: { data: Row[] | null; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve({ data: this.rows(), error: null }).then(onfulfilled, onrejected);
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: (table: keyof typeof db) => new Query(table) }),
}));

const { GET, PATCH, POST } = await import('@/app/api/academy/tests/route');

// ── Fixtures ────────────────────────────────────────────────────────────────

const MANAGER = 'aaaa0000-0000-0000-0000-000000000001';
const COACH = 'aaaa0000-0000-0000-0000-000000000002';
const MINE = 'aaaa0000-0000-0000-0000-000000000003';
const THEIRS = 'aaaa0000-0000-0000-0000-000000000004';
const OUTSIDER = 'aaaa0000-0000-0000-0000-000000000005';

const DAY = 24 * 3_600_000;
/** `daysAgo` before the Israel calendar day, so the staleness clock is the real one. */
const day = (daysAgo: number) => israelToday(new Date(Date.parse(israelToday()) - daysAgo * DAY));

function athlete(id: string, over: Row = {}): Row {
  return {
    id,
    name: id.slice(-1),
    coach_id: COACH_ID,
    is_academy: true,
    academy_coach_id: COACH,
    academy_bands: { band_number: 5 },
    ...over,
  };
}

function asManager() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { athleteId: MANAGER, role: 'admin', isStaff: true, isSuperUser: false },
  });
}

function asCoach() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { athleteId: COACH, role: 'academy_coach', isStaff: true, isSuperUser: false },
  });
}

function asRunner(athleteId: string) {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { athleteId, role: 'runner', isStaff: false, isSuperUser: false },
  });
}

/** A 30-minute test covering `meters`, exactly as the form posts it. */
function body(athleteId: string, meters: number, over: Row = {}) {
  return {
    athleteId,
    date: israelToday(),
    protocol: '30min',
    durationSec: 1800,
    distanceM: meters,
    avgHr: null,
    notes: '',
    ...over,
  };
}

const post = (payload: unknown) =>
  POST(new Request('http://localhost/api/academy/tests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));

const get = (query = 'protocol=30min') =>
  GET(new Request(`http://localhost/api/academy/tests?${query}`));

const patch = (payload: unknown) =>
  PATCH(new Request('http://localhost/api/academy/tests', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));

beforeEach(() => {
  db.athletes = [
    athlete(MANAGER, { academy_coach_id: null }),
    athlete(COACH, { academy_coach_id: null }),
    athlete(MINE),
    athlete(THEIRS, { academy_coach_id: 'somebody-else' }),
    athlete(OUTSIDER, { is_academy: false }),
  ];
  db.academy_tests = [];
  seq = 0;
  resolveVerifiedCaller.mockReset();
});

// ── The loop ────────────────────────────────────────────────────────────────

describe('POST then GET — the coach saves, and the registry says so', () => {
  it('turns a saved test into a readable pace and clears the overdue queue', async () => {
    asManager();

    const before = await (await get()).json();
    const staleBefore = before.rows.find((r: any) => r.athleteId === MINE);
    expect(staleBefore.overdue).toBe(true);
    expect(staleBefore.lastPaceSec).toBeNull();

    const saved = await (await post(body(MINE, 6420))).json();
    // 6420m in 30:00 → 280.4 s/km, the form's 4:40. Read back out of the stored row, so
    // this asserts the round trip through `duration_sec` / `distance_m` and not the maths.
    expect(saved.test.distanceM).toBe(6420);
    expect(saved.test.durationSec).toBe(1800);
    expect(saved.test.date).toBe(israelToday());

    const after = await (await get()).json();
    const row = after.rows.find((r: any) => r.athleteId === MINE);
    expect(row.lastPaceSec).toBeCloseTo(280.37, 1);
    expect(row.overdue).toBe(false);
    expect(row.ageDays).toBe(0);
    // One test is a baseline, not a trend — the same distinction the screen draws.
    expect(row.deltaSec).toBeNull();
    expect(after.summary.noDelta).toBeGreaterThan(0);
  });

  it('reads a second test as improvement, in the direction a smaller pace means', async () => {
    asManager();
    await post(body(MINE, 5850, { date: day(200) }));
    await post(body(MINE, 6420));

    const registry = await (await get()).json();
    const row = registry.rows.find((r: any) => r.athleteId === MINE);
    expect(row.direction).toBe('improved');
    expect(row.deltaSec).toBeCloseTo(-27.3, 1);

    // And the athlete's own graph, off the same two rows.
    asRunner(MINE);
    const mine = await (await get(`protocol=30min&athleteId=${MINE}`)).json();
    expect(mine.trend.points.map((p: any) => p.date)).toEqual([day(200), israelToday()]);
    expect(mine.trend.totalDirection).toBe('improved');
  });

  it('treats re-recording the same day as a correction and not as a second test', async () => {
    asManager();
    await post(body(MINE, 6420));
    // The coach notices he typed the warm-up distance and saves again.
    const fixed = await (await post(body(MINE, 6480))).json();
    expect(fixed.test.distanceM).toBe(6480);

    const registry = await (await get()).json();
    const row = registry.rows.find((r: any) => r.athleteId === MINE);
    // One point, not two — otherwise the graph shows a same-day delta between a typo and
    // its fix, and calls it progress.
    expect(db.academy_tests).toHaveLength(1);
    expect(row.deltaSec).toBeNull();
  });

  it('does not let a blank reason field exclude the test it was recorded for', async () => {
    asManager();
    await post(body(MINE, 6420, { excludedReason: '   ' }));
    expect(db.academy_tests[0].excluded_reason).toBeNull();

    const registry = await (await get()).json();
    expect(registry.rows.find((r: any) => r.athleteId === MINE).lastPaceSec).not.toBeNull();
  });

  it('keeps an optional field optional without storing an empty string', async () => {
    asManager();
    await post(body(MINE, 6420, { avgHr: null, notes: '' }));
    expect(db.academy_tests[0].avg_hr).toBeNull();
    expect(db.academy_tests[0].notes).toBeNull();
    expect(db.academy_tests[0].author_id).toBe(MANAGER);
  });

  it('carries the heart rate and the note through when they are given', async () => {
    asManager();
    await post(body(MINE, 6420, { avgHr: 168, notes: 'מסלול הכנרת, רוח קלה' }));
    expect(db.academy_tests[0].avg_hr).toBe(168);
    expect(db.academy_tests[0].notes).toBe('מסלול הכנרת, רוח קלה');

    const registry = await (await get()).json();
    expect(registry.rows.find((r: any) => r.athleteId === MINE).lastPaceSec).toBeCloseTo(280.37, 1);
  });
});

// ── What must not get in ────────────────────────────────────────────────────

describe('POST — the gate', () => {
  it('refuses a test with only one of its two halves', async () => {
    asManager();
    for (const bad of [{ distanceM: 0 }, { durationSec: 0 }, { distanceM: null }]) {
      const res = await post(body(MINE, 6420, bad));
      expect(res.status).toBe(400);
    }
    expect(db.academy_tests).toHaveLength(0);
  });

  it('refuses a date that is not a date', async () => {
    asManager();
    expect((await post(body(MINE, 6420, { date: '14/09/2026' }))).status).toBe(400);
    expect((await post(body('', 6420))).status).toBe(400);
  });

  it('lets a coach record for their own trainee and nobody else\'s', async () => {
    asCoach();
    expect((await post(body(MINE, 6420))).status).toBe(200);
    // Not a 403 for the other coach's trainee at the membership layer — the coach may not
    // learn from the response that this athlete exists at all.
    expect((await post(body(THEIRS, 6420))).status).toBe(403);
  });

  it('says "not found" about somebody who is not in the academy', async () => {
    asManager();
    const res = await post(body(OUTSIDER, 6420));
    expect(res.status).toBe(404);
    expect(db.academy_tests).toHaveLength(0);
  });

  it('does not let an athlete RECORD their own test — only submit it', async () => {
    // This was a flat 403 until migration 108. It is now the records board's shape: the
    // number is accepted, but it is not a recorded test until staff say so, because this
    // one prices every workout in a plan. See the submission block at the bottom.
    asRunner(MINE);
    expect((await post(body(MINE, 6420))).status).toBe(200);
    expect(db.academy_tests[0].status).toBe('pending');
  });
});

// ── What the reader is allowed to see ───────────────────────────────────────

describe('GET — scope', () => {
  it('shows a coach their own trainees and the manager the whole academy', async () => {
    asManager();
    const all = await (await get()).json();
    expect(all.scope).toBe('academy');
    expect(all.rows.map((r: any) => r.athleteId).sort()).toEqual(
      [MANAGER, COACH, MINE, THEIRS].sort());

    asCoach();
    const ours = await (await get()).json();
    expect(ours.scope).toBe('coach');
    expect(ours.rows.map((r: any) => r.athleteId)).toEqual([MINE]);
  });

  it('refuses to answer an athlete asking about anyone but themselves', async () => {
    asRunner(MINE);
    expect((await get(`protocol=30min&athleteId=${THEIRS}`)).status).toBe(403);
    expect((await get()).status).toBe(403);
    expect((await get(`protocol=30min&athleteId=${MINE}`)).status).toBe(200);
  });

  it('answers 404 when a coach asks about a trainee who is not theirs', async () => {
    asCoach();
    expect((await get(`protocol=30min&athleteId=${THEIRS}`)).status).toBe(404);
  });

  it('never mixes two protocols into one series', async () => {
    asManager();
    await post(body(MINE, 5850, { date: day(200) }));
    await post(body(MINE, 2000, { protocol: '2000m', durationSec: 420 }));

    const half = await (await get()).json();
    expect(half.rows.find((r: any) => r.athleteId === MINE).deltaSec).toBeNull();

    const two = await (await get('protocol=2000m')).json();
    expect(two.rows.find((r: any) => r.athleteId === MINE).lastPaceSec).toBe(210);
  });

  it('returns a whole summary for an empty academy rather than a partial one', async () => {
    db.athletes = [];
    asManager();
    const empty = await (await get()).json();
    // Every key the KPI row reads. A missing one renders as `undefined` in the header.
    expect(empty.summary).toEqual({
      improved: 0, same: 0, regressed: 0, noDelta: 0, overdue: 0, neverTested: 0,
    });
    expect(empty.rows).toEqual([]);
  });
});

// ── The athlete submits, the coach decides ───────────────────────────────────
//
// Migration 108. The thing that must hold, in every one of these, is that a submission
// changes NOTHING until somebody approves it: not the pace on the registry, not the trend,
// not the staleness clock. A test that quietly counted while pending would be worse than no
// approval step at all, because the screen would claim a review that never happened.

describe('a trainee submits their own test', () => {
  it('stores it as pending, and pending moves nothing', async () => {
    asRunner(MINE);
    const res = await post(body(MINE, 6420));
    expect(res.status).toBe(200);
    expect((await res.json()).pending).toBe(true);

    const stored = db.academy_tests[0];
    expect(stored.status).toBe('pending');
    expect(stored.submitted_by).toBe(MINE);
    expect(stored.approved_at).toBeNull();

    // The registry the coach reads: the athlete is STILL overdue and still has no pace,
    // because nobody has looked at the number yet.
    asManager();
    const registry = await (await get()).json();
    const row = registry.rows.find((r: any) => r.athleteId === MINE);
    expect(row.lastPaceSec).toBeNull();
    expect(row.overdue).toBe(true);
    expect(registry.pending).toHaveLength(1);
    expect(registry.pending[0].paceSec).toBeCloseTo(280.37, 1);
    expect(registry.pending[0].name).toBe(db.athletes.find(a => a.id === MINE)!.name);
  });

  it('ignores the athleteId in the body and writes to the caller instead', async () => {
    // The whole attack in one line: a trainee posting somebody else's id.
    asRunner(MINE);
    const res = await post(body(THEIRS, 6420));
    expect(res.status).toBe(403);
    expect(db.academy_tests).toHaveLength(0);

    // And with no id at all, it still lands on the caller — the session is the source.
    const ok = await post({ ...body(MINE, 6420), athleteId: undefined });
    expect(ok.status).toBe(200);
    expect(db.academy_tests[0].athlete_id).toBe(MINE);
  });

  it('will not let a submission overwrite a test the coach already approved', async () => {
    asManager();
    await post(body(MINE, 6420));
    expect(db.academy_tests[0].status).toBe('approved');

    // Same athlete, same day, same protocol: the upsert WOULD have replaced the coach's
    // measured number with the athlete's own and flipped the row back to pending.
    asRunner(MINE);
    const res = await post(body(MINE, 7000));
    expect(res.status).toBe(409);
    expect(db.academy_tests).toHaveLength(1);
    expect(db.academy_tests[0].distance_m).toBe(6420);
    expect(db.academy_tests[0].status).toBe('approved');
  });

  it('lets the athlete correct their own submission while it is still waiting', async () => {
    asRunner(MINE);
    await post(body(MINE, 6420));
    const res = await post(body(MINE, 6500));
    expect(res.status).toBe(200);
    // One row, corrected — the same "a re-record is not a second test" rule as for a coach.
    expect(db.academy_tests).toHaveLength(1);
    expect(db.academy_tests[0].distance_m).toBe(6500);
    expect(db.academy_tests[0].status).toBe('pending');
  });

  it('does not let an athlete exclude their own test from the trend', async () => {
    asRunner(MINE);
    await post(body(MINE, 6420, { excludedReason: 'היה לי חם' }));
    // Accepting this would be a delete button on a bad day, worded as a reason.
    expect(db.academy_tests[0].excluded_reason).toBeNull();
  });

  it('refuses a submission for an athlete who is not in the academy', async () => {
    asRunner(OUTSIDER);
    const res = await post(body(OUTSIDER, 6420));
    expect(res.status).toBe(404);
    expect(db.academy_tests).toHaveLength(0);
  });

  it('shows the athlete their own pending submission on their own graph', async () => {
    asRunner(MINE);
    await post(body(MINE, 6420));
    const mine = await (await get(`protocol=30min&athleteId=${MINE}`)).json();
    // Not on the line yet — the graph is what approval changes — but named, so the screen
    // can say "sent, waiting" rather than showing nothing and looking broken.
    expect(mine.trend.points).toHaveLength(0);
    expect(mine.pending).toHaveLength(1);
    expect(mine.pending[0].distanceM).toBe(6420);
  });
});

describe('PATCH — the coach decides', () => {
  it('approving a submission is what puts it on the graph and clears the overdue flag', async () => {
    asRunner(MINE);
    await post(body(MINE, 6420));
    const testId = String(db.academy_tests[0].id);

    asManager();
    const res = await patch({ testId, action: 'approve' });
    expect(res.status).toBe(200);
    expect(db.academy_tests[0].status).toBe('approved');
    expect(db.academy_tests[0].approved_by).toBe(MANAGER);

    const registry = await (await get()).json();
    const row = registry.rows.find((r: any) => r.athleteId === MINE);
    expect(row.lastPaceSec).toBeCloseTo(280.37, 1);
    expect(row.overdue).toBe(false);
    expect(registry.pending).toHaveLength(0);
  });

  it('rejecting deletes the row rather than leaving a third state behind', async () => {
    asRunner(MINE);
    await post(body(MINE, 6420));
    const testId = String(db.academy_tests[0].id);

    asManager();
    expect((await patch({ testId, action: 'reject' })).status).toBe(200);
    expect(db.academy_tests).toHaveLength(0);
  });

  it('does not let a coach decide on somebody else\'s trainee, or learn that they exist', async () => {
    asRunner(THEIRS);
    await post(body(THEIRS, 6420));
    const testId = String(db.academy_tests[0].id);

    asCoach();
    const res = await patch({ testId, action: 'approve' });
    // 404 and not 403: the same answer a made-up id gets.
    expect(res.status).toBe(404);
    expect(db.academy_tests[0].status).toBe('pending');
  });

  it('does not let an athlete approve their own test', async () => {
    asRunner(MINE);
    await post(body(MINE, 6420));
    const testId = String(db.academy_tests[0].id);

    const res = await patch({ testId, action: 'approve' });
    expect(res.status).toBe(403);
    expect(db.academy_tests[0].status).toBe('pending');
  });

  it('refuses an unknown action rather than guessing which one was meant', async () => {
    asManager();
    const res = await patch({ testId: 'whatever', action: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('treats a coach entry as already approved, so it never reaches the queue', async () => {
    asCoach();
    await post(body(MINE, 6420));
    const registry = await (await get()).json();
    expect(registry.pending).toHaveLength(0);
    expect(db.academy_tests[0].approved_by).toBe(COACH);
    expect(db.academy_tests[0].submitted_by).toBeNull();
  });
});

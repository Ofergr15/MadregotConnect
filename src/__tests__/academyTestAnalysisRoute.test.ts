import { describe, expect, it, vi, beforeEach } from 'vitest';
import { COACH_ID } from '@/lib/constants';

/**
 * `/api/academy/test-analysis` — the coach's decision about a measurement.
 *
 * `academyTestAnalysis.test.ts` proves the arithmetic. This file is about the four things only
 * the route can get wrong:
 *
 *  - **Scope.** Thresholds and a band are the most consequential thing one coach could write onto
 *    another coach's trainee.
 *  - **The edit surviving.** A coach who corrects 4:45 to 4:52 must find 4:52 there afterwards,
 *    and the computed number must still be stored beside it.
 *  - **The signature having an effect.** Approving with a band has to move
 *    `athletes.academy_band_id`, which is the column the plan composer actually reads.
 *  - **Refusing nonsense.** These numbers become a pace alert on a watch.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

type Row = Record<string, unknown>;

const db: {
  academy_tests: Row[];
  athletes: Row[];
  academy_bands: Row[];
  academy_test_analyses: Row[];
} = { academy_tests: [], athletes: [], academy_bands: [], academy_test_analyses: [] };

/** Set to make the analyses table read as absent, the way it was before migration 113. */
let analysesMissing = false;

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private sort: { column: string; asc: boolean } | null = null;
  private max: number | null = null;
  private single = false;
  private written: Row | null = null;
  private error: unknown = null;

  constructor(private table: keyof typeof db) {
    if (table === 'academy_test_analyses' && analysesMissing) {
      this.error = { code: 'PGRST205', message: 'Could not find the table' };
    }
  }

  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push(r => r[column] === value); return this; }
  is(column: string, value: unknown) { this.filters.push(r => (r[column] ?? null) === value); return this; }
  lt(column: string, value: unknown) { this.filters.push(r => String(r[column]) < String(value)); return this; }
  order(column: string, opts?: { ascending?: boolean }) {
    this.sort = { column, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.single = true; return this; }

  upsert(row: Row, opts?: { onConflict?: string }) {
    if (this.error) return this;
    const key = opts?.onConflict || 'id';
    const at = db[this.table].findIndex(r => r[key] === row[key]);
    // Real upsert semantics matter here: the second save of one analysis must REPLACE the first,
    // or a coach editing twice leaves two thresholds in the table and nothing can say which one
    // the trainee is running on.
    if (at >= 0) db[this.table][at] = { ...db[this.table][at], ...row };
    else db[this.table].push({ id: `an-${db[this.table].length + 1}`, ...row });
    this.written = db[this.table][at >= 0 ? at : db[this.table].length - 1];
    return this;
  }

  update(patch: Row) {
    if (this.error) return this;
    this.written = patch;
    return this;
  }

  private settle() {
    if (this.error) return { data: null, error: this.error };
    if (this.written) {
      // An `update` is filtered, an `upsert` is not.
      if (!('id' in this.written)) {
        for (const row of db[this.table].filter(r => this.filters.every(f => f(r)))) Object.assign(row, this.written);
      }
      return { data: this.written, error: null };
    }
    let rows = db[this.table].filter(r => this.filters.every(f => f(r)));
    if (this.sort) {
      const { column, asc } = this.sort;
      rows = [...rows].sort((a, b) =>
        (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.max !== null) rows = rows.slice(0, this.max);
    return { data: this.single ? (rows[0] ?? null) : rows, error: null };
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.settle()).then(onfulfilled, onrejected);
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: (table: keyof typeof db) => new Query(table) }),
}));

const { GET, POST } = await import('@/app/api/academy/test-analysis/route');

function asCoach(athleteId = 'coach-1') {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'yossi@madregot.app', athleteId, role: 'academy_coach', isStaff: true, isSuperUser: false },
  });
}
function asManager() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'ofer@madregot.app', athleteId: 'boss', role: 'admin', isStaff: true, isSuperUser: true },
  });
}
function asTrainee() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'dor@x.com', athleteId: 'a1', role: 'runner', isStaff: false, isSuperUser: false },
  });
}

const get = (query: string) => GET(new Request(`http://x/api/academy/test-analysis?${query}`));
const post = (body: unknown) =>
  POST(new Request('http://x/api/academy/test-analysis', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  db.academy_tests = [
    // The mockup's own trainee: 6.42 km in thirty minutes.
    { id: 't1', athlete_id: 'a1', test_date: '2026-09-14', protocol: '30min', duration_sec: 1800, distance_m: 6420, avg_hr: 178, excluded_reason: null },
    { id: 't0', athlete_id: 'a1', test_date: '2026-05-10', protocol: '30min', duration_sec: 1800, distance_m: 6200, avg_hr: 175, excluded_reason: null },
    { id: 'tb', athlete_id: 'b1', test_date: '2026-09-14', protocol: '30min', duration_sec: 1800, distance_m: 5800, avg_hr: 170, excluded_reason: null },
  ];
  db.athletes = [
    { id: 'a1', name: 'Dor Alon', is_academy: true, academy_coach_id: 'coach-1', academy_band_id: null, coach_id: COACH_ID },
    { id: 'b1', name: 'Avi Barak', is_academy: true, academy_coach_id: 'coach-2', academy_band_id: null, coach_id: COACH_ID },
  ];
  db.academy_bands = [
    { id: 'band-6', band_number: 6, name: 'דבוקה 6', goal: null, pace_profile: {}, active: true, sort_order: 6 },
    { id: 'band-7', band_number: 7, name: 'דבוקה 7', goal: null, pace_profile: {}, active: true, sort_order: 7 },
    { id: 'band-old', band_number: 3, name: 'דבוקה 3', goal: null, pace_profile: {}, active: false, sort_order: 3 },
  ];
  db.academy_test_analyses = [];
  analysesMissing = false;
  asCoach();
});

describe('reading the draft', () => {
  it('derives the thresholds from the test on every request', async () => {
    const res = await get('testId=t1');
    expect(res.status).toBe(200);
    const body = await res.json();
    // 1800 / 6.42 = 280 s/km.
    expect(body.derived.thresholdPaceSec).toBe(280);
    expect(body.derived.easyPaceSec).toBeGreaterThan(280);
    expect(body.derived.intervalPaceSec).toBeLessThan(280);
    expect(body.derived.avgHrBpm).toBe(178);
  });

  it('compares against the previous test of the same protocol', async () => {
    // 1800/6.2 = 290, so this trainee is 10 s/km faster than in May.
    const body = await (await get('testId=t1')).json();
    expect(Math.round(body.previousPaceSec)).toBe(290);
    expect(body.draftSummary).toContain('מהר יותר');
  });

  it('says why there is no band recommendation instead of leaving it empty', async () => {
    const body = await (await get('testId=t1')).json();
    expect(body.recommendation.bandId).toBeNull();
    expect(body.recommendation.reason).toBe('bands_have_no_paces');
  });

  it('recommends a band once the bands have thresholds recorded', async () => {
    db.academy_bands[0].pace_profile = { thresholdPaceSec: 285 };
    db.academy_bands[1].pace_profile = { thresholdPaceSec: 330 };
    const body = await (await get('testId=t1')).json();
    expect(body.recommendation.bandNumber).toBe(6);
    expect(body.recommendation.gapSec).toBe(5);
  });

  it('reports a saved decision beside the fresh computation, not instead of it', async () => {
    // The whole reason migration 113 stores both. A stored 290 with a computed 280 is the state a
    // coach edit produces, and the screen has to be able to show that it was an edit.
    db.academy_test_analyses.push({
      id: 'an-1', test_id: 't1', athlete_id: 'a1',
      derived: { thresholdPaceSec: 280 }, approved: { thresholdPaceSec: 290 },
      band_id: 'band-7', status: 'approved', approved_at: '2026-09-15T08:00:00.000Z',
    });
    const body = await (await get('testId=t1')).json();
    expect(body.analysis.approved.thresholdPaceSec).toBe(290);
    expect(body.derived.thresholdPaceSec).toBe(280);
  });

  it('describes a missing table rather than failing the whole screen', async () => {
    analysesMissing = true;
    const body = await (await get('testId=t1')).json();
    expect(body.tableMissing).toBe(true);
    // The draft is still computable without the table — it is arithmetic on the test.
    expect(body.derived.thresholdPaceSec).toBe(280);
  });

  it('needs a testId', async () => {
    expect((await get('')).status).toBe(400);
  });
});

describe('who may analyse whom', () => {
  it('is closed to the trainee whose test it is', async () => {
    // Their thresholds, but not their screen: what a trainee receives is the summary, not an
    // unapproved draft with a band recommendation in it.
    asTrainee();
    expect((await get('testId=t1')).status).toBe(403);
    expect((await post({ testId: 't1', status: 'approved' })).status).toBe(403);
  });

  it('refuses another coach trainee, both reading and writing', async () => {
    expect((await get('testId=tb')).status).toBe(403);
    expect((await post({ testId: 'tb', status: 'approved' })).status).toBe(403);
    expect(db.academy_test_analyses).toEqual([]);
  });

  it('lets the manager analyse anyone', async () => {
    asManager();
    expect((await get('testId=tb')).status).toBe(200);
  });

  it('404s an unknown test rather than saying whose it is', async () => {
    expect((await get('testId=ghost')).status).toBe(404);
  });
});

describe('saving a draft', () => {
  it('stores the computed numbers when the coach sends none', async () => {
    const res = await post({ testId: 't1', status: 'draft' });
    expect(res.status).toBe(200);
    const row = db.academy_test_analyses[0];
    expect(row.status).toBe('draft');
    expect((row.approved as Record<string, number>).thresholdPaceSec).toBe(280);
    expect((row.derived as Record<string, number>).thresholdPaceSec).toBe(280);
    expect(row.approved_at).toBeNull();
  });

  it('keeps the coach edit and the computed number side by side', async () => {
    // The hilly-course case, and the reason `derived` exists. A coach who believes 4:52 must find
    // 4:52 there afterwards, with the formula's 4:40 still visible beside it.
    await post({ testId: 't1', status: 'draft', approved: { thresholdPaceSec: 292, easyPaceSec: 350, intervalPaceSec: 265 } });
    const row = db.academy_test_analyses[0];
    expect((row.approved as Record<string, number>).thresholdPaceSec).toBe(292);
    expect((row.derived as Record<string, number>).thresholdPaceSec).toBe(280);
  });

  it('replaces the earlier save rather than adding a second opinion', async () => {
    await post({ testId: 't1', status: 'draft' });
    await post({ testId: 't1', status: 'draft', summary: 'עדכון' });
    expect(db.academy_test_analyses).toHaveLength(1);
    expect(db.academy_test_analyses[0].summary).toBe('עדכון');
  });

  it('does not assign a band from a draft', async () => {
    // A draft changes nothing the trainee or the planner can see. That is what makes it a draft.
    await post({ testId: 't1', status: 'draft', bandId: 'band-6' });
    expect(db.athletes[0].academy_band_id).toBeNull();
  });

  it('refuses a pace no human runs', async () => {
    // 0:45/km is a typo, and this number becomes the alert on a watch for eight repetitions.
    await post({ testId: 't1', status: 'draft', approved: { thresholdPaceSec: 45 } });
    // Falls back to the computed set rather than storing the typo.
    expect((db.academy_test_analyses[0].approved as Record<string, number>).thresholdPaceSec).toBe(280);
  });

  it('refuses a heart rate outside what a person has', async () => {
    await post({ testId: 't1', status: 'draft', approved: { thresholdPaceSec: 280, avgHrBpm: 400 } });
    expect((db.academy_test_analyses[0].approved as Record<string, number>).avgHrBpm).toBe(178);
  });
});

describe('approving', () => {
  it('signs the analysis and assigns the band', async () => {
    // The signature has to have an effect: `athletes.academy_band_id` is what the plan composer
    // reads, and an approval that did not move it would be a decision with no consequence.
    const res = await post({ testId: 't1', status: 'approved', bandId: 'band-6', summary: 'סיכום' });
    expect(res.status).toBe(200);
    expect((await res.json()).bandAssigned).toBe(true);
    const row = db.academy_test_analyses[0];
    expect(row.status).toBe('approved');
    expect(row.approved_at).toBeTruthy();
    expect(row.approved_by).toBe('coach-1');
    expect(db.athletes[0].academy_band_id).toBe('band-6');
  });

  it('records the recommendation beside the decision, even when they agree', async () => {
    // "You went with it" and "you overrode it" is the only evidence that will ever say whether the
    // recommendation is any good, and one column would throw that away at the moment of the tap.
    db.academy_bands[0].pace_profile = { thresholdPaceSec: 282 };
    await post({ testId: 't1', status: 'approved', bandId: 'band-6' });
    expect(db.academy_test_analyses[0].recommended_band_id).toBe('band-6');
    expect(db.academy_test_analyses[0].band_id).toBe('band-6');
  });

  it('can be approved without a band, leaving the assignment for later', async () => {
    const res = await post({ testId: 't1', status: 'approved' });
    expect(res.status).toBe(200);
    expect(db.academy_test_analyses[0].status).toBe('approved');
    expect(db.athletes[0].academy_band_id).toBeNull();
  });

  it('refuses a band nobody trains in', async () => {
    const res = await post({ testId: 't1', status: 'approved', bandId: 'band-old' });
    expect(res.status).toBe(400);
    expect(db.academy_test_analyses).toEqual([]);
  });

  it('refuses a test whose numbers cannot produce an analysis', async () => {
    db.academy_tests.push({ id: 'bad', athlete_id: 'a1', test_date: '2026-09-18', protocol: '30min', duration_sec: 1800, distance_m: 0, avg_hr: null, excluded_reason: null });
    expect((await post({ testId: 'bad', status: 'approved' })).status).toBe(400);
  });

  it('answers 503 when the table is not there, rather than a silent success', async () => {
    analysesMissing = true;
    expect((await post({ testId: 't1', status: 'approved' })).status).toBe(503);
  });
});

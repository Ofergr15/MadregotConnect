import { describe, expect, it, vi, beforeEach } from 'vitest';
import { COACH_ID } from '@/lib/constants';

/**
 * `/api/academy/payments` — payment status beside coaching status.
 *
 * `academyPayments.test.ts` proves the arithmetic and the judgements. This file is about the four
 * things only the route can get wrong:
 *
 *  - **Who may look.** What one trainee pays and what a mentor earns are the two facts in this app
 *    that no colleague is entitled to, so this route is manager-only — stricter than every other
 *    academy staff route.
 *  - **Marking the right month.** A tap in October must not land on September.
 *  - **Marking twice.** A double tap is one paid month, not two months of revenue.
 *  - **Migration 115 not being pasted.** Everything here is hand-pasted; the screen has to be able
 *    to say so rather than render eighteen people as unpaid.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

type Row = Record<string, unknown>;

const db: {
  athletes: Row[];
  academy_bands: Row[];
  academy_billing: Row[];
  academy_payments: Row[];
  academy_coach_pay: Row[];
} = { athletes: [], academy_bands: [], academy_billing: [], academy_payments: [], academy_coach_pay: [] };

/** Set to make the three tables of migration 115 read as absent. */
let billingMissing = false;

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private single = false;
  private written: Row | null = null;
  private removing = false;
  private error: unknown = null;

  constructor(private table: keyof typeof db) {
    if (billingMissing && table.startsWith('academy_') && table !== 'academy_bands') {
      this.error = { code: 'PGRST205', message: 'Could not find the table' };
    }
  }

  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push(r => r[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push(r => values.includes(r[column])); return this; }
  maybeSingle() { this.single = true; return this; }
  delete() { this.removing = true; return this; }

  upsert(row: Row, opts?: { onConflict?: string }) {
    if (this.error) return this;
    const keys = (opts?.onConflict || 'id').split(',').map(k => k.trim());
    const at = db[this.table].findIndex(r => keys.every(k => r[k] === row[k]));
    // Real upsert semantics, because the double tap is the point: marking a month paid twice must
    // be one row, or the revenue total counts a month it collected once.
    if (at >= 0) db[this.table][at] = { ...db[this.table][at], ...row };
    else db[this.table].push({ id: `r-${db[this.table].length + 1}`, ...row });
    this.written = db[this.table][at >= 0 ? at : db[this.table].length - 1];
    return this;
  }

  private settle() {
    if (this.error) return { data: null, error: this.error };
    if (this.removing) {
      db[this.table] = db[this.table].filter(r => !this.filters.every(f => f(r)));
      return { data: null, error: null };
    }
    if (this.written) return { data: this.written, error: null };
    const rows = db[this.table].filter(r => this.filters.every(f => f(r)));
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

const { GET, POST } = await import('@/app/api/academy/payments/route');

function asManager() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'ofer@madregot.app', athleteId: 'boss', role: 'admin', isStaff: true, isSuperUser: true },
  });
}
function asCoach() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'dani@madregot.app', athleteId: 'coach-1', role: 'academy_coach', isStaff: true, isSuperUser: false },
  });
}
function asTrainee() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'dor@x.com', athleteId: 'a1', role: 'runner', isStaff: false, isSuperUser: false },
  });
}

const get = (query = '') => GET(new Request(`http://x/api/academy/payments?${query}`));
const post = (body: unknown) =>
  POST(new Request('http://x/api/academy/payments', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  db.athletes = [
    { id: 'a1', name: 'Dor Alon', is_academy: true, coach_id: COACH_ID, academy_coach_id: 'coach-1', academy_band_id: 'band-7', academy_joined_on: '2026-02-01' },
    { id: 'a2', name: 'Yael Peretz', is_academy: true, coach_id: COACH_ID, academy_coach_id: 'coach-1', academy_band_id: 'band-7', academy_joined_on: '2026-03-01' },
    // A club member who is not in the academy. Nothing on this screen is about them.
    { id: 'z1', name: 'Club Runner', is_academy: false, coach_id: COACH_ID, academy_coach_id: null, academy_band_id: null, academy_joined_on: null },
    { id: 'coach-1', name: 'Dani', is_academy: false, coach_id: COACH_ID, academy_coach_id: null, academy_band_id: null, academy_joined_on: null },
  ];
  db.academy_bands = [{ id: 'band-7', band_number: 7 }];
  db.academy_billing = [
    { athlete_id: 'a1', status: 'active', monthly_amount_ils: 800, link_sent_at: null, activated_at: '2026-03-01T00:00:00.000Z', failed_at: null, cancelled_at: null, note: null },
    { athlete_id: 'a2', status: 'link_sent', monthly_amount_ils: 800, link_sent_at: '2026-01-01T00:00:00.000Z', activated_at: null, failed_at: null, cancelled_at: null, note: null },
  ];
  db.academy_payments = [];
  db.academy_coach_pay = [{ coach_id: 'coach-1', per_trainee_ils: 220, monthly_flat_ils: null, active: true }];
  billingMissing = false;
  asManager();
});

describe('who may look at the money', () => {
  it('is manager only, unlike every other academy staff route', () => {
    // A coach-scoped version of this screen would still show one mentor the club's arrangement
    // with their own trainees, and the payout table shows what every mentor earns.
    asCoach();
    return Promise.all([
      get().then(r => expect(r.status).toBe(403)),
      post({ athleteId: 'a1', action: 'mark_paid' }).then(r => expect(r.status).toBe(403)),
    ]);
  });

  it('is closed to the trainee whose fee it is', async () => {
    asTrainee();
    expect((await get()).status).toBe(403);
    expect((await post({ athleteId: 'a1', action: 'mark_paid' })).status).toBe(403);
    expect(db.academy_payments).toEqual([]);
  });
});

describe('reading the board', () => {
  it('lists only academy trainees, with their band and mentor', async () => {
    const body = await (await get()).json();
    expect(body.board.rows).toHaveLength(2);
    expect(body.board.rows.map((r: { name: string }) => r.name)).not.toContain('Club Runner');
    expect(body.board.rows[0]).toMatchObject({ bandNumber: 7, coachName: 'Dani' });
  });

  it('names who is being coached for free', async () => {
    const body = await (await get('period=2026-09-14')).json();
    expect(body.period).toBe('2026-09-01');
    expect(body.board.freeRiders.map((r: { name: string }) => r.name)).toEqual(['Yael Peretz']);
  });

  it('describes a missing table instead of rendering everybody as unpaid', async () => {
    // Migration 115 is pasted by hand. "Nobody has a standing order" would draw a red box with
    // eighteen names in it, which is the most alarming possible way to report a missing migration.
    billingMissing = true;
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tableMissing).toBe(true);
    expect(body.board).toBeNull();
    expect(body.trainees).toBe(2);
  });

  it('reports the mentor payout and says when a rate is missing', async () => {
    db.academy_coach_pay = [];
    const body = await (await get()).json();
    expect(body.payouts).toHaveLength(1);
    expect(body.payouts[0]).toMatchObject({ trainees: 2, rateMissing: true, payoutIls: 0 });
    expect(body.ratesMissing).toBe(true);
  });

  it('labels the per-trainee economics with what they were averaged over', async () => {
    const body = await (await get()).json();
    expect(body.economicsBasis).toMatchObject({ feesRecorded: 2, trainees: 2 });
    expect(body.economics.grossIls).toBe(800);
  });
});

describe('marking a month', () => {
  it('records the month, the amount and who marked it', async () => {
    const res = await post({ athleteId: 'a1', action: 'mark_paid', period: '2026-09-20' });
    expect(res.status).toBe(200);
    expect(db.academy_payments).toHaveLength(1);
    expect(db.academy_payments[0]).toMatchObject({
      athlete_id: 'a1', period: '2026-09-01', amount_ils: 800, source: 'manual', marked_by: 'boss',
    });
  });

  it('is one row however many times it is tapped', async () => {
    await post({ athleteId: 'a1', action: 'mark_paid', period: '2026-09-01' });
    await post({ athleteId: 'a1', action: 'mark_paid', period: '2026-09-01' });
    expect(db.academy_payments).toHaveLength(1);
  });

  it('copies the fee rather than joining it, so a later price change cannot rewrite the past', async () => {
    await post({ athleteId: 'a1', action: 'mark_paid', period: '2026-09-01' });
    db.academy_billing[0].monthly_amount_ils = 950;
    expect(db.academy_payments[0].amount_ils).toBe(800);
  });

  it('never writes the automation source from a human tap', async () => {
    // 'go_email' exists for an automation nobody has decided on. Writing it here would erase the
    // difference between a month a parser guessed and a month a human vouched for.
    await post({ athleteId: 'a1', action: 'mark_paid', source: 'go_email' });
    expect(db.academy_payments[0].source).toBe('manual');
  });

  it('refuses an impossible amount rather than storing a slipped decimal', async () => {
    await post({ athleteId: 'a1', action: 'mark_paid', amountIls: 80000 });
    // Falls back to the agreed fee instead of a number that would land in the revenue KPI.
    expect(db.academy_payments[0].amount_ils).toBe(800);
  });

  it('undoes a marking without touching any other month', async () => {
    await post({ athleteId: 'a1', action: 'mark_paid', period: '2026-08-01' });
    await post({ athleteId: 'a1', action: 'mark_paid', period: '2026-09-01' });
    await post({ athleteId: 'a1', action: 'unmark_paid', period: '2026-09-01' });
    expect(db.academy_payments.map(r => r.period)).toEqual(['2026-08-01']);
  });

  it('refuses somebody who is not an academy trainee', async () => {
    expect((await post({ athleteId: 'z1', action: 'mark_paid' })).status).toBe(404);
    expect((await post({ athleteId: 'ghost', action: 'mark_paid' })).status).toBe(404);
    expect(db.academy_payments).toEqual([]);
  });

  it('answers 503 while migration 115 is unpasted, rather than a silent success', async () => {
    billingMissing = true;
    const res = await post({ athleteId: 'a1', action: 'mark_paid' });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('table_missing');
  });
});

describe('the standing order status', () => {
  it('stamps the transition it is about', async () => {
    await post({ athleteId: 'a1', action: 'link_sent' });
    expect(db.academy_billing[0]).toMatchObject({ status: 'link_sent' });
    expect(db.academy_billing[0].link_sent_at).toBeTruthy();
  });

  it('keeps the earlier timestamps when a status is reset', async () => {
    // The timestamps are the record of what happened. Clearing them would make a re-sent link look
    // like a first one, and the red box is built on how long a link has been out there.
    await post({ athleteId: 'a2', action: 'reset' });
    expect(db.academy_billing[1]).toMatchObject({ status: 'none', link_sent_at: '2026-01-01T00:00:00.000Z' });
  });

  it('creates the row for a trainee who has never had one', async () => {
    db.academy_billing = [];
    await post({ athleteId: 'a1', action: 'activate', monthlyAmountIls: 640 });
    expect(db.academy_billing[0]).toMatchObject({ athlete_id: 'a1', status: 'active', monthly_amount_ils: 640 });
    expect(db.academy_billing[0].activated_at).toBeTruthy();
  });

  it('refuses an action it does not recognise instead of writing a status nothing reads', async () => {
    const res = await post({ athleteId: 'a1', action: 'paid_in_cash_probably' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('bad_action');
  });

  it('needs an athlete', async () => {
    expect((await post({ action: 'link_sent' })).status).toBe(400);
  });
});

describe('what a mentor is paid', () => {
  it('stores a flat fee, a per-head amount, or both', async () => {
    expect((await post({ action: 'set_coach_pay', coachId: 'coach-1', monthlyFlatIls: 1320 })).status).toBe(200);
    expect(db.academy_coach_pay[0]).toMatchObject({ coach_id: 'coach-1', monthly_flat_ils: 1320 });
  });

  it('refuses a rate with no amount in it', async () => {
    // Migration 115's own CHECK, refused here so the screen gets a sentence: a mentor row that
    // cannot produce a number would make the payout table silently short.
    const res = await post({ action: 'set_coach_pay', coachId: 'coach-1' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('no_amount');
  });

  it('needs a coach', async () => {
    expect((await post({ action: 'set_coach_pay', monthlyFlatIls: 1320 })).status).toBe(400);
  });
});

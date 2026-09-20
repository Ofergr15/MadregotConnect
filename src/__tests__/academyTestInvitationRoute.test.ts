import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `GET|POST|PATCH /api/academy/test-invitation` — the trainee's own write path.
 *
 * `academyTestInvite.test.ts` proves the reading: which state a row is in and when the
 * reminders are due. This file is about the things that can only go wrong at the route, and
 * one of them is the reason the route exists at all:
 *
 *  - **A trainee must not be able to name their own test time.** The reminders are computed
 *    from `confirmed_slot`, so a trainee who can set an arbitrary slot can push the follow-up
 *    nag — the one mechanism built to notice the test never happened — out of reach, while the
 *    screen still reads "confirmed". Staff CAN set any time, which is the asymmetry under test.
 *  - **A trainee must not be able to answer somebody else's invitation**, and the athleteId in
 *    the request must never be what decides whose row is touched.
 *  - **There is no trainee-facing cancel.** "I cannot do this" has to arrive as `other`, which
 *    reaches the coach and keeps the person in the funnel.
 *  - **Nothing here moves the funnel.** `academy_candidate_events` stays empty in every case.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

type Row = Record<string, unknown>;

const db: {
  academy_test_invitations: Row[];
  athletes: Row[];
  academy_candidate_events: Row[];
  // Read by GET for one purpose: an invitation whose result is already sitting in the approval
  // queue must not go on asking the trainee to record a result they have already sent.
  academy_tests: Row[];
  // Where the two reminders live. Migration 112 chose this table over a second reminder engine,
  // so "did confirming arm anything?" is a question about rows here.
  scheduled_notifications: Row[];
} = {
  academy_test_invitations: [], athletes: [], academy_candidate_events: [], academy_tests: [],
  scheduled_notifications: [],
};
let seq = 0;

/** The partial unique index from migration 112: one OPEN invitation per athlete. */
const OPEN = ['proposed', 'confirmed', 'other'];
function duplicatesAnOpenInvitation(row: Row): boolean {
  if (!OPEN.includes(String(row.status))) return false;
  return db.academy_test_invitations.some(
    r => r.athlete_id === row.athlete_id && OPEN.includes(String(r.status)),
  );
}

class Query implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private inserting: Row | null = null;
  private patch: Row | null = null;
  private error: unknown = null;

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

  limit(n: number) {
    this.max = n;
    return this;
  }

  insert(row: Row) {
    if (this.table === 'academy_test_invitations' && duplicatesAnOpenInvitation(row)) {
      this.error = { code: '23505', message: 'duplicate key value violates unique constraint' };
      return this;
    }
    const defaults: Row = this.table === 'academy_test_invitations'
      ? {
        created_at: '2026-09-15T00:00:00.000Z',
        updated_at: '2026-09-15T00:00:00.000Z',
        confirmed_slot: null,
        confirmed_at: null,
        requested_note: null,
        test_id: null,
      }
      : {};
    this.inserting = {
      id: `${this.table === 'scheduled_notifications' ? 'notif' : 'inv'}-${++seq}`,
      ...defaults,
      ...row,
    };
    db[this.table].push(this.inserting);
    return this;
  }

  update(row: Row) {
    this.patch = row;
    return this;
  }

  private rows(): Row[] {
    if (this.error) return [];
    if (this.inserting) return [this.inserting];
    const matched = db[this.table].filter(r => this.filters.every(f => f(r)));

    if (this.patch) {
      for (const row of matched) Object.assign(row, this.patch);
      return matched;
    }

    let rows = matched;
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) =>
        String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
    }
    return this.max === null ? rows : rows.slice(0, this.max);
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

const { GET, PATCH, POST } = await import('@/app/api/academy/test-invitation/route');

// Far enough ahead that these stay in the future for the life of the repo: the route drops past
// slots, and a fixture that expires turns this file into a time bomb.
const SOON = '2099-09-17T04:00:00.000Z';
const ALT = '2099-09-18T04:00:00.000Z';
const NOT_OFFERED = '2099-12-25T04:00:00.000Z';

function asStaff(athleteId = 'coach-1', role = 'academy_coach') {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'yossi@madregot.app', athleteId, role, isStaff: true, isSuperUser: false },
  });
}
function asManager() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'ofer@madregot.app', athleteId: 'boss', role: 'admin', isStaff: true, isSuperUser: true },
  });
}
/** The trainee the invitation belongs to. */
function asTrainee(athleteId = 'a1') {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'dor@x.com', athleteId, role: 'runner', isStaff: false, isSuperUser: false },
  });
}

const post = (body: unknown) =>
  POST(new Request('http://x/api/academy/test-invitation', { method: 'POST', body: JSON.stringify(body) }));
const patch = (body: unknown) =>
  PATCH(new Request('http://x/api/academy/test-invitation', { method: 'PATCH', body: JSON.stringify(body) }));
const get = (query = '') =>
  GET(new Request(`http://x/api/academy/test-invitation${query}`));

/** An open invitation for `a1`, offering SOON and ALT. */
function seedInvitation(over: Row = {}): Row {
  const row: Row = {
    id: 'inv-seed',
    athlete_id: 'a1',
    protocol: '30min',
    proposed_slots: [SOON, ALT],
    confirmed_slot: null,
    confirmed_at: null,
    status: 'proposed',
    requested_note: null,
    test_id: null,
    created_at: '2026-09-15T00:00:00.000Z',
    updated_at: '2026-09-15T00:00:00.000Z',
    ...over,
  };
  db.academy_test_invitations.push(row);
  return row;
}

/** A result `a1` has sent in and nobody has approved. */
function seedSubmission(over: Row = {}): Row {
  const row: Row = {
    id: 'test-1',
    athlete_id: 'a1',
    protocol: '30min',
    test_date: '2026-09-16',
    submitted_at: '2026-09-16T17:00:00.000Z',
    status: 'pending',
    ...over,
  };
  db.academy_tests.push(row);
  return row;
}

beforeEach(() => {
  db.academy_test_invitations = [];
  db.academy_candidate_events = [];
  db.academy_tests = [];
  db.scheduled_notifications = [];
  // `a1` is the coach's own trainee; `a2` belongs to somebody else's coach.
  db.athletes = [
    { id: 'a1', name: 'Dor Alon', academy_coach_id: 'coach-1' },
    { id: 'a2', name: 'Noa Shemesh', academy_coach_id: 'coach-2' },
  ];
  seq = 0;
  asStaff();
});

describe('inviting somebody to test', () => {
  it('creates an invitation with the offered times in order', async () => {
    const res = await post({ athleteId: 'a1', slots: [SOON, ALT] });
    expect(res.status).toBe(200);
    const { invitation } = await res.json();
    expect(invitation).toMatchObject({ athleteId: 'a1', status: 'proposed', protocol: '30min' });
    // Order is meaning here: the first slot is the one being asked for.
    expect(invitation.proposedSlots).toEqual([SOON, ALT]);
  });

  it('drops a slot that has already gone rather than refusing the whole invitation', async () => {
    // A coach building next week's invitations at midnight should not get a 400 because one
    // chip in the list has just expired.
    const res = await post({ athleteId: 'a1', slots: ['2020-01-01T00:00:00Z', SOON] });
    expect(res.status).toBe(200);
    expect((await res.json()).invitation.proposedSlots).toEqual([SOON]);
  });

  it('refuses an invitation with no future time in it at all', async () => {
    const res = await post({ athleteId: 'a1', slots: ['2020-01-01T00:00:00Z'] });
    expect(res.status).toBe(400);
    expect(db.academy_test_invitations).toHaveLength(0);
  });

  it('refuses a second open invitation for the same athlete, and says why', async () => {
    seedInvitation();
    const res = await post({ athleteId: 'a1', slots: [SOON] });
    // The coach's next move is to look at the open one, not to retry.
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already has an open/i);
  });

  it('allows a new invitation once the old one is closed', async () => {
    // "We invited him three times and he never ran it" has to remain expressible.
    seedInvitation({ status: 'cancelled' });
    const res = await post({ athleteId: 'a1', slots: [SOON] });
    expect(res.status).toBe(200);
    expect(db.academy_test_invitations).toHaveLength(2);
  });

  it('refuses a coach inviting another coach’s trainee', async () => {
    const res = await post({ athleteId: 'a2', slots: [SOON] });
    expect(res.status).toBe(403);
    expect(db.academy_test_invitations).toHaveLength(0);
  });

  it('lets a manager invite anybody', async () => {
    asManager();
    expect((await post({ athleteId: 'a2', slots: [SOON] })).status).toBe(200);
  });

  it('refuses a non-existent athlete before the foreign key does', async () => {
    const res = await post({ athleteId: 'nobody', slots: [SOON] });
    expect(res.status).toBe(404);
  });

  it('is closed to the trainee entirely', async () => {
    // Inviting yourself to a test sets your own reminder schedule.
    asTrainee();
    expect((await post({ athleteId: 'a1', slots: [SOON] })).status).toBe(403);
  });
});

describe('the trainee answering', () => {
  it('confirms one of the offered times', async () => {
    const row = seedInvitation();
    asTrainee();
    const res = await patch({ id: row.id, action: 'confirm', slot: ALT });
    expect(res.status).toBe(200);
    const { invitation } = await res.json();
    expect(invitation).toMatchObject({ status: 'confirmed', confirmedSlot: ALT });
    expect(row.confirmed_at).toBeTruthy();
  });

  it('REFUSES a time that was never offered', async () => {
    // The whole security point of the route. The reminders are computed from `confirmed_slot`,
    // so an arbitrary slot moves the follow-up nag out of reach while the screen still reads
    // "confirmed" — the one mechanism built to catch a forgotten test, switched off by the
    // person it was built for. Not malice: "let me put it off" is the most natural tap there is.
    const row = seedInvitation();
    asTrainee();
    const res = await patch({ id: row.id, action: 'confirm', slot: NOT_OFFERED });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/offered/i);
    expect(row.status).toBe('proposed');
    expect(row.confirmed_slot).toBeNull();
  });

  it('accepts either spelling of the same instant', async () => {
    // The offered list comes back from Postgres as `+00:00`; the chip may send `Z`. Refusing
    // that would make every confirm fail for a reason no user could act on.
    const row = seedInvitation({ proposed_slots: ['2099-09-17T04:00:00+00:00'] });
    asTrainee();
    const res = await patch({ id: row.id, action: 'confirm', slot: '2099-09-17T04:00:00Z' });
    expect(res.status).toBe(200);
  });

  it('asks for another time, with the note kept', async () => {
    const row = seedInvitation();
    asTrainee();
    const res = await patch({ id: row.id, action: 'other', note: '  עובד במשמרות עד ה-20  ' });
    expect(res.status).toBe(200);
    expect((await res.json()).invitation).toMatchObject({
      status: 'other',
      requestedNote: 'עובד במשמרות עד ה-20',
    });
  });

  it('allows an empty note, because "none of these work" is itself an answer', async () => {
    const row = seedInvitation();
    asTrainee();
    const res = await patch({ id: row.id, action: 'other' });
    expect(res.status).toBe(200);
    expect((await res.json()).invitation.requestedNote).toBeNull();
  });

  it('clears a previous confirmation when asking for another time', async () => {
    // Otherwise the row says both "confirmed for Thursday" and "cannot make Thursday", and the
    // reminder fires for a slot the athlete has withdrawn from.
    const row = seedInvitation({ status: 'confirmed', confirmed_slot: SOON, confirmed_at: 'x' });
    asTrainee();
    await patch({ id: row.id, action: 'other', note: 'לא מסתדר' });
    expect(row.confirmed_slot).toBeNull();
    expect(row.status).toBe('other');
  });

  it('cannot cancel', async () => {
    // No trainee-facing cancel on purpose: one tap would turn an engaged candidate into a
    // silent row and the academy would learn nothing. The honest version is `other`.
    const row = seedInvitation();
    asTrainee();
    const res = await patch({ id: row.id, action: 'cancel' });
    expect(res.status).toBe(403);
    expect(row.status).toBe('proposed');
  });

  it('cannot answer another coach’s invitation', async () => {
    const row = seedInvitation();
    asTrainee('a2');
    const res = await patch({ id: row.id, action: 'confirm', slot: SOON });
    expect(res.status).toBe(403);
    expect(row.status).toBe('proposed');
  });

  it('refuses an unknown action rather than doing nothing quietly', async () => {
    const row = seedInvitation();
    asTrainee();
    expect((await patch({ id: row.id, action: 'postpone' })).status).toBe(400);
    expect(row.status).toBe('proposed');
  });

  it('refuses to re-open a closed invitation', async () => {
    // A stale tab confirming a slot after the result was recorded would resurrect a finished
    // invitation and re-arm its follow-up nag.
    const row = seedInvitation({ status: 'done', test_id: 't1' });
    asTrainee();
    const res = await patch({ id: row.id, action: 'confirm', slot: SOON });
    expect(res.status).toBe(409);
    expect(row.status).toBe('done');
  });
});

describe('staff re-timing', () => {
  it('may set a time that was never offered, because it was agreed on the phone', async () => {
    const row = seedInvitation();
    const res = await patch({ id: row.id, action: 'confirm', slot: NOT_OFFERED });
    expect(res.status).toBe(200);
    expect((await res.json()).invitation.confirmedSlot).toBe(NOT_OFFERED);
  });

  it('may cancel', async () => {
    const row = seedInvitation();
    expect((await patch({ id: row.id, action: 'cancel' })).status).toBe(200);
    expect(row.status).toBe('cancelled');
  });

  it('may not cancel another coach’s trainee’s invitation', async () => {
    const row = seedInvitation({ athlete_id: 'a2' });
    const res = await patch({ id: row.id, action: 'cancel' });
    expect(res.status).toBe(403);
    expect(row.status).toBe('proposed');
  });
});

describe('re-offering times', () => {
  it('replaces the offered times and asks again', async () => {
    // The commonest move in the whole slice: the trainee said none of these work, so the coach
    // offers different ones. A second POST cannot do this — one open row per athlete.
    const row = seedInvitation({ status: 'other', requested_note: 'רק בבוקר' });
    const res = await patch({ id: row.id, action: 'offer', slots: [NOT_OFFERED] });
    expect(res.status).toBe(200);
    expect((await res.json()).invitation).toMatchObject({
      status: 'proposed',
      proposedSlots: [NOT_OFFERED],
    });
    expect(db.academy_test_invitations).toHaveLength(1);
  });

  it('keeps the note, because it is still why the first times failed', async () => {
    const row = seedInvitation({ status: 'other', requested_note: 'רק בבוקר' });
    await patch({ id: row.id, action: 'offer', slots: [NOT_OFFERED] });
    expect(row.requested_note).toBe('רק בבוקר');
  });

  it('clears a confirmation, so no reminder stays armed for a withdrawn time', async () => {
    const row = seedInvitation({ status: 'confirmed', confirmed_slot: SOON, confirmed_at: 'x' });
    await patch({ id: row.id, action: 'offer', slots: [NOT_OFFERED] });
    expect(row.confirmed_slot).toBeNull();
    expect(row.confirmed_at).toBeNull();
    expect(row.status).toBe('proposed');
  });

  it('drops a time that has already gone but refuses an offer with none left', async () => {
    const row = seedInvitation();
    await patch({ id: row.id, action: 'offer', slots: ['2020-01-01T00:00:00Z', NOT_OFFERED] });
    expect(row.proposed_slots).toEqual([NOT_OFFERED]);

    const res = await patch({ id: row.id, action: 'offer', slots: ['2020-01-01T00:00:00Z'] });
    expect(res.status).toBe(400);
    expect(row.proposed_slots).toEqual([NOT_OFFERED]);
  });

  it('is closed to the trainee', async () => {
    // Offering yourself a time is the confirm hole with extra steps: offer next February, then
    // confirm it legitimately.
    const row = seedInvitation();
    asTrainee();
    const res = await patch({ id: row.id, action: 'offer', slots: [NOT_OFFERED] });
    expect(res.status).toBe(403);
    expect(row.proposed_slots).toEqual([SOON, ALT]);
  });

  it('is closed to another coach', async () => {
    const row = seedInvitation({ athlete_id: 'a2' });
    expect((await patch({ id: row.id, action: 'offer', slots: [NOT_OFFERED] })).status).toBe(403);
    expect(row.proposed_slots).toEqual([SOON, ALT]);
  });

  it('cannot re-open a closed invitation', async () => {
    const row = seedInvitation({ status: 'done', test_id: 't1' });
    const res = await patch({ id: row.id, action: 'offer', slots: [NOT_OFFERED] });
    expect(res.status).toBe(409);
    expect(row.status).toBe('done');
  });
});

describe('reading the invitation', () => {
  it('gives the trainee their own without being asked for an id', async () => {
    seedInvitation();
    asTrainee();
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).invitation).toMatchObject({ athleteId: 'a1', status: 'proposed' });
  });

  it('ignores an athleteId that is not the caller’s, loudly', async () => {
    // Identity in a query string is the bug this codebase has already swept out once. Refused
    // rather than silently redirected: a client sending somebody else's id has a bug worth
    // hearing about.
    seedInvitation();
    asTrainee();
    expect((await get('?athleteId=a2')).status).toBe(403);
  });

  it('is null when there is nothing open, not an error', async () => {
    seedInvitation({ status: 'done', test_id: 't1' });
    asTrainee();
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).invitation).toBeNull();
  });

  it('lets staff read a trainee’s invitation', async () => {
    seedInvitation();
    const res = await get('?athleteId=a1');
    expect((await res.json()).invitation).toMatchObject({ athleteId: 'a1' });
  });

  it('says nothing is waiting when nothing is', async () => {
    seedInvitation();
    asTrainee();
    expect((await (await get()).json()).submittedAt).toBeNull();
  });

  it('is null and carries no submission when there is no invitation at all', async () => {
    asTrainee();
    expect(await (await get()).json()).toEqual({ invitation: null, submittedAt: null });
  });
});

// ── The window between sending a result and the coach approving it ──
//
// The invitation cannot close yet: `done` claims a measurement exists, and nobody has looked at
// this number. So the card has to stand down on this fact instead, or the trainee gets an overdue
// invitation asking for a result beside their own "sent to the coach" card.

describe('a result that is waiting for approval', () => {
  it('is reported beside the still-open invitation', async () => {
    seedInvitation({ status: 'confirmed', confirmed_slot: SOON });
    seedSubmission();
    asTrainee();
    const { invitation, submittedAt } = await (await get()).json();
    // Still open — only approval closes it — and now the screen knows why not to ask again.
    expect(invitation).toMatchObject({ status: 'confirmed' });
    expect(submittedAt).toBe('2026-09-16T17:00:00.000Z');
  });

  it('ignores a submission for another protocol, which answers nothing', async () => {
    seedInvitation();
    seedSubmission({ protocol: '2000m' });
    asTrainee();
    expect((await (await get()).json()).submittedAt).toBeNull();
  });

  it('ignores a result from before the invitation was sent', async () => {
    // Backfilled history must not silence next week's appointment.
    seedInvitation({ created_at: '2026-09-15T00:00:00.000Z' });
    seedSubmission({ test_date: '2026-05-02' });
    asTrainee();
    expect((await (await get()).json()).submittedAt).toBeNull();
  });

  it('ignores an approved result, which has already closed the invitation', async () => {
    seedInvitation();
    seedSubmission({ status: 'approved' });
    asTrainee();
    expect((await (await get()).json()).submittedAt).toBeNull();
  });

  it('ignores somebody else’s submission', async () => {
    seedInvitation();
    seedSubmission({ id: 'test-2', athlete_id: 'a2' });
    asTrainee();
    expect((await (await get()).json()).submittedAt).toBeNull();
  });
});

describe('the funnel', () => {
  it('records no step in any direction', async () => {
    // Confirming a time is not testing. Exactly one code path moves a candidate between
    // columns, and it is `PATCH /api/academy/candidates { action: 'step' }`.
    const row = seedInvitation();
    await post({ athleteId: 'a2', slots: [SOON] });
    asManager();
    await patch({ id: row.id, action: 'confirm', slot: SOON });
    await patch({ id: row.id, action: 'cancel' });
    expect(db.academy_candidate_events).toEqual([]);
  });

  it('never marks itself done, because done means a measurement exists', async () => {
    const row = seedInvitation();
    const res = await patch({ id: row.id, action: 'done' });
    expect(res.status).toBe(400);
    expect(row.test_id).toBeNull();
  });
});

describe('the reminders a confirmed time arms', () => {
  /** The two rows for this invitation, by kind. */
  const reminders = () => ({
    before: db.scheduled_notifications.filter(r => r.kind === 'academy_test_before'),
    after: db.scheduled_notifications.filter(r => r.kind === 'academy_test_after'),
  });

  it('writes both rows, addressed to the trainee, due 12h before and 2 days after', async () => {
    const row = seedInvitation();
    asTrainee();
    const res = await patch({ id: row.id, action: 'confirm', slot: SOON });
    expect(res.status).toBe(200);

    const { before, after } = reminders();
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    // 2099-09-17T04:00Z minus twelve hours, and plus two days.
    expect(before[0].next_run_at).toBe('2099-09-16T16:00:00.000Z');
    expect(after[0].next_run_at).toBe('2099-09-19T04:00:00.000Z');
    // `next_run_at` and not only `scheduled_at`: the scanner drives off next_run_at, so a row
    // with just the other column is documented as due and never becomes due.
    expect(before[0].scheduled_at).toBe(before[0].next_run_at);
    for (const r of [before[0], after[0]]) {
      expect(r.audience_type).toBe('athlete');
      expect(r.audience_id).toBe('a1');
      expect(r.status).toBe('scheduled');
      expect(r.schedule_type).toBe('once_at');
      expect(r.url).toBe('/dashboard/academy');
    }
    // And the invitation can find them again, which is what makes cancelling possible.
    expect(row.reminder_before_id).toBe(before[0].id);
    expect(row.reminder_after_id).toBe(after[0].id);
  });

  it('arms only the follow-up when the test is less than twelve hours away', async () => {
    // A trainee confirming a slot three hours out is holding the phone that confirmed it. A
    // "your test is coming up" row whose due time is already behind the clock would be sent on
    // the very next tick, about a test they agreed to seconds ago.
    const soon = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const row = seedInvitation({ proposed_slots: [soon] });
    asTrainee();
    expect((await patch({ id: row.id, action: 'confirm', slot: soon })).status).toBe(200);

    const { before, after } = reminders();
    expect(before).toHaveLength(0);
    expect(after).toHaveLength(1);
    expect(row.reminder_before_id).toBeNull();
    expect(row.reminder_after_id).toBe(after[0].id);
  });

  it('cancels the old pair when the trainee confirms a different time', async () => {
    const row = seedInvitation();
    asTrainee();
    await patch({ id: row.id, action: 'confirm', slot: SOON });
    const first = reminders();
    await patch({ id: row.id, action: 'confirm', slot: ALT });

    // The old rows are cancelled rather than deleted — and cancelled is what stops the
    // follow-up asking "where is your result?" two days after a time that no longer exists.
    expect(first.before[0].status).toBe('cancelled');
    expect(first.after[0].status).toBe('cancelled');
    const live = db.scheduled_notifications.filter(r => r.status === 'scheduled');
    expect(live).toHaveLength(2);
    expect(row.reminder_before_id).toBe(live.find(r => r.kind === 'academy_test_before')?.id);
    // 2099-09-18T04:00Z minus twelve hours.
    expect(live.find(r => r.kind === 'academy_test_before')?.next_run_at).toBe('2099-09-17T16:00:00.000Z');
  });

  it('cancels both when the trainee asks for another time instead', async () => {
    const row = seedInvitation();
    asTrainee();
    await patch({ id: row.id, action: 'confirm', slot: SOON });
    await patch({ id: row.id, action: 'other', note: 'עובד במשמרות' });

    expect(db.scheduled_notifications.every(r => r.status === 'cancelled')).toBe(true);
    expect(row.reminder_before_id).toBeNull();
    expect(row.reminder_after_id).toBeNull();
  });

  it('cancels both when staff withdraw the invitation', async () => {
    const row = seedInvitation();
    asTrainee();
    await patch({ id: row.id, action: 'confirm', slot: SOON });
    asStaff();
    await patch({ id: row.id, action: 'cancel' });

    expect(db.scheduled_notifications.every(r => r.status === 'cancelled')).toBe(true);
    expect(row.reminder_before_id).toBeNull();
  });

  it('cancels both when staff re-offer times', async () => {
    const row = seedInvitation();
    asTrainee();
    await patch({ id: row.id, action: 'confirm', slot: SOON });
    asStaff();
    await patch({ id: row.id, action: 'offer', slots: [NOT_OFFERED] });

    // `offer` clears `confirmed_slot`, so leaving the reminders armed would keep two messages
    // pointed at a time nobody is expecting any more.
    expect(db.scheduled_notifications.every(r => r.status === 'cancelled')).toBe(true);
    expect(row.reminder_before_id).toBeNull();
    expect(row.reminder_after_id).toBeNull();
  });

  it('still confirms the time when the reminder rows cannot be written', async () => {
    // Every migration in this repo is pasted in by hand, so there is always a window where the
    // table or the id columns are not there. Confirming a test time must not depend on them.
    const row = seedInvitation();
    const original = db.scheduled_notifications;
    // @ts-expect-error — simulating the table not existing at all.
    db.scheduled_notifications = undefined;
    asTrainee();
    const res = await patch({ id: row.id, action: 'confirm', slot: SOON });
    db.scheduled_notifications = original;

    expect(res.status).toBe(200);
    expect((await res.json()).invitation.confirmedSlot).toBe(SOON);
    expect(row.status).toBe('confirmed');
  });
});

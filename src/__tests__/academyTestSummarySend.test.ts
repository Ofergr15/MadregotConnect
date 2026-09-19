import { describe, expect, it, vi, beforeEach } from 'vitest';
import { COACH_ID } from '@/lib/constants';

/**
 * `/api/academy/test-analysis/send` — telling the trainee what their test meant.
 *
 * The one outward-facing write in the analysis slice, which is why it is its own route and its own
 * test file. Four things only this route can get wrong:
 *
 *  - **Sending somebody else's trainee a message.** Worse than reading their data.
 *  - **Sending a draft.** A draft exists precisely so that nothing has been said yet.
 *  - **Claiming it went when it did not.** A `sent_at` beside a failed delivery tells the next
 *    coach the trainee has been told.
 *  - **Sending twice.** A corrected sentence must edit the message the trainee has, not add a
 *    second summary of one test and leave them to pick.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

const postAcademyTestSummary = vi.fn();
vi.mock('@/lib/academy/thread-server', () => ({
  postAcademyTestSummary: (...args: unknown[]) => postAcademyTestSummary(...args),
}));
vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => ({ stream: true }) }));

type Row = Record<string, unknown>;
const db: { athletes: Row[]; academy_test_analyses: Row[] } = { athletes: [], academy_test_analyses: [] };

/** Set to make the delivery columns read as absent, the way they are before migration 114. */
let deliveryMissing = false;
let analysesMissing = false;

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private single = false;
  private patch: Row | null = null;
  private error: unknown = null;

  constructor(private table: keyof typeof db) {
    if (table === 'academy_test_analyses' && analysesMissing) {
      this.error = { code: 'PGRST205', message: 'Could not find the table' };
    }
  }

  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push(r => r[column] === value); return this; }
  maybeSingle() { this.single = true; return this; }
  update(patch: Row) {
    if (this.error) return this;
    if (deliveryMissing && 'sent_at' in patch) {
      this.error = { code: 'PGRST204', message: "Could not find the 'sent_at' column" };
      return this;
    }
    this.patch = patch;
    return this;
  }

  private settle() {
    if (this.error) return { data: null, error: this.error };
    const rows = db[this.table].filter(r => this.filters.every(f => f(r)));
    if (this.patch) {
      for (const row of rows) Object.assign(row, this.patch);
      return { data: rows[0] ?? null, error: null };
    }
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

const { POST } = await import('@/app/api/academy/test-analysis/send/route');

function asCoach(athleteId = 'coach-1') {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'yossi@madregot.app', athleteId, role: 'academy_coach', isStaff: true, isSuperUser: false },
  });
}
function asTrainee() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'dor@x.com', athleteId: 'a1', role: 'runner', isStaff: false, isSuperUser: false },
  });
}

const send = (body: unknown) =>
  POST(new Request('http://x/api/academy/test-analysis/send', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  db.athletes = [
    { id: 'a1', name: 'Dor Alon', is_academy: true, academy_coach_id: 'coach-1', coach_id: COACH_ID },
    { id: 'b1', name: 'Avi Barak', is_academy: true, academy_coach_id: 'coach-2', coach_id: COACH_ID },
  ];
  db.academy_test_analyses = [
    { id: 'an-1', test_id: 't1', athlete_id: 'a1', summary: 'רצת 6.42 ק"מ', status: 'approved', sent_at: null, sent_summary: null },
    { id: 'an-2', test_id: 't2', athlete_id: 'a1', summary: 'טיוטה', status: 'draft', sent_at: null, sent_summary: null },
    { id: 'an-3', test_id: 'tb', athlete_id: 'b1', summary: 'סיכום', status: 'approved', sent_at: null, sent_summary: null },
  ];
  deliveryMissing = false;
  analysesMissing = false;
  // Reset, not just re-stub: the refusal tests assert that NOTHING was sent, and a call counter
  // carried over from the previous test would let a real regression pass.
  postAcademyTestSummary.mockReset();
  postAcademyTestSummary.mockResolvedValue({ posted: true, updated: false });
  asCoach();
});

describe('sending an approved summary', () => {
  it('posts the stored text into the trainee thread and records that it went', async () => {
    const res = await send({ testId: 't1' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivered).toBe(true);
    expect(body.recorded).toBe(true);
    // The STORED summary, never a text field from the request: the message is a coaching record
    // and the client is not the author of it.
    expect(postAcademyTestSummary.mock.calls[0][2]).toMatchObject({
      athleteId: 'a1', testId: 't1', summary: 'רצת 6.42 ק"מ', authorStreamId: 'coach-1',
    });
    const row = db.academy_test_analyses[0];
    expect(row.sent_at).toBeTruthy();
    expect(row.sent_by).toBe('coach-1');
    // What the trainee actually read, kept so a later edit can be seen as a divergence.
    expect(row.sent_summary).toBe('רצת 6.42 ק"מ');
  });

  it('resends as an edit rather than a second summary of one test', async () => {
    await send({ testId: 't1' });
    postAcademyTestSummary.mockResolvedValue({ posted: true, updated: true });
    db.academy_test_analyses[0].summary = 'נוסח מתוקן';
    const body = await (await send({ testId: 't1' })).json();
    expect(body.updated).toBe(true);
    expect(db.academy_test_analyses[0].sent_summary).toBe('נוסח מתוקן');
  });

  it('does not claim a delivery that failed', async () => {
    // The analysis is saved and signed either way; what must not happen is a stamp saying the
    // trainee was told.
    postAcademyTestSummary.mockResolvedValue({ posted: false, updated: false, error: 'stream down' });
    const res = await send({ testId: 't1' });
    expect(res.status).toBe(502);
    expect(db.academy_test_analyses[0].sent_at).toBeNull();
  });

  it('reports a delivery it could not record, instead of reporting a failure', async () => {
    // Migration 114 not pasted yet. The message is in the thread and cannot be unsent, so calling
    // this a failure would invite a resend of something the trainee already has.
    deliveryMissing = true;
    const res = await send({ testId: 't1' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivered).toBe(true);
    expect(body.recorded).toBe(false);
    expect(body.sentAt).toBeNull();
  });
});

describe('what it refuses to send', () => {
  it('refuses a draft', async () => {
    const res = await send({ testId: 't2' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('not_approved');
    expect(postAcademyTestSummary).not.toHaveBeenCalled();
  });

  it('refuses an empty summary', async () => {
    db.academy_test_analyses[0].summary = '   ';
    expect((await (await send({ testId: 't1' })).json()).code).toBe('empty_summary');
    expect(postAcademyTestSummary).not.toHaveBeenCalled();
  });

  it('refuses another coach trainee, with nothing sent', async () => {
    expect((await send({ testId: 'tb' })).status).toBe(403);
    expect(postAcademyTestSummary).not.toHaveBeenCalled();
  });

  it('is closed to the trainee, who cannot send themselves their own analysis', async () => {
    asTrainee();
    expect((await send({ testId: 't1' })).status).toBe(403);
    expect(postAcademyTestSummary).not.toHaveBeenCalled();
  });

  it('says there is nothing saved yet rather than inventing a summary', async () => {
    const res = await send({ testId: 'ghost' });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('no_analysis');
  });

  it('answers 503 while the analyses table is still missing', async () => {
    analysesMissing = true;
    expect((await send({ testId: 't1' })).status).toBe(503);
    expect(postAcademyTestSummary).not.toHaveBeenCalled();
  });

  it('needs a testId', async () => {
    expect((await send({})).status).toBe(400);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

/**
 * The coach's Workout Feedback list embeds a `FeedbackThread` in every card, and
 * each one used to fetch its own thread from /api/workout-feedback/[id]/messages.
 * On a 30-day list that is one request per row — each re-verifying the session,
 * re-reading the feedback row and re-resolving which side the viewer is on before
 * it reached a single message. The list now returns the threads with the items.
 *
 * What's worth pinning is the part a refactor could silently get wrong: that it
 * really is ONE query for the whole page (the N+1 coming back would look fine on
 * screen), that each thread lands on its own item in order, that `isMine` is the
 * viewer's own messages and nobody else's, and that the read-markers the per-row
 * endpoint used to stamp still get stamped on the right side.
 */

const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  // Only the session lookup is faked; requireStaffCaller runs for real on top.
  requireSession: (req: Request) => requireSession(req),
  authError: (result: { status: number; error: string }) =>
    new Response(JSON.stringify({ error: result.error }), { status: result.status }),
}));

vi.mock('@/lib/push', () => ({ sendPushLocalized: vi.fn() }));

const COACH = '11111111-1111-1111-1111-111111111111';
const RUNNER = '22222222-2222-2222-2222-222222222222';

/** Every chained call a route makes, per `from()`, so filters are assertable. */
type Op = { table: string; calls: Array<[string, unknown[]]> };
let ops: Op[] = [];

const argOf = (op: Op, method: string) => op.calls.find(([m]) => m === method)?.[1];
const selectOf = (op: Op) => String(argOf(op, 'select')?.[0] ?? '');

/**
 * Rows come from a per-op responder rather than a table map, because this route
 * hits `athletes` twice for different shapes (message senders, then the active
 * roster) and `athlete_activities` twice, so the table name alone can't say what
 * a given query wanted.
 */
let respond: (op: Op) => { data: unknown[] | null; error: unknown } = () => ({ data: [], error: null });

function chainFor(record: Op) {
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(respond(record)).then(resolve, reject);
        }
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => {
            const { data, error } = respond(record);
            return Promise.resolve({ data: (data || [])[0] ?? null, error });
          };
        }
        return (...args: unknown[]) => {
          record.calls.push([prop as string, args]);
          return chain;
        };
      },
    },
  );
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const record: Op = { table, calls: [] };
      ops.push(record);
      return chainFor(record);
    },
  }),
}));

const { GET } = await import('@/app/api/workout-feedback/route');

const session = (over: Partial<{ athleteId: string | null; isStaff: boolean }> = {}) => ({
  ok: true as const,
  user: {
    email: 'coach@madregot.local',
    athleteId: COACH,
    name: 'Coach',
    role: 'coach',
    groupId: null,
    athleteStatus: 'active',
    isStaff: true,
    ...over,
  },
});

// Three feedback rows: two an athlete's, one the coach's own (so the read-marker
// split has something to split), each with a thread.
const feedbackRows = [
  { id: 'fb1', athlete_id: RUNNER, garmin_activity_id: null, difficulty: 5, feel: 3, pain: false, pain_detail: null, wants_feedback: false, comment: null, created_at: '2026-03-01T06:00:00Z', athletes: { name: 'Runner', avatar_url: null, group_id: null, groups: { name: 'A' } } },
  { id: 'fb2', athlete_id: COACH, garmin_activity_id: null, difficulty: 7, feel: 2, pain: false, pain_detail: null, wants_feedback: false, comment: null, created_at: '2026-03-02T06:00:00Z', athletes: { name: 'Coach', avatar_url: null, group_id: null, groups: { name: 'A' } } },
  { id: 'fb3', athlete_id: RUNNER, garmin_activity_id: null, difficulty: 9, feel: 1, pain: true, pain_detail: 'knee', wants_feedback: true, comment: 'ouch', created_at: '2026-03-03T06:00:00Z', athletes: { name: 'Runner', avatar_url: null, group_id: null, groups: { name: 'A' } } },
];

// Deliberately interleaved across threads and globally ascending, the way one
// `order('created_at')` over the whole page actually comes back.
const messageRows = [
  { id: 'm1', feedback_id: 'fb1', sender_athlete_id: RUNNER, body: 'first', created_at: '2026-03-01T07:00:00Z' },
  { id: 'm2', feedback_id: 'fb3', sender_athlete_id: COACH, body: 'take a week', created_at: '2026-03-03T08:00:00Z' },
  { id: 'm3', feedback_id: 'fb1', sender_athlete_id: COACH, body: 'nice work', created_at: '2026-03-03T09:00:00Z' },
  { id: 'm4', feedback_id: 'fb3', sender_athlete_id: RUNNER, body: 'thanks', created_at: '2026-03-03T10:00:00Z' },
];

const senders = [
  { id: RUNNER, name: 'Runner', avatar_url: 'https://x/r.png' },
  { id: COACH, name: 'Coach', avatar_url: null },
];

/** The default happy path; `over` swaps in one response for one op kind. */
function wire(over: { messages?: { data: unknown[] | null; error: unknown } } = {}) {
  respond = (op) => {
    if (op.table === 'workout_feedback' && argOf(op, 'update')) return { data: [], error: null };
    if (op.table === 'workout_feedback') return { data: feedbackRows, error: null };
    if (op.table === 'workout_feedback_messages') return over.messages ?? { data: messageRows, error: null };
    // Senders vs the active roster — the roster select carries group_id.
    if (op.table === 'athletes') {
      return selectOf(op).includes('group_id') ? { data: [], error: null } : { data: senders, error: null };
    }
    return { data: [], error: null };
  };
}

const list = () => GET(new Request('https://example.test/api/workout-feedback?list=1&days=30'));
const opsOn = (table: string) => ops.filter((o) => o.table === table);
const updates = () =>
  opsOn('workout_feedback')
    .filter((o) => argOf(o, 'update'))
    .map((o) => ({
      set: (argOf(o, 'update')![0] as Record<string, string>),
      ids: (argOf(o, 'in')![1] as string[]),
    }));

beforeEach(() => {
  requireSession.mockReset();
  requireSession.mockResolvedValue(session());
  ops = [];
  wire();
});

describe('the club-wide feedback list carries every card its own thread', () => {
  it('groups the messages onto the right item, oldest first', async () => {
    const body = await (await list()).json();
    const byId = new Map(body.items.map((i: { id: string; messages: unknown[] }) => [i.id, i.messages]));

    expect((byId.get('fb1') as Array<{ body: string }>).map((m) => m.body)).toEqual(['first', 'nice work']);
    expect((byId.get('fb3') as Array<{ body: string }>).map((m) => m.body)).toEqual(['take a week', 'thanks']);
    // A row with no replies gets an empty thread, not a missing field — the
    // component reads `messages` unconditionally.
    expect(byId.get('fb2')).toEqual([]);
  });

  it('attaches each sender\'s name and avatar', async () => {
    const body = await (await list()).json();
    const fb1 = body.items.find((i: { id: string }) => i.id === 'fb1');
    expect(fb1.messages[0]).toMatchObject({
      id: 'm1',
      senderName: 'Runner',
      senderAvatarUrl: 'https://x/r.png',
      createdAt: '2026-03-01T07:00:00Z',
    });
  });

  it('marks as mine only the messages this viewer sent', async () => {
    const body = await (await list()).json();
    const mine = body.items.flatMap((i: { messages: Array<{ id: string; isMine: boolean }> }) => i.messages)
      .filter((m: { isMine: boolean }) => m.isMine)
      .map((m: { id: string }) => m.id);
    expect(mine.sort()).toEqual(['m2', 'm3']);
  });

  // The whole point. Three rows, one messages query — and one sender lookup, not
  // one per thread.
  it('reads every thread in a single query, however many rows there are', async () => {
    await list();
    expect(opsOn('workout_feedback_messages')).toHaveLength(1);
    const q = opsOn('workout_feedback_messages')[0];
    expect(argOf(q, 'in')).toEqual(['feedback_id', ['fb1', 'fb2', 'fb3']]);
    expect(opsOn('athletes').filter((o) => !selectOf(o).includes('group_id'))).toHaveLength(1);
  });

  it('a staff account with no athletes row owns no messages', async () => {
    requireSession.mockResolvedValue(session({ athleteId: null }));
    const body = await (await list()).json();
    const all = body.items.flatMap((i: { messages: Array<{ isMine: boolean }> }) => i.messages);
    expect(all).toHaveLength(4);
    expect(all.every((m: { isMine: boolean }) => m.isMine === false)).toBe(true);
  });

  // Pre-migration-063 databases have no thread table. The per-row endpoint
  // answered `messages: []` for that; the list must stay usable the same way
  // rather than 500ing the coach's whole triage screen.
  it('still returns the list when the thread table is missing', async () => {
    wire({ messages: { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } } });
    const res = await list();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(3);
    expect(body.items.every((i: { messages: unknown[] }) => i.messages.length === 0)).toBe(true);
    // No senders to look up, so it must not have asked.
    expect(opsOn('athletes').filter((o) => !selectOf(o).includes('group_id'))).toHaveLength(0);
  });
});

describe('the read-markers the per-row endpoint used to stamp', () => {
  it('stamps the coach side for other people\'s rows and the athlete side for the viewer\'s own', async () => {
    await list();
    const u = updates();
    const asAthlete = u.find((x) => 'athlete_last_read_at' in x.set);
    const asCoach = u.find((x) => 'coach_last_read_at' in x.set);
    expect(asAthlete?.ids).toEqual(['fb2']);
    expect(asCoach?.ids).toEqual(['fb1', 'fb3']);
  });

  it('is one statement per side, not one per card', async () => {
    await list();
    expect(updates()).toHaveLength(2);
  });

  it('skips the athlete side entirely when none of the rows are the viewer\'s', async () => {
    requireSession.mockResolvedValue(session({ athleteId: null }));
    await list();
    const u = updates();
    expect(u).toHaveLength(1);
    expect(u[0].set).toHaveProperty('coach_last_read_at');
    expect(u[0].ids).toEqual(['fb1', 'fb2', 'fb3']);
  });
});

describe('the gate is unchanged', () => {
  it('a runner still gets 403 and no query runs', async () => {
    requireSession.mockResolvedValue(session({ athleteId: RUNNER, isStaff: false }));
    const res = await list();
    expect(res.status).toBe(403);
    expect(ops).toHaveLength(0);
  });
});

// A seeded thread is the only reason the batching above buys anything — if the
// list stops passing it, every card silently goes back to fetching its own.
describe('the coach list uses the threads it was sent', () => {
  it('passes seed= to every FeedbackThread it renders', () => {
    const src = readFileSync(
      new URL('../app/(app)/dashboard/workout-feedback/page.tsx', import.meta.url),
      'utf8',
    );
    expect(src).toMatch(/<FeedbackThread[^>]*\sseed=/);
  });
});

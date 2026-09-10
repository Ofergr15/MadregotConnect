import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Routing a management alert — `notification_routing` (migration 099) and the one
 * read every management sender goes through.
 *
 * The recipient list used to be compiled into `staffRecipientIds()` and was
 * narrowed twice in two days, each time by a deploy, each time discovered by
 * counting pushes on a real phone. Making it data introduces two failure modes
 * that are worse than the bug it fixes, and these tests are here for exactly
 * those two:
 *
 *   1. AN UNAPPLIED MIGRATION MUST NEVER SILENCE AN ALERT. Migrations here are
 *      pasted into the Supabase SQL editor by hand, so "table isn't there yet" is
 *      a real production state — and it has to mean "use the old hardcoded list",
 *      not "send to nobody". That is the `null` return, and it must survive a
 *      missing table, a missing column and a thrown connection error alike.
 *
 *   2. "CONFIGURED TO NOBODY" MUST BE HONOURED. `[]` is a choice the admin screen
 *      lets somebody make; quietly falling back to the admins there would make
 *      the screen lie about what it just saved.
 *
 * `null` and `[]` are therefore different answers, and everything below is about
 * keeping them different.
 *
 * The third property is the safety one: only staff-ish ROLES resolve. A pain
 * report names an athlete and links into admin screens, so a `runner` row —
 * which nothing in the app can create, but a hand-written INSERT can — must not
 * fan a private report out to the whole club.
 */

type Query = { table: string; columns: string; column?: string; values?: unknown; value?: unknown };
type Result = { data?: Array<Record<string, unknown>>; error?: { code: string } | null };

const calls: Query[] = [];
let answer: (q: Query) => Result;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        // `.select()` is awaited directly by routingMatrix and further filtered by
        // `.in()` (routing) or `.eq()` (the staff.ts fallback), so the same object
        // has to be both thenable and chainable — and each shape is recorded, so a
        // test can tell "asked the athletes table" from "never asked it".
        const run = (q: Query) => {
          calls.push(q);
          return Promise.resolve(answer(q));
        };
        return {
          then: (resolve: (r: Result) => unknown) => resolve(answer({ table, columns })),
          in: (column: string, values: unknown) => run({ table, columns, column, values }),
          eq: (column: string, value: unknown) => run({ table, columns, column, value }),
        };
      },
    }),
  }),
}));

// staff.ts drags the whole push stack in; none of it is under test here, and the
// real module wants web-push + VAPID env just to be imported.
const push = {
  localesForAthletes: vi.fn(async () => new Map<string, string>()),
  persistNotifications: vi.fn(async () => undefined),
  sendPushLocalized: vi.fn(async () => ({ sent: 0, byAthlete: {} as Record<string, number> })),
  subscriptionsForAthletes: vi.fn(async () => [] as unknown[]),
};
vi.mock('@/lib/push', () => push);

const { recipientsForKind, rolesForKind, routingMatrix } = await import('@/lib/notifications/routing');
const { notifyStaff } = await import('@/lib/notifications/staff');

/** `[kind, role, enabled]` triples, as the table stores them. */
const rows = (triples: Array<[string, string, boolean]>) =>
  triples.map(([kind, role, enabled]) => ({ kind, role, enabled }));

/** The seeded default: every management kind to the admins only. */
const ADMIN_ONLY = rows([
  ['problem_report', 'admin', true],
  ['problem_report', 'coach', false],
  ['problem_report', 'academy_coach', false],
]);

const athletesCalls = () => calls.filter((c) => c.table === 'athletes');

beforeEach(() => {
  calls.length = 0;
  answer = () => ({ data: [], error: null });
  push.subscriptionsForAthletes.mockClear();
  push.persistNotifications.mockClear();
  push.sendPushLocalized.mockClear();
});

describe('recipientsForKind', () => {
  it('returns null — not an empty list — for a kind with no rows', async () => {
    // The difference the whole module rests on: `null` sends the caller to its own
    // hardcoded list, so a kind added in code before its seed row is written still
    // reaches the admins.
    answer = () => ({ data: ADMIN_ONLY, error: null });
    await expect(recipientsForKind('sync_stalled')).resolves.toBeNull();
    expect(athletesCalls()).toHaveLength(0);
  });

  it('returns an empty list when every role is switched off, and asks nobody', async () => {
    // "Configured to nobody" is a real choice on the admin screen. Falling back
    // here would make the screen lie about what it saved.
    answer = () => ({ data: rows([
      ['problem_report', 'admin', false],
      ['problem_report', 'coach', false],
      ['problem_report', 'academy_coach', false],
    ]), error: null });
    await expect(recipientsForKind('problem_report')).resolves.toEqual([]);
    expect(athletesCalls()).toHaveLength(0);
  });

  it('unions the enabled roles in a fixed order and dedupes the people', async () => {
    answer = (q) =>
      q.table === 'notification_routing'
        ? { data: rows([
            ['feedback_alert', 'coach', true],
            ['feedback_alert', 'admin', true],
            ['feedback_alert', 'academy_coach', false],
          ]), error: null }
        // One person holding two rows is exactly how the original bug sent two
        // pushes for one bug report.
        : { data: [{ id: 'admin-1' }, { id: 'coach-1' }, { id: 'admin-1' }], error: null };
    await expect(recipientsForKind('feedback_alert')).resolves.toEqual(['admin-1', 'coach-1']);
    // Order comes from ROUTABLE_ROLES, not from the table's row order, so the
    // screen's recipient preview and the send agree row for row.
    expect(athletesCalls()[0]?.values).toEqual(['admin', 'coach']);
  });

  it('ignores a role the app would never offer — a runner row cannot fan a pain report out', async () => {
    answer = (q) =>
      q.table === 'notification_routing'
        ? { data: rows([['feedback_alert', 'runner', true], ['feedback_alert', 'admin', true]]), error: null }
        : { data: [{ id: 'admin-1' }], error: null };
    await expect(recipientsForKind('feedback_alert')).resolves.toEqual(['admin-1']);
    expect(athletesCalls()[0]?.values).toEqual(['admin']);
  });

  it('treats a kind routed ONLY to runners as unconfigured, not as a club-wide send', async () => {
    // Every row skipped leaves no readable rule at all, and the only safe reading
    // of that is "nothing is configured" → the admin fallback.
    answer = () => ({ data: rows([['feedback_alert', 'runner', true]]), error: null });
    await expect(recipientsForKind('feedback_alert')).resolves.toBeNull();
    expect(athletesCalls()).toHaveLength(0);
  });

  it('returns null when the table does not exist yet — the migration is applied by hand', async () => {
    answer = () => ({ error: { code: '42P01' } });
    await expect(recipientsForKind('problem_report')).resolves.toBeNull();
  });

  it('returns null when a column is missing — a partially applied 099', async () => {
    answer = () => ({ error: { code: '42703' } });
    await expect(recipientsForKind('problem_report')).resolves.toBeNull();
  });

  it('returns null rather than throwing when the read blows up', async () => {
    answer = () => { throw new Error('connection refused'); };
    await expect(recipientsForKind('problem_report')).resolves.toBeNull();
  });

  it('returns null when the roles are known but the people cannot be resolved', async () => {
    // Half an answer is not an answer: falling back is right, because the caller's
    // list still reaches somebody.
    answer = (q) =>
      q.table === 'notification_routing'
        ? { data: ADMIN_ONLY, error: null }
        : { error: { code: '08006' } };
    await expect(recipientsForKind('problem_report')).resolves.toBeNull();
  });
});

describe('rolesForKind', () => {
  it('lists only the enabled roles', async () => {
    answer = () => ({ data: rows([
      ['store_order', 'admin', true],
      ['store_order', 'coach', true],
      ['store_order', 'academy_coach', false],
    ]), error: null });
    await expect(rolesForKind('store_order')).resolves.toEqual(['admin', 'coach']);
  });

  it('is null for an unknown kind', async () => {
    answer = () => ({ data: ADMIN_ONLY, error: null });
    await expect(rolesForKind('not_a_kind')).resolves.toBeNull();
  });
});

describe('routingMatrix', () => {
  it('keys by kind then role and drops rows for roles the app does not route', async () => {
    answer = () => ({ data: rows([
      ['problem_report', 'admin', true],
      ['problem_report', 'coach', false],
      ['problem_report', 'viewer', true],
    ]), error: null });
    await expect(routingMatrix()).resolves.toEqual({
      problem_report: { admin: true, coach: false },
    });
  });

  it('is null when the table is missing, so the screen can say so', async () => {
    answer = () => ({ error: { code: '42P01' } });
    await expect(routingMatrix()).resolves.toBeNull();
  });
});

/**
 * The contract from the sender's side. This is where `null` vs `[]` actually
 * costs something, so it is asserted through the real notifyStaff rather than
 * only on the routing module.
 */
describe('notifyStaff honours the routing contract', () => {
  const copy = () => ({ title: 'x', body: 'y' });
  const send = () => notifyStaff({
    kind: 'problem_report',
    url: '/dashboard/settings?tab=feedback',
    tag: 'problem_report',
    category: 'management',
    copy,
  });

  it('sends to the routed people without consulting the hardcoded fallback', async () => {
    answer = (q) =>
      q.table === 'notification_routing'
        ? { data: ADMIN_ONLY, error: null }
        : { data: [{ id: 'admin-1' }], error: null };
    await expect(send()).resolves.toEqual({ recipients: 1, sent: 0 });
    expect(push.subscriptionsForAthletes).toHaveBeenCalledWith(['admin-1']);
    // The fallback is an `.eq('role', 'admin')`; routing resolves with `.in`.
    expect(calls.some((c) => c.column === 'role' && c.value === 'admin')).toBe(false);
  });

  it('sends to nobody when the kind is routed to nobody', async () => {
    answer = () => ({ data: rows([
      ['problem_report', 'admin', false],
      ['problem_report', 'coach', false],
      ['problem_report', 'academy_coach', false],
    ]), error: null });
    await expect(send()).resolves.toEqual({ recipients: 0, sent: 0 });
    expect(push.subscriptionsForAthletes).not.toHaveBeenCalled();
    expect(push.persistNotifications).not.toHaveBeenCalled();
    // Not even to ask who the admins are — that query is what "helpfully" falling
    // back would look like.
    expect(calls.some((c) => c.column === 'role' && c.value === 'admin')).toBe(false);
  });

  it('falls back to the admins when migration 099 has not been applied', async () => {
    // The state this repo is actually in until the SQL is pasted in: routing reads
    // 42P01, and the bug report still has to arrive.
    answer = (q) =>
      q.table === 'notification_routing'
        ? { error: { code: '42P01' } }
        : { data: [{ id: 'admin-1' }], error: null };
    await expect(send()).resolves.toEqual({ recipients: 1, sent: 0 });
    expect(calls.some((c) => c.column === 'role' && c.value === 'admin')).toBe(true);
    expect(push.subscriptionsForAthletes).toHaveBeenCalledWith(['admin-1']);
  });
});

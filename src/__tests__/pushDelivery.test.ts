import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// What this pins down: a push that the push service accepts is the ONLY thing
// that may be recorded as delivered.
//
// The bug these tests exist for: sendPushToSubscriptions returned a bare total
// and swallowed every non-404/410 error, while persistNotifications hardcoded
// `sent_count: 1` per recipient — so a morning where 260 teammate
// notifications reached zero phones produced 260 rows all claiming a delivery,
// and not one log line anywhere. Every assertion below is one half of that
// blind spot.

process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

// Rows each table hands back, and every write the code under test performs.
type Tables = Record<string, Array<Record<string, unknown>>>;
let tables: Tables;
let writes: { updated: Array<{ table: string; patch: Record<string, unknown>; ids: unknown[] }>; deleted: Array<{ table: string; ids: unknown[] }>; inserted: Array<{ table: string; rows: Array<Record<string, unknown>> }> };

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      let op = 'select';
      let patch: Record<string, unknown> = {};
      let ids: unknown[] = [];
      const chain = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        lt: () => chain,
        neq: () => chain,
        or: () => chain,
        in: (_col: string, values: unknown[]) => { ids = values; return chain; },
        update: (p: Record<string, unknown>) => { op = 'update'; patch = p; return chain; },
        delete: () => { op = 'delete'; return chain; },
        insert: (rows: Array<Record<string, unknown>>) => {
          writes.inserted.push({ table, rows });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: () => Promise.resolve({ data: (tables[table] || [])[0] ?? null, error: null }),
        // Thenable, so the same chain serves a filtered read and a terminal
        // update/delete — exactly how the real supabase-js builder behaves.
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          if (op === 'update') writes.updated.push({ table, patch, ids });
          if (op === 'delete') writes.deleted.push({ table, ids });
          const data = op === 'select' ? (tables[table] || []) : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  }),
}));

const { sendPushDetailed, sendPushToSubscriptions, persistNotifications } = await import('@/lib/push');

const sub = (id: string, athleteId: string) => ({
  id,
  endpoint: `https://web.push.apple.com/${id}`,
  p256dh: 'p',
  auth: 'a',
  athlete_id: athleteId,
});

const pushError = (statusCode: number) => Object.assign(new Error(`status ${statusCode}`), { statusCode });

let warn: ReturnType<typeof vi.spyOn>;

/** Everything console.warn was told, as plain strings. */
const warnings = (): string[] => (warn.mock.calls as unknown[][]).map((c) => String(c[0]));

beforeEach(() => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201 });
  writes = { updated: [], deleted: [], inserted: [] };
  tables = {
    app_settings: [{ key: 'maintenance_mode', value: 'off' }],
    athletes: [
      { id: 'a1', email: 'a1@x.test', notification_prefs: null, group_id: null, last_seen_at: null },
      { id: 'a2', email: 'a2@x.test', notification_prefs: null, group_id: null, last_seen_at: null },
    ],
    scheduled_notifications: [],
    push_subscriptions: [],
  };
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe('sendPushDetailed — per-athlete delivery counts', () => {
  it('counts each athlete\'s own devices separately', async () => {
    const result = await sendPushDetailed(
      [sub('s1', 'a1'), sub('s2', 'a1'), sub('s3', 'a2')],
      { title: 'hi', body: 'there' },
    );
    expect(result.sent).toBe(3);
    expect(result.byAthlete).toEqual({ a1: 2, a2: 1 });
  });

  it('does not credit an athlete whose only device rejected the push', async () => {
    // a2's endpoint 500s. Before this change the failure was swallowed with no
    // log and no count distinction, so a2 was recorded as notified.
    sendNotification.mockImplementation((s: { endpoint: string }) =>
      s.endpoint.endsWith('s3') ? Promise.reject(pushError(500)) : Promise.resolve({}));

    const result = await sendPushDetailed([sub('s1', 'a1'), sub('s3', 'a2')], { title: 'hi', body: 'x' });
    expect(result.sent).toBe(1);
    expect(result.byAthlete).toEqual({ a1: 1 });
    expect(result.byAthlete.a2).toBeUndefined();
  });

  it('logs every non-404/410 failure WITH its status code', async () => {
    sendNotification.mockRejectedValue(pushError(413)); // payload too large
    await sendPushDetailed([sub('s1', 'a1')], { title: 'oversized', body: 'x' });
    const logged = warnings().join('\n');
    expect(logged).toContain('413');
    expect(logged).toContain('oversized');
  });

  it('warns when nothing at all got through, even with subscriptions present', async () => {
    sendNotification.mockRejectedValue(pushError(500));
    const result = await sendPushDetailed([sub('s1', 'a1'), sub('s2', 'a1')], { title: 'silent', body: 'x' });
    expect(result.sent).toBe(0);
    expect(warnings().some((w) => w.includes('reached 0 of 2'))).toBe(true);
  });

  it('still prunes 404/410 endpoints — and does not log them as unexpected failures', async () => {
    sendNotification.mockImplementation((s: { endpoint: string }) =>
      s.endpoint.endsWith('s2') ? Promise.reject(pushError(410)) : Promise.resolve({}));

    const result = await sendPushDetailed([sub('s1', 'a1'), sub('s2', 'a1')], { title: 'hi', body: 'x' });
    expect(result.sent).toBe(1);
    const deleted = writes.deleted.find((d) => d.table === 'push_subscriptions');
    expect(deleted?.ids).toEqual(['s2']);
    // 410 is a normal, self-healing outcome — only the genuinely unexplained
    // failures are worth a log line.
    expect(warnings().some((w) => w.includes('failed'))).toBe(false);
  });

  it('stamps last_success_at on exactly the endpoints that accepted the push', async () => {
    sendNotification.mockImplementation((s: { endpoint: string }) =>
      s.endpoint.endsWith('s2') ? Promise.reject(pushError(500)) : Promise.resolve({}));

    await sendPushDetailed([sub('s1', 'a1'), sub('s2', 'a1')], { title: 'hi', body: 'x' });
    const updated = writes.updated.find((u) => u.table === 'push_subscriptions');
    // s2 failed, so it must NOT look freshly alive — that's what makes the
    // column usable for reaping orphans in /api/push/subscribe.
    expect(updated?.ids).toEqual(['s1']);
    expect(updated?.patch.last_success_at).toBeTypeOf('string');
  });

  it('never touches last_success_at when every send failed', async () => {
    sendNotification.mockRejectedValue(pushError(500));
    await sendPushDetailed([sub('s1', 'a1')], { title: 'hi', body: 'x' });
    expect(writes.updated).toHaveLength(0);
  });
});

describe('sendPushDetailed — silenced audiences say so', () => {
  it('explains itself when the maintenance allowlist drops everyone', async () => {
    tables.app_settings = [
      { key: 'maintenance_mode', value: 'on' },
      { key: 'maintenance_allow', value: 'someone-else@x.test' },
    ];
    const result = await sendPushDetailed([sub('s1', 'a1')], { title: 'walled off', body: 'x' });
    expect(result).toEqual({ sent: 0, byAthlete: {} });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(warnings().some((w) => w.includes('maintenance allowlist'))).toBe(true);
  });

  it('explains itself when every recipient muted the category', async () => {
    tables.athletes = [{ id: 'a1', email: 'a1@x.test', notification_prefs: { teammates: false }, group_id: null, last_seen_at: null }];
    const result = await sendPushDetailed([sub('s1', 'a1')], { title: 'muted', body: 'x', category: 'teammates' });
    expect(result.sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(warnings().some((w) => w.includes('muted by all'))).toBe(true);
  });

  it('returns silently for an empty subscription list — nothing to explain', async () => {
    const result = await sendPushDetailed([], { title: 'hi', body: 'x' });
    expect(result).toEqual({ sent: 0, byAthlete: {} });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('sendPushToSubscriptions back-compat', () => {
  it('still resolves to a plain number, so existing `const sent = await …` call sites keep working', async () => {
    const sent = await sendPushToSubscriptions([sub('s1', 'a1'), sub('s3', 'a2')], { title: 'hi', body: 'x' });
    expect(sent).toBe(2);
  });
});

describe('persistNotifications — sent_count tells the truth', () => {
  const rows = [
    { athleteId: 'a1', kind: 'kudos_activity', title: 't', body: 'b', url: '/u' },
    { athleteId: 'a2', kind: 'kudos_activity', title: 't', body: 'b', url: '/u' },
  ];

  it('records the real per-recipient device count when given the delivery map', async () => {
    await persistNotifications(rows, { a1: 2 });
    const inserted = writes.inserted[0].rows;
    expect(inserted.map((r) => r.sent_count)).toEqual([2, 0]);
  });

  it('records 0 — not 1 — for a recipient no device accepted the push for', async () => {
    // The precise lie being fixed: this row still belongs in the in-app inbox,
    // but it must not claim a phone ever showed it.
    await persistNotifications(rows, {});
    expect(writes.inserted[0].rows.every((r) => r.sent_count === 0)).toBe(true);
  });

  it('keeps the optimistic 1 when no map is supplied (caller genuinely does not know)', async () => {
    await persistNotifications(rows);
    expect(writes.inserted[0].rows.map((r) => r.sent_count)).toEqual([1, 1]);
  });

  it('writes nothing at all for an empty row list', async () => {
    await persistNotifications([], { a1: 1 });
    expect(writes.inserted).toHaveLength(0);
  });

  it('still marks the rows sent so they appear in the inbox regardless of delivery', async () => {
    // sent_count 0 must not become "invisible in the app" — the inbox query
    // filters on status, not on the count.
    await persistNotifications(rows, {});
    expect(writes.inserted[0].rows.every((r) => r.status === 'sent')).toBe(true);
    expect(writes.inserted[0].rows.every((r) => r.audience_type === 'athlete')).toBe(true);
  });
});

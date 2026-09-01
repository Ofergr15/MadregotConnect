import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// What this pins down: nothing may be counted for a recipient unless the push
// service actually accepted a push for one of their devices — and acceptance,
// in turn, may never be written to the one column that claims real delivery
// evidence (last_success_at, whose only writer is /api/push/receipt).
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

const { sendPushDetailed, sendPushToSubscriptions, persistNotifications, notifyTeammatesOfActivity } =
  await import('@/lib/push');

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

  it('never stamps last_success_at, however cleanly the push was accepted', async () => {
    // The subtle version of the same lie. An earlier fix stamped this column
    // for every 2xx, which reads as delivery evidence and is not: Apple returns
    // 201 for an endpoint that is still registered but no longer reaches a live
    // service worker, so a ghost got marked freshly alive on every send and the
    // column could never identify one. /api/push/receipt — called by the
    // service worker after showNotification actually resolved — is the only
    // writer, which is what makes a stale timestamp real evidence.
    await sendPushDetailed([sub('s1', 'a1'), sub('s2', 'a1')], { title: 'hi', body: 'x' });
    expect(writes.updated.filter((u) => u.table === 'push_subscriptions')).toHaveLength(0);
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

describe('app-icon badge — what the athlete actually sees on the home screen', () => {
  /** The badge number delivered to the first (only) push in this test. */
  const deliveredBadge = (): number =>
    JSON.parse(String((sendNotification.mock.calls[0] as unknown[])[1])).badge;

  const notif = (over: Record<string, unknown> = {}) => ({
    kind: 'kudos_activity',
    url: '/dashboard/feed?activity=1',
    audience_type: 'athlete',
    audience_id: 'a1',
    status: 'sent',
    last_sent_at: '2026-08-02T00:00:00Z',
    ...over,
  });

  it('counts real unread notifications plus the one being delivered', () => {
    tables.scheduled_notifications = [notif(), notif()];
    return sendPushDetailed([sub('s1', 'a1')], { title: 'hi', body: 'x', category: 'teammates' })
      .then(() => expect(deliveredBadge()).toBe(3));
  });

  it('does not count #ledger: bookkeeping rows', async () => {
    // These are invisible in the inbox, so every one of them was a number the
    // athlete had no way to clear. 26 of the 77 in production were
    // audience_type 'all', hitting everybody at once — hence both shapes here.
    tables.scheduled_notifications = [
      notif(),
      notif({ kind: 'training_before', url: '#ledger:trainingBefore:2026-08-02', audience_type: 'all', audience_id: null }),
      notif({ kind: 'post_workout_prompt_ledger', url: '#ledger:postWorkoutPrompt:a1:2026-08-02' }),
    ];
    await sendPushDetailed([sub('s1', 'a1')], { title: 'hi', body: 'x', category: 'teammates' });
    expect(deliveredBadge()).toBe(2); // the one real row + this delivery
  });

  it('does not count notifications from a category the athlete muted', async () => {
    // a1 muted teammates, so the two kudos rows below were never delivered to
    // them — the badge used to climb for them anyway, which is how "I turned
    // אימוני חברי הקבוצה off" still produced a growing red number.
    tables.athletes = [{ id: 'a1', email: 'a1@x.test', notification_prefs: { teammates: false }, group_id: null, last_seen_at: null }];
    tables.scheduled_notifications = [notif(), notif()];
    // A coach message still gets through — that toggle is on.
    await sendPushDetailed([sub('s1', 'a1')], { title: 'coach', body: 'x', category: 'coach' });
    expect(deliveredBadge()).toBe(1);
  });

  it('an explicitly pinned badge still overrides the computed count', async () => {
    tables.scheduled_notifications = [notif(), notif()];
    await sendPushDetailed([sub('s1', 'a1')], { title: 'hi', body: 'x', badge: 7 });
    expect(deliveredBadge()).toBe(7);
  });
});

describe('teammate-activity copy — the same event read two different ways', () => {
  /** The payload the push service was handed for the first (only) recipient. */
  const pushed = () => JSON.parse(String((sendNotification.mock.calls[0] as unknown[])[1]));

  /** The history row persisted for the follower. */
  const historyRow = () =>
    writes.inserted.find((w) => w.table === 'scheduled_notifications')?.rows[0] as Record<string, unknown>;

  /** One runner, one follower with one device. */
  const run = (runner: Record<string, unknown> = {}, distanceMeters = 8300) => {
    tables.athletes = [
      { id: 'runner', email: 'r@x.test', name: 'אסף אלקסלסי', gender: 'male', avatar_url: null, notification_prefs: null, group_id: null, last_seen_at: null, ...runner },
      { id: 'f1', email: 'f1@x.test', notification_prefs: null, group_id: null, last_seen_at: null },
    ];
    tables.athlete_follows = [{ follower_id: 'f1' }];
    tables.push_subscriptions = [sub('s1', 'f1')];
    return notifyTeammatesOfActivity({ athleteId: 'runner', activityKey: 1, activityId: 'act-1', distanceMeters });
  };

  it('puts a fixed header in the push title and who-did-what in the body', async () => {
    // Strava's shape, and the reason for it is the lock screen: six of these
    // stacked, each with a different long Hebrew sentence as its title, read as
    // noise. A repeated header reads as one channel you can skim.
    await run();
    expect(pushed().title).toBe('🏃 פעילות חדשה');
    expect(pushed().body).toBe('אסף אלקסלסי סיים ריצה • 8.3 ק"מ');
  });

  it('keeps the distance in the body rather than letting it stand alone', async () => {
    // The old shape sent a bare `8.3 ק"מ` as the whole body. Moving the name
    // down there is only safe if the distance comes with it — a body that is
    // just a name would drop the one fact the notification exists to deliver.
    await run();
    expect(pushed().body).toContain('8.3 ק"מ');
  });

  it('the header does not vary by runner, so the push groups as one channel', async () => {
    await run({ name: 'נועה', gender: 'female' });
    expect(pushed().title).toBe('🏃 פעילות חדשה');
    expect(pushed().body).toBe('נועה סיימה ריצה • 8.3 ק"מ');
  });

  it('names the runner in the HISTORY title instead — that screen is a bare list', async () => {
    // notifications/page.tsx renders title as the row label and body as its
    // sublabel. Twenty identical "פעילות חדשה" labels would push every name
    // into the second line and make the one screen built for scanning them
    // unscannable, so the two surfaces deliberately disagree.
    await run();
    expect(historyRow().title_he).toBe('🏃 אסף אלקסלסי סיים ריצה');
    expect(historyRow().body_he).toBe('8.3 ק"מ');
    expect(historyRow().title_he).not.toBe(pushed().title);
  });

  it('falls back to a gender-neutral verb when gender was never filled in', async () => {
    // gender is optional (migration 057) and most rows have it null, so this
    // is the common path, not the edge case.
    await run({ gender: null });
    expect(pushed().body).toBe('אסף אלקסלסי סיים/ה ריצה • 8.3 ק"מ');
  });

  it('still sends the runner photo as icon, for the platforms that honour it', async () => {
    // iOS ignores it — measured: a runner with a Google avatar_url got the
    // club's app icon on the lock screen anyway, because WebKit takes the
    // notification image from the installed PWA's manifest and nothing else.
    // Chrome/Android does honour it, which is why it is still sent.
    await run({ avatar_url: 'https://lh3.googleusercontent.com/a/photo' });
    expect(pushed().icon).toBe('https://lh3.googleusercontent.com/a/photo');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { podiumDb } from './helpers/podiumDb';

/** lib/podium/notify.ts: the round's three cron pushes and the per-runner messages (round 6, task 169). */
type Push = { athleteId?: string; kind: string; tag: string; title?: string; body?: string; copy?: () => { title: string; body: string } };
const pushes: Push[] = [];
const staff: Push[] = [];
vi.mock('@/lib/push', () => ({ notifyAthlete: async (p: Push) => { pushes.push(p); } }));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async (p: Push) => { staff.push(p); } }));
vi.mock('@/lib/podium/site', () => ({ readItem: async () => null, findByBarcode: async () => null }));
const N = await import('@/lib/podium/notify');
const { toRound } = await import('@/lib/podium/server');

let db: ReturnType<typeof podiumDb>;
beforeEach(() => {
  pushes.length = 0; staff.length = 0;
  db = podiumDb();
  db.tables.athletes.push(
    { id: 'a1', name: 'One', avatar_url: null, role: 'runner', is_core_runner: true, is_super_user: false, status: 'active' },
    { id: 'a2', name: 'Two', avatar_url: null, role: 'runner', is_core_runner: true, is_super_user: false, status: 'active' },
    { id: 'a3', name: 'Three', avatar_url: null, role: 'runner', is_core_runner: true, is_super_user: false, status: 'active' },
    { id: 'x', name: 'Not core', avatar_url: null, role: 'runner', is_core_runner: false, is_super_user: false, status: 'active' },
  );
});

const order = (athlete_id: string, submitted: boolean, items: Record<string, number>) => {
  const id = `o-${athlete_id}`;
  db.tables.podium_orders.push({ id, round_id: 'r1', athlete_id, label: null, budget: null, submitted_at: submitted ? '2026-11-05T00:00:00Z' : null, approval: 'none', updated_at: '2026-11-05T00:00:00Z', approved_total: null, updated_by: null, allocation: null, delivered_at: null });
  for (const [product_id, quantity] of Object.entries(items)) db.tables.podium_order_items.push({ order_id: id, product_id, quantity });
};

describe('runPodiumPushes', () => {
  it('open: tells the audience members not told yet, once', async () => {
    db.round();
    const now = new Date('2026-11-03T10:00:00Z');
    expect(await N.runPodiumPushes(db.client, now)).toEqual(['podiumOpen → 2']);
    expect(pushes.map((p) => p.athleteId).sort()).toEqual(['a2', 'a3']);
    expect(db.tables.podium_rounds[0].notified_open_ids).toEqual(['a1', 'a2', 'a3']);
    pushes.length = 0;
    expect(await N.runPodiumPushes(db.client, now)).toEqual([]);
    expect(pushes).toEqual([]);
  });

  it('auto-notify off: no automatic open push', async () => {
    db.round({ auto_notify: false });
    expect(await N.runPodiumPushes(db.client, new Date('2026-11-03T10:00:00Z'))).toEqual([]);
  });

  it('reminder: inside the last REMIND_HOURS, to whoever has not sent, a draft gets its own wording; once', async () => {
    db.round({ notified_open_ids: ['a1', 'a2', 'a3'] });
    order('a1', true, { p1: 1 });
    order('a2', false, { p1: 2 });
    const now = new Date('2026-11-09T12:00:00Z');
    expect(await N.runPodiumPushes(db.client, now)).toEqual(['podiumRemind → 2']);
    const byId = Object.fromEntries(pushes.map((p) => [p.athleteId, p]));
    expect(Object.keys(byId).sort()).toEqual(['a2', 'a3']);
    expect(byId.a2.title).toContain('עוד לא נשלחה');
    expect(byId.a3.title).toContain('נסגרת מחר');
    pushes.length = 0;
    expect(await N.runPodiumPushes(db.client, now)).toEqual([]);
  });

  it('locked: staff get the totals and the over-budget count, once', async () => {
    db.round({ notified_open_ids: ['a1', 'a2', 'a3'], notified_remind_at: '2026-11-09T00:00:00Z', budgets: {} });
    order('a1', true, { p1: 3 }); // 3 × ₪10 = 30
    order('a2', true, { p2: 6 }); // 6 × ₪30 = 180 > 150
    order('a3', false, { p1: 1 }); // a draft: not counted
    const now = new Date('2026-11-10T02:00:00Z');
    expect(await N.runPodiumPushes(db.client, now)).toEqual(['podiumLocked → 2']);
    const copy = staff[0].copy!();
    expect(copy.body).toContain('2 הזמנות · 9 פריטים · ≈₪210.');
    expect(copy.body).toContain('1 מעל התקציב');
    expect(await N.runPodiumPushes(db.client, now)).toEqual([]);
  });

  it('a sent round or one locked long ago is not read at all', async () => {
    db.round({ sent_at: '2026-11-11T00:00:00Z' });
    db.round({ id: 'r2', locks_at: '2026-10-01T00:00:00Z' });
    expect(await N.runPodiumPushes(db.client, new Date('2026-11-12T00:00:00Z'))).toEqual([]);
  });
});

describe('sendOpenPush / openCopy', () => {
  it('again re-sends to everyone; only targets the named members who may see the round', async () => {
    const r = db.round();
    const round = toRound(r);
    expect(await N.sendOpenPush(db.client, round, r, { again: true })).toBe(3);
    pushes.length = 0;
    const fresh = db.tables.podium_rounds[0];
    expect(await N.sendOpenPush(db.client, round, fresh, { only: ['a2', 'x'] })).toBe(1);
    expect(pushes.map((p) => p.athleteId)).toEqual(['a2']);
  });

  it('a stale ledger (someone else sent first) sends nothing', async () => {
    const r = db.round();
    expect(await N.sendOpenPush(db.client, toRound(r), { ...r, notified_open_ids: [] })).toBe(0);
    expect(pushes).toEqual([]);
  });

  it("uses the admin's own wording when set", () => {
    const round = toRound(db.round());
    expect(N.openCopy(round, { notify_title: ' Custom ', notify_body: '' })).toMatchObject({ title: 'Custom' });
    expect(N.openCopy(round, {}).body).toContain('₪150');
  });
});

describe('messages to one runner', () => {
  const round = () => toRound(db.round({ budgets: {} }));
  it('askApproval names the overage', async () => {
    await N.askApproval({ round: round(), athleteId: 'a1', name: 'One', total: 180, orderId: 'o1' });
    expect(staff[0].copy!().body).toContain('ההפרש ₪30');
  });
  it.each([
    ['approved', 180, 'נשאר להעביר את ההפרש: ₪30'],
    ['approved', 100, 'סה״כ ₪100.'],
    ['rejected', 180, 'להוריד ל-₪150'],
    ['edited', 90, 'סה״כ עכשיו ₪90'],
    ['orderedFor', 90, '₪90 מתוך ₪150'],
  ] as const)('tellRunner %s', async (kind, total, text) => {
    await N.tellRunner({ athleteId: 'a1', kind, round: round(), total, actorId: null });
    expect(pushes[0].body).toContain(text);
    expect(pushes[0].tag).toBe(`podium-${kind}-r1`);
  });
  it('tellDelivered: all arrived vs some missing, and what is owed', async () => {
    await N.tellDelivered({ athleteId: 'a1', round: round(), actorId: null, share: { got: { p1: 2 }, missing: {}, missingValue: 0, owes: 0 } as never });
    expect(pushes[0].body).toBe('קיבלת את כל 2 הפריטים.');
    await N.tellDelivered({ athleteId: 'a1', round: round(), actorId: null, share: { got: { p1: 2 }, missing: { p2: 1 }, missingValue: 30, owes: 12 } as never });
    expect(pushes[1].body).toBe('קיבלת 2 מתוך 3 פריטים. 1 לא הגיעו מהחנות (₪30). להעביר למועדון: ₪12.');
  });
});

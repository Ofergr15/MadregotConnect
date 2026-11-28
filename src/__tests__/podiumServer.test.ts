import { beforeEach, describe, expect, it, vi } from 'vitest';
import { podiumDb } from './helpers/podiumDb';

/** lib/podium/server.ts on an in-memory database (round 6, task 169). The site reader is mocked. */
const site = { byUrl: new Map<string, unknown>(), byBarcode: new Map<string, unknown>() };
vi.mock('@/lib/podium/site', () => ({
  readItem: async (url: string) => { const s = site.byUrl.get(url); if (!s) throw new Error('404'); return s; },
  findByBarcode: async (b: string) => site.byBarcode.get(b) ?? null,
}));
const P = await import('@/lib/podium/server');

let db: ReturnType<typeof podiumDb>;
let round: ReturnType<typeof podiumDb>['round'];
beforeEach(() => {
  site.byUrl.clear(); site.byBarcode.clear();
  db = podiumDb();
  round = db.round;
});

describe('podium server', () => {
  it('clubPrice is the regular price when there is one', () => {
    expect(P.clubPrice({ price: 8, regular_price: 10 })).toBe(10);
    expect(P.clubPrice({ price: '8' })).toBe(8);
    expect(P.clubPrice({})).toBeNull();
  });

  it('loadProducts: sorted, club price, never a deal', async () => {
    const ps = await P.loadProducts(db.client);
    expect(ps.map((p) => p.id)).toEqual(['p2', 'p1', 'p3']);
    expect(ps[1]).toMatchObject({ price: 10, regularPrice: null, deal: null, unavailable: false });
    expect(ps[2].unavailable).toBe(true);
  });

  it('toRound parses numbers, drops a non-numeric budget and defaults auto-notify on', () => {
    const r = P.toRound(round());
    expect(r).toMatchObject({ budget: 150, expectedCount: 15, autoNotify: true, notifiedCount: 1, budgets: { a1: 200 } });
    expect(r.budgets).not.toHaveProperty('bad');
    expect(P.toRound({ ...round({ id: 'r2' }), auto_notify: false, expected_count: null, budgets: null }).autoNotify).toBe(false);
  });

  it('currentRound: the newest unsent round the viewer may see, else the newest seen', async () => {
    round({ id: 'old', opens_at: '2026-10-01T00:00:00Z', sent_at: null });
    round({ id: 'sent', opens_at: '2026-11-05T00:00:00Z', sent_at: '2026-11-11T00:00:00Z' });
    round({ id: 'staff', opens_at: '2026-11-20T00:00:00Z', audience: 'admins' });
    const core = { athleteId: 'a1', isCore: true, isStaff: false };
    expect((await P.currentRound(db.client, core))?.id).toBe('old');
    expect((await P.currentRound(db.client, { athleteId: 'a1', isCore: false, isStaff: true }))?.id).toBe('staff');
    expect(await P.currentRound(db.client, { athleteId: null, isCore: false, isStaff: false } as never)).toBeNull();
    expect((await P.listRounds(db.client)).map((r) => r.id)).toEqual(['staff', 'sent', 'old']);
    expect((await P.loadRound(db.client, 'sent'))?.sentAt).toBe('2026-11-11T00:00:00Z');
    expect(await P.loadRound(db.client, 'nope')).toBeNull();
  });

  const lines = () => db.tables.podium_order_items.map(({ order_id, product_id, quantity }) => ({ order_id, product_id, quantity }));

  it('saveOrder: creates, replaces lines, keeps the send on an edit, unsubmit clears it', async () => {
    const r = P.toRound(round());
    const products = await P.loadProducts(db.client);
    const first = await P.saveOrder(db.client, { round: r, athleteId: 'a1', items: { p1: 2, p3: 1, nope: 4, p2: 'x' }, products, by: 'a1', submit: true });
    expect(first.submittedAt).not.toBeNull();
    // p3 is unavailable and nope does not exist: only p1 is written.
    expect(lines()).toEqual([{ order_id: first.id, product_id: 'p1', quantity: 2 }]);
    const edited = await P.saveOrder(db.client, { round: r, athleteId: 'a1', items: { p2: 120 }, products, by: 'admin' });
    expect(edited.id).toBe(first.id);
    expect(edited.submittedAt).toBe(first.submittedAt);
    expect(lines()).toEqual([{ order_id: first.id, product_id: 'p2', quantity: 99 }]);
    // An admin may order an unavailable product.
    await P.saveOrder(db.client, { round: r, athleteId: 'a1', items: { p3: 1 }, products, by: 'admin', admin: true, unsubmit: true });
    expect(lines()).toEqual([{ order_id: first.id, product_id: 'p3', quantity: 1 }]);
    expect((await P.loadOrder(db.client, 'r1', 'a1'))?.submittedAt).toBeNull();
    expect(db.tables.podium_orders).toHaveLength(1);
  });

  it('saveOrder with neither a runner nor an order id refuses', async () => {
    await expect(P.saveOrder(db.client, { round: P.toRound(round()), athleteId: null, items: {}, products: [], by: null })).rejects.toThrow('no order');
  });

  it('createGroupOrder: a named order with no runner, label trimmed to 80', async () => {
    const o = await P.createGroupOrder(db.client, P.toRound(round()), `  ${'x'.repeat(100)} `, 300, 'admin');
    expect(o).toMatchObject({ athleteId: null, budget: 300, approval: 'none' });
    expect(o.label).toHaveLength(80);
    const saved = await P.saveOrder(db.client, { round: P.toRound(db.tables.podium_rounds[0] as never), athleteId: null, orderId: o.id, items: { p1: 1 }, products: await P.loadProducts(db.client), by: 'admin' });
    expect(saved.id).toBe(o.id);
    expect((await P.loadOrders(db.client, 'r1')).map((x) => x.id)).toEqual([o.id]);
  });

  it('members and audienceOf: removed members out, staff and core resolved', async () => {
    db.tables.athletes.push(
      { id: 'a1', name: 'Core', avatar_url: null, role: 'runner', is_core_runner: true, is_super_user: false, status: 'active' },
      { id: 'a2', name: null, avatar_url: null, role: 'coach', is_core_runner: false, is_super_user: false, status: 'active' },
      { id: 'a3', name: 'Gone', avatar_url: null, role: 'runner', is_core_runner: true, is_super_user: false, status: 'removed' },
      { id: 'a4', name: 'Su', avatar_url: null, role: 'runner', is_core_runner: false, is_super_user: true, status: 'active' },
    );
    const ms = await P.members(db.client);
    expect(ms.map((m) => [m.id, m.isCore, m.isStaff])).toEqual([['a1', true, false], ['a2', false, true], ['a4', false, true]]);
    expect(ms[1].name).toBe('');
    expect((await P.audienceOf(db.client, P.toRound(round()))).map((m) => m.id)).toEqual(['a1']);
    expect((await P.audienceOf(db.client, P.toRound(round({ id: 'r2', audience: 'people', audience_ids: ['a4'] })))).map((m) => m.id)).toEqual(['a4']);
  });

  it('checkPrices: link wins over barcode, missing products reported, price changes listed', async () => {
    site.byUrl.set('https://shop/p2', { url: 'https://shop/p2', imageUrl: null, price: 25, regularPrice: 35, deal: null });
    site.byBarcode.set('111', { url: 'https://shop/p1', imageUrl: 'i.png', price: 10, regularPrice: null, deal: null });
    const res = await P.checkPrices(db.client, await P.loadProducts(db.client));
    expect(res.updated).toBe(2);
    expect(res.missing).toEqual(['Gone']);
    expect(res.changed).toEqual([{ name: 'Socks', from: 30, to: 35 }]);
    expect(db.tables.podium_products.find((p) => p.id === 'p1')?.url).toBe('https://shop/p1');
  });

  it('linkProduct saves the page; a page with no price is refused', async () => {
    site.byUrl.set('https://shop/new', { url: 'https://shop/new', imageUrl: null, price: 12, regularPrice: null, deal: null });
    site.byUrl.set('https://shop/noprice', { url: 'https://shop/noprice', imageUrl: null, price: null, regularPrice: null, deal: null });
    expect((await P.linkProduct(db.client, 'p3', 'https://shop/new')).url).toBe('https://shop/new');
    await expect(P.linkProduct(db.client, 'p3', 'https://shop/noprice')).rejects.toThrow('no price');
  });

  it('loadReceived: a product with no row arrived in full; a missing table means not recorded', async () => {
    const ordered = new Map([['p1', 4], ['p2', 2]]);
    expect(await P.loadReceived(db.client, 'r1', ordered)).toEqual({ received: { p1: 4, p2: 2 }, recorded: false });
    db.tables.podium_received.push({ round_id: 'r1', product_id: 'p1', quantity: 3 });
    expect(await P.loadReceived(db.client, 'r1', ordered)).toEqual({ received: { p1: 3, p2: 2 }, recorded: true });
    delete (db.tables as Record<string, unknown>).podium_received;
    expect((await P.loadReceived(db.client, 'r1', ordered)).recorded).toBe(false);
  });
});

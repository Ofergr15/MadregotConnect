import { describe, expect, it } from 'vitest';
import {
  approvalAfter, buyNGetOne, cleanItems, dealNudge, orderTotal, overBy, podiumCsv, roundState, roundTotals,
  englishName, hebrewName, type PodiumProduct,
} from '@/lib/podium/model';
import { isPodiumItemUrl, parseTile } from '@/lib/podium/site';

const P = (id: string, over: Partial<PodiumProduct> = {}): PodiumProduct => ({
  id, sku: Number(id.replace(/\D/g, '')) || 1, barcode: `b${id}`, name: `ג'ל אנרגיה GU Gel ${id}`, dept: "ג'ל אנרגיה",
  url: null, imageUrl: null, price: 8, regularPrice: 9, deal: null, hidden: false, checkedAt: null, sort: 0, ...over,
});

describe('podium round state', () => {
  const r = { opensAt: '2026-11-01T08:00:00Z', locksAt: '2026-11-05T18:00:00Z', sentAt: null };
  it('upcoming → open → locked → sent', () => {
    expect(roundState(r, new Date('2026-10-31T00:00:00Z'))).toBe('upcoming');
    expect(roundState(r, new Date('2026-11-03T00:00:00Z'))).toBe('open');
    expect(roundState(r, new Date('2026-11-05T18:00:00Z'))).toBe('locked');
    expect(roundState({ ...r, sentAt: '2026-11-06T00:00:00Z' }, new Date('2026-11-03T00:00:00Z'))).toBe('sent');
  });
});

describe('podium money', () => {
  const ps = [P('a1'), P('b2', { price: 10, regularPrice: null }), P('c3', { price: null }), P('d4', { hidden: true })];
  it('totals at the site price; unpriced lines cost nothing', () => {
    expect(orderTotal({ a1: 3, b2: 2, c3: 5 }, ps)).toBe(44);
  });
  it('cleanItems drops unknown, unpriced, hidden, zero and caps at 99', () => {
    expect(cleanItems({ a1: 2.7, b2: 500, c3: 1, d4: 1, zz: 4, x: -1 }, ps)).toEqual({ a1: 2, b2: 99 });
    expect(cleanItems({ c3: 1, d4: 2 }, ps, { allowUnorderable: true })).toEqual({ c3: 1, d4: 2 });
  });
  it('over the budget needs a yes; a yes covers up to the approved total', () => {
    expect(overBy(650, 600)).toBe(50);
    expect(approvalAfter(590, 600, 'pending', 700)).toBe('none');
    expect(approvalAfter(650, 600, 'none', 0)).toBe('pending');
    expect(approvalAfter(640, 600, 'approved', 650)).toBe('approved');
    expect(approvalAfter(700, 600, 'approved', 650)).toBe('pending');
  });
});

describe('podium deals', () => {
  it('reads buy-N-get-1', () => {
    expect(buyNGetOne('קנו 10 קבלו 1 חינם')).toBe(10);
    expect(buyNGetOne('הנחה בקניית 24 יחידות')).toBeNull();
  });
  it('nudges toward the free one', () => {
    expect(dealNudge('קנו 10 קבלו 1 חינם', 4)).toBe('עוד 7 ואחד מהם חינם');
    expect(dealNudge('קנו 10 קבלו 1 חינם', 11)).toBe('1 חינם במבצע');
    expect(dealNudge('קנו 10 קבלו 1 חינם', 13)).toBe('1 חינם · עוד 9 ועוד אחד חינם');
    expect(dealNudge(null, 4)).toBeNull();
  });
});

describe('podium file', () => {
  it("is Podium's sheet: title, header, one line per product in catalog order, rejected out", () => {
    const ps = [P('a1', { sku: 1, barcode: '769493100016', sort: 2 }), P('b2', { sku: 2, barcode: '769493100023', name: 'וופל "GU", Stroopwafel', sort: 1 })];
    const totals = roundTotals([
      { items: { a1: 2, b2: 1 }, submittedAt: 'x', approval: 'none' },
      { items: { a1: 5 }, submittedAt: 'x', approval: 'rejected' },
      { items: { a1: 9 }, submittedAt: null, approval: 'none' },
      { items: { a1: 1 }, submittedAt: 'x', approval: 'approved' },
    ]);
    const csv = podiumCsv(totals, ps, 'מדרגות');
    expect(csv.startsWith('﻿מדרגות\r\nפריט,ברקוד,שם,שם מחלקה,כמות\r\n')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines[2]).toBe(`2,769493100023,"וופל ""GU"", Stroopwafel",ג'ל אנרגיה,1`);
    expect(lines[3]).toBe(`1,769493100016,ג'ל אנרגיה GU Gel a1,ג'ל אנרגיה,3`);
  });
  it('splits names', () => {
    expect(englishName("ג'ל אנרגיה GU Gel Vanilla")).toBe('GU Gel Vanilla');
    expect(hebrewName("ג'ל אנרגיה GU Gel Vanilla")).toBe("ג'ל אנרגיה");
    expect(hebrewName('PowerBar Shaker Black בקבוק שייקר')).toBe('');
  });
});

describe('podium site', () => {
  it('reads a raw search tile (single quotes, alt-text deals)', () => {
    const tile = `<div id="item_id_2977576" data-item-code="769493100023" class="layout_list_item">
      <a href='  /items/2977576-GU-Gel-Vanilla '  > <div class='img_wrapper'><img class='img-responsive ' src='https://cdn/x/show/a.jpg' alt='x'/></div> </a>
      <h3 class='title  text-center'> ג'ל אנרגיה GU Gel Vanilla </h3>
      <div class='index_icons '> <div id="item_icons"><ul><li class=""><img alt="הנחה בקניית 24 יחידות" src="i.png"></li></ul></div></div>
      <p class='origin_price line-through text-left'> <span class='items_show_origin_price_text' style='display: none;'>מחיר רגיל: </span> 9 ₪ </p>
      <p class='price  text-right'> <span class='items_show_price_text' style='display: none;'>מחיר</span> 8 ₪ </p></div>`;
    expect(parseTile(tile)).toEqual({
      url: 'https://www.podiumsport.co.il/items/2977576-GU-Gel-Vanilla', imageUrl: 'https://cdn/x/large/a.jpg',
      price: 8, regularPrice: 9, deal: 'הנחה בקניית 24 יחידות', title: "ג'ל אנרגיה GU Gel Vanilla", code: '769493100023',
    });
  });
  it('accepts only product pages on the store', () => {
    expect(isPodiumItemUrl('https://www.podiumsport.co.il/items/123-x')).toBe(true);
    expect(isPodiumItemUrl('https://podiumsport.co.il/items/123')).toBe(true);
    expect(isPodiumItemUrl('https://evil.com/items/1')).toBe(false);
    expect(isPodiumItemUrl('https://www.podiumsport.co.il/search/?q=1')).toBe(false);
  });
});

describe('podium audience', () => {
  const base = { audienceIds: ['p1'], createdBy: 'me1' };
  const v = (athleteId: string, isCore = false, isStaff = false) => ({ athleteId, isCore, isStaff });
  it('me / admins / people / core / all', async () => {
    const { audienceAllows } = await import('@/lib/podium/model');
    expect(audienceAllows({ ...base, audience: 'me' }, v('me1'))).toBe(true);
    expect(audienceAllows({ ...base, audience: 'me' }, v('x', true, true))).toBe(false);
    expect(audienceAllows({ ...base, audience: 'admins' }, v('x', false, true))).toBe(true);
    expect(audienceAllows({ ...base, audience: 'admins' }, v('x', true))).toBe(false);
    expect(audienceAllows({ ...base, audience: 'people' }, v('p1'))).toBe(true);
    expect(audienceAllows({ ...base, audience: 'people' }, v('me1'))).toBe(true);
    expect(audienceAllows({ ...base, audience: 'people' }, v('x', true, true))).toBe(false);
    expect(audienceAllows({ ...base, audience: 'core' }, v('x', true))).toBe(true);
    expect(audienceAllows({ ...base, audience: 'core' }, v('x'))).toBe(false);
    expect(audienceAllows({ ...base, audience: 'all' }, v('x'))).toBe(true);
    expect(audienceAllows({ ...base, audience: 'all' }, { athleteId: null, isCore: true, isStaff: true })).toBe(false);
  });
});

describe('podium receiving', () => {
  it('first to send is served first; hand-set shares come out of stock first; money recomputed', async () => {
    const { allocate, shareOf, missing, overAllocated, packingCsv } = await import('@/lib/podium/receive');
    const o = (id: string, at: string, items: Record<string, number>, allocation: Record<string, number> | null = null) =>
      ({ id, submittedAt: at, approval: 'none' as const, items, allocation });
    const orders = [
      o('late', '2026-11-03', { g: 5, w: 2 }),
      o('early', '2026-11-01', { g: 4, w: 2 }),
      o('draft', null as unknown as string, { g: 9 }),
      { ...o('no', '2026-11-01', { g: 3 }), approval: 'rejected' as const },
    ];
    const a = allocate(orders, { g: 6, w: 4 });
    expect(a.get('early')).toEqual({ g: 4, w: 2 });
    expect(a.get('late')).toEqual({ g: 2, w: 2 });
    expect(a.has('draft')).toBe(false);
    expect(a.has('no')).toBe(false);
    const b = allocate([o('late', '2026-11-03', { g: 5 }, { g: 5 }), o('early', '2026-11-01', { g: 4 })], { g: 6 });
    expect(b.get('late')).toEqual({ g: 5 });
    expect(b.get('early')).toEqual({ g: 1 });
    expect(overAllocated(allocate([o('x', '1', { g: 5 }, { g: 5 })], { g: 3 }), { g: 3 })).toEqual(['g']);
    expect(missing({ g: 5, w: 2 }, { g: 2, w: 2 })).toEqual({ g: 3 });
    const ps = [P('g', { price: 100 }), P('w', { price: 50 })];
    const s = shareOf({ g: 8, w: 2 }, { g: 6, w: 2 }, ps, 600);
    expect([s.orderedValue, s.gotValue, s.missingValue, s.owes]).toEqual([900, 700, 200, 100]);
    expect(shareOf({ g: 8 }, { g: 5 }, ps, 600).owes).toBe(0);
    const csv = packingCsv([{ name: 'דנה', items: { g: 5 }, got: { g: 2 } }], ps);
    expect(csv.trim().split('\r\n')[1]).toBe(`דנה,ג'ל אנרגיה GU Gel g,bg,5,2,3`);
  });
});

describe('podium time left (Hebrew)', () => {
  it('reads naturally', async () => {
    const { timeLeft } = await import('@/components/podium/parts');
    const at = (h: number) => new Date(Date.UTC(2026, 9, 27, 8) + h * 3600_000).toISOString();
    const now = Date.UTC(2026, 9, 27, 8);
    expect(timeLeft(at(49), now)).toBe('עוד יומיים ושעה');
    expect(timeLeft(at(50), now)).toBe('עוד יומיים ושעתיים');
    expect(timeLeft(at(77), now)).toBe('עוד 3 ימים ו-5 שעות');
    expect(timeLeft(at(24), now)).toBe('עוד יום');
    expect(timeLeft(at(2), now)).toBe('עוד שעתיים');
    expect(timeLeft(at(0.5), now)).toBe('עוד 30 דקות');
    expect(timeLeft(at(-1), now)).toBeNull();
  });
});

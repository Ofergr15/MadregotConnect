import { describe, expect, it } from 'vitest';
import { PLANNED_RPE, plannedRpeFor, rpeVsPlan } from '@/lib/academy/planned-effort';
import { normalizeSettings, DEFAULT_PACK_CAPACITY } from '@/lib/academy/settings';
import { rollupBands } from '@/lib/academy/members';
import { EVENT_KINDS, isEventKind } from '@/lib/events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// academy doc (academy-5pages-v6.pdf) — server items from design/b22/academy-week/pdf-coverage.md

describe('planned RPE (doc p.3: RPE actual vs planned)', () => {
  it('maps every book kind to a band inside 1–10, easiest to hardest', () => {
    const order = ['easy', 'long', 'tempo', 'hills', 'intervals', 'test'] as const;
    let prev = 0;
    for (const k of order) {
      const b = PLANNED_RPE[k];
      expect(b.min).toBeGreaterThanOrEqual(1);
      expect(b.max).toBeLessThanOrEqual(10);
      expect(b.min).toBeLessThanOrEqual(b.max);
      expect(b.min).toBeGreaterThan(prev - 1);
      prev = b.min;
    }
  });
  it('is null without a kind, and compares inclusively', () => {
    expect(plannedRpeFor(null)).toBeNull();
    const tempo = plannedRpeFor('tempo');
    expect(rpeVsPlan(5, tempo)).toBe('below');
    expect(rpeVsPlan(6, tempo)).toBe('within');
    expect(rpeVsPlan(7, tempo)).toBe('within');
    expect(rpeVsPlan(9, tempo)).toBe('above');
    expect(rpeVsPlan(null, tempo)).toBeNull();
    expect(rpeVsPlan(5, null)).toBeNull();
  });
  it('week-board ships plannedRpe from the book kind', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/academy/week-board/route.ts'), 'utf8');
    expect(src).toContain('plannedRpe: model ? plannedRpeFor(guessKind(model, row.name)) : null');
  });
});

describe('pack capacity (doc p.2: up to 20 runners per pack)', () => {
  it('defaults to 20 and keeps a stored value in range', () => {
    expect(normalizeSettings({}).packCapacity).toBe(DEFAULT_PACK_CAPACITY);
    expect(DEFAULT_PACK_CAPACITY).toBe(20);
    expect(normalizeSettings({ packCapacity: 16 }).packCapacity).toBe(16);
    expect(normalizeSettings({ packCapacity: 0 }).packCapacity).toBe(20);
    expect(normalizeSettings({ packCapacity: 'x' }).packCapacity).toBe(20);
  });
  it('the band rollup says which pack is over', () => {
    const band = (id: string, n: number) => ({ id, bandNumber: n, name: `דבוקה ${n}`, goal: null, paceProfile: {} as never });
    const m = (bandId: string) => ({ band: { id: bandId } }) as never;
    const members = [m('b1'), m('b1'), m('b1'), m('b2')];
    const out = rollupBands(members, [band('b1', 1), band('b2', 2)], 2);
    expect(out.find((b) => b.id === 'b1')).toMatchObject({ trainees: 3, capacity: 2, overCapacity: true });
    expect(out.find((b) => b.id === 'b2')).toMatchObject({ trainees: 1, capacity: 2, overCapacity: false });
    expect(rollupBands([], [band('b1', 1)])[0]).toMatchObject({ capacity: 20, overCapacity: false });
  });
});

describe('zoom event kind (doc p.2–3: monthly professional Zoom)', () => {
  it('is a valid kind, and migration 211 puts it in the CHECK', () => {
    expect(isEventKind('zoom')).toBe(true);
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/211_events_kind_zoom.sql'), 'utf8');
    for (const k of EVENT_KINDS) expect(sql).toContain(`'${k}'`);
  });
});

import { retentionCounts } from '@/lib/academy/hub-server';
describe('retention counts (doc p.3 belonging and retention) — counts only', () => {
  it('counts active trainees who paid this month and who attended an event', () => {
    expect(retentionCounts(['a', 'b', 'c'], new Set(['a', 'c', 'x']), new Set(['b']))).toEqual({ active: 3, paidThisMonth: 2, attendedEventThisMonth: 1 });
    expect(retentionCounts([], new Set(['a']), new Set(['a']))).toEqual({ active: 0, paidThisMonth: 0, attendedEventThisMonth: 0 });
  });
  it('the manager payload never carries names or amounts for it', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/academy/hub-server.ts'), 'utf8');
    expect(src).toContain(".select('athlete_id').eq('period', `${month}-01`)");
    expect(src).not.toContain("select('athlete_id, amount_ils')");
    expect(src).toContain(".lt('date', nextMonth)");
  });
});

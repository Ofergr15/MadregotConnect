import { describe, it, expect } from 'vitest';
import { isMissingColumn, israelEndOfDay, nextAnswers, orderPinned, pinUntil, readPinChoice, untilLabel } from '@/lib/publish/pin';
import { firstUnseen, ringState } from '@/lib/feed/ring-state';

// Pinned to the top, more than one answer (migration 161) and the circles' rings
// (mockups publish-preview-v2 + circles-seen, Ofer 10-20).

const NOW = new Date('2026-10-20T12:00:00Z'); // 15:00 in Israel

describe('until when a post stays pinned', () => {
  it('the evening is 23:59 Israel today', () => {
    expect(pinUntil('evening', NOW)).toBe(israelEndOfDay(NOW).toISOString());
    expect(israelEndOfDay(NOW).toISOString()).toBe('2026-10-20T20:59:00.000Z');
  });
  it('a day, three days and a week count from now', () => {
    expect(pinUntil('day', NOW)).toBe('2026-10-21T12:00:00.000Z');
    expect(pinUntil('3d', NOW)).toBe('2026-10-23T12:00:00.000Z');
    expect(pinUntil('week', NOW)).toBe('2026-10-27T12:00:00.000Z');
  });
  it("a survey's 'until it closes' is its closing time, and a week when it never closes", () => {
    expect(pinUntil('close', NOW, { closesAt: '2026-10-22T20:59:00.000Z' })).toBe('2026-10-22T20:59:00.000Z');
    expect(pinUntil('close', NOW, { closesAt: null })).toBe('2026-10-27T12:00:00.000Z');
  });
  it('a chosen date in the past, or none, pins nothing', () => {
    expect(pinUntil('date', NOW, { date: '2026-10-19T10:00:00Z' })).toBeNull();
    expect(pinUntil('date', NOW, {})).toBeNull();
    expect(pinUntil(null, NOW)).toBeNull();
  });
  it('reads only the known choices', () => {
    expect(readPinChoice('week')).toBe('week');
    expect(readPinChoice('forever')).toBeNull();
    expect(readPinChoice(3)).toBeNull();
  });
  it('labels the chip', () => {
    expect(untilLabel('2026-10-21T16:00:00Z', NOW)).toBe('עד מחר 19:00');
    expect(untilLabel('2026-10-22T20:59:00Z', NOW)).toBe('עד ה׳ 22.10');
  });
});

describe('pinned first', () => {
  const at = (id: string, occurredAt: string, pinnedUntil?: string | null) => ({ id, occurredAt, pinnedUntil });
  it('live pins go first, the newest pin first; the rest keep their order', () => {
    const items = [at('a', '2026-10-20T11:00Z'), at('b', '2026-10-19T09:00Z', '2026-10-21T00:00Z'), at('c', '2026-10-18T09:00Z'), at('d', '2026-10-20T08:00Z', '2026-10-22T00:00Z')];
    const { pinned, rest } = orderPinned(items, NOW);
    expect(pinned.map((x) => x.id)).toEqual(['d', 'b']);
    expect(rest.map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('a pin whose time passed is an ordinary post again', () => {
    const { pinned, rest } = orderPinned([at('a', '2026-10-20T11:00Z', '2026-10-20T11:30Z')], NOW);
    expect(pinned).toEqual([]);
    expect(rest.map((x) => x.id)).toEqual(['a']);
  });
});

describe('answering a survey', () => {
  it('one answer: a tap replaces it', () => {
    expect(nextAnswers([], 1, false)).toEqual([1]);
    expect(nextAnswers([1], 2, false)).toEqual([2]);
    expect(nextAnswers([1], 1, false)).toEqual([1]);
  });
  it('more than one: a tap adds or takes away that answer', () => {
    expect(nextAnswers([], 2, true)).toEqual([2]);
    expect(nextAnswers([2], 0, true)).toEqual([0, 2]);
    expect(nextAnswers([0, 2], 2, true)).toEqual([0]);
    expect(nextAnswers([0], 0, true)).toEqual([]);
  });
});

describe('before migration 161 is pasted', () => {
  it('knows a missing column from Postgres and from PostgREST', () => {
    expect(isMissingColumn({ code: '42703', message: 'column feed_items.pinned_until does not exist' })).toBe(true);
    expect(isMissingColumn({ code: 'PGRST204', message: "Could not find the 'multi_answer' column of 'surveys' in the schema cache" })).toBe(true);
    expect(isMissingColumn({ message: "Could not find the 'pinned_until' column of 'feed_items' in the schema cache" })).toBe(true);
  });
  it('and does not mistake any other failure for it', () => {
    expect(isMissingColumn({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
  });
});

describe('the circles’ rings', () => {
  it('a ring while anything in the circle is new; none once all of it was seen', () => {
    expect(ringState(['club:1', 'club:2'], ['club:1'])).toBe('new');
    expect(ringState(['club:1', 'club:2'], ['club:1', 'club:2'])).toBe('seen');
    expect(ringState(['x'], [])).toBe('new');
  });
  it('a new message after all were seen brings the ring back', () => {
    expect(ringState(['club:1', 'club:2', 'club:3'], ['club:1', 'club:2'])).toBe('new');
  });
  it('opens on the first new one, else the first', () => {
    expect(firstUnseen(['club:1', 'club:2', 'club:3'], ['club:1'])).toBe(1);
    expect(firstUnseen(['club:1', 'club:2'], ['club:1', 'club:2'])).toBe(0);
  });
});

describe('hasMigration161', async () => {
  const { hasMigration161 } = await import('@/lib/publish/server');
  const db = (error: unknown) => ({ from: () => ({ select: () => ({ limit: async () => ({ error }) }) }) }) as never;
  it('true when the column is there', async () => { expect(await hasMigration161(db(null))).toBe(true); });
  it('false when it is not', async () => { expect(await hasMigration161(db({ code: '42703', message: 'column feed_items.pinned_until does not exist' }))).toBe(false); });
  it('any other error is an error', async () => { await expect(hasMigration161(db({ code: '08006', message: 'connection' }))).rejects.toBeTruthy(); });
});

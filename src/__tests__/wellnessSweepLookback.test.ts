import { describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * The wellness sweep's depth (build plan §1.3): a week of lookback never reaches the 14 of
 * 30 nights the academy's normal ranges need, so an academy trainee short of them gets ONE
 * 30-night pass — a few a run — and the morning reminder can fetch a single night now.
 */

const getWellness = vi.fn(async (date: string) => ({ sleepSeconds: 25000, restingHr: date.endsWith('13') ? 51 : 48 }));
vi.mock('@/lib/garmin/client', () => ({
  GarminClient: class { getWellness(date: string) { return getWellness(date); } },
}));

const {
  BACKFILL_LOOKBACK_DAYS, BACKFILL_RETRY_DAYS, LOOKBACK_DAYS, WELLNESS_BACKFILL_PER_RUN, deepPassPicks, fetchNight, lastDeepPassAt, missingNights,
  needsDeepPass, storedNightCount, sweepWellness, daysBefore,
} = await import('@/lib/wellness/sweep');

const TODAY = '2026-10-13';

describe('missingNights with a lookback', () => {
  it('defaults to the week; a 30-night lookback asks for the month', () => {
    expect(missingNights(TODAY, [])).toHaveLength(LOOKBACK_DAYS);
    const month = missingNights(TODAY, [], BACKFILL_LOOKBACK_DAYS);
    expect(month).toHaveLength(30);
    expect(month[0]).toBe(TODAY);
    expect(month[29]).toBe('2026-09-14');
    // Stored nights are not asked for again, at any depth.
    expect(missingNights(TODAY, [{ date: '2026-09-20', sleep_seconds: 1, resting_hr: null }], 30)).not.toContain('2026-09-20');
  });
});

describe('who gets the deep pass', () => {
  it('an academy trainee with fewer than 14 nights in 30 who has not had one in 30 days', () => {
    expect(needsDeepPass({ isAcademy: true, storedIn30: 6, lastDeepPass: null, today: TODAY })).toBe(true);
    expect(needsDeepPass({ isAcademy: true, storedIn30: 14, lastDeepPass: null, today: TODAY })).toBe(false);
    expect(needsDeepPass({ isAcademy: false, storedIn30: 0, lastDeepPass: null, today: TODAY })).toBe(false);
    expect(needsDeepPass({ isAcademy: true, storedIn30: 0, lastDeepPass: '2026-10-12', today: TODAY })).toBe(false);
    expect(needsDeepPass({ isAcademy: true, storedIn30: 0, lastDeepPass: '2026-09-13', today: TODAY })).toBe(true);
  });

  it('the last deep pass is the latest night fetched more than a week after it; the week\'s sweep never writes one', () => {
    expect(lastDeepPassAt([
      { date: '2026-10-10', sleep_seconds: null, resting_hr: null, fetched_at: '2026-10-12T05:40:00Z' },
      { date: '2026-09-20', sleep_seconds: null, resting_hr: null, fetched_at: '2026-10-01T05:40:00Z' },
      { date: '2026-09-15', sleep_seconds: null, resting_hr: null, fetched_at: '2026-10-05T05:40:00Z' },
    ])).toBe('2026-10-05');
    expect(lastDeepPassAt([{ date: '2026-10-10', sleep_seconds: 1, resting_hr: null, fetched_at: '2026-10-13T05:40:00Z' }])).toBeNull();
  });

  it('the slots go to the never-passed first, then the longest ago', () => {
    const picks = deepPassPicks([
      { id: 'a', lastDeepPass: '2026-08-01' }, { id: 'b', lastDeepPass: null }, { id: 'c', lastDeepPass: '2026-07-01' },
    ], 2);
    expect([...picks].sort()).toEqual(['b', 'c']);
  });

  it('counts only nights with a value inside the 30 days', () => {
    expect(storedNightCount(TODAY, [
      { date: TODAY, sleep_seconds: 1, resting_hr: null },
      { date: '2026-09-14', sleep_seconds: null, resting_hr: 50 },
      { date: '2026-09-13', sleep_seconds: 1, resting_hr: 50 },  // 31 days back
      { date: '2026-10-01', sleep_seconds: null, resting_hr: null }, // not worn
    ])).toBe(2);
  });

  it('sweepWellness: at most 5 deep passes a run; everybody else gets the week', async () => {
    getWellness.mockClear();
    const db = createMemoryDb({
      schema: {
        athletes: ['id', 'garmin_auth', 'is_academy', 'status'],
        athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr', 'fetched_at'],
      },
      unique: { athlete_wellness: [['athlete_id', 'date']] },
    });
    const trainees = Array.from({ length: 7 }, () => uid());
    for (const id of trainees) db.tables.athletes.push({ id, garmin_auth: 'x', is_academy: true, status: 'active' });
    db.tables.athletes.push({ id: uid(), garmin_auth: 'x', is_academy: false, status: 'active' });
    const r = await sweepWellness(db.client as never, TODAY);
    expect(r.backfilled).toBe(WELLNESS_BACKFILL_PER_RUN);
    // 5 × 30 nights + 3 × 7 nights.
    expect(getWellness).toHaveBeenCalledTimes(5 * 30 + 3 * 7);
  });

  it('a trainee whose Garmin has no sleep or RHR is not deep-passed two nights in a row, and frees the slot', async () => {
    getWellness.mockClear();
    getWellness.mockImplementation(async () => ({ sleepSeconds: null, restingHr: null }) as never);
    const db = createMemoryDb({
      schema: {
        athletes: ['id', 'garmin_auth', 'is_academy', 'status'],
        athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr', 'fetched_at'],
      },
      unique: { athlete_wellness: [['athlete_id', 'date']] },
    });
    const trainees = Array.from({ length: WELLNESS_BACKFILL_PER_RUN + 2 }, () => uid());
    for (const id of trainees) db.tables.athletes.push({ id, garmin_auth: 'x', is_academy: true, status: 'active' });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-13T05:40:00Z'));
      expect((await sweepWellness(db.client as never, '2026-10-13')).backfilled).toBe(WELLNESS_BACKFILL_PER_RUN);
      vi.setSystemTime(new Date('2026-10-14T05:40:00Z'));
      getWellness.mockClear();
      const second = await sweepWellness(db.client as never, '2026-10-14');
      // Only the two the first night had no room for; the five empty ones are on the week.
      expect(second.backfilled).toBe(2);
      expect(getWellness).toHaveBeenCalledTimes(2 * 30 + WELLNESS_BACKFILL_PER_RUN * 7);
      vi.setSystemTime(new Date('2026-11-12T05:40:00Z'));
      expect((await sweepWellness(db.client as never, '2026-11-12')).backfilled).toBe(WELLNESS_BACKFILL_PER_RUN);
    } finally {
      vi.useRealTimers();
      getWellness.mockImplementation(async (date: string) => ({ sleepSeconds: 25000, restingHr: date.endsWith('13') ? 51 : 48 }));
    }
  });
});

describe('a sweep where Garmin throws on every call (issue 29)', () => {
  it('counts the errors as failed and records the deep pass, so the same trainees are not deep-passed again tomorrow', async () => {
    getWellness.mockClear();
    getWellness.mockImplementation(async () => { throw new Error('Garmin 503'); });
    const db = createMemoryDb({
      schema: {
        athletes: ['id', 'garmin_auth', 'is_academy', 'status'],
        athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr', 'fetched_at'],
      },
      unique: { athlete_wellness: [['athlete_id', 'date']] },
    });
    const trainees = Array.from({ length: 3 }, () => uid());
    for (const id of trainees) db.tables.athletes.push({ id, garmin_auth: 'x', is_academy: true, status: 'active' });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-13T05:40:00Z'));
      const first = await sweepWellness(db.client as never, '2026-10-13');
      expect(first.fetched).toBe(0);
      expect(first.nightErrors).toBe(3 * 30);
      expect(first.failed).toHaveLength(3);
      vi.setSystemTime(new Date('2026-10-14T05:40:00Z'));
      const second = await sweepWellness(db.client as never, '2026-10-14');
      expect(second.backfilled).toBe(0);
    } finally {
      vi.useRealTimers();
      getWellness.mockImplementation(async (date: string) => ({ sleepSeconds: 25000, restingHr: date.endsWith('13') ? 51 : 48 }));
    }
  });

  it('a night that arrived cut short (sleep, no RHR, on a watch that records RHR) is asked again', () => {
    const stored = [
      { date: TODAY, sleep_seconds: 6600, resting_hr: null },
      ...Array.from({ length: 6 }, (_, i) => ({ date: daysBefore(TODAY, i + 1), sleep_seconds: 25200, resting_hr: 50 })),
    ];
    expect(missingNights(TODAY, stored)).toEqual([TODAY]);
  });
});

describe('fetchNight', () => {
  it('fetches and stores one night', async () => {
    const id = uid();
    const db = createMemoryDb({ schema: { athletes: ['id', 'garmin_auth'], athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr', 'fetched_at'] } });
    db.tables.athletes.push({ id, garmin_auth: 'x' });
    expect(await fetchNight(db.client as never, id, TODAY, { timeoutMs: 1000 })).toEqual({ sleep_seconds: 25000, resting_hr: 51 });
    expect(db.tables.athlete_wellness).toEqual([expect.objectContaining({ athlete_id: id, date: TODAY, resting_hr: 51 })]);
  });

  it('null with no Garmin, and on a timeout', async () => {
    const id = uid();
    const db = createMemoryDb({ schema: { athletes: ['id', 'garmin_auth'], athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr', 'fetched_at'] } });
    db.tables.athletes.push({ id, garmin_auth: null });
    expect(await fetchNight(db.client as never, id, TODAY)).toBeNull();
    db.tables.athletes[0].garmin_auth = 'x';
    getWellness.mockImplementationOnce(() => new Promise(() => {}));
    expect(await fetchNight(db.client as never, id, TODAY, { timeoutMs: 20 })).toBeNull();
  });
});

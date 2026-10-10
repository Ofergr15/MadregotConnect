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
  BACKFILL_LOOKBACK_DAYS, LOOKBACK_DAYS, WELLNESS_BACKFILL_PER_RUN, fetchNight, lookbackFor, missingNights, storedNightCount, sweepWellness,
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
  it('an academy trainee with fewer than 14 nights in 30, while the run has room', () => {
    expect(lookbackFor({ isAcademy: true, storedIn30: 6, backfillsSoFar: 0 })).toBe(30);
    expect(lookbackFor({ isAcademy: true, storedIn30: 14, backfillsSoFar: 0 })).toBe(LOOKBACK_DAYS);
    expect(lookbackFor({ isAcademy: false, storedIn30: 0, backfillsSoFar: 0 })).toBe(LOOKBACK_DAYS);
    expect(lookbackFor({ isAcademy: true, storedIn30: 0, backfillsSoFar: WELLNESS_BACKFILL_PER_RUN })).toBe(LOOKBACK_DAYS);
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

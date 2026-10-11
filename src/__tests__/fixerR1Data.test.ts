import { describe, expect, it } from 'vitest';
import { canReceiveWatch, nightFeed, runFeed } from '@/lib/academy/data-feed';
import { testStateOf } from '@/lib/academy/test-state';
import { gateStatus, loadStatus } from '@/lib/academy/pmc';
import { isRunType, shiftDate } from '@/lib/academy/load';
import { isStale, mapLimit, withRetry } from '@/lib/academy/load-server';
import { cleanNights, isPartialNight, metricMissing, normalRange, plausible } from '@/lib/academy/normal-range';
import { bodyChips } from '@/lib/academy/trainee-today';
import { buildBodyPayload } from '@/lib/academy/body';
import { readinessHighlight } from '@/lib/academy/readiness';
import { LOAD_VERSION } from '@/lib/academy/load';

// Round-1 fixer: the missing-data rule, one assertion per issue it fixes.

const NOW = Date.parse('2026-10-13T06:45:00+03:00');
const TODAY = '2026-10-13';
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const nightsFor = (n: number, end = 0, f: (i: number) => { sleep_seconds?: number | null; resting_hr?: number | null } = () => ({ sleep_seconds: 25200, resting_hr: 50 })) =>
  Array.from({ length: n }, (_, i) => ({ date: shiftDate(TODAY, end - (n - 1 - i)), ...f(i) }));

describe('data feed (issue 1)', () => {
  it('a refused Garmin credential, or 16 days without a sync, is a broken feed', () => {
    expect(runFeed({ garmin_auth: {}, garmin_last_sync_at: iso(10.04), garmin_auth_failed_at: iso(10) }, NOW)).toMatchObject({ kind: 'failed', provider: 'garmin', days: 10 });
    expect(runFeed({ garmin_auth: {}, garmin_last_sync_at: iso(16) }, NOW)).toEqual({ kind: 'stale', provider: 'garmin', days: 16 });
    expect(runFeed({ garmin_auth: {}, garmin_last_sync_at: iso(0.1) }, NOW)).toEqual({ kind: 'ok', provider: 'garmin' });
  });
  it('Strava still bringing runs keeps the run feed ok; nights are Garmin-only', () => {
    const row = { garmin_auth: {}, garmin_last_sync_at: iso(16), strava_auth: {}, strava_last_sync_at: iso(1) };
    expect(runFeed(row, NOW)).toEqual({ kind: 'ok', provider: 'strava' });
    expect(nightFeed(row, NOW)).toMatchObject({ kind: 'stale', provider: 'garmin' });
    expect(nightFeed({ strava_auth: {} }, NOW)).toEqual({ kind: 'none' });
    expect(runFeed({}, NOW)).toEqual({ kind: 'none' });
  });
  it('a Strava-only trainee cannot receive a watch workout (issue 11)', () => {
    expect(canReceiveWatch({ strava_auth: {} }, NOW)).toBe(false);
    expect(canReceiveWatch({ garmin_auth: {}, garmin_last_sync_at: iso(0) }, NOW)).toBe(true);
    expect(canReceiveWatch({ garmin_auth: {}, garmin_last_sync_at: iso(10.04), garmin_auth_failed_at: iso(10) }, NOW)).toBe(false);
  });
  it('a broken feed withholds the number whatever the rows say; runs still pending do too (issues 1, 4)', () => {
    expect(gateStatus({ kind: 'ok' }, { feed: { kind: 'failed', provider: 'garmin', days: 10 } })).toEqual({ kind: 'noFeed', feed: 'failed', provider: 'garmin', days: 10 });
    expect(gateStatus({ kind: 'ok' }, { pending: 80 })).toEqual({ kind: 'computing', pending: 80 });
    expect(gateStatus({ kind: 'ok' }, { feed: { kind: 'ok', provider: 'garmin' }, pending: 0 })).toEqual({ kind: 'ok' });
  });
  it('C1 names the broken connection before anything else (issue 1)', () => {
    expect(readinessHighlight({ status: 'noFeed', noFeed: { feed: 'failed', provider: 'garmin', days: 10 }, form: null, ramp: null, rhrFlag: false, daysSinceRun: 11 }))
      .toEqual({ kind: 'noFeed', feed: 'failed', provider: 'garmin', days: 10 });
  });
});

describe('learning, said for what it is (issue 9)', () => {
  it('90 days of runs, only the last 40 priced: learning because of unpriced history, not "new"', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ date: shiftDate(TODAY, -90 + i * 3), load: i * 3 >= 50 ? 60 : null, source: (i * 3 >= 50 ? 'pace' : 'none') as 'pace' | 'none' }));
    const s = loadStatus(rows, TODAY);
    expect(s).toMatchObject({ kind: 'learning', cause: 'unpriced' });
  });
});

describe('tests (issues 2, 28)', () => {
  const t30 = (date: string, status = 'approved') => ({ test_date: date, protocol: '30min', status, duration_sec: 1800, distance_m: 7000 });
  it('a test waiting for approval is pending, not "no test"', () => {
    expect(testStateOf([t30('2026-10-01', 'pending')], TODAY)).toEqual({ kind: 'pending', date: '2026-10-01' });
  });
  it('only a 2000 m test asks for a 30-minute one', () => {
    expect(testStateOf([{ test_date: '2026-09-13', protocol: '2000m', status: 'approved', duration_sec: 480, distance_m: 2000 }], TODAY))
      .toEqual({ kind: 'otherProtocol', protocol: '2000m', date: '2026-09-13' });
  });
  it('a 150-day-old test is old', () => {
    expect(testStateOf([t30(shiftDate(TODAY, -150))], TODAY)).toMatchObject({ kind: 'ok', old: true, ageDays: 150 });
    expect(testStateOf([t30(shiftDate(TODAY, -40))], TODAY)).toMatchObject({ kind: 'ok', old: false });
    expect(testStateOf([], TODAY)).toEqual({ kind: 'none' });
  });
});

describe('nights (issues 9, 10, 17, 18)', () => {
  const garmin = { kind: 'ok' as const, provider: 'garmin' as const };
  it('no Garmin: sleep and RHR "come only from Garmin"; Garmin with no nights: never worn', () => {
    expect(metricMissing([], TODAY, 'sleep_seconds', { kind: 'none' })).toEqual({ reason: 'noGarmin' });
    expect(metricMissing([], TODAY, 'resting_hr', garmin)).toEqual({ reason: 'neverWorn' });
  });
  it('empty rows (a deep pass that found nothing) are no nights: still "never worn", not "not measured"', () => {
    expect(metricMissing([{ date: shiftDate(TODAY, -29), sleep_seconds: null, resting_hr: null }], TODAY, 'sleep_seconds', garmin)).toEqual({ reason: 'neverWorn' });
  });

  it('30 nights without sleep: the watch does not measure it — not "learning" forever', () => {
    const nights = nightsFor(30, 0, () => ({ sleep_seconds: null, resting_hr: 50 }));
    expect(metricMissing(nights, TODAY, 'sleep_seconds', garmin)).toEqual({ reason: 'notMeasured' });
    const chips = bodyChips(nights, TODAY, garmin);
    expect(chips.sleep).toBeNull();
    expect(chips.missing.sleep).toEqual({ reason: 'notMeasured' });
    expect(chips.rhr).not.toBeNull();
  });
  it('a stopped Garmin: the slot says so and an 11-day-old night is never "✓ רגיל"', () => {
    const nights = nightsFor(20, -11);
    const failed = { kind: 'failed' as const, provider: 'garmin' as const, days: 10 };
    expect(bodyChips(nights, TODAY, failed).missing.rhr).toEqual({ reason: 'feed', feed: 'failed', days: 10 });
    const body = buildBodyPayload({ nights, today: TODAY, feedback: [], feed: failed });
    expect(body.rhr.verdict).toBeNull();
    expect(body.sleep.verdict).toBeNull();
    expect(body.rhr.missing).toMatchObject({ reason: 'feed' });
    // Even on a "healthy" connection a night older than 3 days gets no verdict.
    const healthy = buildBodyPayload({ nights, today: TODAY, feedback: [], feed: garmin });
    expect(healthy.rhr.verdict).toBeNull();
    expect(healthy.rhr.missing).toEqual({ reason: 'old', date: shiftDate(TODAY, -11) });
  });
  it('an RHR of 250 and a 20-hour night are dropped from the series and the range', () => {
    const nights = nightsFor(30, 0, i => ({ sleep_seconds: i === 10 ? 72_000 : 25200, resting_hr: i === 29 ? 250 : 50 }));
    expect(plausible('resting_hr', 250)).toBe(false);
    expect(plausible('sleep_seconds', 72_000)).toBe(false);
    const body = buildBodyPayload({ nights, today: TODAY, feedback: [], feed: garmin });
    expect(Math.max(...body.rhr.series.map(p => p.value))).toBe(50);
    expect(Math.max(...body.sleep.series.map(p => p.value))).toBe(25200);
    expect(cleanNights(nights).filter(n => n.resting_hr == null)).toHaveLength(1);
    const range = normalRange(nights, TODAY, 'sleep_seconds');
    expect('hi' in range && range.hi).toBe(25200);
  });
  it('last night arrived as 1:50 of sleep without its RHR: partial, no verdict, no old RHR standing in', () => {
    const nights = [...nightsFor(29, -1), { date: TODAY, sleep_seconds: 6600, resting_hr: null }];
    expect(isPartialNight(nights[29], nights)).toBe(true);
    const chips = bodyChips(nights, TODAY, garmin);
    expect(chips.sleep).toMatchObject({ value: 6600, verdict: null });
    expect(chips.missing.sleep).toEqual({ reason: 'partial', date: TODAY });
    expect(chips.rhr).toBeNull();
    expect(chips.missing.rhr).toEqual({ reason: 'partial', date: TODAY });
  });
  it('a watch that never records RHR does not make every night partial', () => {
    const nights = nightsFor(5, 0, () => ({ sleep_seconds: 25200, resting_hr: null }));
    expect(isPartialNight(nights[4], nights)).toBe(false);
    expect(bodyChips(nights, TODAY, garmin).missing.rhr).toEqual({ reason: 'notMeasured' });
  });
});

describe('loads (issues 6, 20, 21)', () => {
  it('ultra_run, obstacle_run and other *_running types are runs', () => {
    for (const t of ['ultra_run', 'obstacle_run', 'trail_running', 'running', 'some_new_running', null]) expect(isRunType(t), String(t)).toBe(true);
    for (const t of ['cycling', 'lap_swimming', 'strength_training']) expect(isRunType(t), t).toBe(false);
  });
  it('a pace_avg row whose laps have arrived is stale', () => {
    const row = { formula_version: LOAD_VERSION, basis_test_date: '2026-09-01', source: 'pace_avg' };
    expect(isStale(row, '2026-09-01', false, false)).toBe(false);
    expect(isStale(row, '2026-09-01', false, true)).toBe(true);
    expect(isStale({ ...row, source: 'pace' }, '2026-09-01', false, true)).toBe(false);
  });
  it('withRetry tries a transient error again and answers a missing table at once', async () => {
    let n = 0;
    const flaky = await withRetry(async () => (++n < 3 ? { data: null, error: { message: 'socket hang up' } } : { data: [1], error: null }));
    expect(flaky).toEqual({ data: [1], error: null });
    expect(n).toBe(3);
    let m = 0;
    const missing = await withRetry(async () => { m += 1; return { data: null, error: { code: 'PGRST205' } }; });
    expect(missing.error).toEqual({ code: 'PGRST205' });
    expect(m).toBe(1);
  });
  it('mapLimit never runs more than its limit at once and keeps the order', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (x) => {
      live += 1; peak = Math.max(peak, live);
      await new Promise(r => setTimeout(r, 2));
      live -= 1;
      return x * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });
});

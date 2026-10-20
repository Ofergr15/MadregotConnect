import { describe, expect, it } from 'vitest';
import {
  BASELINE_PROTOCOL, baselineTestRow, pricingRows, readSheetResults, suggestFromSheet, thresholdFromRace, validResult,
} from '@/lib/academy/coach-baseline';
import { estimateFinish } from '@/lib/academy/goal';
import { thresholdPaceSec } from '@/lib/academy/tests';
import { hasPaces, testStateOf } from '@/lib/academy/test-state';
import { setupMissing } from '@/lib/academy/trainee-setup';
import { resolveThreshold } from '@/lib/academy/day-send';
import { resolveTraineePaces, withPaceUpdate } from '@/lib/academy/trainee-home';
import { activeAdjust, cleanZones, lapsedZones, type CoachDecision } from '@/lib/academy/coach-tools';
import { kindShift, unshiftPace } from '@/lib/academy/pace-kinds';
import { zoneCentrePace, zoneOfPace } from '@/lib/academy/library';
import { effortFromZone, effortPace } from '@/lib/academy/book-steps';
import { bandMeaning } from '@/lib/academy/bands';
import { importTickedByDefault, isDuplicateVariant } from '@/lib/academy/book-import';

/** The coach's pace baseline, the precedence, and the manual zones (Ofer, 2026-10-20). */

describe('baseline → threshold (Riegel, the inverse of estimateFinish)', () => {
  it('Roni: 10 km in 42:00 is a 4:07 threshold', () => {
    expect(thresholdFromRace(10, 2520)).toBe(247);
  });
  it('round-trips through estimateFinish', () => {
    const thr = thresholdFromRace(10, 2520)!;
    expect(Math.abs(estimateFinish(thr, 10)!.realistic - 2520)).toBeLessThanOrEqual(10);
  });
  it('the stored 30-minute equivalent reads back as the same threshold', () => {
    const row = baselineTestRow(21.0975, 6000)!;
    expect(row.duration_sec).toBe(1800);
    expect(Math.round(thresholdPaceSec({ durationSec: row.duration_sec, distanceM: row.distance_m })!)).toBe(thresholdFromRace(21.0975, 6000));
  });
  it('refuses nonsense', () => {
    expect(validResult(10, 600)).toBe(false); // 1:00 /km
    expect(thresholdFromRace(0, 1200)).toBeNull();
  });
});

describe('prefill from the academy file', () => {
  it('reads sheet_results and drops impossible values', () => {
    expect(readSheetResults({ sheet_results: { '5k': 1200, '10k': 2520, hm: 'x', m: 5 } })).toEqual({ '5k': 1200, '10k': 2520 });
    expect(readSheetResults({})).toBeNull();
  });
  it('Roni: the 10 km, no contradictions (a slower marathon is normal)', () => {
    const s = suggestFromSheet({ '5k': 1200, '10k': 2520, hm: 5520, m: 12600 })!;
    expect(s.pick).toBe('10k');
    expect(s.sec).toBe(2520);
    expect(s.outliers).toEqual([]);
  });
  it('Dvir: the 10 km, and the 5 km flagged as not fitting the rest', () => {
    const s = suggestFromSheet({ '5k': 1500, '10k': 2760, hm: 6000, m: 14100 })!;
    expect(s.pick).toBe('10k');
    expect(s.outliers).toEqual(['5k']);
  });
});

describe('precedence: manual zone > approved 30-minute test > coach baseline > band', () => {
  const row = (o: Record<string, unknown>) => ({ athlete_id: 'a', status: 'approved', excluded_reason: null, ...o }) as any;
  it('an approved 30-minute test beats a NEWER baseline', () => {
    const out = pricingRows([row({ test_date: '2026-10-20', protocol: BASELINE_PROTOCOL }), row({ test_date: '2026-09-19', protocol: '30min' })]);
    expect(out.map(r => [r.protocol, r.source])).toEqual([['30min', 'test']]);
  });
  it('the baseline stands alone when there is no test; pending and excluded never price', () => {
    expect(pricingRows([row({ test_date: '2026-10-20', protocol: BASELINE_PROTOCOL })])[0].source).toBe('coach');
    expect(pricingRows([row({ test_date: '2026-10-20', protocol: '30min', status: 'pending' })])).toEqual([]);
    expect(pricingRows([row({ test_date: '2026-10-20', protocol: '30min', excluded_reason: 'sick' })])).toEqual([]);
  });
  it('the basis says "coach" for a baseline, "test" for a test, "band" without either', () => {
    expect(resolveThreshold(247, 300, 'coach')).toEqual({ sec: 247, basis: 'coach' });
    expect(resolveThreshold(247, 300, 'test')).toEqual({ sec: 247, basis: 'test' });
    expect(resolveThreshold(null, 300)).toEqual({ sec: 300, basis: 'band' });
  });
  it('the trainee\'s own number beats the band\'s paces', () => {
    const p = resolveTraineePaces({ band: { bandNumber: 4, paceProfile: { thresholdPaceSec: 230, offsetSeconds: 0 } }, athleteOffsetSec: null, testThresholdSec: 247 })!;
    expect(p.threshold).toBe(zoneCentrePace(247, 'threshold'));
    expect(p.source).toBe('test');
  });
});

describe('test-state and the setup form', () => {
  it('a baseline alone is kind "baseline", and it has paces', () => {
    const s = testStateOf([{ test_date: '2026-10-20', protocol: BASELINE_PROTOCOL, status: 'approved', duration_sec: 1800, distance_m: 7287 }], '2026-10-20');
    expect(s.kind).toBe('baseline');
    expect(hasPaces(s)).toBe(true);
  });
  it('a 30-minute test next to a baseline is the test', () => {
    const s = testStateOf([
      { test_date: '2026-10-20', protocol: BASELINE_PROTOCOL, status: 'approved', duration_sec: 1800, distance_m: 7287 },
      { test_date: '2026-09-19', protocol: '30min', status: 'approved', duration_sec: 1800, distance_m: 6500 },
    ], '2026-10-20');
    expect(s.kind).toBe('ok');
  });
  it('the baseline is required until there is a test or a baseline', () => {
    const base = { coachingType: 'x', bandId: 'b', goalType: 'g', availableDays: [1] };
    expect(setupMissing({ ...base, hasPaceBasis: false })).toEqual(['baseline']);
    expect(setupMissing({ ...base, hasPaceBasis: true })).toEqual([]);
    expect(setupMissing(base)).toEqual([]);
  });
});

describe('manual zones', () => {
  const T = 247;
  const decision = (o: Partial<CoachDecision>): CoachDecision => ({
    athleteId: 'a', kind: 'pace', action: 'zones', basisTestDate: '2026-10-20', weekStart: '2026-10-18', changes: {}, createdAt: '2026-10-20T08:00:00Z', ...o,
  });
  it('the newest zones decision against the basis is the set', () => {
    const a = activeAdjust([
      decision({ changes: { zones: { tempo: 260 } } }),
      decision({ changes: { zones: { tempo: 257, interval: 225 } }, createdAt: '2026-10-20T09:00:00Z' }),
    ], '2026-10-20');
    expect(a.adjust.zones).toEqual({ tempo: 257, interval: 225 });
    expect(a.fromWeek).toBe('2026-10-18');
  });
  it('"↺ חזרה למוצע" (the set without the zone) puts it back', () => {
    const a = activeAdjust([
      decision({ changes: { zones: { tempo: 257 } } }),
      decision({ changes: { zones: {} }, createdAt: '2026-10-20T09:00:00Z' }),
    ], '2026-10-20');
    expect(a.adjust.zones).toBeUndefined();
  });
  it('a new approved test clears them, and says so once', () => {
    const rows = [decision({ changes: { zones: { tempo: 257 } }, basisTestDate: '2026-10-01' })];
    expect(activeAdjust(rows, '2026-10-20').adjust.zones).toBeUndefined();
    expect(lapsedZones(rows, '2026-10-20')).toEqual({ since: '2026-10-20', zones: { tempo: 257 } });
    expect(lapsedZones(rows, '2026-10-01')).toBeNull();
  });
  it('only real zones with sane paces are kept', () => {
    expect(cleanZones({ tempo: 257.4, nope: 250, easy: 30 })).toEqual({ tempo: 257 });
  });
  it('a pace in an overridden zone is priced at the override, both ways', () => {
    const effort = effortFromZone('tempo');
    expect(effortPace(effort, T, { zones: { tempo: 257 } })).toBe(257);
    const mid = zoneCentrePace(T, 'tempo')!;
    expect(kindShift(mid, T, { zones: { tempo: 257 } })).toBe(257 - mid);
    expect(unshiftPace(257, T, { zones: { tempo: 257 } })).toBe(mid);
    expect(zoneOfPace(mid, T)).toBe('tempo');
  });
  it('the other zones keep the kinds\' shift', () => {
    const easy = zoneCentrePace(T, 'easy')!;
    expect(kindShift(easy, T, { easy: 10, zones: { tempo: 257 } })).toBe(10);
  });
  it('the tiles carry the override', () => {
    const p = resolveTraineePaces({ band: null, athleteOffsetSec: null, testThresholdSec: T })!;
    const after = withPaceUpdate(p, { zones: { tempo: 257 } })!;
    expect(after.tempo).toBe(257);
    expect(after.easy).toBe(p.easy);
  });
});

describe('band meanings and the book import default', () => {
  it('the manager\'s description, else the band\'s own goal', () => {
    expect(bandMeaning({ goal: 'הכנה לחצי מרתון', paceProfile: { description: 'חצי מרתון' } })).toBe('חצי מרתון');
    expect(bandMeaning({ goal: 'הכנה לחצי מרתון', paceProfile: {} })).toBe('הכנה לחצי מרתון');
    expect(bandMeaning(null)).toBeNull();
  });
  it('"60 דקות קל (2)" is not ticked by default; a new interval session is', () => {
    expect(isDuplicateVariant({ kind: 'easy', name: '60 דקות קל (2)' })).toBe(true);
    expect(importTickedByDefault({ status: 'new', saveable: true, kind: 'easy', name: '60 דקות קל (2)' })).toBe(false);
    expect(importTickedByDefault({ status: 'new', saveable: true, kind: 'intervals', name: '15 × 200 מ׳' })).toBe(true);
    expect(importTickedByDefault({ status: 'review', saveable: true, kind: 'intervals', name: 'x' })).toBe(false);
  });
});

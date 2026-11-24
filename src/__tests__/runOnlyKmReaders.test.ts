// Night queue #82 — before strength/cycling sync arrives: every km total, board, streak and recap counts runs only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isRunActivityType, filterQualifyingRuns } from '@/lib/prs/pr-buckets';

describe('isRunActivityType', () => {
  it('runs and untyped rows count; rides, swims, strength do not', () => {
    for (const t of ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run', 'street_running', 'indoor_running', null, undefined, '']) {
      expect(isRunActivityType(t as any), String(t)).toBe(true);
    }
    for (const t of ['cycling', 'road_biking', 'lap_swimming', 'strength_training', 'walking', 'hiking', 'yoga']) {
      expect(isRunActivityType(t), t).toBe(false);
    }
  });
  it('agrees with filterQualifyingRuns on type', () => {
    const rows = ['running', 'cycling', null, 'strength_training'].map((t, i) => ({ id: String(i), activity_type: t, distance: 5000, duration: 1500, start_time: '2026-11-20T06:00:00Z' }));
    expect(filterQualifyingRuns(rows as any).map((r: any) => r.activity_type)).toEqual(rows.filter((r) => isRunActivityType(r.activity_type)).map((r) => r.activity_type));
  });
});

/**
 * Every reader that SUMS distance into a km figure members or staff read. Each must select activity_type and
 * run it through the run rule (isRunActivityType / filterQualifyingRuns / PR_RUN_TYPES / REPORT_RUN_TYPES).
 * Adding a new km reader? Add it here.
 */
const KM_READERS = [
  'lib/athletes/weekly-volume.ts',          // coach volume, volume history, boards (already filtered)
  'lib/records/period.ts',                  // monthly board
  'lib/week-story/server.ts',               // week story + recap numbers
  'lib/reports/last-7-days.ts',             // weekly recap push
  'lib/weekly-snapshots.ts',                // durable rollup (#82)
  'app/api/public/stats/route.ts',          // signed-out club totals (#82)
  'app/api/academy/me/route.ts',            // trainee totals (#82)
  'app/api/academy/stats/route.ts',         // academy totals (#82)
  'app/api/academy/members/route.ts',       // kmWeek on the members table (#82)
  'app/api/academy/trends/route.ts',        // weekly km trend (#82)
  'app/api/athletes/heatmap/route.ts',      // km heatmap (#82)
];

describe('km readers count runs only', () => {
  for (const f of KM_READERS) {
    it(f, () => {
      const src = readFileSync(join(__dirname, '..', f), 'utf8');
      expect(src).toMatch(/activity_type/);
      expect(src).toMatch(/isRunActivityType|filterQualifyingRuns|PR_RUN_TYPES|REPORT_RUN_TYPES/);
    });
  }
});

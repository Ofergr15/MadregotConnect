import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';

/**
 * The exact `sessions[]` shape GET /api/dashboard/weekly returns, from a SYNTHETIC two-group plan with a
 * two-session Tuesday, a repeat block and a prose-only pace (notes, no machine target). Written to
 * docs/contracts/fixtures/weekly-sessions.example.json for the native client; this test fails if the
 * server's shape drifts from the file (regenerate with UPDATE_FIXTURE=1).
 */
const FILE = join(process.cwd(), 'docs/contracts/fixtures/weekly-sessions.example.json');

const pace = (min: number, max = min) => ({ targetType: 'pace', targetPaceMinPerKm: min, targetPaceMaxPerKm: max });
const plan = (g: number) => ({
  workouts: [
    { dayOfWeek: 2, partIndex: 1, partKind: 'morning', name: 'Easy', description: 'Easy 10 km',
      steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 10000, ...pace(300 + g * 10, 330 + g * 10) }] },
    { dayOfWeek: 2, partIndex: 2, partKind: 'evening', name: 'Intervals', description: 'WU + 5×1 km + CD',
      steps: [
        { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'no_target', notes: 'easy' },
        { order: 2, type: 'interval', durationType: 'open', targetType: 'no_target', repeatCount: 5, repeatSteps: [
          { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, ...pace(225 + g * 10) },
          { order: 2, type: 'recovery', durationType: 'time', durationValue: 90, targetType: 'no_target', notes: 'jog' },
        ] },
        { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, targetType: 'no_target',
          notes: '4:30 (4:40) ((4:50))' },
      ] },
  ],
});
const PLAN = { ...plan(0), group2: plan(1), group3: plan(2) };

describe('weekly sessions fixture', () => {
  it('matches docs/contracts/fixtures/weekly-sessions.example.json', () => {
    const { sessions } = buildWeekBreakdown(PLAN);
    const out = { _note: 'Synthetic. sessions[] of GET /api/dashboard/weekly. Paces are seconds per km. groupPaces = [G1, G2, G3], null = no machine target (read notes).', sessions };
    const json = JSON.stringify(out, null, 2) + '\n';
    if (process.env.UPDATE_FIXTURE === '1' || !existsSync(FILE)) writeFileSync(FILE, json);
    expect(readFileSync(FILE, 'utf8')).toBe(json);
  });
});

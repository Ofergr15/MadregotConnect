import { describe, expect, it } from 'vitest';
import { convertToGarminWorkout } from '@/lib/garmin/converter';
import { getDefaultPaceProfile } from '@/lib/garmin/pace';
import { ALL_FIXTURES } from './fixtures/watch-workouts';

/**
 * Garmin regression guard for the watch-provider refactor (Phase 0).
 *
 * The golden file was written from the converter BEFORE anything in
 * src/lib/watch existed, so a diff here means the refactor changed what lands
 * on a Garmin watch. Three profiles × two alert modes × every fixture.
 */
const PROFILES = {
  live: { marathonGoal: 'SUB 2:30', offsetSeconds: 0 },
  zones: getDefaultPaceProfile(),
  empty: {},
} as const;

describe('Garmin output is byte-identical to the pre-refactor golden file', () => {
  it('matches for every fixture, profile and alert mode', async () => {
    const out: Record<string, unknown> = {};
    for (const [name, workout] of Object.entries(ALL_FIXTURES)) {
      for (const [profileName, profile] of Object.entries(PROFILES)) {
        for (const paceTarget of [false, true]) {
          out[`${name}|${profileName}|${paceTarget ? 'alerts' : 'info'}`] = convertToGarminWorkout(workout, profile, { paceTarget });
        }
      }
    }
    await expect(JSON.stringify(out, null, 2)).toMatchFileSnapshot('./fixtures/garmin-golden.json');
  });
});

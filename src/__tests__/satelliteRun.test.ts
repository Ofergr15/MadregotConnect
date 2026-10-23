import { describe, expect, it } from 'vitest';
import { isSatellite } from '@/lib/plan-execution/satellite';

const main = { id: 'm', athlete_id: 'a', start_time: '2026-10-23T04:56:38Z', duration: 8724, distance: 33866 };
describe('a warm-up or cool-down saved apart (10-23)', () => {
  it('the 3 km at 08:03, 42 min after the long run, is its cool-down', () =>
    expect(isSatellite({ id: 'c', athlete_id: 'a', start_time: '2026-10-23T08:03:16Z', duration: 1144, distance: 3008 }, [main])).toBe(true));
  it('an evening run is not', () =>
    expect(isSatellite({ id: 'e', athlete_id: 'a', start_time: '2026-10-23T17:00:00Z', duration: 1800, distance: 5000 }, [main])).toBe(false));
});

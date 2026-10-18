import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { mergeHolders } from '@/lib/day-session/watch';

/**
 * Deleting a one-day session (Ofer, 2026-10-18; mockups/day-session-manage): each session in
 * its own box, delete takes it off the watches first — every removal checked back with
 * Garmin and shown — and only then deletes the row.
 */
describe('who has the session on the watch', () => {
  it('reads BOTH records of a send — the old ids on the session and the delivery rows', () => {
    // 18.10 went out the old way: 22 runners, all in watch_deliveries.ids and no rows.
    // Reading the rows alone called it "on no watch" and would have left it on all 22.
    const by = mergeHolders('2026-10-18', [
      { athlete_id: 'new', garmin_workout_id: '900', provider: null, workout_key: 'day:2026-10-18' },
      { athlete_id: 'apple', garmin_workout_id: null, provider: 'apple', workout_key: null },
      { athlete_id: 'other-day', garmin_workout_id: '1', provider: null, workout_key: 'day:2026-10-19' },
    ], { ids: { old: ['1732417517'], new: [901] } });
    expect([...by.keys()].sort()).toEqual(['apple', 'new', 'old']);
    expect([...by.get('new')!.garmin].sort()).toEqual(['900', '901']);
    expect([...by.get('old')!.garmin]).toEqual(['1732417517']);
    expect(by.get('apple')!.apple).toBe(true);
  });

  it('a session never sent has nobody', () => {
    expect(mergeHolders('2026-10-19', [], { ids: {} }).size).toBe(0);
    expect(mergeHolders('2026-10-19', [], null).size).toBe(0);
  });
});

describe('the removal', () => {
  const watch = readFileSync('src/lib/day-session/watch.ts', 'utf8');
  const client = readFileSync('src/lib/garmin/client.ts', 'utf8');

  it('counts a watch as clear only when Garmin says the workout is gone', () => {
    expect(watch).toMatch(/if \(await garmin\.workoutExists\(id\)\) return \{ athleteId, status: 'failed'/);
    expect(client).toMatch(/if \(status === 404 \|\| status === 410\) return false;\s*throw err;/);
  });

  it('is gated like editing, and the screen does watches before the row', () => {
    const route = readFileSync('src/app/api/day-session/remove/route.ts', 'utf8');
    expect(route.match(/if \(!mayEditDaySession\(auth\.user\)\) return/g)).toHaveLength(2);
    expect(route).toMatch(/auth\.user\.viewingAsBy/);
    const list = readFileSync('src/components/day-session/SessionList.tsx', 'utf8');
    expect(list).toMatch(/if \(Object\.values\(results\)\.every\(Boolean\)\) \{\s*try \{ await deleteRow\(\); \}/);
    expect(list).toMatch(/retryFailed/);
  });

  it('opens on the list of sessions', () => {
    const page = readFileSync('src/app/(app)/dashboard/day-session/page.tsx', 'utf8');
    expect(page).toMatch(/useState<'list' \| 1 \| 2 \| 'watch' \| 'track'>\('list'\)/);
    expect(page).toMatch(/<SessionList/);
  });
});

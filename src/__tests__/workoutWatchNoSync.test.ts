import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * workout-watch has 60 s; a full Garmin sync of every athlete takes longer, so with
 * the sync inside it every team-day run timed out before it could notice a new run
 * (2026-10-13: 504 every quarter hour from 06:00) and the morning "new workout
 * detected" push never went out. /api/cron/sync fetches every 5 minutes with 300 s.
 */
const route = readFileSync(new URL('../app/api/cron/workout-watch/route.ts', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../app/api/cron/sync/route.ts', import.meta.url), 'utf8');

describe('morning workout detection', () => {
  it('does not run a Garmin sync inside its 60 seconds', () => {
    expect(route).toMatch(/export const maxDuration = 60;/);
    expect(route).not.toMatch(/pullRecentActivities\(|runSyncRequest|sync-activities/);
  });
  it('relies on the 5-minute sync, which has the time to walk everyone', () => {
    expect(sync).toMatch(/export const maxDuration = 300;/);
    expect(sync).toMatch(/export const FIRST_HOUR = 5;/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  LEGACY_DASHBOARD_SYNC_PREFIX,
  OPEN_SYNC_COOLDOWN_MS,
  STRAVA_OPEN_SYNC_PREFIX,
  shouldSyncOnOpen,
  stravaOpenSyncKey,
} from '@/lib/providers/open-sync';
import { IDENTITY_KEY_PREFIXES, identityKeysToRemove } from '@/lib/auth/identity-keys';

// The bug this guards, reported 2026-09-11 as "my workouts aren't coming in from
// Strava": the dashboard wrote '1' on a SUCCESSFUL sync and removed it only on
// failure, so the one trigger a Strava member had disarmed itself the first time
// it worked. The member's whole history landed the day he connected and nothing
// arrived after it. Nothing about that is observable in a browser after the fact —
// the flag looks identical to a flag written a minute ago — so the boundary lives
// here instead.
describe('shouldSyncOnOpen', () => {
  const NOW = Date.parse('2026-09-11T12:22:00Z');

  it('syncs when this device has never synced', () => {
    expect(shouldSyncOnOpen(null, NOW)).toBe(true);
    expect(shouldSyncOnOpen(undefined, NOW)).toBe(true);
    expect(shouldSyncOnOpen('', NOW)).toBe(true);
  });

  it('does NOT let a successful sync disarm the next one forever', () => {
    const stamp = String(NOW - OPEN_SYNC_COOLDOWN_MS - 1);
    expect(shouldSyncOnOpen(stamp, NOW)).toBe(true);
  });

  it('holds off inside the cooldown, so opening two screens is one sync', () => {
    expect(shouldSyncOnOpen(String(NOW), NOW)).toBe(false);
    expect(shouldSyncOnOpen(String(NOW - 60_000), NOW)).toBe(false);
  });

  it('is due exactly at the cooldown boundary', () => {
    expect(shouldSyncOnOpen(String(NOW - OPEN_SYNC_COOLDOWN_MS), NOW)).toBe(true);
    expect(shouldSyncOnOpen(String(NOW - OPEN_SYNC_COOLDOWN_MS + 1), NOW)).toBe(false);
  });

  it("treats the old '1' flag as due, so no device needs a cache clear", () => {
    // Every phone in the club is carrying one of these right now. Read as a
    // number it is one millisecond after 1970, which is what makes the upgrade
    // path free: the next app open syncs and rewrites it as a real timestamp.
    expect(shouldSyncOnOpen('1', NOW)).toBe(true);
  });

  it('treats an unreadable or future stamp as due rather than as a lock', () => {
    expect(shouldSyncOnOpen('yesterday', NOW)).toBe(true);
    expect(shouldSyncOnOpen('0', NOW)).toBe(true);
    expect(shouldSyncOnOpen('-5', NOW)).toBe(true);
    // A phone whose clock was wrong when the stamp was written. Trusting it would
    // switch syncing off until the clock caught up.
    expect(shouldSyncOnOpen(String(NOW + 86_400_000), NOW)).toBe(true);
  });

  it('honours a caller-supplied cooldown', () => {
    expect(shouldSyncOnOpen(String(NOW - 5_000), NOW, 1_000)).toBe(true);
    expect(shouldSyncOnOpen(String(NOW - 500), NOW, 1_000)).toBe(false);
  });

  it('keeps the cooldown short enough to be useful after a run', () => {
    // Longer than this and the member who finishes a run, waits for Strava to
    // process it and opens the app still sees nothing — which is the complaint.
    expect(OPEN_SYNC_COOLDOWN_MS).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(OPEN_SYNC_COOLDOWN_MS).toBeGreaterThan(60 * 1000);
  });
});

describe('stravaOpenSyncKey', () => {
  it('is scoped per athlete, so a shared phone cannot inherit a stamp', () => {
    expect(stravaOpenSyncKey('a1')).toBe(`${STRAVA_OPEN_SYNC_PREFIX}a1`);
    expect(stravaOpenSyncKey('a1')).not.toBe(stravaOpenSyncKey('a2'));
  });
});

// The second half of the same bug: IDENTITY_KEYS carries the bare name
// 'dashboard_synced', while what was written is `dashboard_synced:<athleteId>` —
// so signing out never removed it, and the listed name has been decorative since
// the suffix was added.
describe('identityKeysToRemove', () => {
  it('catches the per-athlete stamps a bare key name misses', () => {
    const stored = [
      'locale',
      'athlete_id',
      `${LEGACY_DASHBOARD_SYNC_PREFIX}2d20dd3c`,
      `${STRAVA_OPEN_SYNC_PREFIX}2d20dd3c`,
      `${STRAVA_OPEN_SYNC_PREFIX}9fd3d199`,
    ];

    expect(identityKeysToRemove(stored).sort()).toEqual([
      `${LEGACY_DASHBOARD_SYNC_PREFIX}2d20dd3c`,
      `${STRAVA_OPEN_SYNC_PREFIX}2d20dd3c`,
      `${STRAVA_OPEN_SYNC_PREFIX}9fd3d199`,
    ]);
  });

  it('leaves everything else alone', () => {
    expect(identityKeysToRemove(['locale', 'connect_data_source_dismissed'])).toEqual([]);
    expect(identityKeysToRemove([])).toEqual([]);
  });

  it('covers both the key the dashboard used to write and the one it writes now', () => {
    expect(IDENTITY_KEY_PREFIXES).toContain(LEGACY_DASHBOARD_SYNC_PREFIX);
    expect(IDENTITY_KEY_PREFIXES).toContain(STRAVA_OPEN_SYNC_PREFIX);
  });
});

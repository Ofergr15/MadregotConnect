import { describe, expect, it } from 'vitest';
import { computeMutedAthleteIds } from '@/lib/push';
import { isClubAccount, isKindMuted } from '@/lib/notifications/prefs';

// The club's admin account (role 'admin') gets the running-the-club alerts only.
describe('club admin account notifications', () => {
  const rows: Array<{ id: string; role: string; notification_prefs: Record<string, boolean> | null }> = [
    { id: 'admin', role: 'admin', notification_prefs: { workouts: true, news: true } },
    { id: 'ofer', role: 'runner', notification_prefs: { workouts: true } },
    { id: 'coach', role: 'coach', notification_prefs: null },
  ];

  it('mutes every non-management category for the admin account, whatever it saved', () => {
    for (const c of ['workouts', 'news', 'program', 'teammates', 'coach', 'achievements', 'events'] as const) {
      expect(computeMutedAthleteIds(rows, c).has('admin')).toBe(true);
    }
  });

  it('keeps management for the admin account', () => {
    expect(computeMutedAthleteIds(rows, 'management').has('admin')).toBe(false);
  });

  it('leaves the runner account and other staff as before', () => {
    expect(computeMutedAthleteIds(rows, 'workouts').has('ofer')).toBe(false);
    expect(computeMutedAthleteIds(rows, 'workouts').has('coach')).toBe(false);
    expect(computeMutedAthleteIds(rows, 'teammates').has('coach')).toBe(true); // staff social-quiet default
  });

  it('isKindMuted agrees for the inbox and badge', () => {
    expect(isKindMuted('training_before', { workouts: true }, true, 'admin')).toBe(true);
    expect(isKindMuted('push_approval', null, true, 'admin')).toBe(false);
    expect(isKindMuted('problem_report', null, true, 'admin')).toBe(false);
    expect(isKindMuted('training_before', { workouts: true }, false, 'runner')).toBe(false);
    expect(isClubAccount('admin')).toBe(true);
    expect(isClubAccount('runner')).toBe(false);
  });
});

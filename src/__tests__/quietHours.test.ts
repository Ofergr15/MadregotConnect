import { describe, expect, it } from 'vitest';
import { inQuietWindow, msUntilQuietEnds, quietDecision, readQuietHours, readQuietPatch, QUIET_DEFAULT } from '@/lib/notifications/quiet-hours';

// 2026-11-21 is winter time in Israel: UTC+2.
const israel = (hh: number, mm = 0) => Date.UTC(2026, 10, 21, hh - 2, mm);

describe('quiet hours', () => {
  it('defaults ON, 22:00–07:00, for a member who never opened the screen', () => {
    expect(readQuietHours(null)).toEqual(QUIET_DEFAULT);
    expect(readQuietHours({ workouts: true })).toEqual({ enabled: true, from: '22:00', to: '07:00' });
  });
  it('wraps midnight', () => {
    const q = QUIET_DEFAULT;
    expect(inQuietWindow(q, 22 * 60)).toBe(true);
    expect(inQuietWindow(q, 3 * 60)).toBe(true);
    expect(inQuietWindow(q, 7 * 60)).toBe(false);
    expect(inQuietWindow(q, 12 * 60)).toBe(false);
    expect(inQuietWindow({ ...q, enabled: false }, 23 * 60)).toBe(false);
  });
  it('drops a social push at night, sends it by day', () => {
    expect(quietDecision('like', QUIET_DEFAULT, israel(23))).toBe('drop');
    expect(quietDecision('like', QUIET_DEFAULT, israel(9))).toBe('send');
  });
  it('a direct coach message breaks through', () => {
    expect(quietDecision('coach_message', QUIET_DEFAULT, israel(23, 30))).toBe('send');
  });
  it('a staff pain alert waits for the end of THAT staff member\'s window', () => {
    expect(quietDecision('pain_report', QUIET_DEFAULT, israel(23))).toBe('defer');
    expect(msUntilQuietEnds(QUIET_DEFAULT, israel(23))).toBe(8 * 3600_000);
    const late = { enabled: true, from: '23:00', to: '06:30' };
    expect(quietDecision('pain_report', late, israel(22, 30))).toBe('send');
    expect(msUntilQuietEnds(late, israel(5))).toBe(90 * 60_000);
  });
  it('validates the PATCH body strictly', () => {
    expect(readQuietPatch({ enabled: true, from: '22:00', to: '07:00' })).toEqual({ enabled: true, from: '22:00', to: '07:00' });
    expect(readQuietPatch({ enabled: true, from: '25:00', to: '07:00' })).toBeNull();
    expect(readQuietPatch({ enabled: 'yes', from: '22:00', to: '07:00' })).toBeNull();
    expect(readQuietPatch({ enabled: true, from: '07:00', to: '07:00' })).toBeNull();
  });
});

import { readFileSync } from 'fs';
describe('send path wiring', () => {
  const cron = readFileSync('src/app/api/cron/notifications/route.ts', 'utf8');
  it('the held-over alert is handled before the poll-reminder branch (both end silent)', () => {
    expect(cron.indexOf('n.kind === QUIET_DEFERRED_KIND) {')).toBeLessThan(cron.indexOf('if (reminder) {'));
  });
  it('pushes go through the quiet filter, and a re-send is not deferred twice', () => {
    const push = readFileSync('src/lib/push.ts', 'utf8');
    expect(push).toMatch(/quietDecision\(payload\.kind/);
    expect(push).toMatch(/if \(!payload\.deferred\)/);
  });
});

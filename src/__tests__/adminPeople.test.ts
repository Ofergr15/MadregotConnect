import { describe, expect, it } from 'vitest';
import { filterCounts, matchesFilter, personState, type Person } from '@/lib/admin/people';
import { challengePhase } from '@/lib/admin/content';

// The admin's People list (#71 phase 2): one pill per row, most actionable first,
// and filters that are facts rather than the pill.

const TODAY = '2026-09-23';
const base: Person = {
  id: 'a', name: 'Dana', role: 'runner', groupName: null, status: 'active', approved: true,
  source: 'garmin', lastRunDay: '2026-09-22', lastSeenAt: null, joinedAt: null,
  setupDone: true, pushDevices: 1, lastPushAt: null,
};
const p = (over: Partial<Person>): Person => ({ ...base, ...over });

describe('personState', () => {
  it('puts somebody waiting for approval before everything else', () => {
    expect(personState(p({ approved: false, source: null, setupDone: false }), TODAY)).toBe('waiting');
    expect(personState(p({ status: 'invited' }), TODAY)).toBe('waiting');
  });

  it('ranks no watch above unfinished setup, and setup above silent', () => {
    expect(personState(p({ source: null, setupDone: false }), TODAY)).toBe('noWatch');
    expect(personState(p({ setupDone: false, lastRunDay: null }), TODAY)).toBe('setup');
    expect(personState(p({ lastRunDay: null }), TODAY)).toBe('silent');
  });

  it('calls a member silent on the same 7-day line as the home tile', () => {
    // The home tile counts no run in today-6..today, so a run on day -6 is not silent.
    expect(personState(p({ lastRunDay: '2026-09-17' }), TODAY)).toBe('active');
    expect(personState(p({ lastRunDay: '2026-09-16' }), TODAY)).toBe('silent');
  });
});

describe('filters', () => {
  it('lists a member under every chip that is true of them, and paused under all only', () => {
    const both = p({ source: null, setupDone: false, lastRunDay: null });
    expect(matchesFilter(both, 'noWatch', TODAY)).toBe(true);
    expect(matchesFilter(both, 'setup', TODAY)).toBe(true);
    expect(matchesFilter(both, 'silent', TODAY)).toBe(true);
    const paused = p({ status: 'paused', lastRunDay: null });
    expect(matchesFilter(paused, 'silent', TODAY)).toBe(false);
    expect(matchesFilter(paused, 'all', TODAY)).toBe(true);
  });

  it('never counts a waiting member as silent or unfinished', () => {
    const waiting = p({ approved: false, setupDone: false, lastRunDay: null });
    expect(filterCounts([waiting, base], TODAY)).toEqual({ all: 2, waiting: 1, setup: 0, noWatch: 0, silent: 0 });
  });
});

describe('challengePhase', () => {
  it('files a challenge by its dates, and one switched off mid-window as ended', () => {
    const c = { start_date: '2026-09-01', end_date: '2026-09-30', active: true };
    expect(challengePhase(c, TODAY)).toBe('active');
    expect(challengePhase({ ...c, start_date: '2026-10-01', end_date: '2026-10-31' }, TODAY)).toBe('scheduled');
    expect(challengePhase({ ...c, end_date: '2026-09-22' }, TODAY)).toBe('ended');
    expect(challengePhase({ ...c, active: false }, TODAY)).toBe('ended');
  });
});

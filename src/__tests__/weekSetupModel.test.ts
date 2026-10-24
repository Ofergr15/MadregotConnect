import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OWNERS, canEdit, israelHourToIso, normalizeOwners, overrideFor, readiness, slotKey, weekTimeline, withOverride, withOverrideCopy,
  type TimelineInput,
} from '@/lib/week-setup/model';

const base = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  weekStart: '2026-10-18',
  teamDays: [2, 5],
  dayBefore: { enabled: true, hour: 8 },
  eveningBefore: { enabled: true, hour: 18 },
  fired: new Set(),
  overrides: {},
  approval: () => 'not_needed',
  copy: (stage, day) => ({ title: `${stage} ${day}`, body: 'b' }),
  custom: [],
  ...over,
});

describe('owners', () => {
  it('falls back to the default split and ignores junk', () => {
    expect(normalizeOwners(null)).toEqual(DEFAULT_OWNERS);
    expect(normalizeOwners({ quality: 'both', polls: 'nobody' })).toEqual({ ...DEFAULT_OWNERS, quality: 'both' });
  });
  it('lets the admin change anything and a coach only what is not the admin’s', () => {
    const o = normalizeOwners({ quality: 'both' });
    expect(canEdit('notifications', o, { admin: true, coach: false })).toBe(true);
    expect(canEdit('workouts', o, { admin: false, coach: true })).toBe(true);
    expect(canEdit('quality', o, { admin: false, coach: true })).toBe(true);
    expect(canEdit('notifications', o, { admin: false, coach: true })).toBe(false);
    expect(canEdit('workouts', o, { admin: false, coach: false })).toBe(false);
  });
});

describe('overrides', () => {
  it('sets, cleans and removes one slot, dropping weeks older than three', () => {
    let s = withOverride({ '2026-09-06': { weekStory: { off: true } } }, '2026-10-18', slotKey('dayBefore', 2), { title: '  New ', hour: 6, body: '' }, '2026-10-19');
    expect(s).toEqual({ '2026-10-18': { 'dayBefore:2': { title: 'New', hour: 6 } } });
    expect(overrideFor(s, '2026-10-18', 'dayBefore', 2)).toEqual({ title: 'New', hour: 6 });
    s = withOverride(s, '2026-10-18', 'dayBefore:2', null, '2026-10-19');
    expect(s).toEqual({});
  });
  it('replaces only the text that was set', () => {
    expect(withOverrideCopy({ title: 'a', body: 'b', tag: 'x' }, { body: 'B' })).toEqual({ title: 'a', body: 'B', tag: 'x' });
    expect(withOverrideCopy({ title: 'a', body: 'b' }, null)).toEqual({ title: 'a', body: 'b' });
  });
});

describe('weekTimeline', () => {
  it('lists the day-before pair for each team day and the Saturday story, in order', () => {
    const rows = weekTimeline(base());
    expect(rows.map((r) => `${r.date} ${r.hour} ${r.key}`)).toEqual([
      '2026-10-19 8 dayBefore:2', '2026-10-19 18 eveningBefore:2',
      '2026-10-22 8 dayBefore:5', '2026-10-22 18 eveningBefore:5',
      '2026-10-24 12 weekStory',
    ]);
    expect(rows.every((r) => r.state === 'scheduled' && !r.changed)).toBe(true);
  });
  it('shows sent, off, waiting for approval, and this week’s text and hour', () => {
    const rows = weekTimeline(base({
      fired: new Set(['dayBefore:2026-10-18:2']),
      overrides: { '2026-10-18': { 'eveningBefore:2': { off: true }, 'dayBefore:5': { title: 'T', hour: 7 } } },
      approval: (d) => (d === '2026-10-23' ? 'pending' : 'not_needed'),
    }));
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by['dayBefore:2'].state).toBe('sent');
    expect(by['eveningBefore:2'].state).toBe('off');
    expect(by['dayBefore:5']).toMatchObject({ state: 'approve', title: 'T', defaultTitle: 'dayBefore 5', hour: 7, changed: true });
  });
  it('places a scheduled custom one at its Israel hour', () => {
    const rows = weekTimeline(base({ teamDays: [], custom: [{ id: 'x', title: 'c', body: 'b', at: '2026-10-20T06:00:00Z', audience: 'all', sent: false }] }));
    expect(rows[0]).toMatchObject({ key: 'custom:x', date: '2026-10-20', hour: 9, state: 'scheduled' });
  });
});

describe('israelHourToIso', () => {
  it('handles both offsets', () => {
    expect(israelHourToIso('2026-10-20', 9)).toBe('2026-10-20T06:00:00.000Z');
    expect(israelHourToIso('2026-12-01', 9)).toBe('2026-12-01T07:00:00.000Z');
  });
});

describe("readiness — the Saturday's seven steps, the watches last (10-24)", () => {
  it('counts all seven, in order, and names the next one', () => {
    expect(readiness({ planStatus: 'draft', nutrition: true, qualityPicked: false, toApprove: 2, polls: false, message: false }))
      .toEqual({ done: 2, total: 7, missing: ['quality', 'notifications', 'polls', 'message', 'watches'], next: 'quality' });
  });
  it('the watches are done only once the whole week reached them', () => {
    const all = { nutrition: true, qualityPicked: true, toApprove: 0, polls: true, message: true };
    expect(readiness({ planStatus: 'partial', ...all })).toMatchObject({ done: 6, next: 'watches' });
    expect(readiness({ planStatus: 'pushed', ...all })).toMatchObject({ done: 7, missing: [], next: null });
    expect(readiness({ planStatus: 'none', ...all })).toMatchObject({ next: 'workouts' });
  });
});

describe('the week\'s log — who did what', () => {
  it('appends, keeps five weeks, and gives the last entry per step', async () => {
    const { withEntry, lastByStep, skipped } = await import('@/lib/week-setup/log');
    const e = (at: string, step: 'workouts' | 'polls', action: 'plan_uploaded' | 'skipped' | 'poll_created', name = 'Yair') => ({ at, by: 'a1', name, step, action } as const);
    let store = withEntry({ '2026-09-06': [e('2026-09-05T18:00:00Z', 'workouts', 'plan_uploaded')] }, '2026-10-25', e('2026-10-24T18:17:00Z', 'workouts', 'plan_uploaded'), '2026-10-24');
    expect(Object.keys(store)).toEqual(['2026-10-25']);
    store = withEntry(store, '2026-10-25', e('2026-10-24T19:00:00Z', 'polls', 'skipped', 'Ofer'), '2026-10-24');
    expect(lastByStep(store['2026-10-25']).workouts?.name).toBe('Yair');
    expect(skipped(store['2026-10-25'], 'polls')).toBe(true);
    store = withEntry(store, '2026-10-25', e('2026-10-24T19:05:00Z', 'polls', 'poll_created', 'Ofer'), '2026-10-24');
    expect(skipped(store['2026-10-25'], 'polls')).toBe(false);
  });
  it("a Saturday's work is for the week that starts the next morning", async () => {
    const { weekOfAction } = await import('@/lib/week-setup/log');
    expect(weekOfAction('2026-10-24')).toBe('2026-10-25'); // Saturday
    expect(weekOfAction('2026-10-25')).toBe('2026-10-25'); // Sunday
    expect(weekOfAction('2026-10-30')).toBe('2026-10-25'); // Friday
  });
});

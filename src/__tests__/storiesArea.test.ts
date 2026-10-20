import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => { throw new Error('no default db in tests'); } }));

const inst = await import('@/lib/stories/instances');
const area = await import('@/lib/stories/area');
type Settings = import('@/lib/stories/gate').StorySettingsRow;

const birthday: Settings = { feature: 'birthday', state: 'all', send_push: true, feed_post: true, generate_at: '06:00', weekday: null, annual_date: null, display_days: 3, min_runs: 1 };
const NOW = new Date('2026-10-20T10:00:00Z');

describe('story_instances 162: placement, push, manual end', () => {
  it('defaults: both places, push on, publish + display_days', () => {
    const e = inst.effectiveFor(birthday, '2026-10-21', null);
    expect(e.placement).toBe('both');
    expect(e.sendPush).toBe(true);
    expect(e.until.getTime() - e.publishAt.getTime()).toBe(3 * 86_400_000);
  });
  it('circle only / no push / a manual end', () => {
    const e = inst.effectiveFor(birthday, '2026-10-21', { placement: 'circle', send_push: false, until_at: '2026-10-23T17:00:00Z' });
    expect(e.placement).toBe('circle');
    expect(e.sendPush).toBe(false);
    expect(e.until.toISOString()).toBe('2026-10-23T17:00:00.000Z');
    expect(e.overridden).toEqual(expect.arrayContaining(['placement', 'send_push', 'until_at']));
  });
  it('an end before the start is ignored', () => {
    const e = inst.effectiveFor(birthday, '2026-10-21', { until_at: '2026-10-20T00:00:00Z' });
    expect(e.until.getTime() - e.publishAt.getTime()).toBe(3 * 86_400_000);
  });
  it('the feature switch still wins: push off for the club = no push for anyone', () => {
    expect(inst.effectiveFor({ ...birthday, send_push: false }, '2026-10-21', { send_push: true }).sendPush).toBe(false);
  });
  it('no push when the person has it off', () => {
    const e = inst.effectiveFor(birthday, '2026-10-20', { send_push: false });
    expect(inst.pushDueAt(e, new Date(e.publishAt.getTime() + 60_000), null)).toBe(false);
    expect(inst.pushDueAt(inst.effectiveFor(birthday, '2026-10-20', null), new Date(e.publishAt.getTime() + 60_000), null)).toBe(true);
  });
  it('validates the new keys', () => {
    expect(inst.validateOverrides({ placement: 'feed', send_push: false }, NOW)).toEqual({ ok: true, value: { placement: 'feed', send_push: false } });
    expect(inst.validateOverrides({ placement: 'story' }, NOW).ok).toBe(false);
    expect(inst.validateOverrides({ until_at: '2026-10-19T00:00:00Z' }, NOW).ok).toBe(false);
    expect(inst.validateOverrides({ publish_at: '2026-10-22T04:00:00Z', until_at: '2026-10-21T04:00:00Z' }, NOW).ok).toBe(false);
    expect(inst.validateOverrides({ publish_at: '2026-10-21T04:00:00Z', until_at: '2026-10-23T17:00:00Z' }, NOW).ok).toBe(true);
  });
  it('the chip says what changed', () => {
    expect(inst.overrideSummary(inst.effectiveFor(birthday, '2026-10-21', { placement: 'circle', send_push: false }))).toBe('מותאם: רק עיגול · בלי התראה');
  });
});

describe('the screen ⇄ the overrides', () => {
  it('a chip duration clears a manual end', () => {
    expect(area.saveBody({ placement: 'both', duration: 3, from: null, to: null, push: true }))
      .toEqual({ placement: 'both', send_push: true, display_days: 3, until_at: null });
  });
  it('a manual range sets both ends', () => {
    expect(area.saveBody({ placement: 'circle', duration: 'manual', from: 'A', to: 'B', push: false }))
      .toEqual({ placement: 'circle', send_push: false, publish_at: 'A', until_at: 'B', display_days: null });
  });
  it('reads the choice back', () => {
    expect(area.durationOf({ displayDays: 7 })).toBe(7);
    expect(area.durationOf({ displayDays: 3, manualUntil: true })).toBe('manual');
    expect(area.durationOf({ displayDays: 5 })).toBe('manual');
  });
  it('ready = a word or a photo', () => {
    expect(area.birthdayReady(null)).toBe(false);
    expect(area.birthdayReady({ message: '  ' })).toBe(false);
    expect(area.birthdayReady({ photos: { intro: 'x' } })).toBe(true);
  });
});

describe('the hub\'s "this week"', () => {
  const today = '2026-10-20';
  it('splits live, scheduled and testing — and leaves out what is empty', () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const s = area.weekSections(
      [
        { id: '1', source: 'club', emoji: '⭕', title: 'עיגול', until: '2026-10-22', active: true },
        { id: '2', source: 'survey', emoji: '📊', title: 'סקר', until: '2026-10-25', active: true, answers: 34 },
        { id: '3', source: 'feed', emoji: '🎂', title: 'ישן', until: '2026-10-19', active: false },
        { id: '4', source: 'scheduled', emoji: '📣', title: 'הודעה', until: '', active: false, at: '2026-10-21T16:00:00Z' },
      ],
      [
        { athleteId: 'a', name: 'נועה כהן', period: '2026-10-21', bucket: 'tomorrow', status: 'ready', publishAt: '2026-10-21T03:00:00Z' },
        { athleteId: 'b', name: 'דנה', period: '2026-10-22', bucket: 'week', status: 'skipped', publishAt: '2026-10-22T03:00:00Z' },
      ],
      [{ feature: 'weekly', state: 'testers' }, { feature: 'annual', state: 'off' }],
      today,
    );
    vi.useRealTimers();
    expect(s.air.map((r) => r.title)).toEqual(['עיגול', 'סקר']);
    expect(s.air[1].sub).toBe('34 ענו · נסגר א׳');
    expect(s.scheduled.map((r) => r.title)).toEqual(['הודעה', 'נועה · יום הולדת']);
    expect(s.scheduled[1].sub).toBe('מחר 06:00');
    expect(s.scheduled[1].href).toBe('/dashboard/birthdays/a?period=2026-10-21');
    expect(s.testing.map((r) => r.title)).toEqual(['סיכום שבועי']);
  });
  it('nothing on = three empty sections', () => {
    const s = area.weekSections([], [], [{ feature: 'birthday', state: 'off' }], today);
    expect(s).toEqual({ air: [], scheduled: [], testing: [] });
  });
});

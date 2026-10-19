import { describe, expect, it } from 'vitest';
import { byDay, dayHeading, usualPace, validateMeetupDraft } from '@/lib/runs/meetups';

/** "לרוץ ביחד" v2 (2026-10-19): kind, meeting point and audience; the board's days; my pace. */
const today = '2026-10-19';
const base = { date: '2026-10-24', startTime: '6:00', location: 'פארק הרצליה' };

describe('a new run', () => {
  it('carries its kind, meeting point and who is told', () => {
    const r = validateMeetupDraft({ ...base, kind: 'long', lat: 32.16551234, lng: 34.8205, audience: 'pack' }, today);
    expect(r.ok && r.value).toMatchObject({ startTime: '06:00', kind: 'long', lat: 32.16551, lng: 34.8205, audience: 'pack' });
  });
  it('a point needs both coordinates, inside Israel; an unknown kind is refused', () => {
    expect(validateMeetupDraft({ ...base, lat: 35.1, lng: 33.3 }, today)).toMatchObject({ ok: false, field: 'location' });
    expect(validateMeetupDraft({ ...base, kind: 'sprint' }, today)).toMatchObject({ ok: false, field: 'kind' });
  });
  it('no point and no audience: the whole club, no pin', () => {
    const r = validateMeetupDraft(base, today);
    expect(r.ok && r.value).toMatchObject({ lat: null, lng: null, audience: 'club', kind: null });
  });
});

describe('the board', () => {
  it('says today, tomorrow, else the weekday with the date', () => {
    expect(dayHeading('2026-10-19', today)).toEqual({ title: 'היום', sub: 'שני 19.10' });
    expect(dayHeading('2026-10-20', today)).toEqual({ title: 'מחר', sub: 'שלישי 20.10' });
    expect(dayHeading('2026-10-24', today)).toEqual({ title: 'שבת', sub: '24.10' });
  });
  it('groups by day in order', () => {
    expect(byDay([{ date: 'a', i: 1 }, { date: 'a', i: 2 }, { date: 'b', i: 3 }]).map((d) => [d.date, d.items.length])).toEqual([['a', 2], ['b', 1]]);
  });
  it('my usual pace is the median of my recent 5–25 km runs, or nothing with too few', () => {
    const run = (km: number, pace: number) => ({ distance: km * 1000, duration: km * pace });
    expect(usualPace([run(10, 300), run(12, 310), run(8, 290), run(3, 200), run(42, 280)])).toBe('5:00');
    expect(usualPace([run(10, 300), run(12, 310)])).toBeNull();
  });
});

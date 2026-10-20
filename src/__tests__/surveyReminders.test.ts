import { describe, expect, it } from 'vitest';
import { closePreset, israelDateTime, israelLocalToIso, outOfNight, planReminders, readReminders } from '@/lib/survey-reminders';

// Tuesday 2026-10-20 18:00 in Israel (UTC+3 until the 25th).
const NOW = new Date('2026-10-20T15:00:00Z');
const il = (iso: string) => { const x = israelDateTime(iso); return `${x.date} ${x.time}`; };

describe('closing a poll', () => {
  it('reads an Israel date and time, either side of the clock change', () => {
    expect(israelLocalToIso('2026-10-22', '20:00')).toBe('2026-10-22T17:00:00.000Z');
    expect(israelLocalToIso('2026-10-29', '20:00')).toBe('2026-10-29T18:00:00.000Z');
    expect(israelLocalToIso('2026-10-29', '25:00')).toBeNull();
    expect(israelLocalToIso('29.10', '20:00')).toBeNull();
  });
  it('the quick buttons fill in a date and a time', () => {
    expect(closePreset('today', NOW)).toEqual({ date: '2026-10-20', time: '22:00' });
    expect(closePreset('tomorrow', NOW)).toEqual({ date: '2026-10-21', time: '20:00' });
    expect(closePreset('week', NOW)).toEqual({ date: '2026-10-27', time: '20:00' });
  });
});

describe('reminders before the close', () => {
  const close = israelLocalToIso('2026-10-29', '20:00')!;
  it('a week, 24 hours and an hour before', () => {
    const r = planReminders(close, ['week', 'day', 'hour'], [], NOW);
    expect(r.map((x) => [x.key, il(x.at), x.skip])).toEqual([
      ['week', '2026-10-22 20:00', false],
      ['day', '2026-10-28 20:00', false],
      ['hour', '2026-10-29 19:00', false],
    ]);
  });
  it('one whose time has passed is not sent', () => {
    const r = planReminders(israelLocalToIso('2026-10-21', '20:00'), ['week', 'day', 'hour'], [], NOW);
    expect(r.filter((x) => x.skip).map((x) => x.key)).toEqual(['week']);
    expect(il(r.find((x) => x.key === 'day')!.at)).toBe('2026-10-20 20:00');
  });
  it('the night moves to 07:00, and past the close it is not sent', () => {
    expect(il(new Date(outOfNight(Date.parse('2026-10-20T20:30:00Z')).ms).toISOString())).toBe('2026-10-21 07:00');
    expect(il(new Date(outOfNight(Date.parse('2026-10-21T01:00:00Z')).ms).toISOString())).toBe('2026-10-21 07:00');
    const late = planReminders(israelLocalToIso('2026-10-24', '23:30'), ['hour'], [], NOW)[0];
    expect(late.moved).toBe(true);
    expect(late.skip).toBe(true);
    const early = planReminders(israelLocalToIso('2026-10-24', '08:00'), ['day'], [], NOW)[0];
    expect(il(early.at)).toBe('2026-10-23 08:00');
  });
  it('a time of their own, and two on the same minute once', () => {
    const own = israelLocalToIso('2026-10-28', '20:00')!;
    const r = planReminders(close, ['day'], [own], NOW);
    expect(r.length).toBe(1);
    expect(planReminders(null, ['day'], [], NOW)).toEqual([]);
  });
  it('reads only what it knows from a request', () => {
    expect(readReminders({ picked: ['hour', 'x', 'week'], custom: ['nope', '2026-10-28T17:00:00Z'] })).toEqual({ picked: ['week', 'hour'], custom: ['2026-10-28T17:00:00Z'] });
    expect(readReminders(null)).toEqual({ picked: [], custom: [] });
  });
});

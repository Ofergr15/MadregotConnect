import { describe, expect, it } from 'vitest';
import { computeMonthlyExtra, type XAthlete, type XInput } from '@/lib/club-numbers/monthly-extra';

const months = ['2026-09', '2026-10', '2026-11'];
const ath = (id: string, over: Partial<XAthlete> = {}): XAthlete => ({
  id, createdAt: '2026-01-10T00:00:00Z', removedAt: null, status: 'active', groupName: 'Group B', isAcademy: false, academyJoinedOn: null,
  garmin: false, strava: false, garminConnectedAt: null, stravaConnectedAt: null, ...over,
});
const input = (over: Partial<XInput>): XInput => ({
  months, athletes: [], runs: [], packHistory: [], u21: [], rsvps: [], presence: [], races: [], plans: [], matches: [], ...over,
});
const nov = (out: ReturnType<typeof computeMonthlyExtra>) => out.series.at(-1)!;

describe('packs', () => {
  it('places each member in the pack they were in at the month end, academy apart', () => {
    const out = computeMonthlyExtra(input({
      athletes: [ath('a', { groupName: 'Group A' }), ath('b'), ath('c', { isAcademy: true, academyJoinedOn: '2026-10-20' }), ath('d', { groupName: null })],
      packHistory: [{ athleteId: 'a', groupName: 'Group C', fromDate: '2026-01-10' }, { athleteId: 'a', groupName: 'Group A', fromDate: '2026-11-05' }],
      runs: [{ athleteId: 'a', date: '2026-11-06', km: 12.4 }, { athleteId: 'a', date: '2026-10-06', km: 10 }, { athleteId: 'c', date: '2026-11-02', km: 8 }],
    }));
    expect(nov(out).packs['דבוקה 1']).toEqual({ members: 1, km: 12 });
    expect(out.series[1].packs['דבוקה 3']).toEqual({ members: 1, km: 10 }); // October: still in C
    expect(nov(out).packs['אקדמיה']).toEqual({ members: 1, km: 8 });
    expect(out.series[0].packs['אקדמיה'].members).toBe(0); // joined the academy in October
    expect(nov(out).packs['בלי דבוקה'].members).toBe(1);
  });
});

describe('tracks and watch', () => {
  it('counts club / academy / U21 forms and the watch at month end', () => {
    const out = computeMonthlyExtra(input({
      athletes: [
        ath('a', { garmin: true, garminConnectedAt: '2026-10-15T00:00:00Z' }),
        ath('b', { strava: true }),
        ath('c', { isAcademy: true, garmin: true, strava: true }),
        ath('d'),
      ],
      u21: [{ createdAt: '2026-11-03T00:00:00Z' }, { createdAt: '2026-10-03T00:00:00Z' }],
    }));
    expect(nov(out).tracks).toEqual({ club: 3, academy: 1, u21: 1 });
    expect(nov(out).watch).toEqual({ garmin: 2, stravaOnly: 1, none: 1 });
    expect(out.series[0].watch).toEqual({ garmin: 1, stravaOnly: 1, none: 2 }); // a connected in October
  });
});

describe('attendance', () => {
  it('reads only marked days, and is null before marking began', () => {
    const out = computeMonthlyExtra(input({
      athletes: [ath('a'), ath('b'), ath('c')],
      rsvps: [
        { athleteId: 'a', date: '2026-11-10', attending: true }, { athleteId: 'b', date: '2026-11-10', attending: true },
        { athleteId: 'c', date: '2026-11-10', attending: false }, { athleteId: 'a', date: '2026-10-10', attending: true },
      ],
      presence: [{ athleteId: 'a', date: '2026-11-10', present: true }, { athleteId: 'b', date: '2026-11-10', present: false }, { athleteId: 'c', date: '2026-11-10', present: true }],
    }));
    expect(nov(out).attendance).toEqual({ days: 1, rsvp: 2, came: 1, present: 2 });
    expect(out.series[1].attendance).toBeNull();
  });
});

describe('races and PRs', () => {
  it('a PR is faster than an earlier race at the same distance; a first race is not one', () => {
    const out = computeMonthlyExtra(input({
      athletes: [ath('a'), ath('b')],
      races: [
        { athleteId: 'a', distance: '10k', seconds: 2500, date: '2026-03-01' },
        { athleteId: 'a', distance: '10k', seconds: 2450, date: '2026-11-08' },
        { athleteId: 'a', distance: 'half', seconds: 5600, date: '2026-11-20' },
        { athleteId: 'b', distance: '10k', seconds: 2600, date: '2026-11-08' },
        { athleteId: 'b', distance: '10k', seconds: 2700, date: '2026-10-08' },
      ],
    }));
    expect(nov(out).races).toBe(3);
    expect(nov(out).prs).toBe(2);
    expect(out.series[1].prs).toBe(0);
  });
});

describe('quality session', () => {
  it('share of the week\'s runners who ran a quality day\'s workout, averaged over the month', () => {
    const out = computeMonthlyExtra(input({
      athletes: [ath('a'), ath('b'), ath('c')],
      runs: [{ athleteId: 'a', date: '2026-11-03', km: 10 }, { athleteId: 'b', date: '2026-11-04', km: 10 }, { athleteId: 'a', date: '2026-11-10', km: 10 }],
      plans: [
        { weekStart: '2026-11-01', qualityDays: [2], keyDay: { tue: 2, wed: 3 } },
        { weekStart: '2026-11-08', qualityDays: [2], keyDay: { tue: 2 } },
        { weekStart: '2026-11-15', qualityDays: [], keyDay: {} },
      ],
      matches: [
        { athleteId: 'a', weekStart: '2026-11-01', workoutKey: 'tue' },
        { athleteId: 'b', weekStart: '2026-11-01', workoutKey: 'wed' }, // not the quality day
        { athleteId: 'a', weekStart: '2026-11-08', workoutKey: 'tue' },
      ],
    }));
    expect(nov(out).quality).toBe(0.75); // (1/2 + 1/1) / 2; the week with no quality day is skipped
    expect(out.series[0].quality).toBeNull();
  });
});

describe('cohorts', () => {
  it('of those who joined in a month, the share who ran in each month after', () => {
    const out = computeMonthlyExtra(input({
      athletes: [ath('a', { createdAt: '2026-09-02T00:00:00Z' }), ath('b', { createdAt: '2026-09-20T00:00:00Z' }), ath('c', { createdAt: '2026-11-01T00:00:00Z' })],
      runs: [{ athleteId: 'a', date: '2026-09-05', km: 5 }, { athleteId: 'b', date: '2026-09-25', km: 5 }, { athleteId: 'a', date: '2026-11-05', km: 5 }],
    }));
    expect(out.cohorts).toEqual([
      { month: '2026-09', size: 2, ran: [1, 0, 0.5] },
      { month: '2026-11', size: 1, ran: [0] },
    ]);
  });
  it('carries no ids or names', () => {
    const out = computeMonthlyExtra(input({ athletes: [ath('secret-id')], runs: [{ athleteId: 'secret-id', date: '2026-11-02', km: 5 }] }));
    expect(JSON.stringify(out)).not.toContain('secret-id');
  });
});

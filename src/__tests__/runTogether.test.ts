import { describe, it, expect } from 'vitest';
import {
  canSeeRun, canSeeExact, projectPlace, jitterArea, distanceM, homeProximityWarning,
  decideJoin, nextFromWaitlist, createFanout, changeFanout, inSoonWindow, chatExpired,
  matchGroupActivities, sortNear, parseVisibility,
} from '@/lib/runs/together';

const base = { hostId: 'h', squadId: 'g2', joinedIds: ['j'], invitedIds: ['i'] };

describe('visibility', () => {
  it('club runs are seen by any member, never anonymously', () => {
    expect(canSeeRun({ ...base, visibility: 'club' }, { id: 'x', groupId: 'g1' })).toBe(true);
    expect(canSeeRun({ ...base, visibility: 'club' }, null)).toBe(false);
  });
  it('squad runs: that squad, plus host/joined/invited', () => {
    const r = { ...base, visibility: 'squad' as const };
    expect(canSeeRun(r, { id: 'x', groupId: 'g2' })).toBe(true);
    expect(canSeeRun(r, { id: 'x', groupId: 'g1' })).toBe(false);
    expect(canSeeRun(r, { id: 'j', groupId: 'g1' })).toBe(true);
    expect(canSeeRun({ ...r, squadId: null }, { id: 'x', groupId: null })).toBe(false);
  });
  it('private runs: only host, joined, invited', () => {
    const r = { ...base, visibility: 'private' as const };
    expect(canSeeRun(r, { id: 'x', groupId: 'g2' })).toBe(false);
    expect(canSeeRun(r, { id: 'i', groupId: null })).toBe(true);
    expect(canSeeRun(r, { id: 'h', groupId: null })).toBe(true);
  });
  it('legacy audience maps pack → squad', () => {
    expect(parseVisibility(undefined, 'pack')).toBe('squad');
    expect(parseVisibility('private', 'club')).toBe('private');
    expect(parseVisibility('nonsense')).toBe('club');
  });
});

describe('exact-location stripping', () => {
  const place = { location: 'גשר הירקון', lat: 32.0998, lng: 34.8115, areaLabel: 'פארק הירקון', areaLat: 32.101, areaLng: 34.81 };
  it('only host and joined may see exact', () => {
    expect(canSeeExact(base, 'h')).toBe(true);
    expect(canSeeExact(base, 'j')).toBe(true);
    expect(canSeeExact(base, 'i')).toBe(false); // invited but not yet joined
    expect(canSeeExact(base, null)).toBe(false);
  });
  it('a non-joiner projection carries no exact name or coordinates anywhere', () => {
    const p = projectPlace(place, false);
    expect(p.exact).toBeNull();
    const json = JSON.stringify(p);
    expect(json).not.toContain('גשר');
    expect(json).not.toContain('32.0998');
    expect(json).not.toContain('34.8115');
    expect(p.area.label).toBe('פארק הירקון');
  });
  it('a joiner gets the exact point', () => {
    expect(projectPlace(place, true).exact).toEqual({ name: 'גשר הירקון', lat: 32.0998, lng: 34.8115 });
  });
  it('jitter is deterministic, off the pin, and inside the 400 m circle', () => {
    for (const seed of ['a', 'run-1', 'ffff-0000', 'xyz']) {
      const j = jitterArea(32.0998, 34.8115, seed);
      expect(jitterArea(32.0998, 34.8115, seed)).toEqual(j);
      const d = distanceM({ lat: 32.0998, lng: 34.8115 }, j);
      expect(d).toBeGreaterThan(40);
      expect(d).toBeLessThan(400);
    }
  });
});

describe('home proximity warning', () => {
  const home = { lat: 32.08, lng: 34.78 };
  const starts = [home, { lat: 32.0801, lng: 34.7801 }, { lat: 32.0799, lng: 34.78 }, { lat: 32.1, lng: 34.81 }];
  it('warns for a pin near the frequent start', () => {
    expect(homeProximityWarning({ lat: 32.081, lng: 34.781 }, starts)).toBe(true);
  });
  it('is quiet far away, and with too few starts', () => {
    expect(homeProximityWarning({ lat: 32.1, lng: 34.81 }, starts)).toBe(false);
    expect(homeProximityWarning(home, starts.slice(0, 2))).toBe(false);
  });
});

describe('capacity', () => {
  it('instant for club/squad, approval for private', () => {
    expect(decideJoin({ visibility: 'club', capacity: null, acceptedCount: 30 })).toBe('accepted');
    expect(decideJoin({ visibility: 'squad', capacity: 6, acceptedCount: 4 })).toBe('accepted');
    expect(decideJoin({ visibility: 'private', capacity: null, acceptedCount: 0 })).toBe('pending');
  });
  it('host counts toward capacity; full → waitlist', () => {
    expect(decideJoin({ visibility: 'club', capacity: 6, acceptedCount: 5 })).toBe('waitlist');
  });
  it('capacity race: two concurrent joiners on the last place — the recheck after insert sends the later one to the waitlist', () => {
    // Both read acceptedCount 4 (capacity 6) and insert accepted. The route then
    // re-counts by created_at and demotes anyone past capacity; nextFromWaitlist must
    // then report no open place.
    const rows = [
      { athleteId: 'a', status: 'accepted' as const, createdAt: '1' },
      { athleteId: 'b', status: 'accepted' as const, createdAt: '2' },
      { athleteId: 'c', status: 'accepted' as const, createdAt: '3' },
      { athleteId: 'd', status: 'accepted' as const, createdAt: '4' },
      { athleteId: 'e', status: 'accepted' as const, createdAt: '5' },
      { athleteId: 'f', status: 'waitlist' as const, createdAt: '6' },
    ];
    expect(nextFromWaitlist(rows, 6)).toBeNull();
  });
  it('leaving promotes the first waitlister by queue order', () => {
    const rows = [
      { athleteId: 'a', status: 'accepted' as const, createdAt: '1' },
      { athleteId: 'z', status: 'waitlist' as const, createdAt: '9' },
      { athleteId: 'y', status: 'waitlist' as const, createdAt: '5' },
      { athleteId: 'b', status: 'left' as const, createdAt: '2' },
    ];
    expect(nextFromWaitlist(rows, 3)).toBe('y');
    expect(nextFromWaitlist(rows, null)).toBe('y');
  });
});

describe('fan-out', () => {
  const athletes = [
    { id: 'h', groupId: 'g2', paceSec: 305 },
    { id: 'a1', groupId: 'g1', paceSec: 260 }, { id: 'a2', groupId: 'g1', paceSec: 265 },
    { id: 'b1', groupId: 'g2', paceSec: 300 }, { id: 'b2', groupId: 'g2', paceSec: 310 },
    { id: 'c1', groupId: 'g3', paceSec: 360 },
  ];
  it('squad → that squad, minus host', () => {
    expect(createFanout({ visibility: 'squad', squadId: 'g2', hostId: 'h', invitedIds: [], athletes, band: null }).sort()).toEqual(['b1', 'b2']);
  });
  it('club → only pace-matched squads', () => {
    expect(createFanout({ visibility: 'club', squadId: null, hostId: 'h', invitedIds: [], athletes, band: { min: 300, max: 315 } }).sort()).toEqual(['b1', 'b2']);
    expect(createFanout({ visibility: 'club', squadId: null, hostId: 'h', invitedIds: [], athletes, band: { min: 250, max: 320 } }).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });
  it('club without a band → host squad, never everyone', () => {
    expect(createFanout({ visibility: 'club', squadId: null, hostId: 'h', invitedIds: [], athletes, band: null }).sort()).toEqual(['b1', 'b2']);
  });
  it('private → invited only', () => {
    expect(createFanout({ visibility: 'private', squadId: 'g2', hostId: 'h', invitedIds: ['c1', 'h'], athletes, band: null })).toEqual(['c1']);
  });
  it('time change → joined + waitlisted, not the host, not people who left', () => {
    expect(changeFanout({ hostId: 'h', rows: [
      { athleteId: 'a', status: 'accepted' }, { athleteId: 'b', status: 'waitlist' },
      { athleteId: 'c', status: 'left' }, { athleteId: 'd', status: 'pending' }, { athleteId: 'h', status: 'accepted' },
    ] }).sort()).toEqual(['a', 'b']);
  });
});

describe('clock windows', () => {
  it('T−60 window', () => {
    expect(inSoonWindow({ date: '2026-11-21', startTime: '18:30' }, { date: '2026-11-21', minute: 17 * 60 + 30 })).toBe(true);
    expect(inSoonWindow({ date: '2026-11-21', startTime: '18:30' }, { date: '2026-11-21', minute: 16 * 60 })).toBe(false);
    expect(inSoonWindow({ date: '2026-11-22', startTime: '18:30' }, { date: '2026-11-21', minute: 17 * 60 + 30 })).toBe(false);
  });
  it('chat purge 24 h after start', () => {
    expect(chatExpired({ date: '2026-11-20', startTime: '18:30' }, { date: '2026-11-21', minute: 18 * 60 + 29 })).toBe(false);
    expect(chatExpired({ date: '2026-11-20', startTime: '18:30' }, { date: '2026-11-21', minute: 18 * 60 + 30 })).toBe(true);
    expect(chatExpired({ date: '2026-11-30', startTime: '23:30' }, { date: '2026-12-01', minute: 23 * 60 + 30 })).toBe(true);
  });
});

describe('group run linking', () => {
  const m = { date: '2026-11-21', startTime: '18:30', lat: 32.0998, lng: 34.8115, goingIds: ['a', 'b', 'c', 'd'] };
  const near = { startLat: 32.1, startLng: 34.812 };
  it('matches within ±30 min and ~1 km, one per athlete, joiners only', () => {
    const got = matchGroupActivities(m, [
      { id: '1', athleteId: 'a', startTime: '2026-11-21T18:41:00', ...near },
      { id: '2', athleteId: 'a', startTime: '2026-11-21T18:45:00', ...near },
      { id: '3', athleteId: 'b', startTime: '2026-11-21T19:05:00', ...near }, // +35
      { id: '4', athleteId: 'c', startTime: '2026-11-21T18:30:00', startLat: 32.12, startLng: 34.83 }, // far
      { id: '5', athleteId: 'x', startTime: '2026-11-21T18:30:00', ...near }, // not going
      { id: '6', athleteId: 'd', startTime: '2026-11-20T18:30:00', ...near }, // other day
    ]);
    expect(got).toEqual([{ activityId: '1', athleteId: 'a' }]);
  });
});

describe('near me', () => {
  it('sorts by area centre', () => {
    const runs = [{ id: 'far', place: { area: { lat: 32.17, lng: 34.82 } } }, { id: 'none', place: { area: { lat: null, lng: null } } }, { id: 'close', place: { area: { lat: 32.1, lng: 34.81 } } }];
    expect(sortNear(runs, { lat: 32.1, lng: 34.8 }).map((r) => r.id)).toEqual(['close', 'far', 'none']);
  });
});

import { groupRunCard } from '@/lib/runs/together';
describe('group run card', () => {
  const people = new Map([['a', { name: 'נועה', avatarUrl: null }], ['b', { name: 'מיכל', avatarUrl: null }]]);
  const meetup = { id: 'm', date: '2026-11-21', startTime: '18:30', areaLabel: 'פארק הירקון', planLinked: true };
  it('masks a hidden pace and never carries accuracy', () => {
    const c = groupRunCard({ meetup, people, viewerId: 'a', runs: [
      { activityId: '1', athleteId: 'a', distanceM: 12100, durationS: 12100 * 0.306, paceHidden: false },
      { activityId: '2', athleteId: 'b', distanceM: 12000, durationS: 12000 * 0.308, paceHidden: true },
    ] })!;
    expect(c.count).toBe(2);
    expect(c.runners.find((r) => r.athleteId === 'b')!.pace).toBeNull();
    expect(c.runners.find((r) => r.athleteId === 'a')!.pace).toBe('5:06');
    expect(c.runners[c.runners.length - 1].isMe).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/accuracy|score|verdict/i);
  });
  it('one runner is not a group run', () => {
    expect(groupRunCard({ meetup, people, viewerId: null, runs: [{ activityId: '1', athleteId: 'a', distanceM: 1, durationS: 1, paceHidden: false }] })).toBeNull();
  });
});

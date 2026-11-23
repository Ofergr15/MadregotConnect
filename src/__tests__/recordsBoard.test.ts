import { describe, it, expect } from 'vitest';
import {
  weeklyBoard, squadStandings, ageBand, filterRecordTable, clubRecordHistory, monthlyChampions,
  trailingStreak, bestByMonth, squadMedianSeries, median, monthAxis, fourthTab, hidesPace,
  type BoardPerson, type RecordFacts,
} from '@/lib/records/board';

const P = (id: string, groupIndex = 1, extra: Partial<BoardPerson> = {}): BoardPerson => ({ id, name: `n-${id}`, groupId: String(groupIndex), groupIndex, ...extra });
const people = Array.from({ length: 11 }, (_, i) => P(`a${i}`, (i % 3) + 1));
const totals = new Map(people.map((p, i) => [p.id, { meters: (11 - i) * 10000, seconds: (11 - i) * 3000, runs: 3 }]));

describe('weeklyBoard', () => {
  it('top 5 + my own row with rank and a gap to the one above', () => {
    const b = weeklyBoard(people, totals, 'a6', 'km');
    expect(b.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 7]);
    expect(b.me?.isMe).toBe(true);
    expect(b.gap).toEqual({ name: 'n-a5', meters: 10000, seconds: 3000 });
    expect(b.of).toBe(11);
    expect(b.lightWeek).toBe(false);
  });

  it('never sends a rank for the bottom three outside the top 5 (light week)', () => {
    const b = weeklyBoard(people, totals, 'a10', 'km');
    expect(b.me?.rank).toBeNull();
    expect(b.lightWeek).toBe(true);
    expect(b.gap).toBeNull();
    expect(b.rows).toHaveLength(6);
  });

  it('opted-out runner is absent from the board but still sees it', () => {
    const ppl = people.map((p) => (p.id === 'a0' ? { ...p, optOut: true } : p));
    const b = weeklyBoard(ppl, totals, 'a0', 'km');
    expect(b.rows.some((r) => r.athleteId === 'a0')).toBe(false);
    expect(b.optedOut).toBe(true);
    expect(b.me).toBeNull();
    expect(b.rows[0].athleteId).toBe('a1');
  });

  it('hidden pace stays on the km and time boards', () => {
    const ppl = people.map((p) => (p.id === 'a0' ? { ...p, hidesPace: true } : p));
    expect(weeklyBoard(ppl, totals, null, 'km').rows[0].athleteId).toBe('a0');
    expect(weeklyBoard(ppl, totals, null, 'time').rows[0].athleteId).toBe('a0');
  });

  it('ranks by running time when asked', () => {
    const t = new Map(totals);
    t.set('a9', { meters: 1000, seconds: 999999, runs: 1 });
    expect(weeklyBoard(people, t, null, 'time').rows[0].athleteId).toBe('a9');
  });

  it('runners with no run this week are not on it, and nothing plan-ish leaks', () => {
    const t = new Map(totals); t.set('a3', { meters: 0, seconds: 0, runs: 0 });
    const b = weeklyBoard(people, t, 'a3', 'km');
    expect(b.of).toBe(10);
    expect(b.me).toBeNull();
    expect(JSON.stringify(b)).not.toMatch(/verdict|accuracy|score/i);
  });
});

describe('squadStandings', () => {
  it('averages km per active runner, not per squad member', () => {
    const ppl = [P('x', 1), P('y', 1), P('z', 2), P('w', 2)];
    const t = new Map([['x', { meters: 60000, runs: 3 }], ['y', { meters: 0, runs: 0 }], ['z', { meters: 50000, runs: 2 }], ['w', { meters: 40000, runs: 2 }]]);
    expect(squadStandings(ppl, t)).toEqual([
      { groupIndex: 1, avgKm: 60, activeRunners: 1 },
      { groupIndex: 2, avgKm: 45, activeRunners: 2 },
    ]);
  });
});

describe('ageBand', () => {
  it('10-year bands, birthday-aware', () => {
    expect(ageBand('1990-11-22', '2026-11-21')).toBe('35–44'); // 35, birthday tomorrow → 35
    expect(ageBand('1992-11-22', '2026-11-21')).toBe('25–34'); // turns 34 tomorrow
    expect(ageBand('1981-11-21', '2026-11-21')).toBe('45–54');
    expect(ageBand('2005-01-01', '2026-11-21')).toBe('18–24');
  });
  it('no birth date → no band', () => {
    expect(ageBand(null, '2026-11-21')).toBeNull();
    expect(ageBand('garbage', '2026-11-21')).toBeNull();
  });
});

describe('filterRecordTable', () => {
  const entries = [
    { athleteId: 'm1', seconds: 1100, activityId: 'r1', date: '2026-03-01' },
    { athleteId: 'f1', seconds: 1200, activityId: 'r2', date: '2026-04-01' },
    { athleteId: 'f2', seconds: 1300, activityId: 'r3', date: '2026-05-01' },
    { athleteId: 'hp', seconds: 1000, activityId: 'r4', date: '2026-05-01' },
    { athleteId: 'oo', seconds: 1050, activityId: 'r5', date: '2026-05-01' },
  ];
  const facts = new Map<string, RecordFacts>([
    ['m1', { gender: 'male', ageBand: '35–44' }],
    ['f1', { gender: 'female', ageBand: '35–44' }],
    ['f2', { gender: 'female', ageBand: null }],
    ['hp', { gender: 'male', hidesPace: true }],
    ['oo', { gender: 'male', optOut: true }],
  ]);
  const official = (e: { activityId: string | null }) => e.activityId === 'r2';

  it('drops opted-out and pace-hiding runners from every time table', () => {
    const t = filterRecordTable(entries, facts, official, {});
    expect(t.map((r) => r.entry.athleteId)).toEqual(['m1', 'f1', 'f2']);
    expect(t.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
  it('women, races-only, age band — no-birth-date only under all ages', () => {
    expect(filterRecordTable(entries, facts, official, { sex: 'f' }).map((r) => r.entry.athleteId)).toEqual(['f1', 'f2']);
    expect(filterRecordTable(entries, facts, official, { sex: 'f', age: '35–44' }).map((r) => r.entry.athleteId)).toEqual(['f1']);
    expect(filterRecordTable(entries, facts, official, { racesOnly: true }).map((r) => [r.entry.athleteId, r.official])).toEqual([['f1', true]]);
  });
});

describe('clubRecordHistory', () => {
  it('walks every athlete\'s breaks into one club record line, skipping hidden runners', () => {
    const br = new Map([
      ['a', [{ date: '2024-09-01', seconds: 2472, activityId: '1', activityName: null }, { date: '2025-03-01', seconds: 2334, activityId: '2', activityName: null }]],
      ['b', [{ date: '2024-12-01', seconds: 2388, activityId: '3', activityName: null }, { date: '2026-02-01', seconds: 2234, activityId: '4', activityName: null }]],
      ['oo', [{ date: '2025-01-01', seconds: 2000, activityId: '5', activityName: null }]],
    ]);
    const h = clubRecordHistory(br, new Map([['oo', { optOut: true }]]));
    expect(h.map((x) => [x.athleteId, x.seconds, x.improvedBy])).toEqual([
      ['a', 2472, null], ['b', 2388, 84], ['a', 2334, 54], ['b', 2234, 100],
    ]);
  });
});

describe('monthlyChampions', () => {
  const ppl = [P('a'), P('b'), P('c', 1, { hidesPace: true }), P('o', 1, { optOut: true })];
  it('most improved needs a 40 km base; streak; newest longest record; opt-out wins nothing', () => {
    const c = monthlyChampions({
      people: ppl,
      monthKm: new Map([['a', 131], ['b', 30], ['o', 400]]),
      prevMonthKm: new Map([['a', 100], ['b', 10], ['o', 100]]),
      weeksHit: new Map([['b', [false, true, true, true, true]], ['a', [true, false, true]], ['o', [true, true, true, true, true, true]]]),
      monthRecordBreaks: [
        { athleteId: 'c', bucketKey: 'fm', seconds: 10000, date: '2026-11-03' },
        { athleteId: 'a', bucketKey: '5k', seconds: 1000, date: '2026-11-02' },
        { athleteId: 'b', bucketKey: 'hm', seconds: 4960, date: '2026-11-01' },
      ],
    });
    expect(c.mostImproved).toMatchObject({ athleteId: 'a', name: 'n-a', pct: 31 });
    expect(c.streak).toMatchObject({ athleteId: 'b', name: 'n-b', weeks: 4 });
    expect(c.newRecord).toMatchObject({ athleteId: 'b', name: 'n-b', bucketKey: 'hm', seconds: 4960 });
    expect(JSON.stringify(c)).not.toMatch(/"o"/);
  });
  it('trailingStreak counts only the unbroken tail', () => {
    expect(trailingStreak([true, false, true, true])).toBe(2);
    expect(trailingStreak([])).toBe(0);
  });
});

describe('progress helpers', () => {
  const months = monthAxis('2026-11-21', 4);
  it('month axis', () => expect(months).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']));
  it('running best by month and an anonymous median', () => {
    const mine = bestByMonth([{ date: '2026-09-05', seconds: 1400 }, { date: '2026-11-01', seconds: 1308 }], months);
    expect(mine).toEqual([null, 1400, 1400, 1308]);
    expect(squadMedianSeries([[1500, 1450, 1450, 1400], [null, 1300, 1300, 1300], [1600, 1600, 1500, 1500]], months)).toEqual([1550, 1450, 1450, 1400]);
    expect(median([])).toBeNull();
  });
});

describe('fourthTab', () => {
  it('flag on → records; off → valencia through race day, then nothing', () => {
    expect(fourthTab(true, '2026-11-21')).toBe('records');
    expect(fourthTab(false, '2026-12-08')).toBe('valencia');
    expect(fourthTab(false, '2026-12-09')).toBe('none');
  });
  it('hidesPace reads default_hidden_fields', () => {
    expect(hidesPace(['calories', 'pace'])).toBe(true);
    expect(hidesPace(null)).toBe(false);
  });
});

import { newClubRecords, maskClubRecordPayload, clubRecordBody } from '@/lib/records/club-record-card';

describe('club record card', () => {
  const e = (athleteId: string, seconds: number) => ({ athleteId, name: `n-${athleteId}`, seconds, activityId: `r-${athleteId}`, date: '2026-11-13' });
  it('announces only a visible #1 that got faster, naming the visible previous holder', () => {
    const before = [{ key: 'hm', entries: [e('dan', 4995), e('hp', 4900)] }];
    const after = [{ key: 'hm', entries: [e('dan', 4995), e('roni', 4960), e('hp', 4900)] }];
    const facts = new Map([['hp', { hidesPace: true }]]);
    const [c] = newClubRecords(before, after, facts);
    expect(c).toMatchObject({ bucketKey: 'hm', athleteId: 'roni', seconds: 4960, previous: { name: 'n-dan', seconds: 4995 } });
    expect(newClubRecords(null, after, facts)).toEqual([]);
    expect(newClubRecords(after, after, facts)).toEqual([]);
  });
  it('hidden pace on the card drops both times; the body never carries one', () => {
    const p = { kind: 'club_record', bucketKey: '5k', athleteId: 'a', name: 'x', seconds: 1300, activityId: null, date: null, previous: { name: 'y', seconds: 1310, date: null }, hiddenFields: ['pace'] };
    const m = maskClubRecordPayload(p);
    expect(m.seconds).toBeNull();
    expect(m.previous?.seconds).toBeNull();
    expect(maskClubRecordPayload({ ...p, hiddenFields: [] }).seconds).toBe(1300);
    expect(clubRecordBody(p)).not.toMatch(/\d:\d/);
  });
});

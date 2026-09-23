import { describe, expect, it } from 'vitest';
import {
  fastestKm, slots, chartRun, sessionLabel, initialState, runsFor, unassigned,
  type PackRun, type PackSession,
} from '@/lib/pack-stories/model';
import { buildSession, normaliseRoute, type ActivityRow } from '@/lib/pack-stories/build';

const run = (o: Partial<PackRun> & { id: string }): PackRun => ({
  name: o.id, pack: 1, src: 'rsvp', dup: false, start: '06:00',
  dist: 10000, dur: 3000, pace: 300, hr: null, laps: [], route: null, ...o,
});
const session = (runs: PackRun[]): PackSession => ({ date: '2026-09-22', label: sessionLabel('2026-09-22'), runs });

describe('fastestKm', () => {
  it('re-bins watch laps into whole kilometres', () => {
    // Three 1 km laps at 5:00, 4:00, 5:00 — the fastest km is the middle lap.
    expect(fastestKm([[1000, 300], [1000, 240], [1000, 300]])).toBeCloseTo(240);
  });

  it('finds a fast km that straddles two laps', () => {
    // km 1 = 400 m of the slow lap + 600 m of the fast one.
    expect(fastestKm([[1400, 420], [600, 120]])).toBeCloseTo(400 * 0.3 + 120);
  });

  it('is null without laps or under a kilometre', () => {
    expect(fastestKm([])).toBeNull();
    expect(fastestKm([[800, 240]])).toBeNull();
  });
});

describe('slots', () => {
  const a = run({ id: 'a', dist: 12000, laps: [[1000, 250], [1000, 260]] });
  const b = run({ id: 'b', dist: 10000, laps: [[1000, 265], [1000, 270]] });

  it('gives the second record to the next in line when one runner wins both', () => {
    const S = initialState();
    S.packs[1].metrics.chart = ['fastKm', 'longest'];
    const [first, second] = slots(S, session([a, b]), 1);
    expect(first.run?.id).toBe('a');
    expect(second.run?.id).toBe('b');
  });

  it('lets the same runner win both when next-in-line is off', () => {
    const S = initialState();
    S.nextInLine = false;
    S.packs[1].metrics.chart = ['fastKm', 'longest'];
    expect(slots(S, session([a, b]), 1).map(s => s.run?.id)).toEqual(['a', 'a']);
  });

  it('a hand-picked runner wins over next-in-line, and a typed value over the data', () => {
    const S = initialState();
    S.packs[1].metrics.chart = ['fastKm', 'longest'];
    S.packs[1].edits.longest = { runId: 'a', value: '13.00' };
    const second = slots(S, session([a, b]), 1)[1];
    expect(second.run?.id).toBe('a');
    expect(second.value).toBe('13.00');
    expect(second.auto).toBe('12.00');
    expect(second.edited).toBe(true);
  });
});

describe('pack pace', () => {
  it('is all the time over all the distance, so a long run weighs more', () => {
    const S = initialState();
    const sess = session([run({ id: 'a', dist: 10000, dur: 3000 }), run({ id: 'b', dist: 5000, dur: 1800 })]);
    // (3000 + 1800) s over 15 km = 320 s/km; a plain average of 5:00 and 6:00 would say 5:30.
    expect(slots(S, sess, 1)[0].value).toBe('5:20');
  });
});

describe('selection', () => {
  it('starts with the pack pace alone on the graph story', () => {
    expect(initialState().packs[1].metrics.chart).toEqual(['avgPace']);
  });

  it('keeps afternoon/evening runs and duplicates out of the pack', () => {
    const S = initialState();
    const sess = session([
      run({ id: 'in' }),
      run({ id: 'late', start: '18:30' }),
      run({ id: 'noon', start: '12:00' }),
      run({ id: 'late-morning', start: '11:59' }),
      run({ id: 'twin', dup: true }),
      run({ id: 'lost', pack: 0, src: 'none' }),
    ]);
    expect(runsFor(S, sess, 1).map(r => r.id)).toEqual(['in', 'late-morning']);
    expect(unassigned(S, sess).map(r => r.id)).toEqual(['lost']);
    S.assign.lost = 2;
    expect(runsFor(S, sess, 2).map(r => r.id)).toEqual(['lost']);
  });

  it('features the run with the most laps, unless one was picked', () => {
    const S = initialState();
    const sess = session([run({ id: 'few', laps: [[1000, 300]] }), run({ id: 'many', laps: [[1000, 300], [1000, 290], [1000, 280]] })]);
    expect(chartRun(S, sess, 1)?.id).toBe('many');
    S.packs[1].chartRun = 'few';
    expect(chartRun(S, sess, 1)?.id).toBe('few');
    // The summary layout needs a route; nobody here has one.
    S.layout = 'summary';
    expect(chartRun(S, sess, 1)).toBeNull();
  });
});

describe('sessionLabel', () => {
  it('names the weekday and the date without a timezone', () => {
    expect(sessionLabel('2026-09-22')).toBe('אימון שלישי · 22.9');
    expect(sessionLabel('2026-09-18')).toBe('אימון שישי · 18.9');
  });
});

describe('buildSession', () => {
  const act = (o: Partial<ActivityRow> & { id: string; athlete_id: string }): ActivityRow => ({
    start_time: '2026-09-22T06:05:00+00:00', distance: 10000, duration: 3000,
    average_pace: 300, average_hr: null, laps: null, gps_points: null, ...o,
  });
  const athletes = [
    { id: 'x', name: 'Dana', group_id: 'g2' },
    { id: 'y', name: 'Yoni', group_id: 'g3' },
    { id: 'z', name: 'Noa', group_id: null },
  ];
  const groups = [{ id: 'g2', name: 'Group 2' }, { id: 'g3', name: 'Group 3' }];

  it('takes the pack from the RSVP first, then the home group', () => {
    const s = buildSession('2026-09-22',
      [act({ id: '1', athlete_id: 'x' }), act({ id: '2', athlete_id: 'y', distance: 8000 }), act({ id: '3', athlete_id: 'z', distance: 6000 })],
      [{ athlete_id: 'x', group_label: 'דבוקה 1' }], athletes, groups);
    const by = Object.fromEntries(s.runs.map(r => [r.id, r]));
    expect([by['1'].pack, by['1'].src]).toEqual([1, 'rsvp']);
    expect([by['2'].pack, by['2'].src]).toEqual([3, 'home']);
    expect([by['3'].pack, by['3'].src]).toEqual([0, 'none']);
    expect(by['1'].start).toBe('06:05');
    expect(s.label).toBe('אימון שלישי · 22.9');
  });

  it('drops stubs under a kilometre', () => {
    const s = buildSession('2026-09-22', [act({ id: '1', athlete_id: 'x', distance: 400 })], [], athletes, groups);
    expect(s.runs).toEqual([]);
  });

  it('marks the pack-less twin of a run synced onto two profiles', () => {
    const s = buildSession('2026-09-22',
      [act({ id: '1', athlete_id: 'z' }), act({ id: '2', athlete_id: 'x' })], [], athletes, groups);
    const by = Object.fromEntries(s.runs.map(r => [r.id, r]));
    expect(by['1'].dup).toBe(true);
    expect(by['2'].dup).toBe(false);
  });
});

describe('normaliseRoute', () => {
  it('fits the trace to 0..1 on its longer side, north up', () => {
    const r = normaliseRoute([{ lat: 32.1, lng: 34.8 }, { lat: 32.11, lng: 34.8 }])!;
    expect(r).toHaveLength(2);
    // Going north moves UP the canvas.
    expect(r[0][1]).toBe(1);
    expect(r[1][1]).toBe(0);
  });

  it('is null without a usable trace', () => {
    expect(normaliseRoute(null)).toBeNull();
    expect(normaliseRoute([{ lat: 32, lng: 34 }])).toBeNull();
    expect(normaliseRoute([{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }])).toBeNull();
  });
});

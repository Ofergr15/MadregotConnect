import { describe, expect, it } from 'vitest';
import type { ParsedWorkout } from '@/lib/ai/types';
import {
  attentionRank, clubKmToDate, clubTotals, compareAttention, easyTooFast, isNewMember, isRepeatPain,
  missedStreak, normalizeAvailability, painSpot, populationsOf, qualityTooSlow, sessionKind, setByForCaller,
  stripCell, type AttentionInput, type GradedPaceSession,
} from '@/lib/coach/attention';

const TODAY = '2026-11-19'; // Thursday

describe('stripCell', () => {
  const p = (completed: boolean, score = 1) => ({ completed, score });
  it('done / partial on the 0.67 line', () => {
    expect(stripCell({ date: '2026-11-17', today: TODAY, planned: p(true, 0.67), ran: true })).toBe('done');
    expect(stripCell({ date: '2026-11-17', today: TODAY, planned: p(true, 0.66), ran: true })).toBe('partial');
  });
  it('missed only for a closed day; today stays open', () => {
    expect(stripCell({ date: '2026-11-18', today: TODAY, planned: p(false, 0), ran: false })).toBe('missed');
    expect(stripCell({ date: TODAY, today: TODAY, planned: p(false, 0), ran: false })).toBe('today');
    expect(stripCell({ date: TODAY, today: TODAY, planned: p(true, 1), ran: true })).toBe('done');
  });
  it('rest, extra, future', () => {
    expect(stripCell({ date: '2026-11-16', today: TODAY, planned: null, ran: false })).toBe('rest');
    expect(stripCell({ date: '2026-11-16', today: TODAY, planned: null, ran: true })).toBe('extra');
    expect(stripCell({ date: '2026-11-20', today: TODAY, planned: p(false, 0), ran: false })).toBe('future');
    expect(stripCell({ date: '2026-11-21', today: TODAY, planned: null, ran: false })).toBe('rest');
  });
  it('a new member is never missed before joining', () => {
    expect(stripCell({ date: '2026-11-16', today: TODAY, planned: p(false, 0), ran: false, joined: '2026-11-18' })).toBe('rest');
  });
});

describe('missedStreak (threshold 2, planned sessions only)', () => {
  const s = (date: string, completed: boolean, optional = false) => ({ date, completed, optional });
  it('counts back from the newest closed session and stops at a done one', () => {
    expect(missedStreak([s('2026-11-15', true), s('2026-11-17', false), s('2026-11-18', false)], TODAY)).toBe(2);
  });
  it("doesn't count today until the day closes, but a run today ends it", () => {
    expect(missedStreak([s('2026-11-17', false), s('2026-11-18', true), s(TODAY, false)], TODAY)).toBe(0);
    expect(missedStreak([s('2026-11-17', false), s('2026-11-18', false), s(TODAY, false)], TODAY)).toBe(2);
    expect(missedStreak([s('2026-11-17', false), s('2026-11-18', false), s(TODAY, true)], TODAY)).toBe(0);
  });
  it('rest days (absent) neither break nor extend; optional sessions are skipped', () => {
    // Sun missed, Mon rest (absent), Tue missed, Wed optional not run
    expect(missedStreak([s('2026-11-15', false), s('2026-11-17', false), s('2026-11-18', false, true)], TODAY)).toBe(2);
  });
  it('stops at the join date and ignores the future', () => {
    expect(missedStreak([s('2026-11-12', false), s('2026-11-15', false), s('2026-11-17', false)], TODAY, '2026-11-14')).toBe(2);
    expect(missedStreak([s('2026-11-20', false)], TODAY)).toBe(0);
  });
});

describe('pace rules', () => {
  const g = (status: GradedPaceSession['status'], pace = 300, date = '2026-11-10'): GradedPaceSession =>
    ({ status, pace, bandMin: 330, bandMax: 360, date });
  it('easy too fast needs ≥3 AND ≥60% of graded easy days', () => {
    expect(easyTooFast([g('faster'), g('faster'), g('on_target')])).toBeNull(); // 2
    expect(easyTooFast([g('faster'), g('faster'), g('faster'), g('on_target'), g('on_target')])).toMatchObject({ n: 3, of: 5 });
    expect(easyTooFast([g('faster'), g('faster'), g('faster'), g('on_target'), g('on_target'), g('on_target')])).toBeNull(); // 50%
  });
  it('unknown (ungraded) days are out of the denominator', () => {
    expect(easyTooFast([g('faster'), g('faster'), g('faster'), g('unknown'), g('unknown'), g('on_target')])).toMatchObject({ n: 3, of: 4 });
  });
  it('reports the asked band and the ran average', () => {
    const f = easyTooFast([g('faster', 300), g('faster', 310), g('faster', 290)])!;
    expect(f).toMatchObject({ askedMin: 330, askedMax: 360, ran: 300 });
  });
  it('quality too slow needs ≥2 AND ≥50% of block-graded sessions', () => {
    expect(qualityTooSlow([g('slower'), g('on_target')])).toBeNull();
    expect(qualityTooSlow([g('slower'), g('slower'), g('on_target'), g('on_target')])).toMatchObject({ n: 2, of: 4 });
    expect(qualityTooSlow([g('slower'), g('slower'), g('on_target'), g('on_target'), g('on_target')])).toBeNull();
  });
  it('a quality session with no block verdict (unknown) can never be flagged', () => {
    expect(qualityTooSlow([g('unknown'), g('unknown'), g('unknown')])).toBeNull();
    expect(qualityTooSlow([g('slower'), g('unknown'), g('unknown')])).toBeNull();
  });
});

describe('sessionKind', () => {
  const w = (steps: any[]): ParsedWorkout => ({ dayOfWeek: 0, name: 'x', steps } as unknown as ParsedWorkout);
  it('interval / hard zone = quality', () => {
    expect(sessionKind(w([{ type: 'warmup' }, { type: 'repeat', repeatCount: 6, repeatSteps: [{ type: 'interval', targetPaceMinPerKm: 200 }] }]))).toBe('quality');
    expect(sessionKind(w([{ type: 'active', targetZone: 'tempo', targetPaceMinPerKm: 220 }]))).toBe('quality');
  });
  it('a paced active / easy step = easy; unpaced = other', () => {
    expect(sessionKind(w([{ type: 'active', targetZone: 'easy', targetPaceMinPerKm: 300 }]))).toBe('easy');
    expect(sessionKind(w([{ type: 'active' }]))).toBe('other');
  });
});

describe('pain', () => {
  it('names the spot for a row title', () => {
    expect(painSpot('כאב בשוק הימנית מהק״מ ה־6')).toBe('שוק ימין');
    expect(painSpot('הברך השמאלית התחילה לכאוב')).toBe('ברך שמאל');
    expect(painSpot('לא מרגיש טוב')).toBeNull();
  });
  it('same spot within 21 days is a repeat; side matters when both say it', () => {
    expect(isRepeatPain([
      { createdAt: '2026-11-18T08:00:00Z', detail: 'כאב בשוק הימנית' },
      { createdAt: '2026-11-04T08:00:00Z', detail: 'שוק ימין' },
    ])).toBe(true);
    expect(isRepeatPain([
      { createdAt: '2026-11-18T08:00:00Z', detail: 'שוק ימין' },
      { createdAt: '2026-11-04T08:00:00Z', detail: 'שוק שמאל' },
    ])).toBe(false);
    expect(isRepeatPain([
      { createdAt: '2026-11-18T08:00:00Z', detail: 'ברך' },
      { createdAt: '2026-11-04T08:00:00Z', detail: 'קרסול' },
    ])).toBe(false);
    expect(isRepeatPain([
      { createdAt: '2026-11-18T08:00:00Z', detail: 'שוק' },
      { createdAt: '2026-10-20T08:00:00Z', detail: 'שוק' },
    ])).toBe(false);
    expect(isRepeatPain([{ createdAt: '2026-11-18T08:00:00Z', detail: 'שוק' }])).toBe(false);
  });
});

describe('ordering', () => {
  const base: AttentionInput = { name: 'א', pain: null, missedRun: 0, offBand: null, slowBand: null, isNew: false, planKm: 20, toDateTarget: 20 };
  const flag = { n: 3, of: 4, askedMin: 1, askedMax: 2, ran: 1 };
  it('pain (repeat first) > missed ≥2 > off band > new', () => {
    expect(attentionRank({ ...base, pain: { repeat: true } })).toBe(5);
    expect(attentionRank({ ...base, pain: { repeat: false } })).toBe(4);
    expect(attentionRank({ ...base, missedRun: 2 })).toBe(3);
    expect(attentionRank({ ...base, missedRun: 1 })).toBe(0);
    expect(attentionRank({ ...base, slowBand: flag })).toBe(2);
    expect(attentionRank({ ...base, isNew: true })).toBe(1);
  });
  it('ties break on furthest behind target', () => {
    const a = { ...base, name: 'א', planKm: 10 };
    const b = { ...base, name: 'ב', planKm: 18 };
    expect([b, a].sort(compareAttention).map((r) => r.name)).toEqual(['א', 'ב']);
  });
});

describe('club totals', () => {
  it('injured / paused are out of execution and ran-today', () => {
    const t = clubTotals([
      { availability: 'active', weekDone: 3, weekOf: 4, weekScore: 0.8, plannedToday: true, ranToday: true, populations: ['all', 'squad1'] },
      { availability: 'active', weekDone: 2, weekOf: 4, weekScore: 0.4, plannedToday: true, ranToday: false, populations: ['all', 'squad1'] },
      { availability: 'injured', weekDone: 0, weekOf: 4, weekScore: 0, plannedToday: true, ranToday: false, populations: ['all', 'out'] },
    ]);
    expect(t).toMatchObject({ execPct: 60, execDone: 5, execOf: 8, ranToday: 1, plannedToday: 2, activeRunners: 2, outRunners: 1 });
    expect(t.byPopulation.squad1).toEqual({ ran: 1, planned: 2 });
    expect(t.byPopulation.out).toBeUndefined();
  });
  it('club km compares with the same point last week, not the full week', () => {
    const r = clubKmToDate([
      { day: '2026-11-16', meters: 10000 }, { day: '2026-11-19', meters: 5000 },
      { day: '2026-11-09', meters: 8000 }, { day: '2026-11-12', meters: 2000 }, { day: '2026-11-14', meters: 30000 },
    ], '2026-11-16', TODAY);
    expect(r).toEqual({ km: 15, kmPrevSamePoint: 10 });
  });
});

describe('misc', () => {
  it('availability defaults to active (pre-migration); set-by comes from the caller', () => {
    expect(normalizeAvailability(undefined)).toBe('active');
    expect(normalizeAvailability('bogus')).toBe('active');
    expect(normalizeAvailability('paused')).toBe('paused');
    expect(setByForCaller('a1', 'a1')).toBe('self');
    expect(setByForCaller('c1', 'a1')).toBe('coach');
    expect(setByForCaller(null, 'a1')).toBe('coach');
  });
  it('new = joined in the last 30 days', () => {
    expect(isNewMember('2026-10-21T10:00:00Z', TODAY)).toBe(true);
    expect(isNewMember('2026-10-19T10:00:00Z', TODAY)).toBe(false);
    expect(isNewMember(null, TODAY)).toBe(false);
  });
  it('populations: out runners leave their squad section', () => {
    expect(populationsOf({ squad: 1, academy: false, isNew: true, availability: 'active', listIds: ['v'] })).toEqual(['all', 'squad1', 'new', 'list:v']);
    expect(populationsOf({ squad: 1, academy: false, isNew: false, availability: 'injured', listIds: [] })).toEqual(['all', 'out']);
  });
});

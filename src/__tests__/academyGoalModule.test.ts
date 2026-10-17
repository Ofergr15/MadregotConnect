import { describe, expect, it } from 'vitest';
import {
  blockLine, blockWeeksFor, distanceLabel, estimateFinish, goalProgress, kindForDistance, parseGoalBody, pickRaceRun, readGoal,
} from '@/lib/academy/goal';
import { academyGoalSetCopy } from '@/lib/notifications/copy';
import { parseEventDistance } from '@/lib/academy/goal-server';

// The goal module (mockup academy-existing-add/goal-module.html, migration 148).

describe('a race is filed by its distance', () => {
  it('knows the four standard distances, with the tolerance a GPS course has', () => {
    expect(kindForDistance(42.195)).toBe('full');
    expect(kindForDistance(42.4)).toBe('full');
    expect(kindForDistance(21.1)).toBe('half');
    expect(kindForDistance(10)).toBe('10k');
    expect(kindForDistance(5)).toBe('5k');
  });
  it('calls anything else "other" — an ultra, a 15 km, a trail race', () => {
    for (const d of [15, 30, 50, 100, 7.5]) expect(kindForDistance(d)).toBe('other');
  });
  it('quotes a marathon as 42.2 and a half as 21.1', () => {
    expect(distanceLabel(42.195)).toBe('42.2');
    expect(distanceLabel(21.0975)).toBe('21.1');
    expect(distanceLabel(10)).toBe('10');
  });
});

describe('the target-time estimate from the 30-minute test', () => {
  // 4:15/km threshold = 7.06 km in the test.
  const T = 255;
  it('orders ambitious < realistic < conservative', () => {
    const e = estimateFinish(T, 42.195)!;
    expect(e.ambitious).toBeLessThan(e.realistic);
    expect(e.realistic).toBeLessThan(e.conservative);
  });
  it('puts a 4:15 threshold at about 3:20 for a marathon and about 1:35 for a half (Riegel)', () => {
    expect(estimateFinish(T, 42.195)!.realistic).toBeGreaterThan(3 * 3600 + 15 * 60);
    expect(estimateFinish(T, 42.195)!.realistic).toBeLessThan(3 * 3600 + 25 * 60);
    const half = estimateFinish(T, 21.0975)!.realistic;
    expect(half).toBeGreaterThan(3600 + 30 * 60);
    expect(half).toBeLessThan(3600 + 40 * 60);
  });
  it('rounds to the minute over an hour and to ten seconds under', () => {
    expect(estimateFinish(T, 42.195)!.realistic % 60).toBe(0);
    expect(estimateFinish(T, 5)!.realistic % 10).toBe(0);
  });
  it('declines what the model cannot carry: an ultra, a sprint, a nonsense pace, no test', () => {
    expect(estimateFinish(T, 100)).toBeNull();
    expect(estimateFinish(T, 1.5)).toBeNull();
    expect(estimateFinish(60, 10)).toBeNull();
    expect(estimateFinish(null, 10)).toBeNull();
  });
});

describe('where today is in the block', () => {
  it('Valencia from 16.10: 51 days, week 10 of 17 — the club banner agrees', () => {
    expect(goalProgress('2026-12-06', '2026-10-16', 42.195)).toEqual({ days: 51, week: 10, totalWeeks: 17, weeksToBlock: 0 });
  });
  it('a race a year away has not started its block yet, and says how long until it does', () => {
    const p = goalProgress('2027-09-26', '2026-10-17', 42.195);
    expect(p.week).toBe(0);
    expect(p.weeksToBlock).toBeGreaterThan(25);
  });
  it('a race that has passed has no days left', () => {
    expect(goalProgress('2026-10-01', '2026-10-17', 10).days).toBeNull();
  });
  it('shorter races have shorter blocks', () => {
    expect(blockWeeksFor(42.195)).toBe(17);
    expect(blockWeeksFor(21.0975)).toBe(12);
    expect(blockWeeksFor(10)).toBe(10);
    expect(blockWeeksFor(5)).toBe(8);
  });
});

describe('reading and posting the race fields', () => {
  it("reads migration 148's columns, and rejects what is not one", () => {
    const g = readGoal({ goal_type: 'other', target_race: 'אולטרה הגליל', target_race_date: '2027-03-01', distance_km: '50', location: 'הגליל', date_is_estimate: true, event_id: 'not-a-uuid' });
    expect(g.goalType).toBe('other');
    expect(g.distanceKm).toBe(50);
    expect(g.dateIsEstimate).toBe(true);
    expect(g.eventId).toBeNull();
  });
  it('a 144-only row still reads, with the new fields empty', () => {
    const g = readGoal({ goal_type: 'full', target_race: 'ולנסיה', target_race_date: '2026-12-06', goal_time_sec: 11520 });
    expect(g.goalType).toBe('full');
    expect(g.distanceKm).toBeNull();
    expect(g.dateIsEstimate).toBe(false);
  });
  it('names a bad distance instead of dropping it', () => {
    expect(parseGoalBody({ distanceKm: -3 }).issues).toContain('distanceKm');
    expect(parseGoalBody({ distanceKm: 21.0975 }).issues).toEqual([]);
  });
  it("reads the calendar's free-text distances, and runs a quoted 42.2 as 42.195", () => {
    expect(parseEventDistance('42.2km')).toBe(42.195);
    expect(parseEventDistance('21.1km')).toBe(21.0975);
    expect(parseEventDistance('10 ק״מ')).toBe(10);
    expect(parseEventDistance('')).toBeNull();
  });
});

describe('after the race (G5)', () => {
  const run = (id: string, start: string, km: number, sec: number) => ({ id, start_time: start, distance: km * 1000, duration: sec });
  it('finds the race among race-day runs: the closest distance, not the warm-up', () => {
    const acts = [run('wu', '2026-12-06T07:10:00', 2.1, 720), run('race', '2026-12-06T08:30:00', 42.4, 11381), run('next', '2026-12-07T08:00:00', 5, 1800)];
    expect(pickRaceRun(acts, '2026-12-06', 42.195)).toEqual({ activityId: 'race', km: 42.4, sec: 11381 });
  });
  it('takes a watch that read 15% short or 20% long, and nothing further', () => {
    expect(pickRaceRun([run('a', '2026-12-06T08:00:00', 36.5, 10000)], '2026-12-06', 42.195)?.activityId).toBe('a');
    expect(pickRaceRun([run('b', '2026-12-06T08:00:00', 30, 9000)], '2026-12-06', 42.195)).toBeNull();
  });
  it('no distance, no guess', () => {
    expect(pickRaceRun([run('a', '2026-12-06T08:00:00', 42.2, 11000)], '2026-12-06', null)).toBeNull();
  });
});

describe("the coach's message when a trainee sets a goal", () => {
  it('says where the goal lands in a block', () => {
    expect(blockLine(goalProgress('2026-12-06', '2026-10-17', 42.195), 'he')).toBe('באמצע בלוק (שבוע 10 מתוך 17)');
    expect(blockLine(goalProgress('2027-09-26', '2026-10-17', 42.195), 'he')).toMatch(/^קודם בסיס · הבלוק בעוד \d+ שבועות$/);
  });
  it('names the trainee and the race in the title', () => {
    const c = academyGoalSetCopy('he', { name: 'מיכל רז', race: 'מרתון ברלין', detail: '42.2 · 26.9 · יעד 3:15:00', block: 'קודם בסיס' });
    expect(c.title).toBe('🎯 מיכל רז קבע/ה מטרה: מרתון ברלין');
    expect(c.body).toBe('42.2 · 26.9 · יעד 3:15:00 · קודם בסיס');
  });
});

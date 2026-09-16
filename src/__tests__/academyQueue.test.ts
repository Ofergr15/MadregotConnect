import { describe, it, expect } from 'vitest';
import { buildQueue, paceDeviationSec } from '@/lib/academy/queue';
import type { AcademyWeekReport, WorkoutAdherenceRow } from '@/lib/academy/report';
import { DEFAULT_TOLERANCES } from '@/lib/academy/adherence';

// What is under test here is an ORDER, which is the whole product of the queue
// screen: the mentor's evening is spent top-down, so a row in the wrong place is
// not a cosmetic bug, it is a trainee who does not get a message this week.
//
// Each test is one of the ordering rules stated in queue.ts, written so that if
// someone later "simplifies" the urgency bands into a single score, the test says
// which promise broke rather than just going red.

function workout(over: Partial<WorkoutAdherenceRow> & { date: string }): WorkoutAdherenceRow {
  return {
    // `date` comes from the spread below — it is required in the override type, so
    // naming it here too was a value TS could see was about to be overwritten.
    name: over.name ?? 'אימון',
    completed: over.completed ?? true,
    planned: {} as any,
    actual: over.actual ?? ({ id: `act-${over.date}` } as any),
    distance: { status: 'on_target', plannedMin: 10000, plannedMax: 10000, actual: 10000, pct: 0 },
    duration: { status: 'on_target', planned: 3000, actual: 3000, pct: 0, estimated: false },
    pace: { status: 'on_target', plannedMin: 300, plannedMax: 300, comparedMin: 300, comparedMax: 300, actual: 300 },
    score: 1,
    ...over,
  };
}

/** A run at `actual` s/km against a 4:55–5:05 band. */
function paced(date: string, actual: number | null, over: Partial<WorkoutAdherenceRow> = {}) {
  return workout({
    date,
    pace: { status: 'on_target', plannedMin: 295, plannedMax: 305, comparedMin: 295, comparedMax: 305, actual },
    ...over,
  });
}

function report(athletes: { athleteId: string; name: string; workouts: WorkoutAdherenceRow[] }[]): AcademyWeekReport {
  return {
    weekStart: '2026-09-13',
    weekEnd: '2026-09-19',
    tolerances: DEFAULT_TOLERANCES,
    athletes: athletes.map(a => ({
      athleteId: a.athleteId,
      name: a.name,
      week: {
        plannedCount: a.workouts.length,
        completedCount: a.workouts.filter(w => w.completed).length,
        completionRate: 0,
        avgScore: 0,
        workouts: a.workouts,
      },
    })),
  };
}

describe('paceDeviationSec', () => {
  it('signs the deviation the way the feedback table does: negative ran faster', () => {
    expect(paceDeviationSec(paced('2026-09-14', 283))).toBe(-12);
    expect(paceDeviationSec(paced('2026-09-14', 317))).toBe(12);
  });

  it('is 0 inside the band, and null when there is nothing to compare', () => {
    expect(paceDeviationSec(paced('2026-09-14', 300))).toBe(0);
    expect(paceDeviationSec(paced('2026-09-14', null))).toBeNull();
  });

  it('measures against the band the status was judged on, not the work band', () => {
    // A session with a warmup: the work band is 4:00–4:10, the whole-session band
    // it is actually graded against is 4:50–5:10. Measuring off the work band would
    // report this perfectly-run session as 55 seconds slow.
    const w = workout({
      date: '2026-09-14',
      pace: { status: 'on_target', plannedMin: 240, plannedMax: 250, comparedMin: 290, comparedMax: 310, actual: 305 },
    });
    expect(paceDeviationSec(w)).toBe(0);
  });
});

describe('buildQueue ordering', () => {
  it('puts a missed session above any deviation, however large', () => {
    const q = buildQueue(report([
      { athleteId: 'a', name: 'Alon', workouts: [paced('2026-09-14', 360)] },      // 55 s/km slow
      { athleteId: 'b', name: 'Bar', workouts: [workout({ date: '2026-09-14', completed: false, actual: null })] },
    ]), new Set());
    expect(q.rows.map(r => r.athleteId)).toEqual(['b', 'a']);
    expect(q.rows[0].reason).toBe('missed');
    expect(q.rows[1].reason).toBe('off_target');
  });

  it('drops a reviewed week below every unreviewed one', () => {
    const q = buildQueue(report([
      // Reviewed, and it was the worst week of the two by a wide margin.
      { athleteId: 'a', name: 'Alon', workouts: [paced('2026-09-14', 400)] },
      // Unreviewed and entirely on target — nothing to say, but nobody has said it.
      { athleteId: 'b', name: 'Bar', workouts: [paced('2026-09-14', 300)] },
    ]), new Set(['a|2026-09-14']));
    expect(q.rows.map(r => r.athleteId)).toEqual(['b', 'a']);
    expect(q.rows[1].reason).toBe('reviewed');
  });

  it('orders two off-target weeks by magnitude, either direction', () => {
    const q = buildQueue(report([
      { athleteId: 'slow', name: 'A', workouts: [paced('2026-09-14', 313)] },  // +8
      { athleteId: 'fast', name: 'B', workouts: [paced('2026-09-14', 275)] },  // −20
    ]), new Set());
    // Running 20 s/km too fast is as much a coaching event as running slow — an easy
    // run done hard is the most common way an academy week goes wrong.
    expect(q.rows.map(r => r.athleteId)).toEqual(['fast', 'slow']);
  });

  it('orders by how many sessions were missed before it looks at the numbers', () => {
    const missed = (date: string) => workout({ date, completed: false, actual: null });
    const q = buildQueue(report([
      { athleteId: 'one', name: 'A', workouts: [missed('2026-09-14'), paced('2026-09-16', 340)] },
      { athleteId: 'two', name: 'B', workouts: [missed('2026-09-14'), missed('2026-09-16')] },
    ]), new Set());
    expect(q.rows.map(r => r.athleteId)).toEqual(['two', 'one']);
  });

  it('breaks a tie by name so the order does not shuffle between refreshes', () => {
    const q = buildQueue(report([
      { athleteId: 'z', name: 'Yuval', workouts: [paced('2026-09-14', 300)] },
      { athleteId: 'a', name: 'Amit', workouts: [paced('2026-09-14', 300)] },
    ]), new Set());
    expect(q.rows.map(r => r.name)).toEqual(['Amit', 'Yuval']);
  });
});

describe('buildQueue headline', () => {
  it('names the FIRST missed session, because consecutive misses are one story', () => {
    const missed = (date: string) => workout({ date, completed: false, actual: null, name: `ריצה ${date}` });
    const q = buildQueue(report([
      { athleteId: 'a', name: 'A', workouts: [missed('2026-09-17'), missed('2026-09-15')] },
    ]), new Set());
    expect(q.rows[0].headline?.date).toBe('2026-09-15');
  });

  it('names the worst session when the row is here for a deviation', () => {
    const q = buildQueue(report([
      { athleteId: 'a', name: 'A', workouts: [paced('2026-09-14', 308), paced('2026-09-16', 330)] },
    ]), new Set());
    expect(q.rows[0].headline?.date).toBe('2026-09-16');
  });

  it('never headlines a session that has already been reviewed', () => {
    // The 25-second run is done and answered; the row is still here for the other one.
    const q = buildQueue(report([
      { athleteId: 'a', name: 'A', workouts: [paced('2026-09-14', 330), paced('2026-09-16', 308)] },
    ]), new Set(['a|2026-09-14']));
    expect(q.rows[0].headline?.date).toBe('2026-09-16');
  });
});

describe('buildQueue counts', () => {
  it('does not count a missed session as run perfectly', () => {
    const q = buildQueue(report([
      { athleteId: 'a', name: 'A', workouts: [workout({ date: '2026-09-14', completed: false, actual: null })] },
    ]), new Set());
    // null, not 0: 0 means "inside the band", which is the opposite of what happened.
    expect(q.rows[0].headline?.deviationSec).toBeNull();
    expect(q.rows[0].pendingCount).toBe(0);
    expect(q.rows[0].missedCount).toBe(1);
  });

  it('totals the mentor workload rather than the club performance', () => {
    const q = buildQueue(report([
      { athleteId: 'a', name: 'A', workouts: [paced('2026-09-14', 330), paced('2026-09-16', 300)] },
      { athleteId: 'b', name: 'B', workouts: [workout({ date: '2026-09-14', completed: false, actual: null })] },
    ]), new Set(['a|2026-09-16']));
    expect(q.totals).toEqual({ athletes: 2, pending: 1, missed: 1, reviewed: 1 });
  });
});

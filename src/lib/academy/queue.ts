import type { AcademyWeekReport, AthleteAdherence, WorkoutAdherenceRow } from './report';

// ── The mentor's weekly queue: who to open first ────────────────────────────
//
// The screen this feeds answers one question — of twenty trainees, whose week do I
// look at now? Today that decision is made by scrolling a list of names, which
// means the loudest week and the quietest week get the same amount of attention
// and the mentor runs out of evenings before the list runs out of people.
//
// So the order is the product here, not the layout. Two rules decide it:
//
//  · SILENCE OUTRANKS A NUMBER. A trainee who skipped three of four sessions needs
//    a message more than one who ran 12 s/km fast, however alarming the number
//    looks. A missed session is also the only thing on this screen the data cannot
//    explain on its own — the run tells you how it went, an absence tells you
//    nothing — so it is the one a person has to pick up.
//  · REVIEWED WEEKS LEAVE. Once feedback is sent the row has served its purpose and
//    drops below everything unreviewed, whatever its numbers. A queue that keeps
//    showing you finished work is a list, not a queue.
//
// Everything else is magnitude, in the metric's own unit and with its own sign, so
// the number that ordered the queue is the SAME number the mentor then reads in the
// feedback table's deviation column. If those two ever disagree the queue is lying
// about why a row is at the top.

/** Why a row sits where it does — the queue prints this, so it is not a guess. */
export type QueueReason = 'missed' | 'off_target' | 'unreviewed' | 'reviewed';

export interface QueueWorkout {
  date: string;
  name: string;
  completed: boolean;
  activityId: string | null;
  /**
   * Signed seconds per kilometre outside the pace band — negative ran faster,
   * positive ran slower, 0 inside the band, null not gradeable. Measured off
   * `comparedMin`/`comparedMax` (the band the status was judged against) rather
   * than the work band, for the same reason the adherence engine grades on it: a
   * session with a warmup is not slow because of the warmup.
   */
  deviationSec: number | null;
  /** The accuracy percentage the trainee sees on the run itself, or null. */
  score: number | null;
  reviewed: boolean;
}

export interface QueueRow {
  athleteId: string;
  name: string;
  plannedCount: number;
  completedCount: number;
  missedCount: number;
  reviewedCount: number;
  /** Sessions run, not yet reviewed — what the mentor is actually being asked for. */
  pendingCount: number;
  /** The one session that explains this row's position. Null on an empty week. */
  headline: QueueWorkout | null;
  reason: QueueReason;
  /** The sort key, exposed so a reader (and a test) can see why one row beat another. */
  urgency: number;
  workouts: QueueWorkout[];
}

export interface QueueWeek {
  weekStart: string;
  weekEnd: string;
  rows: QueueRow[];
  /** Totals for the header — the mentor's own workload, not the club's performance. */
  totals: { athletes: number; pending: number; missed: number; reviewed: number };
}

/**
 * Signed distance from the band this workout's pace was judged against.
 *
 * Deliberately the same shape as the feedback screen's per-step `bandDelta`, one
 * level up: there it is a step against a step's band, here a run against the run's.
 */
export function paceDeviationSec(w: WorkoutAdherenceRow): number | null {
  const { actual, comparedMin, comparedMax } = w.pace;
  if (actual == null || comparedMin == null || comparedMax == null) return null;
  if (actual < comparedMin) return Math.round(actual - comparedMin);
  if (actual > comparedMax) return Math.round(actual - comparedMax);
  return 0;
}

/** Was this run outside the band at all — the question that makes a row "off target". */
function isOffTarget(w: QueueWorkout): boolean {
  return w.deviationSec != null && w.deviationSec !== 0;
}

/**
 * Rank a trainee's week.
 *
 * The bands are wide apart on purpose (1e6 / 1e5 / 1e4) so that no magnitude can
 * ever promote a row past a category: a 40-second deviation must not outrank a
 * missed session, and no combination of numbers may lift a reviewed week above an
 * unreviewed one. Within a band the deviation orders the rows, and a missed count
 * outranks a big number inside the same band for the reason in the module note.
 */
function rank(row: Omit<QueueRow, 'urgency' | 'reason'>): { urgency: number; reason: QueueReason } {
  // Nothing left to do: everything planned was reviewed, or nothing was planned.
  if (row.pendingCount === 0 && row.missedCount === 0) {
    return { urgency: row.reviewedCount > 0 ? -1 : -2, reason: 'reviewed' };
  }
  const worst = row.workouts
    .filter(w => !w.reviewed)
    .reduce((m, w) => Math.max(m, Math.abs(w.deviationSec ?? 0)), 0);

  if (row.missedCount > 0) {
    return { urgency: 1e6 + row.missedCount * 1e3 + worst, reason: 'missed' };
  }
  const pendingOffTarget = row.workouts.some(w => !w.reviewed && isOffTarget(w));
  if (pendingOffTarget) return { urgency: 1e5 + worst, reason: 'off_target' };
  // Ran everything, all inside the band, still owed a word. Fast to write and
  // still worth writing — "you did exactly what was asked" is feedback.
  return { urgency: 1e4 + row.pendingCount, reason: 'unreviewed' };
}

/** The session the row's position is about, so the card can show its reason. */
function pickHeadline(workouts: QueueWorkout[], reason: QueueReason): QueueWorkout | null {
  const pending = workouts.filter(w => !w.reviewed);
  if (reason === 'missed') {
    // The FIRST missed session, not the worst: consecutive misses are one story and
    // the mentor wants to know when it started.
    return pending.filter(w => !w.completed).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  }
  if (reason === 'off_target') {
    return [...pending].sort((a, b) =>
      Math.abs(b.deviationSec ?? 0) - Math.abs(a.deviationSec ?? 0))[0] ?? null;
  }
  const pool = pending.length ? pending : workouts;
  return [...pool].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

/**
 * Build the queue from a week's adherence report and the feedback already written.
 *
 * `reviewedKeys` is a set of `athleteId|date` — the caller reads the feedback table
 * once for the whole week rather than once per trainee, which is the difference
 * between one query and twenty.
 */
export function buildQueue(report: AcademyWeekReport, reviewedKeys: Set<string>): QueueWeek {
  const rows: QueueRow[] = report.athletes.map((a: AthleteAdherence) => {
    const workouts: QueueWorkout[] = a.week.workouts.map(w => ({
      date: w.date,
      name: w.name,
      completed: w.completed,
      activityId: w.actual?.id ?? null,
      // A missed session has no pace to be outside a band, and calling that `0`
      // would file it as "ran it perfectly".
      deviationSec: w.completed ? paceDeviationSec(w) : null,
      score: w.execution?.score ?? null,
      reviewed: reviewedKeys.has(`${a.athleteId}|${w.date}`),
    }));

    const base = {
      athleteId: a.athleteId,
      name: a.name,
      plannedCount: a.week.plannedCount,
      completedCount: a.week.completedCount,
      missedCount: workouts.filter(w => !w.completed && !w.reviewed).length,
      reviewedCount: workouts.filter(w => w.reviewed).length,
      pendingCount: workouts.filter(w => w.completed && !w.reviewed).length,
      workouts,
      headline: null as QueueWorkout | null,
    };
    const { urgency, reason } = rank(base);
    return { ...base, urgency, reason, headline: pickHeadline(workouts, reason) };
  });

  // Name as the tiebreak, not insertion order: the roster comes back in whatever
  // order the table felt like, so two identical weeks would swap places between
  // refreshes and the mentor would lose their place in their own queue.
  rows.sort((x, y) => y.urgency - x.urgency || x.name.localeCompare(y.name, 'he'));

  return {
    weekStart: report.weekStart,
    weekEnd: report.weekEnd,
    rows,
    totals: {
      athletes: rows.length,
      pending: rows.reduce((n, r) => n + r.pendingCount, 0),
      missed: rows.reduce((n, r) => n + r.missedCount, 0),
      reviewed: rows.reduce((n, r) => n + r.reviewedCount, 0),
    },
  };
}

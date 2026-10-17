// A trainee's goal: the race, its day, and the time they want (mockup
// academy-existing-trainees: "מטרה · מרוץ וזמן", and the trainee's own "המטרה שלך").
//
// Pure. Migration 144's `academy_goals` holds it, one row per trainee, because a trainee who
// was in the academy before the funnel has no candidate row for the characterization's goal
// fields to hang off, and the characterization has no goal TIME at all. The characterization
// is still read as the fallback (goal-server.ts), so a trainee who came through the call keeps
// the goal they gave there until somebody writes a new one.

import { GOAL_TYPES, type Characterization, type GoalType } from './characterization';

/**
 * What the goal is. The characterization's four kinds, plus what the goal module adds
 * (migration 148): a 5K, any other distance, and three goals with no race behind them.
 * Kept as a superset so every reader that only ever knew the four still reads a goal.
 */
export type GoalKind = GoalType | '5k' | 'other' | 'improve' | 'base' | 'comeback';

export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  full: 'מרתון', half: 'חצי מרתון', '10k': '10 ק״מ', '5k': '5 ק״מ', other: 'מרוץ',
  fitness: 'כושר כללי', improve: 'לשפר זמן', base: 'לבנות בסיס', comeback: 'לחזור מפציעה',
};
/** The goals that are not a race — the "אין מרוץ כרגע" choices. */
export const NO_RACE_KINDS: readonly GoalKind[] = ['improve', 'base', 'comeback'];

export interface Goal {
  goalType: GoalKind | null;
  targetRace: string | null;
  /** `YYYY-MM-DD`, the race's calendar day. */
  targetRaceDate: string | null;
  /** Finish time, seconds. */
  goalTimeSec: number | null;
  /** The club race (an `events` row) this goal is, when it is one (migration 148). */
  eventId?: string | null;
  /** What is being run, km (migration 148). */
  distanceKm?: number | null;
  location?: string | null;
  /** "עוד לא סגור": only the month is known; the day is a placeholder (the 15th). */
  dateIsEstimate?: boolean;
  /** The race has been run (migration 148). */
  resultSec?: number | null;
}

export const EMPTY_GOAL: Goal = { goalType: null, targetRace: null, targetRaceDate: null, goalTimeSec: null };

const GOAL_KEYS = new Set<string>([...GOAL_TYPES.map(g => g.value), ...Object.keys(GOAL_KIND_LABELS)]);
/** 10 minutes to 10 hours: a 5K to a slow marathon, with room. Outside it is a typo. */
export const GOAL_TIME_SEC = { min: 600, max: 36_000 };

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Up to an ultra (400 km); two decimals, which is what a race is quoted in. */
const km = (v: unknown) => {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) && n > 0 && n <= 400 ? Math.round(n * 100) / 100 : null;
};

export function hasGoal(g: Goal | null | undefined): boolean {
  return !!g && (!!g.goalType || !!g.targetRace || !!g.targetRaceDate || !!g.goalTimeSec);
}

/** A row (snake or camel case) as a goal; anything unreadable is "no answer". */
export function readGoal(row: Record<string, unknown> | null | undefined): Goal {
  if (!row) return EMPTY_GOAL;
  const type = text(row.goal_type ?? row.goalType);
  const date = text(row.target_race_date ?? row.targetRaceDate);
  const time = Number(row.goal_time_sec ?? row.goalTimeSec);
  const eventId = text(row.event_id ?? row.eventId);
  const result = Number(row.result_sec ?? row.resultSec);
  return {
    goalType: type && GOAL_KEYS.has(type) ? (type as GoalKind) : null,
    targetRace: text(row.target_race ?? row.targetRace),
    targetRaceDate: date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
    goalTimeSec: Number.isFinite(time) && time >= GOAL_TIME_SEC.min && time <= GOAL_TIME_SEC.max ? Math.round(time) : null,
    eventId: eventId && UUID_RE.test(eventId) ? eventId : null,
    distanceKm: km(row.distance_km ?? row.distanceKm),
    location: text(row.location),
    dateIsEstimate: (row.date_is_estimate ?? row.dateIsEstimate) === true,
    resultSec: Number.isFinite(result) && result >= 600 && result <= 172_800 ? Math.round(result) : null,
  };
}

/** The characterization's goal half, as a goal (no time: the call never asked one). */
export function goalFromCharacterization(c: Pick<Characterization, 'goalType' | 'targetRace' | 'targetRaceDate'> | null | undefined): Goal {
  return c ? { goalType: c.goalType, targetRace: c.targetRace, targetRaceDate: c.targetRaceDate, goalTimeSec: null } : EMPTY_GOAL;
}

export type GoalIssue = 'goalType' | 'targetRaceDate' | 'goalTimeSec' | 'distanceKm' | 'eventId';

/**
 * A goal as posted, validated: the fields that were sent but are not readable come back as
 * issues (the route answers 400 naming them), rather than being saved as "no answer" — a race
 * date the coach typed and the server silently dropped is a goal that vanished.
 */
export function parseGoalBody(body: Record<string, unknown>): { goal: Goal; issues: GoalIssue[] } {
  const goal = readGoal(body);
  const issues: GoalIssue[] = [];
  const sent = (k: string) => body[k] !== undefined && body[k] !== null && body[k] !== '';
  if (sent('goalType') && !goal.goalType) issues.push('goalType');
  if (sent('targetRaceDate') && !goal.targetRaceDate) issues.push('targetRaceDate');
  if (sent('goalTimeSec') && !goal.goalTimeSec) issues.push('goalTimeSec');
  if (sent('distanceKm') && !goal.distanceKm) issues.push('distanceKm');
  if (sent('eventId') && !goal.eventId) issues.push('eventId');
  return { goal, issues };
}

/** `3:15:00` / `48:30` for a goal time. */
export function goalTimeText(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// ── The goal module: distance, time estimate, training block ────────────────

/** The goal kind a race of this distance is — a race is filed by what is run. */
export function kindForDistance(distanceKm: number): GoalKind {
  const near = (target: number, tol: number) => Math.abs(distanceKm - target) <= tol;
  if (near(42.195, 0.6)) return 'full';
  if (near(21.0975, 0.4)) return 'half';
  if (near(10, 0.3)) return '10k';
  if (near(5, 0.2)) return '5k';
  return 'other';
}

/** The distance a goal kind stands for, km — for a goal saved before distances existed. */
export function distanceForKind(kind: GoalKind | null | undefined): number | null {
  return kind === 'full' ? 42.195 : kind === 'half' ? 21.0975 : kind === '10k' ? 10 : kind === '5k' ? 5 : null;
}

/** "42.2", "21.1", "10" — a race distance as it is quoted. */
export function distanceLabel(distanceKm: number): string {
  if (Math.abs(distanceKm - 42.195) < 0.01) return '42.2';
  if (Math.abs(distanceKm - 21.0975) < 0.01) return '21.1';
  return String(Math.round(distanceKm * 10) / 10);
}

export interface FinishEstimate {
  conservative: number;
  realistic: number;
  ambitious: number;
}

/**
 * A finish time for `distanceKm`, from the trainee's 30-minute test.
 *
 * The test's average pace IS the app's threshold pace (thirty minutes flat out), so the test is
 * a known race: 30:00 over `1800 / pace` km. Riegel's formula carries a known race to another
 * distance (T2 = T1 · (D2/D1)^1.06) — the standard, and honest about what it is: an estimate
 * from one effort, which is why the screen says "הערכה" and offers a band around it.
 *
 * Only 3–43 km: below that the test is longer than the race, above it Riegel is no longer the
 * right model (an ultra is not a slow marathon). Rounded to the minute over an hour, to ten
 * seconds under — a target is a number people say out loud.
 */
export function estimateFinish(thresholdSecPerKm: number | null | undefined, distanceKm: number | null | undefined): FinishEstimate | null {
  if (!thresholdSecPerKm || !distanceKm || thresholdSecPerKm < 150 || thresholdSecPerKm > 600) return null;
  if (distanceKm < 3 || distanceKm > 43) return null;
  const testKm = 1800 / thresholdSecPerKm;
  const raw = 1800 * Math.pow(distanceKm / testKm, 1.06);
  const round = (sec: number) => (sec >= 3600 ? Math.round(sec / 60) * 60 : Math.round(sec / 10) * 10);
  return { ambitious: round(raw * 0.97), realistic: round(raw), conservative: round(raw * 1.035) };
}

/** Seconds per km of a finish time over a distance. */
export function finishPace(finishSec: number, distanceKm: number): number {
  return finishSec / distanceKm;
}

/**
 * How many weeks a block for this race is: the shape the club's own Valencia block has (17
 * weeks for a marathon), scaled down for shorter races. The coach changes the plan, not this —
 * it only draws the squares and says "שבוע N מתוך M".
 */
export function blockWeeksFor(distanceKm: number | null | undefined): number {
  if (!distanceKm) return 12;
  if (distanceKm >= 30) return 17;
  if (distanceKm >= 15) return 12;
  if (distanceKm >= 8) return 10;
  return 8;
}

export interface GoalProgress {
  /** Whole days to race day; 0 on the day; null once it has passed. */
  days: number | null;
  /** 1-based week of the block; 0 before the block has started. */
  week: number;
  totalWeeks: number;
  /** Weeks before the block starts, when it has not yet. */
  weeksToBlock: number;
}

/** Where today is relative to the race and its block. Dates are calendar days (YYYY-MM-DD). */
export function goalProgress(raceDate: string, today: string, distanceKm: number | null | undefined): GoalProgress {
  const DAY = 86_400_000;
  const race = Date.parse(`${raceDate}T12:00:00Z`);
  const now = Date.parse(`${today}T12:00:00Z`);
  const totalWeeks = blockWeeksFor(distanceKm);
  const days = Math.round((race - now) / DAY);
  if (!Number.isFinite(days) || days < 0) return { days: null, week: 0, totalWeeks, weeksToBlock: 0 };
  const blockStart = race - totalWeeks * 7 * DAY;
  const intoBlock = Math.floor((now - blockStart) / (7 * DAY));
  const week = intoBlock < 0 ? 0 : Math.min(intoBlock + 1, totalWeeks);
  const weeksToBlock = intoBlock < 0 ? Math.ceil((blockStart - now) / (7 * DAY)) : 0;
  return { days, week, totalWeeks, weeksToBlock };
}


// ── After the race ──────────────────────────────────────────────────────────

/** How long after race day the trainee's home still asks "איך היה?". */
export const RACE_RESULT_WINDOW_DAYS = 21;

export interface RaceRun {
  activityId: string;
  km: number;
  /** Elapsed time — a race is timed gun to finish, not moving time. */
  sec: number;
}

/**
 * The run that was the race: on race day, its distance within -15% / +20% of the race's (a
 * GPS course reads long, a watch stopped early reads short), the closest one if there are
 * several (a warm-up jog on the same morning is the usual second run). `start_time` is wall
 * clock stored as UTC (Convention A), so its first ten characters are the local day.
 */
export function pickRaceRun(
  acts: Array<{ id: string; start_time: string; distance: number | null; duration: number | null }>,
  raceDate: string,
  distanceKm: number | null | undefined,
): RaceRun | null {
  if (!distanceKm) return null;
  let best: RaceRun | null = null;
  for (const a of acts) {
    if (!a.start_time || a.start_time.slice(0, 10) !== raceDate) continue;
    const km = (Number(a.distance) || 0) / 1000;
    const sec = Number(a.duration) || 0;
    if (!km || !sec || km < distanceKm * 0.85 || km > distanceKm * 1.2) continue;
    if (!best || Math.abs(km - distanceKm) < Math.abs(best.km - distanceKm)) best = { activityId: a.id, km: Math.round(km * 100) / 100, sec: Math.round(sec) };
  }
  return best;
}

/** "באמצע בלוק" / "בלוק מלא" / "קודם בסיס" — where a goal set today lands, in a few words. */
export function blockLine(p: GoalProgress, locale: 'he' | 'en'): string {
  const he = locale === 'he';
  if (p.days == null) return he ? 'המרוץ כבר עבר' : 'the race has passed';
  if (p.week > 1) return he ? `באמצע בלוק (שבוע ${p.week} מתוך ${p.totalWeeks})` : `mid-block (week ${p.week} of ${p.totalWeeks})`;
  if (p.weeksToBlock > 0) return he ? `קודם בסיס · הבלוק בעוד ${p.weeksToBlock} שבועות` : `base first · block in ${p.weeksToBlock} weeks`;
  return he ? `בלוק מלא של ${p.totalWeeks} שבועות` : `a full ${p.totalWeeks}-week block`;
}

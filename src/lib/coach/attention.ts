/**
 * The coach screens' attention rules — pure, so every threshold Ofer decided on
 * 2026-11-21 is pinned by a unit test rather than by reading a route.
 *
 * Nothing here reads the database. `roster-server.ts` feeds it rows already
 * graded by the existing engines (`assessWeek`, `resolveDominantPace`), and this
 * module only decides what those grades MEAN for a coach: which strip cell to
 * draw, who is on a missed streak, who keeps running easy days too fast, whose
 * quality sessions keep coming in slow, and who goes to the top of the list.
 *
 * Two anchors, as everywhere (CLAUDE.md): the strip, targets, execution and both
 * pace rules are on the PLAN week (Sunday); kilometres are on the ACTIVITY week
 * (Monday). Dates in here are always `YYYY-MM-DD` strings compared as strings —
 * never `getDay()` against a `dayOfWeek`.
 */

import type { PaceStatus, WorkoutAdherence } from '@/lib/academy/adherence';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { addDaysToDateStr } from '@/lib/utils';

// ── Thresholds (decisions 2026-11-21) ─────────────────────────────────────────

/** A completed session at or above this adherence score is "done", below it "partial". */
export const DONE_SCORE = 0.67;
/** Missed planned sessions in a row that raise the flag. */
export const MISSED_STREAK_FLAG = 2;
/** Plan weeks both pace rules look back over (the current one included). */
export const BAND_WEEKS = 3;
/** Easy days run too fast: at least this many, and at least this share of graded easy days. */
export const EASY_FAST_MIN = 3;
export const EASY_FAST_SHARE = 0.6;
/** Quality sessions run too slow (block verdict only): count and share. */
export const QUALITY_SLOW_MIN = 2;
export const QUALITY_SLOW_SHARE = 0.5;
/** "New" on the roster. */
export const NEW_MEMBER_DAYS = 30;
/** Pain on the same spot within this many days is a repeat. */
export const REPEAT_PAIN_DAYS = 21;
/** The HR band (lib/fitness/pace-at-hr, 5-bpm bands) the coach's easy-pace trend is read at. */
export const PACE_AT_HR_BPM = 145;

export type Availability = 'active' | 'injured' | 'paused';
export type AvailabilitySetBy = 'coach' | 'self';
export type StripState = 'done' | 'partial' | 'missed' | 'rest' | 'extra' | 'today' | 'future';
export type SessionKind = 'easy' | 'quality' | 'other';

/** Anything the DB holds that isn't a known value reads as active — the pre-migration state. */
export function normalizeAvailability(value: unknown): Availability {
  return value === 'injured' || value === 'paused' ? value : 'active';
}

export function normalizeSetBy(value: unknown): AvailabilitySetBy | null {
  return value === 'coach' || value === 'self' ? value : null;
}

/** Who-set-it comes from the caller, never from the request body. */
export function setByForCaller(callerAthleteId: string | null, targetAthleteId: string): AvailabilitySetBy {
  return callerAthleteId === targetAthleteId ? 'self' : 'coach';
}

/** Created within the last 30 days (inclusive), comparing Israel calendar dates. */
export function isNewMember(createdAt: string | null | undefined, today: string): boolean {
  if (!createdAt) return false;
  const joined = createdAt.slice(0, 10);
  return joined > addDaysToDateStr(today, -NEW_MEMBER_DAYS - 1) && joined <= today;
}

// ── Session kind ─────────────────────────────────────────────────────────────

function walkSteps(steps: WorkoutStep[] | undefined, visit: (s: WorkoutStep) => void) {
  for (const s of steps || []) {
    visit(s);
    if (s.repeatSteps?.length) walkSteps(s.repeatSteps, visit);
  }
}

/**
 * Which pace rule a planned session belongs to.
 *
 *  - **quality**: it has a work step (`interval`) or a step aimed at a hard zone —
 *    the session the block verdict exists for.
 *  - **easy**: no work step, and at least one paced step aimed at an easy zone or
 *    left as a plain `active` step. Its whole-run average IS the session's pace,
 *    which is why `assessWorkout`'s pace row may judge it.
 *  - **other**: unpaced, HR-only or empty. Neither rule looks at it.
 */
const HARD_ZONES = new Set(['threshold', 'interval', 'tempo', 'sprint', 'marathon_pace']);
export function sessionKind(workout: ParsedWorkout): SessionKind {
  let hard = false;
  let pacedEasy = false;
  walkSteps(workout.steps, (s) => {
    if (s.type === 'interval') hard = true;
    if (s.targetZone && HARD_ZONES.has(s.targetZone)) hard = true;
    if ((s.type === 'active' || s.targetZone === 'easy') && s.targetPaceMinPerKm != null) pacedEasy = true;
  });
  if (hard) return 'quality';
  return pacedEasy ? 'easy' : 'other';
}

// ── The day strip ────────────────────────────────────────────────────────────

export interface StripInput {
  date: string;
  today: string;
  /** The prescribed (non-optional) session on this day, as `assessWeek` graded it. */
  planned: Pick<WorkoutAdherence, 'completed' | 'score'> | null;
  /** Any run at all on this day (the plan's or not). */
  ran: boolean;
  /** The member's join date; days before it are not theirs to miss. */
  joined?: string | null;
}

/**
 * One Sunday-week cell. `today` is only drawn while today's session is still
 * open — a run already in turns it done/partial straight away, and today is
 * never missed until the day closes.
 */
export function stripCell(i: StripInput): StripState {
  const before = !!i.joined && i.date < i.joined;
  if (i.date > i.today) return i.planned && !before ? 'future' : 'rest';
  if (!i.planned || before) return i.ran ? 'extra' : 'rest';
  if (i.planned.completed) return i.planned.score >= DONE_SCORE ? 'done' : 'partial';
  return i.date === i.today ? 'today' : 'missed';
}

// ── Missed in a row ──────────────────────────────────────────────────────────

export interface SessionOutcome {
  date: string;
  completed: boolean;
  optional?: boolean;
}

/**
 * Planned sessions missed in a row, newest first. Rest days are not in the list
 * at all, so they neither break nor extend a streak; an optional session is
 * skipped the same way; today's session isn't counted until the day closes (a
 * run today does end the streak); days before the member joined stop the count.
 */
export function missedStreak(sessions: SessionOutcome[], today: string, joined?: string | null): number {
  const sorted = [...sessions].filter((s) => !s.optional).sort((a, b) => b.date.localeCompare(a.date));
  let n = 0;
  for (const s of sorted) {
    if (s.date > today) continue;
    if (s.completed) break;
    if (s.date === today) continue;
    if (joined && s.date < joined) break;
    n++;
  }
  return n;
}

// ── Off band ─────────────────────────────────────────────────────────────────

export interface BandFlag {
  /** Sessions off the band in the asked direction. */
  n: number;
  /** Sessions the rule could grade. */
  of: number;
  /** The asked band, sec/km [fast, slow] — from the newest flagged session. */
  askedMin: number | null;
  askedMax: number | null;
  /** Average pace actually run over the flagged sessions, sec/km. */
  ran: number | null;
}

export interface GradedPaceSession {
  status: PaceStatus;
  pace: number | null;
  bandMin: number | null;
  bandMax: number | null;
  date: string;
}

function bandFlag(rows: GradedPaceSession[], want: PaceStatus, min: number, share: number): BandFlag | null {
  const graded = rows.filter((r) => r.status !== 'unknown');
  const hits = graded.filter((r) => r.status === want).sort((a, b) => b.date.localeCompare(a.date));
  if (hits.length < min || hits.length / graded.length < share) return null;
  const paces = hits.map((h) => h.pace).filter((p): p is number => p != null);
  return {
    n: hits.length,
    of: graded.length,
    askedMin: hits[0].bandMin,
    askedMax: hits[0].bandMax,
    ran: paces.length ? Math.round(paces.reduce((a, b) => a + b, 0) / paces.length) : null,
  };
}

/**
 * Easy days run too fast: ≥3 and ≥60% of the GRADED easy days over the last three
 * plan weeks with `pace.status === 'faster'` (the ±10 s tolerance is already in
 * that status — `assessPace`). Easy sessions are single-band, so the whole-run row
 * is the session's own pace here.
 */
export function easyTooFast(easy: GradedPaceSession[]): BandFlag | null {
  return bandFlag(easy, 'faster', EASY_FAST_MIN, EASY_FAST_SHARE);
}

/**
 * Quality sessions run too slow: ≥2 and ≥50% of the quality sessions whose BLOCK
 * verdict exists (watch step first, then the dominant block — `resolveDominantPace`)
 * came out `slower`. The caller passes `status: 'unknown'` for a session with no
 * located stretch, so a run with no stream and no stamped laps is never judged
 * from its whole-run average: it drops out of both numerator and denominator.
 */
export function qualityTooSlow(quality: GradedPaceSession[]): BandFlag | null {
  return bandFlag(quality, 'slower', QUALITY_SLOW_MIN, QUALITY_SLOW_SHARE);
}

// ── Pain ─────────────────────────────────────────────────────────────────────

export interface PainReport {
  createdAt: string;
  detail: string | null;
}

// Body parts the runners actually name. "Same spot" = same part (and the same
// side when both mention a side). A report with no detail can't be told apart,
// so it counts as the same spot — a coach would rather see a repeat flag twice.
const BODY_PARTS = ['שוק', 'ברך', 'קרסול', 'ירך', 'גב', 'כף רגל', 'כף הרגל', 'אכילס', 'עקב', 'מפשעה', 'אגן', 'ישבן', 'תאומ', 'שרירי', 'כתף', 'shin', 'knee', 'ankle', 'hip', 'back', 'foot', 'achilles', 'heel', 'calf', 'hamstring'];
function partsOf(detail: string | null): string[] {
  if (!detail) return [];
  const t = detail.toLowerCase();
  return BODY_PARTS.filter((p) => t.includes(p));
}
function sideOf(detail: string | null): 'r' | 'l' | null {
  if (!detail) return null;
  if (/ימין|ימני|right/i.test(detail)) return 'r';
  if (/שמאל|שמאלי|left/i.test(detail)) return 'l';
  return null;
}

/** "שוק ימין" — the body part a report names, with its side, for a row title. Null when none is named. */
export function painSpot(detail: string | null): string | null {
  const part = partsOf(detail)[0];
  if (!part) return null;
  const side = sideOf(detail);
  return side ? `${part} ${side === 'r' ? 'ימין' : 'שמאל'}` : part;
}

/** Is the newest pain report a repeat of one in the 21 days before it? */
export function isRepeatPain(reports: PainReport[]): boolean {
  const sorted = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [latest, ...rest] = sorted;
  if (!latest) return false;
  const cutoff = new Date(new Date(latest.createdAt).getTime() - REPEAT_PAIN_DAYS * 86400_000).toISOString();
  const parts = partsOf(latest.detail);
  const side = sideOf(latest.detail);
  return rest.some((r) => {
    if (r.createdAt < cutoff) return false;
    const other = partsOf(r.detail);
    if (!parts.length || !other.length) return true;
    if (!parts.some((p) => other.includes(p))) return false;
    const s = sideOf(r.detail);
    return !side || !s || side === s;
  });
}

// ── Ordering ─────────────────────────────────────────────────────────────────

export interface AttentionInput {
  name: string;
  pain: { repeat: boolean } | null;
  missedRun: number;
  offBand: BandFlag | null;
  slowBand: BandFlag | null;
  isNew: boolean;
  planKm: number;
  toDateTarget: number;
}

/** pain (repeat first) > missed streak > off band (either direction) > new; 0 = nothing. */
export function attentionRank(r: AttentionInput): number {
  if (r.pain) return r.pain.repeat ? 5 : 4;
  if (r.missedRun >= MISSED_STREAK_FLAG) return 3;
  if (r.offBand || r.slowBand) return 2;
  if (r.isNew) return 1;
  return 0;
}

/** The roster's תשומת לב sort: rank, then furthest behind the to-date target, then name. */
export function compareAttention(a: AttentionInput, b: AttentionInput): number {
  const rank = attentionRank(b) - attentionRank(a);
  if (rank) return rank;
  const behind = (b.toDateTarget - b.planKm) - (a.toDateTarget - a.planKm);
  if (Math.abs(behind) > 0.05) return behind;
  return a.name.localeCompare(b.name, 'he');
}

// ── Club totals ──────────────────────────────────────────────────────────────

export interface ClubRow {
  availability: Availability;
  weekDone: number;
  weekOf: number;
  /** assessWeek.avgScore, 0..1 */
  weekScore: number;
  plannedToday: boolean;
  ranToday: boolean;
  populations: string[];
}

export interface ClubTotals {
  execPct: number | null;
  execDone: number;
  execOf: number;
  ranToday: number;
  plannedToday: number;
  byPopulation: Record<string, { ran: number; planned: number }>;
  activeRunners: number;
  outRunners: number;
}

/** Injured and paused runners are out of execution % and "רצו היום" altogether. */
export function clubTotals(rows: ClubRow[]): ClubTotals {
  const active = rows.filter((r) => r.availability === 'active');
  const withPlan = active.filter((r) => r.weekOf > 0);
  const byPopulation: ClubTotals['byPopulation'] = {};
  for (const r of active) {
    if (!r.plannedToday) continue;
    for (const p of r.populations) {
      const cur = byPopulation[p] || { ran: 0, planned: 0 };
      cur.planned += 1;
      if (r.ranToday) cur.ran += 1;
      byPopulation[p] = cur;
    }
  }
  return {
    execPct: withPlan.length ? Math.round((withPlan.reduce((t, r) => t + r.weekScore, 0) / withPlan.length) * 100) : null,
    execDone: active.reduce((t, r) => t + r.weekDone, 0),
    execOf: active.reduce((t, r) => t + r.weekOf, 0),
    ranToday: active.filter((r) => r.plannedToday && r.ranToday).length,
    plannedToday: active.filter((r) => r.plannedToday).length,
    byPopulation,
    activeRunners: active.length,
    outRunners: rows.length - active.length,
  };
}

/**
 * Club km for the Monday week to date, and the same point of the previous week —
 * never the whole previous week, which would make every Thursday look like a
 * collapse. `day` is the activity's local date string.
 */
export function clubKmToDate(
  runs: Array<{ day: string; meters: number }>,
  activityWeek: string,
  today: string,
): { km: number; kmPrevSamePoint: number } {
  const prevWeek = addDaysToDateStr(activityWeek, -7);
  const prevCut = addDaysToDateStr(today, -7);
  let cur = 0;
  let prev = 0;
  for (const r of runs) {
    if (r.day >= activityWeek && r.day <= today) cur += r.meters;
    else if (r.day >= prevWeek && r.day <= prevCut) prev += r.meters;
  }
  return { km: Math.round(cur / 100) / 10, kmPrevSamePoint: Math.round(prev / 100) / 10 };
}

// ── Populations ──────────────────────────────────────────────────────────────

/** The population keys a runner belongs to, for the chips and the "today" meters. */
export function populationsOf(r: {
  squad: number | null; academy: boolean; isNew: boolean; availability: Availability; listIds: string[];
}): string[] {
  const out = ['all'];
  if (r.availability !== 'active') out.push('out');
  else if (r.squad != null) out.push(`squad${r.squad}`);
  if (r.academy) out.push('academy');
  if (r.isNew) out.push('new');
  for (const id of r.listIds) out.push(`list:${id}`);
  return out;
}

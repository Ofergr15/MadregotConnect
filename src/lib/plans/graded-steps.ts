/**
 * Which parts of a session answer "did you do the workout" — and which are there
 * to be seen, not judged.
 *
 * The rule itself is the coach's, and it is not controversial: a warm-up and a
 * jog home are not the workout. What was controversial is that it was written out
 * by hand in four places — `computePaceBand` (adherence), `dominantBlock`
 * (execution), `dominantWatchStep` and the repeat count in `gradeWatchSteps`
 * (watch-steps) — each spelling it slightly differently: two exclude
 * `warmup`/`cooldown`, one keeps only `active`/`interval`, one drops
 * `rest`/`recovery`. Four copies of a rule that has to hold for a verdict to be
 * fair is how an athlete gets told they ran their 20 km block slow because the
 * jog to the start line was averaged into it.
 *
 * So the roles live here, once, and the graders ask instead of re-deciding:
 *
 *  - **work** (`interval`, `active`) — the session. Its pace is the prescription,
 *    and it is the only stretch a pace verdict may be built on.
 *  - **support** (`warmup`, `cooldown`) — real running the athlete does and the
 *    watch records, so it stays inside the planned DISTANCE: grading a run's total
 *    kilometres against a work-only figure compares two different quantities, the
 *    mistake `computeGradedPaceBand` documents at length. Never in a pace verdict.
 *  - **drill** — strides and activation reps: "15 שנ׳ מתגברת", the 4 × 45 שנ׳
 *    ladder Tuesday opens with. Run hard, sometimes faster than anything in the
 *    session, and still not the session. See `flattenWithRoles`.
 *  - **rest** (`rest`, `recovery`) — a standing rest or a walk/jog between reps.
 *    Not a target, not a failure, and its pace means nothing.
 *
 * `stepRole` is keyed off the step TYPE alone. Whether a step also has anything
 * measurable on it is a different question with its own answer — `isProseStep` in
 * `step-display` — and folding the two together would drop a paced open-ended
 * block ("easy at 5:00, lap when you're done") out of the pace band, leaving the
 * band to fall back on a pool that includes the warm-up.
 *
 * Type alone is not the whole story either, though, because the parser doesn't
 * always type a jog home as one. Friday closes with "2 ק״מ 5:00" written as an
 * `active` step, so the card headed it "שחרור" (positionally, via `isJogHome`)
 * while the grader called it work and stretched the medio's 4:00–4:40 band out to
 * 4:00–5:00 — the athlete's jog home deciding whether his tempo counted. So a
 * caller holding the WHOLE session asks `flattenWithRoles`, which finds the
 * session's real boundaries first. It only ever demotes work to support; a rest
 * stays a rest wherever it sits.
 *
 * Those boundaries are the coach's, and he draws them: a horizontal rule down the
 * PDF column closes the warm-up, another closes the drills. The parser now keeps
 * them as `WorkoutStep.phase`, so on a plan imported since then `sessionBounds`
 * reads the boundary instead of guessing at it — and everything imported before
 * still gets the reconstruction.
 */

import type { WorkoutStep } from '@/lib/ai/types';
import { stepDistanceRange, type EstimateOptions } from './step-estimate';

export type StepRole = 'work' | 'drill' | 'support' | 'rest';

/**
 * Anything carrying a step `type`, because three callers speak three vocabularies
 * for the same thing — a parsed plan step, a graded plan BLOCK, and a step the
 * watch itself reported — and all three use these same words.
 */
export interface RoledStep {
  type?: string | null;
  targetType?: string | null;
  targetPaceMinPerKm?: number | null;
  targetPaceMaxPerKm?: number | null;
}

/**
 * A step's role from its type alone — for the callers that only ever hold one
 * step. Never answers `drill`, because nothing about a 45-second rep in isolation
 * says whether it is a stride or the point of the session; only where it sits
 * does. A caller with the whole session asks `flattenWithRoles`.
 */
export function stepRole(step: RoledStep): StepRole {
  if (step.type === 'warmup' || step.type === 'cooldown') return 'support';
  if (step.type === 'rest' || step.type === 'recovery') return 'rest';
  return 'work';
}

/** The session itself: the stretch a verdict is allowed to be about. */
export function isWorkStep(step: RoledStep): boolean {
  return stepRole(step) === 'work';
}

/** Warm-up or jog home — shown, never judged. */
export function isSupportStep(step: RoledStep): boolean {
  return stepRole(step) === 'support';
}

/** A step carrying a pace to hold, as opposed to one merely timed or open. */
export function isPacedStep(step: RoledStep): boolean {
  return step.targetType === 'pace' && !!step.targetPaceMinPerKm;
}

/**
 * A kilometre or two of easy running the plan never gave a role to: 4:40/km or
 * slower, and short. The shape of the coach's connective tissue — the jog to the
 * start line, the jog home, and the "1 ק״מ 5:00–5:30" he drops between two sets.
 *
 * The distance ceiling is what keeps it a SHAPE test rather than a judgement about
 * the session. Friday's 20 ק״מ medio is bracketed by 5 ק״מ legs at 4:40–5:00 which
 * are the approach and the way home — but that is a reading of the day, and the day
 * says so with a phase now. Guessing it from two slow legs would mean guessing when
 * five easy kilometres are the run-in and when they are a genuine progressive
 * opening, and this heuristic has no way to know. So it stays where the guess is
 * safe: two kilometres, the most this coach ever spends getting from one effort to
 * the next. A longer leg is left in the session unless the plan says otherwise.
 */
const EASY_LINK_PACE_FLOOR = 280;
const EASY_LINK_MAX_METERS = 2000;

function isEasyLink(step: WorkoutStep): boolean {
  return step.type === 'active'
    && step.durationType === 'distance'
    && !!step.durationValue
    && step.durationValue <= EASY_LINK_MAX_METERS
    && (step.targetPaceMinPerKm || 0) >= EASY_LINK_PACE_FLOOR;
}

/**
 * An easy short closing kilometre that the plan never labelled `cooldown`.
 * Positional by nature: it is only a jog home if nothing follows it.
 */
export function isJogHome(step: WorkoutStep): boolean {
  if (step.type === 'cooldown' || step.type === 'recovery') return true;
  return isEasyLink(step);
}

/**
 * A stride or activation rep is always SHORT and always on the clock. Every real
 * work rep in the program is either measured in distance (300 מ׳, 500 מ׳, 2 ק״מ)
 * or long on the clock (Thursday's 9 דק׳) — so "timed and under a minute" tells
 * the two apart with room to spare, where a pace threshold cannot: Tuesday's 45 שנ׳
 * ladder finishes at 3:20, faster than anything in the session that follows it.
 */
const DRILL_MAX_SEC = 60;

function isDrillRep(step: WorkoutStep): boolean {
  return step.durationType === 'time' && !!step.durationValue && step.durationValue < DRILL_MAX_SEC;
}

/**
 * A whole top-level step that is nothing but strides and their recoveries —
 * "×2 (20 ש׳ מתגברת + 40 ש׳ הליכה)", or a bare "2 דק׳ הליכה" between two of them.
 *
 * Asked only of steps at the FRONT or BACK of a session. Thursday's 6 × (9 דק׳
 * @4:25 + 1 דק׳ @3:40) is the same shape as a stride block if you squint, and the
 * 1-minute surge is the entire point of the day; it survives because the 9 דק׳
 * beside it is not a drill, and because it sits mid-session either way.
 */
function isPrepBlock(step: WorkoutStep): boolean {
  const leaves = flattenByRepetition([step]);
  return leaves.length > 0 && leaves.every((leaf) => stepRole(leaf) === 'rest' || isDrillRep(leaf));
}

export interface RoledLeaf {
  step: WorkoutStep;
  role: StepRole;
}

export interface SessionBounds {
  /** Index of the first top-level step of the session proper. */
  start: number;
  /** One past the last. */
  end: number;
  /** `plan` when the document marked the boundary; `shape` when it was reconstructed. */
  source: 'plan' | 'shape';
}

/**
 * The boundary as the PLAN states it — but only if the statement is coherent.
 *
 * A phase is a reading of the coach's separator rules made by the parser, so it is
 * as fallible as any other parse. It is accepted only when every top-level step
 * carries one and they spell `prep* main+ closing*`: one contiguous session, in
 * order, with something in it. A session declared in any other shape isn't a
 * reading of the rules, it's noise, and the shape scan below is a better answer
 * than a garbled one.
 */
function declaredBounds(top: WorkoutStep[]): { start: number; end: number } | null {
  if (!top.length || !top.every((step) => step.phase)) return null;
  const start = top.findIndex((step) => step.phase === 'main');
  if (start < 0) return null;
  let end = start;
  while (end < top.length && top[end].phase === 'main') end++;
  if (top.slice(0, start).some((step) => step.phase !== 'prep')) return null;
  if (top.slice(end).some((step) => step.phase !== 'closing')) return null;
  return { start, end };
}

/**
 * Where the session starts and ends, from the plan if it says and from the step
 * shapes if it doesn't.
 *
 * The shape scan is the fallback, and it is only a fallback: every plan imported
 * before the parser learned to read the coach's rules has no `phase` on it, and
 * they are not going to be reparsed. It looks for a leading run of typed warm-ups
 * and stride blocks and a trailing run of strides and the jog home — see
 * `isPrepBlock` for why "timed and under a minute" is the test that works.
 */
export function sessionBounds(steps: WorkoutStep[]): SessionBounds {
  const top = steps || [];
  const declared = declaredBounds(top);
  if (declared) {
    // The plan says where the session is. It does not always say that the strides
    // tacked onto the end of it are strides: Saturday's closing "x5 (20 שנ׳
    // מתגברת + 40 שנ׳ הליכה)" and Sunday's "x8 (15 שנ׳ + 45 שנ׳)" have no rule
    // drawn before them at all, so reading the rules faithfully puts them inside
    // the session — and a 15-second rep is not the session on any day of the week.
    // Trimming them is the one adjustment a reading still needs; it never takes the
    // last step of the session with it.
    let end = declared.end;
    while (end > declared.start + 1 && isPrepBlock(top[end - 1])) end--;
    return { start: declared.start, end, source: 'plan' };
  }

  // Leading: typed warm-ups and stride blocks, in any order — Tuesday alternates
  // them. Trailing: strides and the jog home, likewise (Sunday finishes with
  // 8 × 15 שנ׳ and no jog at all).
  let start = 0;
  while (start < top.length && (top[start].type === 'warmup' || isPrepBlock(top[start]))) start++;
  let end = top.length;
  while (end > start && (isJogHome(top[end - 1]) || isPrepBlock(top[end - 1]))) end--;
  // Every step looked like bracketing, so the scan ate the day. A session with
  // nothing in it is never the right reading: an easy day written as two easy
  // kilometres, or a day that is only strides, is still the session it is. Hand
  // back the whole thing rather than a verdict about nothing.
  if (end <= start) return { start: 0, end: top.length, source: 'shape' };
  return { start, end, source: 'shape' };
}

/**
 * Every leaf step of a session with the role it is graded under, repeats expanded
 * by repetition — and, crucially, with the session's real BOUNDARIES found first.
 *
 * The session is what is left after a leading run of warm-ups and stride blocks
 * and a trailing run of strides and the jog home. Tuesday is the case that
 * demanded it: the coach writes 2 ק״מ easy, 2 ק״מ easy, a walk, a 4 × 45 שנ׳
 * ladder down to 3:20, a walk, 2 × (20 ש׳ מתגברת + 40 ש׳ הליכה) — and only THEN
 * the workout, which is the three 2 ק״מ sets and the 5 × 300 מ׳. The parser types
 * the ladder `interval`, so the grader counted a 45-second stride at 3:20 as the
 * session's fastest prescribed pace and built the day's pace band on it.
 *
 * The coach marks all of this himself — the source PDF closes the drills with an
 * em-dash rule (`———————`) — and since the parser learned to keep those rules
 * (`WorkoutStep.phase`), a plan imported today states the boundary outright and
 * `sessionBounds` simply reads it. The shape scan there is what answers for the
 * plans imported before that, which is most of them.
 *
 * Inside the session there is one more demotion: an easy kilometre BETWEEN two
 * sets. Tuesday runs its three 2 ק״מ sets, then "1 ק״מ 5:00–5:30", then the
 * 5 × 300 מ׳ — and that kilometre was the only reason the day's prescribed band
 * reached 5:30, i.e. the only reason an athlete who ran every set on pace could be
 * told he ran the session slow at one end of it. It is the same shape as the jog
 * home and it is there for the same reason: to get from one effort to the next.
 * A session that is NOTHING but easy kilometres is still a session, though, so the
 * demotion never takes the last work step with it.
 *
 * Only work is ever demoted; a rest stays a rest wherever it sits.
 *
 * This is what a grader should use whenever it has the whole session in hand;
 * `stepRole` on its own is for the callers that only ever see one step.
 */
export function flattenWithRoles(steps: WorkoutStep[]): RoledLeaf[] {
  const top = steps || [];
  const { start, end } = sessionBounds(top);

  const out: RoledLeaf[] = [];
  const links: number[] = [];
  top.forEach((step, i) => {
    const outside = i < start || i >= end;
    for (const leaf of flattenByRepetition([step])) {
      const role = stepRole(leaf);
      if (role !== 'work') {
        out.push({ step: leaf, role });
        continue;
      }
      if (outside) {
        // Outside the session: a stride is a stride, everything else is the easy
        // running that brackets the day.
        out.push({ step: leaf, role: isDrillRep(leaf) ? 'drill' : 'support' });
        continue;
      }
      if (isEasyLink(leaf)) links.push(out.length);
      out.push({ step: leaf, role: 'work' });
    }
  });

  // A link is only a link with real work on BOTH sides of it. That is the whole
  // claim — "this kilometre is how he got from that set to this one" — and it is
  // why an easy opening kilometre is left alone: a progressive run starts slow, and
  // calling its first leg a warm-up drops the session's own opening out of the
  // verdict. The closing case never reaches here; `sessionBounds` has it already.
  const graded = out
    .map((leaf, i) => (leaf.role === 'work' && !links.includes(i) ? i : -1))
    .filter((i) => i >= 0);
  if (graded.length) {
    for (const i of links) {
      if (i > graded[0] && i < graded[graded.length - 1]) out[i].role = 'support';
    }
  }
  return out;
}

export interface GradedSummary {
  /** Kilometres of actual work — what "did you do the session" is about. */
  workKm: { min: number; max: number };
  /** Kilometres of warm-up and jog home: run and recorded, but not the workout. */
  supportKm: { min: number; max: number };
  /** Kilometres of strides and activation reps — run hard, still not the workout. */
  drillKm: { min: number; max: number };
  /** Kilometres of walking/jogging recovery between reps. */
  restKm: { min: number; max: number };
  /** The work steps' pace band, sec/km. Null when no work step carries a pace. */
  paceBand: { min: number; max: number } | null;
  counts: Record<StepRole, number>;
}

function addKm(a: { min: number; max: number }, meters: { min: number; max: number }) {
  return { min: a.min + meters.min / 1000, max: a.max + meters.max / 1000 };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const roundKm = (r: { min: number; max: number }) => ({ min: round1(r.min), max: round1(r.max) });

/**
 * Repeat blocks flattened BY REPETITION: eight reps of 400 m are 3.2 km of work,
 * and one of them is not the session.
 */
export function flattenByRepetition(steps: WorkoutStep[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const step of steps || []) {
    if (step.repeatCount && step.repeatSteps?.length) {
      for (let i = 0; i < step.repeatCount; i++) out.push(...flattenByRepetition(step.repeatSteps));
      continue;
    }
    out.push(step);
  }
  return out;
}

/** What a session's verdict is about, and what it deliberately leaves out. */
export function gradedSummary(steps: WorkoutStep[], opts: EstimateOptions = {}): GradedSummary {
  const flat = flattenWithRoles(steps);
  const counts: Record<StepRole, number> = { work: 0, drill: 0, support: 0, rest: 0 };
  const km: Record<StepRole, { min: number; max: number }> = {
    work: { min: 0, max: 0 },
    drill: { min: 0, max: 0 },
    support: { min: 0, max: 0 },
    rest: { min: 0, max: 0 },
  };
  let min = Infinity;
  let max = -Infinity;

  for (const { step, role } of flat) {
    counts[role]++;
    km[role] = addKm(km[role], stepDistanceRange(step, opts).range);
    if (role === 'work' && isPacedStep(step)) {
      min = Math.min(min, step.targetPaceMinPerKm!);
      max = Math.max(max, step.targetPaceMaxPerKm || step.targetPaceMinPerKm!);
    }
  }

  return {
    workKm: roundKm(km.work),
    supportKm: roundKm(km.support),
    drillKm: roundKm(km.drill),
    restKm: roundKm(km.rest),
    paceBand: min <= max ? { min, max } : null,
    counts,
  };
}

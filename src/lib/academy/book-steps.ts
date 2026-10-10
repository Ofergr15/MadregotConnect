/**
 * The workout book v3's step model — one shape for "choose, adjust, send".
 *
 * `library-draft.ts` gave the book's form four kinds of row and zone-only efforts, which
 * was right for a form with no pace field. v3 is a different screen: the coach sees the
 * trainee's own paces and nudges them (`4:05` → `4:00`), types `5x1000 ב-4:05`, and takes
 * a club session whose paces were written for a squad. All three produce an effort that is
 * not one of the six named zones, and the mockup draws a rest as a line of its own
 * ("מנוחה 2:00 ג׳וג"). So the model here is:
 *
 *     run   — one unbroken block: the warmup, the tempo, the long run
 *     reps  — `count ×` a block, with its recovery
 *     rest  — standing or jogging between blocks
 *     hr    — a block held at a share of max heart rate
 *
 * and an effort is ALWAYS a `RelativeIntensity` (with the zone it is nearest, for words and
 * colour). The book's one invariant is untouched: nothing here stores sec/km. A pace exists
 * only when a threshold is handed in, and every pace a screen shows goes through
 * `effortPace` so the number on the phone is the number the watch gets.
 *
 * ── A typed pace becomes a percentage of THIS trainee's threshold ────────────────────────
 *
 * `ב-4:05` for a trainee with a 4:30 threshold is 110% of their threshold speed. Stored
 * that way, the same entry gives a 5:00-threshold trainee 4:33 — the TrainingPeaks rule the
 * mockup quotes ("נשמר כ'מהיר ל־Shahar', כך שגם מתאמן אחר יקבל את הקצב שלו"). The band is
 * centred on what was typed and ±1.5% wide (about ±4 s/km at 4:30), because `min === max`
 * is a watch alarm on the first stride off the number — see `RelativeIntensity`.
 *
 * Pure: no clock, no fetch, no Hebrew except in `structureName`, whose output is data (the
 * name an imported entry is saved under), not UI copy.
 */

import type { WorkoutStep } from '@/lib/ai/types';
import {
  ZONE_INTENSITY,
  paceFromPct,
  type LibraryKind,
  type LibraryStep,
  type RelativeIntensity,
} from './library';
import { DRAFT_ZONES, isDraftZone, type DraftZone } from './library-draft';

export type Measure = 'distance' | 'time';

/** Metres for distance, seconds for time. */
export interface Length {
  measure: Measure;
  value: number;
}

export interface Effort {
  /** The named effort nearest the intensity — for the words and the colour only. */
  zone: DraftZone | null;
  intensity: RelativeIntensity;
}

export type RestMode = 'jog' | 'walk' | 'stand';

export interface RestSpec {
  length: Length;
  mode: RestMode | null;
  /**
   * The coach's words on the recovery, carried verbatim (`הליכה וג׳ל`). Same reason as
   * `restNote` in library-draft: a rewrite would drop the half `mode` cannot say.
   */
  note?: string;
}

export type BookStep =
  | { kind: 'run'; role: 'warmup' | 'main' | 'cooldown'; length: Length | null; effort: Effort | null; note?: string }
  | { kind: 'reps'; count: number; work: Length; effort: Effort | null; rest: RestSpec | null; note?: string }
  | { kind: 'rest'; length: Length; mode: RestMode | null; note?: string }
  | { kind: 'hr'; seconds: number; minPct: number; maxPct: number };

/**
 * A typical threshold, used ONLY to estimate size when the trainee has no test.
 *
 * Totals and the profile bar need a pace to turn kilometres into minutes, and refusing to
 * draw a bar because nobody tested is a worse screen than an estimate marked `כ־`. It is
 * never used to resolve a pace a watch receives — `resolveLibraryWorkout` still refuses.
 */
export const ESTIMATE_THRESHOLD_SEC = 300;

/** Half-width of the band a typed pace is stored with, in percentage points of speed. */
export const TYPED_HALF_WIDTH_PCT = 1.5;

const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Efforts ────────────────────────────────────────────────────────────────────────────

export function centrePct(intensity: RelativeIntensity): number {
  return (intensity.fastPct + intensity.slowPct) / 2;
}

/** The named zone whose centre is closest. Ties go to the easier one. */
export function nearestZone(pct: number): DraftZone {
  let best: DraftZone = 'easy';
  let bestGap = Infinity;
  for (const zone of DRAFT_ZONES) {
    const gap = Math.abs(centrePct(ZONE_INTENSITY[zone]!) - pct);
    if (gap < bestGap - 1e-9) { best = zone; bestGap = gap; }
  }
  return best;
}

export function effortFromZone(zone: DraftZone): Effort {
  return { zone, intensity: { ...ZONE_INTENSITY[zone]! } };
}

/** A centre percentage → an effort with the typed band width. */
export function effortFromPct(pct: number, halfWidth = TYPED_HALF_WIDTH_PCT): Effort {
  const centre = round1(pct);
  return {
    zone: nearestZone(centre),
    intensity: { fastPct: round1(centre + halfWidth), slowPct: round1(centre - halfWidth) },
  };
}

/** `ב-4:05` for a trainee with threshold `thresholdSec` → their effort. */
export function effortFromPace(paceSec: number, thresholdSec: number): Effort {
  return effortFromPct((thresholdSec / paceSec) * 100);
}

/** The pace a step shows: the CENTRE of its band, so a typed `4:05` reads back as `4:05`. */
export function effortPace(effort: Effort, thresholdSec: number): number {
  return paceFromPct(thresholdSec, centrePct(effort.intensity));
}

/** The bar's three tones. Thresholds are the mockup's own colour split. */
export type Tone = 'e' | 't' | 'f' | 'r';

export function toneOfPct(pct: number): Exclude<Tone, 'r'> {
  if (pct < 88) return 'e';
  if (pct <= 103) return 't';
  return 'f';
}

export function toneOf(effort: Effort | null): Exclude<Tone, 'r'> {
  return effort ? toneOfPct(centrePct(effort.intensity)) : 'e';
}

// ── LibraryStep ⇄ BookStep ─────────────────────────────────────────────────────────────

const MODE_NOTE: Record<RestMode, string> = { jog: 'ג׳וג', walk: 'הליכה', stand: 'עמידה' };

export function restModeOf(type: string | undefined, note: string | undefined): RestMode | null {
  const n = (note ?? '').replace(/[׳’`´]/g, "'");
  if (/ג'?וג/.test(n)) return 'jog';
  if (/הליכה/.test(n)) return 'walk';
  if (/עמידה|מוחלטת/.test(n)) return 'stand';
  return type === 'recovery' ? 'jog' : null;
}

function lengthOf(step: Pick<LibraryStep, 'durationType' | 'durationValue'>): Length | null {
  if ((step.durationType === 'distance' || step.durationType === 'time') && step.durationValue && step.durationValue > 0) {
    return { measure: step.durationType, value: step.durationValue };
  }
  return null;
}

function effortOf(step: LibraryStep): Effort | null {
  if (!step.intensity) return null;
  const zone = isDraftZone(step.targetZone) ? step.targetZone : nearestZone(centrePct(step.intensity));
  return { zone, intensity: { ...step.intensity } };
}

function paceFields(effort: Effort | null) {
  if (!effort) return { targetType: 'no_target' as const };
  return {
    targetType: 'pace' as const,
    ...(effort.zone ? { targetZone: effort.zone } : {}),
    intensity: { ...effort.intensity },
  };
}

function restLibraryStep(order: number, rest: { length: Length; mode: RestMode | null; note?: string }): LibraryStep {
  const note = rest.note ?? (rest.mode ? MODE_NOTE[rest.mode] : undefined);
  return {
    order,
    type: rest.mode === 'jog' ? 'recovery' : 'rest',
    durationType: rest.length.measure,
    durationValue: rest.length.value,
    targetType: 'no_target',
    ...(note ? { notes: note } : {}),
  };
}

/** What the book stores. `order` is assigned here, so no screen holds it. */
export function toLibrarySteps(steps: BookStep[]): LibraryStep[] {
  return steps.map((step, index) => {
    const order = index + 1;
    switch (step.kind) {
      case 'run':
        return {
          order,
          type: step.role === 'main' ? 'active' : step.role,
          durationType: step.length?.measure ?? 'open',
          ...(step.length ? { durationValue: step.length.value } : {}),
          ...paceFields(step.effort),
          ...(step.note ? { notes: step.note } : {}),
        };
      case 'reps': {
        const work: LibraryStep = {
          order: 1,
          type: 'interval',
          durationType: step.work.measure,
          durationValue: step.work.value,
          ...paceFields(step.effort),
          ...(step.note ? { notes: step.note } : {}),
        };
        return {
          order,
          type: 'interval',
          durationType: step.work.measure,
          targetType: 'no_target',
          repeatCount: step.count,
          repeatSteps: step.rest ? [work, restLibraryStep(2, step.rest)] : [work],
        };
      }
      case 'rest':
        return restLibraryStep(order, step);
      case 'hr':
        return {
          order,
          type: 'active',
          durationType: 'time',
          durationValue: step.seconds,
          targetType: 'heart_rate',
          targetHrMinPct: step.minPct,
          targetHrMaxPct: step.maxPct,
        };
    }
  });
}

const isRestType = (type: string) => type === 'rest' || type === 'recovery';

/** A rest note worth carrying: anything but the bare mode word `restLibraryStep` writes itself. */
function ownNote(note: string | undefined, mode: RestMode | null): boolean {
  return !!note && !(mode && note === MODE_NOTE[mode]);
}

/**
 * What the book stores → the editable model, or `null` when it cannot be said exactly.
 *
 * Null rather than a best effort for the reason library-draft gives: a lossy read shown as
 * a complete form deletes the steps it did not understand on the next send. The screens
 * fall back to read-only lines for these, and still send the entry as stored.
 */
export function fromLibrarySteps(steps: LibraryStep[]): BookStep[] | null {
  const out: BookStep[] = [];
  for (const step of steps) {
    if (step.repeatSteps?.length) {
      if (!step.repeatCount || step.repeatCount < 1) return null;
      const inner = step.repeatSteps;
      if (inner.length > 2) return null;
      const [work, rest] = inner;
      if (!work || isRestType(work.type) || work.repeatSteps?.length) return null;
      if (work.targetType === 'heart_rate') return null;
      const workLength = lengthOf(work);
      if (!workLength) return null;
      let restSpec: RestSpec | null = null;
      if (rest) {
        if (!isRestType(rest.type) || rest.repeatSteps?.length) return null;
        const restLength = lengthOf(rest);
        if (!restLength) return null;
        const mode = restModeOf(rest.type, rest.notes);
        restSpec = { length: restLength, mode, ...(ownNote(rest.notes, mode) ? { note: rest.notes } : {}) };
      }
      out.push({
        kind: 'reps',
        count: step.repeatCount,
        work: workLength,
        effort: effortOf(work),
        rest: restSpec,
        ...(work.notes ? { note: work.notes } : {}),
      });
      continue;
    }

    if (step.targetType === 'heart_rate') {
      const length = lengthOf(step);
      if (!length || length.measure !== 'time') return null;
      if (typeof step.targetHrMinPct !== 'number' || typeof step.targetHrMaxPct !== 'number') return null;
      out.push({ kind: 'hr', seconds: length.value, minPct: step.targetHrMinPct, maxPct: step.targetHrMaxPct });
      continue;
    }

    if (isRestType(step.type)) {
      const length = lengthOf(step);
      if (!length) return null;
      const mode = restModeOf(step.type, step.notes);
      out.push({ kind: 'rest', length, mode, ...(ownNote(step.notes, mode) ? { note: step.notes } : {}) });
      continue;
    }

    const role = step.type === 'warmup' || step.type === 'cooldown' ? step.type : 'main';
    out.push({
      kind: 'run',
      role,
      length: lengthOf(step),
      effort: effortOf(step),
      ...(step.notes ? { note: step.notes } : {}),
    });
  }
  return out;
}

// ── Absolute paces → the book (club plans, saved plans, the import) ─────────────────────

const PACE_TOKEN = /\(*\s*\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})?\s*\)*/g;

/**
 * A note with the paces taken out. `"3:50 (4:00) ((4:10)) מתגברת"` → `"מתגברת"`.
 *
 * The Garmin converter prints a note VERBATIM when it contains a pace, so a club note left
 * intact would put the squad's numbers on the trainee's watch next to the trainee's own.
 */
export function stripPaceText(notes: string | undefined): string | undefined {
  if (!notes) return undefined;
  const cleaned = notes
    .replace(PACE_TOKEN, ' ')
    .replace(/\s*[-–—,·]\s*$/g, '')
    .replace(/^\s*[-–—,·]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || undefined;
}

function parseClock(s: string): number {
  const [m, sec] = s.split(':').map(Number);
  return m * 60 + sec;
}

/** The first pace or pace range written in a note, as sec/km. */
export function paceInNote(notes: string | undefined): { min: number; max: number } | null {
  const m = (notes ?? '').match(/(\d{1,2}:\d{2})(?:\s*[-–—]\s*(\d{1,2}:\d{2}))?/);
  if (!m) return null;
  const a = parseClock(m[1]);
  const b = m[2] ? parseClock(m[2]) : a;
  if (!(a >= 120 && a <= 900) || !(b >= 120 && b <= 900)) return null;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** `"60-80 דקות"` / `"50 דקות"` in a note → seconds, the middle of a range. */
export function minutesInNote(notes: string | undefined): number | null {
  const m = (notes ?? '').match(/(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\s*(?:דק|דקות|min)/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  const mid = (a + b) / 2;
  return mid > 0 && mid <= 300 ? Math.round(mid * 60) : null;
}

export interface Converted {
  steps: LibraryStep[];
  /** Why a human should look before this is saved. Empty when the conversion was exact. */
  review: string[];
}

/**
 * Steps written at absolute paces (a club lane, a trainee's saved week) → book steps,
 * relative to `referenceSec`.
 *
 * `referenceSec` is the threshold the paces were WRITTEN for — a lane's reference (see
 * senior-pick.ts) or the trainee's own test. Every pace becomes `reference / pace` of
 * threshold speed. Zone-only steps take the zone's table value. A step whose only pace is
 * in its note (the club's easy days are `open` steps with `"60-80 דקות 4:40-5:15"`) is
 * read from the note and flagged, because that is a parse of prose, not of a field.
 */
export function absoluteToLibrary(steps: WorkoutStep[], referenceSec: number): Converted {
  const review = new Set<string>();

  const convert = (step: WorkoutStep): LibraryStep => {
    const {
      targetPaceMinPerKm, targetPaceMaxPerKm, group2Pace, group3Pace,
      group2HeartRate, group3HeartRate, durationMaxValue, repeatSteps, notes, ...rest
    } = step;
    void group2Pace; void group3Pace; void group2HeartRate; void group3HeartRate; void durationMaxValue;
    const out: LibraryStep = { ...rest } as LibraryStep;
    const cleanNotes = stripPaceText(notes);
    if (cleanNotes) out.notes = cleanNotes; else delete out.notes;

    if (repeatSteps?.length) {
      out.repeatSteps = repeatSteps.map(convert);
      return out;
    }

    let fast = typeof targetPaceMinPerKm === 'number' && targetPaceMinPerKm > 0 ? targetPaceMinPerKm : null;
    let slow = typeof targetPaceMaxPerKm === 'number' && targetPaceMaxPerKm > 0 ? targetPaceMaxPerKm : fast;
    if (fast === null && slow !== null) fast = slow;

    if (fast === null && !isRestType(step.type) && step.targetType !== 'heart_rate') {
      const fromNote = paceInNote(notes);
      if (fromNote) {
        fast = fromNote.min;
        slow = fromNote.max;
        review.add('pace-from-note');
      }
    }
    if (out.durationType === 'open' && !isRestType(step.type)) {
      const seconds = minutesInNote(notes);
      if (seconds) {
        out.durationType = 'time';
        out.durationValue = seconds;
        review.add('length-from-note');
      } else {
        review.add('open-length');
      }
    }

    if (fast !== null && slow !== null && step.targetType !== 'heart_rate') {
      out.targetType = 'pace';
      out.intensity = {
        fastPct: round1((referenceSec / fast) * 100),
        slowPct: round1((referenceSec / slow) * 100),
      };
      if (!isDraftZone(out.targetZone)) out.targetZone = nearestZone(centrePct(out.intensity));
    } else if (step.targetType === 'pace' && isDraftZone(step.targetZone)) {
      out.intensity = { ...ZONE_INTENSITY[step.targetZone]! };
    } else if (step.targetType === 'pace') {
      out.targetType = 'no_target';
      delete out.targetZone;
    }
    return out;
  };

  return { steps: steps.map(convert), review: [...review] };
}

// ── Size: totals and the profile bar ───────────────────────────────────────────────────

/** Walking, for a rest written in metres. 12:30/km. */
const WALK_SEC_PER_KM = 750;

function stepPace(effort: Effort | null, thresholdSec: number): number {
  return effort ? effortPace(effort, thresholdSec) : paceFromPct(thresholdSec, centrePct(ZONE_INTENSITY.easy!));
}

interface Piece { tone: Tone; sec: number; metres: number; known: boolean }

function piecesOfLength(length: Length | null, paceSec: number, tone: Tone, moving = true): Piece {
  if (!length) return { tone, sec: 0, metres: 0, known: false };
  if (length.measure === 'distance') {
    return { tone, sec: (length.value * paceSec) / 1000, metres: moving ? length.value : length.value, known: true };
  }
  return { tone, sec: length.value, metres: moving ? (length.value / paceSec) * 1000 : 0, known: true };
}

function restPiece(rest: { length: Length; mode: RestMode | null }, thresholdSec: number): Piece {
  if (rest.mode === 'jog') {
    return piecesOfLength(rest.length, stepPace(null, thresholdSec) * 1.1, 'r');
  }
  // A walk or a stand: time, and no ground covered unless it was written in metres.
  if (rest.length.measure === 'distance') {
    return { tone: 'r', sec: (rest.length.value * WALK_SEC_PER_KM) / 1000, metres: rest.length.value, known: true };
  }
  return { tone: 'r', sec: rest.length.value, metres: 0, known: true };
}

/** Every atomic piece of the session in order, repeats expanded. */
function pieces(steps: BookStep[], thresholdSec: number): Piece[] {
  const out: Piece[] = [];
  for (const step of steps) {
    switch (step.kind) {
      case 'run':
        out.push(piecesOfLength(step.length, stepPace(step.effort, thresholdSec), toneOf(step.effort)));
        break;
      case 'reps': {
        const work = piecesOfLength(step.work, stepPace(step.effort, thresholdSec), toneOf(step.effort));
        const rest = step.rest ? restPiece(step.rest, thresholdSec) : null;
        for (let i = 0; i < step.count; i++) {
          out.push(work);
          // No recovery after the last rep: the mockup's bars end on the work, and a
          // trailing rest is time the session does not actually contain.
          if (rest && i < step.count - 1) out.push(rest);
        }
        break;
      }
      case 'rest':
        out.push(restPiece(step, thresholdSec));
        break;
      case 'hr':
        out.push({ tone: 't', sec: step.seconds, metres: (step.seconds / stepPace(null, thresholdSec)) * 1000, known: true });
        break;
    }
  }
  return out;
}

export interface BookTotals {
  distanceM: number;
  durationSec: number;
  /** True when a test was missing or a block had no length — the screen prefixes `כ־`. */
  estimated: boolean;
}

export function bookTotals(steps: BookStep[], thresholdSec: number | null): BookTotals {
  const list = pieces(steps, thresholdSec ?? ESTIMATE_THRESHOLD_SEC);
  return {
    distanceM: Math.round(list.reduce((s, p) => s + p.metres, 0)),
    durationSec: Math.round(list.reduce((s, p) => s + p.sec, 0)),
    estimated: thresholdSec === null || list.some(p => !p.known),
  };
}

export interface BarSegment { tone: Tone; weight: number }

/**
 * The mini profile: one segment per piece, weighted by time, adjacent same-tone pieces
 * merged (a warmup written as two steps is one block of green, as it is on the mockup).
 * An open block gets the weight of ten minutes so it is visible rather than absent.
 */
export function profileBar(steps: BookStep[], thresholdSec: number | null): BarSegment[] {
  const list = pieces(steps, thresholdSec ?? ESTIMATE_THRESHOLD_SEC);
  const out: BarSegment[] = [];
  for (const p of list) {
    const weight = p.known ? p.sec : 600;
    if (weight <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.tone === p.tone && p.tone !== 'f' && p.tone !== 'r') last.weight += weight;
    else out.push({ tone: p.tone, weight });
  }
  return out;
}

// ── The adjust screen: which numbers there are, and what ± does to each ────────────────

export type FieldName = 'count' | 'length' | 'pace' | 'rest' | 'hrMin' | 'hrMax';

export interface FieldRef {
  step: number;
  field: FieldName;
}

/** The step the quick row edits: the first set of reps, else the first effort-bearing run. */
export function mainStepIndex(steps: BookStep[]): number {
  const reps = steps.findIndex(s => s.kind === 'reps');
  if (reps >= 0) return reps;
  const main = steps.findIndex(s => s.kind === 'run' && s.role === 'main');
  if (main >= 0) return main;
  return steps.findIndex(s => s.kind === 'run');
}

/** The quick row's cells: `חזרות · כל חזרה · קצב` for reps, `אורך · קצב` for a run. */
export function quickFields(steps: BookStep[]): FieldRef[] {
  const i = mainStepIndex(steps);
  if (i < 0) return [];
  const step = steps[i];
  if (step.kind === 'reps') {
    return [{ step: i, field: 'count' }, { step: i, field: 'length' }, { step: i, field: 'pace' }];
  }
  if (step.kind === 'run') {
    const out: FieldRef[] = [];
    if (step.length) out.push({ step: i, field: 'length' });
    out.push({ step: i, field: 'pace' });
    return out;
  }
  return [];
}

/**
 * A field's raw value: a count, metres/seconds for a length, sec/km for a pace (or a
 * percentage when there is no threshold to turn it into one).
 */
export function fieldValue(steps: BookStep[], ref: FieldRef, thresholdSec: number | null): number | null {
  const step = steps[ref.step];
  if (!step) return null;
  switch (ref.field) {
    case 'count':
      return step.kind === 'reps' ? step.count : null;
    case 'length':
      if (step.kind === 'reps') return step.work.value;
      if (step.kind === 'run') return step.length?.value ?? null;
      if (step.kind === 'rest') return step.length.value;
      if (step.kind === 'hr') return step.seconds;
      return null;
    case 'pace': {
      const effort = step.kind === 'reps' || step.kind === 'run' ? step.effort : null;
      if (!effort) return null;
      return thresholdSec ? effortPace(effort, thresholdSec) : centrePct(effort.intensity);
    }
    case 'rest':
      return step.kind === 'reps' && step.rest ? step.rest.length.value : null;
    case 'hrMin':
      return step.kind === 'hr' ? step.minPct : null;
    case 'hrMax':
      return step.kind === 'hr' ? step.maxPct : null;
  }
}

/** Which measure a length field is in, so the UI knows to print metres, km or a clock. */
export function fieldMeasure(steps: BookStep[], ref: FieldRef): Measure | 'count' | 'pace' | 'pct' | null {
  const step = steps[ref.step];
  if (!step) return null;
  if (ref.field === 'count') return 'count';
  if (ref.field === 'pace') return 'pace';
  if (ref.field === 'hrMin' || ref.field === 'hrMax') return 'pct';
  if (ref.field === 'rest') return step.kind === 'reps' && step.rest ? step.rest.length.measure : null;
  if (step.kind === 'reps') return step.work.measure;
  if (step.kind === 'run') return step.length?.measure ?? null;
  if (step.kind === 'rest') return step.length.measure;
  if (step.kind === 'hr') return 'time';
  return null;
}

/**
 * One tap of + on a field: the step the coach would expect next.
 *
 * The grids are the coaching conventions, not a constant step: a rep goes 400 → 500 → 600
 * but 1000 → 1200 → 1400, a rest moves in 15 s up to two minutes and 30 s past it. `sign`
 * picks the direction so − walks the same grid backwards (from 1200, − is 1000, not 1100).
 */
function stepSize(kind: 'repDistance' | 'runDistance' | 'repTime' | 'runTime' | 'restTime' | 'restDistance', value: number, sign: 1 | -1): number {
  // Measure the grid on the side being moved into, so the boundary value steps the small
  // way going down and the large way going up.
  const v = sign > 0 ? value : value - 1;
  switch (kind) {
    case 'repDistance': return v < 1000 ? 100 : v < 2000 ? 200 : 400;
    case 'runDistance': return 500;
    case 'repTime': return v < 120 ? 15 : v < 600 ? 30 : 60;
    case 'runTime': return v < 600 ? 60 : 300;
    case 'restTime': return v < 120 ? 15 : v < 300 ? 30 : 60;
    case 'restDistance': return 100;
  }
}

const LIMITS = {
  count: [1, 50],
  distance: [100, 60000],
  time: [10, 6 * 3600],
  pace: [150, 900],
  pct: [40, 140],
  hr: [50, 100],
} as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** A deep-enough copy that editing the result never touches `steps`. */
function cloneSteps(steps: BookStep[]): BookStep[] {
  return JSON.parse(JSON.stringify(steps)) as BookStep[];
}

/** Set a field to an exact value (the wheel), keeping everything else about the step. */
export function setField(steps: BookStep[], ref: FieldRef, value: number, thresholdSec: number | null): BookStep[] {
  const next = cloneSteps(steps);
  const step = next[ref.step];
  if (!step) return steps;
  switch (ref.field) {
    case 'count':
      if (step.kind === 'reps') step.count = Math.round(clamp(value, LIMITS.count));
      break;
    case 'length': {
      const set = (len: Length) => { len.value = Math.round(clamp(value, LIMITS[len.measure])); };
      if (step.kind === 'reps') set(step.work);
      else if (step.kind === 'run' && step.length) set(step.length);
      else if (step.kind === 'rest') set(step.length);
      else if (step.kind === 'hr') step.seconds = Math.round(clamp(value, LIMITS.time));
      break;
    }
    case 'pace': {
      if (step.kind !== 'reps' && step.kind !== 'run') break;
      const half = step.effort
        ? (step.effort.intensity.fastPct - step.effort.intensity.slowPct) / 2
        : TYPED_HALF_WIDTH_PCT;
      const pct = thresholdSec
        ? (thresholdSec / clamp(value, LIMITS.pace)) * 100
        : clamp(value, LIMITS.pct);
      step.effort = effortFromPct(pct, half);
      break;
    }
    case 'rest':
      if (step.kind === 'reps' && step.rest) step.rest.length.value = Math.round(clamp(value, LIMITS[step.rest.length.measure]));
      break;
    case 'hrMin':
      if (step.kind === 'hr') step.minPct = Math.round(clamp(value, LIMITS.hr));
      break;
    case 'hrMax':
      if (step.kind === 'hr') step.maxPct = Math.round(clamp(value, LIMITS.hr));
      break;
  }
  return next;
}

/** One tap of + (`sign = 1`) or − on a field. */
export function nudgeField(steps: BookStep[], ref: FieldRef, sign: 1 | -1, thresholdSec: number | null): BookStep[] {
  const step = steps[ref.step];
  const value = fieldValue(steps, ref, thresholdSec);
  if (!step || value === null) return steps;
  let delta: number;
  switch (ref.field) {
    case 'count': delta = 1; break;
    case 'pace':
      // `+` makes the NUMBER bigger, which for a pace is slower. Literal on purpose: the
      // control sits under the number, and a + that shrinks it reads as broken. Without a
      // threshold the number is a percentage of threshold speed, so + is 1 point easier.
      if (!thresholdSec) return setField(steps, ref, value - sign, null);
      delta = 5;
      break;
    case 'rest': {
      const measure = step.kind === 'reps' && step.rest ? step.rest.length.measure : 'time';
      delta = stepSize(measure === 'time' ? 'restTime' : 'restDistance', value, sign);
      break;
    }
    case 'hrMin': case 'hrMax': delta = 1; break;
    case 'length': {
      const measure = fieldMeasure(steps, ref);
      if (step.kind === 'reps') delta = stepSize(measure === 'time' ? 'repTime' : 'repDistance', value, sign);
      else if (step.kind === 'rest') delta = stepSize(measure === 'time' ? 'restTime' : 'restDistance', value, sign);
      else delta = stepSize(measure === 'time' ? 'runTime' : 'runDistance', value, sign);
      break;
    }
  }
  // Snap onto the grid first, so 1050 + 100 is 1100 and not 1150.
  const snapped = sign > 0 ? Math.floor(value / delta) * delta + delta : Math.ceil(value / delta) * delta - delta;
  return setField(steps, ref, ref.field === 'pace' ? value + sign * delta : snapped, thresholdSec);
}

/** The wheel's rows for a field, centred on the current value. */
export function wheelOptions(steps: BookStep[], ref: FieldRef, thresholdSec: number | null): number[] {
  const value = fieldValue(steps, ref, thresholdSec);
  if (value === null) return [];
  const range = (from: number, to: number, by: number) => {
    const out: number[] = [];
    for (let v = from; v <= to + 1e-9; v += by) out.push(Math.round(v * 10) / 10);
    return out;
  };
  const withValue = (list: number[]) => (list.includes(value) ? list : [...list, value].sort((a, b) => a - b));
  const measure = fieldMeasure(steps, ref);
  switch (ref.field) {
    case 'count': return range(1, 30, 1);
    case 'pace':
      return thresholdSec ? withValue(range(150, 600, 5).map(Math.round)) : withValue(range(60, 130, 1));
    case 'hrMin': case 'hrMax': return range(50, 100, 1);
    case 'rest':
      return measure === 'time' ? withValue(range(15, 600, 15)) : withValue(range(100, 1000, 100));
    case 'length': {
      const step = steps[ref.step];
      if (measure === 'time') {
        return step?.kind === 'reps'
          ? withValue([...range(15, 120, 15), ...range(150, 600, 30), ...range(660, 1800, 60)])
          : withValue([...range(60, 600, 60), ...range(900, 3 * 3600, 300)]);
      }
      return step?.kind === 'reps'
        ? withValue([100, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 1600, 2000, 2500, 3000, 4000, 5000])
        : withValue(range(500, 42000, 500));
    }
  }
}

/** A new step for "+ שלב", placed before the cooldown when there is one. */
export function addStep(steps: BookStep[], kind: 'run' | 'reps' | 'rest'): BookStep[] {
  const next = cloneSteps(steps);
  const fresh: BookStep = kind === 'reps'
    ? { kind: 'reps', count: 4, work: { measure: 'distance', value: 400 }, effort: effortFromZone('interval'), rest: { length: { measure: 'time', value: 90 }, mode: 'jog' } }
    : kind === 'rest'
      ? { kind: 'rest', length: { measure: 'time', value: 120 }, mode: 'walk' }
      : { kind: 'run', role: 'main', length: { measure: 'distance', value: 2000 }, effort: effortFromZone('easy') };
  const cooldown = next.findIndex(s => s.kind === 'run' && s.role === 'cooldown');
  if (cooldown >= 0) next.splice(cooldown, 0, fresh);
  else next.push(fresh);
  return next;
}

export function removeStep(steps: BookStep[], index: number): BookStep[] {
  return steps.filter((_, i) => i !== index);
}

// ── Identity: structure keys and names ─────────────────────────────────────────────────

/**
 * What makes two sessions "the same workout" for the book: the steps' kinds, lengths and
 * rep counts and the TONE of each effort — not its exact percentage.
 *
 * `5 × 1000 @ 4:05` and `5 × 1000 @ 4:00` are one session the coach ran two weeks apart,
 * and the import would otherwise put both in the book, one row each, forever. Notes and
 * step order numbers are ignored for the same reason.
 */
export function structureKey(steps: LibraryStep[]): string {
  const one = (s: LibraryStep): string => {
    const role = s.type === 'warmup' ? 'w' : s.type === 'cooldown' ? 'c' : isRestType(s.type) ? 'r' : 'a';
    const len = s.durationType === 'open' || !s.durationValue ? 'o' : `${s.durationType === 'distance' ? 'd' : 't'}${s.durationValue}`;
    const effort = s.targetType === 'heart_rate'
      ? `h${s.targetHrMinPct ?? ''}-${s.targetHrMaxPct ?? ''}`
      : s.intensity ? toneOfPct(centrePct(s.intensity)) : 'x';
    if (s.repeatSteps?.length) return `${s.repeatCount ?? 1}[${s.repeatSteps.map(one).join(',')}]`;
    return `${role}:${len}:${role === 'r' ? 'x' : effort}`;
  };
  return steps.map(one).join('|');
}

function kmText(metres: number): string {
  const km = metres / 1000;
  return Number.isInteger(km) ? String(km) : String(Math.round(km * 10) / 10);
}

function repLengthText(len: Length): string {
  if (len.measure === 'time') {
    return len.value % 60 === 0 ? `${len.value / 60} דק׳` : `${len.value} שנ׳`;
  }
  return len.value >= 1000 && len.value % 500 === 0 ? `${kmText(len.value)} ק״מ` : `${len.value} מ׳`;
}

const TONE_WORD: Partial<Record<DraftZone, string>> = {
  tempo: 'טמפו', threshold: 'סף', marathon_pace: 'קצב מרתון',
};

/**
 * A plain Hebrew name from the structure — what an imported entry is saved under, and the
 * title the adjust screen shows for a typed session. Written the way the mockup names
 * them: `5 × 1 ק״מ`, `6 × 800 מ׳`, `3 × 2 ק״מ טמפו`, `טמפו 20 דקות`, `16 ק״מ ארוכה`.
 */
export function structureName(steps: BookStep[]): string {
  const reps = steps.filter((s): s is Extract<BookStep, { kind: 'reps' }> => s.kind === 'reps');
  const totals = bookTotals(steps, null);
  if (reps.length > 1) {
    const sameShape = reps.every(r => r.work.measure === reps[0].work.measure && r.work.value === reps[0].work.value);
    if (!sameShape) {
      const values = reps.map(r => r.work.value);
      const unit = reps[0].work.measure === 'time' ? 'שנ׳' : '';
      return `סדרות ${Math.min(...values)}–${Math.max(...values)}${unit ? ` ${unit}` : ''}`;
    }
  }
  const main = reps.find(r => toneOf(r.effort) !== 'e' || reps.length === 1) ?? reps[0];
  if (main) {
    const strides = toneOf(main.effort) === 'f' && main.work.measure === 'distance' && main.work.value <= 200
      && steps.some(s => s.kind === 'run' && s.role === 'main' && toneOf(s.effort) === 'e');
    if (strides) {
      const run = steps.find(s => s.kind === 'run' && s.role === 'main');
      return `${kmText(run && run.kind === 'run' && run.length?.measure === 'distance' ? run.length.value : totals.distanceM)} ק״מ קל + האצות`;
    }
    // Only `טמפו` is said of a set of reps — `5 × 1 ק״מ` at threshold is how the club names
    // it, and `5 × 1 ק״מ סף` is not a phrase anybody uses.
    const word = main.effort?.zone === 'tempo' ? TONE_WORD.tempo : undefined;
    return `${main.count} × ${repLengthText(main.work)}${word ? ` ${word}` : ''}`;
  }
  const hr = steps.find(s => s.kind === 'hr');
  if (hr && hr.kind === 'hr') return `דופק ${Math.round(hr.seconds / 60)} דקות`;
  const run = steps.find(s => s.kind === 'run' && s.role === 'main' && s.effort && toneOf(s.effort) !== 'e')
    ?? steps.find(s => s.kind === 'run' && s.role === 'main')
    ?? steps.find(s => s.kind === 'run');
  if (run && run.kind === 'run') {
    const word = run.effort?.zone ? TONE_WORD[run.effort.zone] : undefined;
    if (word && run.length?.measure === 'time') return `${word} ${Math.round(run.length.value / 60)} דקות`;
    if (word && run.length) return `${kmText(run.length.value)} ק״מ ${word}`;
    if (totals.distanceM >= 14000) return `${kmText(Math.round(totals.distanceM / 500) * 500)} ק״מ ארוכה`;
    if (run.length?.measure === 'time') return `${Math.round(run.length.value / 60)} דקות קל`;
    if (totals.distanceM > 0) return `${kmText(Math.round(totals.distanceM / 500) * 500)} ק״מ קל`;
  }
  return 'אימון';
}

/** Which of the book's six chips an entry belongs under. `hint` is the source's own name. */
export function guessKind(steps: BookStep[], hint = ''): LibraryKind {
  if (/טסט|מבחן|test/i.test(hint)) return 'test';
  if (/גבע|עליות|עליה|hill/i.test(hint)) return 'hills';
  if (steps.some(s => s.kind === 'reps' && toneOf(s.effort) === 'f')
      && !/האצות/.test(structureName(steps))) return 'intervals';
  if (steps.some(s => (s.kind === 'reps' || s.kind === 'run') && s.effort && toneOf(s.effort) === 't')) return 'tempo';
  if (/ארוכ|long/i.test(hint) || bookTotals(steps, null).distanceM >= 14000) return 'long';
  return 'easy';
}

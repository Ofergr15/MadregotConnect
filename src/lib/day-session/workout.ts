/**
 * The day session's workout in the PLANNER's shape (`WorkoutStep[]`, lib/ai/types.ts), so
 * the coach edits it in the planner's own editor (components/WorkoutEditor.tsx) and every
 * option the planner has is there: a pace per pack (❶ (❷) ((❸))), a range per pace, time or
 * distance or lap, repeat blocks with steps inside, notes, duplicate, drag, undo.
 *
 * Three ways in, one shape out:
 *   · the sentence, written the way it goes to WhatsApp — parseClubText. The club's own
 *     notation `3:15 (3:25) ((3:35))` is a pace per pack, and `4:40 - 5:15` is a range;
 *   · the editor's steps, as sent — validateWorkoutSteps;
 *   · a row saved before this shape (QuickStep[] + one rep pace per pack) — quickToWorkout,
 *     on read, so old rows keep working and no migration is needed: `steps` is JSONB.
 */

import type { GroupPace, WorkoutStep } from '@/lib/ai/types';
import { normalizeQuick, parseQuickText, type QuickEffort, type QuickStep } from '@/lib/academy/quick-text';
import type { Length, RestMode } from '@/lib/academy/book-steps';
import { sessionHeadline } from '@/lib/plans/session-summary';
import { isRestStep, stepMetric, type StepUnits } from '@/lib/plans/step-display';
import { workoutDurationSec } from '@/lib/workout-duration';
import { workoutDistanceMeters } from '@/lib/workout-distance';

/** One pace per pack (sec/km for the reps), pack 1 first. Null = not set. The old rows' shape. */
export type PackPaces = [number | null, number | null, number | null];

export const HE_UNITS: StepUnits = { km: 'ק״מ', m: 'מ׳', sec: 'שנ׳', min: 'דק׳' };

const REST_NOTE: Record<RestMode, string> = { walk: 'הליכה', jog: 'ג׳וג', stand: 'עמידה' };

// ── QuickStep → WorkoutStep ────────────────────────────────────────────────────────────

/** Extra packs' paces for one quick step, from `(❷)` and `((❸))`. */
export interface PackExtra { g2?: GroupPace; g3?: GroupPace }

function duration(length: Length | null): Pick<WorkoutStep, 'durationType' | 'durationValue'> {
  return length ? { durationType: length.measure, durationValue: length.value } : { durationType: 'open' };
}

function target(effort: QuickEffort | null, extra?: PackExtra | null): Partial<WorkoutStep> {
  // Under 2:30/km is not a pace — "8x400 1:20" is the rep's time, which the editor sets.
  if (effort?.kind === 'pace' && Math.min(effort.min, effort.max) >= 150) {
    const g1 = { min: Math.min(effort.min, effort.max), max: Math.max(effort.min, effort.max) };
    // All three packs, same pace until the coach splits it — never ❶ alone (the editor's rule).
    return {
      targetType: 'pace', targetPaceMinPerKm: g1.min, targetPaceMaxPerKm: g1.max,
      group2Pace: extra?.g2 ?? g1, group3Pace: extra?.g3 ?? extra?.g2 ?? g1,
    };
  }
  if (effort?.kind === 'zone') return { targetType: 'no_target', targetZone: effort.zone };
  return { targetType: 'no_target' };
}

/** An old row's one-pace-per-pack for the reps, laid onto the rep step. */
function withPackPaces(step: WorkoutStep, paces: PackPaces): WorkoutStep {
  if (!paces.some(Boolean)) return step;
  const own = step.targetPaceMinPerKm ? { min: step.targetPaceMinPerKm, max: step.targetPaceMaxPerKm ?? step.targetPaceMinPerKm } : null;
  const pick = (i: number): GroupPace | null => {
    const p = paces[i];
    if (p) return { min: p, max: p };
    const g = i === 0 ? own : i === 1 ? step.group2Pace ?? own : step.group3Pace ?? own;
    return g ?? null;
  };
  const g1 = pick(0) ?? pick(1) ?? pick(2)!;
  return {
    ...step, targetType: 'pace', targetZone: undefined,
    targetPaceMinPerKm: g1.min, targetPaceMaxPerKm: g1.max,
    group2Pace: pick(1) ?? g1, group3Pace: pick(2) ?? pick(1) ?? g1,
  };
}

/**
 * Quick steps → planner steps. A rest written right after reps that have none of their own
 * ("15 x 200 · 100 מ׳ הליכה") is the recovery between them, so it goes inside the repeat.
 */
export function quickToWorkout(steps: QuickStep[], packPaces: PackPaces = [null, null, null], extras: Array<PackExtra | null> = []): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const extra = extras[i] ?? null;
    if (s.kind === 'run') {
      out.push({
        order: 0,
        type: s.role === 'warmup' ? 'warmup' : s.role === 'cooldown' ? 'cooldown' : 'active',
        ...duration(s.length),
        targetType: 'no_target',
        ...target(s.effort, extra),
      } as WorkoutStep);
    } else if (s.kind === 'rest') {
      out.push({ order: 0, type: 'rest', ...duration(s.length), targetType: 'no_target', ...(s.mode ? { notes: REST_NOTE[s.mode] } : {}) });
    } else {
      let work: WorkoutStep = { order: 0, type: 'interval', ...duration(s.work), targetType: 'no_target', ...target(s.effort, extra) } as WorkoutStep;
      work = withPackPaces(work, packPaces);
      let rest: WorkoutStep | null = s.rest
        ? { order: 0, type: 'rest', ...duration(s.rest.length), targetType: 'no_target', ...(s.rest.mode ? { notes: REST_NOTE[s.rest.mode] } : {}) }
        : null;
      const after = steps[i + 1];
      if (!rest && after?.kind === 'rest') {
        rest = { order: 0, type: 'rest', ...duration(after.length), targetType: 'no_target', ...(after.mode ? { notes: REST_NOTE[after.mode] } : {}) };
        i++;
      }
      const inner = rest ? [work, rest] : [work];
      out.push({ ...work, repeatCount: s.count, repeatSteps: inner });
    }
  }
  return renumber(out);
}

/** `order` 1..n at each level, the way the planner's editor writes it. */
export function renumber(steps: WorkoutStep[]): WorkoutStep[] {
  return steps.map((s, i) => ({ ...s, order: i + 1, ...(s.repeatSteps ? { repeatSteps: renumber(s.repeatSteps) } : {}) }));
}

// ── The sentence, in the club's notation ───────────────────────────────────────────────

const PACE = String.raw`\d{1,2}[:.]\d{2}`;
const RANGE = String.raw`(${PACE})(?:\s*-\s*(${PACE}))?`;
const DOUBLE = new RegExp(String.raw`\(\(\s*${RANGE}\s*\)\)`);
const SINGLE = new RegExp(String.raw`\(\s*${RANGE}\s*\)`);

const sec = (t: string) => { const [m, s] = t.split(/[:.]/).map(Number); return m * 60 + s; };
const rangeOf = (m: RegExpExecArray): GroupPace => {
  const a = sec(m[1]);
  const b = m[2] ? sec(m[2]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
};

export interface ClubParse {
  steps: WorkoutStep[];
  /** Words nothing understood. Shown, never dropped silently. */
  unknown: string[];
}

/**
 * The coach's WhatsApp text → planner steps. One line is one block, and a line that is only
 * the count ("15 x") belongs to the next one. `(❷)` and `((❸))` after a pace are the other
 * packs' paces for the step on that line; the rest of each line is the quick grammar
 * (lib/academy/quick-text.ts), read as one sentence so "2 קל" first is still the warm-up.
 */
export function parseClubText(text: string): ClubParse {
  const raw = text.split(/\n+/).map((l) => normalizeQuick(l).trim()).filter(Boolean);
  const lines: string[] = [];
  for (const l of raw) {
    const prev = lines[lines.length - 1];
    if (prev !== undefined && /\d\s*x$/i.test(prev)) lines[lines.length - 1] = `${prev} ${l}`;
    else lines.push(l);
  }
  const extras: Array<PackExtra | null> = [];
  const plain: string[] = [];
  for (const line of lines) {
    let rest = line;
    const extra: PackExtra = {};
    const d = DOUBLE.exec(rest);
    if (d) { extra.g3 = rangeOf(d); rest = rest.replace(DOUBLE, ' '); }
    const s = SINGLE.exec(rest);
    if (s) { extra.g2 = rangeOf(s); rest = rest.replace(SINGLE, ' '); }
    rest = rest.replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim()
      // "6x1000 3:35": a rep of 100+ followed by a pace is metres, not a clock.
      .replace(/(\d+x\d{3,5})(?=\s+\d{1,2}[:.]\d{2})/g, "$1 מ'");
    if (!rest) continue;
    // Each line's own steps, so its packs' paces land on the step that has a pace.
    const own = parseQuickText(rest).steps;
    const paced = own.findIndex((st) => (st.kind === 'run' || st.kind === 'reps') && st.effort?.kind === 'pace');
    own.forEach((_, j) => extras.push(j === paced && (extra.g2 || extra.g3) ? extra : null));
    plain.push(rest);
  }
  const parse = parseQuickText(plain.join(', '));
  // The whole sentence can read differently from its lines (a rest folded into reps);
  // then the line mapping no longer lines up and the extra packs are left to the editor.
  const map = parse.steps.length === extras.length ? extras : [];
  return { steps: quickToWorkout(parse.steps, [null, null, null], map), unknown: parse.unknown };
}

// ── What the card and the push say ─────────────────────────────────────────────────────

export function workoutTotals(steps: WorkoutStep[]): { distanceM: number; durationSec: number } {
  const w = { dayOfWeek: 0, name: '', steps };
  return { distanceM: workoutDistanceMeters(w), durationSec: workoutDurationSec(w) };
}

/** "15 × 200 מ׳" — the block the session is built on (the planner's own headline). */
export function workoutTitle(steps: WorkoutStep[], units: StepUnits = HE_UNITS): string {
  return sessionHeadline(steps, units);
}

/** Does the session hold any running (not only rests)? */
export function hasRunning(steps: WorkoutStep[]): boolean {
  return steps.some((s) => (s.repeatSteps?.length ? hasRunning(s.repeatSteps) : s.type !== 'rest' && s.type !== 'recovery'));
}

/** A row's `steps` in the old quick shape? */
export function isQuickShape(raw: unknown[]): boolean {
  return raw.some((s) => !!s && typeof s === 'object' && 'kind' in (s as object) && !('type' in (s as object)));
}

// ── The editor's steps, checked ────────────────────────────────────────────────────────

export const MAX_STEPS = 40;
const TYPES = ['warmup', 'interval', 'rest', 'recovery', 'cooldown', 'active'] as const;
const DURATIONS = ['distance', 'time', 'open'] as const;
const TARGETS = ['pace', 'heart_rate', 'no_target'] as const;
const LIMIT = { distance: [1, 100000], time: [1, 8 * 3600], pace: [120, 1200], repeat: [1, 99], hr: [30, 110] } as const;

const num = (v: unknown, [lo, hi]: readonly [number, number]) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const optNum = (v: unknown, lim: readonly [number, number]) => v === undefined || v === null || num(v, lim);
const groupOk = (v: unknown, lim: readonly [number, number]) => {
  if (v === undefined || v === null) return true;
  const g = v as Record<string, unknown>;
  return num(g.min, lim) && num(g.max, lim);
};

function readStep(raw: unknown, depth: number, where: string): WorkoutStep | string {
  const s = (raw || {}) as Record<string, unknown>;
  if (!TYPES.includes(s.type as typeof TYPES[number])) return `${where}: type`;
  if (!DURATIONS.includes(s.durationType as typeof DURATIONS[number])) return `${where}: durationType`;
  if (s.durationType !== 'open' && !num(s.durationValue, LIMIT[s.durationType as 'distance' | 'time'])) return `${where}: duration out of range`;
  if (s.durationMaxValue !== undefined && !(s.durationType === 'time' && num(s.durationMaxValue, LIMIT.time))) return `${where}: durationMaxValue`;
  if (!TARGETS.includes(s.targetType as typeof TARGETS[number])) return `${where}: targetType`;
  if (!optNum(s.targetPaceMinPerKm, LIMIT.pace) || !optNum(s.targetPaceMaxPerKm, LIMIT.pace)) return `${where}: pace out of range`;
  if (!groupOk(s.group2Pace, LIMIT.pace) || !groupOk(s.group3Pace, LIMIT.pace)) return `${where}: pack pace out of range`;
  if (!optNum(s.targetHrMinPct, LIMIT.hr) || !optNum(s.targetHrMaxPct, LIMIT.hr)) return `${where}: heart rate`;
  if (!groupOk(s.group2HeartRate, LIMIT.hr) || !groupOk(s.group3HeartRate, LIMIT.hr)) return `${where}: pack heart rate`;
  if (s.notes !== undefined && typeof s.notes !== 'string') return `${where}: notes`;
  if (s.targetZone !== undefined && typeof s.targetZone !== 'string') return `${where}: zone`;
  const step: WorkoutStep = {
    order: 0,
    type: s.type as WorkoutStep['type'],
    durationType: s.durationType as WorkoutStep['durationType'],
    targetType: s.targetType as WorkoutStep['targetType'],
  };
  const copy = ['durationValue', 'durationMaxValue', 'targetZone', 'targetPaceMinPerKm', 'targetPaceMaxPerKm', 'group2Pace', 'group3Pace',
    'targetHrMinPct', 'targetHrMaxPct', 'group2HeartRate', 'group3HeartRate'] as const;
  for (const k of copy) if (s[k] !== undefined && s[k] !== null) (step as unknown as Record<string, unknown>)[k] = s[k];
  if (typeof s.notes === 'string' && s.notes.trim()) step.notes = s.notes.trim().slice(0, 300);
  if (s.repeatSteps !== undefined && s.repeatSteps !== null) {
    if (depth > 0) return `${where}: a repeat inside a repeat`;
    if (!Array.isArray(s.repeatSteps) || !s.repeatSteps.length || s.repeatSteps.length > MAX_STEPS) return `${where}: repeat steps`;
    if (!num(s.repeatCount, LIMIT.repeat)) return `${where}: repeat count`;
    const inner: WorkoutStep[] = [];
    for (const [j, r] of s.repeatSteps.entries()) {
      const c = readStep(r, depth + 1, `${where}.${j + 1}`);
      if (typeof c === 'string') return c;
      inner.push(c);
    }
    step.repeatCount = Math.round(s.repeatCount as number);
    step.repeatSteps = inner;
  }
  return step;
}

/** The editor's steps from a request body. A string is the 400. */
export function validateWorkoutSteps(raw: unknown): WorkoutStep[] | string {
  if (!Array.isArray(raw)) return 'steps must be a list';
  if (!raw.length) return 'steps empty';
  if (raw.length > MAX_STEPS) return `at most ${MAX_STEPS} steps`;
  const out: WorkoutStep[] = [];
  for (const [i, item] of raw.entries()) {
    const s = readStep(item, 0, `step ${i + 1}`);
    if (typeof s === 'string') return s;
    out.push(s);
  }
  if (!hasRunning(out)) return 'steps hold no running';
  return renumber(out);
}

/**
 * The session in a line, for the notification: "50 דק׳ + 15 × 200 מ׳". Rests left out,
 * a repeat as its count and its work. Plain text — no bidi marks, which a lock screen
 * draws as boxes.
 */
export function workoutSummary(steps: WorkoutStep[], units: StepUnits = HE_UNITS): string {
  const parts: string[] = [];
  for (const s of steps) {
    if (s.repeatSteps?.length) {
      const work = s.repeatSteps.find((r) => !isRestStep(r)) ?? s.repeatSteps[0];
      const m = stepMetric(work, units);
      parts.push(m ? `${s.repeatCount} × ${m}` : `${s.repeatCount} ×`);
    } else if (!isRestStep(s)) {
      const m = stepMetric(s, units);
      if (m) parts.push(m);
    }
  }
  return parts.join(' + ');
}

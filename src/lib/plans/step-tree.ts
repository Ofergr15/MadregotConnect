// ── The workout builder's model ─────────────────────────────────────────────────
//
// The builder (components/WorkoutEditor.tsx) lets a coach drag any step to any place:
// between two steps, into a repeat block, out of one. The parse is not always shaped
// the way the coach meant — week 11.10's hills came back with the "4 דק׳ בין סטים" rest
// as the last sub-step of the 3× block, so the watch played it three times — and the
// old editor could only append at the end, so there was no way to put it right.
//
// Everything that decides WHERE a step goes lives here, with no React in it: a step
// is addressed by a draft-only `_id` (positions shift under a drag; ids don't), a drop
// target is a `Slot`, and `stripIds` turns the draft back into plain WorkoutSteps.

import type { AutoFix, WorkoutStep } from '@/lib/ai/types';

export type DraftStep = Omit<WorkoutStep, 'repeatSteps'> & { _id: string; repeatSteps?: DraftStep[] };

/** `top` = a gap in the workout's own list; `in` = a gap inside one repeat block. */
export type Slot = { kind: 'top'; index: number } | { kind: 'in'; repeatId: string; index: number };

let seq = 0;
export const newId = (): string => `st${++seq}`;

export const isRepeat = (s: Pick<WorkoutStep, 'repeatCount' | 'repeatSteps'>): boolean =>
  s.repeatCount !== undefined && Array.isArray(s.repeatSteps);

export function withIds(steps: WorkoutStep[]): DraftStep[] {
  return steps.map((s) => ({
    ...s,
    _id: newId(),
    repeatSteps: s.repeatSteps ? withIds(s.repeatSteps) : undefined,
  })) as DraftStep[];
}

/**
 * Back to what the plan stores: ids dropped, `order` renumbered 1..n at each level,
 * and a repeat's own type/duration mirrored from its first sub-step — the parser
 * writes repeat parents that way and the readers that summarise a block from the
 * parent (not its children) keep working.
 */
export function stripIds(steps: DraftStep[]): WorkoutStep[] {
  return steps.map((s, i) => {
    const { _id, repeatSteps, ...rest } = s;
    void _id;
    const out: WorkoutStep = { ...rest, order: i + 1 };
    if (repeatSteps) {
      out.repeatSteps = stripIds(repeatSteps);
      const first = out.repeatSteps[0];
      if (first) {
        out.type = first.type;
        out.durationType = first.durationType;
        out.durationValue = first.durationValue;
      }
    } else {
      delete out.repeatSteps;
    }
    return out;
  });
}

export interface Located { list: DraftStep[]; index: number; parent?: DraftStep }

export function locate(steps: DraftStep[], id: string): Located | null {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s._id === id) return { list: steps, index: i };
    if (s.repeatSteps) {
      const j = s.repeatSteps.findIndex((c) => c._id === id);
      if (j >= 0) return { list: s.repeatSteps, index: j, parent: s };
    }
  }
  return null;
}

function slotList(steps: DraftStep[], slot: Slot): DraftStep[] | null {
  if (slot.kind === 'top') return steps;
  const rep = steps.find((s) => s._id === slot.repeatId);
  return rep?.repeatSteps ?? null;
}

/** A repeat emptied by a drag or a delete has nothing left to repeat — it goes. */
export function dropEmptyRepeats(steps: DraftStep[]): DraftStep[] {
  return steps.filter((s) => !s.repeatSteps || s.repeatSteps.length > 0);
}

/**
 * Move a step to a slot. Returns a new array (the input is not touched) or `null`
 * when the move is not allowed or changes nothing: a repeat block cannot go inside
 * another repeat (Garmin has one level), and dropping a step on its own gap is a no-op.
 *
 * The target index is resolved against the step that sits AT the slot before the
 * source is lifted out, so taking the source out of the same list cannot shift where
 * it lands.
 */
export function moveStep(steps: DraftStep[], id: string, slot: Slot): DraftStep[] | null {
  const next = structuredClone(steps);
  const src = locate(next, id);
  const dst = slotList(next, slot);
  if (!src || !dst) return null;
  const item = src.list[src.index];
  if (slot.kind === 'in' && (item.repeatSteps || slot.repeatId === item._id)) return null;
  const anchor = dst[slot.index];
  if (anchor === item) return null;
  if (anchor === undefined && dst === src.list && src.index === dst.length - 1) return null;
  src.list.splice(src.index, 1);
  let at = anchor ? dst.indexOf(anchor) : dst.length;
  if (at < 0) at = dst.length;
  dst.splice(at, 0, item);
  return dropEmptyRepeats(next);
}

/** Put a new step (or a whole new repeat block) at a slot. */
export function insertAt(steps: DraftStep[], item: DraftStep, slot: Slot): DraftStep[] | null {
  const next = structuredClone(steps);
  const dst = slotList(next, slot);
  if (!dst) return null;
  if (slot.kind === 'in' && item.repeatSteps) return null;
  dst.splice(Math.min(slot.index, dst.length), 0, item);
  return next;
}

export function removeStep(steps: DraftStep[], id: string): DraftStep[] {
  const next = structuredClone(steps);
  const at = locate(next, id);
  if (at) at.list.splice(at.index, 1);
  return dropEmptyRepeats(next);
}

export function updateStep(steps: DraftStep[], id: string, patch: (s: DraftStep) => DraftStep): DraftStep[] {
  const next = structuredClone(steps);
  const at = locate(next, id);
  if (at) at.list[at.index] = patch(at.list[at.index]);
  return next;
}

/** A copy right after the original, with fresh ids all the way down. */
export function duplicateStep(steps: DraftStep[], id: string): { steps: DraftStep[]; newId: string } | null {
  const next = structuredClone(steps);
  const at = locate(next, id);
  if (!at) return null;
  const copy = structuredClone(at.list[at.index]);
  const reId = (s: DraftStep) => { s._id = newId(); s.repeatSteps?.forEach(reId); };
  reId(copy);
  at.list.splice(at.index + 1, 0, copy);
  return { steps: next, newId: copy._id };
}

/** "פירוק החזרות": the block's sub-steps, once, in its place. */
export function unwrapRepeat(steps: DraftStep[], id: string): DraftStep[] {
  const next = structuredClone(steps);
  const i = next.findIndex((s) => s._id === id);
  if (i < 0 || !next[i].repeatSteps) return next;
  next.splice(i, 1, ...next[i].repeatSteps!);
  return next;
}

// ── auto-fix paths ───────────────────────────────────────────────────────────────
// An AutoFix names its step by index path (workout.steps[i].repeatSteps[j]). Once
// steps can move, a stale path would point the import's "undo this fix" at whatever
// step now sits there. So the paths are re-derived from the step's identity: the
// fix follows its step, and a fix whose step was deleted is dropped.

function pathOf(steps: DraftStep[], id: string): number[] | null {
  const at = locate(steps, id);
  if (!at) return null;
  if (!at.parent) return [at.index];
  return [steps.indexOf(at.parent), at.index];
}

function idAt(steps: DraftStep[], path: number[]): string | null {
  let s: DraftStep | undefined = steps[path[0]];
  for (const p of path.slice(1)) s = s?.repeatSteps?.[p];
  return s?._id ?? null;
}

export function remapAutoFixes(fixes: AutoFix[] | undefined, before: DraftStep[], after: DraftStep[]): AutoFix[] | undefined {
  if (!fixes) return fixes;
  const out: AutoFix[] = [];
  for (const f of fixes) {
    const id = idAt(before, f.stepPath);
    const path = id ? pathOf(after, id) : null;
    if (path) out.push({ ...f, stepPath: path });
  }
  return out;
}

// ── typed numbers ────────────────────────────────────────────────────────────────
// Every number in the builder can be typed as well as nudged, because the program
// has values no − / + lands on (1.2 ק״מ, 2:45). The unit the coach picked next to the
// field decides what a bare number means.

export type DistanceUnit = 'km' | 'm';
export type TimeUnit = 'min' | 'sec';

const num = (t: string): number => parseFloat(t.trim().replace(',', '.'));

/** "1.2" km → 1200, "1,5" km → 1500, "400" m → 400. Not a positive number → null. */
export function parseDistance(text: string, unit: DistanceUnit): number | null {
  const n = num(text);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  return Math.round(unit === 'km' ? n * 1000 : n);
}

/** "1:30" → 90 in any unit; a bare "2.5" in min → 150, "45" in sec → 45. Also "1:05:00". */
export function parseTime(text: string, unit: TimeUnit): number | null {
  const t = text.trim();
  const hms = t.match(/^(\d{1,2}):(\d{1,2}):(\d{2})$/);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];
  const ms = t.match(/^(\d{1,3}):(\d{1,2})$/);
  if (ms) return +ms[1] * 60 + +ms[2] || null;
  const n = num(t);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  return Math.round(unit === 'min' ? n * 60 : n);
}

/**
 * A pace per km, the way runners type it: "4:12", "4.12" and "412" are all 4:12.
 * Anything outside 2:00–10:00 /km is a typo, not a pace.
 */
export function parsePace(text: string): number | null {
  const t = text.trim().replace(',', '.');
  const m = t.match(/^(\d{1,2})[:.](\d{1,2})$/) ?? t.match(/^(\d)(\d{2})$/);
  if (!m) return null;
  const sec = m[2].length === 1 ? +m[2] * 10 : +m[2];
  if (sec > 59) return null;
  const v = +m[1] * 60 + sec;
  return v >= 120 && v <= 600 ? v : null;
}

export const defaultDistanceUnit = (meters: number): DistanceUnit => (meters >= 1000 ? 'km' : 'm');
export const defaultTimeUnit = (sec: number): TimeUnit => (sec < 60 ? 'sec' : 'min');

const pad = (n: number) => n.toString().padStart(2, '0');
export function mmss(sec: number): string {
  const s = Math.round(sec);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** The text in the duration box, in the unit shown beside it. */
export function durationBoxText(step: Pick<WorkoutStep, 'durationType' | 'durationValue'>, unit: DistanceUnit | TimeUnit): string {
  const v = step.durationValue ?? 0;
  if (step.durationType === 'distance') return unit === 'km' ? String(+(v / 1000).toFixed(3)) : String(v);
  return unit === 'sec' ? String(v) : mmss(v);
}

/** − / + step size: small values move in small steps. */
export function durationNudge(step: Pick<WorkoutStep, 'durationType' | 'durationValue'>, unit: DistanceUnit | TimeUnit): number {
  const v = step.durationValue ?? 0;
  if (step.durationType === 'distance') return unit === 'km' ? 100 : v < 1000 ? 50 : 100;
  if (unit === 'sec' || v < 60) return 5;
  return v < 600 ? 15 : 60;
}

// ── the structure chart ─────────────────────────────────────────────────────────

const DEFAULT_PACE: Record<string, number> = { warmup: 315, active: 285, interval: 230, recovery: 330, cooldown: 320, rest: 0 };

/** Seconds a step takes, for drawing only: distance at its pace, a lap press as a guess. */
export function chartSeconds(s: WorkoutStep): number {
  if (s.durationType === 'time') return s.durationValue || 60;
  if (s.durationType === 'distance') return ((s.durationValue || 400) / 1000) * (s.targetPaceMinPerKm || DEFAULT_PACE[s.type] || 300);
  return s.type === 'rest' || s.type === 'recovery' ? 60 : 120;
}

/** Bar height 0..1: a rest sits low, an interval with no pace stands tall, otherwise by pace. */
export function chartIntensity(s: WorkoutStep): number {
  if (s.type === 'rest') return 0.16;
  if (s.type === 'recovery') return 0.28;
  if (!s.targetPaceMinPerKm) return s.type === 'interval' ? 0.92 : s.type === 'warmup' ? 0.4 : 0.55;
  return Math.max(0.25, Math.min(1, (380 - s.targetPaceMinPerKm) / (380 - 200)));
}

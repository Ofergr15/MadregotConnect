import type { WorkoutStep } from '@/lib/ai/types';
import { stepDurationSec } from '@/lib/workout-duration';

// ═════════════════════════════════════════════════════════════════════════════
// A SESSION AT A GLANCE — the structure strip and each pack's pace, for the
// feed's "next session" card (feed redesign 2026-10-12: warm-up, the main block,
// strides/reps, cool-down, as bars whose width is time and height is effort, the
// way Garmin and TrainingPeaks draw a workout).
// ═════════════════════════════════════════════════════════════════════════════

export type SegmentKind = 'warm' | 'easy' | 'hard' | 'rest' | 'cool';
export interface ProfileSegment { kind: SegmentKind; share: number }

const HARD_ZONES = new Set(['threshold', 'interval', 'tempo', 'sprint', 'marathon_pace']);

/** Repeats unrolled, in order. */
export function flatSteps(steps: WorkoutStep[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const s of steps || []) {
    if (s.repeatSteps?.length && (s.repeatCount ?? 0) > 0) {
      for (let i = 0; i < Math.min(s.repeatCount!, 40); i++) out.push(...flatSteps(s.repeatSteps));
    } else out.push(s);
  }
  return out;
}

function kindOf(s: WorkoutStep): SegmentKind {
  if (s.type === 'warmup') return 'warm';
  if (s.type === 'cooldown') return 'cool';
  if (s.type === 'rest' || s.type === 'recovery') return 'rest';
  if (s.type === 'interval') return 'hard';
  return s.targetZone && HARD_ZONES.has(s.targetZone) ? 'hard' : 'easy';
}

/** Width = share of the session's time. Adjacent same-kind steps merged; empty → []. */
export function profileSegments(steps: WorkoutStep[]): ProfileSegment[] {
  const flat = flatSteps(steps).map((s) => ({ kind: kindOf(s), sec: Math.max(stepDurationSec(s), 0) }));
  const total = flat.reduce((a, s) => a + s.sec, 0);
  if (!total) return [];
  const merged: Array<{ kind: SegmentKind; sec: number }> = [];
  for (const s of flat) {
    const last = merged[merged.length - 1];
    // Reps stay separate bars (that is the shape people recognise); the rest merges.
    if (last && last.kind === s.kind && s.kind !== 'hard' && s.kind !== 'rest') last.sec += s.sec;
    else merged.push({ ...s });
  }
  return merged.filter((s) => s.sec > 0).map((s) => ({ kind: s.kind, share: s.sec / total }));
}

export interface PaceRange { min: number; max: number }

/** The main block's pace for pack `index` (0..2): the longest paced non-warm-up step. */
export function packPace(steps: WorkoutStep[], index: number): PaceRange | null {
  let best: { sec: number; pace: PaceRange } | null = null;
  for (const s of flatSteps(steps)) {
    if (s.type === 'warmup' || s.type === 'cooldown' || s.type === 'rest' || s.type === 'recovery') continue;
    const p = index === 0
      ? (s.targetPaceMinPerKm && s.targetPaceMaxPerKm ? { min: s.targetPaceMinPerKm, max: s.targetPaceMaxPerKm } : null)
      : index === 1 ? (s.group2Pace ?? null) : (s.group3Pace ?? null);
    if (!p || !p.min || !p.max) continue;
    const sec = stepDurationSec(s);
    if (!best || sec > best.sec) best = { sec, pace: { min: Math.min(p.min, p.max), max: Math.max(p.min, p.max) } };
  }
  return best?.pace ?? null;
}

export const clockPace = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
export const paceRangeText = (p: PaceRange) => (p.min === p.max ? clockPace(p.min) : `${clockPace(p.min)}–${clockPace(p.max)}`);

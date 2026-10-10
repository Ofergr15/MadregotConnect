// ── "מה יגיע לשעון" — the send sheet's last look before a week goes out ─────────────
//
// The coach saw which DAYS were going and the push line, never the workout itself,
// so week 11.10's hills went to a watch with the between-sets rest inside the 3×
// block — played after every set — and nothing on the sheet could have shown it.
//
// The preview is built from the same pieces the send uses, so it cannot drift from
// what the watch gets: the pack copy being sent, `withGroupPaces` against the plan's
// three copies (what both push routes do), and `buildStepDescription` for the text
// under each step (what the Garmin converter and the Apple serializer print).

import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { buildStepDescription } from '@/lib/garmin/converter';
import { withGroupPaces } from '@/lib/plans/watch-paces';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';

export interface PreviewLine {
  type: WorkoutStep['type'];
  /** "15:00", "0:30", "1.2 ק״מ", "400 מ׳", or null for a lap-button step. */
  duration: string | null;
  /** What the watch prints on the step's screen. */
  text?: string;
}

export interface PreviewRepeat { repeat: number; lines: PreviewLine[] }
export type PreviewItem = PreviewLine | PreviewRepeat;

export type PreviewHint = { kind: 'restEndsRepeat'; seconds: number; repeat: number };

const pad = (n: number) => n.toString().padStart(2, '0');
function duration(s: WorkoutStep): string | null {
  if (s.durationType === 'open') return null;
  const v = s.durationValue || 0;
  if (s.durationType === 'distance') return v >= 1000 ? `${+(v / 1000).toFixed(2)} ק״מ` : `${v} מ׳`;
  if (v >= 3600) return `${Math.floor(v / 3600)}:${pad(Math.floor((v % 3600) / 60))}:${pad(v % 60)}`;
  return `${Math.floor(v / 60)}:${pad(v % 60)}`;
}

const PROFILE = {} as Parameters<typeof buildStepDescription>[1];
const line = (s: WorkoutStep): PreviewLine => ({ type: s.type, duration: duration(s), text: buildStepDescription(s, PROFILE) });

/**
 * Each session exactly as it will be sent: normalized, then every pack's pace
 * attached — the same two steps, in the same order, as both push routes.
 */
export function previewSessions(sessions: ParsedWorkout[], grouped: unknown): ParsedWorkout[] {
  return withGroupPaces(normalizeWorkoutParts({ workouts: sessions }).workouts, grouped);
}

export function previewItems(w: ParsedWorkout): PreviewItem[] {
  return w.steps.map((s) =>
    s.repeatSteps?.length ? { repeat: s.repeatCount || 1, lines: s.repeatSteps.map(line) } : line(s),
  );
}

/**
 * What is worth a second look before sending. Today one thing: a long rest (2 min
 * or more) as the LAST step of a repeat runs after every set, including the last
 * one — almost always a "between sets" rest the parse put inside the block. A hint,
 * not a block: some coaches do mean it.
 */
export function previewHints(w: ParsedWorkout): PreviewHint[] {
  const out: PreviewHint[] = [];
  for (const s of w.steps) {
    const subs = s.repeatSteps;
    if (!subs?.length || (s.repeatCount || 1) < 2) continue;
    const last = subs[subs.length - 1];
    if (subs.length > 1 && last.type === 'rest' && last.durationType === 'time' && (last.durationValue || 0) >= 120) {
      out.push({ kind: 'restEndsRepeat', seconds: last.durationValue!, repeat: s.repeatCount! });
    }
  }
  return out;
}

export const isRepeatItem = (i: PreviewItem): i is PreviewRepeat => 'repeat' in i;

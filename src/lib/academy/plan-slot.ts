/**
 * A day in the composer's week, and what it becomes for ONE recipient.
 *
 * The composer pushes the same week to several trainees at once, and until the book existed
 * there was one way to make a trainee's copy: take the authored workout and shift every pace
 * by that trainee's band offset (`repaceWeek`). A book entry does not work that way. It stores
 * `92% מהסף` and nothing absolute, and the trainee's copy is derived from their OWN threshold
 * test — not from the author's paces, and not from anybody's offset.
 *
 * Mixing the two is where the bug would be. Resolve a book entry once, against the primary
 * trainee's threshold, drop the result into a slot, and the push loop then shifts those paces
 * again by each other recipient's offset: pace math applied twice, silently, and the second
 * trainee gets a session derived from the first trainee's test. `assertSlotsOnce` in the test
 * file is that exact scenario.
 *
 * So a slot remembers WHERE it came from, and materialisation happens per recipient:
 *
 *     written  →  repaced by that recipient's offset          (the existing mechanism)
 *     book     →  resolved from that recipient's own threshold (never repaced)
 *
 * Neither path ever touches the other's input, which is the property worth having: it holds
 * no matter how the two pace mechanisms are reconciled later.
 */

import type { ParsedWorkout } from '@/lib/ai/types';

import { resolveLibraryWorkout, type LibraryEntry } from './library';
import { repaceWeek } from './repace';

/** What a slot has to keep of a book entry: enough to resolve it, and its id to mark used. */
export type SlotEntry = Pick<LibraryEntry, 'id' | 'name' | 'notes' | 'steps'>;

export type PlanSlot =
  /** Written in the composer, or imported — it already holds absolute paces. */
  | { source: 'written'; workout: ParsedWorkout }
  /** Picked from the book — it holds no paces at all until a recipient is named. */
  | { source: 'book'; entry: SlotEntry };

/** What the week needs to know about one trainee to make their copy of it. */
export interface Recipient {
  athleteId: string;
  /** The trainee's display name, so a refusal can say whose test is missing. */
  name: string;
  /** `effectiveOffsetSec(athlete.paceOffsetSec, band)`. Feeds WRITTEN slots only. */
  offsetSec: number | null;
  /** `thresholdPaceSec(latestUsable(tests))`. Feeds BOOK slots only. */
  thresholdPaceSec: number | null;
}

/** A book slot that cannot be pushed to this recipient, and why. */
export interface SkippedSlot {
  dayOfWeek: number;
  entryId: string;
  name: string;
  /** 92% of nothing is not a pace — see `resolveLibraryWorkout`. */
  reason: 'no-test';
}

export interface MaterialisedWeek {
  athleteId: string;
  workouts: ParsedWorkout[];
  /** Book days dropped for this recipient. The coach is shown these BEFORE the push. */
  skipped: SkippedSlot[];
  /**
   * Whether the watch should alarm on pace.
   *
   * Only when every workout in this push carries paces derived from this trainee's own
   * numbers. One written slot with no offset turns it off for the whole week, which is the
   * existing granularity — `paceAlerts` is a per-push flag, not a per-workout one — and the
   * safe direction: an alarm set to somebody else's pace is worse than no alarm.
   */
  paceAlerts: boolean;
}

/** The slots in day order, which is the order a week is read and pushed in. */
function inDayOrder(slots: Record<number, PlanSlot | undefined>): [number, PlanSlot][] {
  return Object.entries(slots)
    .filter((pair): pair is [string, PlanSlot] => pair[1] !== undefined)
    .map(([day, slot]): [number, PlanSlot] => [Number(day), slot])
    .sort((a, b) => a[0] - b[0]);
}

/**
 * One week of slots → one week of real workouts for one recipient.
 *
 * `dayOfWeek` comes from the slot key rather than from the workout inside it, so moving a
 * workout between days cannot leave it claiming the day it was authored on.
 */
export function materialiseWeek(
  slots: Record<number, PlanSlot | undefined>,
  recipient: Recipient,
): MaterialisedWeek {
  const workouts: ParsedWorkout[] = [];
  const skipped: SkippedSlot[] = [];
  let everyPaceIsTheirs = true;

  for (const [dayOfWeek, slot] of inDayOrder(slots)) {
    if (slot.source === 'book') {
      const resolved = resolveLibraryWorkout(slot.entry, {
        thresholdPaceSec: recipient.thresholdPaceSec,
        dayOfWeek,
      });
      if (!resolved) {
        // Dropped, not degraded. The structure could be pushed with no targets, but that is
        // a third state — a session the coach believes has paces and does not — and the
        // academy's premise is that the pace comes from the test. The coach's move is to
        // send them to run one, so the refusal names them.
        skipped.push({ dayOfWeek, entryId: slot.entry.id, name: slot.entry.name, reason: 'no-test' });
        continue;
      }
      workouts.push(resolved);
      continue;
    }

    // NOT resolved, NOT touched by the threshold: a written workout's paces are the author's,
    // and the offset is the only thing that makes them this trainee's.
    const [repaced] = repaceWeek([{ ...slot.workout, dayOfWeek }], recipient.offsetSec);
    workouts.push(repaced);
    if (recipient.offsetSec === null) everyPaceIsTheirs = false;
  }

  return {
    athleteId: recipient.athleteId,
    workouts,
    skipped,
    paceAlerts: everyPaceIsTheirs && skipped.length === 0 && workouts.length > 0,
  };
}

/**
 * The book entries this week uses, for `PATCH /api/academy/library { action: 'used' }`.
 *
 * De-duplicated, because an entry pushed twice in one week is still one week of use — the
 * count answers "is this session part of how the academy trains", and a coach who puts the
 * same tempo on Tuesday and Thursday has not doubled that answer.
 */
export function bookEntryIds(slots: Record<number, PlanSlot | undefined>): string[] {
  const ids = new Set<string>();
  for (const [, slot] of inDayOrder(slots)) {
    if (slot.source === 'book') ids.add(slot.entry.id);
  }
  return [...ids];
}

/**
 * Whether a recipient can receive this week at all, and what is missing.
 *
 * The composer needs this BEFORE the push, on a list of trainees, to grey the ones it cannot
 * serve — which is why it does not just call `materialiseWeek` and look at `skipped`: a week
 * of nothing but book entries against a trainee with no test would push an empty plan.
 */
export function weekGaps(
  slots: Record<number, PlanSlot | undefined>,
  recipient: Recipient,
): { needsTest: boolean; needsBand: boolean; empty: boolean } {
  const entries = inDayOrder(slots);
  const hasBook = entries.some(([, s]) => s.source === 'book');
  const hasWritten = entries.some(([, s]) => s.source === 'written');
  const needsTest = hasBook && !(recipient.thresholdPaceSec !== null && recipient.thresholdPaceSec > 0);
  return {
    needsTest,
    // Not a blocker: a written week with no offset pushes the author's paces with the watch
    // alarms off, which is what it did before the book existed.
    needsBand: hasWritten && recipient.offsetSec === null,
    empty: entries.length === 0 || (needsTest && !hasWritten),
  };
}

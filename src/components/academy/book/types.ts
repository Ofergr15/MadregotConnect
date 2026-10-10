import type { ParsedWorkout } from '@/lib/ai/types';
import type { LibraryKind, LibraryStep } from '@/lib/academy/library';
import type { BookStep } from '@/lib/academy/book-steps';
import type { SeniorPick } from '@/lib/academy/senior-pick';
import type { Lane } from '@/lib/academy/group-lane';
import type { PaceAdjust } from '@/lib/academy/pace-kinds';

/** GET /api/academy/day-plan */
export interface DayPlanData {
  date: string;
  weekStart: string;
  dayOfWeek: number;
  trainee: {
    id: string;
    name: string;
    bandNumber: number | null;
    lane: Lane;
    bandLane: Lane | null;
    thresholdSec: number | null;
    /** The coach's pace update in force that week (`{}` = none). Every pace drawn goes through it. */
    paceAdjust?: PaceAdjust;
    hasGarmin: boolean;
  };
  lanesDiffer: boolean;
  hasClubWeek: boolean;
  senior: SeniorPick;
  existing: ParsedWorkout[];
  others: Array<{ id: string; name: string; thresholdSec: number | null; paceAdjust?: PaceAdjust; hasGarmin: boolean; lane: Lane | null; busy: boolean }>;
}

/** The workout on its way from a source to the watch. */
export interface Draft {
  source: 'senior' | 'book' | 'quick';
  name: string;
  notes: string | null;
  /** The book entry it came from, for the use count. Null for anything else. */
  entryId: string | null;
  kind: LibraryKind;
  /** As it came from its source — what "↺ כמו בתוכנית" goes back to. */
  original: BookStep[] | null;
  /** The editable model; null when the source is richer than the adjust screen draws. */
  model: BookStep[] | null;
  /** The stored shape, used as-is when there is no model. */
  steps: LibraryStep[];
}

export interface SendResult {
  athleteId: string;
  name: string;
  status: 'sent' | 'saved' | 'skipped' | 'failed';
  reason?: string;
  detail?: string | null;
}

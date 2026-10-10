/** The payloads of the coach-tools routes, shared by the routes and the screens. */

import type { ParsedWorkout } from '@/lib/ai/types';
import type {
  KindEvidence, MissedOption, NoteReason, PaceAdjust, PaceKind, WeekSession,
} from './coach-tools';

export interface PaceSuggestionPayload {
  key: string;
  athleteId: string;
  name: string;
  basisTestDate: string;
  kinds: KindEvidence[];
  current: Partial<Record<PaceKind, number>>;
}

export interface MissedPayload {
  key: string;
  athleteId: string;
  name: string;
  /** The missed week, and the week the decision changes. */
  weekStart: string;
  targetWeek: string;
  rule: 'week' | 'long';
  missed: number;
  planned: number;
  sessions: WeekSession[];
  note: { text: string; at: string; reason: NoteReason | null } | null;
  preselect: MissedOption;
  /** Planned km of the target week as it stands (null = it is empty). */
  targetKm: number | null;
  /** Km of the light version. */
  lightKm: number | null;
  /** Km of the missed week (what "repeat" would plan). */
  missedKm: number | null;
}

export interface EmptyNextPayload {
  key: string;
  weekStart: string;
  trainees: Array<{ id: string; name: string }>;
  /** Whose week the copy screen opens on. */
  sourceId: string | null;
}

export interface TraineeStrip {
  athleteId: string;
  name: string;
  planned: number;
  done: number;
  colors: WeekSession['color'][];
}

export interface CoachToolsResponse {
  today: string;
  thisWeek: string;
  nextWeek: string;
  /** Migration 139 is there: decisions are recorded and the card shows. */
  stored: boolean;
  pace: PaceSuggestionPayload[];
  missed: MissedPayload[];
  emptyNext: EmptyNextPayload | null;
  strips: TraineeStrip[];
}

export interface PaceUpdateResponse {
  ok: boolean;
  stored: boolean;
  action: 'apply' | 'half' | 'snooze';
  changes?: PaceAdjust;
  fromWeek?: string;
  weeks?: string[];
  sent?: number;
  error?: string;
}

export interface CopyWeekCandidate {
  id: string;
  name: string;
  thresholdSec: number | null;
  adjust: PaceAdjust;
  existing: Record<string, number>;
  hasGarmin: boolean;
}

export interface CopyWeekSource {
  weekStart: string;
  thresholdSec: number | null;
  workouts: ParsedWorkout[];
}

export interface CopyWeekResponse {
  source: CopyWeekSource & { id: string; name: string };
  candidates: CopyWeekCandidate[];
  /** The next four plan weeks after the source week. */
  weeks: string[];
  today: string;
}

/** The trainee card: "<coach> עדכן את הקצבים שלך". */
export interface PaceUpdateCard {
  coachName: string | null;
  createdAt: string;
  fromWeek: string;
  direction: 'faster' | 'slower';
  /** "4 מ־5 האחרונים" of the kind that moved most. */
  moved: number;
  of: number;
  kinds: Array<{ kind: PaceKind; fromSec: number; toSec: number }>;
}

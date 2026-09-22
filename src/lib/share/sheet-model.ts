import {
  availableWorkoutMetrics, hasRouteTrace, workoutMetricStat,
  type ShareI18n, type ShareTemplate, type WorkoutMetricKey,
} from '@/lib/feed/share-image';
import {
  WEEK_CARD_TEXT, availableMetrics, type WeekMetricKey,
} from '@/lib/reports/week-share';
import type { ShareCardLang } from './card-text';
import type { FeedItem } from '@/lib/feed/project';
import type { Last7Report } from '@/lib/reports/last-7-days';

/**
 * ONE SHARE SHEET. TWO KINDS OF CARD.
 *
 * The workout card and the weekly card were two screens. They already shared the
 * canvas renderer — `lib/reports/week-share-image.ts` imports its primitives from
 * `lib/feed/share-image.ts` — and what they did not share was the sheet, which is
 * the only reason the card-language toggle and "add my own photo" existed on one
 * and not the other. This file is the part of the merge that is pure: what the
 * frames are, which of them this subject can actually draw, and what the chips say.
 *
 * ── THE FOUR CONTROLS, IN THE ORDER YOU ACTUALLY DECIDE ─────────────────────
 *   1. frame    — photo / route / numbers
 *   2. content  — which numbers go on it
 *   3. wording  — the card's language, and whether it carries a name
 *   4. photo    — add my own
 *
 * ── AND THE ONE RULE FOR EVERY IMPOSSIBLE OPTION ────────────────────────────
 * Grey it and say why, in one line. Never hide it. The old workout rail removed
 * three of its ten views when a run had no GPS, so the same sheet offered a
 * different set of unlabelled choices each time and there was no way to tell a
 * limit from a bug. That is what `reason` on every option below is for.
 */

export type ShareFrame = 'photo' | 'route' | 'numbers';

export const SHARE_FRAMES: ShareFrame[] = ['photo', 'route', 'numbers'];

/**
 * Which of the ten workout templates each frame draws.
 *
 * The other seven are not deleted — an accent, a sticker and a route are all still
 * reachable — but the sheet no longer offers a rail of ten names, because the
 * frame is the only one of those choices that cannot be derived from a chip.
 * `fullStats` is the numbers frame rather than `bigNumbers` for one reason:
 * `bigNumbers` draws the route, so it would have to grey out with the route frame.
 */
export const FRAME_TEMPLATE: Record<ShareFrame, ShareTemplate> = {
  photo: 'photo',
  route: 'route',
  numbers: 'fullStats',
};

export type ShareSubject =
  | { kind: 'workout'; item: FeedItem }
  | { kind: 'week'; report: Last7Report; athleteName?: string | null };

export interface FrameOption {
  key: ShareFrame;
  available: boolean;
  /** Message key for the one-line reason, when this frame cannot be drawn. */
  reason?: 'noRoute' | 'noWeekRoute';
}

export interface ShareChip {
  key: string;
  /** The label as the CARD prints it, not a second copy of it in the UI. */
  label: string;
  value: string;
  /**
   * Kept apart from `value` rather than concatenated, the same way the canvas keeps
   * them apart: "22.37 ק״מ" is a mixed-direction string, and in the DOM it needs a
   * `<bdi>` around the number for the same reason the card needs two fillTexts.
   */
  unit?: string;
}

/** The frames this subject can draw, always all three, some of them greyed. */
export function shareFrames(subject: ShareSubject): FrameOption[] {
  if (subject.kind === 'week') {
    return [
      { key: 'photo', available: true },
      // Not "no route" — a week HAS routes, it just has no single one.
      { key: 'route', available: false, reason: 'noWeekRoute' },
      { key: 'numbers', available: true },
    ];
  }
  const act = subject.item.activity;
  const routed = !!act && hasRouteTrace(act);
  return [
    { key: 'photo', available: true },
    { key: 'route', available: routed, reason: routed ? undefined : 'noRoute' },
    { key: 'numbers', available: true },
  ];
}

/**
 * What the sheet opens on.
 *
 * A run with GPS opens on its own shape, which is what the ten-view rail defaulted
 * to as well. Without GPS it opens on the numbers rather than on the photo frame:
 * the photo frame over our fallback gradient is the emptiest card in the set, and a
 * treadmill run's numbers are the whole of what it has. The week opens on numbers
 * because the weekly card has never put a photo behind itself unasked.
 */
export function defaultFrame(subject: ShareSubject): ShareFrame {
  const frames = shareFrames(subject);
  if (subject.kind === 'workout' && frames.find(f => f.key === 'route')?.available) return 'route';
  return 'numbers';
}

/**
 * HOW MANY numbers this frame can print.
 *
 * A property of the frame, not a preference: the row layouts are built for three
 * columns across the story and `fullStats` for a grid of six. The renderer slices
 * to the same figures (`pickedStats`), so this is the sheet knowing the limit in
 * time to stop offering a fourth chip instead of dropping it silently.
 *
 * The weekly card draws one ROW per metric and grows downward, so its own limit is
 * simply how many metrics exist.
 */
export function frameCapacity(subject: ShareSubject, frame: ShareFrame): number {
  if (subject.kind === 'week') return availableMetrics(subject.report).length;
  return frame === 'numbers' ? 6 : 3;
}

/** The numbers this subject can print at all, in card order. */
export function availableChipKeys(subject: ShareSubject): string[] {
  return subject.kind === 'week'
    ? availableMetrics(subject.report).map(m => m.key)
    : availableWorkoutMetrics(subject.item.activity!);
}

/**
 * The chips, with the real value beside the label.
 *
 * This is the single thing that made the weekly sheet work and the workout rail
 * not: you are choosing between `94 מ׳` and `153`, not between two abstract words.
 * Both sides read the card's OWN text table, so a chip cannot disagree with the
 * card it is describing — the bug this feature can least afford.
 */
export function shareChips(subject: ShareSubject, i18n: ShareI18n, lang: ShareCardLang): ShareChip[] {
  if (subject.kind === 'week') {
    const labels = WEEK_CARD_TEXT[lang].labels;
    return availableMetrics(subject.report).map(m => ({
      key: m.key,
      label: labels[m.key],
      value: m.total(subject.report),
    }));
  }
  const act = subject.item.activity!;
  return availableWorkoutMetrics(act).flatMap(key => {
    const stat = workoutMetricStat(act, i18n, key);
    return stat ? [{ key, label: stat.label, value: stat.value, unit: stat.unit }] : [];
  });
}

/** What the content row opens with: as much as the frame can print, in card order. */
export function defaultChipKeys(subject: ShareSubject, frame: ShareFrame): string[] {
  return availableChipKeys(subject).slice(0, frameCapacity(subject, frame));
}

/**
 * Turning a chip on or off.
 *
 * Two rules, both of which used to live in the weekly sheet alone. The last chip
 * cannot be turned off — an empty panel is not a share, it is a bug that looks like
 * one. And a chip beyond the frame's capacity cannot be turned on, which is why
 * the sheet disables it with a line saying so rather than accepting the tap and
 * then not drawing it.
 */
export function toggleChip(keys: string[], key: string, capacity: number): string[] {
  if (keys.includes(key)) return keys.length === 1 ? keys : keys.filter(k => k !== key);
  return keys.length >= capacity ? keys : [...keys, key];
}

/** Trim a selection to what a newly chosen frame can print, keeping card order. */
export function fitChipKeys(subject: ShareSubject, frame: ShareFrame, keys: string[]): string[] {
  const order = availableChipKeys(subject);
  const kept = order.filter(k => keys.includes(k)).slice(0, frameCapacity(subject, frame));
  // Never empty: a frame change must not be able to produce a blank card.
  return kept.length ? kept : defaultChipKeys(subject, frame);
}

/** Typed hand-off to each renderer, so neither one takes a string it can't use. */
export function asWorkoutMetrics(keys: string[]): WorkoutMetricKey[] {
  return keys as WorkoutMetricKey[];
}

export function asWeekMetrics(keys: string[]): WeekMetricKey[] {
  return keys as WeekMetricKey[];
}

/** The filename the OS share sheet offers, and the download fallback saves. */
export function shareFilename(subject: ShareSubject, transparent: boolean): string {
  if (subject.kind === 'week') return `madregot-week-${subject.report.to}.jpg`;
  return `madregot-${subject.item.id.slice(0, 8)}.${transparent ? 'png' : 'jpg'}`;
}

import {
  STICKER_TEMPLATE_KEYS, availableWorkoutMetrics, hasRouteTrace, paceBandCount, requiresRoute, requiresSplits, supportsFooter,
  workoutMetricStat,
  type ShareBrand, type ShareI18n, type ShareTemplate, type ShareVerdict, type SplitMode, type WorkoutMetricKey,
} from '@/lib/feed/share-image';
import {
  WEEK_CARD_TEXT, availableMetrics, type WeekMetricKey,
} from '@/lib/reports/week-share';
import { DIRECTION_COLOR } from '@/lib/plan-execution/verdict';
import { VERDICT_TEXT, type ShareCardLang } from './card-text';
import type { FeedItem } from '@/lib/feed/project';
import type { Last7Report, WellnessNight } from '@/lib/reports/last-7-days';

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

/*
 * ── THE TEN, BACK ON THE WORKOUT SHEET ──────────────────────────────────────
 * The frame row above cost the workout card seven of its ten views: the gallery
 * the athlete was shown had ten, and the sheet they got could reach three. The
 * frame stays for the WEEK, whose renderer really does have only a photo and a
 * numbers panel. A workout picks a view, and everything the frame used to decide
 * — how many numbers, whether a photo, a line colour or a footer fits — is read
 * off the view instead.
 */

/*
 * ── SIX, NOT ELEVEN ─────────────────────────────────────────────────────────
 * Ten views plus the new kilometre list was "too much" on one screen. The six he
 * kept are below; the other five are folded in rather than lost where they had a
 * real job: `routeOnly` is the route view's "route only" switch, and `photo` is
 * what the stats bar draws over the athlete's own picture (`drawnTemplate`).
 * `bigNumbers`, `fullStats` and `sideBySide` are still drawn by the renderer, and
 * the week still uses `fullStats`, but a workout no longer offers them.
 */

/** Grid order, three by two: the two new-style views first, then the originals. */
export const WORKOUT_TEMPLATES: ShareTemplate[] = [
  'splits', 'route', 'statsBar', 'classic', 'card', 'minimal',
];

/**
 * What the renderer draws for a chosen view. The sheet's view is a choice of LOOK;
 * two of those looks have a variant that is a different template underneath.
 */
export function drawnTemplate(
  view: ShareTemplate,
  opts: { routeOnly?: boolean; withPhoto?: boolean },
): ShareTemplate {
  if (view === 'route' && opts.routeOnly) return 'routeOnly';
  if (view === 'statsBar' && opts.withPhoto) return 'photo';
  return view;
}

/**
 * Each view's own logo — what the renderer draws when the athlete picks none, and
 * what the sheet's logo picker marks as "the view's own". Picking a logo is per
 * share and per view: switching views goes back to the new view's own.
 */
export function viewBrand(view: ShareTemplate): ShareBrand {
  if (view === 'splits') return 'stairs';
  if (view === 'classic' || view === 'card' || view === 'minimal') return 'badge';
  return 'wordmark';
}

/** Whether the KM Splits view can chart laps instead of kilometres for this run. */
export function canSegment(subject: ShareSubject): boolean {
  return subject.kind === 'workout' && (subject.item.activity?.lapBands?.length ?? 0) >= 2;
}

/** Whether the run was driven by a workout on the watch, so it can be charted step by step. */
export function canPlanSplit(subject: ShareSubject): boolean {
  return subject.kind === 'workout' && (subject.item.activity?.stepBands?.length ?? 0) >= 2;
}

/**
 * What the chart opens on: the workout's own steps when the watch ran one — the same
 * session then shares the same way whatever each athlete's auto-lap was set to —
 * else the laps, else the kilometres.
 */
export function defaultSplitMode(subject: ShareSubject): SplitMode {
  return canPlanSplit(subject) ? 'blocks' : canSegment(subject) ? 'segments' : 'km';
}

/**
 * The chart's choices for this run, in the order the control shows them. A run the
 * watch drove gets the workout two ways and the kilometres; its laps are the same
 * steps cut worse, so they are not offered as a fourth. Fewer than two: no control.
 */
export function splitModes(subject: ShareSubject): SplitMode[] {
  if (canPlanSplit(subject)) return ['blocks', 'full', 'km'];
  if (canSegment(subject)) return ['segments', 'km'];
  return ['km'];
}

/** Whether any step of the run carries a target to show under its pace. */
export function hasTargets(subject: ShareSubject): boolean {
  return subject.kind === 'workout' && !!subject.item.activity?.stepBands?.some(s => s.target != null);
}

/** Whether the segments chart has heart rate to draw behind its bars. */
export function canHrLine(subject: ShareSubject): boolean {
  if (subject.kind !== 'workout') return false;
  const act = subject.item.activity;
  const withHr = (bands: Array<{ hr?: number }> | null | undefined) => (bands ?? []).filter(l => l.hr != null).length >= 2;
  return (canSegment(subject) && withHr(act?.lapBands)) || (canPlanSplit(subject) && withHr(act?.stepBands));
}

/** Either a frame or a view; `numbers` is the one frame name that is not a view. */
export type ShareLook = ShareFrame | ShareTemplate;

export function lookTemplate(look: ShareLook): ShareTemplate {
  return look === 'numbers' ? FRAME_TEMPLATE.numbers : look;
}

export interface TemplateOption {
  key: ShareTemplate;
  available: boolean;
  reason?: 'noRoute' | 'noSplits';
}

/** All six, always, in grid order — the ones a run cannot draw greyed with why. */
export function shareTemplates(subject: ShareSubject): TemplateOption[] {
  return gate(subject, WORKOUT_TEMPLATES);
}

/**
 * The six stickers, the editor's second row of looks: always transparent, so no
 * background to choose. Without GPS the three built on the route are greyed.
 */
export function shareStickers(subject: ShareSubject): TemplateOption[] {
  return gate(subject, STICKER_TEMPLATE_KEYS);
}

function gate(subject: ShareSubject, keys: ShareTemplate[]): TemplateOption[] {
  const act = subject.kind === 'workout' ? subject.item.activity : null;
  const routed = !!act && hasRouteTrace(act);
  const split = !!act && paceBandCount(act) >= 2;
  return keys.map(key => {
    if (requiresRoute(key) && !routed) return { key, available: false, reason: 'noRoute' };
    if (requiresSplits(key) && !split) return { key, available: false, reason: 'noSplits' };
    return { key, available: true };
  });
}

/**
 * The views whose numbers are not the athlete's to choose.
 *
 * `routeOnly` prints none at all; the three originals print the fixed set they
 * always printed (`secondaryStats`). The chip row stays visible on these and goes
 * grey with one line, and the selection is kept, so tapping back to a view that
 * does read the chips finds them as they were left.
 */
const FIXED_NUMBERS: Partial<Record<ShareTemplate, 'noNumbers' | 'fixedNumbers' | 'splitsNumbers'>> = {
  routeOnly: 'noNumbers',
  stickerRouteBadge: 'noNumbers',
  splits: 'splitsNumbers',
  classic: 'fixedNumbers',
  card: 'fixedNumbers',
  minimal: 'fixedNumbers',
};

export function fixedNumbersReason(
  subject: ShareSubject,
  look: ShareLook,
): 'noNumbers' | 'fixedNumbers' | 'splitsNumbers' | undefined {
  return subject.kind === 'workout' ? FIXED_NUMBERS[lookTemplate(look)] : undefined;
}

/**
 * Where the line colour means anything: the views that draw the run's line, plus
 * `sideBySide`, whose stairs mark stands in for it. The two originals draw a route
 * only when there is one, so without GPS the swatch would change nothing.
 */
export function supportsAccent(subject: ShareSubject, look: ShareLook): boolean {
  if (subject.kind !== 'workout') return false;
  const t = lookTemplate(look);
  if (t === 'route' || t === 'routeOnly' || t === 'bigNumbers' || t === 'sideBySide' || t === 'splits'
    || t === 'stickerRail' || t === 'stickerRouteStack' || t === 'stickerRouteBadge') {
    return true;
  }
  const act = subject.item.activity;
  return (t === 'classic' || t === 'card') && !!act && hasRouteTrace(act);
}

/**
 * What the sheet opens on: a workout on its own shape when it has one, then its
 * kilometres, then the stats bar, which every run can draw. The week keeps
 * `defaultFrame`, since it still picks a frame rather than a view.
 */
export function defaultTemplate(subject: ShareSubject): ShareTemplate {
  if (subject.kind === 'week') return FRAME_TEMPLATE[defaultFrame(subject)];
  const ok = new Set(shareTemplates(subject).filter(v => v.available).map(v => v.key));
  // A session the watch ran opens on its blocks: that is what it is shared for, and
  // the chart is where the session's shape is (2026-10-16).
  if (ok.has('splits') && canPlanSplit(subject)) return 'splits';
  return ok.has('route') ? 'route' : ok.has('splits') ? 'splits' : 'statsBar';
}

export type ShareSubject =
  | { kind: 'workout'; item: FeedItem }
  | {
    kind: 'week'; report: Last7Report; athleteName?: string | null;
    /** The week before and the nights, for the weekly story editor's body look and sleep strip. */
    previous?: Last7Report | null; nights?: WellnessNight[];
  };

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
 * columns across the story (two rows of them on photo, route and the stats bar)
 * and `fullStats` for a grid of six. The renderer slices
 * to the same figures (`pickedStats`), so this is the sheet knowing the limit in
 * time to stop offering a fourth chip instead of dropping it silently.
 *
 * The weekly card draws one ROW per metric and grows downward, so its own limit is
 * simply how many metrics exist.
 */
export function frameCapacity(subject: ShareSubject, frame: ShareLook): number {
  if (subject.kind === 'week') return availableMetrics(subject.report).length;
  const t = lookTemplate(frame);
  if (FIXED_NUMBERS[t]) return 0;
  if (STICKER_CAPACITY[t] != null) return STICKER_CAPACITY[t]!;
  return t === 'fullStats' || TWO_ROW_TEMPLATES.has(t) ? 6 : 3;
}

/**
 * The row views whose numbers can wrap to a second row of three (#116, Sahar's
 * "more than three"). The others keep three: `sideBySide` stacks them beside the
 * route, `bigNumbers` is three numbers by definition, the classic two have a fixed
 * row.
 */
const TWO_ROW_TEMPLATES = new Set<string>(['photo', 'route', 'statsBar']);

/** How many numbers each sticker has room for (the route-only one has none: FIXED_NUMBERS). */
const STICKER_CAPACITY: Partial<Record<ShareTemplate, number>> = {
  stickerRail: 3, stickerList: 6, stickerStack: 5, stickerRouteStack: 3, stickerPills: 6,
};

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

/**
 * What the content row opens with, in card order: as much as the frame can print —
 * except on the two-row views, which open on their one row of three exactly as
 * they always did; the second row is for whoever adds a fourth (#116).
 */
export function defaultChipKeys(subject: ShareSubject, frame: ShareLook): string[] {
  const capacity = frameCapacity(subject, frame);
  const opensWith = subject.kind === 'workout' && TWO_ROW_TEMPLATES.has(lookTemplate(frame)) ? 3 : capacity;
  // A view with fixed numbers still needs a selection to hand to the next one.
  return availableChipKeys(subject).slice(0, opensWith || 3);
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

/**
 * Trim a selection to what a newly chosen frame can print. The workout keeps the
 * athlete's own order (they drag it; see `workoutStats`); the week keeps card order.
 */
export function fitChipKeys(subject: ShareSubject, frame: ShareLook, keys: string[]): string[] {
  // A view that ignores the chips keeps them untouched rather than trimming to zero.
  if (frameCapacity(subject, frame) === 0) return keys;
  const order = availableChipKeys(subject);
  const ranked = subject.kind === 'workout' ? keys.filter(k => order.includes(k)) : order.filter(k => keys.includes(k));
  const kept = ranked.slice(0, frameCapacity(subject, frame));
  // Never empty: a frame change must not be able to produce a blank card.
  return kept.length ? kept : defaultChipKeys(subject, frame);
}

/*
 * ── THE TWO THINGS THAT ARE NOT NUMBERS ─────────────────────────────────────
 * The bars and the verdict. They sit in the content row with the number chips and
 * they are deliberately NOT counted against `frameCapacity`: capacity is how many
 * COLUMNS the stat row has, and neither of these is a column. Turning the bars on
 * must not cost the athlete their heart rate.
 */

export type ShareExtraKey = 'bars' | 'verdict';

export interface ShareExtraOption {
  key: ShareExtraKey;
  available: boolean;
  /** One-line reason, printed by the sheet, when this is offered but greyed. */
  reason?: 'noSplits' | 'needsNumbers';
  /**
   * Whether it starts on.
   *
   * The bars do over 3 km — they are the differentiator, they cost nothing to
   * compute from splits the run already carries, and under 3 km there is not enough
   * of a sequence to be a shape. The verdict NEVER does: somebody who missed the
   * range should not have to notice a default in order to keep that off a public
   * story.
   */
  defaultOn: boolean;
}

/** The frame with the vertical room for a footer — see `supportsFooter`. */
export const FOOTER_FRAME: ShareFrame = 'numbers';

/**
 * The extras this subject and this frame can draw.
 *
 * The verdict is ABSENT from the list, not greyed, when the session had no plan:
 * greying it would tell every athlete on every unplanned run that there is a
 * judgement they are missing out on, which is the opposite of what the option is
 * for. A run WITH a plan on the wrong frame is greyed, because that one is a limit
 * the athlete can lift with one tap on the frame row above.
 */
export function shareExtras(subject: ShareSubject, frame: ShareLook): ShareExtraOption[] {
  const roomy = supportsFooter(lookTemplate(frame));
  const out: ShareExtraOption[] = [];

  if (subject.kind === 'week') {
    // The weekly card's panel grows downward, so it has room on every frame.
    const has = subject.report.days.some(d => d.km > 0);
    out.push({ key: 'bars', available: has, defaultOn: false });
    return out;
  }

  const act = subject.item.activity!;
  const bands = paceBandCount(act) >= 2;
  out.push({
    key: 'bars',
    available: bands && roomy,
    reason: !bands ? 'noSplits' : roomy ? undefined : 'needsNumbers',
    defaultOn: act.distance >= 3000,
  });
  if (act.planVerdict) {
    out.push({
      key: 'verdict',
      available: roomy,
      reason: roomy ? undefined : 'needsNumbers',
      defaultOn: false,
    });
  }
  return out;
}

/**
 * Which extras start on.
 *
 * Read against `FOOTER_FRAME` rather than the frame the sheet opens on, because a
 * routed run opens on `route` — where no footer fits — and "the bars are on by
 * default over 3 km" has to survive the athlete tapping across to the numbers. The
 * intent is stored; whether it DRAWS is `shareExtras(subject, frame)`.
 */
export function defaultExtraKeys(subject: ShareSubject): ShareExtraKey[] {
  return shareExtras(subject, FOOTER_FRAME)
    .filter(e => e.available && e.defaultOn)
    .map(e => e.key);
}

/** On, and drawable on this frame. The sheet renders a greyed extra as off. */
export function extraOn(
  subject: ShareSubject,
  frame: ShareLook,
  keys: ShareExtraKey[],
  key: ShareExtraKey,
): boolean {
  if (!keys.includes(key)) return false;
  return !!shareExtras(subject, frame).find(e => e.key === key)?.available;
}

/**
 * The verdict as the card draws it: the direction's own words, its own colour.
 *
 * Null for anything but a workout with a plan — a week is not graded against one
 * plan, and a run with no plan has nothing to be right or wrong about.
 */
export function shareVerdict(subject: ShareSubject, lang: ShareCardLang): ShareVerdict | null {
  if (subject.kind !== 'workout') return null;
  const v = subject.item.activity?.planVerdict;
  if (!v) return null;
  return {
    text: VERDICT_TEXT[lang][v.direction],
    score: v.score,
    color: DIRECTION_COLOR[v.direction],
  };
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

import type { WorkoutStep } from '@/lib/ai/types';
import { joinGroupPaces, stepPaceTokens, type GroupPace } from '@/lib/garmin/pace';

/**
 * One session as the club posts it to Instagram — plain text, ready to paste.
 *
 * ── WHY TEXT AND NOT A CARD ─────────────────────────────────────────────────
 *
 * The club already has canvas share cards, and this is deliberately not one of
 * them. The thing being reproduced here is the story the club has actually been
 * posting for months: a white title band, the structure typed out line by line,
 * a white footer band with the time and the place. It is TYPE in a story, which
 * means what the app has to hand over is a string — the text tool does the
 * layout, and it is the tool the coach already uses.
 *
 * ── WHY IT IS IN ENGLISH WHEN THE APP IS HEBREW ─────────────────────────────
 *
 * Because madregot.club posts in English. The app's locale is about who is
 * reading the app; this string is about who is reading the story, and those are
 * different audiences. So the day names and the type names below are fixed rather
 * than taken from `useTranslations` — a Hebrew UI must still produce an English
 * story. They are a duplicate of `messages/en.json`, and a test pins them to it
 * so the duplication cannot quietly drift.
 *
 * ── WHAT IS DELIBERATELY LEFT OUT ───────────────────────────────────────────
 *
 * Step NOTES. The parse fills them with the coach's own Hebrew ("אינטרוול",
 * "התאוששות"), and a Hebrew word in the middle of an English story is the bidi
 * mess the club has never posted. A story line is a duration, a pace, and
 * nothing else — which is exactly what the posted ones are.
 *
 * Any name. It is the session, not somebody's session: the same story goes to
 * every group, which is the whole reason the three pace brackets exist.
 *
 * The TIME AND THE PLACE. The reference post carries "⏰06:00am 📍Madregot" and
 * the first build reproduced them from editable fields — his call to drop them:
 * "without the 6am madregot — only the training info". Nothing in the app knows
 * when or where a session meets, so every version of that line was either a guess
 * or a form to fill in, and the story's own text tool is where it gets typed.
 */

/** Sunday-first, matching `dayOfWeek` everywhere else in the plans code. */
const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** Keyed on `WeekSession.type`. Mirrors `activities.runType_*` in en.json. */
const TYPE_NAMES: Record<string, string> = {
  intervals: 'Intervals',
  long_run: 'Long Run',
  tempo: 'Tempo',
  fartlek: 'Fartlek',
  progressive: 'Progressive',
  easy: 'Easy',
  rest: 'Rest',
};

export interface StoryInput {
  /** 0 = Sunday. Out of range simply drops the day from the title. */
  dayOfWeek: number;
  /** `WeekSession.type`. An unknown type falls back to "Run". */
  type: string;
  /** The session distance, already rounded — "14", or "18–20". */
  km: string;
  steps: WorkoutStep[];
}

/**
 * `90sec`, `20min`, `400m`, `1km`, `40-50min`.
 *
 * Seconds stay seconds below two minutes because that is how the posted stories
 * read — `90sec` is the interval everybody in the club recognises, and `1:30`
 * next to a pace of `3:15` invites reading one as the other.
 */
function duration(step: WorkoutStep): string {
  const v = step.durationValue;
  if (!v) return '';
  if (step.durationType === 'distance') {
    return v >= 1000 && v % 1000 === 0 ? `${v / 1000}km` : `${v}m`;
  }
  if (step.durationType !== 'time') return '';
  const one = (s: number) => (s >= 120 && s % 60 === 0 ? `${s / 60}min` : `${s}sec`);
  const max = step.durationMaxValue;
  // A range the coach wrote as a range ("40-50 דק׳") stays one, with the unit
  // printed once: "40-50min", not "40min-50min".
  if (max && max > v && v % 60 === 0 && max % 60 === 0 && v >= 120) {
    return `${v / 60}-${max / 60}min`;
  }
  return one(v);
}

/**
 * The three pace tokens for a step, in club notation.
 *
 * Two shapes reach this: `group2Pace`/`group3Pace` hanging off the step (what the
 * parse writes) and a `groupPaces` array (what the weekly API sends the athlete's
 * screens). Both are read, because the whole point of a copy button inside the
 * detail sheet is that the text says what the sheet says.
 */
function paces(step: WorkoutStep): string {
  const arr = (step as { groupPaces?: Array<GroupPace | null> }).groupPaces;
  if (Array.isArray(arr)) {
    const [g1, g2, g3] = arr;
    if (g1) {
      return joinGroupPaces([
        g1.max && g1.max !== g1.min
          ? `${pace(g1.min)}–${pace(g1.max)}` : pace(g1.min),
        g2 ? (g2.max && g2.max !== g2.min ? `${pace(g2.min)}–${pace(g2.max)}` : pace(g2.min)) : '',
        g3 ? (g3.max && g3.max !== g3.min ? `${pace(g3.min)}–${pace(g3.max)}` : pace(g3.min)) : '',
      ]);
    }
  }
  return joinGroupPaces(stepPaceTokens(step));
}

function pace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/** `90sec @ 3:15 (3:25) ((3:35))`, or just `90sec` when there is no pace. */
function line(step: WorkoutStep): string {
  const d = duration(step);
  const p = paces(step);
  if (d && p) return `${d} @ ${p}`;
  return d || p;
}

export function workoutStoryText(input: StoryInput): string {
  const day = DAY_NAMES[input.dayOfWeek];
  const type = TYPE_NAMES[input.type] || 'Run';
  const title = [
    day ? `${day}'s ${type}` : type,
    input.km ? ` (${input.km}km)` : '',
    ':',
  ].join('');

  const body: string[] = [];
  let lastWasBlock = false;

  for (const step of input.steps || []) {
    if (step.repeatCount && step.repeatSteps?.length) {
      // A blank line between blocks, and only between them: the posted stories
      // use that gap as the whole visual structure of the workout.
      if (lastWasBlock) body.push('');
      body.push(`${step.repeatCount}x`);
      for (const sub of step.repeatSteps) {
        const l = line(sub);
        if (l) body.push(l);
      }
      lastWasBlock = true;
      continue;
    }

    if (step.type === 'warmup' || step.type === 'cooldown') {
      const label = step.type === 'warmup' ? 'Warm-up' : 'Cool-down';
      // Consecutive warmup steps are one warm-up: the parse splits a jog and some
      // drills into two rows, and the story has always named the phase once.
      if (body[body.length - 1] !== label) body.push(label);
      lastWasBlock = false;
      continue;
    }

    const l = line(step);
    if (l) body.push(l);
    lastWasBlock = false;
  }

  return [title, ...body].join('\n');
}

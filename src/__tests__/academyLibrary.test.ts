import { describe, expect, it } from 'vitest';

import {
  ZONE_INTENSITY,
  duplicateEntry,
  entryHeadline,
  entryVolume,
  entryShape,
  entryZones,
  filterLibrary,
  hasAbsolutePaces,
  intensityForZone,
  paceFromPct,
  resolveIntensity,
  resolveLibraryWorkout,
  type LibraryEntry,
  type LibraryStep,
} from '@/lib/academy/library';
import { MAX_PACE_SEC_PER_KM, MIN_PACE_SEC_PER_KM } from '@/lib/academy/repace';

// A 5:00/km threshold throughout, because it makes every expected pace readable by hand:
// 100% is 5:00, 92% is 5:26, 110% is 4:33.
const THRESHOLD = 300;

describe('a percentage of threshold resolves to a pace', () => {
  it('makes a number BELOW 100% slower, not faster', () => {
    // The defect this whole file is built around. `300 * 0.92` is 276 — a pace FASTER than
    // threshold — so a recovery run written as 92% would have been pushed to a beginner's
    // watch as something quicker than their race effort. The percentage is of speed.
    expect(paceFromPct(THRESHOLD, 92)).toBe(326);
    expect(paceFromPct(THRESHOLD, 92)).toBeGreaterThan(THRESHOLD);
  });

  it('makes a number above 100% faster', () => {
    expect(paceFromPct(THRESHOLD, 110)).toBe(273);
    expect(paceFromPct(THRESHOLD, 100)).toBe(THRESHOLD);
  });

  it('puts the faster end in min, whichever way the band is written', () => {
    // `targetPaceMinPerKm` is the FASTER limit — fewer seconds. A band resolved the other
    // way round builds a Garmin zone whose floor is above its ceiling.
    const forwards = resolveIntensity(THRESHOLD, { fastPct: 110, slowPct: 105 });
    expect(forwards.min).toBeLessThan(forwards.max);
    const backwards = resolveIntensity(THRESHOLD, { fastPct: 105, slowPct: 110 });
    expect(backwards).toEqual(forwards);
  });

  it('never produces a pace a watch should not be given', () => {
    // A 400% typo, or a threshold read off a units-slip test, would otherwise reach a
    // device as a pace-zone alarm nobody can hold.
    expect(paceFromPct(THRESHOLD, 400)).toBe(MIN_PACE_SEC_PER_KM);
    expect(paceFromPct(THRESHOLD, 5)).toBe(MAX_PACE_SEC_PER_KM);
    expect(paceFromPct(0, 100)).toBe(MAX_PACE_SEC_PER_KM);
  });

  it('orders the named efforts the way a coach would', () => {
    const at = (zone: string) => paceFromPct(THRESHOLD, ZONE_INTENSITY[zone].fastPct);
    expect(at('easy')).toBeGreaterThan(at('marathon_pace'));
    expect(at('marathon_pace')).toBeGreaterThan(at('threshold'));
    expect(at('threshold')).toBeGreaterThan(at('interval'));
    expect(at('interval')).toBeGreaterThan(at('sprint'));
  });

  it('knows the zone names the parser already produces, and no others', () => {
    expect(intensityForZone('threshold')).toEqual(ZONE_INTENSITY.threshold);
    expect(intensityForZone('vo2max')).toBeNull();
    expect(intensityForZone(undefined)).toBeNull();
  });
});

const INTERVALS: LibraryStep[] = [
  { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetZone: 'easy', intensity: ZONE_INTENSITY.easy },
  {
    order: 2, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 6,
    repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', durationValue: 800, targetType: 'pace', targetZone: 'interval', intensity: ZONE_INTENSITY.interval },
      { order: 2, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: '2:00 הליכה' },
    ],
  },
  { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 1500, targetType: 'pace', targetZone: 'easy', intensity: ZONE_INTENSITY.easy },
];

/** The mockup's `פירמידה בדופק סף` — a heart-rate session behind the usual easy jog. */
const HR_PYRAMID: LibraryStep[] = [
  { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetZone: 'easy', intensity: ZONE_INTENSITY.easy },
  { order: 2, type: 'active', durationType: 'time', durationValue: 1800, targetType: 'heart_rate', targetHrMinPct: 88, targetHrMaxPct: 93 },
];

describe('one entry, two trainees', () => {
  it('gives the same session different paces off each threshold', () => {
    const entry = { name: '6×800', notes: null, steps: INTERVALS };
    const fast = resolveLibraryWorkout(entry, { thresholdPaceSec: 240, dayOfWeek: 2 });
    const slow = resolveLibraryWorkout(entry, { thresholdPaceSec: 360, dayOfWeek: 2 });

    const repOf = (w: typeof fast) => w!.steps[1].repeatSteps![0].targetPaceMinPerKm;
    expect(repOf(fast)).toBe(218);
    expect(repOf(slow)).toBe(327);
    // The structure is identical — this is the mockup's דבוקה 4 and דבוקה 9 running the same
    // workout, which is the only reason one entry can serve the whole academy.
    expect(fast!.steps[1].repeatCount).toBe(6);
    expect(slow!.steps[1].repeatCount).toBe(6);
  });

  it('comes out as an ordinary ParsedWorkout the rest of the pipeline already reads', () => {
    const w = resolveLibraryWorkout(
      { name: 'טמפו 20 דקות', notes: 'רצוף, בלי הפסקות', steps: INTERVALS },
      { thresholdPaceSec: THRESHOLD, dayOfWeek: 4 },
    )!;
    expect(w.dayOfWeek).toBe(4);
    expect(w.name).toBe('טמפו 20 דקות');
    expect(w.description).toBe('רצוף, בלי הפסקות');
    // No `intensity` survives into the plan: past this point the workout is absolute, and a
    // leftover relative field is a second source of truth for the same pace.
    expect((w.steps[0] as unknown as Record<string, unknown>).intensity).toBeUndefined();
    expect(w.steps[0].targetZone).toBe('easy');
  });

  it('refuses to resolve a trainee with no usable test', () => {
    // Not a fallback to their band offset and not a club average. 92% of nothing is not a
    // pace, and the alternative is a guessed pace-zone alarm on a real watch.
    const entry = { name: '6×800', notes: null, steps: INTERVALS };
    expect(resolveLibraryWorkout(entry, { thresholdPaceSec: null, dayOfWeek: 1 })).toBeNull();
    expect(resolveLibraryWorkout(entry, { thresholdPaceSec: 0, dayOfWeek: 1 })).toBeNull();
  });
});

describe('the book refuses to store a pace', () => {
  it('catches pace fields smuggled in through JSONB', () => {
    expect(hasAbsolutePaces(INTERVALS)).toBe(false);
    expect(hasAbsolutePaces([{ ...INTERVALS[0], targetPaceMinPerKm: 245 } as LibraryStep])).toBe(true);
    expect(hasAbsolutePaces([{ ...INTERVALS[0], group2Pace: { min: 245, max: 250 } } as LibraryStep])).toBe(true);
  });

  it('catches one nested inside a repeat', () => {
    const bad: LibraryStep[] = JSON.parse(JSON.stringify(INTERVALS));
    (bad[1].repeatSteps![0] as Record<string, unknown>).targetPaceMaxPerKm = 200;
    expect(hasAbsolutePaces(bad)).toBe(true);
  });

  it('catches a pace written into a note on a pace step', () => {
    // The converter keeps a note verbatim when it contains a pace, and the watch prints that
    // string mid-run — so "בקצב 4:05" reaches the athlete exactly as if it were the target.
    expect(hasAbsolutePaces([{ ...INTERVALS[0], notes: 'בקצב 4:05' } as LibraryStep])).toBe(true);
  });

  it('leaves a rest step\'s duration alone', () => {
    // '2:00 הליכה' on the rest step inside INTERVALS is a duration, not a pace. Flagging it
    // would make half the book unsavable.
    expect(hasAbsolutePaces([INTERVALS[1]])).toBe(false);
  });
});

describe('what the list line says', () => {
  it('multiplies the repeats into the volume', () => {
    // 2000 + 6×800 + 1500 = 8300. The 800 on its own is what a coach scanning for a long
    // session must not be shown.
    expect(entryVolume(INTERVALS).distanceM).toBe(8300);
  });

  it('counts the recoveries apart from the running', () => {
    // 6 × 2:00 of standing still. Summed into the work, this session would read as "12 דק׳"
    // beside a 12-minute tempo — the one comparison the volume line exists to support.
    expect(entryVolume(INTERVALS).restSec).toBe(720);
    expect(entryVolume(INTERVALS).durationSec).toBe(0);
  });

  it('names the session by its hardest effort', () => {
    // Warmup-first ordering would label every workout in the book "easy".
    expect(entryZones(INTERVALS)).toEqual(['interval', 'easy']);
  });

  it('names the session off its main set, not off its warmup', () => {
    expect(entryHeadline(INTERVALS)).toEqual({ kind: 'effort', zone: 'interval', fastPct: ZONE_INTENSITY.interval.fastPct });
    // The defect the screenshot showed: a threshold heart-rate pyramid printed `קל`, because
    // the 2 km jog in front of it is the only step in the entry that carries a pace at all.
    expect(entryHeadline(HR_PYRAMID)).toEqual({ kind: 'hr', minPct: 88, maxPct: 93 });
  });

  it('says nothing rather than something wrong when the main set has no target', () => {
    // A 30-minute test is run at whatever the athlete can hold — that is the point of it —
    // and labelling it `קל` off its warmup is the same defect as above with a worse outcome.
    const test: LibraryStep[] = [
      { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetZone: 'easy', intensity: ZONE_INTENSITY.easy },
      { order: 2, type: 'active', durationType: 'time', durationValue: 1800, targetType: 'no_target', notes: 'כל הכוח, קצב אחיד' },
    ];
    expect(entryHeadline(test)).toBeNull();
  });

  it('still names an easy run easy', () => {
    // An entry that is nothing BUT easy running has no main set to fall back from, and "easy"
    // is the honest answer rather than an artefact of the warmup rule.
    const easyRun: LibraryStep[] = [
      { order: 1, type: 'warmup', durationType: 'distance', durationValue: 8000, targetType: 'pace', targetZone: 'easy', intensity: ZONE_INTENSITY.easy },
    ];
    expect(entryHeadline(easyRun)).toEqual({ kind: 'effort', zone: 'easy', fastPct: ZONE_INTENSITY.easy.fastPct });
  });

  it('badges the session with its shape, not its warmup', () => {
    // `6×800` is how a coach recognises the session before reading its name. The 2000m
    // warmup is the longest single step in it and must not be what the badge shows.
    expect(entryShape(INTERVALS)).toEqual({ kind: 'reps', count: 6, distanceM: 800 });
  });

  it('badges a heart-rate session as heart rate', () => {
    // The one kind of entry a trainee with no usable test can still be pushed: an HR target
    // is already individual to them, so there is no threshold to resolve.
    expect(entryShape(HR_PYRAMID.slice(1))).toEqual({ kind: 'hr' });
    // And still does with an easy jog in front of it, which is how every HR session in the
    // book is actually written. The screenshot caught this: the jog is the only step in the
    // entry carrying a pace, and "pace anywhere beats heart rate" handed it the badge.
    expect(entryShape(HR_PYRAMID)).toEqual({ kind: 'hr' });
    // A rep count is a shape and wins; a pace is not.
    expect(entryShape([...HR_PYRAMID, ...INTERVALS])).toEqual({ kind: 'reps', count: 6, distanceM: 800 });
  });

  it('gives a continuous session no badge', () => {
    const tempo: LibraryStep[] = [
      { order: 1, type: 'active', durationType: 'time', durationValue: 1200, targetType: 'pace', targetZone: 'tempo', intensity: ZONE_INTENSITY.tempo },
    ];
    expect(entryShape(tempo)).toBeNull();
  });

  it('does not badge a time rep as a distance', () => {
    // `6 × 3 דקות` is a real workout, and "6×180" reads as metres.
    const byTime: LibraryStep[] = [
      { order: 1, type: 'interval', durationType: 'time', durationValue: 180, targetType: 'pace', targetZone: 'interval', intensity: ZONE_INTENSITY.interval, repeatCount: 6 },
    ];
    expect(entryShape(byTime)).toBeNull();
  });
});

function entry(over: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: over.name ?? 'x', scope: 'mine', ownerId: 'C', ownerName: 'Ofer',
    name: 'x', kind: 'intervals', notes: null, steps: INTERVALS,
    useCount: 0, lastUsedAt: null, createdAt: '2026-01-01', ...over,
  };
}

describe('finding the workout you meant', () => {
  const shelf = [
    entry({ name: 'קל 8 ק״מ', kind: 'easy', useCount: 3 }),
    entry({ name: '6×800', kind: 'intervals', useCount: 28, notes: 'הגבעה בפארק' }),
    entry({ name: 'טמפו 20', kind: 'tempo', useCount: 28, lastUsedAt: '2026-09-01' }),
    entry({ name: 'ארוך 24', kind: 'long', scope: 'academy', useCount: 0 }),
  ];

  it('puts the most-used first, because that is what makes it three clicks', () => {
    // Two entries tie on 28; the one used more recently wins, so a shelf of fresh entries
    // still has a stable order instead of whatever Postgres returned.
    expect(filterLibrary(shelf).map(e => e.name)).toEqual(['טמפו 20', '6×800', 'קל 8 ק״מ', 'ארוך 24']);
  });

  it('searches the name and the note', () => {
    expect(filterLibrary(shelf, { query: 'גבעה' }).map(e => e.name)).toEqual(['6×800']);
    expect(filterLibrary(shelf, { query: 'ארוך' }).map(e => e.name)).toEqual(['ארוך 24']);
  });

  it('does not match a step distance', () => {
    // '2000' is the warmup of every entry on this shelf. A search box that answers every
    // query with "everything" is not a search box.
    expect(filterLibrary(shelf, { query: '2000' })).toEqual([]);
  });

  it('filters by chip and by shelf', () => {
    expect(filterLibrary(shelf, { kind: 'tempo' }).map(e => e.name)).toEqual(['טמפו 20']);
    expect(filterLibrary(shelf, { scope: 'academy' }).map(e => e.name)).toEqual(['ארוך 24']);
    expect(filterLibrary(shelf, { scope: 'academy', kind: 'intervals' })).toEqual([]);
  });
});

describe('duplicating', () => {
  const source = entry({ name: '6×800', scope: 'academy', useCount: 28, lastUsedAt: '2026-09-10' });

  it('lands on the copier\'s own shelf with the counters reset', () => {
    const copy = duplicateEntry(source, 'MENTOR');
    expect(copy.scope).toBe('mine');
    expect(copy.ownerId).toBe('MENTOR');
    // Inheriting 28 pushes would put an untested variant above the session it came from.
    expect(copy.useCount).toBe(0);
    expect(copy.lastUsedAt).toBeNull();
  });

  it('does not share the steps with the entry it came from', () => {
    const copy = duplicateEntry(source, 'MENTOR');
    copy.steps[1].repeatCount = 10;
    expect(source.steps[1].repeatCount).toBe(6);
  });
});

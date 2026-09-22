import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { buildLast7Report, type ReportActivity } from '@/lib/reports/last-7-days';
import { paceBandCount, supportsFooter, workoutPaceBars } from '@/lib/feed/share-image';
import { weekDayBars } from '@/lib/reports/week-share-image';
import { VERDICT_TEXT, WORKOUT_CARD_TEXT } from '@/lib/share/card-text';
import { DIRECTION_COLOR } from '@/lib/plan-execution/verdict';
import {
  FOOTER_FRAME, defaultChipKeys, defaultExtraKeys, extraOn, frameCapacity, shareExtras,
  shareVerdict, type ShareSubject,
} from '@/lib/share/sheet-model';
import type { FeedActivity, FeedItem } from '@/lib/feed/project';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * THE TWO THINGS ON A SHARE CARD THAT ARE NOT NUMBERS: the bars and the verdict.
 *
 * Steps 3 and 4 of the share spec, and the only two parts of it that add something
 * the athlete could not post before. What is pinned here is what each of them is
 * allowed to do rather than how it looks:
 *
 *  · ONE drawing function makes both runs of bars. Per kilometre for a workout, per
 *    day for a week. Two implementations would drift on bar width, on which end the
 *    first bar goes, and on what a zero looks like — and the last of those is a
 *    correctness bug: a rest day has to read as an empty slot, not as absence.
 *  · The pace bars are INVERTED and the day bars are not. A chart where the best
 *    kilometre is the shortest bar says the opposite of what happened.
 *  · The verdict is never on by default and is absent entirely without a plan.
 *    Somebody who missed the range should not have to notice a default in order to
 *    keep that off a public story.
 */

const I18N = WORKOUT_CARD_TEXT.en;

function activity(over: Partial<FeedActivity> = {}): FeedActivity {
  return {
    id: 'a1',
    startTime: '2026-09-19 06:01:40',
    distance: 11400,
    duration: 2921,
    averagePace: 256,
    averageHr: 171,
    calories: 812,
    elevationGain: 94,
    activityName: 'Intervals',
    routePreview: [{ lat: 32, lng: 34 }, { lat: 32.1, lng: 34.1 }, { lat: 32.2, lng: 34.2 }],
    // Twelve splits for 11.4 km: eleven whole kilometres and a 400 m tail.
    paceBands: [270, 265, 258, 249, 244, 262, 259, 253, 251, 248, 256, 198],
    planVerdict: null,
    ...over,
  } as FeedActivity;
}

const workout = (over: Partial<FeedActivity> = {}): ShareSubject =>
  ({ kind: 'workout', item: { id: 'feed-item-1234567890', activity: activity(over) } as FeedItem });

const run = (start: string, km: number, secs: number): ReportActivity =>
  ({ activity_type: 'running', start_time: start, distance: km * 1000, duration: secs });

const report = () => buildLast7Report([
  run('2026-09-15T05:00:00Z', 10, 3000),
  run('2026-09-17T05:00:00Z', 5, 1500),
], '2026-09-19');

const week = (): ShareSubject => ({ kind: 'week', report: report(), athleteName: 'Ofer' });

const verdict = (over: Record<string, unknown> = {}) => ({
  activityId: 'a1', status: 'graded', score: 62, direction: 'too_fast',
  workoutName: 'Italian medio', ...over,
} as FeedActivity['planVerdict']);

describe('one function draws both runs of bars', () => {
  it('is drawn by the workout card and imported by the weekly one, not copied', () => {
    expect(read('lib/feed/share-image.ts')).toMatch(/export function drawShareBars/);
    const wk = read('lib/reports/week-share-image.ts');
    expect(wk).toMatch(/drawShareBars/);
    expect(wk).not.toMatch(/function drawShareBars/);
  });

  it('counts WHOLE kilometres only, so a 400 m tail cannot set the scale', () => {
    // Twelve splits over 11.4 km. The twelfth is a sprint over 400 m, and at 3:18/km
    // it would be the fastest "kilometre" on the chart and squash the other eleven.
    expect(paceBandCount(activity())).toBe(11);
    expect(workoutPaceBars(activity(), I18N)!.values).toHaveLength(11);
    expect(workoutPaceBars(activity(), I18N)!.values).not.toContain(198);
  });

  it('points at the fastest kilometre, which is the one not already on the card', () => {
    const bars = workoutPaceBars(activity(), I18N)!;
    expect(bars.highlight).toBe(4);          // 244 s/km, the lowest of the eleven
    expect(bars.values[bars.highlight!]).toBe(244);
  });

  it('draws paces upside down, so the tallest bar is the fastest', () => {
    expect(workoutPaceBars(activity(), I18N)!.inverted).toBe(true);
    // And says so on the card, because nothing else about a bar chart implies it.
    expect(workoutPaceBars(activity(), I18N)!.hint).toBe(I18N.fastest);
  });

  it('has nothing to draw for a run with no cached splits', () => {
    expect(workoutPaceBars(activity({ paceBands: null }), I18N)).toBeNull();
    // Or for a 1.5 km run: two bars is a fact, not a shape.
    expect(workoutPaceBars(activity({ distance: 1500 }), I18N)).toBeNull();
  });

  it('keeps a rest day in the week as a zero rather than dropping it', () => {
    // Seven slots with five empty is a true picture of the week; two bars is not.
    const bars = weekDayBars(report(), 'en');
    expect(bars.values).toHaveLength(7);
    expect(bars.values.filter(v => v === 0)).toHaveLength(5);
    expect(bars.values).toContain(10);
  });

  it('draws the week the right way up, and points at its biggest day', () => {
    const bars = weekDayBars(report(), 'en');
    expect(bars.inverted).toBeUndefined();
    expect(bars.values[bars.highlight!]).toBe(10);
    expect(bars.axis).toEqual(['13.09', '19.09']);
  });

  it('titles the week in the CARD language, not the app one', () => {
    expect(weekDayBars(report(), 'en').label).toBe('km per day');
    expect(weekDayBars(report(), 'he').label).toBe('ק״מ ליום');
  });
});

describe('where a footer is allowed to go', () => {
  it('is the numbers frame and nowhere else, because that is the only one with room', () => {
    // The frame is 383×681 design units and a story's bottom fifth is Instagram's
    // own reply bar. `route` draws its shoe to 581, `photo` its stats to ~576;
    // `fullStats` ends at ~430.
    expect(supportsFooter('fullStats')).toBe(true);
    for (const t of ['route', 'photo', 'routeOnly', 'statsBar', 'bigNumbers'] as const) {
      expect(supportsFooter(t), t).toBe(false);
    }
    expect(FOOTER_FRAME).toBe('numbers');
  });

  it('refuses a footer at the renderer as well as in the sheet', () => {
    const img = read('lib/feed/share-image.ts');
    expect(img).toMatch(/bars: supportsFooter\(template\) \? opts\.bars \?\? null : null/);
    expect(img).toMatch(/verdict: supportsFooter\(template\) \? opts\.verdict \?\? null : null/);
  });

  it('greys both on the route frame and says why, instead of hiding them', () => {
    const opts = shareExtras(workout({ planVerdict: verdict() }), 'route');
    expect(opts.map(o => o.key)).toEqual(['bars', 'verdict']);
    for (const o of opts) {
      expect(o.available, o.key).toBe(false);
      expect(o.reason, o.key).toBe('needsNumbers');
    }
  });

  it('greys the bars on a run with no splits for a DIFFERENT reason', () => {
    const bars = shareExtras(workout({ paceBands: null }), 'numbers')[0];
    expect(bars.available).toBe(false);
    expect(bars.reason).toBe('noSplits');
  });

  it('gives the week its bars on every frame, because that panel grows downward', () => {
    for (const frame of ['photo', 'numbers'] as const) {
      expect(shareExtras(week(), frame)[0].available, frame).toBe(true);
    }
  });

  it('does not count either of them against the stat row capacity', () => {
    // Turning the bars on must not cost the athlete their heart rate: capacity is
    // how many COLUMNS the stat row has, and neither of these is a column.
    const subject = workout({ planVerdict: verdict() });
    expect(frameCapacity(subject, 'numbers')).toBe(6);
    expect(defaultChipKeys(subject, 'numbers')).toHaveLength(6);
    for (const o of shareExtras(subject, 'numbers')) expect(o.available, o.key).toBe(true);
  });
});

describe('what starts on', () => {
  it('turns the bars on over 3 km — they are the differentiator', () => {
    expect(defaultExtraKeys(workout())).toEqual(['bars']);
  });

  it('leaves them off on a 2 km run, where there is no sequence to show', () => {
    expect(defaultExtraKeys(workout({ distance: 2000 }))).toEqual([]);
  });

  it('survives the frame the sheet actually opens on', () => {
    // A routed run opens on `route`, where no footer fits — but the intent is kept,
    // so one tap on Numbers shows the bars rather than needing a second tap here.
    expect(defaultExtraKeys(workout())).toContain('bars');
    expect(extraOn(workout(), 'route', ['bars'], 'bars')).toBe(false);
    expect(extraOn(workout(), 'numbers', ['bars'], 'bars')).toBe(true);
  });

  it('leaves the weekly bars off — the rows are what a stranger reads in a second', () => {
    // The weekly card's own docblock made this call when it shipped: bars need a
    // scale to mean anything, and a story does not get studied.
    expect(defaultExtraKeys(week())).toEqual([]);
    expect(read('lib/reports/week-share-image.ts')).toMatch(/OFF unless asked for/);
  });

  it('never turns the verdict on, whatever the verdict says', () => {
    for (const direction of ['on_target', 'too_slow', 'incomplete'] as const) {
      const keys = defaultExtraKeys(workout({ planVerdict: verdict({ direction }) }));
      expect(keys, direction).not.toContain('verdict');
    }
  });
});

describe('the verdict', () => {
  it('is absent entirely when the session had no plan, not greyed', () => {
    expect(shareExtras(workout(), 'numbers').map(o => o.key)).toEqual(['bars']);
    expect(shareVerdict(workout(), 'he')).toBeNull();
  });

  it('is never offered on a week, which is not graded against one plan', () => {
    expect(shareExtras(week(), 'numbers').map(o => o.key)).toEqual(['bars']);
    expect(shareVerdict(week(), 'he')).toBeNull();
  });

  it('prints the DIRECTION, because the percentage alone is two opposite runs', () => {
    // too_fast and too_slow both score 62%: the same number, opposite conversations.
    const fast = shareVerdict(workout({ planVerdict: verdict({ direction: 'too_fast' }) }), 'en')!;
    const slow = shareVerdict(workout({ planVerdict: verdict({ direction: 'too_slow' }) }), 'en')!;
    expect(fast.score).toBe(slow.score);
    expect(fast.text).toBe('Faster than plan');
    expect(slow.text).toBe('Slower than plan');
    expect(fast.color).not.toBe(slow.color);
  });

  it('takes its colour from the one table the app already renders it with', () => {
    const v = shareVerdict(workout({ planVerdict: verdict({ direction: 'on_target' }) }), 'he')!;
    expect(v.color).toBe(DIRECTION_COLOR.on_target);
    // Not a second palette in the card module — that is how a direction ends up
    // blue in the app and orange on the card.
    expect(read('lib/feed/share-image.ts')).not.toMatch(/on_target/);
  });

  it('speaks the card language rather than the app locale', () => {
    const he = shareVerdict(workout({ planVerdict: verdict() }), 'he')!;
    const en = shareVerdict(workout({ planVerdict: verdict() }), 'en')!;
    expect(he.text).toBe('מהר מהתוכנית');
    expect(en.text).toBe('Faster than plan');
  });

  it('carries a score-less verdict without printing a stray percent sign', () => {
    expect(shareVerdict(workout({ planVerdict: verdict({ score: null }) }), 'en')!.score).toBeNull();
    expect(read('lib/feed/share-image.ts')).toMatch(/verdict\.score === null \? null :/);
  });

  it('has every direction in both languages, so one cannot ship half-translated', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const direction of Object.keys(DIRECTION_COLOR)) {
        expect(VERDICT_TEXT[lang][direction as keyof typeof DIRECTION_COLOR], `${lang}.${direction}`)
          .toBeTruthy();
      }
    }
    const hebrew = /[֐-׿]/;
    expect(hebrew.test(JSON.stringify(VERDICT_TEXT.en))).toBe(false);
  });

  it('says the same words the app says, so the card cannot contradict the screen', () => {
    const he = JSON.parse(read('../messages/he.json')).execution;
    const en = JSON.parse(read('../messages/en.json')).execution;
    for (const direction of Object.keys(DIRECTION_COLOR) as Array<keyof typeof DIRECTION_COLOR>) {
      expect(VERDICT_TEXT.he[direction], direction).toBe(he[`dirShort_${direction}`]);
      expect(VERDICT_TEXT.en[direction], direction).toBe(en[`dirShort_${direction}`]);
    }
  });
});

describe('both catalogues carry the two new toggles', () => {
  it('has he/en parity on every key the extras row asks for', () => {
    const he = JSON.parse(read('../messages/he.json')).shareSheet;
    const en = JSON.parse(read('../messages/en.json')).shareSheet;
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
    for (const key of ['extraSplits', 'extraDays', 'extraVerdict', 'noSplits', 'needsNumbers']) {
      expect(he[key], `he.${key}`).toBeTruthy();
      expect(en[key], `en.${key}`).toBeTruthy();
    }
    // The two reasons are named by the model and printed through `t(o.reason)`.
    const model = read('lib/share/sheet-model.ts');
    for (const key of ['noSplits', 'needsNumbers']) expect(model, key).toContain(`'${key}'`);
  });
});

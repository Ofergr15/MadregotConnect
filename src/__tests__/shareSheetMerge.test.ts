import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { buildLast7Report, type ReportActivity } from '@/lib/reports/last-7-days';
import { availableWorkoutMetrics, workoutStats, WORKOUT_METRIC_KEYS } from '@/lib/feed/share-image';
import { WORKOUT_CARD_TEXT } from '@/lib/share/card-text';
import {
  FRAME_TEMPLATE, defaultChipKeys, defaultFrame, fitChipKeys, frameCapacity, shareChips,
  shareFilename, shareFrames, toggleChip, type ShareSubject,
} from '@/lib/share/sheet-model';
import type { FeedActivity, FeedItem } from '@/lib/feed/project';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * ONE SHARE SHEET, TWO KINDS OF CARD.
 *
 * The workout card and the weekly card were two screens that already shared the
 * canvas renderer. What they did not share was the sheet — which is the only reason
 * the card-language toggle and "add my own photo" existed on one and not the other.
 *
 * These tests pin the three things the merge is for: that there is only one sheet
 * left, that nothing an athlete could do before became impossible, and that an
 * option a subject cannot draw is GREYED WITH A REASON rather than hidden. The last
 * one is the actual bug in the old workout rail: it removed three of its ten views
 * when a run had no GPS, so the sheet offered a different set of unlabelled choices
 * each time and there was no way to tell a limit from a bug.
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
    ...over,
  } as FeedActivity;
}

const workout = (over: Partial<FeedActivity> = {}): ShareSubject =>
  ({ kind: 'workout', item: { id: 'feed-item-1234567890', activity: activity(over) } as FeedItem });

const run = (start: string, km: number, secs: number): ReportActivity =>
  ({ activity_type: 'running', start_time: start, distance: km * 1000, duration: secs });

const week = (athleteName: string | null = 'Ofer'): ShareSubject => ({
  kind: 'week',
  report: buildLast7Report([
    run('2026-09-15T05:00:00Z', 10, 3000),
    run('2026-09-17T05:00:00Z', 5, 1500),
  ], '2026-09-19'),
  athleteName,
});

describe('there is one sheet', () => {
  it('the two it replaces are gone', () => {
    expect(existsSync(join(SRC, 'components/FeedShareSheet.tsx'))).toBe(false);
    expect(existsSync(join(SRC, 'components/profile/WeekShareSheet.tsx'))).toBe(false);
  });

  it('every surface that shared anything opens the same component', () => {
    for (const rel of [
      'components/FeedCard.tsx',
      'components/ActivitySyncEditor.tsx',
      'components/feed/WeekSummaryCard.tsx',
      'components/profile/Last7DaysCard.tsx',
    ]) {
      expect(read(rel), rel).toMatch(/from '@\/components\/ShareSheet'/);
    }
  });

  it('the workout card gains the language toggle it never had', () => {
    // It used to read its labels from useTranslations, which only ever resolves the
    // ACTIVE locale — so a Hebrew athlete could not post an English card.
    const sheet = read('components/ShareSheet.tsx');
    expect(sheet).toMatch(/WORKOUT_CARD_TEXT\[cardLang\]/);
    expect(sheet).toMatch(/renderShareCard\(subject\.item, i18n/);
  });

  it('but NOT a name, which is a decision somebody already reported in words', () => {
    // 72949cd6 — see feedShareOwnership.test.ts. The workout card carries the run
    // and nothing else, and that omission is why share is gated to your own run.
    expect(read('components/ShareSheet.tsx')).toMatch(/subject\.kind === 'week' && !!subject\.athleteName/);
    expect(read('lib/feed/share-image.ts')).not.toMatch(/athleteName/);
  });
});

describe('nothing hides — every impossible option greys and says why', () => {
  it('always offers all three frames, for both kinds of card', () => {
    expect(shareFrames(workout()).map(f => f.key)).toEqual(['photo', 'route', 'numbers']);
    expect(shareFrames(week()).map(f => f.key)).toEqual(['photo', 'route', 'numbers']);
  });

  it('greys the route on a treadmill run, with a reason', () => {
    const route = shareFrames(workout({ routePreview: null })).find(f => f.key === 'route')!;
    expect(route.available).toBe(false);
    expect(route.reason).toBe('noRoute');
  });

  it('greys the route for a week for a DIFFERENT reason — it has many, not none', () => {
    const route = shareFrames(week()).find(f => f.key === 'route')!;
    expect(route.available).toBe(false);
    expect(route.reason).toBe('noWeekRoute');
  });

  it('leaves the numbers frame available to everything, including a treadmill', () => {
    for (const subject of [workout(), workout({ routePreview: null }), week()]) {
      expect(shareFrames(subject).find(f => f.key === 'numbers')!.available).toBe(true);
    }
  });
});

describe('what the sheet opens on', () => {
  it('a run with GPS opens on its own shape, as the old rail did', () => {
    expect(defaultFrame(workout())).toBe('route');
    expect(FRAME_TEMPLATE.route).toBe('route');
  });

  it('a run without GPS opens on the numbers, not on an empty photo frame', () => {
    expect(defaultFrame(workout({ routePreview: null }))).toBe('numbers');
  });

  it('a week opens with no photo behind it, exactly as it always has', () => {
    expect(defaultFrame(week())).toBe('numbers');
  });

  it('reproduces the old cards: three stats on the route frame, six on numbers', () => {
    expect(defaultChipKeys(workout(), 'route')).toEqual(['km', 'pace', 'time']);
    expect(defaultChipKeys(workout(), 'numbers')).toEqual(['km', 'pace', 'time', 'elev', 'cal', 'hr']);
  });

  it('opens a week on the four the Saturday push already reads out', () => {
    expect(defaultChipKeys(week(), 'numbers')).toEqual(['km', 'time', 'pace', 'runs']);
  });
});

describe('the chips carry the real value, which is what makes them choosable', () => {
  it('prints the number beside the label, from the card own text table', () => {
    const chips = shareChips(workout(), I18N, 'en');
    expect(chips.find(c => c.key === 'elev')).toEqual({
      key: 'elev', label: 'Elev gain', value: '94', unit: 'm',
    });
    expect(chips.find(c => c.key === 'km')!.value).toBe('11.4');
  });

  it('offers no chip this run cannot print', () => {
    const chips = shareChips(workout({ averageHr: null, elevationGain: null }), I18N, 'en');
    expect(chips.map(c => c.key)).not.toContain('hr');
    expect(chips.map(c => c.key)).not.toContain('elev');
  });

  it('follows the card language for a week, so a chip cannot disagree with the card', () => {
    expect(shareChips(week(), I18N, 'en').find(c => c.key === 'km')!.label).toBe('km');
    expect(shareChips(week(), I18N, 'he').find(c => c.key === 'km')!.label).toBe('ק״מ');
  });
});

describe('the content row cannot produce a card the frame will not draw', () => {
  it('knows the same capacities the renderer slices to', () => {
    expect(frameCapacity(workout(), 'route')).toBe(3);
    expect(frameCapacity(workout(), 'photo')).toBe(3);
    expect(frameCapacity(workout(), 'numbers')).toBe(6);
  });

  it('refuses a chip beyond the capacity instead of accepting it and not drawing it', () => {
    const three = ['km', 'pace', 'time'];
    expect(toggleChip(three, 'hr', 3)).toEqual(three);
    expect(toggleChip(three, 'hr', 6)).toEqual([...three, 'hr']);
  });

  it('cannot be emptied — an empty panel is a bug that looks like one', () => {
    expect(toggleChip(['km'], 'km', 3)).toEqual(['km']);
    expect(toggleChip(['km', 'pace'], 'km', 3)).toEqual(['pace']);
  });

  it('trims to card order when the frame shrinks, and never to nothing', () => {
    const six = ['km', 'pace', 'time', 'elev', 'cal', 'hr'];
    expect(fitChipKeys(workout(), 'route', six)).toEqual(['km', 'pace', 'time']);
    expect(fitChipKeys(workout(), 'numbers', ['hr', 'km'])).toEqual(['km', 'hr']);
    expect(fitChipKeys(workout(), 'route', []).length).toBeGreaterThan(0);
  });

  it('lets a week pick everything it has, because that card grows downward', () => {
    expect(frameCapacity(week(), 'numbers')).toBe(4);
  });
});

describe('the renderer draws the chosen numbers and nothing else', () => {
  it('in card order rather than the order the chips were tapped', () => {
    expect(workoutStats(activity(), I18N, ['hr', 'km']).map(s => s.label)).toEqual(['Distance', 'HR']);
  });

  it('skips a key this run cannot print, instead of drawing a dash', () => {
    const stats = workoutStats(activity({ averageHr: null }), I18N, ['km', 'hr']);
    expect(stats.map(s => s.label)).toEqual(['Distance']);
  });

  it('offers the start time as a metric, so it works on every frame', () => {
    // It used to be a `showStartTime` flag honoured only by the two legacy layouts.
    expect(WORKOUT_METRIC_KEYS).toContain('start');
    expect(workoutStats(activity(), I18N, ['start'])[0].value).toBe('6:01');
  });

  it('puts start last, so the stats athletes already know do not move', () => {
    expect(WORKOUT_METRIC_KEYS[WORKOUT_METRIC_KEYS.length - 1]).toBe('start');
    expect(availableWorkoutMetrics(activity()).slice(0, 3)).toEqual(['km', 'pace', 'time']);
  });

  it('caps each layout at what it was built to lay out', () => {
    const img = read('lib/feed/share-image.ts');
    expect(img).toMatch(/pickedStats\(c, 6\)/);
    expect(img).toMatch(/pickedStats\(c, 3\)/);
    expect(img).not.toMatch(/coreStats\(act, i18n\)|extendedStats\(act, i18n\)/);
  });
});

describe('the card language is a table, not a locale lookup', () => {
  it('labels everything in both, so a new label cannot ship half-translated', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const [key, value] of Object.entries(WORKOUT_CARD_TEXT[lang])) {
        expect(value, `${lang}.${key}`).toBeTruthy();
      }
    }
  });

  it('does not print Hebrew on an English card', () => {
    const hebrew = /[֐-׿]/;
    expect(hebrew.test(JSON.stringify(WORKOUT_CARD_TEXT.en))).toBe(false);
    expect(hebrew.test(WORKOUT_CARD_TEXT.he.km)).toBe(true);
  });
});

describe('the file the athlete ends up with', () => {
  it('is named for the run, and PNG only when it is a sticker', () => {
    expect(shareFilename(workout(), false)).toBe('madregot-feed-ite.jpg');
    expect(shareFilename(workout(), true)).toBe('madregot-feed-ite.png');
  });

  it('is named for the week it covers', () => {
    expect(shareFilename(week(), false)).toBe('madregot-week-2026-09-19.jpg');
  });
});

describe('both catalogues carry the sheet', () => {
  it('has he/en parity on every key the sheet asks for', () => {
    const he = JSON.parse(read('../messages/he.json')).shareSheet;
    const en = JSON.parse(read('../messages/en.json')).shareSheet;
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
    const sheet = read('components/ShareSheet.tsx');
    for (const key of ['frameTitle', 'contentTitle', 'wordingTitle', 'titleWorkout', 'titleWeek']) {
      expect(sheet, key).toContain(`'${key}'`);
      expect(he[key], key).toBeTruthy();
    }
    // The greyed frames' one-line reasons are named by the model and printed by the
    // sheet through `t(f.reason)`, so the catalogue is the only place to check them.
    const model = read('lib/share/sheet-model.ts');
    for (const key of ['noRoute', 'noWeekRoute']) {
      expect(model, key).toContain(`'${key}'`);
      expect(he[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { SHARE_TEMPLATE_KEYS, SPLITS_MAX_ROWS, splitRows, supportsPhoto, supportsTransparent } from '@/lib/feed/share-image';
import {
  WORKOUT_TEMPLATES, defaultTemplate, drawnTemplate, fitChipKeys, fixedNumbersReason, frameCapacity,
  shareTemplates, supportsAccent, canSegment, canHrLine, viewBrand, type ShareSubject,
} from '@/lib/share/sheet-model';
import { localizeDefaultName } from '@/lib/share/default-name';
import { buildLast7Report } from '@/lib/reports/last-7-days';
import type { FeedActivity, FeedItem } from '@/lib/feed/project';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const SHEET = readFileSync(join(SRC, 'components/ShareSheet.tsx'), 'utf8');
const PAGE = readFileSync(join(SRC, 'app/(app)/dashboard/activities/[activityId]/page.tsx'), 'utf8');
const NAME = readFileSync(join(SRC, 'components/activity/ActivityName.tsx'), 'utf8');
const RENDER = readFileSync(join(SRC, 'lib/feed/share-image.ts'), 'utf8');
const HE = JSON.parse(readFileSync(join(SRC, '../messages/he.json'), 'utf8'));
const EN = JSON.parse(readFileSync(join(SRC, '../messages/en.json'), 'utf8'));

/**
 * SIX VIEWS ON THE WORKOUT SHEET.
 *
 * Ten views plus a new kilometre list was "too much" for one screen, and he picked
 * the six to keep: card, classic, minimal, the stats bar ("with a photo or without,
 * in the settings"), km by km, and the route ("with an option to show only the
 * route"). The other views are folded into those two switches rather than lost.
 */

const ROUTE = [{ lat: 32, lng: 34 }, { lat: 32.1, lng: 34.1 }, { lat: 32.2, lng: 34.2 }];
const BANDS = [270, 265, 258, 249, 244];

const workout = (over: Partial<FeedActivity> = {}): ShareSubject => ({
  kind: 'workout',
  item: {
    id: 'feed-item-1234567890',
    activity: {
      id: 'a1', startTime: '2026-09-19 06:01:40', distance: 11400, duration: 2921,
      averagePace: 256, averageHr: 171, calories: 812, elevationGain: 94,
      activityName: 'Intervals', routePreview: ROUTE, paceBands: BANDS, ...over,
    } as FeedActivity,
  } as FeedItem,
});
const noRoute = { routePreview: null } as Partial<FeedActivity>;
const noSplits = { paceBands: null } as Partial<FeedActivity>;

describe('the six', () => {
  it('are the six he kept, in grid order, and all drawable by the renderer', () => {
    expect(WORKOUT_TEMPLATES).toEqual(['splits', 'route', 'statsBar', 'classic', 'card', 'minimal']);
    for (const t of WORKOUT_TEMPLATES) expect(SHARE_TEMPLATE_KEYS).toContain(t);
    expect(shareTemplates(workout()).every(v => v.available)).toBe(true);
  });

  it('greys a view it cannot draw and says why, never hides it', () => {
    const views = shareTemplates(workout({ ...noRoute, ...noSplits }));
    expect(views).toHaveLength(6);
    expect(views.find(v => v.key === 'route')).toMatchObject({ available: false, reason: 'noRoute' });
    expect(views.find(v => v.key === 'splits')).toMatchObject({ available: false, reason: 'noSplits' });
  });

  it('opens on the route, then the kilometres, then the stats bar', () => {
    expect(defaultTemplate(workout())).toBe('route');
    expect(defaultTemplate(workout(noRoute))).toBe('splits');
    expect(defaultTemplate(workout({ ...noRoute, ...noSplits }))).toBe('statsBar');
  });
});

describe('the two switches that replaced four views', () => {
  it('draws route-only from the route view', () => {
    expect(drawnTemplate('route', { routeOnly: true })).toBe('routeOnly');
    expect(drawnTemplate('route', { routeOnly: false })).toBe('route');
    // The switch belongs to the route view; elsewhere it changes nothing.
    expect(drawnTemplate('statsBar', { routeOnly: true })).toBe('statsBar');
  });

  it('draws the stats bar over a photo as the photo view', () => {
    expect(drawnTemplate('statsBar', { withPhoto: true })).toBe('photo');
    expect(drawnTemplate('statsBar', { withPhoto: false })).toBe('statsBar');
  });

  it('offers every background on every view', () => {
    for (const v of WORKOUT_TEMPLATES) {
      expect(supportsPhoto(drawnTemplate(v, { withPhoto: true })), v).toBe(true);
      expect(supportsTransparent(drawnTemplate(v, { withPhoto: false })), v).toBe(true);
    }
  });
});

describe('the kilometre list', () => {
  it('prints no summary numbers, and the chips say so', () => {
    const s = workout();
    expect(frameCapacity(s, 'splits')).toBe(0);
    expect(fixedNumbersReason(s, 'splits')).toBe('splitsNumbers');
    expect(frameCapacity(s, 'routeOnly')).toBe(0);
    expect(frameCapacity(s, 'route')).toBe(3);
  });

  it('keeps the chip selection across a view that ignores it', () => {
    const six = ['km', 'pace', 'time', 'elev', 'cal', 'hr'];
    expect(fitChipKeys(workout(), 'splits', six)).toEqual(six);
    expect(fitChipKeys(workout(), 'statsBar', six)).toHaveLength(3);
  });

  it('colours its bars with the accent', () => {
    expect(supportsAccent(workout(), 'splits')).toBe(true);
    expect(supportsAccent(workout(), 'statsBar')).toBe(false);
    const week: ShareSubject = { kind: 'week', report: buildLast7Report([], '2026-09-20') };
    expect(supportsAccent(week, 'route')).toBe(false);
  });

  it('has one row per kilometre through a marathon, and pairs them only for an ultra', () => {
    expect(splitRows({ paceBands: BANDS, distance: 5200 }).map(r => r.km)).toEqual([1, 2, 3, 4, 5]);
    const long = Array.from({ length: 60 }, (_, i) => 300 + i);
    // Feedback 2026-09-29: a 25 km run read 2, 4, 6, 8.
    expect(splitRows({ paceBands: long.slice(0, 25), distance: 25560 }).map(r => r.km))
      .toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(splitRows({ paceBands: long.slice(0, 42), distance: 42195 })).toHaveLength(42);
    const ultra = splitRows({ paceBands: long.slice(0, 55), distance: 55100 });
    expect(ultra).toHaveLength(28);
    expect(ultra[0]).toEqual({ km: 2, pace: 300.5 });
    expect(ultra.at(-1)).toEqual({ km: 55, pace: 354 });
    expect(splitRows({ paceBands: long.slice(0, SPLITS_MAX_ROWS), distance: 50100 })).toHaveLength(50);
    expect(splitRows({ paceBands: null, distance: 5000 })).toEqual([]);
  });

  // The stairs until the athlete picks another logo — then the pick, in the same
  // spot beside the heading. It never gains a second logo.
  it('carries the stairs mark by default, and the picked logo instead of it', () => {
    const body = RENDER.slice(RENDER.indexOf('function layoutSplits'), RENDER.indexOf('const LAYOUTS'));
    expect(body).toMatch(/const mark = c\.brand \?\? stairs;/);
    expect(body).not.toMatch(/drawWordmark/);
    expect(RENDER).toMatch(/template === 'sideBySide' \|\| template === 'splits' \|\| opts\.brand === 'stairs'/);
  });
});

describe('the watch\'s name, in the card\'s language (#93)', () => {
  it('translates the names Garmin and Strava generate', () => {
    expect(localizeDefaultName('Berlin ריצה', 'en')).toBe('Berlin Running');
    expect(localizeDefaultName('Berlin Running', 'he')).toBe('Berlin ריצה');
    expect(localizeDefaultName('ריצה', 'en')).toBe('Running');
    expect(localizeDefaultName('Treadmill Running', 'he')).toBe('ריצה בהליכון');
    expect(localizeDefaultName('ריצה בשביל', 'en')).toBe('Trail Running');
    expect(localizeDefaultName('Morning Run', 'he')).toBe('ריצת בוקר');
    expect(localizeDefaultName('City of Westminster Running', 'he')).toBe('City of Westminster ריצה');
  });

  it('leaves a name the athlete chose alone', () => {
    for (const n of ['Intervals 6×1000', 'ריצה עם יוסי', 'Long run', 'Running with Dana', 'Meliteieoi ריצה קלה']) {
      expect(localizeDefaultName(n, 'en')).toBe(n);
      expect(localizeDefaultName(n, 'he')).toBe(n);
    }
  });

  it('follows the language toggle until the athlete types', () => {
    expect(SHEET).toMatch(/const titleText = typedTitle \?\? localizeDefaultName\(originalTitle, cardLang\)/);
    expect(SHEET).toMatch(/onClick=\{\(\) => setTypedTitle\(null\)\}/);
  });
});

describe('the sheet', () => {
  it('shows the six as a three-by-two grid, never a rail that scrolls', () => {
    expect(SHEET).toMatch(/grid grid-cols-3/);
    expect(SHEET).toMatch(/views\.map\(v =>/);
    expect(SHEET).not.toMatch(/overflow-x-auto/);
  });

  it('reads photo, accent and capacity off what is actually drawn', () => {
    expect(SHEET).toMatch(/drawnTemplate\(template, \{ routeOnly, withPhoto: bg === 'photo' && !!photo \}\)/);
    expect(SHEET).toMatch(/const accentOk = supportsAccent\(subject, drawn\)/);
    expect(SHEET).toMatch(/frameCapacity\(subject, drawn\)/);
    expect(SHEET).toMatch(/template: drawn,/);
  });

  it('has one background row in place of a photo button and a sticker toggle', () => {
    expect(SHEET).toMatch(/\['photo', 'club', 'sticker'\] as const/);
    expect(SHEET).not.toMatch(/setSticker/);
  });

  it('has every label in both languages', () => {
    for (const k of ['viewSplits', 'viewRoute', 'viewRouteOnly', 'viewStatsBar', 'viewClassic', 'viewCard',
      'viewMinimal', 'routeWithStats', 'noRouteViews', 'noSplitsView', 'splitsNumbers', 'fixedNumbers',
      'noNumbers', 'startOn', 'startOff', 'dateOn', 'dateOff', 'titleEdit', 'titleReset', 'backgroundTitle',
      'bgPhoto', 'bgClub', 'sticker', 'changePhoto']) {
      expect(HE.shareSheet[k], k).toBeTruthy();
      expect(EN.shareSheet[k], k).toBeTruthy();
    }
  });
});

describe('renaming the run on its own page (#92)', () => {
  it('shows the name in the header, with a pencil for its owner only', () => {
    expect(PAGE).toMatch(/<ActivityName activityId=\{act\.id\} name=\{act\.activity_name\} editable=\{isMyActivity\} \/>/);
  });

  it('saves through the existing author-checked feed PATCH, not a new endpoint', () => {
    expect(NAME).toMatch(/fetchFeedItemByActivity\(activityId\)/);
    expect(NAME).toMatch(/updateFeedItem\(item\.id, \{ activityName: next \}\)/);
    expect(NAME).not.toMatch(/fetch\(['`]\/api/);
    for (const k of ['renameAction', 'renameError']) {
      expect(HE.activities[k], k).toBeTruthy();
      expect(EN.activities[k], k).toBeTruthy();
    }
  });
});

// Every view keeps the logo it always had unless the athlete picks another, and
// KM Splits offers segments only when the run was lapped by something other than
// the kilometre (#share-logo-picker, 2026-09-29).
describe('logo picker and segments', () => {
  it('each view names its own logo', () => {
    expect(WORKOUT_TEMPLATES.map(viewBrand)).toEqual(['stairs', 'wordmark', 'wordmark', 'badge', 'badge', 'badge']);
  });

  it('offers segments only on a run with lap bands', () => {
    expect(canSegment(workout())).toBe(false);
    expect(canSegment(workout({ lapBands: [{ m: 2000, pace: 300 }, { m: 400, pace: 190 }] }))).toBe(true);
  });

  it('offers the heart-rate backdrop only when two laps carry heart rate', () => {
    expect(canHrLine(workout({ lapBands: [{ m: 2000, pace: 300 }, { m: 400, pace: 190, hr: 170 }] }))).toBe(false);
    expect(canHrLine(workout({ lapBands: [{ m: 2000, pace: 300, hr: 141 }, { m: 400, pace: 190, hr: 170 }] }))).toBe(true);
  });

  it('the sheet resets the logo when the view changes, and has the three tabs in both languages', () => {
    expect(SHEET).toMatch(/setTemplate\(next\);\s*setBrand\(null\);/);
    for (const k of ['tabDesign', 'tabData', 'tabText', 'splitKm', 'splitSegments', 'avgLine', 'hrLine', 'brandOwn']) {
      expect(HE.shareSheet[k]).toBeTruthy();
      expect(EN.shareSheet[k]).toBeTruthy();
    }
  });

  it('the renderer draws the laps on a Hebrew card right to left', () => {
    expect(RENDER).toContain('function layoutSegments');
    expect(RENDER).toMatch(/const rtl = \/\[\\u0590-\\u05FF\]\/\.test\(i18n\.segments\)/);
  });

  it('a standing rest does not set the pace floor, and no two pace labels share a line', () => {
    expect(RENDER).toContain('const vMin = Math.max(speed(slow) * 0.8, vMax * 0.5);');
    expect(RENDER).toMatch(/taken\.some\(y => Math\.abs\(y - \(ty \+ p\(3\)\)\) < p\(11\)\)/);
  });
});

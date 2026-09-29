import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { SHARE_TEMPLATE_KEYS } from '@/lib/feed/share-image';
import {
  WORKOUT_TEMPLATES, defaultTemplate, extraOn, fitChipKeys, fixedNumbersReason, frameCapacity,
  shareExtras, shareTemplates, supportsAccent, type ShareSubject,
} from '@/lib/share/sheet-model';
import { buildLast7Report } from '@/lib/reports/last-7-days';
import type { FeedActivity, FeedItem } from '@/lib/feed/project';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const SHEET = readFileSync(join(SRC, 'components/ShareSheet.tsx'), 'utf8');
const HE = JSON.parse(readFileSync(join(SRC, '../messages/he.json'), 'utf8'));
const EN = JSON.parse(readFileSync(join(SRC, '../messages/en.json'), 'utf8'));

/**
 * ALL TEN VIEWS ARE BACK ON THE WORKOUT SHEET.
 *
 * "The current app sharing cards is not the full that you showed me in the mockup."
 * He was shown a gallery of ten; the unified sheet (2.40.98) replaced it with three
 * frame buttons, each mapped to one view, so seven were drawn by the renderer and
 * reachable by nobody. These pin the ten, and that every property the frame used to
 * decide is now read off the view — otherwise the new views would come back with
 * the wrong chip count, a photo button that does nothing, or a footer that won't fit.
 */

const ROUTE = [{ lat: 32, lng: 34 }, { lat: 32.1, lng: 34.1 }, { lat: 32.2, lng: 34.2 }];

const workout = (over: Partial<FeedActivity> = {}): ShareSubject => ({
  kind: 'workout',
  item: {
    id: 'feed-item-1234567890',
    activity: {
      id: 'a1', startTime: '2026-09-19 06:01:40', distance: 11400, duration: 2921,
      averagePace: 256, averageHr: 171, calories: 812, elevationGain: 94,
      activityName: 'Intervals', routePreview: ROUTE, ...over,
    } as FeedActivity,
  } as FeedItem,
});

describe('the ten', () => {
  it('offers every view the renderer can draw, each exactly once', () => {
    expect([...WORKOUT_TEMPLATES].sort()).toEqual([...SHARE_TEMPLATE_KEYS].sort());
    expect(shareTemplates(workout())).toHaveLength(10);
    expect(shareTemplates(workout()).every(v => v.available)).toBe(true);
  });

  it('greys the three that need GPS on a treadmill run, and keeps all ten on screen', () => {
    const views = shareTemplates(workout({ routePreview: null } as Partial<FeedActivity>));
    expect(views).toHaveLength(10);
    expect(views.filter(v => !v.available).map(v => v.key).sort())
      .toEqual(['bigNumbers', 'route', 'routeOnly']);
    expect(views.filter(v => !v.available).every(v => v.reason === 'noRoute')).toBe(true);
  });

  it('opens where the three-frame sheet opened', () => {
    expect(defaultTemplate(workout())).toBe('route');
    expect(defaultTemplate(workout({ routePreview: null } as Partial<FeedActivity>))).toBe('fullStats');
  });
});

describe('what the view decides', () => {
  it('knows how many numbers each view prints', () => {
    const s = workout();
    expect(frameCapacity(s, 'fullStats')).toBe(6);
    expect(frameCapacity(s, 'numbers')).toBe(6);
    for (const t of ['route', 'photo', 'statsBar', 'sideBySide', 'bigNumbers'] as const) {
      expect(frameCapacity(s, t)).toBe(3);
    }
    for (const t of ['routeOnly', 'classic', 'card', 'minimal'] as const) {
      expect(frameCapacity(s, t)).toBe(0);
      expect(fixedNumbersReason(s, t)).toBeTruthy();
    }
    expect(fixedNumbersReason(s, 'routeOnly')).toBe('noNumbers');
  });

  it('keeps the chip selection intact across a view that ignores it', () => {
    const s = workout();
    const six = ['km', 'pace', 'time', 'elev', 'cal', 'hr'];
    expect(fitChipKeys(s, 'classic', six)).toEqual(six);
    expect(fitChipKeys(s, 'statsBar', six)).toHaveLength(3);
  });

  it('draws the footer only where it fits', () => {
    const s = workout({ paceBands: [270, 265, 258, 249, 244] } as Partial<FeedActivity>);
    expect(shareExtras(s, 'fullStats')[0]).toMatchObject({ key: 'bars', available: true });
    for (const t of ['statsBar', 'sideBySide', 'classic', 'minimal'] as const) {
      expect(shareExtras(s, t)[0]).toMatchObject({ available: false, reason: 'needsNumbers' });
      expect(extraOn(s, t, ['bars'], 'bars')).toBe(false);
    }
    expect(extraOn(s, 'fullStats', ['bars'], 'bars')).toBe(true);
  });

  it('offers the line colour only where there is a line', () => {
    expect(supportsAccent(workout(), 'route')).toBe(true);
    expect(supportsAccent(workout(), 'sideBySide')).toBe(true);
    expect(supportsAccent(workout(), 'statsBar')).toBe(false);
    expect(supportsAccent(workout(), 'classic')).toBe(true);
    expect(supportsAccent(workout({ routePreview: null } as Partial<FeedActivity>), 'classic')).toBe(false);
    const week: ShareSubject = { kind: 'week', report: buildLast7Report([], '2026-09-20') };
    expect(supportsAccent(week, 'route')).toBe(false);
  });
});

describe('the sheet', () => {
  it('shows the ten as a grid, never a rail that scrolls', () => {
    expect(SHEET).toMatch(/grid grid-cols-5/);
    expect(SHEET).toMatch(/views\.map\(v =>/);
    expect(SHEET).not.toMatch(/overflow-x-auto/);
  });

  it('reads photo, accent and capacity off the view, not the frame', () => {
    expect(SHEET).toMatch(/const photoOk = supportsPhoto\(template\)/);
    expect(SHEET).toMatch(/const accentOk = supportsAccent\(subject, template\)/);
    expect(SHEET).toMatch(/frameCapacity\(subject, template\)/);
  });

  it('has a label for every view in both languages', () => {
    for (const k of ['viewRoute', 'viewRouteOnly', 'viewBigNumbers', 'viewStatsBar', 'viewFullStats',
      'viewSideBySide', 'viewPhoto', 'viewClassic', 'viewCard', 'viewMinimal',
      'noRouteViews', 'needsFullStats', 'fixedNumbers', 'noNumbers', 'startOn', 'startOff']) {
      expect(HE.shareSheet[k], k).toBeTruthy();
      expect(EN.shareSheet[k], k).toBeTruthy();
    }
  });
});

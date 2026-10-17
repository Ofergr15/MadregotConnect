import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { STICKER_TEMPLATE_KEYS, isStickerTemplate, requiresRoute, supportsPhoto, supportsTransparent } from '@/lib/feed/share-image';
import {
  defaultChipKeys, fitChipKeys, fixedNumbersReason, frameCapacity, shareStickers, shareTemplates, supportsAccent, type ShareSubject,
} from '@/lib/share/sheet-model';
import type { FeedActivity, FeedItem } from '@/lib/feed/project';

/**
 * The six clear stickers (mockup profile-stats-mockup/mockup.html, section 4): a
 * second row of looks in the share editor, always transparent, gated on the route
 * like the cards are, and each with room for its own number of numbers.
 */

const SRC = fileURLToPath(new URL('../', import.meta.url));
const RENDER = readFileSync(join(SRC, 'lib/feed/share-image.ts'), 'utf8');
const EDITOR = readFileSync(join(SRC, 'components/share/WorkoutShareEditor.tsx'), 'utf8');
const HE = JSON.parse(readFileSync(join(SRC, '../messages/he.json'), 'utf8'));
const EN = JSON.parse(readFileSync(join(SRC, '../messages/en.json'), 'utf8'));

const ROUTE = [{ lat: 32, lng: 34 }, { lat: 32.1, lng: 34.1 }, { lat: 32.2, lng: 34.2 }];
const workout = (over: Partial<FeedActivity> = {}): ShareSubject => ({
  kind: 'workout',
  item: {
    id: 'feed-item-1',
    activity: {
      id: 'a1', startTime: '2026-10-17 06:01:40', distance: 21100, duration: 5640,
      averagePace: 267, averageHr: 151, calories: 1320, elevationGain: 84,
      activityName: 'Long run', routePreview: ROUTE, paceBands: [270, 265, 258], ...over,
    } as FeedActivity,
  } as FeedItem,
});

describe('the six stickers', () => {
  it('are six, in the mockup order, apart from the six cards', () => {
    expect(STICKER_TEMPLATE_KEYS).toEqual([
      'stickerRail', 'stickerList', 'stickerStack', 'stickerRouteStack', 'stickerPills', 'stickerRouteBadge',
    ]);
    expect(shareTemplates(workout()).map(v => v.key).some(isStickerTemplate)).toBe(false);
    expect(shareStickers(workout()).every(v => v.available)).toBe(true);
  });

  it('each has a layout in the renderer and a name in both languages', () => {
    for (const k of STICKER_TEMPLATE_KEYS) {
      expect(RENDER).toMatch(new RegExp(`\\b${k}: layout`));
      const label = `view${k[0].toUpperCase()}${k.slice(1)}`;
      expect(HE.shareSheet[label], label).toBeTruthy();
      expect(EN.shareSheet[label], label).toBeTruthy();
    }
  });

  it('are always clear and never take a photo', () => {
    for (const k of STICKER_TEMPLATE_KEYS) {
      expect(supportsTransparent(k)).toBe(true);
      expect(supportsPhoto(k)).toBe(false);
    }
    expect(RENDER).toMatch(/\(!!opts\.transparent \|\| isStickerTemplate\(template\)\)/);
  });

  it('grey the three built on the route when the run has no GPS, and keep the other three', () => {
    const off = shareStickers(workout({ routePreview: null })).filter(v => !v.available).map(v => v.key);
    expect(off).toEqual(['stickerRail', 'stickerRouteStack', 'stickerRouteBadge']);
    for (const k of off) expect(requiresRoute(k)).toBe(true);
  });

  it('hold their own number of numbers; the route-only one holds none', () => {
    const s = workout();
    expect(STICKER_TEMPLATE_KEYS.map(k => frameCapacity(s, k))).toEqual([3, 6, 5, 3, 6, 0]);
    expect(fixedNumbersReason(s, 'stickerRouteBadge')).toBe('noNumbers');
    expect(defaultChipKeys(s, 'stickerList').length).toBeGreaterThan(3);
    expect(fitChipKeys(s, 'stickerRail', ['km', 'pace', 'time', 'hr', 'cal'])).toEqual(['km', 'pace', 'time']);
  });

  it('let the line colour reach the route on the three that draw it', () => {
    const s = workout();
    expect(STICKER_TEMPLATE_KEYS.filter(k => supportsAccent(s, k))).toEqual(['stickerRail', 'stickerRouteStack', 'stickerRouteBadge']);
  });

  it('sit on their own shelf in the editor, with no background label of their own', () => {
    expect(EDITOR).toMatch(/shareStickers\(subject\)/);
    expect(EDITOR).toMatch(/\.\.\.\(sticker \? \[\] : \['background' as const\]\)/);
  });
});

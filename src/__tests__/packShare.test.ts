import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planLength } from '@/lib/feed/share-image';
import { fitLook, lookFits, lookRenderOptions, loadLook, saveLook, type WorkoutLook } from '@/lib/share/workout-look';
import { qualityWorkout } from '@/lib/quality-session/server';
import type { FeedItem } from '@/lib/feed/project';
import type { ParsedWorkout } from '@/lib/ai/types';

/**
 * One look, every pack (Ofer 2026-10-20, mockups/post-session/v2): the look picked on
 * pack 1's run is drawn on packs 2 and 3, fitted to each run; long-run mornings open
 * the same screen; and the session heading reads a 1000 + 600 block as 1.6 km.
 */

const route = Array.from({ length: 40 }, (_, i) => ({ lat: 32.08 + i * 0.001, lng: 34.78 + Math.sin(i) * 0.001 }));
function item(over: Partial<NonNullable<FeedItem['activity']>> = {}): FeedItem {
  return {
    id: 'i1', type: 'activity', author: { athleteId: 'a', name: 'A', avatarUrl: null } as never, body: null, media: [], payload: null,
    occurredAt: '2026-10-20T05:00:00Z', likeCount: 0, commentCount: 0, likedByMe: false, likePreview: [], commentPreview: [], canDelete: false,
    activity: {
      id: 'act', athleteId: 'a', garminActivityId: null, activityName: 'דבוקה 1', activityType: 'running', startTime: '2026-10-20T05:00:00',
      distance: 26_146, duration: 7_064, movingDuration: 7_064, averagePace: 270, averageHr: 140, maxHr: 170, calories: 1500, elevationGain: 50,
      locationName: null, perceivedRpe: null, perceivedFeel: null, routePreview: route, hasRoute: true,
      paceBands: Array.from({ length: 26 }, () => 270), planVerdict: null, ...over,
    } as never,
  };
}
const look: WorkoutLook = {
  template: 'route', keys: ['distance', 'pace', 'time'], cardLang: 'he', showTitle: true, showStartTime: false, showDate: true, showShoe: false,
  routeOnly: false, bg: 'club', accent: 'orange', brand: 'wordmark', splitMode: 'km', paceLabels: true, targets: false, avgLine: true, hrLine: true,
};

describe('the look on another run', () => {
  it('carries over as picked on a run that can draw it', () => {
    const s = { kind: 'workout' as const, item: item() };
    const f = fitLook(look, s);
    expect(f.template).toBe('route');
    expect(f.accent).toBe('orange');
    expect(f.brand).toBe('wordmark');
    expect(lookFits(look, s)).toBe(true);
    const o = lookRenderOptions(f, s, { titleText: 'דבוקה 2' });
    expect(o).toMatchObject({ template: 'route', accent: 'orange', brand: 'wordmark', showTitle: true });
  });

  it('a route view on a run without GPS falls back, and is marked as not fitting', () => {
    const s = { kind: 'workout' as const, item: item({ routePreview: null, hasRoute: false } as never) };
    expect(lookFits(look, s)).toBe(false);
    expect(fitLook(look, s).template).not.toBe('route');
  });

  it('no title text draws no title, whatever the look says', () => {
    const s = { kind: 'workout' as const, item: item() };
    expect(lookRenderOptions(look, s, { titleText: '  ' }).showTitle).toBe(false);
  });
});

describe('the last look is remembered', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; },
    };
  });
  it('round-trips, and a broken value reads as none', () => {
    expect(loadLook()).toBeNull();
    saveLook(look);
    expect(loadLook()).toEqual(look);
    localStorage.setItem('mc-pack-share-look-v1', '{"x":1}');
    expect(loadLook()).toBeNull();
  });
});

describe('long-run mornings', () => {
  const w = (o: Partial<ParsedWorkout>): ParsedWorkout => ({ dayOfWeek: 2, name: '', description: '', steps: [], ...o } as ParsedWorkout);
  it('a long run is a share morning, marked long; a quality part wins on the same morning', () => {
    expect(qualityWorkout([w({ name: 'ארוכה 30', description: '30 ק״מ' })], 2)).toMatchObject({ type: 'long_run', long: true });
    expect(qualityWorkout([w({ name: 'ארוכה', description: '28 ק״מ', partIndex: 1 }), w({ name: 'אינטרוולים 6×1000', partIndex: 2 })], 2)?.type).toBe('intervals');
    expect(qualityWorkout([w({ name: 'קלה', description: '8 ק״מ' })], 2)).toBeNull();
  });
});

describe('the session heading', () => {
  it('reads a 1000 + 600 block as 1.6 km (Amit, 20.10), and a 5 km block closed early as 5', () => {
    expect(planLength(1600)).toBe(1600);
    expect(planLength(1594)).toBe(1600);
    expect(planLength(4930)).toBe(5000);
    expect(planLength(1000)).toBe(1000);
    expect(planLength(2010)).toBe(2000);
    expect(planLength(400)).toBe(400);
  });
});

describe('the wiring', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
  it('the editor hands its look on, and the flow draws every pack with the same options', () => {
    const ed = read('components/share/WorkoutShareEditor.tsx');
    expect(ed).toMatch(/applyAll\.onApply\(look, bg === 'photo' \? photo : null\)/);
    expect(ed).toMatch(/lookRenderOptions\(look, subject, \{ photo, titleText, view, own \}\)/);
    const flow = read('components/share/PackShareFlow.tsx');
    expect(flow).toMatch(/renderShareCard\(it, WORKOUT_CARD_TEXT\[fitted\.cardLang\], lookRenderOptions\(fitted, subject/);
    expect(flow).toMatch(/navigator\.canShare\?\.\(\{ files \}\)/);
    expect(flow).toMatch(/אותה תמונה לכולם/);
    expect(flow).toMatch(/תמונה לכל דבוקה/);
  });
  it('the feed shows two separate staff cards, both to the quality-session people', () => {
    const feed = read('app/(app)/feed/page.tsx');
    expect(feed).toMatch(/<StaffSessionPhotos enabled=\{isStaff && qsAccess\} \/>/);
    expect(read('components/feed/StaffSessionPhotos.tsx')).toMatch(/תמונות מהאימון/);
    const row = read('components/feed/QualitySessionRow.tsx');
    expect(row).toMatch(/שיתוף הדבוקות/);
    expect(row).toMatch(/&all=1/);
  });
});

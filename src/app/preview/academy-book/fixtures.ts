/**
 * The book's fixtures, shared by the list preview and the editor preview.
 *
 * Its own file because the editor screen has to open on THESE entries — the long name, the
 * heart-rate session, and above all `c3`, whose step carries a note and which the editor
 * therefore refuses to draw. A second set of fixtures written for the editor would have
 * been a set that happens to open cleanly.
 */

import { ZONE_INTENSITY, type LibraryEntry, type LibraryStep } from '@/lib/academy/library';

// The role is a parameter and not always `warmup`, which is what it was until the editor
// opened one of these and showed the closing 1.5 km as `חימום`. `entryVolume` adds the two the
// same way, so nothing in the book ever contradicted it.
export const easy = (metres: number, order = 1, role: 'warmup' | 'cooldown' = 'warmup'): LibraryStep => ({
  order, type: role, durationType: 'distance', durationValue: metres,
  targetType: 'pace', targetZone: 'easy', intensity: ZONE_INTENSITY.easy,
});

/** `count × metres` at the given effort, wrapped in a repeat block like the parser writes. */
export const reps = (count: number, metres: number, zone: keyof typeof ZONE_INTENSITY, order = 2): LibraryStep => ({
  order, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: count,
  repeatSteps: [
    { order: 1, type: 'interval', durationType: 'distance', durationValue: metres, targetType: 'pace', targetZone: zone, intensity: ZONE_INTENSITY[zone] },
    { order: 2, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: '2:00 הליכה' },
  ],
});

export function entry(over: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: over.name || 'x', scope: 'mine', ownerId: 'me', ownerName: 'Ofer Grosfeld',
    name: 'אימון', kind: 'intervals', notes: null, steps: [easy(2000), reps(6, 800, 'interval'), easy(1500, 3, 'cooldown')],
    useCount: 0, lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z', ...over,
  };
}

export const SHELF: LibraryEntry[] = [
  entry({
    id: 'l1', name: 'אינטרוולים קלאסי', kind: 'intervals', useCount: 28, lastUsedAt: '2026-09-15T00:00:00Z',
    notes: 'הגבעה בפארק הירקון',
    steps: [easy(2000), reps(6, 1000, 'interval'), easy(1500, 3, 'cooldown')],
  }),
  entry({
    id: 'l2', name: 'אינטרוולים ארוכים', kind: 'intervals', useCount: 11, lastUsedAt: '2026-09-01T00:00:00Z',
    steps: [easy(2000), reps(4, 1600, 'threshold'), easy(1500, 3, 'cooldown')],
  }),
  // The heart-rate session: no intensity anywhere, so it needs no threshold to push. That is
  // a real difference to the coach and it is carried entirely by this badge.
  entry({
    id: 'l3', name: 'פירמידה בדופק סף', kind: 'tempo', useCount: 9, lastUsedAt: '2026-08-20T00:00:00Z',
    steps: [
      easy(2000),
      { order: 2, type: 'active', durationType: 'time', durationValue: 1800, targetType: 'heart_rate', targetHrMinPct: 88, targetHrMaxPct: 93 },
    ],
  }),
  // Continuous, measured in minutes rather than metres — the row with no shape to badge and
  // no distance to print.
  entry({
    id: 'l4', name: 'טמפו רצוף', kind: 'tempo', useCount: 6, lastUsedAt: '2026-08-11T00:00:00Z',
    steps: [{ order: 1, type: 'active', durationType: 'time', durationValue: 1200, targetType: 'pace', targetZone: 'tempo', intensity: ZONE_INTENSITY.tempo }],
  }),
  // The long name, against a badge and a use count.
  entry({
    id: 'l5', name: 'קצרים לפני תחרות — שבוע ההתחדדות האחרון', kind: 'intervals', useCount: 3,
    steps: [easy(1500), reps(10, 400, 'sprint'), easy(1000, 3, 'cooldown')],
  }),
  // An effort with no zone name at all: the mockup's `102% מהסף` row.
  entry({
    id: 'l6', name: 'סף בשני בלוקים', kind: 'tempo', useCount: 1,
    steps: [easy(2000), {
      order: 2, type: 'active', durationType: 'time', durationValue: 900,
      targetType: 'pace', intensity: { fastPct: 102, slowPct: 99 },
    }],
  }),
  entry({ id: 'l7', name: 'קל 8 ק״מ', kind: 'easy', useCount: 0, steps: [easy(8000)] }),
];

export const CANON: LibraryEntry[] = [
  entry({ id: 'c1', scope: 'academy', name: 'ארוך 24 עם 6 בקצב מרתון', kind: 'long', ownerName: 'Ofer Grosfeld', useCount: 41, lastUsedAt: '2026-09-17T00:00:00Z', steps: [easy(18000), reps(6, 1000, 'marathon_pace')] }),
  entry({ id: 'c2', scope: 'academy', name: 'גבעות 8×90 שניות', kind: 'hills', ownerName: 'Ofer Grosfeld', useCount: 17, steps: [easy(2000), reps(8, 500, 'interval'), easy(1500, 3, 'cooldown')] }),
  entry({ id: 'c3', scope: 'academy', name: 'טסט 30 דקות', kind: 'test', ownerName: 'Ofer Grosfeld', useCount: 25, steps: [easy(2000), { order: 2, type: 'active', durationType: 'time', durationValue: 1800, targetType: 'no_target', notes: 'כל הכוח, קצב אחיד' }] }),
];

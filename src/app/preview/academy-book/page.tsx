'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';

import { BookList } from '@/components/academy/WorkoutBook';
import { ZONE_INTENSITY, type LibraryEntry, type LibraryScope, type LibraryStep } from '@/lib/academy/library';

// ── ספר האימונים, on both shelves and in its empty states ─────────────────────
//
// The book's rows are ENTIRELY derived — the badge, the volume, the effort and the ordering
// are all computed from the steps, and none of them exists as a field anybody typed. So
// every one of them can be wrong in a way that looks perfectly plausible on screen, and
// there is no row in any database that would contradict it.
//
// The four things this screen exists to show, none of them visible from the code:
//
//  1. **A shelf in use.** The badges must read as a column of recognisable structures
//     (`6×800`, `4×1600`) rather than as four identical blue pills, and the order must be
//     the most-run session first — that ordering IS the three-clicks claim.
//  2. **A continuous session and a heart-rate one** next to the rep sessions. Those two get
//     a different badge and a different colour, and a warm chip beside a blue one is where
//     the academy's palette has smeared before (see ThreadInbox).
//  3. **A long name.** `truncate` next to a shape badge and an author name is a row with
//     three things competing for one line — the exact shape that truncated the name in the
//     weekly queue.
//  4. **The academy shelf**, which is the same list with an author on every row, and the
//     empty states for both shelves and for a search that matches nothing.
//
// Development only. In production the route does not exist.

const easy = (metres: number, order = 1): LibraryStep => ({
  order, type: 'warmup', durationType: 'distance', durationValue: metres,
  targetType: 'pace', targetZone: 'easy', intensity: ZONE_INTENSITY.easy,
});

/** `count × metres` at the given effort, wrapped in a repeat block like the parser writes. */
const reps = (count: number, metres: number, zone: keyof typeof ZONE_INTENSITY, order = 2): LibraryStep => ({
  order, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: count,
  repeatSteps: [
    { order: 1, type: 'interval', durationType: 'distance', durationValue: metres, targetType: 'pace', targetZone: zone, intensity: ZONE_INTENSITY[zone] },
    { order: 2, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: '2:00 הליכה' },
  ],
});

function entry(over: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: over.name || 'x', scope: 'mine', ownerId: 'me', ownerName: 'Ofer Grosfeld',
    name: 'אימון', kind: 'intervals', notes: null, steps: [easy(2000), reps(6, 800, 'interval'), easy(1500, 3)],
    useCount: 0, lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z', ...over,
  };
}

const SHELF: LibraryEntry[] = [
  entry({
    id: 'l1', name: 'אינטרוולים קלאסי', kind: 'intervals', useCount: 28, lastUsedAt: '2026-09-15T00:00:00Z',
    notes: 'הגבעה בפארק הירקון',
    steps: [easy(2000), reps(6, 1000, 'interval'), easy(1500, 3)],
  }),
  entry({
    id: 'l2', name: 'אינטרוולים ארוכים', kind: 'intervals', useCount: 11, lastUsedAt: '2026-09-01T00:00:00Z',
    steps: [easy(2000), reps(4, 1600, 'threshold'), easy(1500, 3)],
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
    steps: [easy(1500), reps(10, 400, 'sprint'), easy(1000, 3)],
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

const CANON: LibraryEntry[] = [
  entry({ id: 'c1', scope: 'academy', name: 'ארוך 24 עם 6 בקצב מרתון', kind: 'long', ownerName: 'Ofer Grosfeld', useCount: 41, lastUsedAt: '2026-09-17T00:00:00Z', steps: [easy(18000), reps(6, 1000, 'marathon_pace')] }),
  entry({ id: 'c2', scope: 'academy', name: 'גבעות 8×90 שניות', kind: 'hills', ownerName: 'Ofer Grosfeld', useCount: 17, steps: [easy(2000), reps(8, 500, 'interval'), easy(1500, 3)] }),
  entry({ id: 'c3', scope: 'academy', name: 'טסט 30 דקות', kind: 'test', ownerName: 'Ofer Grosfeld', useCount: 25, steps: [easy(2000), { order: 2, type: 'active', durationType: 'time', durationValue: 1800, targetType: 'no_target', notes: 'כל הכוח, קצב אחיד' }] }),
];

export default function AcademyBookPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-6">
        <div>
          <h1 className="text-xl font-bold text-ink-900">ספר האימונים</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · שתי מדפים ושני מצבים ריקים</p>
        </div>

        <Case label="המדף שלי">
          <Book entries={[...SHELF, ...CANON]} initial="mine" />
        </Case>

        <Case label="ספר האקדמיה">
          <Book entries={[...SHELF, ...CANON]} initial="academy" />
        </Case>

        <Case label="מדף ריק">
          <Book entries={[]} initial="mine" />
        </Case>
      </div>
    </div>
  );
}

/** The scope tab is the parent's state in the real screen, so it is here too. */
function Book({ entries, initial }: { entries: LibraryEntry[]; initial: LibraryScope }) {
  const [scope, setScope] = useState<LibraryScope>(initial);
  return <BookList entries={entries} scope={scope} onScope={setScope} onDuplicate={() => {}} />;
}

function Case({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-ink-400">{label}</p>
      {children}
    </div>
  );
}

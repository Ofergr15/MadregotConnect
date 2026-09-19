'use client';

import { notFound } from 'next/navigation';

import { PendingTests } from '@/components/academy/PendingTests';
import type { PendingSubmission } from '@/components/academy/PendingTests';

// ── The approval queue, in its three states ───────────────────────────────────
//
// Migration 108 let a trainee type their own test. The card below is the whole safety of
// that: until the coach decides, the number counts toward nothing, so if this card is easy
// to skim past then the feature has made the registry LESS truthful rather than more —
// the athlete believes they have tested and the screen still calls them overdue.
//
// So what this screen exists to prove, and none of it is visible from the code:
//
//  1. **One submission** — the singular heading, and the אישור / דחייה pair both clearing
//     the 44px thumb floor side by side at 375px. Two buttons in one row is where a
//     `flex-1` plus a padded sibling usually collapses.
//  2. **An implausible one** — `6.42` metres typed where 6420 belongs, which is the single
//     most likely bad submission and the reason approve is a decision rather than a
//     formality. The pace must read as suspect (band-3) and carry the units warning, at a
//     glance, without the coach doing arithmetic.
//  3. **Several at once** — the plural heading with the count, and the stack not turning
//     into a wall the eye slides off.
//
// Development only. In production the route does not exist.

/** 6500 m in 30:00 → 4:37/km. An ordinary, believable test. */
const ONE: PendingSubmission = {
  testId: 'p1',
  athleteId: 'a1',
  name: 'Ofer Grosfeld',
  date: '2026-09-18',
  protocol: '30min',
  durationSec: 1800,
  distanceM: 6500,
  avgHr: 172,
  paceSec: 1800 / 6.5,
  submittedAt: '2026-09-18T15:02:00Z',
  implausible: false,
};

/** The units slip: kilometres in a metres field. 1800 / 0.00642 → 280,373 s/km. */
const UNITS_SLIP: PendingSubmission = {
  testId: 'p2',
  athleteId: 'a2',
  name: 'Dana Levi',
  date: '2026-09-17',
  protocol: '30min',
  durationSec: 1800,
  distanceM: 6.42,
  avgHr: null,
  paceSec: 1800 / 0.00642,
  submittedAt: '2026-09-17T18:40:00Z',
  implausible: true,
};

const MANY: PendingSubmission[] = [
  ONE,
  UNITS_SLIP,
  {
    testId: 'p3',
    athleteId: 'a3',
    name: 'Yonatan Ben-Ami',
    date: '2026-09-16',
    protocol: '2000m',
    durationSec: 440,
    distanceM: 2000,
    avgHr: 181,
    paceSec: 440 / 2,
    submittedAt: '2026-09-16T06:20:00Z',
    implausible: false,
  },
];

export default function AcademyTestsPendingPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-6">
        <div>
          <h1 className="text-xl font-bold text-ink-900">טסטים ממתינים לאישור</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · שלושה מצבים</p>
        </div>

        <Case label="טסט אחד">
          <PendingTests pending={[ONE]} onDecided={() => {}} />
        </Case>

        <Case label="מספרים שלא נראים סבירים">
          <PendingTests pending={[UNITS_SLIP]} onDecided={() => {}} />
        </Case>

        <Case label="כמה במקביל">
          <PendingTests pending={MANY} onDecided={() => {}} />
        </Case>
      </div>
    </div>
  );
}

function Case({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-ink-400">{label}</p>
      {children}
    </div>
  );
}

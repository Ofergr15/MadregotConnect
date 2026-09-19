'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { israelToday } from '@/lib/utils';
import { emptyCharacterization, type Characterization } from '@/lib/academy/characterization';
import { CharacterizationSheet } from '@/components/academy/CharacterizationForm';

// ── Login-free preview of the characterization form ──────────────────────────
//
// Funnel step 3, and the only step with answers behind it. The warnings below
// come from the REAL `characterizationIssues`, so a warning shown here is the
// shipped verdict — which is the only way a preview of a form that checks its own
// answers is worth auditing.
//
// Deterministic, like every preview in this directory: `today` is passed into the
// form rather than read from the clock, and the dates are counted back from the
// Israel calendar day. A form whose warning depends on the machine's clock cannot
// be screenshotted twice and compared.
//
// Development only. In production the route does not exist.

const DAY = 24 * 3_600_000;

/** An Israel calendar day `daysAgo` before today, as `YYYY-MM-DD`. */
function day(daysAgo: number): string {
  return israelToday(new Date(Date.parse(israelToday()) - daysAgo * DAY));
}

/** Mid-call, which is what this form looks like for most of its life. */
const PART_WAY: Characterization = {
  ...emptyCharacterization('c1'),
  goalType: 'half',
  targetRace: 'טבריה',
  targetRaceDate: day(-113),
  weeklyKm: 35,
  yearsRunning: 2,
  availableDays: [0, 2, 4, 6],
  limitations: 'דלקת בגיד אכילס לפני חצי שנה',
  watch: 'Garmin',
  prDistanceM: 10000,
  prTimeSec: 2910,
  fit: 'maybe',
  recordedBy: 'ofer@madregot.app',
};

/**
 * Three mistakes at once, all of them the kind nothing downstream would contradict: 350 km a
 * week for 35, a race date whose year is last year, and a best quoted in kilometres where
 * metres were asked for.
 */
const TYPOS: Characterization = {
  ...PART_WAY,
  weeklyKm: 350,
  targetRaceDate: day(40),
  prDistanceM: 10,
};

export default function AcademyCharacterizationPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  // The query string chooses the state, so several audit entries can shoot the same page
  // without one navigation interrupting the other. Read in an effect and not in the
  // `useState` initializer — the initializer runs on the server too, where `window` does not
  // exist, and the resulting hydration mismatch makes React discard the tree.
  const [mode, setMode] = useState<'part' | 'empty' | 'typo' | 'done'>('part');
  useEffect(() => {
    const q = window.location.search;
    if (q.includes('empty')) setMode('empty');
    else if (q.includes('typo')) setMode('typo');
    else if (q.includes('done')) setMode('done');
  }, []);

  const value = mode === 'empty' ? emptyCharacterization('c1') : mode === 'typo' ? TYPOS : PART_WAY;

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-ink-900">טופס אפיון</h1>
        <p className="text-xs text-ink-400">תצוגה מקדימה · נתוני דמה</p>
      </div>
      <CharacterizationSheet
        open
        onOpenChange={() => undefined}
        candidateName="אבי ברק"
        candidateId="c1"
        value={value}
        onSave={async () => true}
        onComplete={() => undefined}
        completed={mode === 'done'}
        today={`${day(0)}T09:00:00+03:00`}
      />
    </div>
  );
}

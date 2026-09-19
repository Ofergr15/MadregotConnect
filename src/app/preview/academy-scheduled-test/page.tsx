'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { israelToday } from '@/lib/utils';
import type { TestInvitation } from '@/lib/academy/testInvite';
import { ScheduledTest } from '@/components/academy/ScheduledTest';

// ── Login-free preview of the trainee's scheduled-test card ──────────────────
//
// The state is NOT a prop. Each fixture below is a plausible `academy_test_invitations`
// row plus a clock, and the real `inviteState` decides what the screen says — so a
// wrong-looking screen here is a wrong rule, not a wrong fixture. That is the only
// version of this preview worth auditing: the whole slice is a state machine whose
// states differ by nothing but the clock.
//
// Deterministic, like every preview in this directory: `now` is the Israel calendar
// day at 09:00, never `Date.now()` at module scope, so two screenshots a minute apart
// are identical and the overdue boundary cannot drift mid-audit.
//
// Development only. In production the route does not exist.

const DAY = 24 * 3_600_000;

/** Israel wall-clock `time` on the day `days` from today. Negative is the past. */
function at(days: number, time: string): string {
  const day = israelToday(new Date(Date.parse(israelToday()) + days * DAY));
  return new Date(`${day}T${time}:00+03:00`).toISOString();
}

/** 09:00 this morning: late enough that a 07:00 test today has already been due. */
const NOW = at(0, '09:00');

const BASE: TestInvitation = {
  id: 'inv-1',
  athleteId: 'a1',
  protocol: '30min',
  proposedSlots: [at(2, '07:00'), at(3, '07:00'), at(5, '18:00')],
  status: 'proposed',
};

/**
 * One row per state, each differing from `BASE` only in the ways a real row would.
 *
 * `expired` keeps `status: 'proposed'` on purpose — nobody refused anything, the offered
 * times simply went by, and that is a different fact from a drop-out with a different
 * useful action. It is also the state no stored `status` column could express.
 */
const CASES: Record<string, { invite: TestInvitation; watch: boolean }> = {
  awaiting: { invite: BASE, watch: true },
  nowatch: { invite: BASE, watch: false },
  confirmed: {
    invite: { ...BASE, status: 'confirmed', confirmedSlot: at(2, '07:00') },
    watch: true,
  },
  today: {
    // Due at 07:00, it is 09:00, and nothing has been reported. Still today's test.
    invite: { ...BASE, status: 'confirmed', confirmedSlot: at(0, '07:00') },
    watch: true,
  },
  overdue: {
    invite: { ...BASE, status: 'confirmed', confirmedSlot: at(-1, '07:00') },
    watch: false,
  },
  other: {
    invite: { ...BASE, status: 'other', requestedNote: 'עובד במשמרות עד ה-20 בחודש' },
    watch: true,
  },
  expired: {
    invite: { ...BASE, proposedSlots: [at(-6, '07:00'), at(-4, '07:00')] },
    watch: true,
  },
};

const TITLES: Record<string, string> = {
  awaiting: 'ממתין לתשובה',
  nowatch: 'ממתין לתשובה · בלי שעון',
  confirmed: 'מאושר',
  today: 'היום',
  overdue: 'הזמן עבר',
  other: 'ביקש זמן אחר',
  expired: 'הזמנים פגו',
};

export default function AcademyScheduledTestPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  // The query string chooses the state, so one audit entry per state can shoot the same page
  // without a navigation interrupting the next. Read in an effect and never in the `useState`
  // initializer — the initializer runs on the server too, where `window` does not exist, and
  // the hydration mismatch makes React throw the tree away.
  const [key, setKey] = useState('awaiting');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('state');
    if (q && q in CASES) setKey(q);
  }, []);

  const shown = CASES[key] ?? CASES.awaiting;

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900">הטסט שלך</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · {TITLES[key]} · נתוני דמה</p>
        </div>
        <ScheduledTest
          invitation={shown.invite}
          now={NOW}
          watchConnected={shown.watch}
          onConfirm={() => undefined}
          onAskOther={() => undefined}
        />
      </div>
    </div>
  );
}

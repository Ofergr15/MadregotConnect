'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { israelToday } from '@/lib/utils';
import { buildBoard, type BoardRow } from '@/lib/academy/testBoard';
import { BoardLists } from '@/components/academy/TestBoard';

// ── Login-free preview of the coach's test-invitation board ───────────────────
//
// The fixtures are rows, not a board. The real `buildBoard` decides which list each
// person lands in, so a wrong-looking screen here is a wrong rule rather than a
// wrong fixture — and the rule is the whole feature: whose move is it.
//
// Deterministic, like every preview in this directory: one fixed `now` at 09:00 on
// the Israel calendar day, never `Date.now()` at module scope, so the hand-over
// boundary at slot + FOLLOW_UP_DAYS_AFTER cannot drift mid-audit.
//
// Development only. In production the route does not exist.

const DAY = 24 * 3_600_000;

/** Israel wall-clock `time` on the day `days` from today. Negative is the past. */
function at(days: number, time: string): string {
  const day = israelToday(new Date(Date.parse(israelToday()) + days * DAY));
  return new Date(`${day}T${time}:00+03:00`).toISOString();
}

const NOW = at(0, '09:00');

function row(
  id: string,
  name: string,
  invite: Partial<BoardRow['invite']>,
  ago: { created: number; updated?: number },
): BoardRow {
  return {
    name,
    createdAt: at(-ago.created, '20:00'),
    updatedAt: at(-(ago.updated ?? ago.created), '20:00'),
    invite: {
      id,
      athleteId: id,
      protocol: '30min',
      proposedSlots: [at(2, '07:00'), at(3, '07:00')],
      status: 'proposed',
      ...invite,
    },
  };
}

/**
 * A plausible week for one coach with eight trainees, and every state the board can show.
 *
 * `full` is the state worth auditing hardest: it is the only one where the two lists are both
 * long enough to compete, which is when a chip beside a Latin name inside a Hebrew row starts
 * pushing the name onto a second line.
 */
const CASES: Record<string, BoardRow[]> = {
  full: [
    // ── מחכים לך ──
    row('a1', 'Noa Shemesh', { status: 'other', requestedNote: 'עובד במשמרות עד ה-20 בחודש, אפשר רק בבוקר' }, { created: 9, updated: 1 }),
    row('a2', 'Dor Alon', { proposedSlots: [at(-6, '07:00'), at(-3, '07:00')] }, { created: 11 }),
    // Three days past the slot, so both reminders have been and gone: handed over.
    row('a3', 'Tamar Gold', { status: 'confirmed', confirmedSlot: at(-3, '07:00') }, { created: 12 }),
    // ── אצל המתאמנים ──
    row('a4', 'Omri Levi', { status: 'confirmed', confirmedSlot: at(-1, '18:00') }, { created: 6 }),
    row('a5', 'Yael Bar', { status: 'confirmed', confirmedSlot: at(0, '07:00') }, { created: 5 }),
    row('a6', 'Eitan Cohen', { status: 'confirmed', confirmedSlot: at(2, '07:00') }, { created: 4 }),
    row('a7', 'Shira Mor', {}, { created: 2 }),
    row('a8', 'Gil Peretz', { status: 'confirmed', confirmedSlot: at(9, '18:00') }, { created: 1 }),
  ],
  // Nobody is waiting on the coach. The list that matters is empty, and has to LOOK deliberate.
  clear: [
    row('a5', 'Yael Bar', { status: 'confirmed', confirmedSlot: at(0, '07:00') }, { created: 5 }),
    row('a6', 'Eitan Cohen', { status: 'confirmed', confirmedSlot: at(2, '07:00') }, { created: 4 }),
    row('a7', 'Shira Mor', {}, { created: 2 }),
  ],
  // Everything needs the coach: three kinds of silence, which is the one screen a chronological
  // board could never have produced.
  backlog: [
    row('a1', 'Noa Shemesh', { status: 'other', requestedNote: 'נפצעתי בקרסול, אפשר לדחות בשבועיים?' }, { created: 20, updated: 4 }),
    row('a2', 'Dor Alon', { proposedSlots: [at(-6, '07:00'), at(-3, '07:00')] }, { created: 11 }),
    row('a3', 'Tamar Gold', { status: 'confirmed', confirmedSlot: at(-8, '07:00') }, { created: 15 }),
  ],
  empty: [],
};

const TITLES: Record<string, string> = {
  full: 'שבוע רגיל',
  clear: 'הכול נענה',
  backlog: 'שלוש שתיקות',
  empty: 'אין טסטים פתוחים',
};

export default function AcademyTestBoardPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  // Read in an effect and never in the `useState` initializer: the initializer runs on the
  // server too, where `window` does not exist, and the hydration mismatch makes React throw
  // the tree away.
  const [key, setKey] = useState('full');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('state');
    if (q && q in CASES) setKey(q);
  }, []);

  const board = buildBoard(CASES[key] ?? CASES.full, NOW);

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900">הזמנות לטסט</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · {TITLES[key]} · נתוני דמה</p>
        </div>
        <BoardLists board={board} />
      </div>
    </div>
  );
}

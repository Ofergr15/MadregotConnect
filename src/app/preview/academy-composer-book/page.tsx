'use client';

import { notFound } from 'next/navigation';

import { AcademyPlanComposer } from '@/components/AcademyPlanComposer';
import { CANON, SHELF } from '../academy-book/fixtures';

// ── The board, with the book plugged into it ──────────────────────────────────
//
// This one renders the REAL composer, not a replica of it, against a stubbed `fetch`. The
// alternative was a page that draws what the board is supposed to look like, and the whole
// reason this screen exists is that the composer's new behaviour is not visible from its code:
//
//  1. **A book day next to a written day.** The written row prints `@ 4:33`; the book row must
//     print no pace at all, because an entry holds a share of a threshold and the board is
//     addressed to three trainees with three different ones. A pace appearing on that row —
//     from any source — is the bug this whole layer exists to prevent.
//  2. **The book day has no pencil.** Editing it would have to write absolute paces, and
//     there is nobody to derive them from until the push. The Trash is still there.
//  3. **Three trainees, three states.** One with a band and a test, one with a test and no
//     band, one with neither — so both warnings render together and can be read against each
//     other. They are two different problems and the louder one has to look louder.
//  4. **One `בחירה` control**, and the sheet behind it, which is the only place in the app
//     that says out loud that `ספר האימונים` and `ספרייה` are two different lists.
//  5. **What the characterization call said**, above the grid and on the day it is about. The
//     fixture below is built so three of the four notes are visible on arrival — the strip, a
//     clash on the one filled day, and the offered days the week leaves empty — and the fourth,
//     the volume jump, appears when Dani is added, because his current volume is 8 km. None of
//     them disables anything, which is the property worth checking by hand here.
//
// The stub is not a mock of the product's logic — every number on screen is computed by the
// real component off these fixtures. It replaces the network only.

/** The academy's tests registry, shaped as `GET /api/academy/tests` returns it. */
const ROWS = [
  { athleteId: 'a1', lastPaceSec: 240 },
  { athleteId: 'a2', lastPaceSec: 372 },
  // a3 is absent on purpose: never tested.
];

const ATHLETES = [
  {
    id: 'a1', name: 'Rut Levi', hasGarmin: true,
    band: { id: 'b4', name: 'דבוקה 4', bandNumber: 4, paceProfile: { offsetSeconds: -20 } },
  },
  {
    id: 'a2', name: 'Dani Cohen', hasGarmin: true,
    // A test, but no band offset — the state every trainee is in today.
    band: { id: 'b6', name: 'דבוקה 6', bandNumber: 6, paceProfile: {} },
  },
  {
    id: 'a3', name: 'Noa Bar', hasGarmin: false,
    band: null,
  },
] as const;

/** A written week, as a saved plan row would come back: absolute paces, one day. */
const SAVED_PLAN = {
  id: 'p1',
  week_start_date: null as string | null, // filled in per request below
  parsed_workouts: {
    workouts: [{
      dayOfWeek: 4,
      name: 'טמפו 20 דקות',
      steps: [
        { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'no_target' },
        { order: 2, type: 'active', durationType: 'time', durationValue: 1200, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 300 },
      ],
    }],
  },
};

/**
 * What the characterization call said, shaped as `GET /api/academy/plan-inputs` returns it.
 *
 * Rut is the primary (the composer selects the first athlete), and her days deliberately exclude
 * Thursday — the one day the saved plan fills — so the clash renders where it belongs instead of
 * needing a second recipient. `a3` is absent on purpose: never characterised, and the board must
 * say nothing about her rather than assume she trains every day.
 */
const PLAN_INPUTS: Record<string, unknown> = {
  a1: {
    goalType: 'half', availableDays: [0, 2, 3], daysPerWeek: 3, weeklyKm: 42,
    limitation: 'גב תחתון — בלי אינטרוולים קצרים עד סוף החודש',
    targetRaceDate: '2026-12-05', weeksToRace: 11, prPaceSec: 291, ready: true, missing: [],
  },
  a2: {
    goalType: '10k', availableDays: [1, 3, 5], daysPerWeek: 3, weeklyKm: 8,
    limitation: null, targetRaceDate: null, weeksToRace: null, prPaceSec: null, ready: true, missing: [],
  },
};

function stub(url: string): unknown {
  if (url.startsWith('/api/academy/plan-inputs')) {
    const asked = (new URL(url, 'http://x').searchParams.get('athleteIds') || '').split(',');
    return { inputs: Object.fromEntries(asked.filter(id => PLAN_INPUTS[id]).map(id => [id, PLAN_INPUTS[id]])) };
  }
  if (url.startsWith('/api/academy/library')) {
    return { entries: [...CANON, ...SHELF], viewer: { athleteId: 'me', isManager: true } };
  }
  if (url.startsWith('/api/academy/tests')) return { protocol: '30min', rows: ROWS, pending: [] };
  if (url.startsWith('/api/academy/workouts')) {
    return { workouts: [{ id: 'w1', name: 'קל 6 ק״מ', created_at: '', workout: { dayOfWeek: 0, name: 'קל 6 ק״מ', steps: [] } }] };
  }
  if (url.startsWith('/api/plans')) {
    // Only the per-athlete read seeds the board; the unscoped one is the club's group plan,
    // and an empty list there is the common case (and greys `תוכנית הקבוצה`).
    const week = new URL(url, 'http://x').searchParams.get('week_start_date');
    return url.includes('athlete_id=a1')
      ? { plans: [{ ...SAVED_PLAN, week_start_date: week }] }
      : { plans: [] };
  }
  return {};
}

/**
 * Installed at module scope, guarded on `window`, and never uninstalled.
 *
 * It has to be in place before the composer's own effects run, and a child's effects run
 * before its parent's — so there is no hook in this file early enough to do it. Module scope
 * is, and it also means the page renders identically on the server and on the client, which
 * a `ready` flag in state would not.
 */
if (typeof window !== 'undefined' && !(window as { __composerStub?: boolean }).__composerStub) {
  (window as { __composerStub?: boolean }).__composerStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/')) {
      // Writes are swallowed rather than served: this screen is for looking at, and a
      // preview that pushed to a watch would be a preview nobody should open.
      if (init?.method && init.method !== 'GET') return new Response('{"ok":true}', { status: 200 });
      return new Response(JSON.stringify(stub(url)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewAcademyComposerBook() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-screen bg-page p-4" dir="rtl">
      <h1 className="mb-1 text-lg font-bold text-ink-900">לוח השבוע · אימון מהספר</h1>
      <p className="mb-4 text-xs text-ink-400 leading-relaxed">
        חמישי נטען מתוכנית שמורה (עם קצבים). שלושה נמענים: עם טסט ועם דבוקה, עם טסט בלי
        דבוקה, ובלי כלום. בחירה ← ספר האימונים כדי למלא יום מהספר — שורה כזו לא מציגה קצב.
        למעלה מופיע מה שנאמר בשיחת האפיון, וחמישי הוא יום שרות לא מתאמנת בו — שום דבר מזה
        לא חוסם שליחה.
      </p>
      <AcademyPlanComposer athletes={ATHLETES as unknown as Parameters<typeof AcademyPlanComposer>[0]['athletes']} />
    </div>
  );
}

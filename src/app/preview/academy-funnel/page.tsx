'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { israelToday } from '@/lib/utils';
import { buildFunnel, type CandidateEvent, type CandidateRow } from '@/lib/academy/funnel';
import { CandidateSheet, FunnelBoardView } from '@/components/academy/CandidateFunnel';

// ── Login-free preview of the candidates board ───────────────────────────────
//
// The fixture goes through the REAL `buildFunnel`, so which section every
// candidate lands in, the order inside a section, and every `תקוע` chip below are
// the shipped verdicts. That is the only way a preview of a ranked board is worth
// auditing: a row in the wrong place here is a bug and not a fixture typo.
//
// Deterministic, like every other preview in this directory: fixtures built from
// `Date.now()` at module scope are evaluated once on the server and again in the
// browser, and the resulting hydration mismatch makes React throw out the whole
// tree. Every date here is counted back from the Israel calendar day.
//
// Development only. In production the route does not exist.

const DAY = 24 * 3_600_000;

/** An Israel wall-clock morning `daysAgo` before today, as an instant. */
function at(daysAgo: number, hhmm = '09:00'): string {
  const day = israelToday(new Date(Date.parse(israelToday()) - daysAgo * DAY));
  return new Date(`${day}T${hhmm}:00+03:00`).toISOString();
}

// One candidate per state the board can render, deliberately in the wrong order
// so the sort is doing visible work.
const CANDIDATES: (CandidateRow & { email?: string | null; phone?: string | null })[] = [
  // An Instagram DM nobody has chased. Waiting for the form, 6 days: stuck.
  { id: 'dm', name: 'רון לוי', source: 'instagram', goal: 'מרתון', createdAt: at(6) },
  // Arrived through the form this morning. Step one is already stamped, so she is
  // waiting for the intro call and is the calmest row on the board.
  { id: 'fresh', name: 'מיכל כהן', source: 'form', goal: '10 ק״מ', createdAt: at(0), email: 'michal@example.com' },
  // Spoke to Yossi 5 days ago and nobody has called since. The characterization
  // call is the first of the two waits where candidates are actually lost.
  { id: 'chars', name: 'אבי ברק', source: 'form', goal: 'חצי מרתון', createdAt: at(12), phone: '050-1234567' },
  // Signed up, connected a watch, and the test has not happened. Four days in,
  // which is NOT stuck — seven is the threshold, because fitting a 30-minute test
  // around a life is not negligence. The single most important non-red row here.
  { id: 'test', name: 'נועה שמש', source: 'instagram', goal: 'חצי מרתון', athleteId: 'a2', createdAt: at(20) },
  // Nine days waiting for the test: past seven, so the same wait now IS red.
  { id: 'late-test', name: 'דור אלון', source: 'form', goal: 'מרתון', athleteId: 'a3', createdAt: at(30) },
  // The test came back and nobody analysed it. Two days, threshold two — this is
  // the row that proves the chip tips over ON the threshold day.
  { id: 'analysis', name: 'יעל פרץ', source: 'form', goal: '10 ק״מ', athleteId: 'a4', createdAt: at(40) },
  // Said no. Off the board entirely, and NOT deleted: the reason is the answer to
  // "why is he not here", which a deleted row cannot give.
  { id: 'gone', name: 'עומר טל', source: 'instagram', createdAt: at(25), archivedAt: at(9), archivedReason: 'מחיר גבוה מדי בשלב הזה' },
];

const STEP = (candidateId: string, stage: string, daysAgo: number, over: Partial<CandidateEvent> = {}): CandidateEvent =>
  ({ candidateId, stage, occurredAt: at(daysAgo), ...over });

const EVENTS: CandidateEvent[] = [
  STEP('fresh', 'form', 0, { recordedBy: 'yossi@madregot.app' }),

  STEP('chars', 'form', 12),
  STEP('chars', 'intro_call', 5, { recordedBy: 'yossi@madregot.app', note: 'מאוד מתלהב, רץ לבד שנתיים' }),

  STEP('test', 'form', 20),
  STEP('test', 'intro_call', 18, { recordedBy: 'yossi@madregot.app' }),
  STEP('test', 'characterization', 16, { recordedBy: 'ofer@madregot.app', note: 'אכילס לפני חצי שנה — להתחיל זהיר' }),
  STEP('test', 'signup', 4, { recordedBy: 'ofer@madregot.app' }),

  STEP('late-test', 'form', 30),
  STEP('late-test', 'intro_call', 28),
  STEP('late-test', 'characterization', 25),
  STEP('late-test', 'signup', 9),

  STEP('analysis', 'form', 40),
  STEP('analysis', 'intro_call', 38),
  STEP('analysis', 'characterization', 36),
  STEP('analysis', 'signup', 30),
  STEP('analysis', 'test', 2, { recordedBy: 'ofer@madregot.app', note: '6.42 ק״מ ב-30 דקות' }),

  STEP('gone', 'form', 25),
  STEP('gone', 'intro_call', 24, { recordedBy: 'yossi@madregot.app', note: 'ביקש לחשוב על זה' }),
];

export default function AcademyFunnelPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  // A query string chooses the state, which is how two audit entries can screenshot
  // the board and an open card without one navigation interrupting the other.
  //
  // Read in an effect and not in the `useState` initializer: the initializer runs on
  // the server too, where `window` does not exist, so `?card` would render a closed
  // sheet on the server and an open one on the client — the hydration mismatch that
  // makes React discard the tree.
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (window.location.search.includes('card')) setOpenId('analysis');
  }, []);

  const board = buildFunnel({
    candidates: CANDIDATES,
    events: EVENTS,
    now: new Date(at(0, '12:00')).toISOString(),
  });

  const open = CANDIDATES.find(c => c.id === openId) ?? null;

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md">
        <div className="pb-4">
          <h1 className="text-xl font-bold text-ink-900">מועמדים</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · נתוני דמה</p>
        </div>
        <FunnelBoardView board={board} onOpen={setOpenId} onAdd={() => undefined} />
        <CandidateSheet
          candidate={open}
          events={EVENTS}
          open={openId !== null}
          onOpenChange={o => { if (!o) setOpenId(null); }}
          onStep={() => undefined}
          onUnstep={() => undefined}
        />
      </div>
    </div>
  );
}

'use client';

import { notFound } from 'next/navigation';
import { useState } from 'react';
import { GoalSheet, goalSummary } from '@/components/academy/completion/GoalSheet';
import { EMPTY_GOAL, goalProgress, goalTimeText, type Goal } from '@/lib/academy/goal';
import { PersonalRaceBanner } from '@/components/GoalRaceBanner';

// The goal module (mockup academy-existing-add/goal-module.html) on a stubbed fetch: the
// club's three upcoming races as prod has them on 2026-10-17, and a 4:15/km threshold.
// ?noTest=1 drops the test, so the time step shows its no-estimate state.
// Development only. In production the route does not exist.

const TODAY = '2026-10-17';
function stub(url: string): unknown {
  if (url.startsWith('/api/academy/goal')) {
    const noTest = new URLSearchParams(window.location.search).get('noTest') === '1';
    return {
      today: TODAY,
      goal: EMPTY_GOAL,
      source: 'none',
      stored: true,
      thresholdSecPerKm: noTest ? null : 255,
      clubRaces: [
        { eventId: '11111111-1111-4111-8111-111111111111', name: 'חצי מרתון עמק החולה', date: '2026-10-30', location: 'עמק החולה', distancesKm: [21.0975, 10] },
        { eventId: '22222222-2222-4222-8222-222222222222', name: 'מרוץ אייל', date: '2026-11-14', location: 'קיבוץ אייל, מרכז', distancesKm: [21.0975, 10] },
        { eventId: '33333333-3333-4333-8333-333333333333', name: "מרתון ולנסיה '26", date: '2026-12-06', location: 'Valencia, Spain', distancesKm: [42.195, 21.0975, 10] },
      ],
    };
  }
  return {};
}

if (typeof window !== 'undefined' && !(window as { __goalStub?: boolean }).__goalStub) {
  (window as { __goalStub?: boolean }).__goalStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/')) return new Response(JSON.stringify(stub(url)), { status: 200, headers: { 'content-type': 'application/json' } });
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewAcademyGoal() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [open, setOpen] = useState(true);
  const [goal, setGoal] = useState<Goal>(EMPTY_GOAL);
  return (
    <div className="min-h-[100dvh] bg-page p-4 pt-14" dir="rtl">
      <button type="button" onClick={() => setOpen(true)} className="w-full rounded-2xl bg-card p-4 text-start">
        <span className="block text-xs font-bold text-ink-400">המטרה</span>
        <span className="block text-[15px] font-bold text-ink-900" data-testid="summary">{goalSummary(goal) ?? 'אין מטרה'}</span>
      </button>
      {goal.targetRace && goal.targetRaceDate && (() => {
        const p = goalProgress(goal.targetRaceDate, TODAY, goal.distanceKm);
        return p.days != null ? (
          <div className="mt-3" data-testid="banner">
            <PersonalRaceBanner name={goal.targetRace} raceDate={goal.targetRaceDate} days={p.days} week={p.week} totalWeeks={p.totalWeeks}
              weeksToBlock={p.weeksToBlock} goalTime={goal.goalTimeSec ? goalTimeText(goal.goalTimeSec) : null} dateIsEstimate={goal.dateIsEstimate} />
          </div>
        ) : null;
      })()}
      <pre className="mt-3 overflow-auto rounded-xl bg-card p-3 text-[11px] text-ink-500" dir="ltr" data-testid="saved">{JSON.stringify(goal, null, 1)}</pre>
      <GoalSheet open={open} onOpenChange={setOpen} goal={goal} athleteId="preview" onDone={(g) => { setGoal(g); setOpen(false); }} />
    </div>
  );
}

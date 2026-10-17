'use client';

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RaceResultCard } from '@/components/academy/RaceResultCard';
import type { HomeRaceResult } from '@/lib/academy/trainee-home';

// "איך היה?" (goal module G5) on a stubbed fetch. ?noRun=1: nothing on the watch, so the
// official time is typed. Development only. In production the route does not exist.

if (typeof window !== 'undefined' && !(window as { __rrStub?: boolean }).__rrStub) {
  (window as { __rrStub?: boolean }).__rrStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/')) return new Response(JSON.stringify({ ok: true, today: '2026-12-08', clubRaces: [], thresholdSecPerKm: 250 }), { status: 200, headers: { 'content-type': 'application/json' } });
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewRaceResult() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [noRun, setNoRun] = useState<boolean | null>(null);
  useEffect(() => { setNoRun(new URLSearchParams(window.location.search).get('noRun') === '1'); }, []);
  if (noRun === null) return null;
  const race: HomeRaceResult = {
    name: "מרתון ולנסיה '26", raceDate: '2026-12-06', distanceKm: 42.195, goalTimeSec: 12000,
    run: noRun ? null : { activityId: '44444444-4444-4444-8444-444444444444', km: 42.4, sec: 11381 },
  };
  return (
    <div className="min-h-[100dvh] bg-page p-4 pt-14" dir="rtl">
      <RaceResultCard athleteId="preview" race={race} onDone={() => {}} />
    </div>
  );
}

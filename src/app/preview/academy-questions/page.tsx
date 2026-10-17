'use client';

import { notFound } from 'next/navigation';
import { QuickQuestionsCard } from '@/components/academy/QuickQuestionsCard';

// The trainee's "4 questions" card and sheet on a stubbed fetch. Development only.

if (typeof window !== 'undefined' && !(window as { __qqStub?: boolean }).__qqStub) {
  (window as { __qqStub?: boolean }).__qqStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('/api/academy/characterization/self')) return json(init?.method === 'PUT' ? { answered: true } : { availableDays: [], weeklyKm: null, limitations: null, answered: false, suggestedWeeklyKm: 47 });
    if (url.startsWith('/api/academy/goal')) return json({ today: '2026-10-17', goal: { goalType: 'full', targetRace: "מרתון ולנסיה '26", targetRaceDate: '2026-12-06', goalTimeSec: 12000, distanceKm: 42.195 }, clubRaces: [], thresholdSecPerKm: 255 });
    if (url.startsWith('/api/')) return json({});
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewQuestions() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <div className="min-h-[100dvh] bg-page p-4 pt-14" dir="rtl"><QuickQuestionsCard athleteId="preview" /></div>;
}

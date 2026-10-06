'use client';

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AcademyMyView } from '@/components/academy/AcademyMyView';
import { ThreadTranscript, type ThreadMessage } from '@/components/academy/ThreadTranscript';
import { Sheet } from '@/components/ui';
import { addDaysToDateStr, israelToday, planWeekStartOf } from '@/lib/utils';
import type { HomeWorkout, TraineeHome } from '@/lib/academy/trainee-home';
import type { WorkoutSheet } from '@/lib/academy/workout-sheet';

// The trainee's academy home on an iPhone 14, on a stubbed `fetch` — the same
// harness as /preview/academy-admin: the shell's chrome is drawn to size (103px
// header incl. safe area, 83px tab bar) so "screen one fits above the fold" can be
// measured, not guessed. Only the network is replaced; writes are swallowed.
//
//   ?case=invite   a confirmed test today — the invitation must sit at the TOP
//   ?case=thread   the conversation sheet's layout, with a long transcript
//
// The week is built around the real today, so the "today" row is always today:
// days before it are run (the first an interval session, the second an easy run
// cut short), today's is the expanded one, later ones are still to come.

const WEEK = planWeekStartOf();
const TODAY = israelToday();
const ATHLETE = 't1';
const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const TODAY_DOW = dow(TODAY);

type Template = { dow: number; name: string; plannedM: number; durationSec: number; plannedPace: number };
const PLAN: Template[] = [
  { dow: 0, name: 'אינטרוולים 6×800', plannedM: 10000, durationSec: 3300, plannedPace: 250 },
  { dow: 1, name: 'ריצה קלה 10 ק״מ', plannedM: 10000, durationSec: 3400, plannedPace: 340 },
  { dow: 2, name: 'טמפו 3×2 ק״מ', plannedM: 9000, durationSec: 2900, plannedPace: 290 },
  { dow: 4, name: 'ריצה קלה 8 ק״מ', plannedM: 8000, durationSec: 2700, plannedPace: 340 },
  { dow: 6, name: 'ארוכה 16 ק״מ', plannedM: 16000, durationSec: 5500, plannedPace: 345 },
];

function homeWorkout(t: Template, index: number): HomeWorkout {
  const date = addDaysToDateStr(WEEK, t.dow);
  const base: HomeWorkout = {
    date, name: t.name, plannedM: t.plannedM, actualM: null, plannedDurationSec: t.durationSec,
    pace: null, plannedPace: t.plannedPace, hasFeedback: false, status: { kind: 'upcoming' },
  };
  if (t.dow === TODAY_DOW) {
    return {
      ...base,
      steps: [
        { kind: 'warmup', label: 'חימום 2 ק״מ', pace: 340 },
        { kind: 'main', label: '3 × 2 ק״מ · מנוחה 2 דק׳', pace: 290 },
        { kind: 'cooldown', label: 'שחרור 1.5 ק״מ', pace: 350 },
      ],
    };
  }
  if (t.dow > TODAY_DOW) return base;
  // The past: the first session run on plan (reps a touch fast), the second cut
  // short and slow, anything later missed.
  if (index === 0) {
    return { ...base, status: { kind: 'done', score: 91 }, actualM: 10300, pace: { actual: 248, verdict: { kind: 'on', deltaSec: 0 } }, hasFeedback: true };
  }
  if (index === 1) {
    return { ...base, status: { kind: 'partial', pct: 62 }, actualM: 6200, pace: { actual: 358, verdict: { kind: 'slow', deltaSec: 18 } } };
  }
  return { ...base, status: { kind: 'missed' } };
}

const WORKOUTS = PLAN.map(homeWorkout);

const KM = [22, 26, 24, 28, 31, 30, 34, 36, 33, 38, 41];
const HOME: TraineeHome = {
  isMember: true,
  weekStart: WEEK,
  athlete: { athleteId: ATHLETE, name: 'Noa Barak', avatarUrl: null, hasWatch: true },
  coach: { id: 'dana', name: 'Dana Levi', avatarUrl: null },
  unread: 1,
  goal: { title: 'חצי מרתון טבריה', subtitle: 'היעד: חצי מרתון · סביב 1:45', daysLeft: 45 },
  paces: { bandNumber: 4, easy: 340, tempo: 290, threshold: 275, interval: 250, source: 'band' },
  km: {
    weeks: [...KM.map((km, i) => ({ weekStart: addDaysToDateStr(WEEK, -7 * (11 - i)), km })),
      { weekStart: WEEK, km: Math.round(WORKOUTS.reduce((s, w) => s + (w.actualM ?? 0), 0) / 100) / 10 }],
    plannedKm: 53,
    avgKm: 31.2,
  },
  week: {
    plannedCount: WORKOUTS.length,
    completedCount: WORKOUTS.filter((w) => w.actualM != null).length,
    workouts: WORKOUTS,
  },
  journey: { monthsWithUs: 3.5, runs: 47, km: 486, planPct: 89, streakWeeks: 6, longestKm: 21.3 },
};

const ROUTE = Array.from({ length: 40 }, (_, i) => ({
  lat: 32.1 + Math.sin(i / 6) * 0.004 + i * 0.0002,
  lng: 34.8 + Math.cos(i / 6) * 0.006,
}));

const INTERVAL_SHEET: WorkoutSheet = {
  date: WORKOUTS[0].date,
  name: 'אינטרוולים 6×800',
  activityId: 'act-1',
  startClock: '6:12',
  locationName: 'פארק הירקון',
  status: { kind: 'done', score: 91 },
  badge: { value: 91, kind: 'accuracy' },
  distance: { actualM: 10300, plannedMinM: 10000, plannedMaxM: 10000, verdict: { kind: 'on', delta: 0 } },
  pace: { label: 'קצב החזרות', actual: 248, targetMin: 250, targetMax: 250, verdict: { kind: 'on', deltaSec: 0 } },
  time: { actualSec: 3260, plannedSec: 3300, estimated: true, verdict: { kind: 'on', delta: 0 } },
  chart: {
    mode: 'reps', bandMin: 245, bandMax: 255, target: 250,
    points: [249, 243, 251, 250, 259, 248].map((pace, i) => ({
      label: String(i + 1), pace, kind: pace < 245 ? 'fast' : pace > 255 ? 'slow' : 'on',
    })),
  },
  steps: [
    { label: 'חימום 2 ק״מ', plannedMin: 340, plannedMax: 340, actual: 339, verdict: { kind: 'on', deltaSec: 0 } },
    { label: 'חזרה 1', plannedMin: 250, plannedMax: 250, actual: 249, verdict: { kind: 'on', deltaSec: 0 } },
    { label: 'חזרה 2', plannedMin: 250, plannedMax: 250, actual: 243, verdict: { kind: 'fast', deltaSec: 7 } },
    { label: 'חזרה 3', plannedMin: 250, plannedMax: 250, actual: 251, verdict: { kind: 'on', deltaSec: 0 } },
    { label: 'חזרה 4', plannedMin: 250, plannedMax: 250, actual: 250, verdict: { kind: 'on', deltaSec: 0 } },
    { label: 'חזרה 5', plannedMin: 250, plannedMax: 250, actual: 259, verdict: { kind: 'slow', deltaSec: 9 } },
    { label: 'חזרה 6', plannedMin: 250, plannedMax: 250, actual: 248, verdict: { kind: 'on', deltaSec: 0 } },
    { label: 'שחרור 1.5 ק״מ', plannedMin: 350, plannedMax: 350, actual: 362, verdict: { kind: 'slow', deltaSec: 12 } },
  ],
  route: ROUTE,
  feedback: { text: 'חזרות מצוינות. החמישית הייתה איטית, זה בסדר. בפעם הבאה חימום מלא.', mentorName: 'Dana Levi' },
  toleranceSec: 5,
};

const PARTIAL_SHEET: WorkoutSheet = {
  date: WORKOUTS[1].date,
  name: 'ריצה קלה 10 ק״מ',
  activityId: 'act-2',
  startClock: '19:40',
  locationName: null,
  status: { kind: 'partial', pct: 62 },
  badge: { value: 62, kind: 'plan' },
  distance: { actualM: 6200, plannedMinM: 10000, plannedMaxM: 10000, verdict: { kind: 'less', delta: 3800 } },
  pace: { label: 'קצב ממוצע', actual: 358, targetMin: 340, targetMax: 340, verdict: { kind: 'slow', deltaSec: 18 } },
  time: { actualSec: 2223, plannedSec: 3420, estimated: true, verdict: { kind: 'less', delta: 1197 } },
  chart: {
    mode: 'km', bandMin: 335, bandMax: 345, target: 340,
    points: [341, 344, 352, 364, 375, 372].map((pace, i) => ({
      label: i === 0 ? 'ק״מ 1' : String(i + 1), pace, kind: pace < 335 ? 'fast' : pace > 345 ? 'slow' : 'on',
    })),
  },
  steps: [],
  route: ROUTE.slice(0, 22),
  feedback: null,
  toleranceSec: 5,
};

const at = (days: number, time: string) => new Date(`${addDaysToDateStr(TODAY, days)}T${time}:00+03:00`).toISOString();

const THREAD: ThreadMessage[] = Array.from({ length: 44 }, (_, i) => {
  const coach = i % 3 !== 1;
  return {
    id: `m${i}`,
    authorName: coach ? 'Dana Levi' : 'Noa Barak',
    seat: coach ? 'coach' : 'trainee',
    text: coach ? `הודעה ${i + 1} מהמאמנת: איך הרגישו הרגליים אחרי האימון?` : `תשובה ${i + 1}: טוב, קצת כבדות בסוף.`,
    at: at(-Math.floor((44 - i) / 4), `0${7 + (i % 3)}:1${i % 10}`),
  };
});

function stub(url: string): unknown {
  const c = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('case') : null;
  if (url.startsWith('/api/academy/me')) return HOME;
  if (url.startsWith('/api/academy/workout')) {
    const date = new URL(url, 'http://x').searchParams.get('date');
    if (date === INTERVAL_SHEET.date) return { sheet: INTERVAL_SHEET };
    if (date === PARTIAL_SHEET.date) return { sheet: PARTIAL_SHEET };
    const w = WORKOUTS.find((x) => x.date === date);
    return {
      sheet: {
        ...PARTIAL_SHEET, date: date ?? '', name: w?.name ?? '', activityId: null, startClock: null, status: { kind: 'upcoming' }, badge: null,
        distance: { actualM: null, plannedMinM: w?.plannedM ?? 0, plannedMaxM: w?.plannedM ?? 0, verdict: null },
        pace: { label: 'קצב', actual: null, targetMin: w?.plannedPace ?? 300, targetMax: w?.plannedPace ?? 300, verdict: null },
        time: { actualSec: null, plannedSec: w?.plannedDurationSec ?? 3000, estimated: true, verdict: null },
        chart: null, steps: [], route: null,
      } satisfies WorkoutSheet,
    };
  }
  if (url.startsWith('/api/academy/test-invitation')) {
    return c === 'invite'
      ? { invitation: { id: 'inv-1', athleteId: ATHLETE, protocol: '30min', proposedSlots: [at(0, '18:00')], confirmedSlot: at(0, '18:00'), status: 'confirmed' } }
      : { invitation: null };
  }
  if (url.startsWith('/api/academy/tests')) {
    return {
      trend: {
        protocol: '30min',
        points: [
          { testId: 'x1', date: addDaysToDateStr(TODAY, -97), protocol: '30min', distanceM: 6338, durationSec: 1800, paceSec: 284, avgHr: null, deltaPrevSec: null, deltaFirstSec: null, directionPrev: null, directionFirst: null },
          { testId: 'x2', date: addDaysToDateStr(TODAY, -34), protocol: '30min', distanceM: 6545, durationSec: 1800, paceSec: 275, avgHr: null, deltaPrevSec: -9, deltaFirstSec: -9, directionPrev: 'improved', directionFirst: 'improved' },
        ],
        totalDeltaSec: -9, totalDirection: 'improved', spanDays: 63, excluded: [],
      },
      pending: [],
    };
  }
  return {};
}

if (typeof window !== 'undefined' && !(window as { __traineeStub?: boolean }).__traineeStub) {
  (window as { __traineeStub?: boolean }).__traineeStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/')) {
      // The thread panel's open call is left hanging, so the sheet shows its own
      // loading state rather than an error about a Stream the harness doesn't have.
      if (url.startsWith('/api/academy/threads')) return new Promise<Response>(() => {});
      if (init?.method && init.method !== 'GET') return new Response(init.body ?? '{}', { status: 200 });
      return new Response(JSON.stringify(stub(url)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewAcademyTrainee() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [threadOpen, setThreadOpen] = useState(false);
  // After mount, so the server's render and the first client render agree.
  useEffect(() => { if (new URLSearchParams(window.location.search).get('case') === 'thread') setThreadOpen(true); }, []);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-page" dir="rtl">
      <div id="chrome-top" className="h-[103px] shrink-0 border-b border-page bg-card/90" />
      <main id="app-main" className="mx-auto w-full max-w-7xl flex-1 min-h-0 overflow-y-auto px-4 pt-5 pb-4">
        <div className="mx-auto max-w-3xl">
          <AcademyMyView athleteId={ATHLETE} />
        </div>
      </main>
      <div id="chrome-bottom" className="h-[83px] shrink-0 border-t border-page bg-card/95" />
      <Sheet
        open={threadOpen}
        onOpenChange={setThreadOpen}
        title="השיחה עם Dana"
        className="h-[88dvh]"
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden pb-3"
      >
        <ThreadTranscript messages={THREAD} viewerSeat="trainee" onSend={() => {}} layout="sheet" className="min-h-0 flex-1" />
      </Sheet>
    </div>
  );
}

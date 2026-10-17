'use client';

/**
 * Dev preview of the Management page's role parts (2026-10-17), drawn with fixtures
 * through SWR's fallback so the real components render without a staff session:
 * `?lens=coach` (academy coach, "today by trainee"), `?lens=manager` (academy
 * manager summary), `?lens=trainee` (the coach's trainee header).
 */

import { notFound, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SWRConfig } from 'swr';
import { AcademyCoachToday } from '@/components/management/AcademyCoachToday';
import { AcademyManagerSummary } from '@/components/management/AcademyManagerSummary';
import { TraineeHeader } from '@/components/academy/TraineeHeader';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import type { BoardTrainee, DayState } from '@/lib/academy/coach-today';

const today = israelToday();
const day = (n: number) => addDaysToDateStr(today, n);
const strip = (s: DayState[]) => s.map((state, i) => ({ date: day(i - 6), state }));
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const base = (o: Partial<BoardTrainee> & { athleteId: string; name: string }) => ({
  today: { name: '', plannedM: 0, paceMin: null, paceMax: null, state: 'rest', actual: null, score: null, direction: null },
  tomorrow: null, strip: strip(['done', 'done', 'rest', 'done', 'done', 'rest', 'done']),
  weekKm: { done: 30, planned: 36 }, lastFeel: { feel: 3, difficulty: 6 }, reasons: [],
  avatarUrl: null, phone: '0501234567', ...o,
});

const TRAINEES = [
  base({
    athleteId: 'raz', name: 'Raz Kedem', reasons: [{ kind: 'missedStreak', count: 3 }],
    today: { name: 'ארוכה', plannedM: 14000, paceMin: null, paceMax: null, state: 'notyet', actual: null, score: null, direction: null },
    strip: strip(['done', 'missed', 'rest', 'missed', 'missed', 'rest', 'today']), weekKm: { done: 9, planned: 38 },
    tomorrow: { name: 'קלה 8 ק״מ', plannedM: 8000 },
  }),
  base({
    athleteId: 'yoav', name: 'Yoav Cohen', reasons: [{ kind: 'pain', detail: 'ברך שמאל', level: 7 }, { kind: 'offPlan', direction: 'too_fast', score: 61 }],
    today: { name: 'ריצה קלה', plannedM: 8000, paceMin: 360, paceMax: 380, state: 'done', actual: { distanceM: 8100, durationSec: 3012, pace: 365, hr: 149 }, score: 61, direction: 'too_fast' },
    strip: strip(['done', 'missed', 'rest', 'done', 'missed', 'rest', 'done']), weekKm: { done: 22, planned: 32 },
  }),
  base({
    athleteId: 'adi', name: 'Adi Nir', reasons: [{ kind: 'wantsReply', comment: 'אפשר להזיז את הטמפו למחר?' }],
    today: { name: 'טמפו 3×2 ק״מ', plannedM: 10000, paceMin: 255, paceMax: 265, state: 'notyet', actual: null, score: null, direction: null },
    strip: strip(['done', 'done', 'rest', 'done', 'done', 'rest', 'today']), weekKm: { done: 31, planned: 46 },
    tomorrow: { name: 'קלה 10 ק״מ', plannedM: 10000 },
  }),
  base({
    athleteId: 'noa', name: 'Noa Barak',
    today: { name: '6×800', plannedM: 9000, paceMin: 225, paceMax: 235, state: 'done', actual: { distanceM: 9200, durationSec: 2590, pace: 281, hr: 158 }, score: 92, direction: 'on_target' },
    weekKm: { done: 41, planned: 44 },
  }),
  base({ athleteId: 'shir', name: 'Shir Levi', strip: strip(['done', 'done', 'rest', 'done', 'done', 'done', 'rest']) }),
];

const FIXTURES: Record<string, unknown> = {
  '/api/academy/coach-today?scope=coach': {
    today,
    trainees: TRAINEES,
    events: [
      { athleteId: 'noa', name: 'Noa Barak', at: hoursAgo(1), kind: 'run', text: '6×800', score: 92 },
      { athleteId: 'yoav', name: 'Yoav Cohen', at: hoursAgo(1.5), kind: 'pain', text: 'ברך שמאל, 4/10' },
      { athleteId: 'adi', name: 'Adi Nir', at: hoursAgo(2), kind: 'reply', text: 'אפשר להזיז את הטמפו למחר?' },
      { athleteId: 'shir', name: 'Shir Levi', at: hoursAgo(26), kind: 'feedback', text: 'קשה, הרגשה טובה' },
    ],
  },
  '/api/academy/threads/inbox?scope=coach': {
    rows: [
      { athleteId: 'noa', name: 'Noa Barak', lastTraineeMessageAt: hoursAgo(0.5), lastStaffMessageAt: hoursAgo(20), unreadCount: 1, lastText: 'שלחתי תמונה מהאימון 🙌', lastFromTrainee: true, reason: 'unread', waitingHours: 0.5, quietDays: null, urgency: 1 },
      { athleteId: 'yoav', name: 'Yoav Cohen', lastTraineeMessageAt: hoursAgo(1), lastStaffMessageAt: hoursAgo(30), unreadCount: 1, lastText: 'הברך כואבת קצת אחרי הריצה, לעשות מחר מנוחה?', lastFromTrainee: true, reason: 'awaiting_reply', waitingHours: 1, quietDays: null, urgency: 2 },
      { athleteId: 'adi', name: 'Adi Nir', lastTraineeMessageAt: hoursAgo(2), lastStaffMessageAt: hoursAgo(48), unreadCount: 2, lastText: 'אפשר להזיז את הטמפו למחר? יש לי משמרת', lastFromTrainee: true, reason: 'awaiting_reply', waitingHours: 2, quietDays: null, urgency: 3 },
    ],
  },
  '/api/academy/summary': { trainees: 14, coaches: 3, unpaired: 2, inFunnel: 2, registrationOpen: true },
  '/api/academy/home': {
    scope: 'academy', month: { joined: 2, left: 0 }, today: { count: 0, firstAt: null }, coachCapacity: 8,
    weeks: [3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 11, 14].map((n, i) => ({ weekStart: day(-7 * (11 - i)), trainees: n, existing: n, joined: 0, left: 0 })),
    approvals: [{ athleteId: 'shir', name: 'Shir Levi', submittedAt: hoursAgo(20) }],
    funnel: { live: 2, forms: [{ id: 'f1', name: 'Candidate 3', since: day(-1) }], stuck: [{ id: 's1', name: 'Candidate 4', since: day(-15), waiting: 'form', days: 15 }] },
  },
  '/api/academy/coach-today': { today, trainees: TRAINEES, events: [] },
  '/api/academy/me?athleteId=noa': {
    isMember: true, weekStart: day(-6),
    test: { kind: 'ok', date: day(-30), ageDays: 30, old: false },
    athlete: { athleteId: 'noa', name: 'Noa Barak', avatarUrl: null, hasWatch: true, phone: '0501234567' },
    coach: { id: 'dana', name: 'Dana Levi', avatarUrl: null },
    coaches: [{ id: 'dana', name: 'Dana Levi', avatarUrl: null }],
    goal: { title: 'חצי מרתון טבריה', subtitle: null, daysLeft: 45, goalTime: '1:45:00', week: 7, totalWeeks: 13 },
    paces: { bandNumber: 6, easy: 340, tempo: 290, threshold: 275, interval: 250, source: 'test' },
    km: {
      weeks: [[28, 30], [31, 32], [30, 34], [35, 36], [37, 38], [22, 40], [39, 40], [41, 42], [43, 44], [40, 44], [45, 46], [31, 46]]
        .map(([km, p], i) => ({ weekStart: day(-7 * (11 - i)), km, plannedKm: p })),
      plannedKm: 46, avgKm: 37,
    },
    journey: { monthsWithUs: 3, runs: 47, km: 486, planPct: 89, streakWeeks: 6, longestKm: 21.3 },
  },
};

function Lens() {
  const lens = useSearchParams().get('lens') || 'coach';
  return (
    <div dir="rtl" className="mx-auto max-w-md space-y-3 bg-page p-4">
      {lens === 'coach' && <AcademyCoachToday scope="coach" />}
      {lens === 'manager' && <AcademyManagerSummary />}
      {lens === 'trainee' && <TraineeHeader athleteId="noa" />}
    </div>
  );
}

export default function PreviewManagement() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <SWRConfig value={{ fallback: FIXTURES, revalidateOnMount: false, revalidateOnFocus: false, fetcher: () => new Promise(() => {}) }}>
      <Suspense fallback={null}><Lens /></Suspense>
    </SWRConfig>
  );
}

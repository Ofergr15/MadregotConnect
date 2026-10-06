'use client';

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AcademyShell } from '@/components/academy/AcademyShell';
import type { AcademyMember, AcademyMembersResponse } from '@/components/academy/types';
import { buildDispatchReport, type DeliveryRow } from '@/lib/academy/dispatch';
import { buildInbox } from '@/lib/academy/thread';
import { buildQueue } from '@/lib/academy/queue';
import { buildRegistry } from '@/lib/academy/tests';
import { trendWeeks } from '@/lib/academy/trends';
import { israelToday, planWeekStartOf } from '@/lib/utils';

// The academy staff screen, version 5 (mockup academy-manager-v5.html), as the
// manager sees it on an iPhone 14, on a stubbed `fetch`: the shell's chrome is
// drawn to size so the home can be compared with the mockup's phone 1. `?coach=1`
// shows a plain academy coach's lens. Only the network is replaced; writes are
// swallowed.

const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const hoursAgo = (n: number) => new Date(today.getTime() - n * 3_600_000).toISOString();

// `coach` is one coach, or several for a shared trainee (migration 135).
const m = (athleteId: string, name: string, coach: [string, string] | Array<[string, string]> | null, band: string | null, o: Partial<AcademyMember> = {}): AcademyMember => {
  const set: Array<[string, string]> = !coach ? [] : Array.isArray(coach[0]) ? (coach as Array<[string, string]>) : [coach as [string, string]];
  return mk(athleteId, name, set, band, o);
};
const mk = (athleteId: string, name: string, set: Array<[string, string]>, band: string | null, o: Partial<AcademyMember>): AcademyMember => ({
  athleteId, name, email: '', avatarUrl: null, groupId: null, groupName: null,
  academyCoachId: set[0]?.[0] ?? null, academyCoachName: set[0]?.[1] ?? null,
  academyCoachIds: set.map((c) => c[0]), academyCoachNames: set.map((c) => c[1]),
  band: band ? { id: band, name: band, bandNumber: 3, paceProfile: { offsetSeconds: 0 } } : null,
  paceOffsetSec: null, status: 'active', role: 'runner', approved: true, hasWatch: true, hasGarmin: true, hasStrava: false,
  joinedAt: null, academyJoinedOn: daysAgo(90), weekKm: 24.3, weekRuns: 3, weekDurationMin: 150, totalKm: 400, totalRuns: 60,
  lastActivityAt: null, daysSinceActivity: 1, plannedCount: 4, completedCount: 3, completionRate: 0.75, attention: [],
  ...o,
} as unknown as AcademyMember);

const DANA: [string, string] = ['dana', 'Dana Levi'];
const GUY: [string, string] = ['guy', 'Guy Ziv'];
const MEMBERS: AcademyMember[] = [
  m('t1', 'Noa Barak', DANA, 'דבוקה 4', { weekKm: 0, weekRuns: 0, completedCount: 0, completionRate: 0, daysSinceActivity: 9, attention: ['inactive' as never] }),
  // Shared between Dana and Guy.
  m('t2', 'Yoav Cohen', [DANA, GUY], 'דבוקה 3', { weekKm: 9.4, weekRuns: 1, completedCount: 1, completionRate: 0.25, attention: ['low_adherence' as never] }),
  m('t3', 'Raz Kedem', null, null, { academyJoinedOn: daysAgo(4), plannedCount: 0, completedCount: 0, completionRate: null, attention: ['no_coach' as never, 'no_band' as never] }),
  m('t4', 'Adi Nir', null, 'דבוקה 5', { academyJoinedOn: daysAgo(3), plannedCount: 0, completedCount: 0, completionRate: null, attention: ['no_coach' as never] }),
  m('t5', 'Michal Raz', DANA, 'דבוקה 4', { weekKm: 38.2, weekRuns: 4, completedCount: 4, completionRate: 1 }),
  m('t6', 'Omer Segev', DANA, 'דבוקה 4'),
  m('t7', 'Alon Mor', GUY, 'דבוקה 2', { weekKm: 31, completedCount: 4, completionRate: 1 }),
  m('t8', 'Roni Tal', GUY, 'דבוקה 2'),
  m('t9', 'Shira Amit', GUY, 'דבוקה 3', { academyJoinedOn: daysAgo(20), weekRuns: 1, completionRate: 0.25, attention: ['low_adherence' as never] }),
  m('t10', 'Tom Haim', GUY, 'דבוקה 3'),
  m('t11', 'Lia Gal', GUY, 'דבוקה 5', { weekRuns: 0, completedCount: 0, completionRate: 0, daysSinceActivity: 4 }),
  m('t12', 'Ben Ezra', GUY, 'דבוקה 1'),
  m('t13', 'Eden Paz', DANA, 'דבוקה 2', { weekRuns: 1, completionRate: 0.25, attention: ['low_adherence' as never] }),
  m('t14', 'Maya Ron', DANA, 'דבוקה 1'),
];

const team = (activeThisWeek: number, completionRate: number) => ({
  members: 14, approved: 14, connected: 14, activeThisWeek, needsAttention: 4, weekKm: 386, weekRuns: 47, weekDurationMin: 2400,
  totalKm: 5000, totalRuns: 700, completionRate, planned: 50, completed: 40,
});

const coachView = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('coach') === '1';
const SHOWN = coachView ? MEMBERS.filter((x) => x.academyCoachIds.includes('dana')) : MEMBERS;

const DATA = {
  weekStart: planWeekStartOf(),
  scope: coachView ? 'coach' : 'academy',
  members: SHOWN,
  team: { ...team(12, 0.81), members: SHOWN.length, approved: SHOWN.length },
  coaches: coachView ? [] : [
    { coachId: 'dana', coachName: 'Dana Levi', trainees: 6, unpaced: 0, weekKm: 0, completionRate: 0.69 },
    { coachId: 'guy', coachName: 'Guy Ziv', trainees: 7, unpaced: 0, weekKm: 0, completionRate: 0.88 },
    { coachId: 'avi', coachName: 'Avi Peretz', trainees: 0, unpaced: 0, weekKm: 0, completionRate: null },
  ],
  bands: [],
  groups: [],
  pending: { registrations: 0, results: 0 },
} as unknown as AcademyMembersResponse;

const WEEKS = trendWeeks(planWeekStartOf(), 12);
const TOTAL = [4, 4, 5, 6, 6, 7, 8, 9, 10, 11, 13, 14];
const JOINED = [0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 2, 1];
const LEFT = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];

const HOME = {
  scope: coachView ? 'coach' : 'academy',
  weeks: WEEKS.map((w, i) => ({ weekStart: w, trainees: TOTAL[i], existing: TOTAL[i] - JOINED[i], joined: JOINED[i], left: LEFT[i] })),
  month: { joined: 3, left: 1 },
  today: { count: 2, firstAt: `${israelToday()}T15:00:00.000Z` },
  approvals: [{ athleteId: 't8', name: 'Roni Tal', submittedAt: hoursAgo(20) }],
  funnel: coachView ? null : {
    live: 4,
    forms: [{ id: 'c1', name: 'Lior Katz', since: hoursAgo(50) }],
    stuck: [],
  },
  coachCapacity: 8,
};

const INBOX = buildInbox([
  { athleteId: 't2', name: 'Yoav Cohen', lastTraineeMessageAt: hoursAgo(26), lastStaffMessageAt: hoursAgo(50), unreadCount: 1 },
  { athleteId: 't1', name: 'Noa Barak', lastTraineeMessageAt: hoursAgo(9), lastStaffMessageAt: hoursAgo(30), unreadCount: 1 },
  { athleteId: 't5', name: 'Michal Raz', lastTraineeMessageAt: hoursAgo(3), lastStaffMessageAt: hoursAgo(28), unreadCount: 2 },
  { athleteId: 't7', name: 'Alon Mor', lastTraineeMessageAt: hoursAgo(80), lastStaffMessageAt: hoursAgo(60), unreadCount: 0 },
], today.toISOString());

const DELIVERIES: DeliveryRow[] = [
  { athlete_id: 't10', workout_date: daysAgo(-1), status: 'failed', created_at: hoursAgo(5), error_message: 'Request failed with status code 503' },
  { athlete_id: 't11', workout_date: daysAgo(-1), status: 'pending', created_at: hoursAgo(5), garmin_workout_id: '881' },
  { athlete_id: 't5', workout_date: daysAgo(-1), status: 'success', created_at: hoursAgo(5) },
];
const DISPATCH = buildDispatchReport({
  athletes: MEMBERS.map((x) => ({ id: x.athleteId, name: x.name, connection: 'ok' as const })),
  deliveries: DELIVERIES,
  activityDays: new Set(),
  today: israelToday(),
});

function stub(url: string): unknown {
  if (url.startsWith('/api/academy/home')) return HOME;
  if (url.startsWith('/api/academy/members/people')) return { left: [], pending: [], addable: [{ athleteId: 's1', name: 'Shalev Har', avatarUrl: null, createdAt: null, groupName: null }] };
  if (url.startsWith('/api/academy/members')) {
    const prev = url.includes(`weekStart=${planWeekStartOf()}`) ? DATA : { ...DATA, team: { ...DATA.team, completionRate: 0.77 } };
    return prev;
  }
  if (url.startsWith('/api/academy/threads/inbox')) return { ...INBOX, scope: coachView ? 'coach' : 'academy' };
  if (url.startsWith('/api/academy/dispatch')) return DISPATCH;
  if (url.startsWith('/api/academy/registration')) return { open: true, canRegister: true };
  if (url.startsWith('/api/academy/summary')) return { trainees: 14, coaches: 3, unpaired: 2, inFunnel: 4, registrationOpen: true };
  if (url.startsWith('/api/academy/coaches')) return {
    coaches: [{ id: 'dana', name: 'Dana Levi', avatarUrl: null, trainees: 6 }, { id: 'guy', name: 'Guy Ziv', avatarUrl: null, trainees: 6 }, { id: 'avi', name: 'Avi Peretz', avatarUrl: null, trainees: 0 }],
    candidates: [{ id: 's1', name: 'Shalev Har', avatarUrl: null }],
  };
  if (url.startsWith('/api/academy/candidates')) return {
    candidates: [
      { id: 'c1', name: 'Lior Katz', createdAt: hoursAgo(50) },
      { id: 'c2', name: 'Shahar Glazner', createdAt: hoursAgo(120) },
      { id: 'c3', name: 'Dor Alon', createdAt: hoursAgo(200) },
      { id: 'c4', name: 'Tal Regev', createdAt: hoursAgo(300) },
    ],
    events: [{ candidateId: 'c1', stage: 'form', occurredAt: hoursAgo(50) }],
  };
  if (url.startsWith('/api/academy/tests')) return { protocol: '30min', ...buildRegistry({ athletes: [], tests: [], protocol: '30min', today: israelToday() }), pending: [] };
  if (url.startsWith('/api/academy/test-invitation/board')) return { rows: [], invitable: [] };
  if (url.startsWith('/api/academy/queue')) return buildQueue({ weekStart: planWeekStartOf(), athletes: [] } as never, new Set());
  if (url.startsWith('/api/academy/settings')) return { settings: { coachCapacity: 8 } };
  return {};
}

if (typeof window !== 'undefined' && !(window as { __homeV5Stub?: boolean }).__homeV5Stub) {
  (window as { __homeV5Stub?: boolean }).__homeV5Stub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/')) {
      if (init?.method && init.method !== 'GET') return new Response(JSON.stringify({ ok: true, failed: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(stub(url)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewAcademyHomeV5() {
  if (process.env.NODE_ENV === 'production') notFound();
  // Drawn after mount: `?coach=1` is read off the URL, which the server render can't see.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-page" dir="rtl">
      {/* The shell, to size: the app's Header, then the scrolling <main>, then the tab bar. */}
      <div id="chrome-top" className="h-[103px] shrink-0 border-b border-page bg-card/90" />
      <main id="app-main" className="mx-auto w-full max-w-7xl flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4">
        <div className="mx-auto max-w-5xl">
          <AcademyShell
            isManager={!coachView}
            scopeCoach={false}
            canEditRoles
            canViewAs={false}
            myAthleteId={coachView ? 'dana' : null}
            linkTab={null}
            linkThread={null}
          />
        </div>
      </main>
      <div id="chrome-bottom" className="h-[83px] shrink-0 border-t border-page bg-card/95" />
    </div>
  );
}

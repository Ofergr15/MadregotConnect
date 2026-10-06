'use client';

import { notFound } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown, LayoutDashboard } from 'lucide-react';
import { AcademyCard } from '@/components/admin/AcademyCard';
import { AcademyOverview, AcademyWeekArrows, AcademyWeekLabel } from '@/components/academy/AcademyOverview';
import { AcademyAdminButton, CoachesSheet, ViewAsBanner } from '@/components/academy/AcademyAdmin';
import { getViewedPerson } from '@/lib/view-as-person';
import type { AcademyMember, AcademyMembersResponse } from '@/components/academy/types';
import { planWeekStartOf } from '@/lib/utils';

// The academy home as the manager sees it on an iPhone 14, on a stubbed `fetch`:
// the shell's chrome is drawn to size (status bar, header, bottom bar) so the
// "one screen, no scroll" promise can be measured, not guessed. `?card=1` adds
// the control room's academy card above. Only the network is replaced; writes are
// swallowed.

const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const m = (athleteId: string, name: string, coach: [string, string] | null, band: string | null, o: Partial<AcademyMember> = {}): AcademyMember => ({
  athleteId, name, email: '', avatarUrl: null, groupId: null, groupName: null,
  academyCoachId: coach?.[0] ?? null, academyCoachName: coach?.[1] ?? null,
  band: band ? { id: band, name: band, bandNumber: 3, paceProfile: { offsetSeconds: 0 } } : null,
  paceOffsetSec: null, status: 'active', role: 'runner', approved: true, hasWatch: true, hasGarmin: true, hasStrava: false,
  joinedAt: null, academyJoinedOn: daysAgo(90), weekKm: 24.3, weekRuns: 3, weekDurationMin: 150, totalKm: 400, totalRuns: 60,
  lastActivityAt: null, daysSinceActivity: 1, plannedCount: 4, completedCount: 3, completionRate: 0.75, attention: [],
  ...o,
} as unknown as AcademyMember);

const DANA: [string, string] = ['dana', 'Dana Levi'];
const GUY: [string, string] = ['guy', 'Guy Ziv'];
const MEMBERS: AcademyMember[] = [
  m('t1', 'Noa Barak', DANA, 'דבוקה 4', { weekKm: 0, weekRuns: 0, completedCount: 0, completionRate: 0, daysSinceActivity: 6, attention: ['inactive' as never] }),
  m('t2', 'Yoav Cohen', DANA, 'דבוקה 3', { weekKm: 9.4, weekRuns: 1, completedCount: 1, completionRate: 0.25, attention: ['low_adherence' as never] }),
  m('t3', 'Raz Kedem', null, null, { academyJoinedOn: daysAgo(4), plannedCount: 0, completedCount: 0, completionRate: null, attention: ['no_coach' as never, 'no_band' as never] }),
  m('t4', 'Adi Nir', null, 'דבוקה 5', { academyJoinedOn: daysAgo(9), plannedCount: 0, completedCount: 0, completionRate: null, attention: ['no_coach' as never] }),
  m('t5', 'Michal Raz', DANA, 'דבוקה 4', { weekKm: 38.2, weekRuns: 4, completedCount: 4, completionRate: 1 }),
  m('t6', 'Omer Segev', DANA, 'דבוקה 4'),
  m('t7', 'Alon Mor', GUY, 'דבוקה 2', { weekKm: 31, completedCount: 4, completionRate: 1 }),
  m('t8', 'Roni Tal', GUY, 'דבוקה 2'),
  m('t9', 'Shira Amit', GUY, 'דבוקה 3', { academyJoinedOn: daysAgo(20) }),
  m('t10', 'Tom Haim', GUY, 'דבוקה 3'),
  m('t11', 'Lia Gal', GUY, 'דבוקה 5'),
  m('t12', 'Ben Ezra', GUY, 'דבוקה 1'),
  m('t13', 'Eden Paz', DANA, 'דבוקה 2'),
  m('t14', 'Maya Ron', DANA, 'דבוקה 1'),
];

const team = (activeThisWeek: number, completionRate: number, weekKm: number) => ({
  members: 14, approved: 14, connected: 14, activeThisWeek, needsAttention: 4, weekKm, weekRuns: 47, weekDurationMin: 2400,
  totalKm: 5000, totalRuns: 700, totalDurationMin: 30000, completionRate,
});

const DATA = {
  weekStart: planWeekStartOf(),
  scope: 'academy',
  members: MEMBERS,
  team: team(12, 0.81, 386),
  coaches: [
    { coachId: 'dana', coachName: 'Dana Levi', trainees: 6, unpaced: 0, weekKm: 0, completionRate: 0.69 },
    { coachId: 'guy', coachName: 'Guy Ziv', trainees: 6, unpaced: 0, weekKm: 0, completionRate: 0.88 },
    { coachId: 'avi', coachName: 'Avi Peretz', trainees: 0, unpaced: 0, weekKm: 0, completionRate: null },
  ],
  bands: [],
  groups: [],
  pending: { registrations: 1, results: 2 },
} as unknown as AcademyMembersResponse;

const weeks = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(`${planWeekStartOf()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 7 * (11 - i));
  return d.toISOString().slice(0, 10);
});
const TOTAL = [4, 4, 5, 6, 6, 7, 8, 9, 10, 11, 13, 14], JOINED = [0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 2, 1];
const COMP = [0.62, 0.66, 0.7, 0.68, 0.72, 0.71, 0.75, 0.74, 0.78, 0.77, 0.77, 0.81];
const KM = [96, 101, 118, 140, 133, 162, 190, 215, 240, 262, 345, 386];

function stub(url: string): unknown {
  if (url.startsWith('/api/academy/summary')) return { trainees: 14, coaches: 3, unpaired: 2, inFunnel: 4, registrationOpen: true };
  if (url.startsWith('/api/academy/registration')) return { open: true, canRegister: true };
  if (url.startsWith('/api/academy/trends')) return { weeks: weeks.map((w, i) => ({ weekStart: w, trainees: TOTAL[i], joined: JOINED[i], km: KM[i], runs: 30 + i, completionRate: COMP[i] })) };
  if (url.startsWith('/api/academy/members')) return { ...DATA, team: team(10, 0.77, 345) };
  if (url.startsWith('/api/academy/coaches')) return {
    coaches: [{ id: 'dana', name: 'Dana Levi', avatarUrl: null, trainees: 6 }, { id: 'guy', name: 'Guy Ziv', avatarUrl: null, trainees: 6 }, { id: 'avi', name: 'Avi Peretz', avatarUrl: null, trainees: 0 }],
    candidates: [{ id: 's1', name: 'Shalev Har', avatarUrl: null }, { id: 's2', name: 'Shahar Glazner', avatarUrl: null }],
  };
  if (url.startsWith('/api/academy/candidates')) {
    const now = Date.now();
    return {
      candidates: [1, 2, 3, 4].map((i) => ({ id: `c${i}`, name: `Candidate ${i}`, createdAt: new Date(now - i * 4 * 86_400_000).toISOString() })),
      events: [],
    };
  }
  return {};
}

if (typeof window !== 'undefined' && !(window as { __adminStub?: boolean }).__adminStub) {
  (window as { __adminStub?: boolean }).__adminStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/')) {
      if (init?.method && init.method !== 'GET') return new Response(init.body ?? '{}', { status: 200 });
      return new Response(JSON.stringify(stub(url)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewAcademyAdmin() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [weekStart, setWeekStart] = useState(planWeekStartOf());
  const [coachesOpen, setCoachesOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const card = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('card') === '1';

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-page" dir="rtl">
      {/* The shell, to size: the app's Header, then the scrolling <main>, then the tab bar. */}
      <div id="chrome-top" className="h-[103px] shrink-0 border-b border-page bg-card/90" />
      <main id="app-main" className="mx-auto w-full max-w-7xl flex-1 min-h-0 overflow-y-auto px-4 pt-5 pb-4">
        {card && <div className="mb-6"><AcademyCard /></div>}
        <div className="mx-auto max-w-5xl">
          {typeof window !== 'undefined' && getViewedPerson() && <ViewAsBanner person={getViewedPerson()!} />}
          <div className="mb-2 flex items-center justify-between gap-4">
            <div className="min-w-0"><h1 className="text-2xl font-extrabold tracking-tight text-ink-700">אקדמיה</h1><AcademyWeekLabel weekStart={weekStart} /></div>
            <div className="flex shrink-0 items-center gap-1">
              <AcademyWeekArrows weekStart={weekStart} onWeekChange={setWeekStart} />
              <AcademyAdminButton onOpenCoaches={() => { setFocus(null); setCoachesOpen(true); }} onOpenSettings={() => {}} canEditRoles members={MEMBERS} />
            </div>
          </div>
          <div className="mb-2.5 flex min-h-[48px] w-full items-center gap-2 rounded-xl border border-page bg-card px-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white"><LayoutDashboard className="h-4 w-4" /></span>
            <span className="flex-1 text-[15px] font-bold text-ink-700">סקירה</span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">כל המדורים<ChevronDown className="h-4 w-4" /></span>
          </div>
          <AcademyOverview
            data={DATA}
            isLoading={false}
            weekStart={weekStart}
            onWeekChange={setWeekStart}
            onSelectMember={() => {}}
            onGoTab={() => {}}
            onChanged={() => {}}
            onOpenCoach={(id) => { setFocus(id); setCoachesOpen(true); }}
          />
        </div>
      </main>
      <div id="chrome-bottom" className="h-[83px] shrink-0 border-t border-page bg-card/95" />
      <CoachesSheet open={coachesOpen} onOpenChange={setCoachesOpen} members={MEMBERS} onSelectMember={() => {}} focusCoach={focus} />
    </div>
  );
}

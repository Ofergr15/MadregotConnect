'use client';

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CalendarDays, Home, MessageCircle, TrendingUp, Users } from 'lucide-react';
import { CoachesBoard } from '@/components/academy/CoachesBoard';
import { PlansWeekStatus } from '@/components/academy/PlansWeekStatus';
import { WatchDispatch } from '@/components/academy/WatchDispatch';
import { CandidateFunnel } from '@/components/academy/CandidateFunnel';
import { TestRegistry } from '@/components/academy/TestRegistry';
import type { AcademyMember } from '@/components/academy/types';
import { buildDispatchReport, type DeliveryRow, type DispatchAthlete } from '@/lib/academy/dispatch';
import { buildRegistry, type RegistryAthlete, type TestRow } from '@/lib/academy/tests';
import { cn, israelToday, planWeekStartOf } from '@/lib/utils';

// ── The academy areas' content, on a stubbed `fetch` ─────────────────────────
//
// ?view=coaches | plans | dispatch | funnel | tests. Each is the REAL component inside the
// v5 mockup's shell drawn to size (app header, area tabs, sub-tabs, bottom bar), so the
// screenshot can be held against academy-manager-v5.html phone 3 / phone 4. The verdicts go
// through the real `buildDispatchReport` and `buildRegistry`.
//
// Rendered after mount only: fixtures count back from today, and a server render a few ms
// apart from the client one is a hydration mismatch that throws the tree away.
// Development only.

const DAY = 86_400_000;
const daysAgo = (n: number) => israelToday(new Date(Date.parse(israelToday()) - n * DAY));
const WEEK = planWeekStartOf();
const inWeek = (d: number) => {
  const t = new Date(`${WEEK}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10);
};

const m = (athleteId: string, name: string, coach: [string, string] | null, o: Partial<AcademyMember> = {}): AcademyMember => ({
  athleteId, name, email: '', avatarUrl: null, groupId: null, groupName: null,
  academyCoachId: coach?.[0] ?? null, academyCoachName: coach?.[1] ?? null,
  band: { id: 'b', name: 'דבוקה 4', bandNumber: 4, paceProfile: { offsetSeconds: 0 } },
  paceOffsetSec: null, status: 'active', role: 'runner', approved: true, hasWatch: true, hasGarmin: true, hasStrava: false,
  joinedAt: null, academyJoinedOn: daysAgo(90), weekKm: 24, weekRuns: 3, weekDurationMin: 150, totalKm: 400, totalRuns: 60,
  lastActivityAt: null, daysSinceActivity: 1, plannedCount: 4, completedCount: 3, completionRate: 0.75, attention: [],
  ...o,
} as unknown as AcademyMember);

const DANA: [string, string] = ['dana', 'Dana Levi'];
const GUY: [string, string] = ['guy', 'Guy Ziv'];
const MEMBERS: AcademyMember[] = [
  m('t1', 'Noa Barak', DANA, { completedCount: 0, attention: ['inactive' as never] }),
  m('t2', 'Yoav Cohen', DANA, { completedCount: 2 }),
  m('t3', 'Michal Raz', DANA, { completedCount: 4 }),
  m('t4', 'Omer Segev', DANA, { completedCount: 3 }),
  m('t5', 'Eden Paz', DANA, { completedCount: 3 }),
  m('t6', 'Maya Ron', DANA, { completedCount: 2 }),
  m('t7', 'Alon Mor', GUY, { completedCount: 4 }),
  m('t8', 'Roni Tal', GUY, { completedCount: 4 }),
  m('t9', 'Shira Amit', GUY, { completedCount: 3 }),
  m('t10', 'Tom Haim', GUY, { completedCount: 3 }),
  m('t11', 'Lia Gal', GUY, { completedCount: 4 }),
  m('t12', 'Ben Ezra', GUY, { completedCount: 3 }),
  m('t13', 'Raz Kedem', null, { band: null, academyJoinedOn: daysAgo(4), plannedCount: 0, completedCount: 0, completionRate: null, attention: ['no_coach' as never, 'no_band' as never] }),
  m('t14', 'Adi Nir', null, { academyJoinedOn: daysAgo(9), plannedCount: 0, completedCount: 0, completionRate: null, attention: ['no_coach' as never] }),
];

// The week: ten delivered, Tom's token died, Lia's push was never confirmed, Raz and Adi
// have no plan.
const ATHLETES: DispatchAthlete[] = MEMBERS.map(x => ({
  id: x.athleteId, name: x.name, connection: (x.athleteId === 't10' ? 'failed' : 'healthy') as never,
}));
const DELIVERIES: DeliveryRow[] = MEMBERS.filter(x => x.plannedCount > 0).flatMap(x => [1, 3, 5].map(d => ({
  athlete_id: x.athleteId,
  workout_date: inWeek(d),
  status: x.athleteId === 't10' ? 'failed' : x.athleteId === 't11' && d === 3 ? 'pending' : 'success',
  error_message: x.athleteId === 't10' ? 'Request failed with status code 401' : null,
  created_at: `${WEEK}T06:00:00Z`,
})));
const REPORT = buildDispatchReport({ athletes: ATHLETES, deliveries: DELIVERIES, activityDays: new Set(), today: inWeek(2) });
const ROSTER = MEMBERS.map(x => ({
  athleteId: x.athleteId, name: x.name, hasGarmin: true, connection: (x.athleteId === 't10' ? 'failed' : 'healthy') as never,
  planWorkouts: x.plannedCount > 0 ? 3 : 0,
}));

const REG_ATHLETES: RegistryAthlete[] = MEMBERS.slice(0, 8).map((x, i) => ({ id: x.athleteId, name: x.name, bandNumber: 3 + (i % 3) }));
let seq = 0;
const test = (athleteId: string, ago: number, meters: number): TestRow => ({
  id: `x${++seq}`, athleteId, date: daysAgo(ago), protocol: '30min', durationSec: 1800, distanceM: meters,
});
const TESTS: TestRow[] = [
  test('t1', 160, 5600), test('t2', 120, 6000), test('t2', 8, 6200), test('t3', 140, 5800), test('t3', 6, 5900),
  test('t4', 200, 5500), test('t5', 30, 6100), test('t6', 90, 5700), test('t6', 5, 5600), test('t7', 12, 6400),
];

function stub(url: string, view: string): unknown {
  if (url.startsWith('/api/academy/coaches')) return {
    coaches: [
      { id: 'dana', name: 'Dana Levi', avatarUrl: null, trainees: 6 },
      { id: 'guy', name: 'Guy Ziv', avatarUrl: null, trainees: 6 },
      { id: 'avi', name: 'Avi Peretz', avatarUrl: null, trainees: 0 },
    ],
    candidates: [{ id: 's1', name: 'Shalev Har', avatarUrl: null }],
  };
  if (url.startsWith('/api/academy/settings')) return { settings: { coachCapacity: 8 } };
  if (url.startsWith('/api/academy/dispatch')) return { weekStart: WEEK, ...REPORT, roster: ROSTER, scope: 'academy' };
  if (url.startsWith('/api/academy/members')) return { weekStart: WEEK, members: MEMBERS };
  if (url.startsWith('/api/academy/registrations')) return { registrations: [{ id: 'r1' }] };
  if (url.startsWith('/api/academy/candidates')) {
    // One candidate — the case that used to be nine headers tall.
    const created = new Date(Date.now() - 2 * DAY).toISOString();
    return {
      candidates: [{ id: 'c1', name: 'Shahar Glazner', source: 'form', goal: 'חצי מרתון', createdAt: created }],
      events: view === 'funnel' ? [{ candidateId: 'c1', stage: 'form', occurredAt: created }] : [],
      me: { canAdmit: true, isManager: true, athleteId: 'me' },
    };
  }
  if (url.startsWith('/api/academy/tests')) {
    const registry = buildRegistry({ athletes: REG_ATHLETES, tests: TESTS, protocol: '30min', today: israelToday() });
    return {
      ...registry,
      pending: [{
        testId: 'p1', athleteId: 't7', name: 'Alon Mor', date: daysAgo(1), protocol: '30min', durationSec: 1800,
        distanceM: 6500, avgHr: 171, paceSec: 277, submittedAt: new Date(Date.now() - DAY).toISOString(), implausible: false,
      }],
    };
  }
  if (url.startsWith('/api/academy/test-invitation')) return { invitations: [], rows: [] };
  return {};
}

// Installed at module load, like the other previews, so that nothing on the page —
// the session bootstrap included — reaches the real API before the stub is in place.
if (typeof window !== 'undefined' && !(window as { __areasStub?: boolean }).__areasStub) {
  (window as { __areasStub?: boolean }).__areasStub = true;
  const v = new URLSearchParams(window.location.search).get('view') || 'coaches';
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/')) {
      if (init?.method && init.method !== 'GET') return new Response('{"success":true}', { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(stub(url, v)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

const SUBS: Record<string, { area: number; title: string; small: string; tabs: string[]; on: number }> = {
  coaches: { area: 1, title: 'אנשים', small: '3 מאמנים · 12 מתאמנים משובצים', tabs: ['מתאמנים', 'מועמדים', 'מאמנים'], on: 2 },
  funnel: { area: 1, title: 'אנשים', small: 'מועמד אחד בתהליך', tabs: ['מתאמנים', 'מועמדים', 'מאמנים'], on: 1 },
  plans: { area: 2, title: 'תוכניות', small: 'השבוע', tabs: ['השבוע', 'ספר אימונים', 'שעונים'], on: 0 },
  dispatch: { area: 2, title: 'תוכניות', small: 'השבוע', tabs: ['השבוע', 'ספר אימונים', 'שעונים'], on: 2 },
  tests: { area: 3, title: 'מעקב', small: 'טסט 30 דקות', tabs: ['ביצוע', 'טסטים', 'תוצאות'], on: 1 },
};
const AREAS = [
  { label: 'בית', icon: Home }, { label: 'אנשים', icon: Users }, { label: 'תוכניות', icon: CalendarDays },
  { label: 'מעקב', icon: TrendingUp }, { label: 'שיחות', icon: MessageCircle },
];

export default function PreviewAcademyAreas() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [view, setView] = useState<string | null>(null);

  useEffect(() => {
    setView(new URLSearchParams(window.location.search).get('view') || 'coaches');
  }, []);

  if (!view) return null;
  const sub = SUBS[view] ?? SUBS.coaches;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-page" dir="rtl">
      <div className="h-[103px] shrink-0 border-b border-page bg-card/90" />
      <main className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4">
        <div className="mx-auto max-w-md space-y-2.5">
          <div>
            <h1 className="text-[25px] font-black leading-tight tracking-tight text-ink-900">{sub.title}</h1>
            <p className="text-xs font-semibold text-ink-400">{sub.small}</p>
          </div>
          <div className="grid grid-cols-5 gap-0.5 rounded-2xl bg-card p-1">
            {AREAS.map((a, i) => (
              <div key={a.label} className={cn('flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-2xs font-extrabold', i === sub.area ? 'bg-brand-600 text-white' : 'text-ink-400')}>
                <a.icon className="h-5 w-5" />{a.label}
              </div>
            ))}
          </div>
          <div className="flex rounded-xl bg-ink-300/30 p-0.5">
            {sub.tabs.map((t, i) => (
              <span key={t} className={cn('flex-1 rounded-lg py-1.5 text-center text-[13px] font-extrabold', i === sub.on ? 'bg-card text-ink-900' : 'text-ink-400')}>{t}</span>
            ))}
          </div>

          {view === 'coaches' && <CoachesBoard members={MEMBERS} onSelectMember={() => {}} canManage />}
          {view === 'plans' && <PlansWeekStatus weekStart={WEEK} onBuild={() => {}} members={MEMBERS} />}
          {view === 'dispatch' && <WatchDispatch weekStart={WEEK} onBuild={() => {}} />}
          {view === 'funnel' && <CandidateFunnel />}
          {view === 'tests' && <TestRegistry />}
        </div>
      </main>
      <div className="h-[83px] shrink-0 border-t border-page bg-card/95" />
    </div>
  );
}

'use client';

import { notFound } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AcademyMembers } from '@/components/academy/AcademyMembers';
import { MemberSheet } from '@/components/academy/MemberSheet';
import { ChangeCoachSheet } from '@/components/academy/ManageMembersSheets';
import type { AcademyMember, AcademyMembersResponse } from '@/components/academy/types';
import { planWeekStartOf } from '@/lib/utils';

// The academy members tab as the manager sees it on an iPhone 14, on a stubbed
// `fetch`, with the shell's chrome drawn to size. Writes are swallowed. The spec is
// ~/.cache/madregot/mockups/academy-manage-members.html.

const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const BANDS = [2, 3, 4, 5].map((n) => ({ id: `b${n}`, name: `דבוקה ${n}`, bandNumber: n, goal: null, paceProfile: { offsetSeconds: n * 10 } }));
const band = (n: number | null) => (n ? BANDS.find((b) => b.bandNumber === n)! : null);

// `coach` is one coach, or several for a shared trainee (migration 135).
const m = (athleteId: string, name: string, coach: [string, string] | Array<[string, string]> | null, b: number | null, o: Partial<AcademyMember> = {}): AcademyMember => {
  const set: Array<[string, string]> = !coach ? [] : Array.isArray(coach[0]) ? (coach as Array<[string, string]>) : [coach as [string, string]];
  return mk(athleteId, name, set, b, o);
};
const mk = (athleteId: string, name: string, set: Array<[string, string]>, b: number | null, o: Partial<AcademyMember>): AcademyMember => ({
  athleteId, name, email: '', avatarUrl: null, groupId: null, groupName: null,
  academyCoachId: set[0]?.[0] ?? null, academyCoachName: set[0]?.[1] ?? null,
  academyCoachIds: set.map((c) => c[0]), academyCoachNames: set.map((c) => c[1]),
  band: band(b), paceOffsetSec: null, status: 'active', role: 'runner', approved: true, hasWatch: true, hasGarmin: true, hasStrava: false,
  joinedAt: null, academyJoinedOn: daysAgo(90), weekKm: 24.3, weekRuns: 3, weekDurationMin: 150, totalKm: 400, totalRuns: 60,
  lastActivityAt: null, daysSinceActivity: 1, plannedCount: 4, completedCount: 3, completionRate: 0.75, attention: [],
  ...o,
} as AcademyMember);

const DANA: [string, string] = ['dana', 'Dana Levi'];
const GUY: [string, string] = ['guy', 'Guy Ziv'];
const MEMBERS: AcademyMember[] = [
  m('t5', 'Michal Raz', DANA, 4, { academyJoinedOn: daysAgo(80), completedCount: 4, completionRate: 1, weekKm: 38.2 }),
  m('t1', 'Noa Barak', DANA, 4, { academyJoinedOn: daysAgo(120), weekKm: 0, weekRuns: 0, completedCount: 0, completionRate: 0, daysSinceActivity: 6, attention: ['inactive' as never] }),
  // Shared: Dana and Guy (all coaches equal) — listed under each, tagged "משותף".
  m('t2', 'Yoav Cohen', [DANA, GUY], 3, { academyJoinedOn: daysAgo(55), weekKm: 9.4, weekRuns: 1, completedCount: 1, completionRate: 0.25, paceOffsetSec: 5 }),
  m('t6', 'Omer Segev', DANA, 4),
  m('t13', 'Eden Paz', DANA, 2),
  m('t14', 'Maya Ron', DANA, 5),
  m('t7', 'Alon Mor', GUY, 2, { academyJoinedOn: daysAgo(150), completedCount: 4, completionRate: 1 }),
  m('t8', 'Roni Tal', GUY, 2, { academyJoinedOn: daysAgo(110) }),
  m('t9', 'Shira Amit', GUY, 3, { hasWatch: false, hasGarmin: false }),
  m('t10', 'Tom Haim', GUY, 3),
  m('t11', 'Lia Gal', GUY, 5),
  m('t12', 'Ben Ezra', GUY, null),
  m('t3', 'Raz Kedem', null, null, { academyJoinedOn: daysAgo(4), plannedCount: 0, completedCount: 0, completionRate: null, attention: ['no_coach' as never] }),
  m('t4', 'Adi Nir', null, 5, { academyJoinedOn: daysAgo(9), plannedCount: 0, completedCount: 0, completionRate: null }),
  m('app', 'Lior Katz', null, null, { approved: false, academyJoinedOn: null }),
];

const DATA = {
  weekStart: planWeekStartOf(),
  scope: 'academy',
  members: MEMBERS,
  team: { members: 15 },
  coaches: [
    { coachId: 'dana', coachName: 'Dana Levi', trainees: 6, unpaced: 0, weekKm: 0, completionRate: 0.69 },
    { coachId: 'guy', coachName: 'Guy Ziv', trainees: 7, unpaced: 0, weekKm: 0, completionRate: 0.88 },
    { coachId: 'avi', coachName: 'Avi Peretz', trainees: 1, unpaced: 0, weekKm: 0, completionRate: null },
    { coachId: null, coachName: null, trainees: 2, unpaced: 2, weekKm: 0, completionRate: null },
  ],
  bands: BANDS.map((b) => ({ ...b, trainees: MEMBERS.filter((x) => x.band?.id === b.id).length })),
  groups: [],
  pending: { registrations: 1, results: 0 },
} as unknown as AcademyMembersResponse;

const PEOPLE = {
  left: [
    { athleteId: 'l1', name: 'Tal Ben', avatarUrl: null, leftOn: daysAgo(27), joinedOn: daysAgo(150), previousCoachId: 'guy', previousCoachName: 'Guy Ziv', monthsIn: 4 },
    { athleteId: 'l2', name: 'Ido Sharon', avatarUrl: null, leftOn: daysAgo(65), joinedOn: daysAgo(80), previousCoachId: 'dana', previousCoachName: 'Dana Levi', monthsIn: null },
    { athleteId: 'l3', name: 'Gal Oren', avatarUrl: null, leftOn: null, joinedOn: daysAgo(200), previousCoachId: null, previousCoachName: null, monthsIn: 6 },
  ],
  pending: [
    { key: 'app', athleteId: 'app', candidateId: 'c1', name: 'Lior Katz', appliedAt: daysAgo(2), clubMember: false, deletable: true },
    { key: 'p2', athleteId: 'p2', candidateId: 'c2', name: 'Shahar Glazner', appliedAt: daysAgo(5), clubMember: true, deletable: false },
  ],
  addable: [
    { athleteId: 's1', name: 'Shalev Har', avatarUrl: null, createdAt: '2024-03-01T00:00:00Z', groupName: 'דבוקה 3' },
    { athleteId: 's2', name: 'Shahar Glazner', avatarUrl: null, createdAt: '2025-01-10T00:00:00Z', groupName: null },
    { athleteId: 's3', name: 'Amit Levy', avatarUrl: null, createdAt: '2023-05-10T00:00:00Z', groupName: 'דבוקה 2' },
    { athleteId: 's4', name: 'Dor Alon', avatarUrl: null, createdAt: '2025-06-10T00:00:00Z', groupName: 'דבוקה 4' },
  ],
};

const WEEK = [
  { date: daysAgo(3), name: 'ריצה קלה', completed: true, distance: { status: 'ok', plannedMin: 8000, plannedMax: 10000, actual: 9400 }, duration: { status: 'ok', planned: 3000, actual: 2900 }, pace: { status: 'ok', plannedMin: 330, plannedMax: 350, actual: 309 }, score: 1 },
  { date: daysAgo(1), name: 'אינטרוולים', completed: false, distance: { status: 'missed', plannedMin: 10000, plannedMax: 10000, actual: null }, duration: { status: 'missed', planned: 3600, actual: null }, pace: { status: 'missed', plannedMin: null, plannedMax: null, actual: null }, score: 0 },
];

function stub(url: string, method: string): unknown {
  if (method !== 'GET') {
    if (url.startsWith('/api/academy/members/bulk')) return { results: [], ok: 1, failed: 0 };
    if (url.startsWith('/api/academy/candidates')) return { candidate: { id: 'c-new' }, url: 'https://www.madregot.app/academy-register?i=3f9a2c71d0b84e6a9c12', ok: true, email: { ok: true } };
    return { ok: true };
  }
  if (url.startsWith('/api/academy/members/people')) return PEOPLE;
  if (url.startsWith('/api/academy/settings')) return { settings: { coachCapacity: 8 } };
  if (url.startsWith('/api/academy/members')) return DATA;
  if (url.startsWith('/api/academy/adherence')) return { athletes: [{ week: { workouts: WEEK } }] };
  if (url.startsWith('/api/academy/tests')) return { trend: { points: [{ date: daysAgo(40), paceSec: 284 }] } };
  return {};
}

if (typeof window !== 'undefined' && !(window as { __membersStub?: boolean }).__membersStub) {
  (window as { __membersStub?: boolean }).__membersStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/')) {
      return new Response(JSON.stringify(stub(url, init?.method || 'GET')), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewAcademyMembers() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [coachMove, setCoachMove] = useState<AcademyMember | null>(null);
  const selected = useMemo(() => MEMBERS.find((x) => x.athleteId === selectedId) ?? null, [selectedId]);
  // ?open=t2 opens a member sheet, ?coaches=t2 the change-coaches sheet (screenshots).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('open')) setSelectedId(q.get('open'));
    const c = MEMBERS.find((x) => x.athleteId === q.get('coaches'));
    if (c) setCoachMove(c);
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-page" dir="rtl">
      <div id="chrome-top" className="h-[103px] shrink-0 border-b border-page bg-card/90" />
      <main id="app-main" className="mx-auto w-full max-w-7xl flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4">
        <div className="mx-auto max-w-5xl">
          <AcademyMembers
            data={DATA}
            isLoading={false}
            onSelectMember={(x) => setSelectedId(x.athleteId)}
            isManager
            onChanged={() => {}}
            onOpenFunnel={() => {}}
          />
        </div>
      </main>
      <div id="chrome-bottom" className="h-[83px] shrink-0 border-t border-page bg-card/95" />
      <MemberSheet
        member={selected}
        weekStart={planWeekStartOf()}
        onOpenChange={(o) => { if (!o) setSelectedId(null); }}
        onRemove={() => {}}
        coaches={DATA.coaches}
        bands={DATA.bands}
        canAssign
        onChanged={() => {}}
        onChangeCoach={(x) => { setSelectedId(null); setTimeout(() => setCoachMove(x), 350); }}
        onOpenThread={() => {}}
        onOpenPlan={() => {}}
        onOpenTests={() => {}}
        canViewAs
      />
      <ChangeCoachSheet
        open={!!coachMove}
        onOpenChange={(o) => { if (!o) setCoachMove(null); }}
        members={coachMove ? [coachMove] : []}
        coaches={DATA.coaches}
        onDone={() => {}}
      />
    </div>
  );
}

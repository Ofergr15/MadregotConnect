'use client';

import { notFound } from 'next/navigation';
import { AcademyCard } from '@/components/admin/AcademyCard';
import { AcademyManagerPanel } from '@/components/academy/AcademyManagerPanel';
import type { AcademyMembersResponse } from '@/components/academy/types';

// The manager's academy controls, on a stubbed `fetch`: the control room's card
// (four numbers and the way in) and the block at the top of the academy overview
// (registration switch, coaches with their caseload, trainees with no coach). The
// real components draw everything; only the network is replaced, and writes are
// swallowed so the switch can be flipped here without touching anything.

const member = (athleteId: string, name: string, academyCoachId: string | null, band: string | null, weekRuns: number, completionRate: number | null) =>
  ({ athleteId, name, academyCoachId, band: band ? { name: band } : null, weekRuns, completionRate });

const DATA = {
  scope: 'academy',
  members: [
    member('t1', 'Yoav Cohen', 'dana', 'דבוקה 3', 2, 0.5),
    member('t2', 'Michal Raz', 'dana', 'דבוקה 4', 4, 1),
    member('t3', 'Omer Segev', 'dana', 'דבוקה 4', 3, 0.75),
    member('t4', 'Noa Barak', 'dana', null, 0, 0),
    member('t5', 'Alon Mor', 'guy', 'דבוקה 2', 4, 1),
    member('t6', 'Roni Tal', 'guy', 'דבוקה 2', 3, 0.75),
    member('t7', 'Raz Kedem', null, null, 1, null),
    member('t8', 'Adi Nir', null, 'דבוקה 5', 2, null),
  ],
  coaches: [
    { coachId: 'dana', coachName: 'Dana Levi', trainees: 4, unpaced: 1, weekKm: 0, completionRate: 0.69 },
    { coachId: 'guy', coachName: 'Guy Ziv', trainees: 2, unpaced: 0, weekKm: 0, completionRate: 0.88 },
    { coachId: 'avi', coachName: 'Avi Peretz', trainees: 0, unpaced: 0, weekKm: 0, completionRate: null },
    { coachId: null, coachName: null, trainees: 2, unpaced: 1, weekKm: 0, completionRate: null },
  ],
} as unknown as AcademyMembersResponse;

function stub(url: string): unknown {
  if (url.startsWith('/api/academy/summary')) return { trainees: 8, coaches: 3, unpaired: 2, inFunnel: 3, registrationOpen: true };
  if (url.startsWith('/api/academy/registration')) return { open: true, canRegister: true };
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
  return (
    <div className="min-h-screen bg-page" dir="rtl">
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-5">
        <div>
          <p className="mb-2 px-1 text-xs font-bold text-ink-400">חדר הבקרה</p>
          <AcademyCard />
        </div>
        <div>
          <p className="mb-2 px-1 text-xs font-bold text-ink-400">אקדמיה · סקירה (מנהל)</p>
          <AcademyManagerPanel data={DATA} onSelectMember={() => {}} canEditRoles />
        </div>
      </div>
    </div>
  );
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { academyCoachIds } from '@/lib/academy/coaches';
import { buildFunnel, type CandidateEvent, type CandidateRow } from '@/lib/academy/funnel';
import { isRegistrationOpen } from '@/lib/academy/registration';

export const dynamic = 'force-dynamic';

export interface AcademySummary {
  trainees: number;
  coaches: number;
  /** Trainees nobody is responsible for. */
  unpaired: number;
  /** Candidates still on the way in (the funnel's live count). */
  inFunnel: number;
  registrationOpen: boolean;
}

/**
 * GET /api/academy/summary — the four numbers on the control room's academy card,
 * manager only. Light on purpose: /api/academy/members grades the whole week,
 * which is the academy screen's job and too much for a card on the admin home.
 * The same definitions as that screen, so the card and the overview agree:
 * trainees are approved academy members, coaches as in lib/academy/coaches.ts,
 * the funnel's live count from buildFunnel.
 */
export async function GET(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;
    const supabase = createServerClient();

    const [athletesRes, candidatesRes, eventsRes, registrationOpen] = await Promise.all([
      Promise.resolve(supabase.from('athletes').select('id, role, extra_roles, is_academy, approved, academy_coach_id').eq('coach_id', COACH_ID)),
      Promise.resolve(supabase.from('academy_candidates').select('id, name, athlete_id, archived_at, created_at')),
      Promise.resolve(supabase.from('academy_candidate_events').select('candidate_id, stage, occurred_at')),
      isRegistrationOpen(supabase),
    ]);

    type Row = { id: string; role: string | null; extra_roles: string[] | null; is_academy: boolean | null; approved: boolean | null; academy_coach_id: string | null };
    const rows = (athletesRes.error ? [] : athletesRes.data || []) as Row[];
    const trainees = rows.filter((a) => a.is_academy && a.approved !== false);

    const candidates: CandidateRow[] = (candidatesRes.error ? [] : candidatesRes.data || []).map((c: any) => ({
      id: c.id, name: c.name, athleteId: c.athlete_id, archivedAt: c.archived_at, createdAt: c.created_at,
    }));
    const events: CandidateEvent[] = (eventsRes.error ? [] : eventsRes.data || []).map((e: any) => ({
      candidateId: e.candidate_id, stage: e.stage, occurredAt: e.occurred_at,
    }));
    const inFunnel = candidates.length ? buildFunnel({ candidates, events, now: new Date().toISOString() }).live : 0;

    const summary: AcademySummary = {
      trainees: trainees.length,
      coaches: academyCoachIds(rows, trainees).size,
      unpaired: trainees.filter((t) => !t.academy_coach_id).length,
      inFunnel,
      registrationOpen,
    };
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Academy summary error:', error);
    return NextResponse.json({ error: 'Failed to load the academy summary' }, { status: 500 });
  }
}

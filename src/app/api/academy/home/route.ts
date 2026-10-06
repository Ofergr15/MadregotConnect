import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { israelToday, planWeekStartOf } from '@/lib/utils';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { isAcademyManager, visibleTraineeIds } from '@/lib/academy/pairing-server';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { deriveLeft, type HistoryRow } from '@/lib/academy/manage';
import { buildFunnel, type CandidateEvent, type CandidateRow } from '@/lib/academy/funnel';
import { trendWeeks } from '@/lib/academy/trends';
import { buildGrowth, monthMoves, todayTests, type AcademyHomeResponse } from '@/lib/academy/home';

export type { AcademyHomeResponse } from '@/lib/academy/home';

export const dynamic = 'force-dynamic';

const WEEKS = 12;

/**
 * GET /api/academy/home — what the academy home needs beyond the members payload:
 * the 12-week growth chart (joined AND left per week), this month's moves, today's
 * booked tests, the approvals queue and — for the manager — the live funnel.
 *
 * Scoped like everything else: the manager gets the academy, a coach their own
 * trainees (and the leavers they coached last). One round of parallel reads;
 * every optional table degrades to empty rather than failing the home.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;
    const supabase = createServerClient();
    const today = israelToday();

    const readHistory = async (): Promise<HistoryRow[]> => {
      const { data, error } = await supabase.from('academy_coach_history').select('athlete_id, coach_id, started_on, ended_on');
      return error ? [] : ((data || []) as HistoryRow[]);
    };
    const readInvites = async () => {
      const { data, error } = await supabase
        .from('academy_test_invitations')
        .select('athlete_id, status, confirmed_slot')
        .eq('status', 'confirmed');
      return error ? [] : ((data || []) as Array<{ athlete_id: string; status: string | null; confirmed_slot: string | null }>);
    };
    const readPendingTests = async () => {
      const { data, error } = await supabase
        .from('academy_tests')
        .select('athlete_id, submitted_at')
        .eq('status', 'pending');
      return error ? [] : ((data || []) as Array<{ athlete_id: string; submitted_at: string | null }>);
    };
    const manager = isAcademyManager(caller);
    const readFunnel = async (): Promise<{ candidates: CandidateRow[]; events: CandidateEvent[] } | null> => {
      if (!manager) return null;
      let cRes: any = await supabase.from('academy_candidates').select('id, name, athlete_id, archived_at, accepted_at, created_at');
      if (cRes.error && isMissingColumn(cRes.error)) {
        cRes = await supabase.from('academy_candidates').select('id, name, athlete_id, archived_at, created_at');
      }
      const eRes: any = await supabase.from('academy_candidate_events').select('candidate_id, stage, occurred_at');
      if (cRes.error) return null;
      return {
        // An accepted card is a trainee now, not somebody on the way in.
        candidates: ((cRes.data || []) as any[]).filter((c) => !c.accepted_at).map((c) => ({
          id: c.id, name: c.name, athleteId: c.athlete_id, archivedAt: c.archived_at, createdAt: c.created_at,
        })),
        events: (eRes.error ? [] : eRes.data || []).map((e: any) => ({
          candidateId: e.candidate_id, stage: e.stage, occurredAt: e.occurred_at,
        })),
      };
    };

    const [visible, athRes, history, invites, pendingTests, funnelRows, settings] = await Promise.all([
      visibleTraineeIds(caller, request),
      Promise.resolve(supabase
        .from('athletes')
        .select('id, name, is_academy, approved, status, academy_joined_on, academy_coach_id')
        .eq('coach_id', COACH_ID)),
      readHistory(),
      readInvites(),
      readPendingTests(),
      readFunnel(),
      loadAcademySettings(),
    ]);
    if (athRes.error) return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });
    const rows = (athRes.data || []) as any[];
    const names = new Map<string, string>(rows.map((r) => [r.id, r.name]));

    const current = rows.filter((a) => a.is_academy && a.approved !== false && a.status !== 'removed' && (!visible || visible.has(a.id)));
    const currentIds = new Set(current.map((a) => a.id as string));
    const left = deriveLeft(rows, history, names, today)
      // A coach sees the leavers they coached last; the manager sees them all.
      .filter((l) => !visible || (!!caller.athleteId && l.previousCoachId === caller.athleteId));

    const people = {
      current: current.map((a) => ({ joinedOn: a.academy_joined_on ?? null })),
      left: left.map((l) => ({ joinedOn: l.joinedOn, leftOn: l.leftOn })),
    };

    let funnel: AcademyHomeResponse['funnel'] = null;
    if (funnelRows && !visible) {
      const board = buildFunnel({ candidates: funnelRows.candidates, events: funnelRows.events, now: new Date().toISOString() });
      funnel = {
        live: board.live,
        forms: (board.columns.find((c) => c.spec.key === 'intro_call')?.candidates ?? [])
          .map((c) => ({ id: c.id, name: c.name, since: c.waitingSince })),
        stuck: board.columns
          .filter((c) => c.spec.key !== 'intro_call')
          .flatMap((c) => c.candidates.filter((x) => x.stuck).map((x) => ({
            id: x.id, name: x.name, since: x.waitingSince, waiting: c.spec.waiting, days: x.daysWaiting,
          })))
          .sort((a, b) => b.days - a.days),
      };
    }

    const body: AcademyHomeResponse = {
      scope: visible ? 'coach' : 'academy',
      weeks: buildGrowth({ weeks: trendWeeks(planWeekStartOf(), WEEKS), ...people }),
      month: monthMoves({ ...people, today }),
      today: todayTests(
        invites.filter((i) => currentIds.has(i.athlete_id)).map((i) => ({ status: i.status, confirmedSlot: i.confirmed_slot })),
        today,
      ),
      approvals: pendingTests
        .filter((t) => currentIds.has(t.athlete_id))
        .map((t) => ({ athleteId: t.athlete_id, name: names.get(t.athlete_id) || '', submittedAt: t.submitted_at ?? null }))
        .sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || '')),
      funnel,
      coachCapacity: settings.coachCapacity,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('Academy home error:', error);
    return NextResponse.json({ error: 'Failed to load the academy home' }, { status: 500 });
  }
}

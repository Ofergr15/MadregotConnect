import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { PAIN_SELECT, callerMaySeePain, shapePain, type PainRow } from '@/lib/feedback/pain-server';
import { featureResolution } from '@/lib/features/server';
import { mayToggle } from '@/lib/features/flags';
import { athleteToggleFacts, toggleCaller } from '@/lib/features/manage-server';
import { computeRoster, readLists } from '@/lib/coach/roster-server';
import { isRepeatPain, PACE_AT_HR_BPM, painSpot } from '@/lib/coach/attention';
import { fetchWeeklyVolume } from '@/lib/athletes/weekly-volume';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { paceAtHr, type PaceRunInput } from '@/lib/fitness/pace-at-hr';
import { addDaysToDateStr } from '@/lib/utils';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RUN_TYPES = ['running', 'road_running', 'trail_running', 'track_running', 'treadmill_running', 'indoor_running'];
const PACE_WEEKS = 8;

// GET /api/coach/athlete/[id] — the staff-only block of "רץ בעיני המאמן".
//
// requireStaff: a runner (the athlete themself included) gets 403, so the block is
// omitted server-side rather than hidden client-side. The member part of the
// screen keeps using the existing member routes, unchanged. Everything here is
// derived by existing engines — assessWeek (via computeRoster), fetchWeeklyVolume
// (Monday weeks, generated axis) and lib/fitness/pace-at-hr (laps in 5-bpm bands).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const db = createServerClient();
    const roster = await computeRoster(db, { onlyAthleteId: id, weeksBack: 4 });
    const runner = roster.runners[0];
    if (!runner) return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
    const today = roster.meta.today;

    const since = addDaysToDateStr(today, -(7 * PACE_WEEKS + 29));
    const [fbRes, volume, runs, lists] = await Promise.all([
      db.from('workout_feedback')
        .select('pain, pain_detail, difficulty, feel, comment, created_at')
        .eq('athlete_id', id)
        .gte('created_at', `${addDaysToDateStr(today, -60)}T00:00:00Z`)
        .order('created_at', { ascending: false })
        .limit(50),
      fetchWeeklyVolume(db, { athleteIds: [id], weeks: 5, currentWeekStart: roster.meta.activityWeek }),
      fetchAllRows<PaceRunInput>((from, to) => db.from('athlete_activities')
        .select('id, start_time, activity_type, distance, duration, laps')
        .eq('athlete_id', id)
        .in('activity_type', RUN_TYPES)
        .gte('start_time', `${since}T00:00:00`)
        .order('start_time', { ascending: true })
        .order('id')
        .range(from, to)),
      readLists(db),
    ]);

    // Pain reports (migration 191) — only for staff inside this runner's pain scope
    // (lib/feedback/pain.ts staffMaySeePain): an academy manager gets nothing for a club
    // runner. Opening the card stamps seen_at, the "seen" the runner sees.
    let painReports: ReturnType<typeof shapePain>[] = [];
    if ((await callerMaySeePain(db, caller, id)) === 'staff') {
      const { data: pr } = await db.from('pain_reports').select(PAIN_SELECT).eq('athlete_id', id)
        .order('created_at', { ascending: false }).limit(20);
      const rows = (pr || []) as PainRow[];
      painReports = rows.map(shapePain);
      const unseen = rows.filter((r) => !r.seen_at && r.status !== 'withdrawn').map((r) => r.id);
      if (unseen.length && !caller.viewingAsBy) {
        await db.from('pain_reports').update({ seen_at: new Date().toISOString(), seen_by: caller.athleteId ?? caller.email }).in('id', unseen);
      }
    }
    const [rolloutRes, toggleFacts] = await Promise.all([
      featureResolution('feedback_pain', id, db),
      athleteToggleFacts(db, caller, id),
    ]);
    const feedbackRollout = {
      enabled: rolloutRes.enabled,
      source: rolloutRes.source,
      mayToggle: !!toggleFacts && mayToggle(toggleCaller(caller), { scopeType: 'athlete', scopeId: id, athlete: toggleFacts }),
    };

    const fb = (fbRes.error ? [] : fbRes.data || []) as any[];
    const latest = fb[0] ?? null;
    const pains = fb.filter((f) => f.pain);
    const buckets = volume.byAthlete.get(id) || [];
    const prev = buckets.slice(0, -1);
    const curKm = Math.round((buckets[buckets.length - 1]?.meters ?? 0) / 100) / 10;
    const avg4 = prev.length ? Math.round(prev.reduce((t, b) => t + b.meters, 0) / prev.length / 100) / 10 : null;
    const pace = paceAtHr(runs, { today, weeks: PACE_WEEKS });
    const band = pace.bands[PACE_AT_HR_BPM] ?? [];

    return NextResponse.json({
      runner,
      meta: roster.meta,
      squads: roster.squads,
      listNames: (lists?.lists || []).filter((l: any) => runner.lists.includes(l.id)).map((l: any) => ({ id: l.id, name: l.name })),
      staff: {
        feedback: latest ? {
          date: String(latest.created_at).slice(0, 10),
          pain: !!latest.pain,
          detail: latest.pain_detail ?? latest.comment ?? null,
          where: latest.pain ? painSpot(latest.pain_detail ?? null) : null,
          rpe: latest.difficulty ?? null,
          repeat: latest.pain ? isRepeatPain(pains.map((p) => ({ createdAt: p.created_at, detail: p.pain_detail ?? null }))) : false,
        } : null,
        accuracy: runner.accuracy.slice(-4),
        load: { weekToDateKm: curKm, avgPrev4Km: avg4, activityWeek: roster.meta.activityWeek },
        // Oldest first; the client draws newest on the left (RTL).
        paceAtHr: { bpm: PACE_AT_HR_BPM, points: band.map((p) => ({ date: p.date, pace: p.paceSecPerKm, km: p.km })) },
        lastRpe: fb.find((f) => f.difficulty != null)?.difficulty ?? null,
        painReports,
        feedbackRollout,
      },
    });
  } catch (error: any) {
    console.error('[coach/athlete] failed:', error);
    return NextResponse.json(internalErrorBody('Failed to load'), { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityWeekStart, getActivityWeekStart, groupDisplayName, israelDateAnchor } from '@/lib/utils';
import { computeAcademyWeekAdherence, sundayOf } from '@/lib/academy/report';
import {
  completionRateOf, deriveAttention, emptyTeamTotals, rollupGroups, rollupTeam,
  type AcademyGroupSummary, type AcademyMember,
} from '@/lib/academy/members';
import { requireStaff } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * One request for the whole academy "center" — the manager's overview and the
 * member directory are the same data seen two ways, so they must not be two
 * fetches that can disagree.
 *
 * Before this route, the academy screen answered "who is in the academy?" from
 * `/api/athletes` (the club-wide roster, filtered client-side on `isAcademy`)
 * and every other question from a separate tab-scoped endpoint. That made the
 * roster the one tab that could tell you a member existed while saying nothing
 * about whether they were actually training — you had to visit three tabs and
 * hold the join in your head. For an academy of a few dozen athletes that is
 * the whole job, so it belongs in one payload.
 */

// The types and every "is this member in trouble?" rule live in
// @/lib/academy/members — pure, shared with the client components, and unit
// tested there. This route is the query layer only.

const round1 = (meters: number) => Math.round(meters / 100) / 10;
const toMin = (sec: number) => Math.round(sec / 60);

export async function GET(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    // Default to the current activity week, but let the caller page back — the
    // overview and the compliance tab must be able to show the same week.
    const weekStart = searchParams.get('weekStart')
      ? sundayOf(searchParams.get('weekStart'))
      : getActivityWeekStart(israelDateAnchor());

    const supabase = createServerClient();

    // Guarded select: avatar_url / approved / role / strava_auth all arrived in
    // later migrations, and this screen must still render on an older schema
    // rather than 500 — same defensive shape as /api/athletes and the other
    // academy routes.
    let rows: any[] = [];
    const primary = await supabase
      .from('athletes')
      .select('id, name, email, avatar_url, status, role, approved, group_id, garmin_auth, strava_auth, is_academy, created_at, groups (name)')
      .eq('coach_id', COACH_ID);
    if (primary.error) {
      const fallback = await supabase
        .from('athletes')
        .select('id, name, email, status, group_id, garmin_auth, is_academy, created_at, groups (name)')
        .eq('coach_id', COACH_ID);
      rows = fallback.error ? [] : fallback.data || [];
    } else {
      rows = primary.data || [];
    }

    const members = rows.filter((a) => a.is_academy);

    if (!members.length) {
      return NextResponse.json({
        weekStart,
        members: [] as AcademyMember[],
        groups: [] as AcademyGroupSummary[],
        team: emptyTeamTotals(),
        pending: { registrations: 0, results: 0 },
      });
    }

    const memberIds = members.map((a) => a.id);

    // Activity aggregation. Paged because PostgREST caps a response at 1000
    // rows and all-time totals would silently undercount past that — the same
    // trap /api/academy/stats already guards.
    const acts: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: page, error } = await supabase
        .from('athlete_activities')
        .select('athlete_id, distance, duration, start_time')
        .in('athlete_id', memberIds)
        .range(offset, offset + 999);
      if (error || !page || page.length === 0) break;
      acts.push(...page);
      if (page.length < 1000) break;
    }

    type Acc = { km: number; runs: number; dur: number };
    const zero = (): Acc => ({ km: 0, runs: 0, dur: 0 });
    const week = new Map<string, Acc>();
    const all = new Map<string, Acc>();
    const lastAt = new Map<string, string>();

    for (const r of acts) {
      const dist = Number(r.distance) || 0;
      const dur = Number(r.duration) || 0;
      const a = all.get(r.athlete_id) || zero();
      a.km += dist; a.runs += 1; a.dur += dur;
      all.set(r.athlete_id, a);

      // Bucket by the activity's OWN week key, not a string compare against
      // `weekStart` — the caller can ask for a past week, where ">= weekStart"
      // would sweep in everything since.
      if (r.start_time && activityWeekStart(r.start_time) === weekStart) {
        const w = week.get(r.athlete_id) || zero();
        w.km += dist; w.runs += 1; w.dur += dur;
        week.set(r.athlete_id, w);
      }
      const prev = lastAt.get(r.athlete_id);
      if (r.start_time && (!prev || r.start_time > prev)) lastAt.set(r.athlete_id, r.start_time);
    }

    // Planned-vs-actual for the same week, from the one implementation the
    // compliance tab and the weekly-report cron already share.
    const adherence = await computeAcademyWeekAdherence({ weekStart });
    const adherenceById = new Map(adherence.athletes.map((a) => [a.athleteId, a.week]));

    // Pending results queue — a manager signal, and cheap to fold in here
    // rather than making the overview wait on a second round trip. Guarded:
    // `status` may be unmigrated, in which case nothing is pending.
    let pendingResults = 0;
    const pend = await supabase
      .from('benchmark_results')
      .select('id', { count: 'exact', head: true })
      .eq('coach_id', COACH_ID)
      .eq('status', 'pending');
    if (!pend.error) pendingResults = pend.count || 0;

    const nowMs = israelDateAnchor().getTime();

    const result: AcademyMember[] = members.map((a) => {
      const w = week.get(a.id) || zero();
      const t = all.get(a.id) || zero();
      const adh = adherenceById.get(a.id);
      const last = lastAt.get(a.id) || null;
      const daysSince = last
        ? Math.max(0, Math.floor((nowMs - new Date(last).getTime()) / 86_400_000))
        : null;
      const hasGarmin = !!a.garmin_auth;
      const hasStrava = !!a.strava_auth;
      // `approved` predates the column guard above; absent means "not gated".
      const approved = a.approved === undefined ? true : !!a.approved;
      const planned = adh?.plannedCount ?? 0;
      const completed = adh?.completedCount ?? 0;
      const completionRate = completionRateOf(planned, completed);

      return {
        athleteId: a.id,
        name: a.name,
        email: a.email,
        avatarUrl: a.avatar_url || null,
        groupId: a.group_id || null,
        groupName: a.groups?.name ? groupDisplayName(a.groups.name) : null,
        status: a.status || null,
        role: a.role || null,
        approved,
        hasWatch: hasGarmin || hasStrava,
        hasGarmin,
        hasStrava,
        joinedAt: a.created_at || null,
        weekKm: round1(w.km),
        weekRuns: w.runs,
        weekDurationMin: toMin(w.dur),
        totalKm: round1(t.km),
        totalRuns: t.runs,
        lastActivityAt: last,
        daysSinceActivity: daysSince,
        plannedCount: planned,
        completedCount: completed,
        completionRate,
        attention: deriveAttention({
          approved,
          hasWatch: hasGarmin || hasStrava,
          daysSinceActivity: daysSince,
          weekRuns: w.runs,
          plannedCount: planned,
          completionRate,
        }),
      };
    });

    return NextResponse.json({
      weekStart,
      members: result.sort((x, y) => y.weekKm - x.weekKm || x.name.localeCompare(y.name)),
      groups: rollupGroups(result),
      team: rollupTeam(result),
      pending: {
        registrations: result.filter((m) => !m.approved).length,
        results: pendingResults,
      },
    });
  } catch (error: any) {
    console.error('Academy members error:', error);
    return NextResponse.json({ error: error.message || 'Failed to load members' }, { status: 500 });
  }
}

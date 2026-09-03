import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityWeekStart, getActivityWeekStart, groupDisplayName, israelDateAnchor } from '@/lib/utils';
import { computeAcademyWeekAdherence, sundayOf } from '@/lib/academy/report';
import {
  completionRateOf, deriveAttention, emptyTeamTotals, rollupBands, rollupCoaches, rollupGroups, rollupTeam,
  type AcademyCoachRef, type AcademyCoachSummary, type AcademyGroupSummary, type AcademyMember,
} from '@/lib/academy/members';
import { toBand, type AcademyBand } from '@/lib/academy/bands';
import { isStaffRole, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

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
 *
 * Since migration 077 the payload is also *scoped*: a manager gets every pair, a
 * coach gets the trainees dedicated to them. That's the point of the pairing
 * column — until it existed there was nothing to filter on, so every staff
 * caller was handed the whole academy including addresses.
 */

// The types and every "is this member in trouble?" rule live in
// @/lib/academy/members — pure, shared with the client components, and unit
// tested there. This route is the query layer only.

const round1 = (meters: number) => Math.round(meters / 100) / 10;
const toMin = (sec: number) => Math.round(sec / 60);

// Selected in three tiers, widest first. The pairing columns
// (`academy_coach_id`, the goal band and the pace override) arrive in migration
// 077 and `avatar_url` / `approved` / `role` / `strava_auth` in earlier ones, and
// this screen has to render on whichever schema it meets rather than 500 — the
// same defensive shape /api/athletes uses. Stepping down one tier at a time
// matters: before 077, a single fallback would also have cost the avatars.
//
// The 077 columns are one tier, not several: they land in a single migration, so
// splitting them would add a fallback that no real schema can ever be in.
const COLS_PAIRED = 'id, name, email, avatar_url, status, role, approved, group_id, garmin_auth, strava_auth, is_academy, created_at, academy_coach_id, academy_joined_on, academy_band_id, academy_pace_offset_sec, groups (name)';
const COLS_FULL = 'id, name, email, avatar_url, status, role, approved, group_id, garmin_auth, strava_auth, is_academy, created_at, groups (name)';
const COLS_MIN = 'id, name, email, status, group_id, garmin_auth, is_academy, created_at, groups (name)';

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    // Who runs the academy, versus who coaches in it. A manager sees every pair
    // — that's the job. Anyone else on staff sees only the trainees assigned to
    // them, enforced here rather than in the component, because this payload
    // carries every member's email and approval state: a coach filtering the
    // list client-side would still have been handed the whole academy.
    const isManager = caller.isSuperUser || caller.role === 'admin';

    const { searchParams } = new URL(request.url);
    // Default to the current activity week, but let the caller page back — the
    // overview and the compliance tab must be able to show the same week.
    const weekStart = searchParams.get('weekStart')
      ? sundayOf(searchParams.get('weekStart'))
      : getActivityWeekStart(israelDateAnchor());

    const supabase = createServerClient();

    let rows: any[] = [];
    // Whether the 1:1 pairing columns exist yet. When they don't, the screen
    // still works — it just has no coaches to show, so it must not then report
    // every trainee as unpaired.
    let hasPairing = true;
    const paired = await supabase.from('athletes').select(COLS_PAIRED).eq('coach_id', COACH_ID);
    if (paired.error) {
      hasPairing = false;
      const primary = await supabase.from('athletes').select(COLS_FULL).eq('coach_id', COACH_ID);
      if (primary.error) {
        const fallback = await supabase.from('athletes').select(COLS_MIN).eq('coach_id', COACH_ID);
        rows = fallback.error ? [] : fallback.data || [];
      } else {
        rows = primary.data || [];
      }
    } else {
      rows = paired.data || [];
    }

    // Every staff account is a candidate dedicated coach, whether or not it holds
    // anyone today — an idle coach is the manager's spare capacity, so it has to
    // appear in the load view and in the assign picker. Manager-only: a coach has
    // no use for the roster and no permission to reassign against it.
    const coachRoster: AcademyCoachRef[] = isManager && hasPairing
      ? rows.filter((a) => isStaffRole(a.role)).map((a) => ({ coachId: a.id, coachName: a.name }))
      : [];
    const coachNames = new Map<string, string>(rows.map((a) => [a.id, a.name]));

    const academyRows = rows.filter((a) => a.is_academy);
    const members = isManager
      ? academyRows
      : academyRows.filter((a) => a.academy_coach_id && a.academy_coach_id === caller.athleteId);
    const scope: 'academy' | 'coach' = isManager ? 'academy' : 'coach';

    // The goal bands (דבוקות). Read whole — six rows — and sent to every staff
    // caller: a coach needs the band names to read their own trainees, not only
    // the manager who assigns them. Guarded and read before the empty-roster
    // return, so the band list is available to an academy with nobody in it yet
    // (which is exactly when it's being set up).
    const bandById = new Map<string, AcademyBand>();
    if (hasPairing) {
      const { data: bandRows, error: bandErr } = await supabase
        .from('academy_bands')
        .select('id, band_number, name, goal, pace_profile')
        .eq('active', true);
      if (!bandErr) {
        for (const b of bandRows || []) bandById.set(b.id, toBand(b));
      }
    }
    const allBands = [...bandById.values()];

    if (!members.length) {
      return NextResponse.json({
        weekStart,
        members: [] as AcademyMember[],
        groups: [] as AcademyGroupSummary[],
        coaches: rollupCoaches([], coachRoster),
        bands: rollupBands([], allBands),
        team: emptyTeamTotals(),
        pending: { registrations: 0, results: 0 },
        scope,
      });
    }

    const memberIds = members.map((a) => a.id);

    // Whether pairing is even possible yet — see `academyHasCoaches` in
    // deriveAttention. Read off the athletes rows so it holds for a coach's own
    // scoped payload too, where `coachRoster` is deliberately empty.
    const academyHasCoaches = hasPairing && rows.some((a) => isStaffRole(a.role));

    // Same guard, one axis over: with no bands defined there is nothing to assign,
    // so "no band" would be one setup task reported once per trainee. 077 seeds
    // six, so in practice this is only false on an unmigrated schema.
    const academyHasBands = hasPairing && allBands.length > 0;

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
      const academyCoachId = a.academy_coach_id || null;
      const band = a.academy_band_id ? bandById.get(a.academy_band_id) || null : null;
      // A stored 0 is a real decision ("runs exactly at band pace"), so this
      // cannot be `|| null` — that would erase it and silently fall back to the
      // band's own offset.
      const paceOffsetSec = typeof a.academy_pace_offset_sec === 'number'
        ? a.academy_pace_offset_sec
        : null;

      return {
        athleteId: a.id,
        name: a.name,
        email: a.email,
        avatarUrl: a.avatar_url || null,
        groupId: a.group_id || null,
        groupName: a.groups?.name ? groupDisplayName(a.groups.name) : null,
        academyCoachId,
        academyCoachName: academyCoachId ? coachNames.get(academyCoachId) || null : null,
        band,
        paceOffsetSec,
        status: a.status || null,
        role: a.role || null,
        approved,
        hasWatch: hasGarmin || hasStrava,
        hasGarmin,
        hasStrava,
        joinedAt: a.created_at || null,
        academyJoinedOn: a.academy_joined_on || null,
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
          hasCoach: !!academyCoachId,
          academyHasCoaches,
          hasBand: academyHasBands ? !!band : undefined,
        }),
      };
    });

    return NextResponse.json({
      weekStart,
      members: result.sort((x, y) => y.weekKm - x.weekKm || x.name.localeCompare(y.name)),
      groups: rollupGroups(result),
      coaches: rollupCoaches(result, coachRoster) as AcademyCoachSummary[],
      bands: rollupBands(result, allBands),
      team: rollupTeam(result),
      pending: {
        registrations: result.filter((m) => !m.approved).length,
        results: pendingResults,
      },
      scope,
    });
  } catch (error: any) {
    console.error('Academy members error:', error);
    return NextResponse.json({ error: error.message || 'Failed to load members' }, { status: 500 });
  }
}

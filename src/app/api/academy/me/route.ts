import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityWeekStart, getActivityWeekStart, groupDisplayName, israelDateAnchor } from '@/lib/utils';
import { computeAcademyWeekAdherence, sundayOf } from '@/lib/academy/report';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/me?athleteId=…&weekStart=YYYY-MM-DD
 *
 * The academy as one of its athletes sees it. Deliberately a separate route
 * from /api/academy/members rather than a "scope=self" flag on it: that one is
 * staff-only and returns every member's email, approval state and attention
 * flags, and the safest way to keep an athlete out of that payload is for the
 * athlete's screen never to call it.
 *
 * What an athlete does get about others is a first-names-and-distance
 * leaderboard — the same club-internal shape the feed and the group leaderboards
 * already show every member — and nothing else.
 */

const LEADERBOARD_SIZE = 10;

const round1 = (meters: number) => Math.round(meters / 100) / 10;
const toMin = (sec: number) => Math.round(sec / 60);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    }
    // Self-or-staff: an athlete may pull their own academy view, and a coach may
    // pull it for any athlete (that's what the member drill-in shows).
    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

    const weekStart = searchParams.get('weekStart')
      ? sundayOf(searchParams.get('weekStart'))
      : getActivityWeekStart(israelDateAnchor());

    const supabase = createServerClient();

    let rows: any[] = [];
    const primary = await supabase
      .from('athletes')
      .select('id, name, avatar_url, group_id, garmin_auth, strava_auth, is_academy, groups (name)')
      .eq('coach_id', COACH_ID);
    if (primary.error) {
      const fallback = await supabase
        .from('athletes')
        .select('id, name, group_id, garmin_auth, is_academy, groups (name)')
        .eq('coach_id', COACH_ID);
      rows = fallback.error ? [] : fallback.data || [];
    } else {
      rows = primary.data || [];
    }

    const me = rows.find((a) => a.id === athleteId);
    // "Not a member" is an answer, not an error — the screen renders an invite
    // to talk to the coach rather than an error state, and this way it never
    // leaks academy numbers to a club runner who isn't in it.
    if (!me || !me.is_academy) {
      return NextResponse.json({ isMember: false, weekStart });
    }

    const members = rows.filter((a) => a.is_academy);
    const memberIds = members.map((a) => a.id);

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

    for (const r of acts) {
      const dist = Number(r.distance) || 0;
      const dur = Number(r.duration) || 0;
      const a = all.get(r.athlete_id) || zero();
      a.km += dist; a.runs += 1; a.dur += dur;
      all.set(r.athlete_id, a);
      if (r.start_time && activityWeekStart(r.start_time) === weekStart) {
        const w = week.get(r.athlete_id) || zero();
        w.km += dist; w.runs += 1; w.dur += dur;
        week.set(r.athlete_id, w);
      }
    }

    // The athlete's own planned-vs-actual, from the same shared implementation
    // the coach's compliance table uses — so the two can't disagree about
    // whether a session counted.
    const adherence = await computeAcademyWeekAdherence({ weekStart, onlyAthleteId: athleteId });
    const myWeek = adherence.athletes[0]?.week ?? {
      plannedCount: 0, completedCount: 0, completionRate: 0, avgScore: 0, workouts: [],
    };

    const myWeekAcc = week.get(athleteId) || zero();
    const myAllAcc = all.get(athleteId) || zero();

    const ranked = members
      .map((a) => ({
        athleteId: a.id,
        name: a.name,
        avatarUrl: a.avatar_url || null,
        weekKm: round1((week.get(a.id) || zero()).km),
        weekRuns: (week.get(a.id) || zero()).runs,
      }))
      .sort((x, y) => y.weekKm - x.weekKm || x.name.localeCompare(y.name));

    // Rank counts only athletes who actually ran: being "12th of 30" when 25 of
    // them ran nothing is a discouraging lie about where you stand.
    const withRuns = ranked.filter((r) => r.weekRuns > 0);
    const myPosition = withRuns.findIndex((r) => r.athleteId === athleteId);

    const leaderboard = ranked.slice(0, LEADERBOARD_SIZE).map((r) => ({
      athleteId: r.athleteId,
      name: r.name,
      avatarUrl: r.avatarUrl,
      weekKm: r.weekKm,
      isMe: r.athleteId === athleteId,
    }));
    // Always show the athlete their own row, even outside the top slice —
    // otherwise the one person the screen is for is the one it omits.
    if (!leaderboard.some((r) => r.isMe)) {
      const mine = ranked.find((r) => r.athleteId === athleteId);
      if (mine) {
        leaderboard.push({
          athleteId: mine.athleteId, name: mine.name, avatarUrl: mine.avatarUrl,
          weekKm: mine.weekKm, isMe: true,
        });
      }
    }

    // The athlete's own benchmark results (approved only — a pending one hasn't
    // been confirmed by a coach yet, so it has no rank to show).
    let myResults: any[] = [];
    const bench = await supabase
      .from('benchmark_results')
      .select('id, test_name, time_seconds, recorded_on, status, athlete_id')
      .eq('coach_id', COACH_ID)
      .order('time_seconds', { ascending: true });
    if (!bench.error) {
      const allApproved = (bench.data || []).filter((r: any) => (r.status ?? 'approved') === 'approved');
      const rankByTest: Record<string, number> = {};
      myResults = allApproved
        .map((r: any) => {
          rankByTest[r.test_name] = (rankByTest[r.test_name] || 0) + 1;
          return { ...r, rank: rankByTest[r.test_name], entrants: 0 };
        })
        .filter((r: any) => r.athlete_id === athleteId)
        .map((r: any) => ({
          id: r.id,
          testName: r.test_name,
          timeSeconds: r.time_seconds,
          recordedOn: r.recorded_on,
          rank: r.rank,
          entrants: allApproved.filter((x: any) => x.test_name === r.test_name).length,
        }));
    }

    const academyWeekKm = ranked.reduce((sum, r) => Math.round((sum + r.weekKm) * 10) / 10, 0);

    return NextResponse.json({
      isMember: true,
      weekStart,
      athlete: {
        athleteId: me.id,
        name: me.name,
        avatarUrl: me.avatar_url || null,
        groupName: me.groups?.name ? groupDisplayName(me.groups.name) : null,
        hasWatch: !!me.garmin_auth || !!me.strava_auth,
      },
      week: myWeek,
      volume: {
        weekKm: round1(myWeekAcc.km),
        weekRuns: myWeekAcc.runs,
        weekDurationMin: toMin(myWeekAcc.dur),
        totalKm: round1(myAllAcc.km),
        totalRuns: myAllAcc.runs,
        totalDurationMin: toMin(myAllAcc.dur),
      },
      rank: myPosition >= 0
        ? { position: myPosition + 1, of: withRuns.length }
        : null,
      academy: {
        members: members.length,
        activeThisWeek: withRuns.length,
        weekKm: academyWeekKm,
        avgWeekKm: members.length ? Math.round((academyWeekKm / members.length) * 10) / 10 : 0,
      },
      leaderboard,
      results: myResults,
    });
  } catch (error: any) {
    console.error('Academy me error:', error);
    return NextResponse.json({ error: error.message || 'Failed to load academy view' }, { status: 500 });
  }
}

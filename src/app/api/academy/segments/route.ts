import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { GarminClient } from '@/lib/garmin/client';
import { activityLocalDateStr, planWeekStartOf } from '@/lib/utils';
import { ParsedWorkout } from '@/lib/ai/types';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { assessWorkout, buildPlannedWorkout } from '@/lib/academy/adherence';
import {
  flattenPlannedSteps,
  matchLapsToSteps,
  buildPlannedBands,
  findPlannedEfforts,
  isContinuousPlan,
  Lap,
} from '@/lib/academy/segments';
import { buildVerdict } from '@/lib/plan-execution/verdict';
import { fromGarminLaps, toLaps } from '@/lib/plan-execution/laps';
import { groupNumberForAthlete } from '@/lib/plans/match-athlete-activities';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';

export const dynamic = 'force-dynamic';
/**
 * GET /api/academy/segments?athleteId=&date=YYYY-MM-DD
 *
 * Three modes over one plan lookup, because resolving WHICH plan and which pace
 * lane an athlete is graded against is the part that must not drift:
 *   (default)   per-segment planned-vs-actual verdicts, from that day's laps
 *   ?bands=1    the day's planned pace bands, for the chart overlay
 *   ?verdict=1  did this run match the plan — whole-run metrics + the effort check
 *
 * `bands` and `verdict` may be asked for together and answer in one response.
 * `?activityId=` pins which of the day's runs to grade; without it the one
 * closest to planned distance is used, matching the adherence engine.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    const date = searchParams.get('date');
    if (!athleteId || !date) {
      return NextResponse.json({ error: 'athleteId and date are required' }, { status: 400 });
    }
    const wantsBands = !!searchParams.get('bands');
    const wantsVerdict = !!searchParams.get('verdict');

    // Two trust levels behind one route.
    //
    // `bands` returns only the day's PLANNED paces — club training content, and
    // the feed requests it for whoever's activity is being expanded, so any
    // member may.
    //
    // `verdict` is self-or-staff. It briefly wasn't: labelling a comparison the
    // chart already draws looked like no new class of data, and trimming the
    // per-rep paces looked like enough. But the verdict now carries an accuracy
    // PERCENTAGE, which is a different object from a band on a chart — it is a
    // score on a named person, legible at a glance and comparable between
    // teammates, and the spec for it was "the ring appears only on that person's
    // own workouts; staff see everything". A member reading a stranger's ring is
    // exactly what that rules out.
    //
    // Enforced by OMISSION, not refusal, and the difference matters: the activity
    // detail asks for the bands and the verdict in one request, so answering 403
    // to a member expanding a teammate's card would take the chart overlay down
    // with the score they weren't allowed to see. `verdict: null` is a state this
    // caller already renders — it's what a day with no plan returns.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const mayReadVerdict = mayActFor(caller, athleteId);
    // The per-segment default mode is every rep this person ran: self-or-staff,
    // and here there is nothing left to answer with, so it stays a refusal.
    if (!wantsBands && !wantsVerdict && !mayReadVerdict) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const emitVerdict = wantsVerdict && mayReadVerdict;

    const supabase = createServerClient();
    const weekStart = planWeekStartOf(date);
    const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
    const { tolerances } = await loadAcademySettings();
    const { paceSec } = tolerances;

    // Which of the three pace lanes this athlete runs. It has to be resolved
    // before any plan is read: grading a group-3 athlete's laps against group 1's
    // paces is exactly the false "slower than target" verdict that the adherence
    // engine stopped producing, and this route was still doing it — it took
    // whichever group bucket appeared first in the blob, which is always group 1.
    // Started here and awaited after the plan read below, so its two round trips
    // overlap that one instead of adding to the response time.
    const lanePromise = groupNumberForAthlete(supabase, athleteId);

    // 1) Planned workout for that day — the athlete's individual plan wins (newest,
    //    tolerating duplicates), else the coach-wide shared plan (athlete_id NULL).
    let workouts: ParsedWorkout[] = [];
    const indiv = await supabase
      .from('weekly_plans').select('parsed_workouts, created_at')
      .eq('week_start_date', weekStart).eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });
    // laneWorkouts reads either stored shape: the pre-split group buckets of
    // older rows, or a unified plan, which it runs through splitIntoGroups so
    // "3:20 (3:30) ((3:40))" resolves down to the one pace this athlete was
    // actually asked to run. An individual plan goes through it too — it's
    // single-lane, so a plain plan comes back untouched, and one that does carry
    // bracket notation resolves to this athlete's lane rather than the fastest.
    const lane = (await lanePromise) as Lane;
    if (!indiv.error && indiv.data && indiv.data.length) {
      workouts = laneWorkouts(indiv.data[0].parsed_workouts, lane);
    } else {
      let shared = await supabase
        .from('weekly_plans').select('parsed_workouts, created_at')
        .eq('coach_id', COACH_ID).eq('week_start_date', weekStart)
        .is('athlete_id', null)
        .order('created_at', { ascending: false });
      if (shared.error) {
        shared = await supabase
          .from('weekly_plans').select('parsed_workouts, created_at')
          .eq('coach_id', COACH_ID).eq('week_start_date', weekStart)
          .order('created_at', { ascending: false });
      }
      workouts = shared.data?.length ? laneWorkouts(shared.data[0].parsed_workouts, lane) : [];
    }
    const planned = workouts.find(w => w.dayOfWeek === dayOfWeek);
    if (!planned) {
      const reason = 'no planned workout for this day';
      if (wantsBands || wantsVerdict) {
        return NextResponse.json({
          ...(wantsBands ? { bands: null } : {}),
          ...(wantsVerdict ? { verdict: null } : {}),
          reason,
        });
      }
      return NextResponse.json({ segments: [], aligned: false, reason });
    }

    // Chart-overlay mode: the planned pace BANDS on a meter timeline. The client
    // projects them onto the activity's actual split distances (splits are not
    // always 1km). bands:null → the day has no paced plan.
    //
    // No lap fetch needed, so `?bands=1` alone answers here. Asked for alongside
    // `?verdict=1` it rides along on the plan lookup both modes share, which is
    // what the activity detail wants: one request for the overlay and the verdict.
    const bandsPayload = wantsBands
      ? (() => {
        const bands = buildPlannedBands(planned);
        return {
          bands: bands.length ? bands : null,
          // Whether a kilometre grid is a fair frame for these bands. Answered
          // here because only this side holds the plan's steps, and the bands
          // themselves cannot tell an interval session from a continuous run —
          // see `isContinuousPlan`. Same plan content, same gate: no new surface.
          continuous: isContinuousPlan(planned),
          workoutName: planned.name,
        };
      })()
      : {};
    // Everything below this line reads the athlete's activity and its laps, which
    // is work only a verdict needs. A bands-only request stops here — and so does a
    // request for a verdict this caller may not read, which is what keeps the
    // omission above from quietly costing an activity read and a lap match.
    if (!emitVerdict) {
      if (wantsBands || wantsVerdict) {
        return NextResponse.json({ ...bandsPayload, ...(wantsVerdict ? { verdict: null } : {}) });
      }
    }

    // 2) The matched activity for that date, with its stored laps.
    const { data: acts } = await supabase
      .from('athlete_activities')
      .select('id, garmin_activity_id, start_time, distance, duration, moving_duration, average_pace, activity_type, laps')
      .eq('athlete_id', athleteId)
      .gte('start_time', `${date}T00:00:00Z`)
      .lte('start_time', `${date}T23:59:59Z`);
    const dayActs = (acts || []).filter((a: any) => activityLocalDateStr(a.start_time) === date);
    // A running plan grades runs. A ride or a swim on a plan day isn't a worse
    // version of the workout, it isn't the workout — and "closest to planned
    // distance" below would happily pick a 40 km ride over the 20 km run.
    const runActs = dayActs.filter(
      (a: any) => !a.activity_type || PR_RUN_TYPES.includes(a.activity_type));
    // A named activity wins: the detail page is asking about the run on screen,
    // and "closest to planned distance" would happily grade the other one.
    const pinnedId = searchParams.get('activityId');
    // Pick the activity closest to planned distance (mirrors adherence matching).
    const plannedDist = (planned.distanceMinKm || 0) * 1000;
    const activity = pinnedId
      ? runActs.find((a: any) => a.id === pinnedId) || null
      : runActs.sort((a: any, b: any) =>
        Math.abs((a.distance || 0) - plannedDist) - Math.abs((b.distance || 0) - plannedDist))[0] || null;

    if (!activity) {
      // Say which it was: the caller pinned an activity that exists but isn't a run.
      const reason = pinnedId && dayActs.some((a: any) => a.id === pinnedId)
        ? 'activity is not a run'
        : 'no completed activity on this day';
      // Still hand back the bands: the plan is real even when this route can't find
      // the run, and the caller's chart has an activity on screen either way.
      if (emitVerdict) return NextResponse.json({ ...bandsPayload, verdict: null, reason });
      return NextResponse.json({ segments: [], aligned: false, reason });
    }

    // 3) Ensure laps — fetch on-demand from Garmin if not cached.
    // Through `toLaps`, never straight off the jsonb: a Strava-synced run stores
    // `moving_time` with no `duration` and no `averagePace`, so the raw read left
    // every lap zero-duration — indistinguishable here from a run with no laps at
    // all, which fell the verdict back to distance alone.
    let laps: Lap[] = toLaps(activity.laps);
    if (laps.length === 0) {
      const { data: ath } = await supabase
        .from('athletes').select('garmin_auth').eq('id', athleteId).maybeSingle();
      if (ath?.garmin_auth) {
        try {
          const client = new GarminClient(ath.garmin_auth as any);
          const lapData = await client.getActivitySplits(Number(activity.garmin_activity_id));
          if (Array.isArray(lapData) && lapData.length > 1) {
            // Through `fromGarminLaps`, so the cache this route writes carries the
            // HR and elevation the run detail's charts read. The hand-rolled map
            // that used to live here kept three fields, and this route is the
            // first to touch most runs — which is why those charts were empty.
            const stored = fromGarminLaps(lapData);
            laps = toLaps(stored);
            // Best-effort cache back (ignore if column unmigrated).
            await supabase.from('athlete_activities').update({ laps: stored })
              .eq('id', activity.id).then(() => {}, () => {});
          }
        } catch { /* laps optional */ }
      }
    }

    // 4) Flatten + match + grade.
    const flat = flattenPlannedSteps(planned);
    const report = matchLapsToSteps(flat, laps, paceSec);
    // Plus the order-free verdict, which is the only one an athlete who ran the
    // session off the watch (no per-step laps) can get. Always returned: when the
    // positional alignment succeeded it's a cheap cross-check, and when it failed
    // it's the answer to "did they do the workout" the caller actually wanted.
    const efforts = findPlannedEfforts(flat, laps, paceSec);

    // Verdict mode: the accuracy verdict for ONE run, from the single scorer in
    // `lib/plan-execution/verdict.ts`. It is handed the same two inputs every
    // other surface uses — the whole-run metrics from the adherence engine and
    // the per-step lap match — so the ring here, the ring on the feed and the
    // ring on the coach's compliance table cannot disagree about one run.
    //
    // `efforts` rides along unscored. It answers "are there 6×400 in this run
    // anywhere", without needing the watch to have driven the workout, which is
    // the one question `report` cannot answer when the laps are auto 1 km splits.
    // Folding it into the score would change what the percentage MEANS, so that
    // is deliberately a separate change; carrying it here costs nothing and is
    // what the detail card shows instead of "we could not read the laps".
    if (emitVerdict) {
      const graded = assessWorkout(
        buildPlannedWorkout(planned, date),
        {
          id: activity.id,
          date,
          distance: Number(activity.distance) || 0,
          duration: Number(activity.duration) || 0,
          movingDuration: activity.moving_duration != null ? Number(activity.moving_duration) : null,
          averagePace: activity.average_pace != null ? Number(activity.average_pace) : null,
          activityType: activity.activity_type,
        },
        tolerances,
      );
      return NextResponse.json({
        ...bandsPayload,
        verdict: buildVerdict({
          activityId: activity.id,
          athleteId,
          adherence: graded,
          segments: report,
          tolerances,
          workoutName: planned.name,
        }),
        efforts,
        tolerances,
      });
    }

    return NextResponse.json({ ...report, efforts });
  } catch (error: any) {
    console.error('Academy segments error:', error);
    return NextResponse.json({ error: error.message || 'Failed to compute segments' }, { status: 500 });
  }
}

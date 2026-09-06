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
} from '@/lib/academy/segments';
import { dominantBlock, gradePlanBlocks, traceFromLaps, traceFromStream } from '@/lib/academy/execution';
import { dominantWatchStep, gradeWatchSteps, type WatchStepReport } from '@/lib/academy/watch-steps';
import { loadActivityStream } from '@/lib/garmin/stream-store';
import { narrowLaps, normalizeStoredLaps, type StoredLap } from '@/lib/garmin/laps';
import { narrowExecutedWorkout, type ExecutedWorkout } from '@/lib/garmin/executed-workout';
import { groupNumberForAthlete } from '@/lib/plans/match-athlete-activities';
import { PLAN_STATUSES } from '@/lib/plans/plan-status';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';

export const dynamic = 'force-dynamic';

/**
 * A teammate's copy of the watch's step-by-step report: the session's shape and each
 * part's verdict, with the numbers a per-km split doesn't already give away removed.
 *
 * `occurrences` goes entirely — that is a rep-by-rep pace readout of someone else's
 * intervals, the one thing `?verdict=1` was made member-visible without.
 */
function trimWatchReport(report: WatchStepReport): WatchStepReport {
  return {
    ...report,
    steps: report.steps.map(step => ({
      ...step,
      actualPace: null,
      gradeAdjustedPace: null,
      averageHR: null,
      occurrences: [],
    })),
  };
}

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

    // Three trust levels behind one route.
    //
    // `bands` returns only the day's PLANNED paces — club training content, and
    // the feed requests it for whoever's activity is being expanded, so any
    // member may. `verdict` is member-visible too: on the activity detail the
    // planned band and the actual pace line already sit on the same chart for any
    // member, so labelling that comparison publishes no new class of data — but
    // the per-rep paces inside it are trimmed below for anyone but the athlete
    // and staff. The default mode returns the athlete's own laps step by step,
    // and stays self-or-staff.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const isOwnOrStaff = mayActFor(caller, athleteId);
    if (!wantsBands && !wantsVerdict && !isOwnOrStaff) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

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
    //    Published weeks only: a `draft` is the coach mid-edit, and neither the
    //    chart's target band nor a verdict should come from a week nobody was asked
    //    to run. Same filter matchAthleteActivities attributes runs with.
    let workouts: ParsedWorkout[] = [];
    const indiv = await supabase
      .from('weekly_plans').select('parsed_workouts, created_at')
      .eq('week_start_date', weekStart).eq('athlete_id', athleteId)
      .in('status', PLAN_STATUSES)
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
        .in('status', PLAN_STATUSES)
        .order('created_at', { ascending: false });
      if (shared.error) {
        shared = await supabase
          .from('weekly_plans').select('parsed_workouts, created_at')
          .eq('coach_id', COACH_ID).eq('week_start_date', weekStart)
          .in('status', PLAN_STATUSES)
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
        return { bands: bands.length ? bands : null, workoutName: planned.name };
      })()
      : {};
    if (wantsBands && !wantsVerdict) return NextResponse.json(bandsPayload);

    // 2) The matched activity for that date, with its stored laps and — when the run
    //    was driven by a structured workout — the step list those laps are stamped
    //    with. Retried without `executed_workout` because migration 095 is applied by
    //    hand: without the fallback an unapplied migration returns no rows at all here,
    //    which this route would report as "no completed activity on this day".
    const activityColumns =
      'id, garmin_activity_id, garmin_workout_id, start_time, distance, duration,'
      + ' moving_duration, average_pace, activity_type, laps';
    const dayRange = (q: any) => q
      .eq('athlete_id', athleteId)
      .gte('start_time', `${date}T00:00:00Z`)
      .lte('start_time', `${date}T23:59:59Z`);
    let actsRes = await dayRange(supabase.from('athlete_activities')
      .select(`${activityColumns}, executed_workout`));
    if (actsRes.error) {
      actsRes = await dayRange(supabase.from('athlete_activities').select(activityColumns));
    }
    const acts = actsRes.data;
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
      if (wantsVerdict) return NextResponse.json({ ...bandsPayload, verdict: null, reason });
      return NextResponse.json({ segments: [], aligned: false, reason });
    }

    // 3) Ensure laps — fetch on-demand from Garmin if not cached.
    // Through the normalizer, not straight off the row: `laps` is jsonb three
    // writers have filled, and reading only Garmin's `duration` key gave every
    // Strava athlete a set of zero-duration laps — indistinguishable here from a
    // run with no markers at all.
    // Typed as StoredLap, not the narrower `Lap` the segment matcher takes: the step
    // index rides on the wider shape and is what the watch path grades from.
    let laps: StoredLap[] = normalizeStoredLaps(activity.laps);
    let executedWorkout = (activity as { executed_workout?: ExecutedWorkout | null })
      .executed_workout ?? null;
    const isStamped = (ls: StoredLap[]) => ls.some(l => l.wktStepIndex != null);
    // A watch-driven run whose stored laps predate step-index storage: the index is
    // the whole basis of the step-by-step verdict, so it is worth re-asking for. Only
    // when the row says the run came from a workout — otherwise there is nothing to
    // stamp and the refetch would be pure cost on every plain run anyone opens.
    const wantsStamps = activity.garmin_workout_id != null && !isStamped(laps);
    if (laps.length === 0 || wantsStamps || (activity.garmin_workout_id && !executedWorkout)) {
      const { data: ath } = await supabase
        .from('athletes').select('garmin_auth').eq('id', athleteId).maybeSingle();
      if (ath?.garmin_auth) {
        try {
          const client = new GarminClient(ath.garmin_auth as any);
          if (laps.length === 0 || wantsStamps) {
            // Through `narrowLaps`, not a hand-rolled map: the map this replaced kept
            // three fields, so `wktStepIndex` — the watch's own answer to "which step
            // was this" — was fetched and thrown away on the line that stored it.
            const lapData = await client.getActivitySplits(Number(activity.garmin_activity_id));
            const narrowed = narrowLaps(lapData);
            if (narrowed.length > 1) {
              laps = narrowed;
              // Best-effort cache back (ignore if column unmigrated).
              await supabase.from('athlete_activities').update({ laps })
                .eq('id', activity.id).then(() => {}, () => {});
            }
          }
          // Only worth asking once the laps are known to be stamped: without an index
          // to resolve, the step list grades nothing.
          if (!executedWorkout && isStamped(laps)) {
            executedWorkout = narrowExecutedWorkout(
              await client.getActivityWorkout(Number(activity.garmin_activity_id)));
            if (executedWorkout) {
              await supabase.from('athlete_activities')
                .update({ executed_workout: executedWorkout })
                .eq('id', activity.id).then(() => {}, () => {});
            }
          }
        } catch { /* laps and the step list are both optional */ }
      }
    }

    // 3b) The distance/time trace the plan's blocks are graded over. The stored
    //     ~1 Hz stream when there is one, otherwise the laps — even plain 1 km
    //     auto-laps place a 20 km block to within a kilometre, which is well inside
    //     the accuracy a pace verdict needs, so this works for the whole club
    //     before a single stream has been backfilled.
    const stored = await loadActivityStream(supabase, activity.id);
    const trace = traceFromStream(stored?.series) ?? traceFromLaps(laps);

    // 4) Flatten + match + grade.
    const flat = flattenPlannedSteps(planned);
    const report = matchLapsToSteps(flat, laps, paceSec);
    // Block-aligned pace: each planned block graded over its own stretch of the run
    // rather than against the whole-run average. This is the fix for the verdict an
    // athlete who ran "2 km easy + 20 km at 4:25 + 8 strides" used to get — 4:33
    // against 4:25, "slower", while the 20 km block was 4:23.
    const blocks = gradePlanBlocks(flat, trace, paceSec);
    // Plus the order-free verdict, which is the only one an athlete who ran the
    // session off the watch (no per-step laps) can get. Always returned: when the
    // positional alignment succeeded it's a cheap cross-check, and when it failed
    // it's the answer to "did they do the workout" the caller actually wanted.
    const efforts = findPlannedEfforts(flat, laps, paceSec);
    // And, for a run the watch drove, the account that needs no searching at all: every
    // lap already carries the step it was, so the block does not have to be located and
    // a rep does not have to be recognised by its length. Null for the ~85% of runs
    // started as plain runs, and for a stamped run whose indices don't fit the list.
    const watched = executedWorkout
      ? gradeWatchSteps(executedWorkout, laps, lane, paceSec)
      : null;

    // Verdict mode: the same two answers the academy compliance table gives, for
    // ONE run — the whole-run metrics from the adherence engine (so a coach can't
    // get two different verdicts for the same run out of two screens) plus the
    // effort check for the reps inside it.
    if (wantsVerdict) {
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

      // The pace row answers "did you hit the pace you were asked to run". When the
      // plan has a block and the run has a trace, that question is about the block,
      // so the block's answer replaces the whole-run one — the longest graded block,
      // because that is what the session was mostly about. The average is still
      // returned as `wholeRunPace` so a card can show both, and `scope` tells the
      // client which stretch of the run the number describes.
      //
      // Exposure: a block average is COARSER than the per-km splits already visible
      // to any member on this run's chart and in the feed's `paceBands`, so putting
      // it in the member-visible verdict publishes nothing new. The per-rep paces
      // below stay trimmed — those are finer than splits.
      //
      // The watch's own step wins over the searched block when there is one: same
      // question, same `dominant*` rule, evidence instead of inference. It also fixes a
      // case the search cannot — an athlete running a workout of their own making was
      // being graded against the club plan's structure, which on one real Sunday turned
      // her 22 km at 4:48 (her own step said 4:35-4:45: on target) into "slower".
      const watchStep = watched ? dominantWatchStep(watched) : null;
      const dominant = watchStep ?? dominantBlock(blocks);
      const pace = dominant
        ? {
          status: dominant.status,
          plannedMin: dominant.plannedPaceMin,
          plannedMax: dominant.plannedPaceMax,
          comparedMin: dominant.plannedPaceMin,
          comparedMax: dominant.plannedPaceMax,
          actual: dominant.actualPace,
          scope: watchStep
            ? {
              label: watchStep.label,
              // The watch names a step, not a stretch of the distance axis: it can
              // report the same step several times over (eight strides), so there is
              // no single from/to to give. `steps` below carries the detail.
              fromM: null,
              toM: null,
              plannedLengthM: watchStep.plannedDistanceM,
              truncated: watchStep.truncated,
              resolutionM: null,
              source: 'watch' as const,
            }
            : {
              label: dominant.label,
              fromM: 'window' in dominant ? dominant.window?.startM ?? null : null,
              toM: 'window' in dominant ? dominant.window?.endM ?? null : null,
              plannedLengthM: 'plannedLengthM' in dominant ? dominant.plannedLengthM : null,
              truncated: dominant.truncated,
              resolutionM: blocks.resolutionM,
              source: blocks.source,
            },
        }
        : graded.pace;

      // Re-score against the corrected pace status, or the score would keep counting
      // the average-based miss this route just stopped reporting.
      const scored = [graded.distance.status, graded.duration.status, pace.status]
        .filter(s => s !== 'unknown');
      const score = scored.length
        ? scored.filter(s => s === 'on_target').length / scored.length
        : graded.score;

      return NextResponse.json({
        ...bandsPayload,
        verdict: {
          workoutName: planned.name,
          date,
          activityId: activity.id,
          distance: graded.distance,
          duration: graded.duration,
          pace,
          wholeRunPace: graded.pace,
          blocks,
          score,
          // Which rep paces a teammate may read is the one thing this mode trims:
          // aggregate counts answer "did they do the session" without handing the
          // club a rep-by-rep readout of someone else's intervals.
          efforts: isOwnOrStaff
            ? efforts
            : { ...efforts, requirements: efforts.requirements.map(r => ({ ...r, paces: [] })) },
          // The watch's step-by-step account, trimmed on the same rule as the reps
          // above. A step can be a 45-second stride, so its pace is FINER than the
          // per-km splits any member can already see — that number and the heart rate
          // beside it are the athlete's and staff's. What stays for a teammate is the
          // shape of the session and whether each part was hit: the same grain as the
          // badge on the card that got them here.
          watchSteps: watched && (isOwnOrStaff ? watched : trimWatchReport(watched)),
          alignedToWatch: report.aligned,
        },
        tolerances,
      });
    }

    return NextResponse.json({ ...report, efforts, blocks });
  } catch (error: any) {
    console.error('Academy segments error:', error);
    return NextResponse.json({ error: error.message || 'Failed to compute segments' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { GarminClient } from '@/lib/garmin/client';
import { COACH_ID } from '@/lib/constants';
import { notifyAthlete, notifyTeammatesOfActivity } from '@/lib/push';
import { activitySyncedCopy } from '@/lib/notifications/copy';
import { checkAndAwardBadges } from '@/lib/badges/award-engine';
import { checkAndAwardChallenges } from '@/lib/challenges/engine';
import { checkShoeAlert } from '@/lib/shoes';
import { notifyMainWorkoutFeedback } from '@/lib/post-workout';
import { matchAthleteActivities } from '@/lib/plans/match-athlete-activities';
import { dedupeSameSourceBatch, findCrossSourceDuplicate, twinVerdict, upgradePatch } from '@/lib/activity-dedup';
import { mapActivityDetail } from '@/lib/garmin/activity-detail';
import { isMissingColumn, withoutColumns } from '@/lib/supabase/schema-drift';
import { backfillGarminWorkoutIds } from '@/lib/garmin/workout-id-backfill';
import { lapsWorthStoring, narrowLaps } from '@/lib/garmin/laps';
import { narrowExecutedWorkout } from '@/lib/garmin/executed-workout';
import { saveActivityStream } from '@/lib/garmin/stream-store';
import { backfillActivityStreams } from '@/lib/garmin/stream-backfill';
import { backfillGarminHistory } from '@/lib/garmin/history-backfill';
import { requireCallerForAthlete, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { looksLikeAuthFailure, markProviderAuthFailed, markProviderSynced } from '@/lib/providers/health';
import { fillMissingProfileFields, garminProfileFields } from '@/lib/providers/profile';

/**
 * Both handlers here walk rows making SERIAL Garmin requests, so neither fits the
 * platform default — and having no ceiling declared is not the same as having a
 * generous one: the request is then killed mid-flight with no error body, so the
 * caller sees a dead request and cannot tell a timeout from a bug. That is exactly
 * how the first Garmin history import failed.
 *
 * The PATCH backfills are the binding case: `?mode=stream` is 1-3 requests per row
 * and a 40-row batch is comfortably a minute of wall clock, so on the default the
 * function dies mid-batch — the rows it already wrote are kept (each is committed as
 * it goes), but `nextBefore` never comes back and the caller's cursor loop stalls on
 * the same batch forever.
 *
 * 300s is what `push-workouts` and `strava/sync-activities` use for the same reason:
 * a provider round trip per page, writes in batches, and a human watching.
 */
export const maxDuration = 300;

/**
 * How many Strava rows one sync may upgrade for one athlete. Sized against the
 * ceiling above: each upgrade is the same 2-4 serial Garmin calls a new run costs,
 * and the crons run hourly, so a Strava-only history of ~100 runs is repaired
 * within a day without any single request going near 300 s.
 */
const UPGRADES_PER_SYNC = 5;

/**
 * HTTP entry point. Anyone could previously trigger a full-club Garmin sync —
 * one unauthenticated POST per second was a free way to burn the club's Garmin
 * rate limit and push a feedback nudge at every athlete.
 *
 * The crons call `runSyncRequest` below directly instead of going through this
 * gate: they authenticate with CRON_SECRET at their own entry point, and an
 * in-process call has no session to present.
 */
export async function POST(request: Request) {
  // clone() because the body is read again inside runSyncRequest, and a Request
  // body can only be consumed once.
  const { athleteId } = await request.clone().json().catch(() => ({} as { athleteId?: string }));
  const { denied } = await requireCallerForAthlete(request, athleteId);
  if (denied) return denied;
  return runSyncRequest(request);
}

export async function runSyncRequest(request: Request) {
  try {
    // suppressPush: skip the inline post-workout feedback nudge. Used by the
    // morning workout-watch cron, which sends its own "new workout detected"
    // teaser instead — so the athlete gets one morning push, not two.
    const { athleteId, suppressPush } = await request.json().catch(() => ({}));
    const supabase = createServerClient();

    // .returns<any[]>() — cols is a runtime string (not a literal), so Supabase
    // can't infer a field-shaped row type from it; that would otherwise fall
    // back to a useless generic error type instead of the athletes row shape.
    const buildAthleteQuery = (cols: string) => {
      let q = supabase.from('athletes').select(cols);
      q = athleteId ? q.eq('id', athleteId) : q.eq('coach_id', COACH_ID).not('garmin_auth', 'is', null);
      return q.returns<any[]>();
    };

    // gender/birth_date ride along so the profile auto-fill below can tell whether
    // this athlete still needs asking, without a second query per athlete.
    let { data: athletes, error: athError } = await buildAthleteQuery('id, name, garmin_auth, active_shoe_id, gender, birth_date');
    if (athError?.code === '42703') {
      // active_shoe_id not migrated yet — degrade to the pre-shoes shape
      // rather than failing sync for every athlete over one missing column.
      ({ data: athletes, error: athError } = await buildAthleteQuery('id, name, garmin_auth, gender, birth_date'));
    }
    if (athError) throw athError;
    if (!athletes || athletes.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No athletes with Garmin auth found' });
    }

    let totalSynced = 0;
    const results: Array<{ athleteId: string; name: string; synced: number; upgradedFromStrava?: number; sameDeviceDupes?: number; profileFilled?: string[]; error?: string }> = [];

    for (const athlete of athletes) {
      if (!athlete.garmin_auth) continue;

      try {
        const client = new GarminClient(athlete.garmin_auth as any);
        let activities;
        try {
          activities = await client.getActivities(0, 100);
        } catch (fetchErr: any) {
          // A rejected credential is the one failure the athlete has to act on, and
          // until now it was indistinguishable from a Garmin blip: both landed in
          // `results` and the profile screen went on saying "Connected" either way.
          if (looksLikeAuthFailure(fetchErr)) await markProviderAuthFailed(supabase, athlete.id, 'garmin');
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: `Fetch failed: ${fetchErr.message}` });
          continue;
        }

        // Garmin answered, so the credential works — regardless of whether there
        // was anything new in the list. Stamped here rather than at the end of the
        // loop body because the three `continue`s below (no activities, no runs)
        // are successful syncs too, and a member who hasn't run this fortnight must
        // not be told their watch is disconnected.
        await markProviderSynced(supabase, athlete.id, 'garmin');

        // Gender and date of birth, from the watch account instead of from a form.
        // One extra Garmin request, and only while something is actually missing.
        const filledProfile = await fillMissingProfileFields(
          supabase,
          athlete.id,
          athlete as { gender?: string | null; birth_date?: string | null },
          () => garminProfileFields(client),
        );

        if (!activities || activities.length === 0) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: 'No activities returned from Garmin' });
          continue;
        }

        const runTypes = ['running', 'trail_running', 'treadmill_running', 'track_running', 'street_running', 'indoor_running'];
        const runActivities = activities.filter(a =>
          runTypes.includes(a.activityType) || a.activityType.includes('running')
        );

        if (runActivities.length === 0) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: `No runs. Types found: ${activities.slice(0, 5).map(a => a.activityType).join(', ')}` });
          continue;
        }

        const { data: existing } = await supabase
          .from('athlete_activities')
          .select('garmin_activity_id')
          .eq('athlete_id', athlete.id);

        const existingIds = new Set((existing || []).map(e => e.garmin_activity_id));
        const freshActivities = runActivities.filter(a => !existingIds.has(a.activityId));

        // Two Garmin devices, one run. An athlete wearing a watch AND a band
        // uploads the session twice under two different activity ids, so
        // `existingIds` can't see it and the cross-source check below won't
        // either — both rows are Garmin's. Measured 2026-09-09: 16.1 km with a
        // route and 14.7 km without, 47 seconds apart, in this same batch, both
        // on the club feed and both in his weekly total.
        //
        // Collapsed BEFORE the per-candidate work below, so the loser never costs
        // its 2-4 Garmin detail requests either.
        const { keep: candidateActivities, dropped: sameDeviceDupes } =
          dedupeSameSourceBatch(freshActivities);

        // Strava can independently import this same run (Garmin auto-export) —
        // strava/sync-activities' own existingByStrava check can never catch that,
        // since it's keyed by strava_activity_id. Without this, every such run gets
        // counted twice (badges, challenges, shoe mileage, teammate pushes). See
        // hasCrossSourceDuplicate's own comment.
        //
        // A Strava twin is UPGRADED rather than skipped. Both rows describe the
        // same run, but the watch knows where each lap ended and Strava's export
        // of it does not — so whichever cron happened to run first decided
        // whether the athlete sees the intervals they ran or a row of even
        // kilometres. Reported 2026-09-08 by an athlete looking at exactly that.
        //
        // Upgraded in place, never delete-and-reinsert: the row id is what the
        // feed item, its kudos and its comments point at, and a fresh insert
        // would also announce the run to the club a second time.
        const newActivities: typeof candidateActivities = [];
        const allUpgrades: Array<{ rowId: string; activity: (typeof candidateActivities)[number] }> = [];
        for (const a of candidateActivities) {
          const twin = await findCrossSourceDuplicate(supabase, athlete.id, a.startTimeLocal, a.distance, a.duration);
          const verdict = twinVerdict(twin);
          if (verdict === 'insert') newActivities.push(a);
          else if (verdict === 'upgrade' && twin) allUpgrades.push({ rowId: twin.id, activity: a });
          // 'skip' is left alone — see twinVerdict.
        }
        // Capped, because the first sync after this shipped is the expensive one: a
        // dual-connected athlete whose whole history arrived through Strava has every
        // run in this 100-activity list window eligible at once, at 2-4 SERIAL Garmin
        // requests each against a 300 s function ceiling — and the build loop below
        // runs before any write, so blowing the ceiling would cost the batch its new
        // runs too. Each row is upgraded at most once, so the backlog drains over the
        // hourly crons; the cap only decides how fast.
        //
        // Sorted newest-first EXPLICITLY rather than leaning on the list order, so
        // today's session is the one repaired first: `getActivities` happens to return
        // newest first, but a cap that silently depends on a provider's ordering is a
        // cap that spends a day draining the oldest end of the backlog if that ever
        // changes — and the athlete asking why their splits are wrong is asking about
        // this morning.
        const upgrades = allUpgrades
          .slice()
          .sort((a, b) => (a.activity.startTimeLocal < b.activity.startTimeLocal ? 1 : -1))
          .slice(0, UPGRADES_PER_SYNC);

        // Declared out here so the per-athlete result below can report it.
        let upgradedFromStrava = 0;

        if (newActivities.length + upgrades.length > 0) {
          const rows: Record<string, any>[] = [];
          // Traces are collected here and written after the upsert: activity_streams
          // is keyed by athlete_activities.id, which only exists once the row does.
          const traces: Array<{
            garminActivityId: number;
            stream: Awaited<ReturnType<typeof client.getActivityTrace>>['stream'];
            laps: unknown[] | null;
          }> = [];
          // New runs first, then the ones replacing a Strava row: the two halves
          // of `rows` are sliced apart again below, and the notify loop pairs
          // `rows[i]` with `newActivities[i]`.
          const toBuild = [...newActivities, ...upgrades.map(u => u.activity)];
          for (const a of toBuild) {
            // Detail and GPS are fetched INDEPENDENTLY, and the polyline is
            // requested unconditionally. Both matter:
            //  - the old code only fetched GPS when `detail.hasPolyline` was
            //    true, but that field reads null on every real response (see
            //    lib/garmin/activity-detail.ts), so no run ever got a route —
            //    hence no map anywhere in the app.
            //  - the old code fetched both inside one try, so a detail failure
            //    also cost the polyline.
            // getActivityGpsPoints already returns [] for a genuinely GPS-less
            // activity (treadmill) or any error, so it's safe to always ask.
            let detail: any = null;
            try {
              detail = await client.getActivityFull(a.activityId);
            } catch { /* the list row + polyline still carry most of it */ }
            // One details call, both answers. This endpoint's response carries the
            // per-sample trace as well as the polyline, and until now the sync read
            // the polyline out of it and dropped the rest — the trace is what makes
            // "did they run the 20 km block at 4:25" answerable at all, since a
            // whole-run average includes the warm-up and the strides.
            const { gpsPoints, stream } = await client.getActivityTrace(a.activityId, a.distance);
            const enriched = mapActivityDetail(detail, a, gpsPoints);

            // Laps at SYNC time, not when a human happens to open the run. They were
            // on-demand only, so 49 of the last 659 runs had any — meaning no rep
            // verdict was computable for the rest, on the screen every athlete sees.
            // `lapCount` comes free on the list row: 1 lap is the run itself and
            // tells the engine nothing, so only ask Garmin when there are markers.
            let lapDTOs: unknown[] = [];
            if ((a.lapCount || 0) > 1) {
              lapDTOs = await client.getActivitySplits(a.activityId);
            }
            traces.push({
              garminActivityId: a.activityId,
              stream,
              laps: lapsWorthStoring(lapDTOs) ? lapDTOs : null,
            });
            const laps = lapsWorthStoring(lapDTOs) ? narrowLaps(lapDTOs) : [];

            // The workout the device ran, but only when a lap says it ran one. Every
            // stamped lap carries `wktStepIndex`, an index into a step list this row
            // does not have — and the number is worse than useless without it, since a
            // "3" read against our own parsed plan names a different step than the
            // watch meant (repeat markers occupy indices; athletes run workouts we
            // didn't write). Gating on the stamp rather than asking for every activity
            // keeps this at zero extra requests for the ~85% of runs that are plain,
            // and it's the exact condition under which the answer is usable:
            // `garmin_workout_id` comes off a list field that doesn't always populate.
            let executedWorkout = null;
            if (laps.some(l => l.wktStepIndex != null) || a.workoutId) {
              executedWorkout = narrowExecutedWorkout(await client.getActivityWorkout(a.activityId));
            }

            rows.push({
              athlete_id: athlete.id,
              garmin_activity_id: a.activityId,
              activity_name: a.activityName,
              activity_type: a.activityType,
              start_time: a.startTimeLocal,
              distance: Math.round(a.distance),
              duration: Math.round(a.duration),
              average_pace: a.distance > 0 ? Math.round(a.duration / (a.distance / 1000)) : null,
              average_hr: a.averageHR,
              max_hr: a.maxHR,
              calories: a.calories || null,
              elevation_gain: a.elevationGain,
              shoe_id: athlete.active_shoe_id || null,
              ...(laps.length ? { laps } : {}),
              ...(executedWorkout ? { executed_workout: executedWorkout } : {}),
              ...enriched,
            });
          }

          // upsert + ignoreDuplicates (not a plain insert) — two overlapping
          // syncs for the same athlete (e.g. two workout-watch cron
          // invocations, one running long enough to still be in this
          // per-activity Garmin API loop when the next fires) can both
          // compute the same "new" activity from their own existingIds
          // snapshot; a plain insert would throw a unique_violation on the
          // second one and fail this whole batch, unlike Strava's per-
          // activity upsert, which already guards exactly this race.
          const upsertActivities = (payload: Record<string, any>[]) =>
            supabase
              .from('athlete_activities')
              .upsert(payload, { onConflict: 'athlete_id,garmin_activity_id', ignoreDuplicates: true })
              .select('id, garmin_activity_id');

          const upgradeRows = rows.slice(newActivities.length);
          let payload: Record<string, any>[] = rows.slice(0, newActivities.length);
          // An empty upsert is a wasted round trip at best, so a batch of nothing
          // but upgrades skips straight past it.
          let { data: insertedRows, error: insertError } = payload.length
            ? await upsertActivities(payload)
            : { data: [] as { id: string; garmin_activity_id: number }[], error: null as null | { code?: string } };

          // Columns an unapplied migration can leave missing, newest first. Each
          // retry drops only the column the error actually NAMES, one at a time:
          // a database without garmin_workout_id (migration 092) must not also
          // lose shoe attribution, which is what stripping both at once costs.
          const optionalColumns = ['executed_workout', 'garmin_workout_id', 'laps', 'shoe_id'];
          const dropped: string[] = [];
          while (insertError && dropped.length < optionalColumns.length) {
            const failure = insertError;
            // 42703/PGRST204: that column isn't there yet. 23503: active_shoe_id
            // was read once at the top of this request and the athlete deleted
            // that shoe mid-sync (this loop makes sequential Garmin detail/GPS
            // calls per activity, so the window can be seconds long) — the stale
            // reference fails the FK constraint. Either way, retry without the
            // column rather than losing this whole batch's activities
            // (badges/streaks/teammate notify/feedback prompt all depend on the
            // insert succeeding).
            const drop =
              optionalColumns.find(c => !dropped.includes(c) && isMissingColumn(failure, c)) ||
              (failure.code === '23503' && !dropped.includes('shoe_id') ? 'shoe_id' : null);
            if (!drop) break;
            dropped.push(drop);
            payload = withoutColumns(payload, [drop]) as Record<string, any>[];
            ({ data: insertedRows, error: insertError } = await upsertActivities(payload));
          }
          if (insertError) throw insertError;
          totalSynced += newActivities.length;

          // Write the watch's own record of the run onto each Strava twin. Same row,
          // same id, so the feed item and its kudos survive.
          //
          // ADD, don't replace: `upgradePatch` strips the fields where Garmin's
          // answer is worse than the one already on the row — a null Garmin doesn't
          // report, the athlete's own name, and today's shoe on a month-old run. An
          // upgrade that erases data isn't one.
          //
          // Best-effort per row, and deliberately after the insert: a database
          // missing one of the optional columns must not cost the batch its new
          // runs just because an upgrade couldn't be written.
          const upgradedIds: Array<{ garminActivityId: number; rowId: string }> = [];
          for (let i = 0; i < upgrades.length; i++) {
            const { rowId, activity } = upgrades[i];
            let update: Record<string, any> = upgradePatch(upgradeRows[i]);
            const droppedHere: string[] = [];
            let { error: upgradeError } = await supabase.from('athlete_activities').update(update).eq('id', rowId);
            while (upgradeError && droppedHere.length < optionalColumns.length) {
              const drop =
                optionalColumns.find(c => !droppedHere.includes(c) && isMissingColumn(upgradeError, c)) ||
                (upgradeError.code === '23503' && !droppedHere.includes('shoe_id') ? 'shoe_id' : null);
              if (!drop) break;
              droppedHere.push(drop);
              update = withoutColumns([update], [drop])[0] as Record<string, any>;
              ({ error: upgradeError } = await supabase.from('athlete_activities').update(update).eq('id', rowId));
            }
            if (upgradeError) {
              console.warn(`Upgrading Strava row ${rowId} to Garmin activity ${activity.activityId} failed:`, upgradeError);
              continue;
            }
            upgradedFromStrava++;
            upgradedIds.push({ garminActivityId: activity.activityId, rowId });
          }

          // One check per batch (not per activity) — checkShoeAlert already
          // sums every activity on the shoe, so re-checking per-row here would
          // just re-derive the same total repeatedly.
          if (athlete.active_shoe_id) await checkShoeAlert(athlete.active_shoe_id);

          // Map back to the real row id per Garmin activity, so kudos (which
          // targets athlete_activities.id, not the legacy garmin_activity_id)
          // has something real to reference.
          const idByGarminActivityId = new Map<number, string>(
            (insertedRows || []).map((r: { id: string; garmin_activity_id: number }) => [r.garmin_activity_id, r.id]),
          );
          // The upgraded rows already had ids; the trace loop below needs them
          // too, since the stream is what makes the laps readable.
          for (const u of upgradedIds) idByGarminActivityId.set(u.garminActivityId, u.rowId);

          // Store the evidence for each run just inserted. Best-effort by design:
          // a trace that fails to save costs that run its rep verdict, and nothing
          // else — never the sync, the badges or the teammate pushes below.
          for (const trace of traces) {
            const activityId = idByGarminActivityId.get(trace.garminActivityId);
            if (!activityId) continue; // deduped by the upsert — already has its own row
            await saveActivityStream(supabase, {
              activityId,
              garminActivityId: trace.garminActivityId,
              source: 'garmin',
              stream: trace.stream,
              laps: trace.laps,
            });
          }

          // Notify group teammates for each genuinely new run just inserted
          // above (never for anything filtered out of `newActivities` via
          // `existingIds`, i.e. never on a re-sync of something already
          // known). `rows` was built 1:1 in the same order as `newActivities`.
          // Never let a push failure break the sync itself.
          try {
            await Promise.all(
              newActivities.map(async (a, i) => {
                const row = rows[i];
                const activityId = idByGarminActivityId.get(a.activityId);
                if (!activityId) return; // shouldn't happen, but never notify without a real target
                try {
                  await notifyTeammatesOfActivity({
                    athleteId: athlete.id,
                    activityKey: `${athlete.id}-${a.activityId}`,
                    activityId,
                    distanceMeters: row.distance,
                    // Not every new row deserves an announcement: a first-ever
                    // connection backfills months of history as "new" here.
                    // notifyTeammatesOfActivity drops anything that finished
                    // over a day ago — same rule as the nudge below.
                    startTime: row.start_time,
                    durationSeconds: row.duration,
                  });
                } catch (notifyErr) {
                  console.warn(`Teammate notify for Garmin activity ${a.activityId} failed:`, notifyErr);
                }
              }),
            );
          } catch { /* belt-and-suspenders: inner catch already handles per-activity failures */ }

          // Post-workout nudge (PRD §1): push the athlete to fill the feedback
          // questionnaire for the day's MAIN workout. Inline (not cron) so
          // it's timely; never let a push failure break the sync. Skipped
          // when suppressPush is set (the morning workout-watch cron sends
          // its own teaser instead).
          //
          // Ledgered per athlete+day (notifyMainWorkoutFeedback), not scoped
          // to just this call's newActivities — a quality day often syncs as
          // several separate Garmin activities (warmup, interval/tempo set,
          // cooldown), and syncing more than once in a day (mid-run, then
          // again after finishing) used to fire this prompt once per call,
          // each only considering that call's own batch.
          // `newActivities` can now be empty — a batch of nothing but upgrades of
          // runs the club has already been told about, which is not news and not
          // a reason to ask anyone how their session went.
          if (!suppressPush && newActivities.length > 0) {
            const newest = newActivities.reduce((a, b) => (new Date(a.startTimeLocal) > new Date(b.startTimeLocal) ? a : b));
            await notifyMainWorkoutFeedback({ athleteId: athlete.id, dateStr: newest.startTimeLocal.split('T')[0] });
          }

          // "Customize your post" nudge — same sheet the Strava client-side
          // sync-diff opens in dashboard/page.tsx, but a Garmin sync runs on
          // a server schedule with no page open to diff against, so this
          // deep-links straight into that same sheet via ?editActivity=<id>
          // instead. 24h guard: a first-ever Garmin connection backfills
          // months of history as "new" here — skip anything older so that
          // backfill doesn't pop the sheet for a run from months ago.
          try {
            const RECENT_MS = 24 * 60 * 60 * 1000;
            const recentNew = newActivities.filter(
              a => Date.now() - new Date(a.startTimeLocal).getTime() < RECENT_MS,
            );
            if (recentNew.length > 0) {
              const latest = recentNew.reduce((a, b) => (new Date(a.startTimeLocal) > new Date(b.startTimeLocal) ? a : b));
              const latestRowId = idByGarminActivityId.get(latest.activityId);
              if (latestRowId) {
                await notifyAthlete({
                  athleteId: athlete.id,
                  kind: 'activity_sync_editor',
                  copy: activitySyncedCopy,
                  url: `/dashboard?editActivity=${latestRowId}`,
                  tag: `activity-sync-editor-${latestRowId}`,
                  category: 'workouts',
                });
              }
            }
          } catch { /* push is best-effort */ }

          // Attribute the new runs to the workouts they were run for. Only the
          // Strava sync used to do this, and the club is overwhelmingly Garmin —
          // so for most athletes nothing was ever matched to a plan unless a
          // coach opened the match-review panel by hand.
          try {
            await matchAthleteActivities(supabase, athlete.id);
          } catch (matchError) {
            // activity_plan_matches (migration 054) may not be applied; the sync
            // itself must still succeed.
            console.warn(`Plan matching for ${athlete.id} skipped:`, matchError);
          }

          // New activities can move a PR bucket, the cumulative-distance total,
          // or the run streak — all evaluated in TypeScript (not SQL), so this
          // is "instant enough" right after sync instead of a DB trigger. Never
          // let a badge-check failure break the sync itself.
          try {
            await checkAndAwardBadges(athlete.id);
          } catch { /* badge check is best-effort */ }
          try {
            await checkAndAwardChallenges(athlete.id);
          } catch { /* challenge check is best-effort */ }
        }

        results.push({
          athleteId: athlete.id,
          name: athlete.name,
          synced: newActivities.length,
          ...(upgradedFromStrava ? { upgradedFromStrava } : {}),
          // Reported, not silent: a run dropped here is a row the athlete would
          // otherwise have seen, and "which of my devices won" is the first
          // question anybody asks about it.
          ...(sameDeviceDupes.length ? { sameDeviceDupes: sameDeviceDupes.length } : {}),
          // Reported so a one-off "did the auto-fill actually work" question has an
          // answer without querying the table.
          ...(filledProfile.length ? { profileFilled: filledProfile } : {}),
        });
      } catch (e: any) {
        if (looksLikeAuthFailure(e)) await markProviderAuthFailed(supabase, athlete.id, 'garmin');
        results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: e.message });
      }
    }

    return NextResponse.json({ synced: totalSynced, results });
  } catch (error: any) {
    console.error('Activity sync error:', error);
    return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
  }
}

/**
 * Re-runnable enrichment backfill for rows the POST path stored with missing
 * columns — chiefly the whole pre-fix history, whose `has_polyline: false`
 * meant no GPS was ever fetched and so no `route_preview` was ever built.
 *
 *   ?mode=route    (default) rows with no stored GPS — the map repair
 *   ?mode=missing  rows with no avg_cadence — the original behaviour
 *   ?mode=workout  rows with no garmin_workout_id — plan attribution for history
 *                  (lib/garmin/workout-id-backfill.ts; one Garmin request per
 *                  athlete rather than two per row, so `limit` goes to 1000)
 *   ?mode=stream   rows with no activity_streams row — the per-sample trace, the
 *                  laps, and (for a run whose laps are stamped) the step list those
 *                  stamps index into: the evidence for "did they run the session"
 *                  (lib/garmin/stream-backfill.ts; 1-3 Garmin requests per row,
 *                  `limit` capped at 60, `?refetch=1` to re-fetch existing rows)
 *   ?mode=history  activities from BEFORE the athlete connected, which the POST
 *                  path's single `getActivities(0, 100)` never asked for and
 *                  never will (lib/garmin/history-backfill.ts). The only mode
 *                  here that ADDS rows rather than filling columns on existing
 *                  ones, and the only one whose cursor is a page rather than a
 *                  `before` timestamp — it walks Garmin's list backwards, so
 *                  there is no row in the table yet to take a cursor from.
 *                  ?pages=N per athlete (default 3), ?fromPage=N to resume from
 *                  a previous response's `nextPage`, ?athleteId=… for one
 *                  athlete, ?rematch=1 to re-run plan matching after.
 *   ?limit=N       rows per call, 1-100 (default 25; Garmin calls are serial,
 *                  ~2 requests per row, so keep it inside maxDuration)
 *   ?before=<ISO>  only rows older than this start_time — the batch cursor
 *   ?since=<ISO>   mode=workout only: floor on start_time, to scope a one-off
 *                  run to a single day instead of the whole history
 *   ?athleteId=…   mode=workout only: one athlete instead of the club
 *
 * `mode=route` selects on `gps_points IS NULL` — migration 018's own definition
 * of "not yet fetched" — and deliberately NOT on `has_polyline`. That flag is
 * unreliable in exactly the rows this backfill exists to repair: the pre-fix
 * sync read `hasPolyline` from the activity-LIST row (which populates) while
 * gating the GPS fetch on the detail root (which is null in production), so it
 * stored has_polyline=true with no route behind it. Measured live: 316 rows
 * flagged true, gps_points NULL — invisible to a has_polyline filter, and all
 * of them recent, which is precisely the stretch of feed anyone actually looks
 * at. Cross-checked at the same time: 0 rows have gps_points without a
 * route_preview, so migration 047's trigger fires correctly on UPDATE and the
 * only thing ever missing is the GPS itself.
 *
 * Reachable set, measured: 1064 rows. The other 230 route-less rows are
 * Strava-sourced and are skipped by the id filter below — Garmin cannot supply
 * their routes at any price.
 *
 * `before` is what makes a full-history sweep terminate. Without it the filter
 * alone can't distinguish "GPS not fetched yet" from "this run genuinely has no
 * GPS" (a treadmill session keeps a NULL gps_points forever), so those rows
 * sit at the top of every ascending-recency batch and the caller re-processes
 * the same 20 rows for eternity — observed live: routesAdded decayed 19 → 8 as
 * the clog grew. The response returns `nextBefore`, the oldest start_time this
 * call touched, for the caller to pass back on the next one.
 *
 * Idempotent and non-destructive: nulls are never written over existing
 * values, and gps_points/has_polyline are only touched when a real route came
 * back — a transient Garmin failure must not wipe a route it already has.
 */
export async function PATCH(request: Request) {
  try {
    // Staff-only: this walks the activity table making two Garmin requests per
    // row, so an open handler was a way to burn the club's Garmin quota.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const requestedMode = searchParams.get('mode');
    const mode = requestedMode === 'missing' || requestedMode === 'workout'
      || requestedMode === 'stream' || requestedMode === 'history'
      ? requestedMode
      : 'route';
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 25, 1), 100);
    const before = searchParams.get('before');

    // Also its own pass, and for a stronger reason than the others: the loop
    // below enriches rows that EXIST, and the whole point here is that the rows
    // do not — so there is nothing for a row-shaped select to return. Reads
    // Garmin's list, not the table.
    if (mode === 'history') {
      const result = await backfillGarminHistory(supabase, {
        athleteId: searchParams.get('athleteId'),
        maxPages: Number(searchParams.get('pages')) || undefined,
        fromPage: Number(searchParams.get('fromPage')) || undefined,
        rematch: searchParams.get('rematch') === '1',
      });
      return NextResponse.json({ mode, ...result });
    }

    // Its own pass: this one is keyed on garmin_workout_id itself (the filters
    // below can't reach an already-enriched row) and needs no per-row Garmin
    // call, so it doesn't belong in the loop underneath.
    if (mode === 'workout') {
      const result = await backfillGarminWorkoutIds(supabase, {
        limit: Number(searchParams.get('limit')) || undefined,
        before,
        since: searchParams.get('since'),
        athleteId: searchParams.get('athleteId'),
      });
      if (result.unmigrated) {
        return NextResponse.json(
          { error: 'athlete_activities.garmin_workout_id is missing — apply migration 092 first', mode },
          { status: 409 },
        );
      }
      return NextResponse.json({ mode, ...result });
    }

    // Also its own pass: keyed on "has no row in activity_streams", which the
    // athlete_activities filters below cannot express, and it writes to a different
    // table.
    if (mode === 'stream') {
      const result = await backfillActivityStreams(supabase, {
        limit: Number(searchParams.get('limit')) || undefined,
        before,
        since: searchParams.get('since'),
        athleteId: searchParams.get('athleteId'),
        refetch: searchParams.get('refetch') === '1',
      });
      if (result.unmigrated) {
        return NextResponse.json(
          { error: 'activity_streams is missing — apply migration 094 first', mode },
          { status: 409 },
        );
      }
      return NextResponse.json({ mode, ...result });
    }

    let query = supabase
      .from('athlete_activities')
      .select('id, garmin_activity_id, athlete_id, start_time, has_polyline')
      // `> 0`, not merely NOT NULL: a Strava-sourced row stores the NEGATED
      // Strava id in this column (source='strava', garmin_activity_id =
      // -strava_activity_id), so a null check lets 230 rows through that Garmin
      // has never heard of. Every one of them costs two doomed Garmin requests
      // and comes back all-null, which then looks exactly like "this run has no
      // GPS". Those rows need Strava's own polyline, not this endpoint.
      .gt('garmin_activity_id', 0)
      .order('start_time', { ascending: false })
      .limit(limit);
    query = mode === 'missing' ? query.is('avg_cadence', null) : query.is('gps_points', null);
    if (before) query = query.lt('start_time', before);

    const { data: activities, error: selectError } = await query;
    if (selectError) throw selectError;

    if (!activities || activities.length === 0) {
      return NextResponse.json({ enriched: 0, mode, nextBefore: null, message: 'Nothing left to enrich' });
    }

    // Rows come back newest-first, so the last one is the oldest this call saw.
    const nextBefore = (activities[activities.length - 1] as { start_time: string }).start_time;

    const athleteIds = [...new Set(activities.map(a => a.athlete_id))];
    const { data: athletes } = await supabase
      .from('athletes')
      .select('id, garmin_auth')
      .in('id', athleteIds)
      .not('garmin_auth', 'is', null);

    if (!athletes || athletes.length === 0) {
      return NextResponse.json({ error: 'No athletes with Garmin auth' }, { status: 404 });
    }

    const clientMap = new Map<string, GarminClient>();
    for (const ath of athletes) {
      clientMap.set(ath.id, new GarminClient(ath.garmin_auth as any));
    }

    // One activity-LIST fetch per athlete, indexed by activityId: the list row
    // is the fallback source mapActivityDetail needs when the detail response
    // comes back all-null, and it's a single request for up to 100 rows.
    const listCache = new Map<string, Map<number, any>>();
    const listFor = async (athleteId: string, client: GarminClient) => {
      const cached = listCache.get(athleteId);
      if (cached) return cached;
      let index = new Map<number, any>();
      try {
        const list = await client.getActivities(0, 100);
        index = new Map(list.map(a => [a.activityId, a]));
      } catch { /* fallback source is optional */ }
      listCache.set(athleteId, index);
      return index;
    };

    let enriched = 0;
    let routesAdded = 0;
    const errors: string[] = [];

    for (const act of activities) {
      const client = clientMap.get(act.athlete_id);
      if (!client) continue;

      try {
        let detail: any = null;
        try {
          detail = await client.getActivityFull(act.garmin_activity_id);
        } catch { /* the list row + polyline still carry most of it */ }
        const gpsPoints = await client.getActivityGpsPoints(act.garmin_activity_id);
        const list = (await listFor(act.athlete_id, client)).get(act.garmin_activity_id) || {};
        const mapped = mapActivityDetail(detail, list, gpsPoints);

        // Drop nulls: an absent value here means "Garmin didn't tell us", not
        // "clear the column". Ditto gps_points/has_polyline unless a real
        // route came back — writing [] would clobber an existing polyline and
        // re-fire migration 047's trigger to null out route_preview.
        const { gps_points, has_polyline, ...scalars } = mapped;
        const update: Record<string, any> = Object.fromEntries(
          Object.entries(scalars).filter(([, v]) => v != null),
        );
        if (has_polyline) {
          update.gps_points = gps_points;
          update.has_polyline = true;
          routesAdded++;
        } else if (act.has_polyline) {
          // Garmin has no polyline for this run, yet the flag claims one. Clear
          // it so `hasRoute` in lib/feed/project.ts stops promising a map that
          // can never be drawn. gps_points stays NULL rather than [] — "not
          // fetched" is the honest state, and writing [] would make the row
          // indistinguishable from a real empty route.
          update.has_polyline = false;
        }

        if (Object.keys(update).length > 0) {
          let { error: updateError } = await supabase.from('athlete_activities').update(update).eq('id', act.id);
          // Historical rows pick up their Garmin workout id here — but only the
          // ones this endpoint's own filters select (mode=route: no gps_points,
          // mode=missing: no avg_cadence). A row that is already fully enriched
          // is never revisited, so its workout id stays NULL; `mode=workout`
          // above is the pass keyed on the column itself, and it's the one to
          // use for history. Retry without it rather than reporting every row as
          // an error and repairing no routes.
          if (isMissingColumn(updateError, 'garmin_workout_id')) {
            const { garmin_workout_id: _unmigrated, ...rest } = update;
            ({ error: updateError } = await supabase.from('athlete_activities').update(rest).eq('id', act.id));
          }
          if (updateError) throw updateError;
          enriched++;
        }
      } catch (e: any) {
        errors.push(`${act.garmin_activity_id}: ${e.message}`);
      }
    }

    return NextResponse.json({
      enriched,
      routesAdded,
      total: activities.length,
      mode,
      nextBefore,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    // Staff-only: this is the raw-Garmin-field dump used for debugging, and it
    // returns a real athlete's activity payload verbatim.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const supabase = createServerClient();
    const { data: athletes } = await supabase
      .from('athletes')
      .select('id, name, garmin_auth')
      .eq('coach_id', COACH_ID)
      .not('garmin_auth', 'is', null)
      .limit(1);

    if (!athletes || athletes.length === 0) {
      return NextResponse.json({ error: 'No athletes' }, { status: 404 });
    }

    const client = new GarminClient(athletes[0].garmin_auth as any);
    const raw = await (client as any).gc.getActivities(0, 2) as any[];
    const sample = raw[0];
    const keys = Object.keys(sample || {});
    const relevant = {
      startLatitude: sample?.startLatitude,
      startLongitude: sample?.startLongitude,
      endLatitude: sample?.endLatitude,
      endLongitude: sample?.endLongitude,
      hasPolyline: sample?.hasPolyline,
      lapCount: sample?.lapCount,
      locationName: sample?.locationName,
      vO2MaxValue: sample?.vO2MaxValue,
      avgStrideLength: sample?.avgStrideLength,
      averageRunningCadenceInStepsPerMinute: sample?.averageRunningCadenceInStepsPerMinute,
      movingDuration: sample?.movingDuration,
      steps: sample?.steps,
    };
    return NextResponse.json({ keys, relevant, raw: sample });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');

    // Coaches/admins may request the whole club (roster feed); everyone else is
    // scoped to their own activities.
    //
    // The previous version resolved staff status from `x-user-email`, and — worse
    // — never checked that a non-staff caller's `athleteId` was their OWN. So an
    // unauthenticated GET naming any athlete returned that athlete's entire
    // history: verified live against production, 147 activities / 5.9MB with
    // name, HR, pace and GPS start/end coordinates. No client in the app calls
    // this GET at all.
    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    const isStaff = caller.isSuperUser || caller.isStaff;

    const supabase = createServerClient();

    const baseCols = `
        id, athlete_id, garmin_activity_id, activity_name, activity_type,
        start_time, distance, duration, moving_duration, average_pace, average_hr, max_hr,
        calories, elevation_gain, start_lat, start_lng, end_lat, end_lng,
        avg_cadence, avg_stride_length, vo2max, lap_count, location_name,
        has_polyline, splits, created_at,
        athletes (name)`;

    const runQuery = (cols: string) => {
      let q = supabase
        .from('athlete_activities')
        .select(cols)
        .order('start_time', { ascending: false })
        .limit(200);
      // Scope to the caller unless they're verified staff.
      if (!isStaff && athleteId) q = q.eq('athlete_id', athleteId);
      return q;
    };

    // Prefer selecting gps_points; fall back gracefully if the column hasn't
    // been added yet (migration 018 not yet run) so the feed never 500s.
    let activities: any[] | null = null;
    let error: any = null;
    ({ data: activities, error } = await runQuery(`${baseCols}, gps_points`));

    if (error) {
      ({ data: activities, error } = await runQuery(baseCols));
    }

    if (error) throw error;

    const enriched = (activities || []).map((a: any) => ({
      ...a,
      athlete_name: a.athletes?.name || 'Unknown',
      athletes: undefined,
    }));

    return NextResponse.json({ activities: enriched });
  } catch (error: any) {
    console.error('Fetch activities error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}

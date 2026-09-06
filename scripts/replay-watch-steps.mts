// Replay the runs the WATCH drove through `gradeWatchSteps`, beside the distance-search
// verdict the app gives today. This is how a grading path gets judged against the club's
// real sessions before it reaches anyone's screen: the question each line answers is
// "does the step the watch names agree with the block we guessed at".
//
// BOTH halves come off the device: the laps (`wktStepIndex`) and the step list that index
// points into (`GET /activity/{id}/workouts`). The plan is fetched only to run the search
// engine alongside for comparison — a run with no plan row still gets a watch verdict,
// which is the point.
//
// Stored laps are used when they already carry step indices; otherwise the splits are
// fetched live (laps stored before the write path kept the index have none). The executed
// workout is always fetched — nothing stores it yet. Read-only on the database.
//   npx tsx ./scripts/replay-watch-steps.mts [limit] [sinceISODate]
//   DEBUG_ID=<activityId> npx tsx ./scripts/replay-watch-steps.mts   # one run, step by step
import { createClient } from '@supabase/supabase-js';
import { GarminClient } from '@/lib/garmin/client';
import { narrowLaps, normalizeStoredLaps } from '@/lib/garmin/laps';
import { narrowExecutedWorkout } from '@/lib/garmin/executed-workout';
import { dominantWatchStep, gradeWatchSteps } from '@/lib/academy/watch-steps';
import { dominantBlock, gradePlanBlocks, traceFromLaps } from '@/lib/academy/execution';
import { flattenPlannedSteps } from '@/lib/academy/segments';
import { DEFAULT_TOLERANCES } from '@/lib/academy/adherence';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';
import { PLAN_STATUSES } from '@/lib/plans/plan-status';
import { activityLocalDateStr, planWeekStartOf, resolveGroup } from '@/lib/utils';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';

process.loadEnvFile('.env.local');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const limit = Number(process.argv[2]) || 40;
const since = process.argv[3] || '2026-08-16';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fmt = (s: number | null | undefined) =>
  s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const { data: athletes } = await sb.from('athletes').select('id, name, group_id, garmin_auth');
const { data: groups } = await sb.from('groups').select('id, name');
const groupName = new Map((groups || []).map(g => [g.id, g.name]));
const laneOf = new Map<string, Lane>();
const nameOf = new Map<string, string>();
const authOf = new Map<string, unknown>();
for (const a of athletes || []) {
  const idx = resolveGroup(a.group_id ? groupName.get(a.group_id) : null).index;
  laneOf.set(a.id, (idx >= 0 ? idx + 1 : 2) as Lane);
  nameOf.set(a.id, a.name);
  if (a.garmin_auth) authOf.set(a.id, a.garmin_auth);
}

const { data: plans } = await sb.from('weekly_plans')
  .select('week_start_date, athlete_id, parsed_workouts, created_at')
  .gte('week_start_date', since).in('status', PLAN_STATUSES)
  .order('created_at', { ascending: false });
const sharedByWeek = new Map<string, unknown>();
const indivByKey = new Map<string, unknown>();
for (const p of plans || []) {
  if (p.athlete_id) {
    const k = `${p.athlete_id}|${p.week_start_date}`;
    if (!indivByKey.has(k)) indivByKey.set(k, p.parsed_workouts);
  } else if (!sharedByWeek.has(p.week_start_date)) {
    sharedByWeek.set(p.week_start_date, p.parsed_workouts);
  }
}

// Every run, not just the ones carrying `garmin_workout_id`: that column is set from a
// field the activity list doesn't always report, and it misses runs the athlete really
// did start from a workout. The endpoint is the honest detector — it answers `[]` for a
// plain run, so asking it costs one call and can't be wrong about this.
const { data: runs } = await sb.from('athlete_activities')
  .select('id, athlete_id, garmin_activity_id, garmin_workout_id, start_time, distance, duration, average_pace, activity_type, laps')
  .gte('start_time', `${since}T00:00:00Z`).not('garmin_activity_id', 'is', null)
  .order('start_time', { ascending: false }).limit(limit);

const laneCache = new Map<string, ReturnType<typeof laneWorkouts>>();
const workoutsFor = (parsed: unknown, key: string, lane: Lane) => {
  const k = `${key}|${lane}`;
  let c = laneCache.get(k);
  if (!c) { c = laneWorkouts(parsed, lane); laneCache.set(k, c); }
  return c;
};

const clients = new Map<string, GarminClient>();
const clientFor = (athleteId: string, auth: unknown) => {
  let c = clients.get(athleteId);
  if (!c) { c = new GarminClient(auth as never); clients.set(athleteId, c); }
  return c;
};

const counts: Record<string, number> = {};
const bump = (k: string) => { counts[k] = (counts[k] || 0) + 1; };
const lines: string[] = [];
const repLines: string[] = [];
const silent: string[] = [];
const undetected: string[] = [];
let plainRuns = 0, noAuth = 0, noPlan = 0, lapsFetched = 0, failed = 0;

for (const row of runs || []) {
  if (row.activity_type && !PR_RUN_TYPES.includes(row.activity_type)) continue;
  const date = activityLocalDateStr(row.start_time);
  const who = `${date} ${(nameOf.get(row.athlete_id) || '?').padEnd(18)}`;
  const lane = laneOf.get(row.athlete_id) ?? 2;
  const auth = authOf.get(row.athlete_id);
  if (!auth) { noAuth++; continue; }
  const client = clientFor(row.athlete_id, auth);

  let workout, laps = normalizeStoredLaps(row.laps);
  try {
    workout = narrowExecutedWorkout(await client.getActivityWorkout(Number(row.garmin_activity_id)));
    await sleep(250);
    // Stored laps first — once the write path keeps the index this needs no second call.
    if (workout && !laps.some(l => l.wktStepIndex != null)) {
      laps = narrowLaps(await client.getActivitySplits(Number(row.garmin_activity_id)));
      lapsFetched++;
      await sleep(250);
    }
  } catch (err) {
    failed++;
    console.error(' fetch', row.id, err instanceof Error ? err.message : err);
    continue;
  }
  if (!workout) { plainRuns++; continue; }
  // A watch-driven run the sync never flagged: the reason the endpoint is the detector.
  if (!row.garmin_workout_id) undetected.push(`  ${who} "${workout.name}" (garmin_workout_id null)`);

  const report = gradeWatchSteps(workout, laps, lane, DEFAULT_TOLERANCES.paceSec);
  if (!report) {
    bump(`refused:${laps.some(l => l.wktStepIndex != null) ? 'unmapped' : 'no-step-index'}`);
    continue;
  }

  // The search engine, run alongside on the same laps — the thing being compared against.
  const indiv = indivByKey.get(`${row.athlete_id}|${planWeekStartOf(date)}`);
  const parsed = indiv ?? sharedByWeek.get(planWeekStartOf(date));
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const planned = parsed
    ? workoutsFor(parsed, indiv ? `i:${row.athlete_id}` : `s:${planWeekStartOf(date)}`, lane)
      .find(w => w.dayOfWeek === dow)
    : undefined;
  if (!planned) noPlan++;
  const guessed = planned
    ? dominantBlock(gradePlanBlocks(
      flattenPlannedSteps(planned), traceFromLaps(laps), DEFAULT_TOLERANCES.paceSec))
    : null;

  const step = dominantWatchStep(report);
  bump(`watch:${step ? step.status : 'no-dominant-step'} vs search:` +
    `${planned ? (guessed ? guessed.status : 'none') : 'no-plan'}`);

  if (step) {
    lines.push(`  ${who} ${step.label.padEnd(14)}` +
      ` ${(step.actualDistanceM / 1000).toFixed(1)}km target ${fmt(step.plannedPaceMin)}-${fmt(step.plannedPaceMax)}` +
      ` → ${fmt(step.actualPace)} ${step.status}` +
      `${step.gradeAdjustedPace ? ` (GAP ${fmt(step.gradeAdjustedPace)})` : ''}` +
      ` | search said ${guessed ? `${guessed.label} ${fmt(guessed.actualPace)} ${guessed.status}` : 'nothing'}`);
  } else {
    // No dominant step is a real answer on an interval day, and a bug on a block day.
    // Print enough to tell the two apart without another query.
    silent.push(`  ${who} id=${row.id} "${report.workoutName}" | ` +
      report.steps.map(s => `${s.label}${s.graded ? '' : '(ungraded)'}` +
        ` ${s.ranRepeats}/${s.plannedRepeats}×${s.actualDistanceM}m ${s.status}` +
        `${s.truncated ? ' TRUNC' : ''}`).join(' | '));
  }
  if (report.repeatsPlanned > 0) {
    repLines.push(`  ${who} ${report.repeatsRun}/${report.repeatsPlanned} run` +
      (report.repeatsWithTarget > 0 ? `, ${report.repeatsOnTarget}/${report.repeatsWithTarget} on pace` : ' (no pace target)') +
      (report.complete ? '' : '  ← step(s) never run'));
  }

  if (process.env.DEBUG_ID === row.id || process.env.DEBUG_ID === String(row.garmin_activity_id)) {
    console.log(`\n${who} watch:"${report.workoutName}" plan:"${planned?.name ?? '—'}"` +
      ` lane=${lane} laps=${laps.length} unstamped=${report.unstampedLaps}`);
    for (const s of report.steps) {
      console.log(`  [${s.index}] ${s.label.padEnd(14)} ${s.type.padEnd(9)}` +
        ` planned ${s.plannedDistanceM ?? '—'}m/${s.plannedDurationSec ?? '—'}s ×${s.plannedRepeats}` +
        ` → ran ${s.actualDistanceM}m/${s.actualDurationSec}s ×${s.ranRepeats}` +
        ` @${fmt(s.actualPace)} target ${fmt(s.plannedPaceMin)}-${fmt(s.plannedPaceMax)}` +
        ` ${s.status}${s.truncated ? ' TRUNCATED' : ''}` +
        (s.occurrences.length > 1 ? ` [${s.occurrences.map(o => fmt(o.pace)).join(' ')}]` : '') +
        (s.notes ? `  «${s.notes}»` : ''));
    }
  }
}

console.log(`\n=== the watch's step vs the distance search (since ${since}) ===`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(48)} ${v}`);
console.log(`\nplain runs (no workout): ${plainRuns} | laps fetched live: ${lapsFetched}` +
  ` | no plan row: ${noPlan} | no garmin auth: ${noAuth} | failed: ${failed}`);
console.log(`\n=== the paced step, as the watch labelled it: ${lines.length} ===`);
for (const line of lines.slice(0, 40)) console.log(line);
console.log(`\n=== rep sets the watch counted: ${repLines.length} ===`);
for (const line of repLines.slice(0, 40)) console.log(line);
// Expected on an interval day (no steady stretch to report a pace over); a block day
// landing here means the dominant-step rule refused something it should have answered.
console.log(`\n=== graded the steps but had no headline pace: ${silent.length} ===`);
for (const line of silent.slice(0, 20)) console.log(line);
console.log(`\n=== watch-driven, but the sync never flagged it: ${undetected.length} ===`);
for (const line of undetected.slice(0, 20)) console.log(line);

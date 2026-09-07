// Replay every stored run with a plan through BOTH pace verdicts — the whole-run
// average and the block-aligned one — and count how many change, so a grading change
// is judged against the club's real data before it reaches anyone's screen. Every
// constraint in `gradePlanBlocks` was added because a round of this surfaced a verdict
// that was the engine's fault. Read-only; needs .env.local for the service key.
//   npx tsx ./scripts/replay-plan-verdicts.mts [sinceISODate]
//   DEBUG_DATE=2026-08-25 npx tsx ./scripts/replay-plan-verdicts.mts   # per-run detail
import { createClient } from '@supabase/supabase-js';
import { assessWorkout, buildPlannedWorkout, DEFAULT_TOLERANCES } from '@/lib/academy/adherence';
import { flattenPlannedSteps, findPlannedEfforts } from '@/lib/academy/segments';
import { dominantBlock, gradePlanBlocks, traceFromLaps } from '@/lib/academy/execution';
import { normalizeStoredLaps } from '@/lib/garmin/laps';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';
import { PLAN_STATUSES } from '@/lib/plans/plan-status';
import { activityLocalDateStr, planWeekStartOf, resolveGroup } from '@/lib/utils';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';

process.loadEnvFile('.env.local');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const since = process.argv[2] || '2026-08-16';
const fmt = (s: number | null | undefined) =>
  s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const { data: athletes } = await sb.from('athletes').select('id, name, group_id');
const { data: groups } = await sb.from('groups').select('id, name');
const groupName = new Map((groups || []).map(g => [g.id, g.name]));
const laneOf = new Map<string, Lane>();
const nameOf = new Map<string, string>();
for (const a of athletes || []) {
  const idx = resolveGroup(a.group_id ? groupName.get(a.group_id) : null).index;
  laneOf.set(a.id, (idx >= 0 ? idx + 1 : 2) as Lane);
  nameOf.set(a.id, a.name);
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

const { data: runs } = await sb.from('athlete_activities')
  .select('id, athlete_id, start_time, distance, duration, moving_duration, average_pace, activity_type, laps')
  .gte('start_time', `${since}T00:00:00Z`).not('laps', 'is', null)
  .order('start_time', { ascending: false });

const laneCache = new Map<string, ReturnType<typeof laneWorkouts>>();
const workoutsFor = (parsed: unknown, key: string, lane: Lane) => {
  const k = `${key}|${lane}`;
  let c = laneCache.get(k);
  if (!c) { c = laneWorkouts(parsed, lane); laneCache.set(k, c); }
  return c;
};

const counts: Record<string, number> = {};
const bump = (k: string) => { counts[k] = (counts[k] || 0) + 1; };
const slowVerdicts: string[] = [];
const timedReps: string[] = [];

for (const row of runs || []) {
  if (row.activity_type && !PR_RUN_TYPES.includes(row.activity_type)) continue;
  const date = activityLocalDateStr(row.start_time);
  const week = planWeekStartOf(date);
  const lane = laneOf.get(row.athlete_id) ?? 2;
  const indiv = indivByKey.get(`${row.athlete_id}|${week}`);
  const parsed = indiv ?? sharedByWeek.get(week);
  if (!parsed) continue;
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const planned = workoutsFor(parsed, indiv ? `i:${row.athlete_id}:${week}` : `s:${week}`, lane)
    .find(w => w.dayOfWeek === dow);
  if (!planned) continue;

  const graded = assessWorkout(buildPlannedWorkout(planned, date), {
    id: row.id, date,
    distance: Number(row.distance) || 0,
    duration: Number(row.duration) || 0,
    movingDuration: row.moving_duration != null ? Number(row.moving_duration) : null,
    averagePace: row.average_pace != null ? Number(row.average_pace) : null,
    activityType: row.activity_type ?? undefined,
  }, DEFAULT_TOLERANCES);

  const flat = flattenPlannedSteps(planned);
  const laps = normalizeStoredLaps(row.laps);
  const trace = traceFromLaps(laps);
  const blocks = gradePlanBlocks(flat, trace, DEFAULT_TOLERANCES.paceSec);
  const dominant = dominantBlock(blocks);

  const before = graded.pace.status;
  const after = dominant ? dominant.status : before;
  bump(`${before} -> ${after}`);

  if (process.env.DEBUG_DATE === date) {
    console.log(`\n${date} ${nameOf.get(row.athlete_id)} lane=${lane} "${planned.name}"`);
    console.log('  plan steps:', JSON.stringify(flat.map(s =>
      [s.label, s.distanceM, s.durationSec, s.paceMin, s.paceMax, s.graded])));
    console.log(`  avg=${fmt(graded.pace.actual)} band=${fmt(graded.pace.comparedMin)}-${fmt(graded.pace.comparedMax)} → ${before}`);
    console.log(`  laps=${laps.length} traceD=${trace ? trace.d[trace.d.length - 1] : 'none'} res=${trace?.resolutionM}`);
    console.log(`  blocks(${blocks.reason || 'ok'}):`, blocks.blocks.map(b =>
      `${b.label} ${(b.plannedLengthM / 1000).toFixed(1)}km@${fmt(b.plannedPaceMin)} → ` +
      `${b.window ? `[${b.window.startM}-${b.window.endM}] ${fmt(b.actualPace)}` : 'none'} ${b.status}`).join(' | '));
  }
  if (after === 'slower' && dominant) {
    bump(dominant.truncated ? 'slower:run-cut-short' : 'slower:full-length');
    if (!dominant.truncated) {
      slowVerdicts.push(`  ${date} ${(nameOf.get(row.athlete_id) || '?').padEnd(18)}` +
        ` ${dominant.label} ${(dominant.plannedLengthM / 1000).toFixed(1)}km` +
        ` target ${fmt(dominant.plannedPaceMin)} → ran ${fmt(dominant.actualPace)}` +
        ` (whole run ${fmt(graded.pace.actual)}, ${(Number(row.distance) / 1000).toFixed(1)}km, res ${blocks.resolutionM}m)`);
    }
  }
  if (!dominant) bump(`ungraded:${blocks.reason || (trace ? 'no-window' : 'no-trace')}`);

  // Rep detection, old (distance-matched) vs new (duration-matched for timed reps).
  const efforts = findPlannedEfforts(flat, laps, DEFAULT_TOLERANCES.paceSec);
  const timed = efforts.requirements.filter(r => r.matchBy === 'duration');
  if (timed.length && timed.some(r => r.verifiable && r.attempted > 0)) {
    timedReps.push(`  ${date} ${(nameOf.get(row.athlete_id) || '?').padEnd(18)}` +
      timed.map(r => ` ${r.attempted}/${r.needed}x${r.durationSec}s`).join(''));
  }
}

console.log(`\n=== pace verdict, whole-run average → block-aligned (since ${since}) ===`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)} ${v}`);
}
// Every full-length "slower" is a claim about a real athlete. Read them: each round
// of this replay, some turned out to be the engine's fault, not the runner's.
console.log(`\n=== "slower" over a block they finished: ${slowVerdicts.length} ===`);
for (const line of slowVerdicts.slice(0, 30)) console.log(line);
console.log(`\n=== timed reps found by duration: ${timedReps.length} runs ===`);
for (const line of timedReps.slice(0, 20)) console.log(line);

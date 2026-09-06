// Run the `?mode=stream` backfill from the command line instead of through the HTTP route.
//
// The route works, but reaching it means logging in as staff and pasting a cursor loop
// into a browser console, and it lives under a serverless function ceiling that a
// multi-hundred-row sweep does not fit inside. This calls the same
// `backfillActivityStreams` directly with the service-role client: no session, no
// timeout, and the cursor loop lives here where it can be watched.
//
// What it fetches, per run that a Garmin watch recorded and we have no trace for:
//   - the per-sample trace (~1 Hz pace/HR/cadence/altitude) → activity_streams.series
//   - the lap table, when the watch marked laps and we don't hold them already
//   - the structured workout the run came off, when a lap carries wktStepIndex
//     → athlete_activities.executed_workout
//
// The last one is the point: it is the only thing that turns "we think this stretch was
// the 20 km block" into "the watch says lap 3 WAS step 1". Everything else is supporting
// evidence.
//
// Requires migrations 094 and 095. Additive only — it writes rows that do not exist yet
// and never overwrites a trace it already holds (pass `refetch` to force that).
//
//   npx tsx ./scripts/run-stream-backfill.mts                 # probe: 1 batch of 5
//   npx tsx ./scripts/run-stream-backfill.mts 30 40           # 30 batches of 40
//   npx tsx ./scripts/run-stream-backfill.mts 30 40 2026-07-01  # only runs since then
import { createClient } from '@supabase/supabase-js';
import { backfillActivityStreams } from '@/lib/garmin/stream-backfill';

process.loadEnvFile('.env.local');
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const batches = Number(process.argv[2]) || 1;
const perBatch = Number(process.argv[3]) || 5;
const since = process.argv[4] || null;

const pad = (n: number, w = 4) => String(n).padStart(w);
const total = { scanned: 0, streams: 0, laps: 0, workouts: 0, skipped: 0, errors: 0 };
let before: string | null = null;

console.log(`backfill: up to ${batches} batches × ${perBatch} rows${since ? ` since ${since}` : ''}\n`);
console.log('  #   scanned  traces   laps  workouts  skipped  errors   oldest seen');

for (let i = 0; i < batches; i++) {
  const r = await backfillActivityStreams(sb, { limit: perBatch, before, since });
  if (r.unmigrated) {
    console.error('\nactivity_streams is missing — apply migration 094 first.');
    process.exit(1);
  }
  total.scanned += r.scanned;
  total.streams += r.streamsAdded;
  total.laps += r.lapsAdded;
  total.workouts += r.workoutsAdded;
  total.skipped += r.skipped;
  total.errors += r.errors.length;

  console.log(
    `${pad(i + 1, 3)}  ${pad(r.scanned, 7)}  ${pad(r.streamsAdded, 6)} ${pad(r.lapsAdded, 6)}`
    + `  ${pad(r.workoutsAdded, 8)} ${pad(r.skipped, 8)} ${pad(r.errors.length, 7)}   `
    + `${r.nextBefore?.slice(0, 10) ?? '—'}`,
  );
  // Print them rather than swallowing: a run whose Garmin session has expired fails
  // every row for that athlete, and that is worth seeing on the first batch, not the last.
  for (const e of r.errors.slice(0, 3)) console.log(`      ! ${e.activityId}: ${e.error}`);

  // No cursor back means the query reached the end of the table.
  if (!r.nextBefore || r.scanned === 0) { console.log('\nreached the end of the table.'); break; }
  before = r.nextBefore;
}

console.log(
  `\ndone — scanned ${total.scanned}, ${total.streams} traces, ${total.laps} lap sets, `
  + `${total.workouts} structured workouts, ${total.skipped} skipped, ${total.errors} errors`,
);
// The headline number: how many of the runs we touched were driven by a workout, and so
// can now be graded step by step instead of by searching the distance axis.
if (total.scanned > 0) {
  const pct = Math.round((total.workouts / total.scanned) * 100);
  console.log(`${total.workouts} of ${total.scanned} runs were watch-driven (${pct}%).`);
}

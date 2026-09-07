// One-off: fetch the laps Garmin already has for recent runs that never got them,
// because laps were only ever fetched when a human opened the run. Needs no
// migration — athlete_activities.laps has existed all along.
//   npx tsx ./scripts/backfill-activity-laps.mts <limit> [sinceISODate]
import { createClient } from '@supabase/supabase-js';
import { GarminClient } from '@/lib/garmin/client';
import { lapsWorthStoring, narrowLaps } from '@/lib/garmin/laps';

process.loadEnvFile('.env.local');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const limit = Number(process.argv[2]) || 40;
const since = process.argv[3] || '2026-08-16';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const { count: missing } = await sb.from('athlete_activities')
  .select('*', { count: 'exact', head: true })
  .gt('garmin_activity_id', 0).gte('start_time', `${since}T00:00:00Z`).is('laps', null);
console.log(`runs since ${since} with garmin id and no laps: ${missing}`);

const { data: rows, error } = await sb.from('athlete_activities')
  .select('id, athlete_id, garmin_activity_id, start_time, distance, lap_count')
  .gt('garmin_activity_id', 0).gte('start_time', `${since}T00:00:00Z`).is('laps', null)
  .order('start_time', { ascending: false }).limit(limit);
if (error) throw error;

const { data: athletes } = await sb.from('athletes')
  .select('id, name, garmin_auth')
  .in('id', [...new Set((rows || []).map(r => r.athlete_id))])
  .not('garmin_auth', 'is', null);
const authById = new Map((athletes || []).map(a => [a.id, a.garmin_auth]));
const nameById = new Map((athletes || []).map(a => [a.id, a.name]));
const clients = new Map<string, GarminClient>();

let stored = 0, noMarkers = 0, skipped = 0, failed = 0, strideEvidence = 0;
for (const row of rows || []) {
  const auth = authById.get(row.athlete_id);
  if (!auth) { skipped++; continue; }
  try {
    let client = clients.get(row.athlete_id);
    if (!client) { client = new GarminClient(auth as never); clients.set(row.athlete_id, client); }
    const dtos = await client.getActivitySplits(Number(row.garmin_activity_id));
    if (!lapsWorthStoring(dtos)) { noMarkers++; await sleep(250); continue; }
    const laps = narrowLaps(dtos);
    const { error: upErr } = await sb.from('athlete_activities')
      .update({ laps, lap_count: laps.length }).eq('id', row.id);
    if (upErr) { failed++; console.error(' write', row.id, upErr.message); }
    else {
      stored++;
      const shorts = laps.filter(l => l.duration >= 8 && l.duration <= 40).length;
      if (shorts >= 3) strideEvidence++;
      const med = [...laps].map(l => l.distance).sort((a, b) => a - b)[Math.floor(laps.length / 2)];
      console.log(`  ${row.start_time.slice(0, 10)} ${(nameById.get(row.athlete_id) || '?').padEnd(18)}` +
        ` ${(row.distance / 1000).toFixed(1)}km laps=${String(laps.length).padStart(3)}` +
        ` medianLap=${Math.round(med)}m shortLaps=${shorts}`);
    }
  } catch (err) {
    failed++;
    console.error(' fetch', row.id, err instanceof Error ? err.message : err);
  }
  await sleep(250);
}

console.log(`\nstored ${stored} | no markers ${noMarkers} | skipped ${skipped} | failed ${failed}`);
console.log(`runs whose laps now show 3+ short efforts (rep evidence): ${strideEvidence}`);

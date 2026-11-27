// Read-only data-integrity report (task 66). SELECTs only — there is no write path
// in this file or in src/lib/integrity. Needs .env.local (service key).
//   npx tsx ./scripts/integrity-check.mts            # summary + first 20 per check
//   npx tsx ./scripts/integrity-check.mts --json     # every finding, as JSON
// See docs/data-integrity.md for what each check means and what to do about it.
import { createClient } from '@supabase/supabase-js';
import {
  duplicateTwins, impossibleActivities, impossiblePlanDates, orphanRows, summarize,
  type ActivityRow, type Finding, type PlanRow,
} from '@/lib/integrity/checks';

process.loadEnvFile('.env.local');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const asJson = process.argv.includes('--json');

/** Every row of a table, paged past Supabase's 1000-row cap. Read-only. */
async function all<T>(table: string, columns: string): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) { console.error(`skip ${table}: ${error.message}`); return null; }
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

const athletes = await all<{ id: string }>('athletes', 'id');
if (!athletes) process.exit(1);
const athleteIds = new Set(athletes.map((a) => a.id));
const findings: Finding[] = [];

const activities = await all<ActivityRow>('athlete_activities', 'id, athlete_id, source, start_time, distance, duration');
if (activities) {
  findings.push(...orphanRows('athlete_activities', activities, athleteIds));
  findings.push(...duplicateTwins(activities));
  findings.push(...impossibleActivities(activities));
}
const plans = await all<PlanRow>('weekly_plans', 'id, week_start_date, athlete_id, parsed_workouts');
if (plans) {
  findings.push(...orphanRows('weekly_plans', plans, athleteIds, { nullable: true }));
  findings.push(...impossiblePlanDates(plans));
}
for (const [table, nullable] of [['feed_items', true], ['shoes', false], ['feed_comments', false], ['feed_likes', false]] as const) {
  const rows = await all<{ id: string; athlete_id: string | null }>(table, 'id, athlete_id');
  if (rows) findings.push(...orphanRows(table, rows, athleteIds, { nullable }));
}

if (asJson) {
  console.log(JSON.stringify({ summary: summarize(findings), findings }, null, 2));
} else {
  console.log('Integrity summary:', summarize(findings));
  const byCheck = new Map<string, Finding[]>();
  for (const f of findings) byCheck.set(`${f.check}:${f.table}`, [...(byCheck.get(`${f.check}:${f.table}`) || []), f]);
  for (const [k, list] of byCheck) {
    console.log(`\n## ${k} (${list.length})`);
    for (const f of list.slice(0, 20)) console.log(`  ${f.id}  ${f.detail}`);
  }
  if (!findings.length) console.log('No findings.');
}

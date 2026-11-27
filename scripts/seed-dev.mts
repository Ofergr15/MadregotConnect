// Seed a FAKE club into a dev / sandbox Supabase project. NEVER production.
//
//   SEED_SUPABASE_URL=https://<dev-ref>.supabase.co SEED_SUPABASE_SERVICE_KEY=... \
//     npx tsx ./scripts/seed-dev.mts                # dry run: prints what it would write
//   ... npx tsx ./scripts/seed-dev.mts --apply      # upsert (idempotent: fixed ids)
//   ... npx tsx ./scripts/seed-dev.mts --apply --anchor 2026-11-28 --weeks 8 --runners 25
//
// Deliberately does NOT read .env.local or NEXT_PUBLIC_SUPABASE_URL: those point at production
// on a normal checkout. The target must be named explicitly, and lib/dev-seed/club.ts
// assertSeedTarget refuses anything but the dev project / localhost (allow-list).
// Feed items are created by the database's own activity trigger (migration 047).
import { createClient } from '@supabase/supabase-js';
import { assertSeedTarget, buildSeedClub } from '@/lib/dev-seed/club';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes('--apply');
const anchor = flag('--anchor') ?? new Date().toISOString().slice(0, 10);

const url = process.env.SEED_SUPABASE_URL;
const target = assertSeedTarget(url, process.env);
const club = buildSeedClub({ anchor, weeks: Number(flag('--weeks') ?? 8), runners: Number(flag('--runners') ?? 25) });

console.log(`seed-dev → ${target}${apply ? '' : ' (dry run — pass --apply to write)'}`);
for (const [table, rows] of Object.entries(club)) console.log(`  ${table}: ${rows.length}`);
if (!apply) process.exit(0);

const key = process.env.SEED_SUPABASE_SERVICE_KEY;
if (!key) throw new Error('seed-dev: SEED_SUPABASE_SERVICE_KEY is required with --apply');
const sb = createClient(url!, key, { auth: { persistSession: false } });

// Parents first. 500 rows a request keeps each upsert small.
for (const table of ['coaches', 'groups', 'athletes', 'athlete_activities'] as const) {
  const rows = club[table];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'id' });
    if (error) throw new Error(`seed-dev: ${table} upsert failed: ${error.message}`);
  }
  console.log(`  ✓ ${table}`);
}

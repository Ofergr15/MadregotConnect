// Seed a FAKE club into a dev / sandbox Supabase project. NEVER production.
//
//   SEED_SUPABASE_URL=https://<dev-ref>.supabase.co SEED_SUPABASE_SERVICE_KEY=... \
//     npx tsx ./scripts/seed-dev.mts                # dry run: prints what it would write
//   ... npx tsx ./scripts/seed-dev.mts --apply      # upsert (idempotent: fixed ids)
//   ... npx tsx ./scripts/seed-dev.mts --apply --anchor 2026-11-28 --weeks 8 --runners 25
//   ... --apply --chat   # also post the seed chat lines, ONLY with SEED_STREAM_API_KEY/SECRET of a
//                        # dev Stream app (never the app's STREAM_* production keys)
//
// Beyond the runs (club.ts) it seeds races, weekly km snapshots, the academy (roles, six
// trainees, a workout library) and, with --chat, group chat lines (lib/dev-seed/extras.ts).
//
// Deliberately does NOT read .env.local or NEXT_PUBLIC_SUPABASE_URL: those point at production
// on a normal checkout. The target must be named explicitly, and lib/dev-seed/club.ts
// assertSeedTarget refuses anything but the dev project / localhost (allow-list).
// Feed items are created by the database's own activity trigger (migration 047).
import { createClient } from '@supabase/supabase-js';
import { assertSeedTarget, buildSeedClub } from '@/lib/dev-seed/club';
import { buildSeedExtras, SEED_CONFLICT, SEED_EXTRA_TABLES } from '@/lib/dev-seed/extras';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes('--apply');
const anchor = flag('--anchor') ?? new Date().toISOString().slice(0, 10);

const url = process.env.SEED_SUPABASE_URL;
const target = assertSeedTarget(url, process.env);
const club = buildSeedClub({ anchor, weeks: Number(flag('--weeks') ?? 8), runners: Number(flag('--runners') ?? 25) });
const extras = buildSeedExtras(club, { anchor });
// Roles and academy fields ride on the athlete rows themselves.
club.athletes = extras.athletes;
const chat = args.includes('--chat');

console.log(`seed-dev → ${target}${apply ? '' : ' (dry run — pass --apply to write)'}`);
for (const [table, rows] of Object.entries(club)) console.log(`  ${table}: ${rows.length}`);
for (const table of SEED_EXTRA_TABLES) console.log(`  ${table}: ${extras[table].length}`);
console.log(`  chat: ${extras.chat.reduce((n, c) => n + c.messages.length, 0)} messages in ${extras.chat.length} channels${chat ? '' : ' (pass --chat to post)'}`);
if (!apply) process.exit(0);

const key = process.env.SEED_SUPABASE_SERVICE_KEY;
if (!key) throw new Error('seed-dev: SEED_SUPABASE_SERVICE_KEY is required with --apply');
const sb = createClient(url!, key, { auth: { persistSession: false } });

// Parents first. 500 rows a request keeps each upsert small.
for (const table of ['coaches', 'groups', 'athletes', 'athlete_activities'] as const) {
  const rows = club[table];
  for (let i = 0; i < rows.length; i += 500) {
    // The coach row reuses COACH_ID, which the dev project already has: insert-only, so a
    // seed run never rewrites the existing dev coach's email/name (dev login keeps working).
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: table === 'coaches' });
    if (error) throw new Error(`seed-dev: ${table} upsert failed: ${error.message}`);
  }
  console.log(`  ✓ ${table}`);
}

for (const table of SEED_EXTRA_TABLES) {
  const rows = extras[table];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: SEED_CONFLICT[table] ?? 'id' });
    if (error) throw new Error(`seed-dev: ${table} upsert failed: ${error.message}`);
  }
  console.log(`  ✓ ${table}`);
}

if (chat) {
  // Dedicated variable names on purpose: the app's own STREAM_* keys point at the production app.
  const streamKey = process.env.SEED_STREAM_API_KEY;
  const streamSecret = process.env.SEED_STREAM_SECRET;
  if (!streamKey || !streamSecret) throw new Error('seed-dev: --chat needs SEED_STREAM_API_KEY and SEED_STREAM_SECRET of a DEV Stream app');
  const { StreamChat } = await import('stream-chat');
  const stream = new StreamChat(streamKey, streamSecret);
  const users = [...new Set(extras.chat.flatMap((c) => c.messages.map((m) => m.userId)))];
  const names = new Map(club.athletes.map((a) => [String(a.id), String(a.name)]));
  await stream.upsertUsers(users.map((id) => ({ id, name: names.get(id) ?? id })));
  for (const c of extras.chat) {
    const members = [...new Set(c.messages.map((m) => m.userId))];
    const channel = stream.channel('messaging', c.channelId, { members, created_by_id: members[0] } as Record<string, unknown>);
    try { await channel.create(); } catch { /* exists */ }
    // Fixed message ids: a second run updates instead of posting duplicates.
    for (const m of c.messages) await stream.updateMessage({ id: m.id, text: m.text }, m.userId).catch(() => channel.sendMessage({ id: m.id, text: m.text, user_id: m.userId }));
  }
  console.log('  ✓ chat');
}

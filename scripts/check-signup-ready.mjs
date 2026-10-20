#!/usr/bin/env node
// npm run check:signup-ready — the tests screen's readiness checks plus every flow's live
// status, from a laptop. READ ONLY: the service key from .env.local, GETs only (any write
// throws). Prints PASS / WARN / FAIL lines and a short Hebrew summary.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
  .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')])) : process.env;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const from = db.from.bind(db);
db.from = (t) => { const q = from(t); for (const k of ['insert', 'update', 'upsert', 'delete']) q[k] = () => { throw new Error(`read-only: ${k} ${t}`); }; return q; };

// jiti (already a dependency of the toolchain) loads the screen's own TypeScript, so the
// script and /dashboard/tests can never disagree.
const jiti = createRequire(import.meta.url)('jiti')(import.meta.url, { alias: { '@': resolve('src') }, interopDefault: true });
const { readiness, summarise } = jiti('../src/lib/testing/readiness.ts');
const { testStatus } = jiti('../src/lib/testing/status.ts');
const { FLOWS } = jiti('../src/lib/testing/flows.ts');
const flag = (file, name) => new RegExp(`export const ${name} = (true|false)`).exec(readFileSync(file, 'utf8'))?.[1] === 'true';

const checks = await readiness(db, { superUserEmail: 'grosfeldofer@gmail.com', flags: { setupGate: flag('src/lib/setup/flag.ts', 'SETUP_GATE_FOR_ALL'), joinUnified: flag('src/lib/join/flag.ts', 'JOIN_UNIFIED_FOR_ALL') } });
for (const c of checks) console.log(`${c.level.padEnd(4)}  ${c.label} — ${c.detail}`);
const s = summarise(checks);
console.log(`\nסיכום: ${s.pass} תקין · ${s.warn} לתשומת לב · ${s.fail} חוסם`);
for (const f of await testStatus(db)) {
  const def = FLOWS.find((x) => x.id === f.id);
  console.log(`\n${def.title}  (${f.email})`);
  for (const st of f.steps) console.log(`  ${{ done: '✓', next: '→', waiting: '·', stuck: '!' }[st.state]} ${def.steps.find((x) => x.key === st.key)?.title}${st.note ? ` — ${st.note}` : ''}`);
}
process.exit(s.fail ? 1 : 0);

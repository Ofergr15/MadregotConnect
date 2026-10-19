#!/usr/bin/env node
// The next app version, from ONE source: the highest version that ever existed —
// on origin/main, in the `releases` table (every production deploy records itself),
// or in main's commit subjects — plus one. Writes package.json and src/lib/version.ts.
//
// Why: parallel sessions each bumped from their own base, so numbers ran backwards and
// repeated (2026-10-19: 2.41.232–2.41.239 shipped twice, a day apart), which breaks
// everything keyed on the version — What's New, the releases table, the "stuck on an
// old version" detector. Run it right before committing a release:
//   npm run version:bump        (prints the version it wrote)
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const parse = (v) => (/^(\d+)\.(\d+)\.(\d+)$/.exec(v || '') || []).slice(1).map(Number);
const cmp = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1); return 0; };
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

const seen = [];
sh('git fetch -q origin main');
const mainPkg = sh('git show origin/main:package.json');
if (mainPkg) seen.push(JSON.parse(mainPkg).version);
seen.push(JSON.parse(readFileSync('package.json', 'utf8')).version);
for (const m of sh('git log origin/main -400 --format=%s').matchAll(/\b(\d+\.\d+\.\d+)\b/g)) seen.push(m[1]);

// The releases table, read with the service key from .env.local (read-only REST call).
if (existsSync('.env.local')) {
  const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/releases?select=app_version&order=id.desc&limit=500`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (res.ok) for (const r of await res.json()) seen.push(r.app_version);
    } catch { /* offline: git alone */ }
  }
}

const top = seen.filter((v) => parse(v).length === 3).sort(cmp).at(-1);
if (!top) { console.error('bump-version: no version found'); process.exit(1); }
const [a, b, c] = parse(top);
const next = `${a}.${b}.${c + 1}`;

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.version = next;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
const vt = readFileSync('src/lib/version.ts', 'utf8');
const vt2 = vt.replace(/^export const APP_VERSION = '[0-9.]+';/m, `export const APP_VERSION = '${next}';`);
if (vt2 === vt) { console.error('bump-version: APP_VERSION line not found in src/lib/version.ts'); process.exit(1); }
writeFileSync('src/lib/version.ts', vt2);
console.log(next);

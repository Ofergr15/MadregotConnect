#!/usr/bin/env node
/**
 * Import benchmark (time-trial) results from a CSV into the benchmark_results table.
 *
 * CSV columns: test_name, athlete_name, time, notes
 * Time formats accepted: "5:46.96", "5:49.0", "5:54", "6:03", "1:02:30", bare seconds.
 *
 * Names are auto-linked to a registered athlete (athlete_id) when they match
 * exactly (case-insensitive). Results for unregistered people are stored by name.
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Run AFTER migration 021_benchmark_results.sql is applied.
 *
 * Usage:
 *   node scripts/import-benchmarks.mjs [path-to-csv]        # default: scripts/data/benchmark-2000m.csv
 *   node scripts/import-benchmarks.mjs --replace            # delete existing rows for each test first
 */
import fs from 'node:fs';
import path from 'node:path';

const COACH_ID = '30f056a7-c651-490e-8356-615ea9eff097';

// --- time parsing (mirrors src/lib/academy/benchmark.ts) ---
function parseTime(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  const parts = s.split(':');
  const nums = parts.map((p, i) => (i === parts.length - 1 ? parseFloat(p) : parseInt(p, 10)));
  if (nums.some((n) => Number.isNaN(n))) return null;
  let seconds;
  if (parts.length === 1) seconds = nums[0];
  else if (parts.length === 2) seconds = nums[0] * 60 + nums[1];
  else if (parts.length === 3) seconds = nums[0] * 3600 + nums[1] * 60 + nums[2];
  else return null;
  return seconds < 0 ? null : seconds;
}

// --- minimal .env.local loader ---
function loadEnv() {
  const env = {};
  const file = path.join(process.cwd(), '.env.local');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const idx = t.indexOf('=');
    env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

// --- tiny CSV parser (handles quoted fields with commas) ---
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

async function sb(env, method, pathQuery, body) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pathQuery}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${pathQuery} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const replace = args.includes('--replace');
  const csvPath = args.find(a => !a.startsWith('--')) || 'scripts/data/benchmark-2000m.csv';
  const env = loadEnv();

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iTest = col('test_name'), iName = col('athlete_name'), iTime = col('time'), iNotes = col('notes');

  // Load registered athletes for name→id linking.
  const athletes = await sb(env, 'GET', `athletes?select=id,name&coach_id=eq.${COACH_ID}`);
  const byName = new Map(athletes.map(a => [String(a.name || '').trim().toLowerCase(), a.id]));

  const testsSeen = new Set();
  const payload = [];
  let linked = 0;
  for (const r of rows.slice(1)) {
    const test = (r[iTest] || '2000m').trim() || '2000m';
    const name = (r[iName] || '').trim();
    const secs = parseTime(r[iTime] || '');
    const notes = iNotes >= 0 ? (r[iNotes] || '').trim() : '';
    if (!name || secs == null) { console.warn(`skip: "${name}" / "${r[iTime]}"`); continue; }
    testsSeen.add(test);
    const athleteId = byName.get(name.toLowerCase()) || null;
    if (athleteId) linked++;
    payload.push({ coach_id: COACH_ID, test_name: test, athlete_name: name, athlete_id: athleteId, time_seconds: secs, notes: notes || null });
  }

  if (replace) {
    for (const t of testsSeen) {
      await sb(env, 'DELETE', `benchmark_results?coach_id=eq.${COACH_ID}&test_name=eq.${encodeURIComponent(t)}`);
      console.log(`cleared existing "${t}" results`);
    }
  }

  const inserted = await sb(env, 'POST', 'benchmark_results', payload);
  console.log(`✅ imported ${inserted.length} results (${linked} auto-linked to registered athletes) across tests: ${[...testsSeen].join(', ')}`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });

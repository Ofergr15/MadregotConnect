import { createServerClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/encryption';
import { readMaintenance } from '@/lib/maintenance';
import {
  OLD_HOST, OLD_STORAGE_KEY, connectedHost, functionRegion, onNewProject,
  readMoveSnapshot, readMoveStatus, type MoveSnapshot,
} from '@/lib/move/state';

// ═════════════════════════════════════════════════════════════════════════════
// The move's check suite, run server-side from /dashboard/move.
//
// Every check answers one question a person would otherwise have to go and
// look at by hand, against WHICHEVER database the app is on: before the move it
// is a baseline on Tokyo, after it the proof on Frankfurt. Nothing here writes,
// except one probe row in app_settings that is deleted again (the "can we write"
// question has no read-only answer).
//
// The exact comparisons (tables, files, users, tokens) are against
// `move_snapshot`, which the cutover takes on FROZEN Tokyo, so after the move
// "equal" means equal, not "close".
// ═════════════════════════════════════════════════════════════════════════════

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface CheckResult { id: string; group: 'env' | 'data' | 'files' | 'auth' | 'links' | 'services'; status: CheckStatus; title: string; detail: string; ms: number }

type Db = ReturnType<typeof createServerClient>;
const URL_ = () => process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, '');
const KEY_ = () => process.env.SUPABASE_SERVICE_ROLE_KEY!;
const H = () => ({ apikey: KEY_(), Authorization: `Bearer ${KEY_()}`, 'Content-Type': 'application/json' });

async function timed(id: string, group: CheckResult['group'], fn: () => Promise<Omit<CheckResult, 'id' | 'group' | 'ms'>>): Promise<CheckResult> {
  const t = Date.now();
  try {
    return { id, group, ...(await fn()), ms: Date.now() - t };
  } catch (e) {
    return { id, group, status: 'fail', title: id, detail: (e as Error).message || String(e), ms: Date.now() - t };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// ── Counting: shared by the baseline snapshot and the checks ────────────────
export async function countTables(): Promise<Record<string, number>> {
  const spec = await (await fetch(`${URL_()}/rest/v1/`, { headers: H(), cache: 'no-store' })).json() as { definitions?: Record<string, unknown> };
  const names = Object.keys(spec.definitions || {}).sort();
  const counts = await pool(names, 12, async (t) => {
    const r = await fetch(`${URL_()}/rest/v1/${t}?select=*&limit=1`, { headers: { ...H(), Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' });
    return Number((r.headers.get('content-range') || '*/-1').split('/')[1]);
  });
  return Object.fromEntries(names.map((n, k) => [n, counts[k]]));
}

export async function countBuckets(): Promise<Record<string, { files: number; bytes: number }>> {
  const buckets = await (await fetch(`${URL_()}/storage/v1/bucket`, { headers: H(), cache: 'no-store' })).json() as Array<{ name: string }>;
  async function walk(b: string, prefix = ''): Promise<{ files: number; bytes: number }> {
    let files = 0, bytes = 0, off = 0;
    for (;;) {
      const items = await (await fetch(`${URL_()}/storage/v1/object/list/${b}`, { method: 'POST', headers: H(), body: JSON.stringify({ prefix, limit: 1000, offset: off }), cache: 'no-store' })).json() as Array<{ id: string | null; name: string; metadata?: { size?: number } }>;
      for (const it of items) {
        if (it.id == null) { const s = await walk(b, `${prefix}${it.name}/`); files += s.files; bytes += s.bytes; }
        else { files++; bytes += it.metadata?.size || 0; }
      }
      if (items.length < 1000) break; off += 1000;
    }
    return { files, bytes };
  }
  const out: Record<string, { files: number; bytes: number }> = {};
  for (const b of buckets) out[b.name] = await walk(b.name);
  return out;
}

async function countAuthUsers(db: Db): Promise<number> {
  let n = 0;
  for (let page = 1; page < 100; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    n += data.users.length;
    if (data.users.length < 1000) break;
  }
  return n;
}

async function providerRows(db: Db) {
  const { data, error } = await db.from('athletes').select('id, strava_auth, garmin_auth').or('strava_auth.not.is.null,garmin_auth.not.is.null');
  if (error) throw new Error(error.message);
  return (data || []) as Array<{ id: string; strava_auth: string | null; garmin_auth: string | null }>;
}

export async function takeSnapshot(source: string): Promise<MoveSnapshot> {
  const db = createServerClient();
  const [tables, buckets, authUsers, prov, push] = await Promise.all([
    countTables(), countBuckets(), countAuthUsers(db), providerRows(db),
    db.from('push_subscriptions').select('id', { count: 'exact', head: true }),
  ]);
  return {
    at: new Date().toISOString(), source, tables, buckets, authUsers,
    strava: prov.filter((r) => r.strava_auth).length, garmin: prov.filter((r) => r.garmin_auth).length,
    pushSubs: push.count ?? 0,
  };
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** Written by the move, the crons or this screen while it runs, so their counts legitimately move. */
const VOLATILE_TABLES = new Set(['app_settings', 'client_events', 'cron_tick_locks', 'cron_tick_timings']);

// ── The suite ──────────────────────────────────────────────────────────────────
export async function runMoveChecks(caller: { athleteId: string | null; tokenIssHost: string | null }): Promise<CheckResult[]> {
  const db = createServerClient();
  const snap = await readMoveSnapshot();
  const status = await readMoveStatus();
  const isNew = onNewProject();
  const vsSnap = isNew && snap ? `vs Tokyo snapshot ${snap.at.slice(11, 16)}Z` : snap ? 'baseline' : 'no snapshot yet';

  const checks: Array<Promise<CheckResult>> = [
    // ── where are we ─────────────────────────────────────────────────────────
    timed('db-target', 'env', async () => ({
      status: isNew ? 'pass' : 'warn',
      title: isNew ? 'Connected to the NEW database' : 'Connected to the OLD database (Tokyo)',
      detail: connectedHost(),
    })),
    timed('fn-region', 'env', async () => {
      const r = functionRegion();
      return { status: !isNew ? 'pass' : r === 'fra1' ? 'pass' : 'fail', title: `Functions run in ${r}`, detail: isNew ? 'must be fra1 next to the Frankfurt database' : 'before the move: iad1 is expected' };
    }),
    timed('db-latency', 'env', async () => {
      const ts: number[] = [];
      for (let i = 0; i < 5; i++) { const t = Date.now(); await db.from('app_settings').select('key').limit(1); ts.push(Date.now() - t); }
      const med = ts.sort((a, b) => a - b)[2];
      return { status: !isNew ? 'pass' : med <= 40 ? 'pass' : med <= 100 ? 'warn' : 'fail', title: `Database round trip ${med} ms`, detail: `5 sequential reads: ${ts.join(', ')} ms${isNew ? ' (expected < 40 in Frankfurt)' : ''}` };
    }),
    timed('env-keys', 'env', async () => {
      const need = ['ENCRYPTION_KEY', 'VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'STREAM_API_KEY', 'STREAM_API_SECRET', 'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'CRON_SECRET', 'RESEND_API_KEY'];
      const missing = need.filter((k) => !process.env[k]);
      return { status: missing.length ? 'fail' : 'pass', title: missing.length ? `${missing.length} settings missing` : 'All service settings present', detail: missing.join(', ') || need.length + ' checked' };
    }),
    timed('session-key', 'auth', async () => {
      const pinned = process.env.NEXT_PUBLIC_SUPABASE_AUTH_STORAGE_KEY?.trim();
      if (!isNew) return { status: 'pass', title: 'Session key: default (Tokyo)', detail: 'the pin is set at the switch' };
      return { status: pinned === OLD_STORAGE_KEY ? 'pass' : 'fail', title: pinned === OLD_STORAGE_KEY ? 'Phones keep their stored session' : 'Session key NOT pinned', detail: pinned === OLD_STORAGE_KEY ? `pinned to ${OLD_STORAGE_KEY}` : 'NEXT_PUBLIC_SUPABASE_AUTH_STORAGE_KEY must be the old key, or every phone signs out' };
    }),
    timed('your-session', 'auth', async () => {
      const iss = caller.tokenIssHost;
      const ok = iss === connectedHost();
      return { status: ok ? 'pass' : 'fail', title: ok ? 'Your session works on this database' : 'Your session was issued elsewhere', detail: `token issuer ${iss || 'unknown'}` };
    }),

    // ── data ─────────────────────────────────────────────────────────────────
    timed('tables', 'data', async () => {
      const now = await countTables();
      const names = Object.keys(now);
      const total = Object.values(now).reduce((a, b) => a + Math.max(b, 0), 0);
      const unreadable = names.filter((n) => now[n] < 0);
      if (!snap) return { status: unreadable.length ? 'fail' : 'warn', title: `${names.length} tables, ${fmt(total)} rows`, detail: 'no snapshot to compare with yet' };
      const all = new Set([...names, ...Object.keys(snap.tables)]);
      // Tables the move itself, the crons or this very screen write to: reported, never a failure.
      const moving = (n: string) => VOLATILE_TABLES.has(n);
      const diffs = [...all].filter((n) => now[n] !== snap.tables[n] && !moving(n));
      const drift = [...all].filter((n) => now[n] !== snap.tables[n] && moving(n));
      const exact = isNew && status.phase !== 'idle';
      return {
        status: unreadable.length ? 'fail' : diffs.length === 0 ? 'pass' : exact ? 'fail' : 'warn',
        title: diffs.length === 0 ? `${names.length} tables match (${fmt(total)} rows)` : `${diffs.length} tables differ`,
        detail: [
          diffs.length ? diffs.slice(0, 8).map((n) => `${n}: ${snap.tables[n] ?? '–'} → ${now[n] ?? '–'}`).join(' · ') : vsSnap,
          drift.length ? `expected to move: ${drift.map((n) => `${n} ${snap.tables[n] ?? '–'}→${now[n] ?? '–'}`).join(', ')}` : '',
        ].filter(Boolean).join(' | '),
      };
    }),
    timed('write', 'data', async () => {
      const key = `move_probe_${Date.now()}`;
      const ins = await db.from('app_settings').insert({ key, value: 'probe', updated_at: new Date().toISOString() });
      if (ins.error) return { status: isNew ? 'fail' : 'warn', title: 'Database refuses writes', detail: `${ins.error.message}${isNew ? '' : ' (expected while Tokyo is frozen)'}` };
      await db.from('app_settings').delete().eq('key', key);
      return { status: 'pass', title: 'Database accepts writes', detail: 'probe row written and deleted' };
    }),
    timed('cron-pause', 'services', async () => {
      const { data } = await db.from('app_settings').select('value').eq('key', 'cron_paused').maybeSingle();
      const paused = (data as { value?: string } | null)?.value === 'on';
      const inWindow = status.phase !== 'idle' && status.phase !== 'open';
      return { status: paused === inWindow ? 'pass' : 'warn', title: paused ? 'Background jobs PAUSED' : 'Background jobs running', detail: inWindow ? 'paused for the move window; resumed by "Open"' : paused ? 'paused outside a move window: resume them' : '—' };
    }),
    timed('maintenance', 'data', async () => {
      const m = await readMaintenance();
      return { status: 'pass', title: m.on ? `Maintenance ON (${m.allow.length} allowed)` : 'Maintenance off', detail: m.allow.join(', ') || '—' };
    }),

    // ── files ────────────────────────────────────────────────────────────────
    timed('buckets', 'files', async () => {
      const now = await countBuckets();
      const files = Object.values(now).reduce((a, b) => a + b.files, 0);
      if (!snap) return { status: 'warn', title: `${Object.keys(now).length} folders, ${fmt(files)} files`, detail: 'no snapshot yet' };
      const all = new Set([...Object.keys(now), ...Object.keys(snap.buckets)]);
      const diffs = [...all].filter((b) => now[b]?.files !== snap.buckets[b]?.files || now[b]?.bytes !== snap.buckets[b]?.bytes);
      return { status: diffs.length === 0 ? 'pass' : isNew ? 'fail' : 'warn', title: diffs.length ? `${diffs.length} folders differ` : `${Object.keys(now).length} folders, ${fmt(files)} files match`, detail: diffs.length ? diffs.map((b) => `${b}: ${snap.buckets[b]?.files ?? '–'} → ${now[b]?.files ?? '–'} files`).join(' · ') : vsSnap };
    }),
    timed('old-links', 'links', async () => {
      if (!isNew) return { status: 'pass', title: 'Old-address links: not applicable yet', detail: 'this IS the old address' };
      const { data, error } = await db.rpc('move_url_leftovers', { old_host: OLD_HOST });
      if (error) return { status: 'fail', title: 'Link scan unavailable', detail: error.message };
      const rows = (data || []) as Array<{ tbl: string; col: string; n: number }>;
      const n = rows.reduce((a, r) => a + Number(r.n), 0);
      return { status: n === 0 ? 'pass' : 'fail', title: n === 0 ? 'No links to the old address' : `${n} cells still point at Tokyo`, detail: n === 0 ? 'every text/JSON column scanned' : rows.slice(0, 6).map((r) => `${r.tbl}.${r.col}: ${r.n}`).join(' · ') };
    }),
    timed('sample-files', 'links', async () => {
      const urls = new Set<string>();
      const { data: av } = await db.from('athletes').select('avatar_url').not('avatar_url', 'is', null).limit(15);
      for (const r of (av || []) as Array<{ avatar_url: string }>) if (r.avatar_url.includes('/storage/v1/')) urls.add(r.avatar_url);
      const { data: fi } = await db.from('feed_items').select('*').order('created_at', { ascending: false }).limit(300);
      const re = /https:\/\/[a-z0-9.-]+\/storage\/v1\/object\/public\/[^"\s)]+/g;
      for (const row of fi || []) { for (const m of JSON.stringify(row).match(re) || []) { if (urls.size < 30) urls.add(m); } }
      const list = [...urls].slice(0, 30);
      if (!list.length) return { status: 'warn', title: 'No stored file links found to sample', detail: 'avatars and feed media scanned' };
      const res = await pool(list, 8, async (u) => {
        const r = await fetch(u, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' }).catch(() => null);
        return { u, ok: !!r && (r.status === 200 || r.status === 206), host: new URL(u).hostname };
      });
      const bad = res.filter((r) => !r.ok);
      const wrongHost = res.filter((r) => r.host !== connectedHost());
      return {
        status: bad.length ? 'fail' : wrongHost.length && isNew ? 'fail' : 'pass',
        title: `${res.length - bad.length}/${res.length} sample files load`,
        detail: bad.length ? bad.slice(0, 3).map((r) => r.u.split('/public/')[1]).join(' · ') : wrongHost.length ? `${wrongHost.length} served from ${wrongHost[0].host}` : `all from ${connectedHost()}`,
      };
    }),

    // ── people & connections ─────────────────────────────────────────────────
    timed('auth-users', 'auth', async () => {
      const n = await countAuthUsers(db);
      if (!snap) return { status: 'warn', title: `${n} sign-in accounts`, detail: 'no snapshot yet' };
      return { status: n === snap.authUsers ? 'pass' : isNew ? 'fail' : 'warn', title: n === snap.authUsers ? `${n} sign-in accounts match` : `Accounts: ${snap.authUsers} → ${n}`, detail: vsSnap };
    }),
    timed('providers', 'services', async () => {
      const rows = await providerRows(db);
      let bad = 0; let s = 0; let g = 0;
      for (const r of rows) {
        for (const enc of [r.strava_auth, r.garmin_auth]) if (enc) { try { decrypt(enc); } catch { bad++; } }
        if (r.strava_auth) s++; if (r.garmin_auth) g++;
      }
      const match = !snap || (s === snap.strava && g === snap.garmin);
      return { status: bad ? 'fail' : match ? 'pass' : isNew ? 'fail' : 'warn', title: `Strava ${s} · Garmin ${g}${bad ? `, ${bad} unreadable` : ', all readable'}`, detail: snap ? `snapshot: Strava ${snap.strava} · Garmin ${snap.garmin}` : 'no snapshot yet' };
    }),
    timed('push-subs', 'services', async () => {
      const { count } = await db.from('push_subscriptions').select('id', { count: 'exact', head: true });
      const n = count ?? 0;
      const mine = caller.athleteId ? (await db.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('athlete_id', caller.athleteId)).count ?? 0 : 0;
      const match = !snap || n === snap.pushSubs;
      return { status: match ? 'pass' : isNew ? 'fail' : 'warn', title: `${n} push devices (${mine} yours)`, detail: snap ? `snapshot: ${snap.pushSubs}` : 'no snapshot yet' };
    }),
    timed('crons', 'services', async () => {
      const { data } = await db.from('cron_tick_locks').select('tick_at').order('tick_at', { ascending: false }).limit(1);
      const last = (data?.[0] as { tick_at?: string } | undefined)?.tick_at;
      const since = status.switchedAt;
      const ranAfter = !!last && !!since && last > since;
      const age = last ? Math.round((Date.now() - new Date(last).getTime()) / 60000) : null;
      return { status: !isNew ? 'pass' : ranAfter ? 'pass' : 'warn', title: last ? `Background jobs: last tick ${age} min ago` : 'Background jobs: no tick yet', detail: isNew ? (ranAfter ? 'ran since the switch' : 'not yet since the switch (every 5 min)') : '—' };
    }),
    timed('stream', 'services', async () => {
      const { getStreamServerClient } = await import('@/lib/stream/server');
      const token = getStreamServerClient().createToken('move-check');
      return { status: token ? 'pass' : 'fail', title: 'Chat (Stream) keys work', detail: 'server token minted' };
    }),
    timed('third-parties', 'services', async () => {
      const targets: Array<[string, string]> = [['Strava', 'https://www.strava.com/api/v3/athlete'], ['Garmin', 'https://connect.garmin.com/'], ['Anthropic', 'https://api.anthropic.com/v1/models'], ['Stream', 'https://chat.stream-io-api.com/']];
      const res = await pool(targets, 4, async ([name, u]) => { const t = Date.now(); const r = await fetch(u, { method: 'GET', cache: 'no-store', redirect: 'manual' }).catch(() => null); return `${name} ${r ? Date.now() - t + 'ms' : 'unreachable'}`; });
      return { status: res.some((r) => r.endsWith('unreachable')) ? 'fail' : 'pass', title: 'Outside services reachable', detail: res.join(' · ') };
    }),
  ];
  return Promise.all(checks);
}

// Race-day dry run over HTTP (task 146) — LOCAL server only. Runbook: docs/race-day-dryrun.md.
//
//   npx tsx ./scripts/race-day-dryrun.mts --event <eventId> --tokens ./tmp/dryrun-tokens.json \
//       [--base http://localhost:3000] [--minutes 240] [--runners 25] [--cadence 20] [--viewers 10] \
//       [--restarts 3] [--double-send 0] [--seed 6122026] [--json out.json]
//
// tokens file: { "runners": ["<jwt>", …], "viewers": ["<jwt>", …] } — access tokens of SEEDED local
// users (runners need a race_entries row + race_live_phone on; viewers race_live on + a race_map_viewers row).
// Real time: the server stamps the window and the 8 s limit on its own clock, so a 4 h run takes 4 h;
// use --minutes for a shorter rehearsal. Exit code 1 when the result is FAIL.
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_DRYRUN, formatReport, percentile, runDryRun, type DryRunTransport } from '@/lib/race-live/dryrun';

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const num = (name: string, fallback: number) => {
  const v = Number(arg(name, String(fallback)));
  if (!Number.isFinite(v) || v < 0) throw new Error(`--${name} must be a non-negative number`);
  return v;
};

const base = arg('base', 'http://localhost:3000')!;
const host = new URL(base).hostname;
// Never against a deployed environment: this writes positions and hammers the board.
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(`refusing to run against ${base} — local servers only (localhost / 127.0.0.1)`);
  process.exit(2);
}
const eventId = arg('event');
const tokensPath = arg('tokens');
if (!eventId || !tokensPath) {
  console.error('usage: --event <eventId> --tokens <file.json> (see docs/race-day-dryrun.md)');
  process.exit(2);
}
const tokens = JSON.parse(readFileSync(tokensPath, 'utf8')) as { runners: string[]; viewers?: string[] };
const runners = Math.min(num('runners', DEFAULT_DRYRUN.runners), tokens.runners.length);
const viewers = Math.min(num('viewers', DEFAULT_DRYRUN.viewers), tokens.viewers?.length ?? 0);
if (runners < num('runners', DEFAULT_DRYRUN.runners)) console.warn(`only ${runners} runner tokens — running with ${runners}`);

const call = async (path: string, token: string, init: RequestInit = {}) => {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body };
};
const ev = encodeURIComponent(eventId);
const transport: DryRunTransport = {
  postPosition: (i, body) => call(`/api/race-live/${ev}/position`, tokens.runners[i], { method: 'POST', body: JSON.stringify(body) }),
  getBoard: (v) => call(`/api/race-live/${ev}`, tokens.viewers![v]),
};

const startMs = Date.now() + 5_000;
const clock = {
  concurrent: true,
  advanceTo: async (ms: number) => {
    const wait = ms - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  },
};

const minutes = num('minutes', DEFAULT_DRYRUN.durationSec / 60);
console.log(`dry run → ${base}, event ${eventId}, ${runners} runners, ${viewers} viewers, ${minutes} min (real time)`);
const progress = setInterval(() => console.log(`  … ${Math.round((Date.now() - startMs) / 60000)} / ${minutes} min`), 5 * 60_000);
const report = await runDryRun(transport, clock, {
  startMs,
  runners,
  viewers,
  durationSec: Math.round(minutes * 60),
  // Over HTTP everyone is "already running": a corral spread would leave short rehearsals empty.
  startSpreadSec: Math.min(DEFAULT_DRYRUN.startSpreadSec, Math.round(minutes * 6)),
  cadenceSec: num('cadence', DEFAULT_DRYRUN.cadenceSec),
  viewerPollSec: num('viewer-poll', DEFAULT_DRYRUN.viewerPollSec),
  restarts: num('restarts', DEFAULT_DRYRUN.restarts),
  doubleSendRate: num('double-send', 0),
  seed: num('seed', DEFAULT_DRYRUN.seed),
});
clearInterval(progress);
const text = formatReport(report);
console.log(text);
const out = arg('json');
if (out) {
  const { posts, boards, ...rest } = report;
  const summary = (s: typeof posts) => ({ count: s.count, byStatus: s.byStatus, p50: percentile(s.latenciesMs, 50), p95: percentile(s.latenciesMs, 95), max: percentile(s.latenciesMs, 100) });
  writeFileSync(out, JSON.stringify({ ...rest, posts: summary(posts), boards: summary(boards) }, null, 2));
}
process.exit(text.endsWith('RESULT: PASS') ? 0 : 1);

/**
 * RACE-DAY DRY RUN (round 6, task 146 — Valencia 2026-12-06). A load + correctness rehearsal of the
 * phone-position ingest: N runners post their position every `cadenceSec` for `durationSec`, while
 * M viewers poll the board, and the run reports errors, rate-limit hits (429) and latency (p50/p95).
 *
 * The simulation is transport-agnostic so the same scenario runs two ways:
 *   - in-process against the real route handlers + the in-memory DB (src/__tests__/raceDayDryrun.test.ts,
 *     a full 4 h race in seconds on a fake clock), and
 *   - over HTTP against a LOCAL dev server with seeded data (scripts/race-day-dryrun.mts, real time).
 * docs/race-day-dryrun.md has the runbook.
 *
 * The runner model mirrors the phone app: counters from the runner's own start, GPS measuring ~1 % long,
 * a few phones restarting mid-race (offline for a while, then `resume: true` with counters from 0 and
 * the server-returned base added from then on), and an optional "double send" (a retry 1 s later) that
 * SHOULD be a 429 — those are counted separately so an expected 429 never hides an unexpected one.
 */
import { RACE_M } from './core';

export interface DryRunOptions {
  runners: number;
  /** Seconds between a runner's posts (the phone's cadence). */
  cadenceSec: number;
  /** ± seconds of random jitter on each post. */
  jitterSec: number;
  durationSec: number;
  /** Gun time (ms). Runners cross the start 0..startSpreadSec later (the corrals). */
  startMs: number;
  startSpreadSec: number;
  viewers: number;
  viewerPollSec: number;
  /** How many runners' phones restart once mid-race (then resume). */
  restarts: number;
  restartOfflineSec: number;
  /** Probability that a post is immediately retried 1 s later (an intended 429). */
  doubleSendRate: number;
  seed: number;
}

export const DEFAULT_DRYRUN: DryRunOptions = {
  runners: 25, cadenceSec: 20, jitterSec: 3, durationSec: 4 * 3600,
  startMs: Date.parse('2026-12-06T07:15:00Z'), startSpreadSec: 600,
  viewers: 10, viewerPollSec: 30, restarts: 3, restartOfflineSec: 180,
  doubleSendRate: 0, seed: 6122026,
};

export interface PositionBody {
  lat: number; lon: number; distanceM: number; elapsedSec: number; at: string; resume?: true;
}
export interface TransportResult { status: number; body?: unknown }
export interface DryRunTransport {
  postPosition(runner: number, body: PositionBody): Promise<TransportResult>;
  getBoard(viewer: number): Promise<TransportResult>;
}
/**
 * `advanceTo` moves the clock to the event time: a fake clock just sets it; a real clock sleeps.
 * `concurrent` = don't await each request before the next (real time: requests overlap like on race day).
 */
export interface DryRunClock { advanceTo(ms: number): void | Promise<void>; concurrent?: boolean }

type Kind = 'post' | 'retry' | 'board';
interface Ev { t: number; kind: Kind; idx: number }

export interface EndpointStats { count: number; byStatus: Record<string, number>; latenciesMs: number[] }
export interface DryRunReport {
  options: DryRunOptions;
  posts: EndpointStats;
  boards: EndpointStats;
  /** 5xx + network failures, any endpoint. */
  errors: number;
  /** 429s on a normal post (should be 0). */
  unexpectedRateLimited: number;
  /** 429s on an intended double send (should equal `retriesSent`). */
  expectedRateLimited: number;
  retriesSent: number;
  /** 4xx other than 429 on a normal post, by error code. */
  rejected: Record<string, number>;
  /** Largest |server distance − true distance| in an accepted post's reply, runners whose phone never restarted (m). */
  maxTrackErrorM: number;
  /**
   * Same, for runners whose phone restarted. Expected > 0: the distance run while the phone was off
   * is not on the track (the new session counts from where it came back) — about offline time × pace.
   */
  maxRestartTrackErrorM: number;
  firstErrors: string[];
}

/** Deterministic PRNG (mulberry32) so a run is reproducible from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}

interface Runner {
  ownStartMs: number;
  paceSecPerKm: number;
  /** The phone's session origin: counters are measured from here (moves on restart). */
  sessionStartMs: number;
  baseDistanceM: number;
  baseElapsedSec: number;
  offlineUntil: number;
  restartAt: number | null;
  pendingResume: boolean;
  lastBody: PositionBody | null;
  restarted: boolean;
  /** Crossed the line: the phone sends that last point, then stops sharing. */
  finished: boolean;
}

/** GPS measures a marathon ~1 % long; the server allows up to 6 %. */
const GPS_FACTOR = 1.01;
const FINISH_GPS_M = Math.round(RACE_M * GPS_FACTOR);
const trueDistanceM = (r: Runner, ms: number) =>
  Math.min(FINISH_GPS_M, Math.max(0, ((ms - r.ownStartMs) / 1000 / r.paceSecPerKm) * 1000 * GPS_FACTOR));

export function buildRunners(o: DryRunOptions, rand: () => number): Runner[] {
  const runners: Runner[] = [];
  for (let i = 0; i < o.runners; i++) {
    const ownStartMs = o.startMs + Math.round(rand() * o.startSpreadSec) * 1000;
    runners.push({
      ownStartMs,
      paceSecPerKm: 240 + Math.round(rand() * 150), // 4:00 – 6:30 /km
      sessionStartMs: ownStartMs, baseDistanceM: 0, baseElapsedSec: 0,
      offlineUntil: 0, restartAt: null, pendingResume: false, lastBody: null, finished: false, restarted: false,
    });
  }
  for (let k = 0; k < Math.min(o.restarts, o.runners); k++) {
    // Spread the restarts across the field and the race (between 25 % and 75 % of the run).
    const idx = Math.floor((k * o.runners) / Math.max(1, o.restarts));
    runners[idx].restartAt = o.startMs + Math.round(o.durationSec * (0.25 + 0.5 * rand())) * 1000;
  }
  return runners;
}

export function buildTimeline(o: DryRunOptions, runners: Runner[], rand: () => number): Ev[] {
  const end = o.startMs + o.durationSec * 1000;
  const evs: Ev[] = [];
  runners.forEach((r, idx) => {
    for (let t = r.ownStartMs; t <= end; t += o.cadenceSec * 1000) {
      const jitter = Math.round((rand() * 2 - 1) * o.jitterSec * 1000);
      const at = Math.min(end, Math.max(r.ownStartMs, t + jitter));
      evs.push({ t: at, kind: 'post', idx });
      if (o.doubleSendRate > 0 && rand() < o.doubleSendRate) evs.push({ t: at + 1000, kind: 'retry', idx });
    }
  });
  for (let v = 0; v < o.viewers; v++) {
    const offset = Math.round(rand() * o.viewerPollSec * 1000);
    for (let t = o.startMs + offset; t <= end; t += o.viewerPollSec * 1000) evs.push({ t, kind: 'board', idx: v });
  }
  // Stable by time; at the same ms posts go before boards so a board reflects them.
  const order: Record<Kind, number> = { post: 0, retry: 1, board: 2 };
  return evs.sort((a, b) => a.t - b.t || order[a.kind] - order[b.kind] || a.idx - b.idx);
}

const emptyStats = (): EndpointStats => ({ count: 0, byStatus: {}, latenciesMs: [] });

export async function runDryRun(
  transport: DryRunTransport,
  clock: DryRunClock,
  partial: Partial<DryRunOptions> = {},
  nowPerf: () => number = () => performance.now(),
): Promise<DryRunReport> {
  const o: DryRunOptions = { ...DEFAULT_DRYRUN, ...partial };
  const rand = rng(o.seed);
  const runners = buildRunners(o, rand);
  const timeline = buildTimeline(o, runners, rand);
  const report: DryRunReport = {
    options: o, posts: emptyStats(), boards: emptyStats(), errors: 0,
    unexpectedRateLimited: 0, expectedRateLimited: 0, retriesSent: 0, rejected: {},
    maxTrackErrorM: 0, maxRestartTrackErrorM: 0, firstErrors: [],
  };
  const noteError = (msg: string) => { report.errors++; if (report.firstErrors.length < 10) report.firstErrors.push(msg); };
  const inflight: Promise<void>[] = [];

  const timed = async (stats: EndpointStats, call: () => Promise<TransportResult>, label: string): Promise<TransportResult | null> => {
    const t0 = nowPerf();
    try {
      const res = await call();
      stats.count++;
      stats.latenciesMs.push(nowPerf() - t0);
      stats.byStatus[res.status] = (stats.byStatus[res.status] ?? 0) + 1;
      if (res.status >= 500) noteError(`${label} → ${res.status} ${JSON.stringify(res.body ?? '').slice(0, 200)}`);
      return res;
    } catch (e) {
      stats.count++;
      stats.byStatus.network = (stats.byStatus.network ?? 0) + 1;
      noteError(`${label} → ${(e as Error).message}`);
      return null;
    }
  };

  const doPost = async (ev: Ev, nowMs: number) => {
    const r = runners[ev.idx];
    if (ev.kind === 'retry') {
      if (!r.lastBody) return;
      report.retriesSent++;
      const res = await timed(report.posts, () => transport.postPosition(ev.idx, r.lastBody!), `retry r${ev.idx}`);
      if (res?.status === 429) report.expectedRateLimited++;
      return;
    }
    if (r.restartAt != null && nowMs >= r.restartAt) {
      // The phone dies here; it comes back `restartOfflineSec` later with a fresh session from 0.
      r.offlineUntil = r.restartAt + o.restartOfflineSec * 1000;
      r.sessionStartMs = r.offlineUntil;
      r.restartAt = null;
      r.restarted = true;
      r.pendingResume = true;
      r.baseDistanceM = 0;
      r.baseElapsedSec = 0;
    }
    if (nowMs < r.offlineUntil || r.finished) return;
    const truth = trueDistanceM(r, nowMs);
    if (truth >= FINISH_GPS_M) r.finished = true;
    const sessionD = truth - trueDistanceM(r, r.sessionStartMs);
    const sessionE = Math.round((nowMs - r.sessionStartMs) / 1000);
    const body: PositionBody = {
      lat: 39.47 + ev.idx * 1e-4, lon: -0.37,
      distanceM: Math.round(r.baseDistanceM + sessionD),
      elapsedSec: r.baseElapsedSec + sessionE,
      at: new Date(nowMs).toISOString(),
    };
    if (r.pendingResume) body.resume = true;
    r.lastBody = body;
    const res = await timed(report.posts, () => transport.postPosition(ev.idx, body), `post r${ev.idx}`);
    if (!res) return;
    if (res.status === 429) { report.unexpectedRateLimited++; return; }
    if (res.status >= 400 && res.status < 500) {
      const code = String((res.body as { error?: string } | undefined)?.error ?? res.status);
      report.rejected[code] = (report.rejected[code] ?? 0) + 1;
      return;
    }
    if (res.status !== 200) return;
    const b = (res.body ?? {}) as { distanceM?: number; resumed?: boolean; baseDistanceM?: number; baseElapsedSec?: number };
    if (r.pendingResume) {
      r.pendingResume = false;
      if (b.resumed) { r.baseDistanceM = b.baseDistanceM ?? 0; r.baseElapsedSec = b.baseElapsedSec ?? 0; }
    }
    if (typeof b.distanceM === 'number') {
      // Truth relative to the run so far: the server's track should match the runner's real GPS distance.
      const err = Math.abs(b.distanceM - Math.round(truth));
      if (r.restarted) report.maxRestartTrackErrorM = Math.max(report.maxRestartTrackErrorM, err);
      else report.maxTrackErrorM = Math.max(report.maxTrackErrorM, err);
    }
  };

  for (const ev of timeline) {
    await clock.advanceTo(ev.t);
    const job = ev.kind === 'board'
      ? timed(report.boards, () => transport.getBoard(ev.idx), `board v${ev.idx}`).then(() => undefined)
      : doPost(ev, ev.t);
    if (clock.concurrent) inflight.push(job); else await job;
  }
  await Promise.all(inflight);
  return report;
}

const fmtMs = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} ms`);

/** Plain-text summary — what the script prints and what docs/race-day-dryrun.md shows. */
export function formatReport(r: DryRunReport): string {
  const o = r.options;
  const line = (name: string, s: EndpointStats) =>
    `${name.padEnd(7)} n=${s.count}  statuses=${JSON.stringify(s.byStatus)}  p50=${fmtMs(percentile(s.latenciesMs, 50))}  p95=${fmtMs(percentile(s.latenciesMs, 95))}  max=${fmtMs(percentile(s.latenciesMs, 100))}`;
  const ok = r.errors === 0 && r.unexpectedRateLimited === 0 && Object.keys(r.rejected).length === 0 && r.expectedRateLimited === r.retriesSent;
  return [
    `Race-day dry run: ${o.runners} runners every ${o.cadenceSec}±${o.jitterSec}s for ${(o.durationSec / 3600).toFixed(2)} h, ${o.viewers} viewers every ${o.viewerPollSec}s, ${o.restarts} phone restarts, seed ${o.seed}`,
    line('POST', r.posts),
    line('BOARD', r.boards),
    `errors (5xx/network): ${r.errors}`,
    `rate-limit hits (429): unexpected ${r.unexpectedRateLimited}, intended double-sends ${r.expectedRateLimited}/${r.retriesSent}`,
    `rejected (other 4xx): ${JSON.stringify(r.rejected)}`,
    `max track error: ${Math.round(r.maxTrackErrorM)} m (restarted phones: ${Math.round(r.maxRestartTrackErrorM)} m — the offline stretch)`,
    ...(r.firstErrors.length ? ['first errors:', ...r.firstErrors.map((e) => `  ${e}`)] : []),
    ok ? 'RESULT: PASS' : 'RESULT: FAIL',
  ].join('\n');
}

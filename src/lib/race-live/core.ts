// ═════════════════════════════════════════════════════════════════════════════
// RACE LIVE — Valencia 2026 (and any later race) live tracking. PURE: no DB, no fetch.
//
// Source of truth for times is whatever adapter fed the splits (server.ts):
//   'feed'   — the organizer's timing data (UNDOCUMENTED; see docs/race-live.md — no public
//              API exists, the official app's LiveTracking is the only published channel)
//   'manual' — a staff member typing a time off the official app (always works)
//   'replay' — a synthetic past-race replay for dry runs
// Everything below is source-blind on purpose, so the fallback behaves exactly like the feed.
// ═════════════════════════════════════════════════════════════════════════════

export const POINTS = [
  { key: 'start', m: 0 },
  { key: '5k', m: 5000 },
  { key: '10k', m: 10000 },
  { key: '15k', m: 15000 },
  { key: '20k', m: 20000 },
  { key: 'half', m: 21097.5 },
  { key: '25k', m: 25000 },
  { key: '30k', m: 30000 },
  { key: '35k', m: 35000 },
  { key: '40k', m: 40000 },
  { key: 'finish', m: 42195 },
] as const;
export type PointKey = (typeof POINTS)[number]['key'];
export const POINT_KEYS = POINTS.map((p) => p.key) as PointKey[];
export const POINT_M: Record<PointKey, number> = Object.fromEntries(POINTS.map((p) => [p.key, p.m])) as Record<PointKey, number>;
export const RACE_M = 42195;

export function isPointKey(v: unknown): v is PointKey {
  return typeof v === 'string' && (POINT_KEYS as string[]).includes(v);
}

/** Milestones that push. One per milestone per runner, ever. */
export const MILESTONES = ['start', 'half', 'finish'] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface Split {
  point: PointKey;
  /** Seconds since the runner's own start (chip time). `start` is 0. */
  elapsedSec: number;
}

/** "2:58:41" / "58:41" / "02:58:41.3" → seconds; null when unreadable. */
export function parseClock(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?$/);
  if (!m) return null;
  const [h, mi, s] = [Number(m[1] || 0), Number(m[2]), Number(m[3])];
  if (mi > 59 || s > 59) return null;
  return h * 3600 + mi * 60 + s;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Bibs arrive as "08123", 8123, " 8123 " — compare on the digits without leading zeros. */
export function normalizeBib(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  const stripped = s.replace(/^0+(?=\w)/, '');
  return stripped || null;
}

/** Split labels in timing feeds: "5K", "Km 5", "HALF", "Media", "21K", "Meta", "FINISH". */
export function pointFromLabel(label: unknown): PointKey | null {
  if (typeof label !== 'string') return null;
  const s = label.trim().toLowerCase();
  if (isPointKey(s)) return s;
  if (/^(salida|start|inicio)$/.test(s)) return 'start';
  if (/^(meta|finish|llegada|final)$/.test(s)) return 'finish';
  if (/(half|media|21[.,]?1?\s*k|^21k$|^hm$)/.test(s)) return 'half';
  const km = s.match(/(\d{1,2})\s*k(m)?|km\s*(\d{1,2})/);
  const n = km ? Number(km[1] || km[3]) : NaN;
  if ([5, 10, 15, 20, 25, 30, 35, 40].includes(n)) return `${n}k` as PointKey;
  if (n === 42) return 'finish';
  return null;
}

/** Keep the plausible splits only: known point, monotonic in distance AND time. */
export function cleanSplits(splits: Split[]): Split[] {
  const byPoint = new Map<PointKey, number>();
  for (const s of splits) {
    if (!isPointKey(s.point) || !Number.isFinite(s.elapsedSec) || s.elapsedSec < 0) continue;
    byPoint.set(s.point, s.point === 'start' ? 0 : Math.round(s.elapsedSec));
  }
  const out: Split[] = [];
  let last = -1;
  for (const key of POINT_KEYS) {
    const t = byPoint.get(key);
    if (t === undefined) continue;
    if (key !== 'start' && t <= last) continue; // a time running backwards is a feed glitch
    out.push({ point: key, elapsedSec: t });
    last = t;
  }
  return out;
}

export function latestSplit(splits: Split[]): Split | null {
  const c = cleanSplits(splits);
  return c.length ? c[c.length - 1] : null;
}

/**
 * Predicted finish from the latest split: the average pace so far, with a Riegel-style fade
 * (exponent 1.06) so a 10 km split doesn't promise an even second half nobody runs. Null before
 * 5 km — a prediction from the start mat is a guess dressed as a number.
 */
export function predictFinishSec(splits: Split[]): number | null {
  const last = latestSplit(splits);
  if (!last) return null;
  if (last.point === 'finish') return last.elapsedSec;
  const m = POINT_M[last.point];
  if (m < 5000 || last.elapsedSec <= 0) return null;
  return Math.round(last.elapsedSec * Math.pow(RACE_M / m, 1.06));
}

export function paceSecPerKm(splits: Split[]): number | null {
  const last = latestSplit(splits);
  if (!last || last.point === 'start' || last.elapsedSec <= 0) return null;
  return Math.round(last.elapsedSec / (POINT_M[last.point] / 1000));
}

/** Where a runner is right now. */
export type RunnerState = 'not_started' | 'running' | 'finished';
export function runnerState(splits: Split[]): RunnerState {
  const last = latestSplit(splits);
  if (!last) return 'not_started';
  return last.point === 'finish' ? 'finished' : 'running';
}

/** Which milestone a split reaches. */
function milestoneOf(point: PointKey): Milestone | null {
  return point === 'start' ? 'start' : point === 'half' ? 'half' : point === 'finish' ? 'finish' : null;
}

/**
 * Never spam: given every split now known and the milestones already claimed, return the ONE
 * milestone to announce (the furthest new one) and every milestone to mark done silently. A poll
 * that missed half an hour and sees half + finish at once announces only the finish — a "half"
 * push arriving after the "finished" one is noise at best and confusing at worst.
 */
export function milestonesToSend(splits: Split[], claimed: Iterable<Milestone>): { send: Milestone | null; silent: Milestone[] } {
  const done = new Set(claimed);
  const reached = cleanSplits(splits).map((s) => milestoneOf(s.point)).filter((m): m is Milestone => !!m);
  const fresh = MILESTONES.filter((m) => reached.includes(m) && !done.has(m));
  if (!fresh.length) return { send: null, silent: [] };
  const send = fresh[fresh.length - 1];
  return { send, silent: fresh.slice(0, -1) };
}

// ─── mapping feed rows → club runners ──────────────────────────────────────────

export interface Entry {
  athleteId: string;
  bib: string | null;
  /** The runner turned live tracking off: never shown, never announced. */
  optOut: boolean;
}

export interface FeedRunner {
  bib: string;
  splits: Split[];
}

/** Match feed rows onto entries by bib. Opted-out runners are dropped HERE, before anything is stored. */
export function mapFeedToEntries(feed: FeedRunner[], entries: Entry[]): Map<string, Split[]> {
  const byBib = new Map<string, Entry>();
  for (const e of entries) {
    const b = normalizeBib(e.bib);
    if (b && !e.optOut) byBib.set(b, e);
  }
  const out = new Map<string, Split[]>();
  for (const row of feed) {
    const e = byBib.get(normalizeBib(row.bib) ?? '');
    if (!e) continue;
    out.set(e.athleteId, cleanSplits(row.splits));
  }
  return out;
}

/**
 * Best-effort normaliser for a timing-feed JSON body. The organizer publishes no schema, so this
 * accepts the common shapes (an array or {data|results|athletes|participants: [...]}, each with a
 * bib/dorsal field and splits as an array of {name|label|point, time|value} or a {label: time}
 * object). UNVERIFIED against the real feed — run `npm run race:probe` against it before race day.
 */
export function normalizeFeedBody(body: unknown): FeedRunner[] {
  const list: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? (['data', 'results', 'athletes', 'participants', 'runners'].map((k) => (body as Record<string, unknown>)[k]).find(Array.isArray) as unknown[] | undefined)
        ?? [body]
      : [];
  const out: FeedRunner[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const bib = normalizeBib(r.bib ?? r.dorsal ?? r.bibNumber ?? r.number);
    if (!bib) continue;
    const splits: Split[] = [];
    const src = r.splits ?? r.times ?? r.checkpoints ?? r.parciales;
    if (Array.isArray(src)) {
      for (const s of src) {
        if (!s || typeof s !== 'object') continue;
        const o = s as Record<string, unknown>;
        const point = pointFromLabel(o.point ?? o.name ?? o.label ?? o.id);
        const t = parseClock(o.time ?? o.value ?? o.chip ?? o.netTime ?? o.elapsed);
        if (point && t !== null) splits.push({ point, elapsedSec: t });
      }
    } else if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        const point = pointFromLabel(k);
        const t = parseClock(v);
        if (point && t !== null) splits.push({ point, elapsedSec: t });
      }
    }
    const fin = parseClock(r.chipTime ?? r.netTime ?? r.finishTime ?? r.tiempoNeto);
    if (fin !== null && fin > 0) splits.push({ point: 'finish', elapsedSec: fin });
    if (splits.length && !splits.some((s) => s.point === 'start')) splits.push({ point: 'start', elapsedSec: 0 });
    out.push({ bib, splits: cleanSplits(splits) });
  }
  return out;
}

// ─── push fan-out ─────────────────────────────────────────────────────────────

/**
 * Who hears about a runner's milestone:
 *   start / half → their followers only (opt-in per person — the right audience for an update)
 *   finish       → followers + every member who has the feature on (the club celebrates)
 * Never the runner themself, never anyone while the runner opted out, and only viewers the
 * feature is enabled for. Category prefs and quiet hours are applied downstream by the send path.
 */
export function recipientsFor(p: {
  milestone: Milestone;
  runnerId: string;
  runnerOptOut: boolean;
  followerIds: string[];
  enabledMemberIds: string[];
}): string[] {
  if (p.runnerOptOut) return [];
  const enabled = new Set(p.enabledMemberIds);
  const pool = p.milestone === 'finish' ? [...p.followerIds, ...p.enabledMemberIds] : p.followerIds;
  return [...new Set(pool)].filter((id) => id !== p.runnerId && enabled.has(id));
}

export function milestoneCopy(locale: 'he' | 'en', p: { name: string; milestone: Milestone; elapsedSec: number; predictedSec: number | null }): { title: string; body: string } {
  const name = p.name.trim() || (locale === 'he' ? 'רץ/ת מהמועדון' : 'A club runner');
  const t = formatClock(p.elapsedSec);
  if (locale === 'en') {
    if (p.milestone === 'start') return { title: 'Valencia Marathon', body: `${name} crossed the start 🏁` };
    if (p.milestone === 'half') return { title: 'Valencia Marathon', body: `${name} passed halfway in ${t}${p.predictedSec ? ` · on course for ${formatClock(p.predictedSec)}` : ''}` };
    return { title: 'Valencia Marathon 🎉', body: `${name} finished in ${t} 🎉` };
  }
  if (p.milestone === 'start') return { title: 'מרתון ולנסיה', body: `${name} יצא/ה לדרך 🏁` };
  if (p.milestone === 'half') return { title: 'מרתון ולנסיה', body: `${name} עבר/ה את חצי המרתון ב-${t}${p.predictedSec ? ` · צפי ${formatClock(p.predictedSec)}` : ''}` };
  return { title: 'מרתון ולנסיה 🎉', body: `${name} סיים/ה ב-${t} 🎉` };
}

// ─── poll schedule ─────────────────────────────────────────────────────────────

/**
 * Should the poller fetch now? Inside the window, every `everySec` (default 60s); after N
 * consecutive failures back off exponentially (2^n minutes, capped at 10), so an organizer feed
 * that starts refusing us is not hammered. Outside the window: never.
 */
export function shouldPoll(p: { nowMs: number; fromMs: number; toMs: number; lastPolledMs: number | null; failCount: number; everySec?: number }): boolean {
  if (p.nowMs < p.fromMs || p.nowMs > p.toMs) return false;
  if (p.lastPolledMs === null) return true;
  const base = (p.everySec ?? 60) * 1000;
  const wait = p.failCount > 0 ? Math.min(10 * 60_000, Math.pow(2, p.failCount) * 60_000) : base;
  return p.nowMs - p.lastPolledMs >= wait - 2000;
}

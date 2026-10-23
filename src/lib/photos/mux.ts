import { createSign } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';

/**
 * THE VIDEOS' VIEWING COPIES, AT MUX (mockup ~/.cache/madregot/photos-videos.html, option ב;
 * Ofer chose Mux on 2026-10-23 over Cloudflare and Bunny: the best player and quality, and
 * at the club's size about free).
 *
 * The originals stay in Drive (4K, up to 573 MB). Mux pulls each one ONCE from our signed
 * link (/api/photos/browse/video), and keeps an adaptive copy that plays at once on any
 * phone. Playback is signed: a link is minted per view, for one video, for a few hours, so
 * a copy can't be watched outside the app. The copy job (lib/photos/mirror's cron) sends the
 * newest videos first and asks after the ones still preparing; what is where is kept in
 * club-photos/mux-assets.json.
 */

const API = 'https://api.mux.com';
const BUCKET = 'club-photos';
const MAP_PATH = 'mux-assets.json';
/**
 * Sent per run: Mux ingests in parallel, and a run must leave time for the rest (a send is
 * one API call, ~0.3 s). 15 was 56 hours for the library — 5,059 videos, 1,470 minutes
 * (counted 10-23 by walking the folders; Drive's search saw only 242) — 50 is ~17.
 */
const SEND_PER_RUN = 50;
/** A ceiling on what is stored (minutes), so a mistake can't run the bill up. Read per run. */
const maxMinutes = () => Number(process.env.MUX_MAX_MINUTES || 3000);
const PLAY_TTL_S = 6 * 3600;

/**
 * THE BUDGET GUARD (Ofer, 10-23: "I'm worried about the moment it starts to cost money").
 * Pay-as-you-go carries a $20 credit a month and 100,000 free delivery minutes; storing our
 * copies is cents, under the minutes ceiling above. What could cost is WATCHING, so the
 * minutes watched this month are asked of Mux (its numbers lag 12 hours) every few hours:
 * at WARN_AT of the free minutes the admins and Ofer are told; at STOP_AT the app stops
 * using the copies until the month turns — the originals play, slower but free — and they
 * are told again. Stopping short of 100% leaves room for the 12 hours Mux hasn't reported.
 */
export const FREE_DELIVERY_MINUTES = 100_000;
export const WARN_AT = 0.5;
export const STOP_AT = 0.8;
const BUDGET_PATH = 'mux-budget.json';
const BUDGET_EVERY_MS = 6 * 3600_000;

export interface MuxBudget {
  /** 'YYYY-MM' (UTC), the month the numbers are for. */
  month: string;
  /** Minutes Mux delivered this month, as of its last report. */
  minutes: number;
  checkedAt: string;
  warned?: boolean;
  /** The copies are off until the month turns. */
  stopped?: boolean;
}

export interface MuxEntry {
  /** Mux asset id. */
  a: string;
  /** Signed playback id, once Mux has one. */
  p?: string;
  /** 'preparing' | 'ready' | 'errored'. */
  s: string;
  /** Seconds, once known. */
  d?: number;
}
export type MuxMap = Record<string, MuxEntry>;

export function muxConfigured(): boolean {
  return !!(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
}
const auth = () => `Basic ${Buffer.from(`${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`).toString('base64')}`;

async function mux<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: auth(), 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(`mux ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data as T;
}

export async function readMuxMap(): Promise<MuxMap> {
  const { data } = await createServerClient().storage.from(BUCKET).download(MAP_PATH);
  if (!data) return {};
  try { return JSON.parse(await data.text()) as MuxMap; } catch { return {}; }
}
async function writeMuxMap(map: MuxMap): Promise<void> {
  await createServerClient().storage.from(BUCKET).upload(MAP_PATH, JSON.stringify(map), { contentType: 'application/json', upsert: true });
}

/**
 * One run: ask after the copies still preparing, then send the next videos (newest first)
 * while the stored minutes are under the ceiling. `videos` in the order to send them, with
 * their length (ms) and a link Mux can pull the original from.
 */
export async function syncMuxCopies(videos: Array<{ id: string; ms: number | null; src: () => string | null }>, deadline: number): Promise<{ sent: number; ready: number; preparing: number; errored: number; minutes: number }> {
  const map = await readMuxMap();
  let dirty = false;
  // The ones Mux is still making — asked ten at a time (50 a run are sent now).
  const preparing = Object.entries(map).filter(([, e]) => e.s === 'preparing');
  for (let i = 0; i < preparing.length && Date.now() < deadline; i += 10) {
    await Promise.all(preparing.slice(i, i + 10).map(async ([id, e]) => {
      const asset = await mux<{ status: string; duration?: number; playback_ids?: Array<{ id: string; policy: string }> }>(`/video/v1/assets/${e.a}`).catch(() => null);
      if (!asset) return;
      const p = asset.playback_ids?.find((x) => x.policy === 'signed')?.id;
      if (asset.status !== e.s || p !== e.p) { map[id] = { ...e, s: asset.status, p, d: asset.duration ? Math.round(asset.duration) : e.d }; dirty = true; }
    }));
  }
  // The next ones, under the ceiling — and none while the budget guard has the copies off.
  const stored = () => Object.values(map).reduce((a, e) => a + (e.d ?? 0), 0) / 60;
  let sent = 0;
  const off = budgetStopped(await readMuxBudget().catch(() => null));
  for (const v of off ? [] : videos) {
    if (sent >= SEND_PER_RUN || Date.now() > deadline) break;
    if (map[v.id]) continue;
    if (stored() + (v.ms ?? 60_000) / 60_000 > maxMinutes()) break;
    const url = v.src();
    if (!url) continue;
    const asset = await mux<{ id: string; playback_ids?: Array<{ id: string; policy: string }> }>('/video/v1/assets', {
      method: 'POST',
      body: JSON.stringify({ inputs: [{ url }], playback_policies: ['signed'], video_quality: 'basic', passthrough: v.id }),
    }).catch((err) => { console.warn('[mux] create failed', v.id, (err as Error).message); return null; });
    if (!asset) continue;
    map[v.id] = { a: asset.id, s: 'preparing', p: asset.playback_ids?.find((x) => x.policy === 'signed')?.id, d: v.ms ? Math.round(v.ms / 1000) : undefined };
    sent++; dirty = true;
  }
  if (dirty) await writeMuxMap(map);
  const all = Object.values(map);
  return { sent, ready: all.filter((e) => e.s === 'ready').length, preparing: all.filter((e) => e.s === 'preparing').length, errored: all.filter((e) => e.s === 'errored').length, minutes: Math.round(stored()) };
}

export async function readMuxBudget(): Promise<MuxBudget | null> {
  const { data } = await createServerClient().storage.from(BUCKET).download(BUDGET_PATH);
  if (!data) return null;
  try { return JSON.parse(await data.text()) as MuxBudget; } catch { return null; }
}

/** Whether the copies are off for this month. A last month's stop has expired. */
export function budgetStopped(b: MuxBudget | null, now = Date.now()): boolean {
  return !!b?.stopped && b.month === new Date(now).toISOString().slice(0, 7);
}

/** What one check means: the stage it reached and whether that is new (so it is told once). */
export function budgetStage(prev: MuxBudget | null, month: string, minutes: number): { warn: boolean; stop: boolean; next: Omit<MuxBudget, 'checkedAt'> } {
  const same = prev?.month === month;
  const warned = (same && !!prev?.warned) || minutes >= FREE_DELIVERY_MINUTES * WARN_AT;
  const stopped = (same && !!prev?.stopped) || minutes >= FREE_DELIVERY_MINUTES * STOP_AT;
  return {
    warn: warned && !(same && prev?.warned),
    stop: stopped && !(same && prev?.stopped),
    next: { month, minutes, warned, stopped },
  };
}

/**
 * Ask Mux how many minutes it delivered this month (every BUDGET_EVERY_MS at most) and
 * record the stage. Returns what is newly reached, for the cron to tell; null when it
 * didn't check (too soon, or Mux didn't answer — then nothing changes).
 */
export async function checkMuxBudget(now = Date.now()): Promise<{ minutes: number; warn: boolean; stop: boolean; first: boolean } | null> {
  const prev = await readMuxBudget();
  if (prev && now - Date.parse(prev.checkedAt) < BUDGET_EVERY_MS && prev.month === new Date(now).toISOString().slice(0, 7)) return null;
  const d = new Date(now);
  const month = d.toISOString().slice(0, 7);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  // Mux reports only up to 12 hours ago, on the hour.
  const end = Math.floor((now / 1000 - 13 * 3600) / 3600) * 3600;
  let seconds = 0;
  if (end > start) {
    for (let page = 1; page <= 50; page++) {
      const res = await fetch(`${API}/video/v1/delivery-usage?timeframe[]=${start}&timeframe[]=${end}&limit=100&page=${page}`, { headers: { Authorization: auth() } }).catch(() => null);
      if (!res?.ok) { console.warn('[mux] budget check failed', res?.status); return null; }
      const rows = ((await res.json()).data ?? []) as Array<{ delivered_seconds?: number }>;
      seconds += rows.reduce((a, r) => a + (r.delivered_seconds ?? 0), 0);
      if (rows.length < 100) break;
    }
  }
  const minutes = Math.round(seconds / 60);
  const { warn, stop, next } = budgetStage(prev, month, minutes);
  await createServerClient().storage.from(BUCKET).upload(BUDGET_PATH, JSON.stringify({ ...next, checkedAt: new Date(now).toISOString() }), { contentType: 'application/json', upsert: true });
  // `first`: the guard's very first check — the cron says it is on (and that is the test that alerts arrive).
  return { minutes, warn, stop, first: !prev };
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/**
 * A playback link for one copy: a JWT signed with the club's Mux signing key (RS256), for
 * `aud` 'v' (the video) or 't' (a still) / 'g' (an animated preview), lasting a few hours.
 */
export function signMux(playbackId: string, aud: 'v' | 't' | 'g', extra: Record<string, unknown> = {}, now = Date.now()): string | null {
  const kid = process.env.MUX_SIGNING_KEY_ID;
  const pem = process.env.MUX_SIGNING_KEY_PRIVATE ? Buffer.from(process.env.MUX_SIGNING_KEY_PRIVATE, 'base64').toString('utf8') : null;
  if (!kid || !pem) return null;
  // Rounded up to the hour, so the same video keeps the same link for a while (browser cache).
  const exp = Math.ceil((Math.floor(now / 1000) + PLAY_TTL_S) / 3600) * 3600;
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = b64u(JSON.stringify({ sub: playbackId, aud, exp, ...extra }));
  try {
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(pem);
    return `${head}.${body}.${b64u(sig)}`;
  } catch { return null; }
}

/**
 * The copy's HLS link, signed; null when the video has no ready copy (the original plays).
 * Never under 720p: an iPhone plays this list itself and opens on its first entry, which
 * was 360p, so every video began blurred (measured 10-23). 720p starts fast and climbs.
 */
export function muxHls(entry: MuxEntry | undefined): string | null {
  if (!entry?.p || entry.s !== 'ready') return null;
  const token = signMux(entry.p, 'v', { min_resolution: '720p' });
  return token ? `https://stream.mux.com/${entry.p}.m3u8?token=${token}` : null;
}

/**
 * The copy's first frame as the poster (aud 't'): sharp, from Mux's CDN, and the very frame
 * playback starts on, so nothing jumps when it begins. (A moving preview was tried first:
 * Mux makes those 640px at most, and full screen it read as low quality.)
 */
export function muxPoster(entry: MuxEntry | undefined): string | null {
  if (!entry?.p || entry.s !== 'ready') return null;
  const token = signMux(entry.p, 't', { width: 1080, time: 0 });
  return token ? `https://image.mux.com/${entry.p}/thumbnail.webp?token=${token}` : null;
}

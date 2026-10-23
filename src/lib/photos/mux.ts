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
/** Sent per run: Mux ingests in parallel, and a run must leave time for the rest. */
const SEND_PER_RUN = 15;
/** A ceiling on what is stored (minutes), so a mistake can't run the bill up. Read per run. */
const maxMinutes = () => Number(process.env.MUX_MAX_MINUTES || 3000);
const PLAY_TTL_S = 6 * 3600;

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
  // The ones Mux is still making.
  for (const [id, e] of Object.entries(map)) {
    if (Date.now() > deadline) break;
    if (e.s !== 'preparing') continue;
    const asset = await mux<{ status: string; duration?: number; playback_ids?: Array<{ id: string; policy: string }> }>(`/video/v1/assets/${e.a}`).catch(() => null);
    if (!asset) continue;
    const p = asset.playback_ids?.find((x) => x.policy === 'signed')?.id;
    if (asset.status !== e.s || p !== e.p) { map[id] = { ...e, s: asset.status, p, d: asset.duration ? Math.round(asset.duration) : e.d }; dirty = true; }
  }
  // The next ones, under the ceiling.
  const stored = () => Object.values(map).reduce((a, e) => a + (e.d ?? 0), 0) / 60;
  let sent = 0;
  for (const v of videos) {
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
 * Never under 720p: a phone with no history of the network otherwise opens on 360p and
 * climbs, so every video began blurred (measured 10-23) — an iPhone plays this list itself.
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

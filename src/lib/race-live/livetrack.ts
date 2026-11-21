// ═════════════════════════════════════════════════════════════════════════════
// Garmin LiveTrack → race splits. Garmin publishes NO LiveTrack API; this reads the same
// internal JSON the livetrack.garmin.com page reads for anyone holding the runner's link
// (verified by a community integration 2026-10-17, appstrate#2064), and only for links the runner
// gave us. Undocumented → may change without notice. Gentle: one runner every ≥2 min, stops at
// finish / session end, links deleted 24 h after the race.
//
//   personal link  https://livetrack.garmin.com/<name>          (set the evening before; resolves
//                                                                to the ACTIVE session once running)
//   session link   https://livetrack.garmin.com/session/<id>/token/<token>   (sent at start)
//
// Track points carry position + time (+ speed), NOT a distance — distance is summed from GPS,
// which, like the watch, runs a little long over a marathon. So a LiveTrack split is "by the
// watch": staff's official chip time overrides it (SOURCE_RANK).
// ═════════════════════════════════════════════════════════════════════════════

import { POINT_KEYS, POINT_M, RACE_M, type Split } from './core';

export const LT_HOST = 'livetrack.garmin.com';
export const LIVETRACK_POLL_SEC = 120;

export type LiveTrackLink =
  | { kind: 'session'; sessionId: string; token: string }
  | { kind: 'personal'; name: string };

/** Accept what a runner pastes (with or without scheme, query, trailing slash). Anything else: null. */
export function parseLiveTrackUrl(input: unknown): LiveTrackLink | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().match(/https?:\/\/\S+|livetrack\.garmin\.com\S*/i)?.[0];
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw.startsWith('http') ? raw : `https://${raw}`); } catch { return null; }
  if (u.hostname.toLowerCase() !== LT_HOST) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'session' && parts[2] === 'token' && /^[\w-]{8,}$/.test(parts[1] ?? '') && /^[\w-]{8,}$/.test(parts[3] ?? '')) {
    return { kind: 'session', sessionId: parts[1], token: parts[3] };
  }
  if (parts.length === 1 && /^[\w.-]{2,64}$/.test(parts[0]) && parts[0] !== 'session') return { kind: 'personal', name: parts[0] };
  return null;
}

export function linkToUrl(l: LiveTrackLink): string {
  return l.kind === 'session' ? `https://${LT_HOST}/session/${l.sessionId}/token/${l.token}` : `https://${LT_HOST}/${l.name}`;
}

export interface TrackPoint { t: number; lat: number; lon: number }

/** Garmin's shape: { trackPoints: [{ dateTime, position: { lat, lon } }] }. Bad rows are skipped. */
export function parseTrackPoints(body: unknown): TrackPoint[] {
  const list = (body as { trackPoints?: unknown[] } | null)?.trackPoints;
  if (!Array.isArray(list)) return [];
  const out: TrackPoint[] = [];
  for (const p of list as any[]) {
    const t = Date.parse(p?.dateTime ?? p?.reportedTime ?? '');
    const lat = Number(p?.position?.lat), lon = Number(p?.position?.lon);
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    out.push({ t, lat, lon });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface Progress {
  distanceM: number;
  elapsedSec: number;
  last: TrackPoint | null;
  /** Cumulative [elapsedSec, distanceM] after each point — what splits are interpolated from. */
  curve: [number, number][];
}

/**
 * Sum the GPS track. A jump implying > 12 m/s (43 km/h — no marathoner) is a GPS spike and adds
 * nothing; it is not dropped from the time axis, so the next good point resumes from it.
 */
export function trackProgress(points: TrackPoint[]): Progress {
  if (!points.length) return { distanceM: 0, elapsedSec: 0, last: null, curve: [] };
  const t0 = points[0].t;
  let d = 0;
  const curve: [number, number][] = [[0, 0]];
  for (let i = 1; i < points.length; i++) {
    const step = haversineM(points[i - 1], points[i]);
    const dt = (points[i].t - points[i - 1].t) / 1000;
    if (dt > 0 && step / dt <= 12) d += step;
    curve.push([Math.round((points[i].t - t0) / 1000), d]);
  }
  const last = points[points.length - 1];
  return { distanceM: d, elapsedSec: Math.round((last.t - t0) / 1000), last, curve };
}

/**
 * Splits from a track: each course point the GPS distance has passed, time interpolated at the
 * crossing. 'finish' only when the session ENDED with ≥ 41 km — GPS reaches 42.195 a minute or
 * two before the real line, and a runner still moving hasn't finished; the finish time is the last
 * point (the watch stopped after the line). Staff's chip time replaces it.
 */
export function progressToSplits(p: Progress, opts: { ended: boolean }): Split[] {
  if (!p.curve.length) return [];
  const out: Split[] = [{ point: 'start', elapsedSec: 0 }];
  for (const key of POINT_KEYS) {
    if (key === 'start' || key === 'finish') continue;
    const target = POINT_M[key];
    if (p.distanceM < target) break;
    const i = p.curve.findIndex(([, d]) => d >= target);
    const [t1, d1] = p.curve[i];
    const [t0, d0] = p.curve[Math.max(0, i - 1)];
    const t = d1 === d0 ? t1 : t0 + ((target - d0) / (d1 - d0)) * (t1 - t0);
    out.push({ point: key, elapsedSec: Math.round(t) });
  }
  if (opts.ended && p.distanceM >= RACE_M - 1195) out.push({ point: 'finish', elapsedSec: p.elapsedSec });
  return out;
}

// ─── network: the page's own CSRF double-submit, one runner at a time ─────────────

type Fetch = typeof fetch;
const UA = 'club-race-tracker/1.0';

async function csrfSession(fetcher: Fetch, pageUrl: string): Promise<{ cookie: string; token: string }> {
  const res = await fetcher(pageUrl, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!res.ok) throw new LiveTrackError(res.status === 404 ? 'not_found' : res.status === 403 || res.status === 429 ? 'refused' : 'unreachable');
  const html = await res.text();
  const token = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)/i)?.[1] ?? '';
  const setCookie = (res.headers as any).getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
  const cookie = (setCookie as string[]).map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  return { cookie, token };
}

export class LiveTrackError extends Error {
  constructor(public code: 'not_found' | 'refused' | 'unreachable' | 'passcode' | 'no_session' | 'expired') { super(code); }
}

async function getJson(fetcher: Fetch, url: string, csrf: { cookie: string; token: string }): Promise<any> {
  const res = await fetcher(url, {
    headers: { 'user-agent': UA, accept: 'application/json', cookie: csrf.cookie, 'livetrack-csrf-token': csrf.token },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (res.status === 404 || res.status === 410) throw new LiveTrackError('expired');
  if (res.status === 403 || res.status === 429) throw new LiveTrackError('refused');
  if (!res.ok) throw new LiveTrackError('unreachable');
  return res.json();
}

export interface SessionRead { sessionId: string; points: TrackPoint[]; ended: boolean }

/** Resolve a link to its current session's points. A personal link with no active session → no_session. */
export async function readLiveTrack(link: LiveTrackLink, fetcher: Fetch = fetch): Promise<SessionRead> {
  const csrf = await csrfSession(fetcher, linkToUrl(link));
  let sessionId: string, token: string, ended = false;
  if (link.kind === 'personal') {
    const user = await getJson(fetcher, `https://${LT_HOST}/api/personal-url/${encodeURIComponent(link.name)}/user`, csrf);
    if (user?.isPasscodeRequired) throw new LiveTrackError('passcode');
    if (!user?.garminGuid) throw new LiveTrackError('not_found');
    const s = await getJson(fetcher, `https://${LT_HOST}/api/v2/user/${encodeURIComponent(user.garminGuid)}/profile-sessions`, csrf);
    const active = (s?.activeSessions ?? [])[0];
    const done = (s?.completedSessions ?? [])[0];
    const pick = active ?? done;
    if (!pick?.sessionId || !pick?.sessionToken) throw new LiveTrackError('no_session');
    ({ sessionId, sessionToken: token } = pick);
    ended = !active;
  } else {
    ({ sessionId, token } = link);
  }
  const body = await getJson(fetcher, `https://${LT_HOST}/api/sessions/${encodeURIComponent(sessionId)}/track-points/common?token=${encodeURIComponent(token)}`, csrf);
  if (body?.sessionEnd || body?.ended === true) ended = true;
  return { sessionId, points: parseTrackPoints(body), ended };
}

/** The evening-before check: is this link one we can read? Never returns points. */
export async function testLiveTrack(link: LiveTrackLink, fetcher: Fetch = fetch): Promise<{ ok: true; state: 'ready' | 'active' } | { ok: false; code: LiveTrackError['code'] }> {
  try {
    if (link.kind === 'personal') {
      const csrf = await csrfSession(fetcher, linkToUrl(link));
      const user = await getJson(fetcher, `https://${LT_HOST}/api/personal-url/${encodeURIComponent(link.name)}/user`, csrf);
      if (user?.isPasscodeRequired) return { ok: false, code: 'passcode' };
      if (!user?.garminGuid) return { ok: false, code: 'not_found' };
      return { ok: true, state: 'ready' };
    }
    const r = await readLiveTrack(link, fetcher);
    return { ok: true, state: r.ended ? 'ready' : 'active' };
  } catch (e) {
    return { ok: false, code: e instanceof LiveTrackError ? e.code : 'unreachable' };
  }
}

/** A session with no new point for this long counts as ended (runner stopped the watch). */
export const IDLE_END_SEC = 300;
export function sessionLooksEnded(r: SessionRead, nowMs: number): boolean {
  const last = r.points[r.points.length - 1];
  return r.ended || (!!last && (nowMs - last.t) / 1000 >= IDLE_END_SEC);
}

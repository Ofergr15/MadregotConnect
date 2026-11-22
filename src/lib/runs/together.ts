/**
 * Run together v3 (migration 190) — the rules, pure and clock-free.
 *
 * Meeting point + time is a location disclosure. The rule this file exists to hold:
 * the EXACT place (name, lat/lng) reaches only the host and the people who joined.
 * Everybody else who may see the run gets an area label and a jittered centre, and
 * the stripping happens here, before serialisation — never "sent and hidden in UI".
 */

export type Visibility = 'club' | 'squad' | 'private';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'waitlist' | 'left';

export interface RunAccessFacts {
  hostId: string;
  visibility: Visibility;
  squadId: string | null;
  /** Accepted joiners. */
  joinedIds: string[];
  invitedIds: string[];
}
export interface Viewer { id: string; groupId: string | null }

/** Who may see a run at all (list + detail + join). */
export function canSeeRun(r: RunAccessFacts, v: Viewer | null): boolean {
  if (!v) return false;
  if (v.id === r.hostId || r.joinedIds.includes(v.id) || r.invitedIds.includes(v.id)) return true;
  if (r.visibility === 'club') return true;
  if (r.visibility === 'squad') return !!r.squadId && v.groupId === r.squadId;
  return false;
}

/** Who may see the exact meeting point, directions and chat: host + accepted joiners. */
export function canSeeExact(r: Pick<RunAccessFacts, 'hostId' | 'joinedIds'>, viewerId: string | null): boolean {
  return !!viewerId && (viewerId === r.hostId || r.joinedIds.includes(viewerId));
}

export interface PlaceFacts {
  location: string;
  lat: number | null;
  lng: number | null;
  areaLabel: string | null;
  areaLat: number | null;
  areaLng: number | null;
}
export interface ProjectedPlace {
  area: { label: string; lat: number | null; lng: number | null; radiusM: number };
  /** Only present for host + joiners. */
  exact: { name: string; lat: number | null; lng: number | null } | null;
}

export const AREA_RADIUS_M = 400;

/** The place as one viewer may receive it. */
export function projectPlace(p: PlaceFacts, exactAllowed: boolean): ProjectedPlace {
  return {
    area: { label: p.areaLabel || 'אזור המפגש', lat: p.areaLat, lng: p.areaLng, radiusM: AREA_RADIUS_M },
    exact: exactAllowed ? { name: p.location, lat: p.lat, lng: p.lng } : null,
  };
}

/**
 * A jittered area centre for a custom pin: deterministic from the run id (so reloads
 * don't let anyone average the circle back to the point), 120–250 m off the pin, then
 * rounded to 3 decimals (~100 m). Always inside the 400 m circle so the circle still
 * contains the real point.
 */
export function jitterArea(lat: number, lng: number, seed: string): { lat: number; lng: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const angle = ((h % 3600) / 3600) * 2 * Math.PI;
  const dist = 120 + ((h >>> 12) % 130);
  const dLat = (dist * Math.cos(angle)) / 111_320;
  const dLng = (dist * Math.sin(angle)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return { lat: r3(lat + dLat), lng: r3(lng + dLng) };
}

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const HOME_WARNING_M = 300;

/**
 * The host's most frequent start point: the densest ~150 m cluster of their recent
 * run starts, needing 3+ starts to say anything. Used only to WARN the host — it is
 * never returned.
 */
export function frequentStart(starts: Array<{ lat: number; lng: number }>): { lat: number; lng: number } | null {
  let best: { lat: number; lng: number } | null = null, bestN = 0;
  for (const s of starts) {
    const near = starts.filter((t) => distanceM(s, t) <= 150);
    if (near.length > bestN) {
      bestN = near.length;
      best = { lat: near.reduce((a, t) => a + t.lat, 0) / near.length, lng: near.reduce((a, t) => a + t.lng, 0) / near.length };
    }
  }
  return bestN >= 3 ? best : null;
}

/** True when a custom pin is within ~300 m of where the host usually starts (probably home). */
export function homeProximityWarning(pin: { lat: number; lng: number }, starts: Array<{ lat: number; lng: number }>): boolean {
  const home = frequentStart(starts);
  return !!home && distanceM(pin, home) < HOME_WARNING_M;
}

/** What a join request becomes. Private runs wait on the host; full runs waitlist. */
export function decideJoin(p: { visibility: Visibility; capacity: number | null; acceptedCount: number }): 'accepted' | 'pending' | 'waitlist' {
  if (p.visibility === 'private') return 'pending';
  // The host occupies a place too.
  if (p.capacity != null && p.acceptedCount + 1 >= p.capacity) return 'waitlist';
  return 'accepted';
}

/** After someone leaves: the first waitlister by queue order, if a place opened. */
export function nextFromWaitlist(
  rows: Array<{ athleteId: string; status: RequestStatus; createdAt: string }>,
  capacity: number | null,
): string | null {
  const accepted = rows.filter((r) => r.status === 'accepted').length;
  if (capacity != null && accepted + 1 >= capacity) return null;
  const q = rows.filter((r) => r.status === 'waitlist').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return q[0]?.athleteId ?? null;
}

export interface FanoutAthlete { id: string; groupId: string | null; paceSec: number | null }

/**
 * Who hears about a new run:
 * - private → the invited only;
 * - squad   → that squad;
 * - club    → only squads whose typical pace falls inside the run's band (±20 s);
 *             without a band (or no squad pace), the host's squad only. Never the whole club.
 */
export function createFanout(p: {
  visibility: Visibility; squadId: string | null; hostId: string; invitedIds: string[];
  athletes: FanoutAthlete[]; band: { min: number; max: number } | null;
}): string[] {
  const others = p.athletes.filter((a) => a.id !== p.hostId);
  if (p.visibility === 'private') return p.invitedIds.filter((id) => id !== p.hostId);
  if (p.visibility === 'squad') return others.filter((a) => !!p.squadId && a.groupId === p.squadId).map((a) => a.id);
  const hostGroup = p.athletes.find((a) => a.id === p.hostId)?.groupId ?? null;
  const squads = new Set<string>();
  if (p.band) {
    const byGroup = new Map<string, number[]>();
    for (const a of p.athletes) if (a.groupId && a.paceSec) byGroup.set(a.groupId, [...(byGroup.get(a.groupId) || []), a.paceSec]);
    for (const [g, paces] of byGroup) {
      const s = [...paces].sort((x, y) => x - y)[Math.floor(paces.length / 2)];
      if (s >= p.band.min - 20 && s <= p.band.max + 20) squads.add(g);
    }
  }
  if (!squads.size && hostGroup) squads.add(hostGroup);
  return others.filter((a) => a.groupId && squads.has(a.groupId)).map((a) => a.id);
}

/** Who hears about a time change / cancel: everyone going or waiting, never the host. */
export function changeFanout(p: { hostId: string; rows: Array<{ athleteId: string; status: RequestStatus }> }): string[] {
  return [...new Set(p.rows.filter((r) => r.status === 'accepted' || r.status === 'waitlist').map((r) => r.athleteId))]
    .filter((id) => id !== p.hostId);
}

/** Minutes since midnight for "HH:MM". */
export function clockMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** T−60 window on the 5-minute tick: fire once when the run is 55–65 min away (Israel wall clock). */
export function inSoonWindow(run: { date: string; startTime: string }, now: { date: string; minute: number }): boolean {
  if (run.date !== now.date) return false;
  const until = clockMin(run.startTime) - now.minute;
  return until >= 50 && until <= 65;
}

/** Chat is purged 24 h after the run's start. True when this run's chat should go. */
export function chatExpired(run: { date: string; startTime: string }, now: { date: string; minute: number }): boolean {
  const day = (d: string) => Math.round(Date.parse(`${d}T12:00:00Z`) / 86_400_000);
  const runAt = day(run.date) * 1440 + clockMin(run.startTime);
  const nowAt = day(now.date) * 1440 + now.minute;
  return nowAt - runAt >= 24 * 60;
}

/**
 * Which joiners' activities were THIS run: same date, start within ±30 min of the
 * meetup time, start point within ~1 km of the spot. `start_time` is wall-clock
 * shaped (CLAUDE.md "UTC-shaped, not UTC"), so its HH:MM is compared directly.
 */
export function matchGroupActivities(
  m: { date: string; startTime: string; lat: number | null; lng: number | null; goingIds: string[] },
  acts: Array<{ id: string; athleteId: string; startTime: string; startLat: number | null; startLng: number | null }>,
): Array<{ activityId: string; athleteId: string }> {
  const target = clockMin(m.startTime);
  const out: Array<{ activityId: string; athleteId: string }> = [];
  const seen = new Set<string>();
  for (const a of acts) {
    if (!m.goingIds.includes(a.athleteId) || seen.has(a.athleteId)) continue;
    if (a.startTime.slice(0, 10) !== m.date) continue;
    if (Math.abs(clockMin(a.startTime.slice(11, 16)) - target) > 30) continue;
    if (m.lat != null && m.lng != null) {
      if (a.startLat == null || a.startLng == null) continue;
      if (distanceM({ lat: m.lat, lng: m.lng }, { lat: a.startLat, lng: a.startLng }) > 1000) continue;
    }
    seen.add(a.athleteId);
    out.push({ activityId: a.id, athleteId: a.athleteId });
  }
  return out;
}

/** "near me": coarse order by distance to the AREA centre. Never echoes the viewer's point. */
export function sortNear<T extends { place: { area: { lat: number | null; lng: number | null } } }>(runs: T[], at: { lat: number; lng: number }): T[] {
  const d = ({ place: { area } }: T) => (area.lat == null || area.lng == null ? Infinity : distanceM(at, { lat: area.lat, lng: area.lng }));
  return [...runs].sort((a, b) => d(a) - d(b));
}

export function parseVisibility(v: unknown, legacyAudience?: unknown): Visibility {
  if (v === 'club' || v === 'squad' || v === 'private') return v;
  return legacyAudience === 'pack' ? 'squad' : 'club';
}

export interface GroupRunRow { athleteId: string; name: string; avatarUrl: string | null; activityId: string; km: number; pace: string | null; isMe: boolean }
export interface GroupRunCardT { meetupId: string; date: string; startTime: string; areaLabel: string | null; planLinked: boolean; count: number; runners: GroupRunRow[] }

/**
 * The feed's "ריצה משותפת · N רצים" card. Pure so its two privacy rules are pinned:
 * a hidden pace is null (not computed and dropped later), and there is no accuracy field
 * at all — the type has nowhere to put one.
 */
export function groupRunCard(p: {
  meetup: { id: string; date: string; startTime: string; areaLabel: string | null; planLinked: boolean };
  runs: Array<{ activityId: string; athleteId: string; distanceM: number; durationS: number; paceHidden: boolean }>;
  people: Map<string, { name: string; avatarUrl: string | null }>;
  viewerId: string | null;
}): GroupRunCardT | null {
  if (p.runs.length < 2) return null;
  const runners = p.runs.map((r) => {
    const sec = r.distanceM > 0 ? r.durationS / (r.distanceM / 1000) : 0;
    return {
      athleteId: r.athleteId, name: p.people.get(r.athleteId)?.name || '', avatarUrl: p.people.get(r.athleteId)?.avatarUrl ?? null,
      activityId: r.activityId, km: Math.round(r.distanceM / 100) / 10,
      pace: r.paceHidden || !sec ? null : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60) % 60).padStart(2, '0')}`,
      isMe: r.athleteId === p.viewerId,
    };
  }).sort((a, b) => Number(a.isMe) - Number(b.isMe) || b.km - a.km);
  return { meetupId: p.meetup.id, date: p.meetup.date, startTime: p.meetup.startTime, areaLabel: p.meetup.areaLabel, planLinked: p.meetup.planLinked, count: runners.length, runners };
}

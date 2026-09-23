// Server half of the pack stories: turns the session's raw rows into the runs
// the screen works with. Pure, so the pack/duplicate rules are testable.

import { normalizeStoredLaps } from '@/lib/garmin/laps';
import { resolveGroup } from '@/lib/utils';
import { sessionLabel, type Pack, type PackRun, type PackSession } from './model';

export interface ActivityRow {
  id: string;
  athlete_id: string;
  start_time: string;
  distance: number | null;
  duration: number | null;
  average_pace: number | null;
  average_hr: number | null;
  laps: unknown;
  gps_points: Array<{ lat: number; lng: number }> | null;
}
export interface AttendanceRow { athlete_id: string; group_label: string | null }
export interface AthleteRow { id: string; name: string | null; group_id: string | null }
export interface GroupRow { id: string; name: string | null }

/** Anything shorter is a warm-up stub or a watch left running, not the session. */
const MIN_RUN_METERS = 1000;

/** "דבוקה 2" / "Pack 2" → 2. */
function rsvpPack(label: string | null | undefined): 0 | Pack {
  const m = /([123])/.exec(label || '');
  return m ? (Number(m[1]) as Pack) : 0;
}

/**
 * GPS points → a trace normalised to 0..1 on its longer side, north up.
 * Points closer than 1/1500 of the extent are dropped: invisible at story size,
 * and it keeps a 20 km run to a few hundred points on the wire.
 */
export function normaliseRoute(points: Array<{ lat: number; lng: number }> | null | undefined): Array<[number, number]> | null {
  const pts = (points || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.lat || p.lng));
  if (pts.length < 2) return null;
  const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map(p => p.lng * k), ys = pts.map(p => -p.lat);
  const mnx = Math.min(...xs), mny = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - mnx, Math.max(...ys) - mny);
  if (!span) return null;
  const minStep = 1 / 1500;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i++) {
    const q: [number, number] = [(xs[i] - mnx) / span, (ys[i] - mny) / span];
    const last = out[out.length - 1];
    if (last && i < pts.length - 1 && Math.hypot(q[0] - last[0], q[1] - last[1]) < minStep) continue;
    out.push([Math.round(q[0] * 1e4) / 1e4, Math.round(q[1] * 1e4) / 1e4]);
  }
  return out.length >= 2 ? out : null;
}

export function buildSession(
  date: string,
  activities: ActivityRow[],
  attendance: AttendanceRow[],
  athletes: AthleteRow[],
  groups: GroupRow[],
): PackSession {
  const ath = new Map(athletes.map(a => [a.id, a]));
  const grp = new Map(groups.map(g => [g.id, g.name]));
  const rsvp = new Map(attendance.map(r => [r.athlete_id, r.group_label]));
  const homePack = (aid: string): 0 | Pack => {
    const i = resolveGroup(grp.get(ath.get(aid)?.group_id || '') || '').index;
    return i >= 0 ? ((i + 1) as Pack) : 0;
  };

  const runs: PackRun[] = [];
  for (const r of activities) {
    if (!r.distance || r.distance < MIN_RUN_METERS) continue;
    let pack = rsvpPack(rsvp.get(r.athlete_id));
    let src: PackRun['src'] = 'rsvp';
    if (!pack) { pack = homePack(r.athlete_id); src = pack ? 'home' : 'none'; }
    runs.push({
      id: r.id,
      name: ath.get(r.athlete_id)?.name || '?',
      pack, src, dup: false,
      // start_time holds local wall-clock time labelled +00:00, so the digits are already local.
      start: r.start_time.slice(11, 16),
      dist: Math.round(r.distance),
      dur: Math.round(r.duration || 0),
      pace: Math.round(r.average_pace || 0),
      hr: r.average_hr ?? null,
      laps: normalizeStoredLaps(r.laps)
        .filter(l => l.distance > 0)
        .map(l => [Math.round(l.distance), Math.round(l.duration)] as [number, number]),
      route: normaliseRoute(r.gps_points),
    });
  }

  // One run synced onto two profiles (same start minute, same distance). Keep the
  // twin that has a pack, so the duplicate never shows up as "unassigned".
  const byKey = new Map<string, PackRun[]>();
  for (const r of runs) {
    const key = `${r.start}|${r.dist}`;
    byKey.set(key, [...(byKey.get(key) || []), r]);
  }
  for (const twins of byKey.values()) {
    if (twins.length < 2) continue;
    const keep = twins.find(t => t.pack) || twins[0];
    for (const t of twins) if (t !== keep) t.dup = true;
  }

  runs.sort((a, b) => a.start.localeCompare(b.start));
  return { date, label: sessionLabel(date), runs };
}

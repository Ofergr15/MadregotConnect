import { sameClock } from '@/lib/activity-dedup';

/**
 * One run recorded twice — the Garmin activity and its Strava copy — that slipped past
 * the ingest dedupe (lib/activity-dedup.ts; older rows predate it). Counted twice, the
 * week's ⚡ and km double for that run (screen 2's tile 115 against the bar's 171).
 *
 * Read-time rule, deliberately the ingest's own shape: the same start within 10 minutes
 * and the same distance within 15%, or the same wall clock (`sameClock`, a treadmill run
 * whose two distances disagree). Reps logged as separate activities can start minutes
 * apart with the same distance, but they never share the clock, so the distance rule also
 * needs the two recordings to overlap.
 *
 * The copy kept is the richer source: Garmin, then Apple, then manual, then Strava.
 */

export const TWIN_START_MS = 10 * 60 * 1000;
export const TWIN_DISTANCE = 0.15;

export interface TwinCandidate {
  id: string;
  start_time: string;
  distance?: number | null;
  duration?: number | null;
  source?: string | null;
}

const RANK: Record<string, number> = { garmin: 0, apple: 1, manual: 2, strava: 3 };
const rank = (s: string | null | undefined) => RANK[String(s ?? 'garmin')] ?? 1;
const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);

function overlapShare(a: TwinCandidate, b: TwinCandidate): number {
  const da = Number(a.duration) || 0;
  const db = Number(b.duration) || 0;
  if (!(da > 0) || !(db > 0)) return 1; // no durations: start and distance must decide
  const sa = ms(a.start_time);
  const sb = ms(b.start_time);
  const overlap = Math.min(sa + da * 1000, sb + db * 1000) - Math.max(sa, sb);
  return overlap > 0 ? overlap / (Math.min(da, db) * 1000) : 0;
}

export function areTwins(a: TwinCandidate, b: TwinCandidate): boolean {
  if (a.id === b.id) return false;
  const sa = ms(a.start_time);
  const sb = ms(b.start_time);
  if (!Number.isFinite(sa) || !Number.isFinite(sb)) return false;
  if (sameClock(sa, a.duration, sb, b.duration)) return true;
  if (Math.abs(sa - sb) > TWIN_START_MS) return false;
  const da = Number(a.distance) || 0;
  const db = Number(b.distance) || 0;
  if (!(da > 0) || !(db > 0)) return false;
  if (Math.abs(da - db) / Math.max(da, db) > TWIN_DISTANCE) return false;
  return overlapShare(a, b) >= 0.8;
}

/** The ids of the copies to drop (each twin pair keeps its richer source). */
export function twinIds(acts: TwinCandidate[]): Set<string> {
  const out = new Set<string>();
  const sorted = [...acts].sort((a, b) => ms(a.start_time) - ms(b.start_time));
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    if (out.has(a.id)) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      if (ms(b.start_time) - ms(a.start_time) > TWIN_START_MS + 2 * 60 * 1000) break;
      if (out.has(b.id) || !areTwins(a, b)) continue;
      const drop = rank(a.source) <= rank(b.source) ? b : a;
      out.add(drop.id);
      if (drop === a) break;
    }
  }
  return out;
}

/** `acts` without the dropped copies. */
export function withoutTwins<T extends TwinCandidate>(acts: T[]): T[] {
  const drop = twinIds(acts);
  return drop.size ? acts.filter(a => !drop.has(a.id)) : acts;
}

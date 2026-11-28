/**
 * EVENT TIMES IN TWO ZONES (round 6, task 149 — Valencia 2–6.12.2026).
 *
 * `events.date` + `events.start_time` are a zoneless wall clock: "2026-12-06 08:15" means 08:15 AT
 * THE VENUE. For a club in Israel that was the same thing as Israel time — until the club flies to
 * Valencia: the departures (Wed–Fri 2–4.12) are Israel wall times at the airport, the race start is
 * 08:15 Spain time, and a phone that turns "08:15" into an instant in its own zone counts down to the
 * wrong hour (an hour early in Israel, or the departure an hour late from a phone already in Spain).
 *
 * `eventSchedule(row)` resolves the venue's zone and returns the absolute instant plus the wall clock
 * in the venue AND in Israel, so no client has to do zone math:
 *
 *   zone: row.time_zone (a valid IANA name, if the column ever exists) → the venue's coordinates
 *         (Israel / Spain boxes) → Asia/Jerusalem, the club's home ('default', so a client can tell)
 *
 * Wall → instant at a DST edge: a time that doesn't exist (the spring-forward gap) moves forward by
 * the gap, like every calendar app; a time that happens twice (fall back) is the FIRST one.
 * Pure: no clock, no DB.
 */

export const HOME_TZ = 'Asia/Jerusalem';
export const SPAIN_TZ = 'Europe/Madrid';

export type ZoneSource = 'event' | 'venue' | 'default';
export interface WallClock { date: string; time: string; /** 0 = Sunday … 6 = Saturday */ weekday: number }
export interface EventSchedule {
  starts_at: string;
  time_zone: string;
  time_zone_source: ZoneSource;
  venue: WallClock;
  israel: WallClock;
}

export interface ScheduleInput {
  date?: string | null;
  start_time?: string | null;
  lat?: number | null;
  lng?: number | null;
  time_zone?: string | null;
}

export function isIanaZone(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
}

// Coarse boxes, enough to tell the club's two zones apart. Spain = the mainland + the Balearics
// (Europe/Madrid); the Canaries (Atlantic/Canary, an hour behind) sit south of 36° and fall through.
const BOXES: { tz: string; lat: [number, number]; lng: [number, number] }[] = [
  { tz: HOME_TZ, lat: [29.4, 33.4], lng: [34.2, 35.95] },
  { tz: SPAIN_TZ, lat: [36.0, 43.9], lng: [-9.4, 4.4] },
];

export function resolveZone(row: ScheduleInput): { tz: string; source: ZoneSource } {
  if (isIanaZone(row.time_zone)) return { tz: row.time_zone, source: 'event' };
  const { lat, lng } = row;
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    const hit = BOXES.find((b) => lat >= b.lat[0] && lat <= b.lat[1] && lng >= b.lng[0] && lng <= b.lng[1]);
    if (hit) return { tz: hit.tz, source: 'venue' };
  }
  return { tz: HOME_TZ, source: 'default' };
}

// Intl formatters are costly to build and the list route formats every event: one per zone × shape.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, withWeekday: boolean): Intl.DateTimeFormat {
  const key = `${tz}|${withWeekday}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      ...(withWeekday ? { weekday: 'short' as const } : { second: '2-digit' as const }),
    });
    fmtCache.set(key, f);
  }
  return f;
}
const parts = (ms: number, tz: string, withWeekday: boolean) =>
  Object.fromEntries(fmt(tz, withWeekday).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));

/** The zone's offset from UTC at instant `ms`, in minutes (Madrid winter → +60). */
export function offsetMinutes(ms: number, tz: string): number {
  const p = parts(ms, tz, false);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** A wall clock in `tz` → the UTC instant (ms). Gap → shifted forward; overlap → the first. */
export function wallToUtc(date: string, time: string, tz: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!d || !t) return null;
  const [Y, M, D] = [+d[1], +d[2], +d[3]];
  const [h, m, s] = [+t[1], +t[2], +(t[3] ?? 0)];
  if (M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || m > 59 || s > 59) return null;
  const naive = Date.UTC(Y, M - 1, D, h, m, s);
  if (new Date(naive).getUTCDate() !== D) return null; // 2026-02-30
  // Two candidate offsets: the zone's offset a day before and a day after this wall time.
  const offA = offsetMinutes(naive - 86_400_000, tz);
  const offB = offsetMinutes(naive + 86_400_000, tz);
  const candidates = [...new Set([offA, offB])]
    .map((off) => naive - off * 60000)
    .filter((ms) => naive - offsetMinutes(ms, tz) * 60000 === ms)
    .sort((a, b) => a - b);
  if (candidates.length) return candidates[0]; // overlap → the earlier instant
  // In the gap: read it with the offset from BEFORE the jump, which lands after it (02:30 → 03:30).
  return naive - Math.min(offA, offB) * 60000;
}

export function wallClockIn(ms: number, tz: string): WallClock {
  const p = parts(ms, tz, true);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday };
}

/** Null for an all-day event (no start_time) or an unreadable date/time. */
export function eventSchedule(row: ScheduleInput): EventSchedule | null {
  if (!row.date || !row.start_time) return null;
  const { tz, source } = resolveZone(row);
  const ms = wallToUtc(row.date, String(row.start_time), tz);
  if (ms == null) return null;
  return {
    starts_at: new Date(ms).toISOString(),
    time_zone: tz,
    time_zone_source: source,
    venue: wallClockIn(ms, tz),
    israel: wallClockIn(ms, HOME_TZ),
  };
}

/** The API projection: the row as it was, plus `schedule`. */
export function withSchedule<T extends Record<string, unknown>>(row: T): T & { schedule: EventSchedule | null } {
  return { ...row, schedule: eventSchedule(row as ScheduleInput) };
}

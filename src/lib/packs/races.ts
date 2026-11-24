// ── Own races + race plans, pure shapes (b23, migration 217) ───────────────

export interface RaceRow {
  id: string; athlete_id: string; name: string; race_date: string; distance_m: number;
  goal_sec: number | null; created_by: string | null; coach_seen_at: string | null;
}
export interface Race {
  id: string; athleteId: string; name: string; date: string; distanceM: number;
  goalSec: number | null; createdBy: string | null; coachSeenAt: string | null; hasPlan: boolean;
}

export function toRace(r: RaceRow, hasPlan: boolean): Race {
  return {
    id: r.id, athleteId: r.athlete_id, name: r.name, date: r.race_date, distanceM: r.distance_m,
    goalSec: r.goal_sec, createdBy: r.created_by, coachSeenAt: r.coach_seen_at, hasPlan,
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const posInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** POST (all required) or PATCH (partial) body → DB columns, or an error field. */
export function parseRaceBody(b: any, partial: boolean): { ok: true; row: Record<string, unknown> } | { ok: false; field: string } {
  const row: Record<string, unknown> = {};
  if (b?.name !== undefined || !partial) {
    const name = typeof b?.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 200) return { ok: false, field: 'name' };
    row.name = name;
  }
  if (b?.date !== undefined || !partial) {
    if (typeof b?.date !== 'string' || !DATE.test(b.date)) return { ok: false, field: 'date' };
    row.race_date = b.date;
  }
  if (b?.distanceM !== undefined || !partial) {
    if (!posInt(b?.distanceM) || b.distanceM > 1_000_000) return { ok: false, field: 'distanceM' };
    row.distance_m = b.distanceM;
  }
  if (b?.goalSec !== undefined) {
    if (b.goalSec !== null && !posInt(b.goalSec)) return { ok: false, field: 'goalSec' };
    row.goal_sec = b.goalSec;
  } else if (!partial) row.goal_sec = null;
  return { ok: true, row };
}

export interface RacePlanInput {
  goalSec: number | null;
  segments: { toM: number; paceSec: number }[];
  fuel: { atM: number; kind: 'gel' | 'water' }[];
  note: string;
}

export function parseRacePlan(b: any): RacePlanInput | null {
  const goalSec = b?.goalSec ?? null;
  if (goalSec !== null && !posInt(goalSec)) return null;
  if (!Array.isArray(b?.segments) || !Array.isArray(b?.fuel ?? [])) return null;
  const segments = b.segments.map((s: any) => ({ toM: s?.toM, paceSec: s?.paceSec }));
  if (segments.some((s: any) => !posInt(s.toM) || !posInt(s.paceSec))) return null;
  const fuel = (b.fuel ?? []).map((f: any) => ({ atM: f?.atM, kind: f?.kind }));
  if (fuel.some((f: any) => !(typeof f.atM === 'number' && f.atM >= 0) || (f.kind !== 'gel' && f.kind !== 'water'))) return null;
  const note = typeof b?.note === 'string' ? b.note.slice(0, 4000) : '';
  return { goalSec, segments, fuel, note };
}

export type RaceSeat = 'self' | 'coach' | 'manager';

/**
 * Who is reading an athlete's own races. Starts from `mayActFor` (self or staff) and then
 * NARROWS staff: an ordinary coach reaches only the athletes they coach (`coachIds`, the
 * trainee's coaches from academy_trainee_coaches); the academy manager seat (admin,
 * academy_manager, super user — `isAcademyManager`) reaches everyone. Null = refuse.
 */
export function raceSeat(
  caller: { athleteId: string | null; isStaff: boolean; isSuperUser: boolean },
  isManager: boolean,
  athleteId: string,
  coachIds: string[],
): RaceSeat | null {
  if (caller.athleteId && caller.athleteId === athleteId) return 'self';
  if (!caller.isStaff && !caller.isSuperUser) return null; // mayActFor would refuse
  if (isManager) return 'manager';
  if (caller.athleteId && coachIds.includes(caller.athleteId)) return 'coach';
  return null;
}

/** The race plan is the coach's word: only a coach of the athlete or the manager seat writes it. */
export function mayWriteRacePlan(seat: RaceSeat | null): boolean {
  return seat === 'coach' || seat === 'manager';
}

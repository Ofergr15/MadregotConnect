// ── Pack attendance, pure (b23, migration 216) ──────────────────────────────
//
// Two sources: the watch (an activity whose start is within ±90 min of the session start)
// and the leader's mark. The leader's mark always wins; a stored watch row is overwritten by
// a fresh auto-mark only while nobody has marked by hand.
//
// `athlete_activities.start_time` is the athlete's wall clock stored as +00:00 (CLAUDE.md,
// "UTC-shaped, not UTC"), so it is compared to the session's Israel wall-clock time through
// `activityLocalDateStr` / `activityLocalMinutes` — never through `new Date().getHours()`.

import { activityLocalDateStr, activityLocalMinutes, addDaysToDateStr } from '@/lib/utils';

export const AUTO_MARK_WINDOW_MIN = 90;
/** No start time known for the session: the club's morning, as lib/attendance/real-server reads it. */
export const MORNING_FROM_MIN = 4 * 60;
export const MORNING_TO_MIN = 9 * 60;
/** The leader may edit until this hour (Israel) on the day after the session. */
export const EDIT_UNTIL_HOUR = 12;

export type AttendanceStatus = 'present' | 'absent';
export type AttendanceSource = 'watch' | 'leader';

/** Israel's UTC offset in minutes at an instant (120 or 180). */
function israelOffsetMin(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((wall - at.getTime()) / 60_000);
}

/** The real instant of an Israel wall-clock time on a date. */
export function israelWallInstant(date: string, hour: number, minute = 0): Date {
  const guess = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  const off = israelOffsetMin(new Date(guess.getTime() - 3 * 3_600_000));
  return new Date(guess.getTime() - off * 60_000);
}

/** Until when a session on `date` may be edited: 12:00 Israel the next day, as an ISO instant. */
export function editableUntil(date: string): string {
  return israelWallInstant(addDaysToDateStr(date, 1), EDIT_UNTIL_HOUR).toISOString();
}

export function isEditable(date: string, now: Date = new Date()): boolean {
  return now.getTime() <= Date.parse(editableUntil(date));
}

/** "06:30" / "06:30:00" → minutes since midnight; null when absent or malformed. */
export function parseTimeOfDay(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 24 * 60 ? v : null;
}

export interface ActivityLite { athleteId: string; startTime: string; distanceM: number | null }

/**
 * Who the watch puts at the session: athleteId → note ("06:12 · 12.4 ק״מ"). One activity is
 * enough; the closest to the start is the one named.
 */
export function autoMarks(date: string, sessionStartMin: number | null, activities: ActivityLite[]): Map<string, string> {
  const best = new Map<string, { gap: number; note: string }>();
  for (const a of activities) {
    if (!a.startTime || activityLocalDateStr(a.startTime) !== date) continue;
    const min = activityLocalMinutes(a.startTime);
    let gap: number;
    if (sessionStartMin == null) {
      if (min < MORNING_FROM_MIN || min >= MORNING_TO_MIN) continue;
      gap = 0;
    } else {
      gap = Math.abs(min - sessionStartMin);
      if (gap > AUTO_MARK_WINDOW_MIN) continue;
    }
    const hhmm = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    const km = a.distanceM ? ` · ${(a.distanceM / 1000).toFixed(1)} ק״מ` : '';
    const prev = best.get(a.athleteId);
    if (!prev || gap < prev.gap) best.set(a.athleteId, { gap, note: `${hhmm}${km}` });
  }
  return new Map([...best].map(([id, v]) => [id, v.note]));
}

export interface StoredMark { athleteId: string; status: AttendanceStatus; source: AttendanceSource; watchNote: string | null }
export interface MemberLite { athleteId: string; name: string; avatarUrl: string | null }
export interface AttendanceRow extends MemberLite { status: AttendanceStatus | null; source: AttendanceSource | null; watchNote: string | null }

/** One row per member: the leader's mark, else a stored or fresh watch mark, else unmarked. */
export function buildRows(members: MemberLite[], stored: StoredMark[], auto: Map<string, string>): AttendanceRow[] {
  const byId = new Map(stored.map((s) => [s.athleteId, s]));
  return members.map((m) => {
    const s = byId.get(m.athleteId);
    const note = auto.get(m.athleteId) ?? s?.watchNote ?? null;
    if (s?.source === 'leader') return { ...m, status: s.status, source: 'leader', watchNote: note };
    if (auto.has(m.athleteId) || s) return { ...m, status: 'present', source: 'watch', watchNote: note };
    return { ...m, status: null, source: null, watchNote: null };
  });
}

/** Validate a POST body's marks against the pack's members. */
export function parseMarks(raw: unknown, memberIds: Set<string>): { athleteId: string; status: AttendanceStatus }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { athleteId: string; status: AttendanceStatus }[] = [];
  for (const m of raw) {
    const id = typeof m?.athleteId === 'string' ? m.athleteId : '';
    const st = m?.status;
    if (!memberIds.has(id) || (st !== 'present' && st !== 'absent')) return null;
    out.push({ athleteId: id, status: st });
  }
  return out;
}

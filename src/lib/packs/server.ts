// ── Pack loaders (b23) ──────────────────────────────────────────────────────
//
// A pack is a `groups` row. Members are the active athletes whose group_id is it. Every read
// here is narrow on purpose: these feed leader screens, and a leader is a runner (see
// leader-safe.ts) — no activity column beyond start time and distance is ever selected.

import type { SupabaseClient } from '@supabase/supabase-js';
import { addDaysToDateStr, planWeekStartOf, resolveGroup } from '@/lib/utils';
import { extractWorkouts } from '@/lib/plans/workout-parsing';
import { PLAN_STATUSES } from '@/lib/plans/plan-status';
import { autoMarks, buildRows, parseTimeOfDay, type AttendanceRow, type StoredMark } from './attendance';

type Db = SupabaseClient;

export interface PackMember { athleteId: string; name: string; avatarUrl: string | null; lastSeenAt: string | null }
export interface PackSession { date: string; title: string; place: string | null; time: string | null; startMin: number | null; paceText: string | null }

export async function loadPack(db: Db, packId: string): Promise<{ id: string; name: string; groupIndex: number } | null> {
  const { data } = await db.from('groups').select('id, name').eq('id', packId).maybeSingle();
  if (!data) return null;
  const idx = resolveGroup(data.name).index;
  return { id: data.id, name: data.name, groupIndex: idx >= 0 ? idx + 1 : 0 };
}

export async function packMembers(db: Db, packId: string): Promise<PackMember[]> {
  const { data, error } = await db.from('athletes')
    .select('id, name, avatar_url, last_seen_at, status')
    .eq('group_id', packId);
  if (error) throw new Error(error.message);
  return ((data || []) as Array<{ id: string; name: string | null; avatar_url: string | null; last_seen_at: string | null; status: string | null }>)
    .filter((a) => (a.status ?? 'active') === 'active')
    .map((a) => ({ athleteId: a.id, name: a.name || '', avatarUrl: a.avatar_url, lastSeenAt: a.last_seen_at }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export async function packLeaderIds(db: Db, packId: string): Promise<string[]> {
  const { data, error } = await db.from('pack_leaders').select('athlete_id').eq('pack_id', packId);
  if (error) return [];
  return ((data || []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id);
}

const fmtPace = (sec: unknown) =>
  typeof sec === 'number' && sec > 0 ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : null;

/**
 * The pack's session on a date: the coach's one-day session (day_sessions, migration 150) when
 * published, else that day of the club's group plan (weekly_plans, athlete_id IS NULL, plan
 * week = Sunday). Null = no session that day.
 */
export async function packSession(db: Db, date: string, groupIndex: number): Promise<PackSession | null> {
  const { data: day } = await db.from('day_sessions')
    .select('session_date, start_time, place, title, pack_paces, published_at')
    .eq('session_date', date).maybeSingle();
  if (day?.published_at) {
    const startMin = parseTimeOfDay(day.start_time);
    const paces = Array.isArray(day.pack_paces) ? day.pack_paces : [];
    return {
      date, title: day.title || '', place: day.place ?? null,
      time: startMin == null ? null : String(day.start_time).slice(0, 5), startMin,
      paceText: groupIndex >= 1 ? fmtPace(paces[groupIndex - 1]) : null,
    };
  }
  const weekStart = planWeekStartOf(date);
  const { data: plans } = await db.from('weekly_plans')
    .select('parsed_workouts, created_at')
    .is('athlete_id', null).eq('week_start_date', weekStart).in('status', [...PLAN_STATUSES])   // a draft is not the plan
    .order('created_at', { ascending: false }).limit(1);
  const plan = plans?.[0];
  if (!plan) return null;
  const dow = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000);
  const w = extractWorkouts(plan.parsed_workouts).find((x) => x.dayOfWeek === dow);
  if (!w) return null;
  return { date, title: w.workoutName || w.name || '', place: null, time: null, startMin: null, paceText: null };
}

/** When the pack's current week plan was published — for "read the plan". */
export async function planPublishedAt(db: Db, date: string): Promise<string | null> {
  const { data } = await db.from('weekly_plans').select('created_at')
    .is('athlete_id', null).eq('week_start_date', planWeekStartOf(date)).in('status', [...PLAN_STATUSES])
    .order('created_at', { ascending: false }).limit(1);
  return data?.[0]?.created_at ?? null;
}

/** Days since each member's last run (null = none on record), from athlete_activities. */
export async function daysSinceRun(db: Db, ids: string[], today: string): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(ids.map((id) => [id, null]));
  if (!ids.length) return out;
  const since = addDaysToDateStr(today, -60);
  const { data } = await db.from('athlete_activities').select('athlete_id, start_time')
    .in('athlete_id', ids).gte('start_time', `${since}T00:00:00`)
    .order('start_time', { ascending: false }).limit(1000);
  for (const r of (data || []) as Array<{ athlete_id: string; start_time: string }>) {
    if (out.get(r.athlete_id) != null) continue;
    const day = r.start_time.slice(0, 10); // UTC-shaped local: the date part IS the athlete's day
    out.set(r.athlete_id, Math.max(0, Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000)));
  }
  return out;
}

/** The attendance rows for one pack session, auto-marked from the watch. */
export async function attendanceRows(
  db: Db, packId: string, date: string, members: PackMember[], session: PackSession | null,
): Promise<AttendanceRow[]> {
  const ids = members.map((m) => m.athleteId);
  const [{ data: stored }, { data: acts }] = await Promise.all([
    db.from('pack_attendance').select('athlete_id, status, source, watch_note').eq('pack_id', packId).eq('session_date', date),
    ids.length && session
      ? db.from('athlete_activities').select('athlete_id, start_time, distance')
        .in('athlete_id', ids).gte('start_time', `${date}T00:00:00`).lt('start_time', `${addDaysToDateStr(date, 1)}T00:00:00`)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const marks: StoredMark[] = ((stored || []) as Array<{ athlete_id: string; status: 'present' | 'absent'; source: 'watch' | 'leader'; watch_note: string | null }>)
    .map((s) => ({ athleteId: s.athlete_id, status: s.status, source: s.source, watchNote: s.watch_note }));
  const auto = session
    ? autoMarks(date, session.startMin, ((acts || []) as Array<{ athlete_id: string; start_time: string; distance: number | null }>)
      .map((a) => ({ athleteId: a.athlete_id, startTime: a.start_time, distanceM: a.distance })))
    : new Map<string, string>();
  return buildRows(members.map(({ athleteId, name, avatarUrl }) => ({ athleteId, name, avatarUrl })), marks, auto);
}

/** Last `n` sessions' counts, newest first, from stored rows. */
export async function attendanceHistory(db: Db, packId: string, n: number, memberCount: number) {
  const { data } = await db.from('pack_attendance').select('session_date, status')
    .eq('pack_id', packId).order('session_date', { ascending: false }).limit(2000);
  const byDate = new Map<string, number>();
  for (const r of (data || []) as Array<{ session_date: string; status: string }>) {
    byDate.set(r.session_date, (byDate.get(r.session_date) ?? 0) + (r.status === 'present' ? 1 : 0));
  }
  return [...byDate.entries()].slice(0, n).map(([date, present]) => ({ date, present, total: memberCount }));
}

export function packChannelId(packId: string): string {
  return `academy-pack-${packId}`;
}

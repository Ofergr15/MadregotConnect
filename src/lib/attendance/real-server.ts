import type { createServerClient } from '@/lib/supabase/server';
import { resolveGroup } from '@/lib/utils';
import { toRoute } from '@/lib/feed/project';
import { groupsOf, isTeamDay } from './together';

type Db = ReturnType<typeof createServerClient>;

export interface SessionDay { date: string; held: boolean; groups: string[][]; came: string[]; said: string[] }
export interface Person { id: string; name: string; avatarUrl: string | null; pack: number | null; academy: boolean; active: boolean }

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Every team day from `from` to `to`: who ran together that morning, and who had said they'd come. */
export async function sessionsBetween(db: Db, from: string, to: string, today: string): Promise<SessionDay[]> {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isTeamDay(d)) dates.push(d);
  if (!dates.length) return [];
  const { data: rsvp } = await db.from('workout_attendance').select('athlete_id, week_start_date, day_of_week, attending')
    .gte('week_start_date', addDays(from, -6)).lte('week_start_date', to).eq('attending', true);
  const said = new Map<string, Set<string>>();
  for (const r of (rsvp || []) as Array<{ athlete_id: string; week_start_date: string; day_of_week: number }>) {
    const d = addDays(r.week_start_date, r.day_of_week);
    said.set(d, new Set([...(said.get(d) ?? []), r.athlete_id]));
  }
  return Promise.all(dates.map(async (date) => {
    const held = date <= today;
    let groups: string[][] = [];
    if (held) {
      // start_time is the runner's wall clock stored as +00:00: 04:00–09:00 is the morning.
      const { data } = await db.from('athlete_activities').select('athlete_id, start_time, activity_type, route_preview')
        .gte('start_time', `${date}T04:00:00`).lt('start_time', `${date}T09:00:00`).gt('distance', 2000);
      groups = groupsOf(((data || []) as Array<{ athlete_id: string; start_time: string; activity_type: string | null; route_preview: unknown }>)
        .filter((r) => /run/i.test(r.activity_type || ''))
        .map((r) => ({ athleteId: r.athlete_id, startMs: Date.parse(r.start_time), route: toRoute(r.route_preview) ?? [] })));
    }
    return { date, held, groups, came: groups.flat(), said: [...(said.get(date) ?? [])] };
  }));
}

/** Faces, packs and the academy, for everyone who appears. */
export async function people(db: Db): Promise<Record<string, Person>> {
  const [{ data: rows }, { data: groups }] = await Promise.all([
    db.from('athletes').select('id, name, avatar_url, group_id, is_academy, status'),
    db.from('groups').select('id, name'),
  ]);
  const gname = new Map(((groups || []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]));
  const out: Record<string, Person> = {};
  for (const a of (rows || []) as Array<{ id: string; name: string | null; avatar_url: string | null; group_id: string | null; is_academy: boolean | null; status: string | null }>) {
    const g = a.group_id ? resolveGroup(gname.get(a.group_id) || '') : null;
    out[a.id] = { id: a.id, name: (a.name || '').trim(), avatarUrl: a.avatar_url, pack: g && g.index >= 0 ? g.index + 1 : null, academy: !!a.is_academy, active: a.status === 'active' };
  }
  return out;
}

export interface PresenceMark { present: boolean; groupLabel: string | null; markedBy: string | null; markedAt: string }

/**
 * The coach's presence marks (migration 197) for practice days from `from` to `to`,
 * keyed by date then athlete. Null when the table is missing or the read failed —
 * the screen keeps working without it.
 */
export async function presenceBetween(db: Db, from: string, to: string): Promise<Record<string, Record<string, PresenceMark>> | null> {
  try {
    const { data, error } = await db.from('practice_presence')
      .select('athlete_id, week_start, day, group_label, present, marked_by, marked_at')
      .gte('week_start', addDays(from, -6)).lte('week_start', to);
    if (error) return null;
    const out: Record<string, Record<string, PresenceMark>> = {};
    for (const r of (data || []) as Array<{ athlete_id: string; week_start: string; day: number; group_label: string | null; present: boolean; marked_by: string | null; marked_at: string }>) {
      const date = addDays(String(r.week_start).slice(0, 10), r.day);
      if (date < from || date > to) continue;
      (out[date] ??= {})[r.athlete_id] = { present: r.present, groupLabel: r.group_label, markedBy: r.marked_by, markedAt: r.marked_at };
    }
    return out;
  } catch {
    return null;
  }
}

export interface RosterEntry { id: string; name: string }
export type Roster = Record<'1' | '2' | '3' | 'academy', RosterEntry[]>;

/**
 * Who a coach can mark: every ACTIVE, approved member, by pack (academy apart, as in
 * `sizes`). id + name only — never email. Pending rows (`approved = false`, the
 * pendingAthleteIds rule) are left out. Null on a read error.
 */
export async function activeRoster(db: Db): Promise<Roster | null> {
  const [{ data: rows, error }, { data: groups }] = await Promise.all([
    db.from('athletes').select('id, name, group_id, is_academy, status, approved').eq('status', 'active'),
    db.from('groups').select('id, name'),
  ]);
  if (error) return null;
  const gname = new Map(((groups || []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]));
  const out: Roster = { 1: [], 2: [], 3: [], academy: [] };
  for (const a of (rows || []) as Array<{ id: string; name: string | null; group_id: string | null; is_academy: boolean | null; status: string | null; approved: boolean | null }>) {
    if (a.approved === false || a.status !== 'active') continue;
    const entry = { id: a.id, name: (a.name || '').trim() };
    if (a.is_academy) { out.academy.push(entry); continue; }
    const g = a.group_id ? resolveGroup(gname.get(a.group_id) || '') : null;
    const pack = g && g.index >= 0 && g.index < 3 ? (String(g.index + 1) as '1' | '2' | '3') : null;
    if (pack) out[pack].push(entry);
  }
  for (const k of Object.keys(out) as Array<keyof Roster>) out[k].sort((x, y) => x.name.localeCompare(y.name, 'he'));
  return out;
}

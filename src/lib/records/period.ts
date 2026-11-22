import type { createServerClient } from '@/lib/supabase/server';
import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { israelToday } from '@/lib/utils';
import type { BoardPerson } from './board';

/**
 * The two knobs on GET /api/records/weekly beyond `metric`:
 *   group=1|2|3   rank WITHIN that pace group (the board is rebuilt on that group's
 *                 roster, so ranks, the gap and the unranked tail are the group's own —
 *                 not the club top 5 with everyone else filtered out).
 *   period=month  the Israel calendar month instead of the activity week.
 */
export type BoardPeriod = 'week' | 'month';
export type Totals = { meters: number; seconds: number; runs: number };

export function parseBoardPeriod(raw: string | null): BoardPeriod {
  return raw === 'month' ? 'month' : 'week';
}

export function parseBoardGroup(raw: string | null): 1 | 2 | 3 | null {
  return raw === '1' || raw === '2' || raw === '3' ? (Number(raw) as 1 | 2 | 3) : null;
}

export function rosterInGroup<T extends Pick<BoardPerson, 'groupIndex'>>(roster: T[], group: number | null): T[] {
  return group == null ? roster : roster.filter((p) => p.groupIndex === group);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The Israel calendar month `now` falls in. `endExclusive` is the next month's 1st. */
export function israelMonthRange(now: Date = new Date()): { start: string; endExclusive: string; end: string; daysLeft: number } {
  const today = israelToday(now);
  const [y, m] = today.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const next = new Date(Date.UTC(y, m, 1));
  const last = new Date(next); last.setUTCDate(0);
  const daysLeft = Math.round((last.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return { start: iso(start), endExclusive: iso(next), end: iso(last), daysLeft };
}

type Row = RunActivityRow & { athlete_id: string };

/**
 * Totals per athlete over [from, toExclusive). `start_time` is the athlete's wall clock
 * stored UTC-shaped (CLAUDE.md), so its date prefix IS the local date — compare that,
 * never shift it into a timezone.
 */
export function sumPeriod(rows: Row[], athleteIds: string[], from: string, toExclusive: string): Map<string, Totals> {
  const out = new Map<string, Totals>(athleteIds.map((id) => [id, { meters: 0, seconds: 0, runs: 0 }]));
  for (const r of filterQualifyingRuns(rows)) {
    const day = String(r.start_time).slice(0, 10);
    if (day < from || day >= toExclusive) continue;
    const t = out.get(r.athlete_id);
    if (!t) continue;
    t.meters += r.distance; t.seconds += r.duration || 0; t.runs += 1;
  }
  return out;
}

const PAGE = 1000;

/** Paged read (Supabase caps a select at 1000 and reports truncation as success). */
export async function fetchPeriodTotals(db: ReturnType<typeof createServerClient>, athleteIds: string[], from: string, toExclusive: string): Promise<Map<string, Totals>> {
  const rows: Row[] = [];
  if (athleteIds.length) {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await db.from('athlete_activities')
        .select('athlete_id, start_time, distance, duration, activity_type')
        .in('athlete_id', athleteIds)
        .gte('start_time', from).lt('start_time', toExclusive)
        .order('id').range(offset, offset + PAGE - 1);
      if (error) throw error;
      rows.push(...((data || []) as Row[]));
      if (!data || data.length < PAGE) break;
    }
  }
  return sumPeriod(rows, athleteIds, from, toExclusive);
}
